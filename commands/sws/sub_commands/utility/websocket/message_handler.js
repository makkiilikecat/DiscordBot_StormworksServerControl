// [ルート]/commands/sws/sub_commands/utility/websocket/message_handler.js

const clientManager = require('./client_manager');
const { requestPromises } = require('./message_sender');
const { log } = require('../../../../../utility/text_chat_logger');
const stateSynchronizer = require('./state_synchronizer');
const { EmbedBuilder } = require('discord.js'); // EmbedBuilder をインポート
const discordClient = require('../../../../../discord_client').getDiscordClient();

// serverInstances Map (外部から設定される想定)
let serverInstancesRef = null;
function setServerInstances(map) {
    serverInstancesRef = map;
    stateSynchronizer.setServerInstances(map); // stateSynchronizer にも設定
    log('DEBUG', '[ハンドラ] serverInstances Map への参照を設定しました。');
}

/**
 * クライアントから受信したメッセージを処理するハンドラ
 * @param {string} clientId - 送信元クライアントの内部ID
 * @param {Buffer} message - 受信したメッセージ (Buffer形式)
 */
async function handleMessage(clientId, message) {
    const clientInfo = clientManager.getClient(clientId);
    if (!clientInfo) {
        log('WARN', `[ハンドラ] 不明なクライアント (${clientId}) からメッセージを受信。無視します。`, { data: { clientId } });
        return;
    }

    const { token, ip, synced, ws } = clientInfo;
    const tokenEnding = `...${token.slice(-4)}`;

    try {
        const messageString = message.toString();
        const data = JSON.parse(messageString);

        log('DEBUG', `[ハンドラ] メッセージ受信 from Token=${tokenEnding} (Client: ${clientId}, IP: ${ip}):`, { data: data });

        // --- 状態同期処理 ---
        if (!synced && data.type === 'syncStatus') {
            clientInfo.synced = true;
            const goSideRunningServers = data.payload?.runningServers;
            if (Array.isArray(goSideRunningServers)) {
                await stateSynchronizer.synchronizeServerState(token, clientId, goSideRunningServers);
            } else {
                 log('WARN', `[ハンドラ] Token=${tokenEnding} からの syncStatus ペイロードが無効。`, { data: data.payload, clientId });
            }
            return;
        } else if (!synced) {
             log('WARN', `[ハンドラ] Token=${tokenEnding} から同期前にメッセージを受信: Type=${data.type}。接続切断。`, { data, clientId });
             ws.close(1002, "プロトコルエラー: 最初に syncStatus を送信してください。");
             return;
        }
        // --- 同期処理ここまで ---

        // --- 応答メッセージ処理 ---
        if (data.requestId && requestPromises.has(data.requestId)) {
            // (変更なし)
            const promiseInfo = requestPromises.get(data.requestId);
            if (promiseInfo.clientId !== clientId) {
                log('WARN', `[ハンドラ] RequestID ${data.requestId} は Client ${promiseInfo.clientId} 宛だが Client ${clientId} から応答。無視。`); return;
            }
            clearTimeout(promiseInfo.timeoutId);
            if (data.type === 'response') { log('DEBUG', `[ハンドラ] リクエスト ${data.requestId} への応答受信 from Token=${tokenEnding}`); promiseInfo.resolve(data.payload); }
            else if (data.type === 'error') { const msg = data.payload?.message || 'クライアントエラー'; log('ERROR', `[ハンドラ] リクエスト ${data.requestId} へのエラー応答 from Token=${tokenEnding}: ${msg}`, { data: data.payload }); promiseInfo.reject(new Error(msg)); }
            else { const msg = `予期しない応答タイプ '${data.type}' (ReqID: ${data.requestId})`; log('ERROR', `[ハンドラ] ${msg} from Token=${tokenEnding}`, { data }); promiseInfo.reject(new Error(msg)); }
            requestPromises.delete(data.requestId);
            log('DEBUG', `[ハンドラ] 処理済みリクエスト ${data.requestId} 削除。残り: ${requestPromises.size}件`);
            return;
        }
        // --- 応答処理ここまで ---

        // --- ★ Stage 5: サーバーイベント処理 (修正箇所) ---
        if (data.type === 'serverEvent') {
            const eventPayload = data.payload;
            const eventType = eventPayload?.eventType;
            const serverName = eventPayload?.serverName; // Go側から送られてくるサーバー構成名

            log('INFO', `[ハンドラ] サーバーイベント受信 from Token=${tokenEnding} (Client: ${clientId}): Type=${eventType}, Name=${serverName}`, { data: eventPayload });

            if (!serverName) {
                log('WARN', `[ハンドラ] serverEventにserverNameが含まれていません。処理をスキップ。`, { data: eventPayload });
                return;
            }

            // serverInstances から該当サーバーの情報を検索 (キーは serverName)
            const serverState = serverInstancesRef?.get(serverName);

            // ★★★ 修正点: status を問わず、serverState が存在し、トークンが一致すれば処理 ★★★
            if (!serverState || serverState.token !== token) {
                // Botが管理していないサーバーからのイベントか、トークンが不一致の場合
                // (同期処理で既に stopped になっている可能性は考慮する)
                log('WARN', `[ハンドラ] イベント対象サーバー "${serverName}" (Token=${tokenEnding}) がBot管理下にないか、トークン不一致。通知スキップ。`, {
                    data: {
                        serverInstancesRef: !!serverInstancesRef,
                        serverStateExists: !!serverState,
                        tokenMatch: serverState ? serverState.token === token : false,
                        currentStatus: serverState?.status
                    }
                });
                return;
            }
            // ★★★ ここまで修正 ★★★

            // --- クラッシュ通知関連の処理 ---
            if (eventType === 'serverCrashDetected') {
                // サーバー状態が 'running' でなくてもクラッシュ通知は試みる
                await handleCrashDetected(clientId, serverState, eventPayload, discordClient)
            } else if (eventType === 'serverRestartResult') {
                // サーバー状態が 'running' でなくても結果通知は試みる
                await handleRestartResult(clientId, serverState, eventPayload, discordClient)
            } else {
                log('WARN', `[ハンドラ] 未対応のサーバーイベントタイプ: ${eventType}`, { data: eventPayload });
            }
            return; // イベント処理完了
        }
        // --- イベント処理ここまで ---

        // どの処理にも該当しない場合
        if (!data.requestId) {
            log('WARN', `[ハンドラ] 未処理のメッセージタイプを受信 from Token=${tokenEnding} (Client: ${clientId}): ${data.type}`, { data: data });
        }

    } catch (error) {
        log('ERROR', `[ハンドラ] メッセージ処理中にエラー発生 from Token=${tokenEnding} (Client: ${clientId}, IP: ${ip}):`, {
            error: error,
            rawMessage: message.toString().substring(0, 200)
        });
    }
}

/**
 * クラッシュ検出イベントの処理 (修正: 返信で通知)
 * @param {string} clientId
 * @param {object} serverState - serverInstances内の該当サーバーの状態オブジェクト
 * @param {object} payload - イベントペイロード
 * @param {import('discord.js').Client} discordClient - Discordクライアントインスタンス
 */
async function handleCrashDetected(clientId, serverState, payload, discordClient) {
    // ★ crashNotificationMessageId も serverState から取得
    const { instanceName, startMessageId, startChannelId, startGuildId, token, crashNotificationMessageId } = serverState;
    const tokenEnding = `...${token.slice(-4)}`;
    log('WARN', `[ハンドラ][クラッシュ] サーバー "${instanceName}" (Token=${tokenEnding}) でクラッシュ検出。再起動試行中...`, { clientId, data: payload });

    // 通知に必要な基本情報 (チャンネルIDなど) があるかチェック
    if (startMessageId && startChannelId && startGuildId) {
        try {
            // --- チャンネル取得処理 (変更なし) ---
            let guild = discordClient?.guilds?.cache?.get(startGuildId);
            if (!guild) {
                log('WARN', `[ハンドラ][クラッシュ] Guild(ID:${startGuildId}) がキャッシュに見つかりません。fetchを試みます。`);
                guild = await discordClient.guilds.fetch(startGuildId).catch(() => null);
            }
            if (!guild) {
                log('ERROR', `[ハンドラ][クラッシュ] 指定されたGuild(ID:${startGuildId})が見つかりません。`, { instanceName });
                return;
            }
            const channel = guild.channels.cache.get(startChannelId);
            if (!channel || !channel.isTextBased()) {
                log('WARN', `[ハンドラ][クラッシュ] 通知対象チャンネル(ID:${startChannelId})が見つかりません。`, { instanceName });
                return;
            }
            // --- チャンネル取得ここまで ---

            // --- ★ 返信する対象のメッセージIDを決定 ---
            // 以前のクラッシュ通知があればそれに、なければ最初の起動メッセージに返信する
            const messageIdToReplyTo = crashNotificationMessageId || startMessageId;
            log('DEBUG', `[ハンドラ][クラッシュ] 返信対象のメッセージID: ${messageIdToReplyTo}`, { instanceName });

            // --- ★ 返信する対象のメッセージを取得 ---
            const messageToReplyTo = await channel.messages.fetch(messageIdToReplyTo).catch(() => null);

            if (messageToReplyTo) {
                // --- Embed作成処理 (変更なし) ---
                const { serverIdentifier } = await getServerIdentifiers(clientId, discordClient);
                const embed = new EmbedBuilder()
                    .setColor(0xFFA500) // オレンジ
                    .setTitle('💥 サーバークラッシュ検出')
                    .setDescription(`サーバー **${instanceName}** (${serverIdentifier}) で問題が検出されました。\n自動再起動を試みています...`)
                    .setTimestamp();
                // --- Embed作成ここまで ---

                // --- ★ 編集(edit)ではなく、返信(reply)で新しいメッセージを送信 ---
                try {
                    const newReplyMessage = await messageToReplyTo.reply({
                        content: '', // 必要に応じてメンションなどを追加できます
                        embeds: [embed],
                        components: [], // このメッセージにはボタンは不要
                        allowedMentions: { repliedUser: false } // 返信時に相手に通知を飛ばさない場合
                    });

                    // --- ★ 新しく送信した返信メッセージのIDを保存 ---
                    // これにより、次回のイベント (例: 再起動結果) はこの新しいメッセージに返信できる
                    serverState.crashNotificationMessageId = newReplyMessage.id;
                    log('INFO', `[ハンドラ][クラッシュ] ユーザーにクラッシュ検出通知を返信送信しました (新規メッセージID: ${newReplyMessage.id}, 返信先ID: ${messageIdToReplyTo})。`, { instanceName });

                } catch (replyError) {
                     log('ERROR', `[ハンドラ][クラッシュ] メッセージへの返信送信に失敗しました。`, { error: replyError, instanceName, messageIdToReplyTo });
                     // 返信に失敗した場合、crashNotificationMessageId は更新しない
                }

            } else {
                // 返信対象のメッセージが見つからない場合
                log('WARN', `[ハンドラ][クラッシュ] 返信対象メッセージ(ID:${messageIdToReplyTo})が見つかりません。通知スキップ。`, { instanceName });
            }
        } catch (error) {
            // tryブロック全体のエラー (チャンネル取得など)
            log('ERROR', `[ハンドラ][クラッシュ] クラッシュ通知処理中にエラーが発生しました。`, { error, instanceName, startMessageId });
        }
    } else {
        // startMessageId などが存在しない場合
        log('WARN', `[ハンドラ][クラッシュ] 通知に必要な情報(Message/Channel/Guild ID)が不足しています。通知スキップ。`, { instanceName });
    }
}

// handleRestartResult 関数も同様に、編集(edit)ではなく返信(reply)を使うように修正することを検討してください。
// そうすることで、クラッシュ→再起動成功/失敗 の流れが一連の返信として表示されます。

/**
 * 再起動結果イベントの処理 (修正)
 * @param {string} clientId
 * @param {object} serverState
 * @param {object} payload - イベントペイロード { success: boolean, message: string }
 */
async function handleRestartResult(clientId, serverState, payload, discordClient) {
    // ★ serverState からIDを取得
    const { instanceName, startMessageId, crashNotificationMessageId, token } = serverState;
    const { success, message } = payload;
    const tokenEnding = `...${token.slice(-4)}`;

    log('INFO', `[ハンドラ][再起動結果] サーバー "${instanceName}" (Token=${tokenEnding}) の再起動結果: ${success ? '成功' : '失敗'}`, { clientId, data: payload });

    // サーバー状態更新 (変更なし)
    if (success) {
        serverState.status = 'running';
        serverState.clientId = clientId;
        log('INFO', `[ハンドラ][再起動結果] サーバー "${instanceName}" の状態を 'running' に更新 (再起動成功)。`);
    } else {
        serverState.status = 'stopped';
        serverState.clientId = null;
        log('WARN', `[ハンドラ][再起動結果] サーバー "${instanceName}" の状態を 'stopped' に更新 (再起動失敗)。`);
    }

    // ★ 保存されたIDを使ってメッセージを編集
    const messageIdToEdit = crashNotificationMessageId || startMessageId;
    if (messageIdToEdit && serverState.startChannelId && serverState.startGuildId) {
        try {
            const guild = discordClient?.guilds?.cache?.get(serverState.startGuildId);
            if (!guild) {
                log('ERROR', `[ハンドラ][再起動結果] 指定されたGuild(ID:${serverState.startGuildId})が見つかりません。`, { instanceName });
                return;
            }

            const channel = guild.channels.cache.get(serverState.startChannelId);

            if (channel && channel.isTextBased()) {
                const messageToEdit = await channel.messages.fetch(messageIdToEdit).catch(() => null);
                if (messageToEdit) {
                    const { serverIdentifier } = await getServerIdentifiers(clientId, discordClient)

                    const embed = new EmbedBuilder()
                        .setColor(success ? 0x00FF00 : 0xFF0000)
                        .setTitle(success ? '✅ サーバー再起動完了' : '❌ サーバー再起動失敗')
                        .setDescription(success
                            ? `サーバー **${instanceName}** (${serverIdentifier}) の自動再起動が完了し、再び利用可能になりました。`
                            : `サーバー **${instanceName}** (${serverIdentifier}) の自動再起動に失敗しました。手動での対応が必要です。\n(詳細: ${message || '不明'})`
                        )
                         // 失敗時には、Botが把握している最終エラーも表示すると役立つかも
                         // .addFields(success ? [] : [{ name: '最終エラー(Bot)', value: serverState.lastError || 'N/A' }])
                        .setTimestamp();
                    await messageToEdit.edit({ content: '', embeds: [embed], components: [] }); // ボタンクリア
                    log('INFO', `[ハンドラ][再起動結果] ユーザーに再起動結果 (${success ? '成功' : '失敗'}) を通知しました (メッセージID: ${messageToEdit.id})。`, { instanceName });
                } else { log('WARN', `[ハンドラ][再起動結果] 通知対象メッセージ(ID:${messageIdToEdit})が見つかりません。`, { instanceName }); }
            } else { log('WARN', `[ハンドラ][再起動結果] 通知対象チャンネル(ID:${serverState.startChannelId})が見つかりません。`, { instanceName }); }
        } catch (error) { log('ERROR', `[ハンドラ][再起動結果] 再起動結果通知メッセージ編集失敗。`, { error, instanceName, messageIdToEdit }); }
    } else { log('WARN', `[ハンドラ][再起動結果] 通知に必要な情報(Message/Channel/Guild ID または Client)が不足。通知スキップ。`, { instanceName }); }

    // 使用済みの通知IDをクリア
    serverState.crashNotificationMessageId = null;
}

async function getServerIdentifiers(clientId, discordClient) {
    let serverIdentifier = `サーバー (ID: ${clientId?.substring(0, 8)}...)`;
    let logIp = '不明';
    let userName = '不明なユーザー';
    let clientInfoResult = null;

    try {
        const connectedServers = clientManager.getConnectedClients();
        clientInfoResult = connectedServers.find(c => c.clientId === clientId);

        if (clientInfoResult) {
            logIp = clientInfoResult.ip;
            const allClients = clientManager.getAllClients();
            const serverIndex = allClients.findIndex(c => c.clientId === clientId);

            try {
                const user = await discordClient.users?.fetch(clientInfoResult.creatorId).catch(() => null);
                if (user) {
                    userName = user.username;
                } else {
                        userName = `登録者ID:${clientInfoResult.creatorId.substring(0,6)}...`;
                }
            } catch (fetchError) {
                    log('WARN', `getServerIdentifiers内でユーザー(${clientInfoResult.creatorId})情報取得失敗`, { error: fetchError, clientId: clientId });
                    userName = `登録者ID:${clientInfoResult.creatorId.substring(0,6)}...`;
            }
         
            serverIdentifier = `${userName} のサーバー${serverIndex !== -1 ? ` ${serverIndex + 1}` : ''}`;
        } else {
            log('WARN', `getServerIdentifiers内でクライアントID ${clientId} が見つかりません。`, {clientId: clientId});
        }
    } catch (error) {
        log('ERROR', 'getServerIdentifiers でエラー発生', { error, clientId });
    }
    return { serverIdentifier, logIp };
}


module.exports = {
    handleMessage,
    setServerInstances,
};