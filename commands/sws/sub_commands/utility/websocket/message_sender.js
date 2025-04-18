// [ルート]/commands/sws/sub_commands/utility/websocket/message_sender.js

const { WebSocket } = require('ws'); // WebSocket.OPEN を使用するためインポート
const { v4: uuidv4 } = require('uuid'); // リクエストID生成用
const clientManager = require('./client_manager'); // クライアント情報取得用
// 修正: text_chat_logger のパスを変更
const { log } = require('../../../../../utility/text_chat_logger');

// --- Stage 2: リクエスト/レスポンス管理 ---
/**
 * 送信したリクエストと応答を待つPromiseを管理するMap
 * キー: requestId (string, UUID)
 * 値: { resolve, reject, timeoutId, clientId }
 */
const requestPromises = new Map();
const RESPONSE_TIMEOUT = 60 * 1000; // デフォルトの応答タイムアウト (60秒)
// -----------------------------------------

/**
 * 指定したクライアントにJSONデータを送信する (基本的な送信)
 * @param {string} clientId - 送信先クライアントのID
 * @param {object} data - 送信するデータ (JSONシリアライズ可能なオブジェクト)
 * @returns {boolean} 送信を試行したかどうか
 */
function sendToClient(clientId, data) {
    // --- Stage 1 で実装済み ---
    const clientInfo = clientManager.getClient(clientId);

    if (!clientInfo) {
        log('WARN', `[送信者] 送信先クライアントが見つかりません: ClientID=${clientId}`, { data: data });
        return false;
    }

    const { ws, physicalServerId, ip } = clientInfo;

    if (ws.readyState !== WebSocket.OPEN) {
        log('WARN', `[送信者] クライアント ${clientId} (${physicalServerId}, ${ip}) への接続がオープンしていません (State: ${ws.readyState})。送信を中止しました。`, { data: data });
        return false;
    }

    try {
        const messageString = JSON.stringify(data);
        ws.send(messageString);
        // 送信するデータの内容によってはログレベルをDEBUGにするか、内容を省略する
        log('DEBUG', `[送信者] メッセージ送信 to ${physicalServerId} (Client: ${clientId}, IP: ${ip}):`, { data: data });
        return true;
    } catch (error) {
        log('ERROR', `[送信者] メッセージ送信中にエラー発生 to ${physicalServerId} (Client: ${clientId}, IP: ${ip}):`, { error: error, data: data });
        return false;
    }
    // --- Stage 1 ここまで ---
}


// --- Stage 2: 応答待ち送信機能 ---
/**
 * 指定したクライアントにリクエストを送信し、応答を待つ (Promiseベース)
 * @param {string} clientId - 送信先クライアントのID
 * @param {object} data - 送信するリクエストデータ (type, payload など)
 * @param {number} [timeout=RESPONSE_TIMEOUT] - 応答待ちタイムアウト時間 (ミリ秒)
 * @returns {Promise<object>} クライアントからの応答ペイロード
 * @throws {Error} 送信失敗、クライアント未接続、タイムアウト、クライアントからのエラー応答の場合
 */
function sendPacket(clientId, data, timeout = RESPONSE_TIMEOUT) {
    return new Promise((resolve, reject) => {
        const clientInfo = clientManager.getClient(clientId);
        if (!clientInfo || clientInfo.ws.readyState !== WebSocket.OPEN) {
            // エラーメッセージに詳細を追加
            const reason = !clientInfo ? 'クライアントが見つかりません' : `接続がオープンしていません (State: ${clientInfo.ws.readyState})`;
            log('ERROR', `[送信者][Packet] 送信失敗: ${reason}。 ClientID=${clientId}`, {data: data});
            return reject(new Error(`送信失敗: ${reason}。 ClientID=${clientId}`));
        }

        const { physicalServerId, ip } = clientInfo;

        // 一意なリクエストIDを生成
        const requestId = uuidv4();
        const messageToSend = { ...data, requestId }; // 元のデータにrequestIdを追加

        // タイムアウト処理を設定
        const timeoutId = setTimeout(() => {
            // タイムアウトしたらPromise管理から削除し、reject
            if (requestPromises.has(requestId)) {
                requestPromises.delete(requestId);
                log('ERROR', `[送信者][Packet] ${physicalServerId} (Client: ${clientId}) へのリクエストがタイムアウトしました (ID: ${requestId}, ${timeout}ms)。`, {data: data});
                reject(new Error(`リクエストがタイムアウトしました (ID: ${requestId}, ${timeout}ms)`));
            }
        }, timeout);

        // Promiseのresolve/reject関数、タイムアウトID、クライアントIDを保存
        requestPromises.set(requestId, { resolve, reject, timeoutId, clientId });
        log('DEBUG', `[送信者][Packet] リクエストを保留リストに追加: RequestID=${requestId}, ClientID=${clientId}`);

        // データをクライアントに送信 (sendToClientを使用)
        if (!sendToClient(clientId, messageToSend)) {
            // sendToClient 内で既にエラーログは出力されているはず
            // 送信失敗時はタイムアウト処理をキャンセルし、Promise管理から削除してreject
            clearTimeout(timeoutId);
            requestPromises.delete(requestId);
            reject(new Error(`sendToClientによるパケット送信に失敗しました。ClientID=${clientId}, RequestID=${requestId}`));
        } else {
            log('DEBUG', `[送信者][Packet] リクエスト送信成功、応答待ち: RequestID=${requestId}, ClientID=${clientId}, PhysicalID=${physicalServerId}`);
            // 応答は message_handler で処理される
        }
    });
}
// --- Stage 2 ここまで ---


// --- Stage 2: 切断時の保留リクエスト処理 ---
/**
 * 指定されたクライアントIDに関連する、または全ての保留中のリクエストをエラーで拒否する
 * @param {string} [clientId] - 対象のクライアントID。指定されない場合は全ての保留リクエストを拒否。
 */
function rejectPendingRequests(clientId) {
    let rejectedCount = 0;
    log('DEBUG', `[送信者] 保留中リクエストの拒否処理を開始します。対象ClientID: ${clientId || '全て'}`);
    const reason = clientId
        ? `クライアント ${clientId} が切断されたため`
        : '接続が切断されたかサーバーが停止するため';

    for (const [requestId, promiseInfo] of requestPromises.entries()) {
        // clientIdが指定されている場合、一致するものだけを処理
        if (clientId && promiseInfo.clientId !== clientId) {
            continue;
        }

        // タイムアウトをクリア
        clearTimeout(promiseInfo.timeoutId);
        // エラーで拒否
        promiseInfo.reject(new Error(`リクエスト (ID: ${requestId}) は失敗しました: ${reason}`));
        // Mapから削除
        requestPromises.delete(requestId);
        rejectedCount++;
        log('WARN', `[送信者] 保留中のリクエスト (ID: ${requestId}, Client: ${promiseInfo.clientId}) を拒否しました。理由: ${reason}`);
    }

    if (rejectedCount > 0) {
        log('INFO', `[送信者] ${rejectedCount} 件の保留中リクエストを拒否しました。対象ClientID: ${clientId || '全て'}`);
    } else {
        log('DEBUG', `[送信者] 拒否対象の保留中リクエストはありませんでした。対象ClientID: ${clientId || '全て'}`);
    }
}
// --- Stage 2 ここまで ---

module.exports = {
    sendToClient,
    // --- Stage 2 ---
    sendPacket,
    rejectPendingRequests,
    requestPromises, // message_handler でアクセスする必要があるためエクスポート
    // ---------------
};