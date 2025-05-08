// [ルート]/commands/sws/sub_commands/utility/websocket/message_handler.js

// 必要なモジュールをインポート
const clientManager = require('./client_manager'); // 接続クライアント情報管理
const { requestPromises } = require('./message_sender'); // 保留中のリクエスト情報 (Promiseなど)
const { log } = require('../../../../../utility/text_chat_logger'); // ログ出力ユーティリティ
const stateSynchronizer = require('./state_synchronizer'); // サーバー状態同期ロジック
const { EmbedBuilder } = require('discord.js'); // Discord Embed作成用
const discordClient = require('../../../../../discord_client').getDiscordClient(); // Discordクライアントインスタンス取得

// 外部から serverInstances Map (ボット全体のサーバー状態) を参照するための変数
let serverInstancesRef = null;
/**
 * 外部の serverInstances Map への参照を設定する関数
 * @param {Map<string, object>} map - サーバーインスタンス管理Map
 */
function setServerInstances(map) {
    serverInstancesRef = map;
    // stateSynchronizer にも Map を渡す
    stateSynchronizer.setServerInstances(map);
    log('DEBUG', '[ハンドラ] serverInstances Map への参照を設定しました。');
}

/**
 * Discordメッセージを編集するヘルパー関数
 * @param {object} context - Discordメッセージのコンテキスト { messageId, channelId, guildId }
 * @param {object} options - discord.js の message.edit() に渡す編集内容オプション
 */
async function editDiscordMessage(context, options) {
    // コンテキスト情報が不足している場合は警告ログを出して終了
    if (!context || !context.channelId || !context.messageId) {
        log('WARN', '[ハンドラ][編集] Discordメッセージコンテキストが無効です。編集スキップ。', { context });
        return;
    }
    try {
        // チャンネルオブジェクトを取得
        const channel = await discordClient.channels.fetch(context.channelId);
        if (!channel || !channel.isTextBased()) {
            log('WARN', `[ハンドラ][編集] メッセージ編集用のチャンネルが見つからないか、テキストベースではありません: ${context.channelId}`, { context });
            return;
        }
        // メッセージオブジェクトを取得
        const messageToEdit = await channel.messages.fetch(context.messageId);
        if (messageToEdit) {
            // メッセージを編集
            await messageToEdit.edit(options);
            log('DEBUG', `[ハンドラ][編集] メッセージ (ID: ${context.messageId}) を編集しました。`, { options });
        } else {
            // メッセージが見つからない場合は警告
            log('WARN', `[ハンドラ][編集] 編集対象のメッセージ (ID: ${context.messageId}) が見つかりません。`, { context });
        }
    } catch (error) {
        // 編集中のエラー（権限不足、メッセージ削除済みなど）
        log('ERROR', `[ハンドラ][編集] Discordメッセージ編集中にエラーが発生しました。`, { error, context, options });
        // 必要に応じてエラーを再スロー
    }
}


/**
 * Goクライアントから受信したWebSocketメッセージを処理するメイン関数
 * @param {string} clientId - 送信元クライアントの内部ID
 * @param {Buffer} message - 受信したメッセージ (Buffer形式)
 */
async function handleMessage(clientId, message) {
    // クライアント情報を取得
    const clientInfo = clientManager.getClient(clientId);
    // 不明なクライアントからのメッセージは無視
    if (!clientInfo) {
        log('WARN', `[ハンドラ] 不明なクライアント (${clientId}) からメッセージを受信。無視します。`, { data: { clientId } });
        return;
    }

    // ログ出力用にクライアント情報を取得
    const { token, ip, synced, ws } = clientInfo;
    const tokenEnding = `...${token.slice(-4)}`; // ログで見やすいようにトークン末尾のみ

    try {
        // 受信メッセージを文字列化し、JSONとしてパース
        const messageString = message.toString();
        const data = JSON.parse(messageString);

        // 受信ログ (デバッグ用)
        log('DEBUG', `[ハンドラ] メッセージ受信 from Token=${tokenEnding} (Client: ${clientId}, IP: ${ip}):`, { data: data });

        // --- 1. 状態同期 (syncStatus) 処理 ---
        // クライアントがまだ同期済みでない場合、最初のメッセージは 'syncStatus' である必要がある
        if (!synced && data.type === 'syncStatus') {
            clientInfo.synced = true; // 同期済みフラグを立てる
            const goSideRunningServers = data.payload?.runningServers;
            const maxServersFromGo = data.payload?.maxServers

            // ペイロードにサーバーリストが含まれていれば同期処理を実行
            if (Array.isArray(goSideRunningServers)) {
                await stateSynchronizer.synchronizeServerState(token, clientId, goSideRunningServers, maxServersFromGo);
            } else {
                 // 不正なペイロードの場合は警告
                 log('WARN', `[ハンドラ] Token=${tokenEnding} からの syncStatus ペイロードが無効。`, { data: data.payload, clientId });
            }
            return; // 同期処理完了
        } else if (!synced) {
             // 同期前に 'syncStatus' 以外のメッセージを受信した場合、プロトコルエラーとして接続を切断
             log('WARN', `[ハンドラ] Token=${tokenEnding} から同期前にメッセージを受信: Type=${data.type}。接続切断。`, { data, clientId });
             ws.close(1002, "プロトコルエラー: 最初に syncStatus を送信してください。");
             return;
        }
        // --- 同期処理ここまで ---

        // --- 2. 進捗更新 (statusUpdate) 処理 ---
        // 'syncStatus' 処理の後、かつ最終応答処理の前に配置
        else if (data.type === 'statusUpdate') {
            const statusPayload = data.payload;
            const statusMessage = statusPayload?.message || '進捗情報受信'; // ペイロード内のメッセージを取得
            const requestId = data.requestId; // 紐づく元のリクエストIDを取得

            // 進捗ログを出力
            log('INFO', `[ハンドラ][進捗] Status Update from Token=${tokenEnding} (ReqID: ${requestId || 'N/A'}): ${statusMessage}`, {
                clientId: clientId,
                payload: statusPayload
            });

            // requestId が存在すれば、対応するDiscordメッセージの編集を試みる
            if (requestId) {
                const promiseInfo = requestPromises.get(requestId); // 保留中のリクエスト情報を取得
                // リクエスト情報とDiscordコンテキストが存在する場合のみ編集
                if (promiseInfo && promiseInfo.discordContext) {
                    // メッセージの内容を進捗メッセージで更新 (シンプルなテキスト更新例)
                    await editDiscordMessage(promiseInfo.discordContext, {
                        content: `⏳ ${statusMessage}` // 例: 「⏳ ワークショップアイテム 3/5 ダウンロード中...」
                        // embeds: [], // Embedを使う場合はここで作成・指定
                        // components: [] // 通常、進捗表示中はボタンなどは削除
                    });
                } else {
                    // 関連するリクエストやコンテキストが見つからない場合
                    log('WARN', `[ハンドラ][進捗] statusUpdate の requestId (${requestId}) に対応するコンテキストが見つかりません。メッセージ編集スキップ。`);
                }
            }
            // statusUpdate は中間報告なので、requestPromises からエントリは削除しない
            return; // 進捗処理完了
        }

        // --- 3. 最終応答/エラー (response/error) 処理 ---
        // requestId があり、それが保留中のリクエストリストに存在する場合
        else if (data.requestId && requestPromises.has(data.requestId)) {
            const promiseInfo = requestPromises.get(data.requestId);
            // 応答処理に必要な情報を promiseInfo から取得
            const { resolve, reject, timeoutId, clientId: targetClientId, requestType, instanceName, discordContext } = promiseInfo;
            // 応答元のクライアントIDが、リクエスト送信先のクライアントIDと一致するか確認
            if (targetClientId !== clientId) {
                log('WARN', `[ハンドラ] RequestID ${data.requestId} は Client ${targetClientId} 宛だが Client ${clientId} から応答。無視。`);
                return; // 不一致なら無視
            }

            // 応答があったのでタイムアウト処理をクリア
            clearTimeout(timeoutId);

            let finalEmbed = null; // Discordに表示する最終Embed
            let finalContent = ''; // Discordメッセージのテキスト部分 (通常クリア)

            try {
                // 3a. 正常応答の場合 (`type: 'response'` かつ `payload.success: true`)
                if (data.type === 'response' && data.payload?.success) {
                    log('DEBUG', `[ハンドラ] リクエスト ${data.requestId} (${requestType}) への成功応答受信 from Token=${tokenEnding}`);

                    // --- ボット側のサーバー状態 (serverInstances) を更新 ---
                    if (instanceName && serverInstancesRef.has(instanceName)) {
                        const serverState = serverInstancesRef.get(instanceName);
                        // 元のリクエストタイプに応じて状態を更新
                        if (requestType === 'startServer') {
                            if (serverState.status !== 'running') {
                                serverState.status = 'running'; // 起動成功 -> running
                                log('INFO', `[ハンドラ][応答] サーバー "${instanceName}" の状態を 'running' に更新 (${requestType}成功)。`);
                            }
                        } else if (requestType === 'stopServer') {
                            if (serverState.status !== 'stopped') {
                                serverState.status = 'stopped'; // 停止成功 -> stopped
                                // serverInstancesRef.delete(instanceName); // または削除
                                log('INFO', `[ハンドラ][応答] サーバー "${instanceName}" の状態を 'stopped' に更新 (${requestType}成功)。`);
                            }
                        }
                        // 必要であれば他の情報も更新 (例: ポート番号)
                        if (data.payload?.assignedPort !== undefined) {
                            serverState.port = data.payload.assignedPort;
                        }

                    } else if (instanceName) {
                        log('WARN', `[ハンドラ][応答] 成功応答ですがインスタンス "${instanceName}" が見つかりません。状態更新スキップ。`, { requestType });
                    } else {
                         log('WARN', `[ハンドラ][応答] 成功応答ペイロードにインスタンス名がありません。状態更新スキップ。`, { requestType, payload: data.payload });
                    }
                    // --- 状態更新ここまで ---

                    // --- Discordメッセージ用Embed作成 (成功) ---
                    finalEmbed = new EmbedBuilder().setTimestamp(); // 基本Embed作成
                    const responseMessage = data.payload?.message || '操作が正常に完了しました。';

                    // リクエストタイプに応じてEmbedの内容を調整
                    if (requestType === 'startServer') {
                        finalEmbed.setColor(0x00FF00).setTitle('🚀 サーバー起動完了');
                        finalEmbed.setDescription(responseMessage);
                         // Goクライアントから物理サーバー名を取得する方法があれば追加
                        // const { serverIdentifier } = await getPhysicalServerIdentifier(discordClient, clientId, token);
                        finalEmbed.addFields({ name: '構成名', value: instanceName || '?', inline: true });
                        if (typeof data.payload.assignedPort === 'number') {
                            finalEmbed.addFields({ name: '割り当てポート', value: String(data.payload.assignedPort), inline: true });
                        }
                        const failedItems = data.payload.failedItemIDs || [];
                        if (failedItems.length > 0) {
                            finalEmbed.setColor(0xFFCC00); // 警告色
                            finalEmbed.addFields({
                                name: `⚠️ ワークショップアイテムのエラー (${failedItems.length}件)`,
                                value: `ダウンロード/更新に失敗:\n\`\`\`${failedItems.slice(0, 10).join('\n')}${failedItems.length > 10 ? '\n...' : ''}\`\`\``,
                                inline: false
                            });
                        }
                    } else if (requestType === 'stopServer') {
                        finalEmbed.setColor(0x00FF00).setTitle('✅ サーバー停止完了');
                        finalEmbed.setDescription(responseMessage);
                        finalEmbed.addFields(
                            { name: '構成名', value: instanceName || '?', inline: true },
                            { name: '設定ファイルの保存', value: data.payload?.savedConfig ? '成功' : 'なし/失敗', inline: true }
                         );
                    } else {
                        // その他のリクエストタイプ（もしあれば）
                         finalEmbed.setColor(0x00FF00).setTitle('✅ 処理完了');
                         finalEmbed.setDescription(responseMessage);
                    }
                    // --- Embed作成ここまで ---

                    resolve(data.payload); // 元の処理を呼び出した箇所にペイロードを返す

                // 3b. エラー応答または失敗応答の場合 (`type: 'error'` または `payload.success: false`)
                } else {
                    const errorMsg = data.payload?.message || (data.type === 'error' ? 'クライアントエラー' : '操作失敗');
                    log('ERROR', `[ハンドラ] リクエスト ${data.requestId} (${requestType}) への失敗/エラー応答 from Token=${tokenEnding}: ${errorMsg}`, { data: data.payload });

                    // --- 状態更新 (エラー時) ---
                    if (instanceName && serverInstancesRef.has(instanceName)) {
                        const serverState = serverInstancesRef.get(instanceName);
                        // 起動試行中のエラーであれば、状態を stopped に戻す
                        if (requestType === 'startServer' && serverState.status === 'starting') {
                             serverState.status = 'stopped';
                             log('INFO', `[ハンドラ][応答] サーバー "${instanceName}" の状態を 'stopped' に更新 (${requestType}失敗)。`);
                        }
                        // 停止失敗時は、状態を 'running' のままにするのが一般的
                    } else if (instanceName) {
                         log('WARN', `[ハンドラ][応答] 失敗応答ですがインスタンス "${instanceName}" が見つかりません。状態更新スキップ。`, { requestType });
                    } else {
                         log('WARN', `[ハンドラ][応答] 失敗応答ペイロードにインスタンス名がありません。状態更新スキップ。`, { requestType, payload: data.payload });
                    }
                    // --- 状態更新ここまで ---

                    // --- Discordメッセージ用Embed作成 (失敗) ---
                    finalEmbed = new EmbedBuilder()
                        .setColor(0xFF0000) // 赤
                        .setTitle('❌ 処理失敗')
                        .setDescription(errorMsg)
                        .setTimestamp();
                    if (instanceName) finalEmbed.addFields({ name: '対象構成', value: instanceName, inline: true });
                    finalEmbed.addFields({ name: '確認事項', value: '詳細はログスレッドを確認してください。' });
                    // --- Embed作成ここまで ---

                    reject(new Error(errorMsg)); // 元の処理を呼び出した箇所にエラーを投げる
                }

                // --- Discordメッセージを最終結果で編集 ---
                if (discordContext && finalEmbed) {
                    await editDiscordMessage(discordContext, { content: finalContent, embeds: [finalEmbed], components: [] });
                } else if (discordContext) {
                     // Embed がなくても content はクリアするなど
                    await editDiscordMessage(discordContext, { content: finalContent, embeds: [], components: [] });
                }

            } catch (e) {
                 // この try ブロック内 (状態更新やEmbed作成、Promise解決/拒否) でのエラー
                 log('ERROR', `[ハンドラ] 応答処理/メッセージ編集中に内部エラー発生 (ReqID: ${data.requestId})`, { error: e });
                 // エラーが発生しても finally で requestPromises からは削除される
                 // 必要ならここで reject を呼ぶ (ただし、既に resolve/reject されている可能性もある)
                 if (data.type !== 'response' && data.type !== 'error') { // 予期せぬタイプでエラーなら reject
                    reject(e);
                 }
            } finally {
                // ★★★ 正常・異常に関わらず、最終応答処理が終わったら必ず Map から削除 ★★★
                requestPromises.delete(data.requestId);
                log('DEBUG', `[ハンドラ] 処理済みリクエスト ${data.requestId} を削除。残り: ${requestPromises.size}件`);
            }
            return; // 応答/エラー処理完了
        }
        // ★★★ 応答/エラー処理 修正ここまで ★★★

        // --- 4. サーバーイベント (serverEvent) 処理 ---
        else if (data.type === 'serverEvent') {
            // (実装は変更なし)
            const eventPayload = data.payload;
            const eventType = eventPayload?.eventType;
            const serverName = eventPayload?.serverName;
            log('INFO', `[ハンドラ] サーバーイベント受信 from Token=${tokenEnding} (Client: ${clientId}): Type=${eventType}, Name=${serverName}`, { data: eventPayload });
            if (!serverName) { /* ... */ return; }
            const serverState = serverInstancesRef?.get(serverName);
            if (!serverState || serverState.token !== token) { /* ... */ return; }
            if (eventType === 'serverCrashDetected') {
                await handleCrashDetected(clientId, serverState, eventPayload, discordClient);
            } else if (eventType === 'serverRestartResult') {
                await handleRestartResult(clientId, serverState, eventPayload, discordClient);
            } else {
                log('WARN', `[ハンドラ] 未対応のサーバーイベントタイプ: ${eventType}`, { data: eventPayload });
            }
            return; // イベント処理完了
        }
        // --- イベント処理ここまで ---

        // --- 5. その他の未処理メッセージ ---
        // requestId がなく、上記いずれのタイプでもないメッセージ
        if (!data.requestId) {
            log('WARN', `[ハンドラ] 未処理のメッセージタイプを受信 from Token=${tokenEnding} (Client: ${clientId}): ${data.type}`, { data: data });
        }

    } catch (error) {
        // メッセージのパース失敗など、tryブロック全体でのエラー
        log('ERROR', `[ハンドラ] メッセージ処理中に致命的なエラー発生 from Token=${tokenEnding} (Client: ${clientId}, IP: ${ip}):`, {
            error: error,
            rawMessage: message.toString().substring(0, 200) // エラー時は生メッセージも記録
        });
    }
}

// --- handleCrashDetected, handleRestartResult, getPhysicalServerIdentifier 関数 (変更なし) ---
// 必要であれば getPhysicalServerIdentifier は start.js などと共通化する

/**
 * クラッシュ検出イベントの処理
 * @param {string} clientId
 * @param {object} serverState
 * @param {object} payload
 * @param {import('discord.js').Client} discordClient
 */
async function handleCrashDetected(clientId, serverState, payload, discordClient) {
    const { instanceName, startMessageId, startChannelId, startGuildId, token, crashNotificationMessageId } = serverState;
    const tokenEnding = `...${token.slice(-4)}`;
    log('WARN', `[ハンドラ][クラッシュ] サーバー "${instanceName}" (Token=${tokenEnding}) でクラッシュ検出。再起動試行中...`, { clientId, data: payload });

    if (startMessageId && startChannelId && startGuildId) {
        try {
            let guild = discordClient?.guilds?.cache?.get(startGuildId);
            if (!guild) guild = await discordClient.guilds.fetch(startGuildId).catch(() => null);
            if (!guild) { log('ERROR', `[ハンドラ][クラッシュ] Guild(ID:${startGuildId})が見つかりません。`, { instanceName }); return; }
            const channel = guild.channels.cache.get(startChannelId);
            if (!channel || !channel.isTextBased()) { log('WARN', `[ハンドラ][クラッシュ] 通知対象チャンネル(ID:${startChannelId})が見つかりません。`, { instanceName }); return; }

            const messageIdToReplyTo = crashNotificationMessageId || startMessageId;
            log('DEBUG', `[ハンドラ][クラッシュ] 返信対象のメッセージID: ${messageIdToReplyTo}`, { instanceName });
            const messageToReplyTo = await channel.messages.fetch(messageIdToReplyTo).catch(() => null);

            if (messageToReplyTo) {
                const { serverIdentifier } = await getPhysicalServerIdentifier(discordClient, clientId, token); // ★ discordClient を渡す
                const embed = new EmbedBuilder()
                    .setColor(0xFFA500)
                    .setTitle('💥 サーバークラッシュ検出')
                    .setDescription(`サーバー **${instanceName}** (${serverIdentifier}) で問題が検出されました。\n自動再起動を試みています...`)
                    .setTimestamp();

                try {
                    const newReplyMessage = await messageToReplyTo.reply({
                        embeds: [embed],
                        components: [],
                        allowedMentions: { repliedUser: false }
                    });
                    serverState.crashNotificationMessageId = newReplyMessage.id;
                    log('INFO', `[ハンドラ][クラッシュ] ユーザーにクラッシュ検出通知を返信送信しました (新規メッセージID: ${newReplyMessage.id}, 返信先ID: ${messageIdToReplyTo})。`, { instanceName });
                } catch (replyError) {
                     log('ERROR', `[ハンドラ][クラッシュ] メッセージへの返信送信に失敗しました。`, { error: replyError, instanceName, messageIdToReplyTo });
                }
            } else {
                log('WARN', `[ハンドラ][クラッシュ] 返信対象メッセージ(ID:${messageIdToReplyTo})が見つかりません。通知スキップ。`, { instanceName });
            }
        } catch (error) {
            log('ERROR', `[ハンドラ][クラッシュ] クラッシュ通知処理中にエラーが発生しました。`, { error, instanceName, startMessageId });
        }
    } else {
        log('WARN', `[ハンドラ][クラッシュ] 通知に必要な情報(Message/Channel/Guild ID)が不足しています。通知スキップ。`, { instanceName });
    }
}

/**
 * 再起動結果イベントの処理
 * @param {string} clientId
 * @param {object} serverState
 * @param {object} payload - { success: boolean, message: string }
 * @param {import('discord.js').Client} discordClient
 */
async function handleRestartResult(clientId, serverState, payload, discordClient) {
    const { instanceName, startMessageId, crashNotificationMessageId, token } = serverState;
    const { success, message } = payload;
    const tokenEnding = `...${token.slice(-4)}`;
    log('INFO', `[ハンドラ][再起動結果] サーバー "${instanceName}" (Token=${tokenEnding}) の再起動結果: ${success ? '成功' : '失敗'}`, { clientId, data: payload });

    // サーバー状態更新
    if (success) {
        serverState.status = 'running'; // ★ 成功時は running に
        serverState.clientId = clientId; // 接続IDも更新
        log('INFO', `[ハンドラ][再起動結果] サーバー "${instanceName}" の状態を 'running' に更新 (再起動成功)。`);
    } else {
        serverState.status = 'stopped'; // ★ 失敗時は stopped に
        serverState.clientId = null;
        log('WARN', `[ハンドラ][再起動結果] サーバー "${instanceName}" の状態を 'stopped' に更新 (再起動失敗)。`);
    }

    // Discordメッセージ編集
    const messageIdToEdit = crashNotificationMessageId || startMessageId; // クラッシュ通知があればそれを編集
    if (messageIdToEdit && serverState.startChannelId && serverState.startGuildId) {
        try {
            const guild = discordClient?.guilds?.cache?.get(serverState.startGuildId);
            if (!guild) { log('ERROR', `[ハンドラ][再起動結果] Guild(ID:${serverState.startGuildId})が見つかりません。`, { instanceName }); return; }
            const channel = guild.channels.cache.get(serverState.startChannelId);
            if (channel && channel.isTextBased()) {
                const messageToEditObj = await channel.messages.fetch(messageIdToEdit).catch(() => null);
                if (messageToEditObj) {
                    const { serverIdentifier } = await getPhysicalServerIdentifier(discordClient, clientId, token); // ★ discordClient を渡す
                    const embed = new EmbedBuilder()
                        .setColor(success ? 0x00FF00 : 0xFF0000)
                        .setTitle(success ? '✅ サーバー再起動完了' : '❌ サーバー再起動失敗')
                        .setDescription(success
                            ? `サーバー **${instanceName}** (${serverIdentifier}) の自動再起動が完了し、再び利用可能になりました。`
                            : `サーバー **${instanceName}** (${serverIdentifier}) の自動再起動に失敗しました。手動での対応が必要です。\n(詳細: ${message || '不明'})`
                        )
                        .setTimestamp();
                    await messageToEditObj.edit({ content: '', embeds: [embed], components: [] });
                    log('INFO', `[ハンドラ][再起動結果] ユーザーに再起動結果 (${success ? '成功' : '失敗'}) を通知しました (メッセージID: ${messageToEditObj.id})。`, { instanceName });
                } else { log('WARN', `[ハンドラ][再起動結果] 通知対象メッセージ(ID:${messageIdToEdit})が見つかりません。`, { instanceName }); }
            } else { log('WARN', `[ハンドラ][再起動結果] 通知対象チャンネル(ID:${serverState.startChannelId})が見つかりません。`, { instanceName }); }
        } catch (error) { log('ERROR', `[ハンドラ][再起動結果] 再起動結果通知メッセージ編集失敗。`, { error, instanceName, messageIdToEdit }); }
    } else { log('WARN', `[ハンドラ][再起動結果] 通知に必要な情報(Message/Channel/Guild ID)不足。通知スキップ。`, { instanceName }); }

    // 使用済みの通知IDをクリア
    serverState.crashNotificationMessageId = null;
}

/**
 * 物理サーバー識別子取得ヘルパー
 * @param {import('discord.js').Client} client
 * @param {string | null} clientId
 * @param {string} token
 * @returns {Promise<{serverIdentifier: string, logIp: string, clientInfo: object | null}>}
 */
async function getPhysicalServerIdentifier(client, clientId, token) {
    // (実装は変更なし、必要に応じて共通化)
    let serverIdentifier = `物理サーバー (Token: ...${token?.slice(-4)})`;
    let logIp = '不明';
    let physicalServerName = 'のサーバー';
    let ownerName = '不明なユーザー';
    let clientInfo = null;

     if(clientId) { clientInfo = clientManager.getClient(clientId); }
     let tokenData = null;
     if (!clientInfo && token) {
         try {
             const tokenManager = require('./token_manager'); // ここで require する (循環参照回避のため)
             const allTokens = await tokenManager.loadTokens();
             tokenData = allTokens.find(t => t.token === token);
         } catch (e) { log('ERROR', 'トークンデータ読み込み失敗 in getPhysicalServerIdentifier', { error: e }); }
     } else if (clientInfo) {
         tokenData = { creatorId: clientInfo.creatorId, name: clientInfo.physicalServerName };
         logIp = clientInfo.ip;
     }

    if (tokenData) {
        physicalServerName = tokenData.name || 'のサーバー';
        if (tokenData.creatorId && client) {
            try {
                const user = await client.users?.fetch(tokenData.creatorId).catch(() => null);
                if (user) { ownerName = user.displayName || user.username; }
                else { ownerName = `登録者ID:${tokenData.creatorId.substring(0, 6)}...`; }
            } catch (fetchError) {
                log('WARN', `getServerIdentifiers内でユーザー(${tokenData.creatorId})情報取得失敗`, { error: fetchError, tokenEnding: `...${token?.slice(-4)}` });
                ownerName = `登録者ID:${tokenData.creatorId.substring(0, 6)}...`;
            }
        } else if (tokenData.creatorId) { ownerName = `登録者ID:${tokenData.creatorId.substring(0, 6)}...`; }
        serverIdentifier = `${ownerName}: ${physicalServerName}`;
    }
    if (clientInfo) { logIp = clientInfo.ip; }

    return { serverIdentifier, logIp, clientInfo };
}
// --- getPhysicalServerIdentifier ここまで ---


// モジュールエクスポート
module.exports = {
    handleMessage,
    setServerInstances,
};