// commands/sws/sub_commands/utility/websocket_server.js

const { WebSocketServer } = require('ws');
const { log } = require('../../../../../utility/text_chat_logger');
const connectionHandler = require('./connection_handler'); // 接続ハンドラをインポート
const clientManager = require('./client_manager'); // クライアントマネージャーをインポート
const disconnectionHandler = require('./disconnection_handler'); // 切断ハンドラをインポート

// --- 状態管理 ---
let wss = null; // WebSocketサーバーインスタンス
let serverInstancesMap = null; // サーバーインスタンス管理Map (外部から設定)

/**
 * WebSocketサーバーを起動する
 * @param {number} port - サーバーを起動するポート番号
 * @param {Map<string, object>} instancesMap - サーバーインスタンス管理Map
 * @returns {Promise<void>}
 */
function startWebSocket(port, instancesMap) {
    if (wss) {
        log('WARN', '[WebSocket] Server is already running.');
        return Promise.resolve();
    }

    // 外部から渡された serverInstances Map を設定
    serverInstancesMap = instancesMap;
    // 依存モジュールに serverInstances Map を渡す (必要であれば)
    disconnectionHandler.setServerInstances(serverInstancesMap);
    // 他のモジュールも必要ならここで初期化・設定
    // connectionHandler.initialize(...) など

    log('INFO', `[WebSocket] Starting server on port ${port}...`);

    return new Promise((resolve, reject) => {
        wss = new WebSocketServer({ port });

        // 接続待機開始時のイベント
        wss.on('listening', () => {
            log('INFO', `[WebSocket] Server started and listening on port ${port}`);
            resolve();
        });

        // 新しい接続があった時のイベント
        wss.on('connection', (ws, req) => {
            // 接続処理を connection_handler に委譲
            connectionHandler.handleConnection(ws, req);
        });

        // サーバーエラー発生時のイベント
        wss.on('error', (error) => {
            log('ERROR', '[WebSocket] Server error:', { error });
            wss = null; // サーバーインスタンスをリセット
            clientManager.clearAllClients(); // クライアントリストをクリア
            disconnectionHandler.clearAllTimers(); // 切断タイマーもクリア
            reject(error); // Promiseをリジェクト
        });

        // サーバー停止時のイベント
        wss.on('close', () => {
            log('INFO', '[WebSocket] Server closed.');
            wss = null;
            // 念のためクリア
            clientManager.clearAllClients();
            disconnectionHandler.clearAllTimers();
        });
    });
}

/**
 * WebSocketサーバーを停止する
 * @returns {Promise<void>}
 */
async function stopWebSocket() { // async に変更
    if (!wss) {
        log('INFO', '[WebSocket] Server is not running.');
        return Promise.resolve();
    }

    log('INFO', '[WebSocket] Stopping server...');

    // 実行中の切断タイマーをすべてクリア
    await disconnectionHandler.clearAllTimers(); // await を追加 (async関数になった場合)

    // すべてのクライアント接続を即時クリーンアップ
    const clientsToClean = clientManager.getAllClients(); // Mapの値の配列を取得
    log('DEBUG', `[WebSocket] Cleaning up ${clientsToClean.length} clients...`);
    for (const clientInfo of clientsToClean) {
        // cleanupClient はクライアント削除も行うため、ループ内でリスト変更が起きないように注意
        // cleanupClient内で即時削除するように修正が必要
        await disconnectionHandler.cleanupClient(clientInfo.clientId, true); // immediate = true
    }
     // clientManagerからもクリア (cleanupClientで削除されるはずだが念のため)
     clientManager.clearAllClients();


    return new Promise((resolve, reject) => {
        wss.close((err) => {
            if (err) {
                log('ERROR', '[WebSocket] Error while closing server:', { error: err });
                reject(err); // エラーがあればreject
            } else {
                log('INFO', '[WebSocket] Server stopped successfully.');
                wss = null; // インスタンスをnullに設定
                resolve();
            }
        });
    });
}

module.exports = {
    startWebSocket,
    stopWebSocket,
    // 他のモジュールに serverInstances を渡すための関数 (任意)
    // getServerInstances: () => serverInstancesMap,
};