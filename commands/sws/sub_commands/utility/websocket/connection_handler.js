// [ルート]/commands/sws/sub_commands/utility/websocket/connection_handler.js

const { v4: uuidv4 } = require('uuid');
// 修正: token_manager のパス修正
const tokenManager = require('../token_manager'); // 認証用
const clientManager = require('./client_manager'); // クライアント管理
const messageHandler = require('./message_handler'); // メッセージ処理
const messageSender = require('./message_sender'); // メッセージ送信
const heartbeat = require('./heartbeat'); // Ping/Pong処理
const disconnectionHandler = require('./disconnection_handler'); // 切断処理
// 修正: text_chat_logger のパス修正
const { log } = require('../../../../../utility/text_chat_logger'); // ロガー

// 定数
const TOKEN_REJECTED_CODE = 1008; // Policy Violation

/**
 * WebSocket接続要求時の処理ハンドラ
 * @param {import('ws').WebSocket} ws - 接続してきたWebSocketクライアント
 * @param {import('http').IncomingMessage} req - 接続リクエスト情報
 */
async function handleConnection(ws, req) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '不明なIP';
    const connectionStartTime = Date.now();
    log('DEBUG', `[接続ハンドラ] 新規接続処理開始 from ${ip}`);

    // 1. 認証トークン取得
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

    if (!token) {
        log('WARN', `[接続ハンドラ] 認証トークンなし from ${ip}.`, { data: { ip } });
        ws.close(TOKEN_REJECTED_CODE, '認証が必要です。');
        return;
    }

    // 2. トークン検証 (成功なら creatorId, tokenData が返る)
    const validationResult = await tokenManager.validateToken(token);

    if (!validationResult.isValid) {
        log('WARN', `[接続ハンドラ] 無効なトークン from ${ip}. Token: ${token.substring(0, 8)}...`, { data: { ip } });
        ws.close(TOKEN_REJECTED_CODE, '無効なトークンです。');
        return;
    }

    // 認証成功
    const { creatorId, tokenData } = validationResult; // tokenData を取得
    // ★★★ 物理サーバーの識別子としてトークン自体を使用 ★★★
    const physicalServerId = token; // トークンを物理サーバーIDとする

    log('INFO', `[接続ハンドラ] 認証成功 from ${ip}. Token: ...${token.slice(-4)}, Creator: ${creatorId}`);

    // 3. 重複接続処理: 同じトークンでの既存接続を探す
    const existingClient = clientManager.findClientByToken(token); // ★ clientManager に findClientByToken が必要
    if (existingClient) {
        log('WARN', `[接続ハンドラ] 同じトークン (...${token.slice(-4)}) での既存接続が見つかりました (ClientID: ${existingClient.clientId})。古い接続を即時クリーンアップします。`, { data: { tokenEnding: `...${token.slice(-4)}`, ip, oldClientId: existingClient.clientId } });
        // 古い接続の cleanupClient を呼び出す (即時実行フラグ true)
        // cleanupClient は非同期の可能性があるため await する
        await disconnectionHandler.cleanupClient(existingClient.clientId, true);
        log('INFO', `[接続ハンドラ] 古い接続 (ClientID: ${existingClient.clientId}) をクリーンアップしました。`);
    }

    // 4. 新しいクライアントIDと情報を作成
    const newClientId = uuidv4(); // 接続ごとの一意な内部ID
    const clientInfo = {
        clientId: newClientId,
        physicalServerId: physicalServerId, // ★ 物理IDとしてトークンを保存
        token: token, // ★ トークン自体も保持
        ws: ws,
        ip: ip,
        creatorId: creatorId,
        tokenCreatedAt: tokenData?.createdAt, // ★ トークン作成日時も保持 (デバッグ用)
        lastPingTime: null,
        ping: null,
        isAlive: true,
        pingIntervalId: null,
        pongTimeoutId: null,
        synced: false, // ★ 同期フラグ
    };

    // 5. 切断タイマーがあれば解除 (トークンをキーにする)
    disconnectionHandler.clearDisconnectTimer(token); // ★ キーをトークンに変更

    // 6. クライアントを登録
    clientManager.addClient(clientInfo);

    // 7. イベントリスナーを設定
    ws.on('message', (message) => {
        // メッセージ処理を message_handler に委譲 (clientId を渡す)
        messageHandler.handleMessage(newClientId, message);
    });

    ws.on('close', (code, reason) => {
        // 切断処理を disconnection_handler に委譲 (clientId を渡す)
        log('DEBUG', `[接続ハンドラ] Closeイベント受信: ClientID=${newClientId}, Token=...${token.slice(-4)}, Code=${code}`);
        disconnectionHandler.cleanupClient(newClientId, false); // immediate = false
    });

    ws.on('error', (error) => {
        log('ERROR', `[接続ハンドラ] Errorイベント受信: ClientID=${newClientId}, Token=...${token.slice(-4)}`, { error });
        // エラー時も切断処理を実行 (clientId を渡す)
        disconnectionHandler.cleanupClient(newClientId, false); // immediate = false
    });

    ws.on('pong', () => {
        // Pong処理を heartbeat モジュールに委譲 (clientId を渡す)
        heartbeat.handlePong(newClientId);
    });

    // 8. 接続成功をクライアントに通知 (clientId と token を通知)
    messageSender.sendToClient(newClientId, {
        type: 'connected',
        payload: { clientId: newClientId, tokenIdentifier: `...${token.slice(-4)}` } // トークン全体ではなく末尾のみ通知
    });

    // 9. Ping送信を開始 (clientId を渡す)
    heartbeat.startPingInterval(newClientId);

    // --- Stage 3: Goクライアントからの syncStatus を待機 ---
    // 最初のメッセージ処理は message_handler で行う
    log('INFO', `[接続ハンドラ] クライアント接続完了: ClientID=${newClientId}, Token=...${token.slice(-4)}。同期メッセージ待機中... (処理時間: ${Date.now() - connectionStartTime}ms)`);
}

module.exports = {
    handleConnection,
};