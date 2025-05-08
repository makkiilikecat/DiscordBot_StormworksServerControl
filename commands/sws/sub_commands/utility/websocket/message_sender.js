// [ルート]/commands/sws/sub_commands/utility/websocket/message_sender.js
/**
 * WebSocketクライアントへのメッセージ送信を管理するモジュール。
 * - sendToClient: 応答不要なメッセージを送信
 * - sendPacket: 応答を待つリクエストを送信
 * - requestPromises: 送信したリクエストと応答処理用Promiseを管理
 * - rejectPendingRequests: 保留中のリクエストを一括で失敗させる
 */

const { WebSocket } = require('ws'); // WebSocket.OPEN 定数を使用するため
const { v4: uuidv4 } = require('uuid'); // リクエストID生成用
const clientManager = require('./client_manager'); // クライアント情報取得用
const { log } = require('../../../../../utility/text_chat_logger'); // ロガー

/**
 * 送信したリクエストと、その応答を待つためのPromise関連情報を管理するMap。
 *
 * キー: requestId (string, UUID) - 送信時に生成される一意なID
 * 値: オブジェクト
 * - resolve: (function) 応答成功時に呼び出すPromiseのresolve関数
 * - reject: (function) 応答失敗・タイムアウト時に呼び出すPromiseのreject関数
 * - timeoutId: (NodeJS.Timeout) 応答タイムアウト監視用のタイマーID
 * - clientId: (string) リクエスト送信先のクライアントID
 * - discordContext: (object | null) 関連するDiscordメッセージの情報（任意）
 * - messageId: (string) DiscordメッセージID
 * - channelId: (string) DiscordチャンネルID
 * - guildId: (string) DiscordギルドID
 */
const requestPromises = new Map();

/** デフォルトの応答タイムアウト時間 (ミリ秒) */
const RESPONSE_TIMEOUT = 60 * 1000; // 60秒

/**
 * 指定したクライアントにJSONデータを送信する（応答不要な通知などに使用）。
 *
 * @param {string} clientId - 送信先クライアントの一意な内部ID。
 * @param {object} data - 送信するデータ (JSONシリアライズ可能なオブジェクト)。
 * @returns {boolean} 送信を試みた場合はtrue、クライアントが見つからない or 接続未オープンで送信しなかった場合はfalse。
 */
function sendToClient(clientId, data) {
    const clientInfo = clientManager.getClient(clientId);

    // クライアントが存在しない場合
    if (!clientInfo) {
        log('WARN', `[送信者][ToClient] 送信先クライアントが見つかりません: ClientID=${clientId}`, { data: data });
        return false;
    }

    const { ws, physicalServerId, ip } = clientInfo;

    // WebSocket接続がオープンしていない場合
    if (ws.readyState !== WebSocket.OPEN) {
        log('WARN', `[送信者][ToClient] クライアント ${clientId} (${physicalServerId}, ${ip}) への接続がオープンしていません (State: ${ws.readyState})。送信を中止しました。`, { data: data });
        return false;
    }

    try {
        // データをJSON文字列に変換して送信
        const messageString = JSON.stringify(data);
        ws.send(messageString);
        // DEBUGレベルで送信内容をログ出力（必要に応じて調整）
        log('DEBUG', `[送信者][ToClient] メッセージ送信 to ${physicalServerId} (Client: ${clientId}, IP: ${ip}):`, { data: data });
        return true;
    } catch (error) {
        // 送信中のエラー
        log('ERROR', `[送信者][ToClient] メッセージ送信中にエラー発生 to ${physicalServerId} (Client: ${clientId}, IP: ${ip}):`, { error: error, data: data });
        return false;
    }
}


/**
 * 指定したクライアントにリクエストを送信し、応答を待つ（Promiseベース）。
 * 応答には `requestId` が含まれ、`message_handler.js` で対応するPromiseが処理される。
 *
 * @param {string} clientId - 送信先クライアントのID
 * @param {object} data - 送信するリクエストデータ (type, payload など)
 * @param {number} [timeout=RESPONSE_TIMEOUT] - 応答待ちタイムアウト時間 (ミリ秒)
 * @param {string} [requestType] - リクエストのタイプ（例: 'startServer', 'stopServer'）
 * @param {string} [instanceName] - 操作対象のインスタンス名
 * @param {object} [discordContext] - Discordメッセージのコンテキスト情報 (任意)
 * @returns {Promise<object>} クライアントからの応答ペイロード
 * @throws {Error} 送信失敗、クライアント未接続、タイムアウト、クライアントからのエラー応答の場合
 */
function sendPacket(clientId, data, timeout = RESPONSE_TIMEOUT, requestType = null, instanceName = null, discordContext = null) {
  
    return new Promise((resolve, reject) => {
        const clientInfo = clientManager.getClient(clientId);

        // クライアント存在チェックと接続状態チェック
        if (!clientInfo || clientInfo.ws.readyState !== WebSocket.OPEN) {
            const reason = !clientInfo ? 'クライアントが見つかりません' : `接続がオープンしていません (State: ${clientInfo.ws.readyState})`;
            log('ERROR', `[送信者][Packet] 送信失敗: ${reason}。 ClientID=${clientId}`, { data: data });
            return reject(new Error(`送信失敗: ${reason}。 ClientID=${clientId}`));
        }

        const { physicalServerId, ip } = clientInfo;

        // 一意なリクエストIDを生成
        const requestId = uuidv4();
        // 元のデータにリクエストIDを追加
        const messageToSend = { ...data, requestId };

        // 応答タイムアウト処理を設定
        const timeoutId = setTimeout(() => {
            // タイムアウト発生時、まだ応答待ちリストに存在すれば処理
            if (requestPromises.has(requestId)) {
                // タイムアウトしたPromiseのreject関数を取得して呼び出す
                const { reject: promiseReject } = requestPromises.get(requestId);
                requestPromises.delete(requestId); // リストから削除
                log('ERROR', `[送信者][Packet] ${physicalServerId} (Client: ${clientId}) へのリクエストがタイムアウトしました (ID: ${requestId}, ${timeout}ms)。`, { data: data });
                promiseReject(new Error(`リクエストがタイムアウトしました (ID: ${requestId}, ${timeout}ms)`));
            }
        }, timeout);

        // Promiseのresolve/reject関数、タイムアウトID、クライアントID、Discordコンテキストを Map に保存
        requestPromises.set(requestId, { resolve, reject, timeoutId, clientId, requestType, instanceName, discordContext });
        log('DEBUG', `[送信者][Packet] リクエストを保留リストに追加: RequestID=${requestId}, ClientID=${clientId}, Type=${requestType || 'N/A'}, Instance=${instanceName || 'N/A'}${discordContext ? ', Contextあり' : ''}`);

        // 実際にメッセージを送信 (sendToClientを使用)
        if (!sendToClient(clientId, messageToSend)) {
            // sendToClient 内でエラーログは出力されているはず
            // 送信失敗時はタイムアウト処理をキャンセルし、Promise管理から削除して即時reject
            clearTimeout(timeoutId);
            requestPromises.delete(requestId);
            reject(new Error(`sendToClientによるパケット送信に失敗しました。ClientID=${clientId}, RequestID=${requestId}`));
        } else {
            // 送信成功、応答待ち状態
            log('DEBUG', `[送信者][Packet] リクエスト送信成功、応答待ち: RequestID=${requestId}, ClientID=${clientId}, PhysicalID=${physicalServerId}`);
            // 応答は message_handler.js で処理される
        }
    });
}


/**
 * 指定されたクライアントIDに関連する、または全ての保留中のリクエストをエラーで失敗させる。
 * 主にクライアント切断時やサーバーシャットダウン時に呼び出される。
 *
 * @param {string} [clientId] - 対象のクライアントID。指定されない場合は全ての保留リクエストを対象とする。
 */
function rejectPendingRequests(clientId = null) {
    let rejectedCount = 0;
    const targetLog = clientId ? `ClientID: ${clientId}` : '全て';
    log('DEBUG', `[送信者][Reject] 保留中リクエストの拒否処理を開始します。対象: ${targetLog}`);

    const reason = clientId
        ? `クライアント ${clientId} が切断されたため`
        : '接続が切断されたかサーバーが停止するため';

    // requestPromises Map をイテレート
    for (const [requestId, promiseInfo] of requestPromises.entries()) {
        // clientId が指定されていて、現在のリクエストのクライアントIDと一致しない場合はスキップ
        if (clientId && promiseInfo.clientId !== clientId) {
            continue;
        }

        // タイムアウトタイマーをクリア
        clearTimeout(promiseInfo.timeoutId);
        // Promiseをエラーで拒否
        promiseInfo.reject(new Error(`リクエスト (ID: ${requestId}) は失敗しました: ${reason}`));
        // Mapからエントリを削除
        requestPromises.delete(requestId);
        rejectedCount++;
        log('WARN', `[送信者][Reject] 保留中のリクエスト (ID: ${requestId}, Client: ${promiseInfo.clientId}) を拒否しました。理由: ${reason}`);
    }

    if (rejectedCount > 0) {
        log('INFO', `[送信者][Reject] ${rejectedCount} 件の保留中リクエストを拒否しました。対象: ${targetLog}`);
    } else {
        log('DEBUG', `[送信者][Reject] 拒否対象の保留中リクエストはありませんでした。対象: ${targetLog}`);
    }
}


// --- モジュールエクスポート ---
module.exports = {
    sendToClient, // 応答不要メッセージ送信
    sendPacket,   // 応答待ちリクエスト送信
    rejectPendingRequests, // 保留中リクエストの強制失敗処理
    requestPromises, // message_handler.js から参照するためにエクスポート
};