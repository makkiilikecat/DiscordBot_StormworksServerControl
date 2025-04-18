// [ルート]/commands/sws/sub_commands/utility/websocket/disconnection_handler.js

const clientManager = require('./client_manager'); // クライアント情報取得/削除用
const messageSender = require('./message_sender'); // 保留リクエスト拒否用
// 修正: text_chat_logger のパス修正
const { log } = require('../../../../../utility/text_chat_logger');

/**
 * 切断されたクライアントのインスタンス削除タイマーを管理するMap
 * キー: token (string) - 物理サーバー識別子
 * 値: NodeJS.Timeout
 */
const disconnectTimers = new Map();

// serverInstances Map (外部から設定される想定)
let serverInstancesRef = null; // 外部のMapへの参照を保持
function setServerInstances(map) {
    serverInstancesRef = map;
    log('DEBUG', '[切断ハンドラ] serverInstances Map への参照を設定しました。');
}

// ★ 定数追加
const INSTANCE_CLEANUP_TIMEOUT = 10 * 60 * 1000; // 10分

/**
 * 指定したクライアントのクリーンアップ処理
 * @param {string} clientId - クリーンアップ対象のクライアントID
 * @param {boolean} [immediate=false] - タイマーを使わず即座にクリーンアップするか
 */
async function cleanupClient(clientId, immediate = false) {
    const clientInfo = clientManager.getClient(clientId);
    if (!clientInfo) {
        return; // 処理済み or 存在しない
    }

    // ★ 物理サーバーIDとして token を使用
    const { token, ip, ws, pingIntervalId, pongTimeoutId } = clientInfo;
    const tokenEnding = `...${token.slice(-4)}`;
    log('DEBUG', `[切断ハンドラ] クリーンアップ開始: ClientID=${clientId}, Token=${tokenEnding}, Immediate=${immediate}`);

    // 1. Ping/Pongタイマー停止
    if (pingIntervalId) clearInterval(pingIntervalId);
    if (pongTimeoutId) clearTimeout(pongTimeoutId);

    // 2. WebSocket接続終了
    if (ws && (ws.readyState === require('ws').WebSocket.OPEN || ws.readyState === require('ws').WebSocket.CONNECTING)) {
        log('DEBUG', `[切断ハンドラ] WebSocket接続を終了します: ClientID=${clientId}, Token=${tokenEnding}`);
        ws.terminate();
    }

    // 3. 保留中リクエスト拒否
    messageSender.rejectPendingRequests(clientId);

    // 4. クライアントリストから削除（タイマーセットする場合もリストからは削除）
    clientManager.removeClient(clientId);

    // --- Stage 5: 切断後タイムアウト処理 ---
    if (!immediate) {
        // 既存のタイマーがあればクリア（再接続→即切断のようなケースに対応）
        if (disconnectTimers.has(token)) {
            clearTimeout(disconnectTimers.get(token));
            log('DEBUG', `[切断ハンドラ] 既存の切断タイマーをクリアしました: Token=${tokenEnding}`);
            disconnectTimers.delete(token); // Mapからも削除
        }

        log('INFO', `[切断ハンドラ] Token=${tokenEnding} のインスタンス削除タイマーを ${INSTANCE_CLEANUP_TIMEOUT / 60000} 分後にセットします。 (Client: ${clientId})`);

        const timerId = setTimeout(async () => {
            log('WARN', `[切断ハンドラ][タイムアウト] Token=${tokenEnding} が ${INSTANCE_CLEANUP_TIMEOUT / 60000} 分間再接続しませんでした。関連インスタンスの状態を更新します。`);
            disconnectTimers.delete(token); // 実行されたタイマーをMapから削除

            if (serverInstancesRef) {
                let cleanedCount = 0;
                for (const [instanceName, instanceState] of serverInstancesRef.entries()) {
                    // 同じトークンに紐づき、かつ 'running' 状態のものを対象
                    if (instanceState.token === token && instanceState.status === 'running') {
                        log('INFO', `[切断ハンドラ][タイムアウト] サーバー "${instanceName}" を停止済みに更新します (Token=${tokenEnding} タイムアウト)。`);
                        instanceState.status = 'stopped'; // 状態を更新
                        instanceState.clientId = null;   // 接続IDを解除
                        // 停止時刻なども記録するならここ
                        // instanceState.stoppedAt = new Date().toISOString();
                        cleanedCount++;
                    }
                }
                if (cleanedCount > 0) {
                    log('INFO', `[切断ハンドラ][タイムアウト] Token=${tokenEnding} に関連する ${cleanedCount} 件のインスタンスの状態を更新しました。`);
                } else {
                     log('DEBUG', `[切断ハンドラ][タイムアウト] Token=${tokenEnding} に関連する実行中インスタンスは見つかりませんでした。`);
                }
            } else {
                 log('ERROR', '[切断ハンドラ][タイムアウト] serverInstances が利用できないため、インスタンスの状態を更新できませんでした。');
            }
        }, INSTANCE_CLEANUP_TIMEOUT);

        disconnectTimers.set(token, timerId); // トークンをキーにしてタイマーIDを保存

    } else {
        // 即時クリーンアップの場合
        log('INFO', `[切断ハンドラ] クライアント ${clientId} (Token=${tokenEnding}, ${ip}) を即時クリーンアップしました。`);
        // 即時クリーンアップの場合も、念のためタイマーをクリア
        clearDisconnectTimer(token);
        // Stage 5: 即時クリーンアップ時に serverInstances をどうするか？
        // 現状では何もしない。サーバー停止コマンドによる切断の場合は stop.js で状態更新される。
        // 予期せぬ即時クリーンアップ（重複接続など）の場合、状態同期に任せる。
    }
    // -------------------------------------

    log('DEBUG', `[切断ハンドラ] クリーンアップ完了: ClientID=${clientId}, Token=${tokenEnding}`);
}

/**
 * 指定されたトークンに対応する切断タイマーを解除する
 * @param {string} token - 物理サーバー識別トークン
 */
function clearDisconnectTimer(token) {
    if (disconnectTimers.has(token)) {
        clearTimeout(disconnectTimers.get(token));
        disconnectTimers.delete(token);
        log('INFO', `[切断ハンドラ] 切断タイマーを解除しました: Token=...${token.slice(-4)}`);
        return true;
    }
    return false;
}

/**
 * 全ての切断タイマーをクリアする (サーバー停止時など)
 */
function clearAllTimers() {
    const count = disconnectTimers.size;
    if (count > 0) {
        log('DEBUG', `[切断ハンドラ] 全ての切断タイマー (${count}件) をクリアします...`);
        for (const timerId of disconnectTimers.values()) {
            clearTimeout(timerId);
        }
        disconnectTimers.clear();
        log('INFO', `[切断ハンドラ] 全ての切断タイマーをクリアしました。`);
    } else {
        log('DEBUG', `[切断ハンドラ] クリア対象の切断タイマーはありません。`);
    }
}

module.exports = {
    cleanupClient,
    clearDisconnectTimer,
    clearAllTimers,
    setServerInstances,
};