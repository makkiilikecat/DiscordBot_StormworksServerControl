// [ルート]/commands/sws/sub_commands/utility/websocket/state_synchronizer.js

// 修正: text_chat_logger のパス修正
const { log } = require('../../../../../utility/text_chat_logger');
const clientManager = require('./client_manager');
const serverUtils = require('../server_utils');

// serverInstances Map (外部から設定される想定)
let serverInstancesRef = null; // 外部Mapへの参照を保持
function setServerInstances(map) {
    serverInstancesRef = map;
    log('DEBUG', '[同期] serverInstances Map への参照を設定しました。');
}

/**
 * ボットの状態とGoクライアントの状態を同期する
 * @param {string} token - 接続に使用されたトークン (物理サーバー識別子)
 * @param {string} clientId - 現在の接続クライアントID
 * @param {string[]} goSideRunningServers - Goクライアントから送られてきた起動中サーバー名のリスト
 */
async function synchronizeServerState(token, clientId, goSideRunningServers) {
    const tokenEnding = `...${token.slice(-4)}`;
    if (!serverInstancesRef) {
        log('ERROR', '[同期] serverInstances Map が利用できません。同期スキップ。', { tokenEnding, clientId });
        return;
    }

    const clientInfo = clientManager.getClient(clientId);
    if (!clientInfo) {
        log('WARN', `[同期] 同期処理中にクライアント情報が見つかりません: ClientID=${clientId}`, { tokenEnding });
        return;
    }
    const { ip, creatorId } = clientInfo;

    log('INFO', `[同期] 状態同期開始: Token=${tokenEnding}, ClientID=${clientId}。Go側リスト: [${goSideRunningServers.join(', ')}]`, { tokenEnding, clientId });

    // このトークンで起動中とBotが認識しているサーバーリストを取得
    const botSideRunningServersMap = new Map();
    for (const [instanceName, instanceState] of serverInstancesRef.entries()) {
        if (instanceState.token === token && instanceState.status === 'running') {
            botSideRunningServersMap.set(instanceName, instanceState);
        }
    }
    const botSideRunningServers = Array.from(botSideRunningServersMap.keys());

    // ★ 初回同期かどうかの判定を修正（Bot側にこのトークンでの実行中情報がない場合を初回とする）
    const isFirstSync = botSideRunningServersMap.size === 0;

    if (isFirstSync) {
        log('INFO', `[同期] 初回同期またはBot再起動後同期: Token=${tokenEnding}`, { tokenEnding, clientId });
        // ボット側の既存情報をクリア (同じトークンに紐づく「停止済み」情報も念のためクリアするか検討)
        // ここでは、実行中の情報がなければ、Go側の情報で完全に上書きする方針を維持
        for (const [name, state] of serverInstancesRef.entries()) {
            if (state.token === token) {
                log('DEBUG', `[同期] 初回同期のため、Bot側の既存インスタンス "${name}" (状態: ${state.status}) を削除します。`, { tokenEnding, serverName: name });
                serverInstancesRef.delete(name);
            }
        }
        // Go側のリストに基づいて serverInstances を登録
        for (const serverName of goSideRunningServers) {
            // ★ 既存情報（再起動前など）があればそれを参照しようと試みる（現状はほぼ意味がない）
            const existingState = serverInstancesRef?.get(serverName);

            const newState = {
                clientId: clientId,
                token: token,
                ip: ip,
                creatorId: creatorId,
                status: 'running',
                instanceName: serverName,
                startedAt: new Date().toISOString(),
                // ★ 既存情報を引き継ぐ試み (現状はほぼnullになる)
                startMessageId: existingState?.startMessageId || null,
                crashNotificationMessageId: existingState?.crashNotificationMessageId || null,
            };
            serverInstancesRef.set(serverName, newState);
            log('INFO', `[同期] サーバー "${serverName}" を実行中として登録 (初回同期)。Token=${tokenEnding}`, { tokenEnding, clientId, serverName });
        }
    } else {
        // --- 再接続時の同期処理 ---
        log('INFO', `[同期] 再接続同期: Token=${tokenEnding}。 Bot側リスト: [${botSideRunningServers.join(', ')}]`, { tokenEnding, clientId });
        const goSet = new Set(goSideRunningServers);
        const botSet = new Set(botSideRunningServers);

        // 1. ボット側にあってGo側にないサーバー -> 状態更新 (startMessageId等は保持)
        const serversToUpdateInBot = botSideRunningServers.filter(name => !goSet.has(name));
        if (serversToUpdateInBot.length > 0) {
            log('WARN', `[同期] Bot側のみ実行中サーバー: [${serversToUpdateInBot.join(', ')}]。状態を 'stopped' に更新。Token=${tokenEnding}`, { tokenEnding, clientId, serversToUpdateInBot });
            for (const serverName of serversToUpdateInBot) {
                const state = serverInstancesRef.get(serverName);
                if (state && state.token === token) {
                     // ★ statusとclientIdのみ更新、他は保持
                     state.status = 'stopped';
                     state.clientId = null;
                     log('INFO', `[同期] サーバー "${serverName}" 状態を 'stopped' に更新 (Go側未実行)。Token=${tokenEnding}`, { serverName, tokenEnding });
                }
            }
        }

        // 2. Go側にあってボット側にないサーバー -> 自動調整 (変更なし)
        const serversToStopInGo = goSideRunningServers.filter(name => !botSet.has(name));
        if (serversToStopInGo.length > 0) {
            log('WARN', `[同期][自動調整] Go側のみ実行中サーバー: [${serversToStopInGo.join(', ')}]。停止要求送信。Token=${tokenEnding}`, { tokenEnding, clientId, serversToStopInGo });
            for (const serverName of serversToStopInGo) {
                try {
                    await serverUtils.stopServer(clientId, serverName, true);
                } catch (stopError) { log('ERROR', `[同期][自動調整] サーバー "${serverName}" 自動停止エラー`, { error: stopError, serverName, tokenEnding, clientId }); }
            }
        }

        // 3. Go側で実行中のサーバーの情報を更新 (startMessageId等は保持)
        for (const serverName of goSideRunningServers) {
             const state = serverInstancesRef.get(serverName);
             if (state && state.token === token) {
                 // ★ clientId と status のみ更新。既存の startMessageId 等は変更しない。
                 let updated = false;
                 if (state.clientId !== clientId) {
                     state.clientId = clientId;
                     updated = true;
                 }
                 if (state.status !== 'running') {
                     state.status = 'running'; // 再接続なので 'running' に戻す
                     updated = true;
                 }
                 if (updated) {
                      log('DEBUG', `[同期] サーバー "${serverName}" の情報(clientId/status)を更新しました。`, { serverName, tokenEnding });
                 }
             } else if (!state && goSet.has(serverName)) {
                  // Bot側にない場合 (自動調整で停止されるはず)
                  log('WARN', `[同期] Go側実行中サーバー "${serverName}" がBot側に見つかりません (自動調整対象)。Token=${tokenEnding}`, { serverName, tokenEnding, clientId });
             }
        }
    }
    log('INFO', `[同期] 状態同期完了: Token=${tokenEnding}, ClientID=${clientId}`, { tokenEnding, clientId });
}

module.exports = {
    synchronizeServerState,
    setServerInstances,
};