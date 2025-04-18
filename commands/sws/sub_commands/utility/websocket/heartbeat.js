// commands/sws/sub_commands/utility/heartbeat.js

const clientManager = require('./client_manager'); // クライアント情報取得/更新用
const disconnectionHandler = require('./disconnection_handler'); // 切断処理用
const { log } = require('../../../../../utility/text_chat_logger'); // ロガー

// --- 定数 ---
const PING_INTERVAL = 30 * 1000; // Ping送信間隔 (30秒)
const PING_TIMEOUT = 10 * 1000;  // Pong応答待ちタイムアウト (10秒)

/**
 * 指定したクライアントへの定期的なPing送信を開始する
 * @param {string} clientId - Ping送信を開始するクライアントのID
 */
function startPingInterval(clientId) {
    const clientInfo = clientManager.getClient(clientId);
    if (!clientInfo) {
        log('WARN', `[Heartbeat] Ping開始対象のクライアントが見つかりません: ${clientId}`);
        return;
    }

    const { ws, physicalServerId } = clientInfo;

    // 既存のインターバルがあればクリア (念のため)
    if (clientInfo.pingIntervalId) {
        clearInterval(clientInfo.pingIntervalId);
        clientInfo.pingIntervalId = null;
    }
    if (clientInfo.pongTimeoutId) {
        clearTimeout(clientInfo.pongTimeoutId);
        clientInfo.pongTimeoutId = null;
    }

    log('DEBUG', `[Heartbeat] ${physicalServerId} (Client: ${clientId}) へのPing送信を開始します (Interval: ${PING_INTERVAL}ms, Timeout: ${PING_TIMEOUT}ms)`);

    // インターバルタイマーを設定
    clientInfo.pingIntervalId = setInterval(() => {
        // インターバル実行時に最新のクライアント情報を再取得
        const currentClientInfo = clientManager.getClient(clientId);
        if (!currentClientInfo || currentClientInfo.ws.readyState !== require('ws').WebSocket.OPEN) {
            log('WARN', `[Heartbeat] Ping送信時にクライアント ${clientId} (${physicalServerId}) が接続されていないため、インターバルを停止します。`);
            if(currentClientInfo?.pingIntervalId) clearInterval(currentClientInfo.pingIntervalId); // 自分自身をクリア
             // cleanupClient は ws.on('close') で呼ばれるはずだが、念のため呼ぶことも検討
            // disconnectionHandler.cleanupClient(clientId, false);
            return;
        }

        // 前回のPing応答がなかった場合 (isAliveフラグがfalseのまま)
        if (!currentClientInfo.isAlive) {
            log('WARN', `[Heartbeat] ${physicalServerId} (Client: ${clientId}) から時間内にPong応答がありませんでした。接続を終了します。`);
            // cleanupClientを呼び出して切断処理 (即時実行はしない)
            disconnectionHandler.cleanupClient(clientId, false);
            // このインターバルは cleanupClient 内でクリアされる想定だが、念のためここでもクリア
            if(currentClientInfo.pingIntervalId) clearInterval(currentClientInfo.pingIntervalId);
            return;
        }

        // isAliveフラグをfalseに設定し、Ping送信の準備
        currentClientInfo.isAlive = false;
        currentClientInfo.lastPingTime = Date.now(); // Ping送信時刻を記録

        try {
            // Pingを送信
            currentClientInfo.ws.ping((err) => {
                 if (err) {
                     // ping送信自体に失敗した場合もエラーログを出し、切断処理へ
                     log('ERROR', `[Heartbeat] ${physicalServerId} (Client: ${clientId}) へのPing送信に失敗しました。`, { error: err });
                     disconnectionHandler.cleanupClient(clientId, false);
                     if(currentClientInfo.pingIntervalId) clearInterval(currentClientInfo.pingIntervalId);
                 } else {
                     // log('DEBUG', `[Heartbeat] Ping sent to ${physicalServerId} (Client: ${clientId})`); // ログが多すぎる場合はコメントアウト
                 }
            });

            // Pong応答タイムアウトを設定
            // 既存のタイムアウトがあればクリア (念のため)
             if (currentClientInfo.pongTimeoutId) {
                clearTimeout(currentClientInfo.pongTimeoutId);
             }
            currentClientInfo.pongTimeoutId = setTimeout(() => {
                // タイムアウト発生時に isAlive が false のままなら、応答がなかったと判断
                const latestClientInfo = clientManager.getClient(clientId); //最新情報を取得
                if (latestClientInfo && !latestClientInfo.isAlive) {
                    log('WARN', `[Heartbeat] Pongタイムアウト: ${physicalServerId} (Client: ${clientId})。接続を終了します。`);
                    // cleanupClientを呼び出して切断処理 (即時実行はしない)
                    disconnectionHandler.cleanupClient(clientId, false);
                    if(latestClientInfo.pingIntervalId) clearInterval(latestClientInfo.pingIntervalId); // インターバルも停止
                }
                 // タイムアウト時に isAlive が true なら、既にPongが来て処理されているので何もしない
                 // タイマーIDは handlePong でクリアされるか、ここでタイムアウトしたら不要になる
                 if (latestClientInfo) latestClientInfo.pongTimeoutId = null;

            }, PING_TIMEOUT);

        } catch (error) {
            // ws.ping() 自体が例外を投げる可能性は低いが念のため
            log('ERROR', `[Heartbeat] Ping送信処理中に予期せぬエラー: ${physicalServerId} (Client: ${clientId})`, { error });
            disconnectionHandler.cleanupClient(clientId, false);
            if(currentClientInfo.pingIntervalId) clearInterval(currentClientInfo.pingIntervalId);
        }
    }, PING_INTERVAL);

    // 初回実行のために isAlive を true に設定
    clientInfo.isAlive = true;
}

/**
 * クライアントからのPong応答を処理する
 * @param {string} clientId - Pongを送信してきたクライアントのID
 */
function handlePong(clientId) {
    const clientInfo = clientManager.getClient(clientId);
    if (!clientInfo) {
        // log('DEBUG', `[Heartbeat] Pong受信時にクライアントが見つかりません: ${clientId}`); // 既に切断処理が走っている可能性
        return;
    }

    // 生存フラグを立てる
    clientInfo.isAlive = true;

    // Ping応答時間を計算して記録 (任意)
    if (clientInfo.lastPingTime) {
        clientInfo.ping = Date.now() - clientInfo.lastPingTime;
        // log('DEBUG', `[Heartbeat] Pong received from ${clientInfo.physicalServerId} (Client: ${clientId}). Ping: ${clientInfo.ping}ms`);
    }

    // Pong応答タイムアウトタイマーをクリア
    if (clientInfo.pongTimeoutId) {
        clearTimeout(clientInfo.pongTimeoutId);
        clientInfo.pongTimeoutId = null;
    }
}

module.exports = {
    startPingInterval,
    handlePong,
};