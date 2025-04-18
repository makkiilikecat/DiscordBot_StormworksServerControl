// [ルート]/commands/sws/sub_commands/utility/websocket/websocket_server.js

const { WebSocketServer } = require('ws');
// 修正: text_chat_logger のパス修正
const { log } = require('../../../../../utility/text_chat_logger');
const connectionHandler = require('./connection_handler');
const clientManager = require('./client_manager');
const disconnectionHandler = require('./disconnection_handler');
// ★ Stage 5: message_handler もインポート
const messageHandler = require('./message_handler');

let wss = null;
let serverInstancesMap = null;

/**
 * WebSocketサーバーを起動する
 * @param {number} port - サーバーを起動するポート番号
 * @param {Map<string, object>} instancesMap - サーバーインスタンス管理Map
 * @returns {Promise<void>}
 */
function startWebSocket(port, instancesMap) {
    if (wss) {
        log('WARN', '[WebSocket] サーバーは既に起動しています。');
        return Promise.resolve();
    }

    serverInstancesMap = instancesMap;
    // ★ 各モジュールに serverInstances Map への参照を渡す
    disconnectionHandler.setServerInstances(serverInstancesMap);
    messageHandler.setServerInstances(serverInstancesMap); // ★ message_handler にも渡す
    // stateSynchronizer にも渡す必要がある (message_handler 内で stateSynchronizer を初期化/設定する形でも良い)
    // 例: messageHandler.initialize(serverInstancesMap);

    log('INFO', `[WebSocket] WebSocketサーバーをポート ${port} で起動します...`);

    return new Promise((resolve, reject) => {
        wss = new WebSocketServer({ port });

        wss.on('listening', () => {
            log('INFO', `[WebSocket] サーバーがポート ${port} で待機を開始しました。`);
            resolve();
        });

        wss.on('connection', (ws, req) => {
            // ★ 接続処理を connection_handler に委譲 (変更なし)
            connectionHandler.handleConnection(ws, req);
        });

        wss.on('error', (error) => {
            log('ERROR', '[WebSocket] サーバーエラー:', { error });
            wss = null;
            clientManager.clearAllClients();
            disconnectionHandler.clearAllTimers();
            reject(error);
        });

        wss.on('close', () => {
            log('INFO', '[WebSocket] サーバーが閉じられました。');
            wss = null;
            clientManager.clearAllClients();
            disconnectionHandler.clearAllTimers();
        });
    });
}

/**
 * WebSocketサーバーを停止する
 * @returns {Promise<void>}
 */
async function stopWebSocket() {
    // (変更なし)
    if (!wss) {
        log('INFO', '[WebSocket] サーバーは起動していません。');
        return Promise.resolve();
    }
    log('INFO', '[WebSocket] WebSocketサーバーを停止します...');
    await disconnectionHandler.clearAllTimers();
    const clientsToClean = clientManager.getAllClients();
    log('DEBUG', `[WebSocket] ${clientsToClean.length} 個のクライアント接続をクリーンアップします...`);
    // await Promise.all(clientsToClean.map(clientInfo => disconnectionHandler.cleanupClient(clientInfo.clientId, true)));
    // ↑ cleanupClient が DB アクセスなど非同期処理を含む場合は Promise.all が有効
    // 現状は同期的処理が多いので for ループでも問題ない
    for (const clientInfo of clientsToClean) {
         await disconnectionHandler.cleanupClient(clientInfo.clientId, true);
    }
    clientManager.clearAllClients();

    return new Promise((resolve, reject) => {
        wss.close((err) => {
            if (err) {
                log('ERROR', '[WebSocket] サーバー停止中のエラー:', { error: err });
                reject(err);
            } else {
                log('INFO', '[WebSocket] サーバーが正常に停止しました。');
                wss = null;
                resolve();
            }
        });
    });
}

module.exports = {
    startWebSocket,
    stopWebSocket,
};