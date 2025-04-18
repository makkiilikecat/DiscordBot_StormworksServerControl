// [ルート]/commands/sws/sub_commands/start.js

const path = require('node:path');
const fs = require('node:fs').promises;
const { ActionRowBuilder, StringSelectMenuBuilder, ComponentType, EmbedBuilder } = require('discord.js');
const { getConnectedClients } = require('./utility/websocket/client_manager');
const config = require('./utility/registry');
const messages = require('./utility/messages');
const serverUtils = require('./utility/server_utils');
const clientManager = require('./utility/websocket/client_manager');
const { log, getOrCreateLogThread } = require('../../../utility/text_chat_logger');

const configBasePath = config.configBasePath;

module.exports = {
    async execute(interaction, serverInstances) {
        const logThread = await getOrCreateLogThread(interaction);
        // 修正: configName の取得方法を interaction タイプで分岐させる (ボタンなどでは options がないため)
        let instanceName;
        if (interaction.isChatInputCommand()) {
            instanceName = interaction.options.getString('name');
        } else if (interaction.isStringSelectMenu() || interaction.isButton()) {
            // customId から instanceName を特定する必要がある
            const customIdParts = interaction.customId.split('_');
             if (customIdParts.length >= 4) {
                  if (customIdParts[0] === 'select' && customIdParts[1] === 'server') {
                     instanceName = customIdParts.slice(3).join('_');
                 } // 他のボタンなどの customId 形式があれば追加
             }
             if (!instanceName) {
                  log('ERROR', 'start.js: メニュー/ボタンインタラクションから instanceName を特定できませんでした。', { customId: interaction.customId, thread: logThread });
                  // 応答を試みる
                  try {
                      if (interaction.isRepliable()) await interaction.reply({ content: '内部エラー: 操作対象を特定できませんでした。', ephemeral: true });
                  } catch (e) { log('ERROR', 'instanceName特定不可エラー応答失敗', { error: e, thread: logThread }); }
                  return;
             }
        } else {
             log('WARN', `start.js で未対応のインタラクションタイプです: ${interaction.type}`, { interaction, thread: logThread });
             // ... (未対応タイプのエラー応答) ...
             return;
        }

        // configName が取得できていればログ出力
        if (instanceName) {
            log('DEBUG', `start.js execute: instanceName=${instanceName}`, { interaction, thread: logThread });
        }

        try {
            if (interaction.isChatInputCommand()) {
                await handleSlashCommand(interaction, instanceName, serverInstances, logThread);
            } else if (interaction.isStringSelectMenu()) {
                const selectedClientId = interaction.values[0];
                await handleMenuSelection(interaction, instanceName, selectedClientId, serverInstances, logThread);
            } // 他のインタラクションタイプ (ボタンなど) の処理は今はなし
        } catch (error) {
             // instanceName が取得できている場合のみログに含める
             const logData = instanceName ? { instanceName, error, interaction, thread: logThread } : { error, interaction, thread: logThread };
            log('ERROR', `start コマンド処理中にエラーが発生しました。`, logData);
            // エラー応答を試みる
            const errorMsg = '❌ サーバーの起動処理中にエラーが発生しました。';
             try {
                 if (interaction.replied || interaction.deferred) {
                     await interaction.followUp({ content: errorMsg, ephemeral: true });
                 } else if (interaction.isRepliable()){
                     await interaction.reply({ content: errorMsg, ephemeral: true });
                 }
             } catch(replyError) {
                 log('ERROR', 'startコマンド全体エラー応答失敗', { error: replyError, thread: logThread });
             }
        }
    }
};

/**
 * スラッシュコマンド実行時の処理ハンドラ
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {string} instanceName
 * @param {Map<string, object>} serverInstances // 引数に追加
 * @param {import('discord.js').ThreadChannel} logThread
 */
async function handleSlashCommand(interaction, instanceName, serverInstances, logThread) {
    try {
        log('INFO', `サーバー "${instanceName}" の起動リクエストを受信しました。`, { interaction, thread: logThread });

        // --- 重複起動チェック ---
        const existingServer = serverInstances.get(instanceName);
        if (existingServer && existingServer.status === 'running') {
            log('WARN', `サーバー "${instanceName}" は既に実行中です (ClientID: ${existingServer.clientId})。`, { interaction, thread: logThread });
            // ユーザー向けのサーバー識別子を取得
            const { serverIdentifier } = await getServerIdentifiers(interaction, existingServer.clientId); // ヘルパー関数を呼び出す
            await interaction.reply({
                content: `❌ サーバー **${instanceName}** は既に **${serverIdentifier}** で実行中です。`,
                ephemeral: false // 既に実行中であることは公開情報で良い
            });
            return; // 処理を中断
        }
        // --- チェックここまで ---

        // 1. 指定された構成ディレクトリと設定ファイルが存在するかチェック
        // (チェック処理は変更なし)
        const configDir = path.join(configBasePath, instanceName);
        const configFile = path.join(configDir, 'server_config.xml');
        try {
            await fs.access(configDir);
            await fs.access(configFile);
            log('DEBUG', `構成 "${instanceName}" と設定ファイル (${configFile}) の存在を確認しました。`, { interaction, thread: logThread });
        } catch {
            log('WARN', `構成 "${instanceName}" または設定ファイルが見つかりません。`, { interaction, thread: logThread });
            await interaction.reply({
                content: messages.get('ERROR_CONFIG_NOT_FOUND', { configName: instanceName }),
                ephemeral: false
            });
            return;
        }

        // 2. 接続中の物理サーバーリストを取得
        // (処理は変更なし)
        const connectedServers = getConnectedClients();
        log('DEBUG', `現在接続中の物理サーバーリストを取得しました。件数: ${connectedServers.length}`, { interaction, data: connectedServers, thread: logThread });

        if (connectedServers.length === 0) {
            log('WARN', '接続中の物理サーバーがありません。', { interaction, thread: logThread });
            await interaction.reply({
                content: '❌ 起動可能な物理サーバーが現在接続されていません。物理サーバー側のクライアントが起動しているか確認してください。',
                ephemeral: false
            });
            return;
        }

        // 3. ドロップダウンメニューを作成
        // (処理は変更なし - ユーザー名表示、value=clientId)
        const serverOptionsPromises = connectedServers.map(async (server, index) => {
            let userName = '不明なユーザー';
            if (server.creatorId) {
                try {
                    if (interaction.client) {
                        const user = await interaction.client.users.fetch(server.creatorId).catch(() => null);
                        if (user) {
                            userName = user.username; // または user.tag
                        } else {
                            userName = `登録者ID:${server.creatorId.substring(0,6)}...`;
                        }
                    } else {
                         userName = `登録者ID:${server.creatorId.substring(0,6)}...`;
                    }
                } catch (fetchError) {
                    log('WARN', `Discordユーザー(${server.creatorId})の情報取得に失敗`, { error: fetchError, thread: logThread });
                    userName = `登録者ID:${server.creatorId.substring(0,6)}...`;
                }
            }
            let label = `${userName} サーバー ${index + 1}`;
            let description = `構成 '${instanceName}' を ${userName} のサーバーで起動します。`;
            if (label.length > 100) label = label.substring(0, 97) + '...';
            if (description.length > 100) description = description.substring(0, 97) + '...';
            return {
                label,
                description,
                value: server.clientId
            };
        });
        const serverOptions = await Promise.all(serverOptionsPromises);

        console.log('--- serverOptions for addOptions ---');
        console.log(JSON.stringify(serverOptions, null, 2));
        console.log('---------------------------------');
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId(`select_server_for_${instanceName}`)
            .setPlaceholder('起動する物理サーバーを選択してください')
            .addOptions(serverOptions);
        const row = new ActionRowBuilder().addComponents(selectMenu);

        // 4. ドロップダウンメニューを提示
        // (処理は変更なし)
        log('DEBUG', '物理サーバー選択のドロップダウンメニューを提示します。', { interaction, thread: logThread });
        await interaction.reply({
            content: `構成 **${instanceName}** をどの物理サーバーで起動しますか？`,
            components: [row],
            ephemeral: false,
        });

    } catch (error) {
        log('ERROR', `/${interaction.commandName} コマンド処理中に予期せぬエラーが発生しました。`, { interaction, error, thread: logThread });
        const replyOptions = { content: messages.get('ERROR_COMMAND_INTERNAL'), ephemeral: true };
        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(replyOptions);
            } else {
                await interaction.reply(replyOptions);
            }
        } catch (replyError) {
            log('ERROR', `スラッシュコマンドエラー応答の送信に失敗しました。`, { interaction, error: replyError, thread: logThread });
        }
    }
}

/**
 * ドロップダウンメニュー選択時の処理ハンドラ
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 * @param {string} instanceName
 * @param {string} selectedClientId
 * @param {Map<string, object>} serverInstances
 * @param {import('discord.js').ThreadChannel} logThread
 */
async function handleMenuSelection(interaction, instanceName, selectedClientId, serverInstances, logThread) {
    let serverIdentifier = `選択されたサーバー`;
    let logIp = '不明';
    let editReplyTarget = interaction;

    try {
        // --- クライアント情報の取得と重複起動チェック (変更なし) ---
        const { serverIdentifier: generatedIdentifier, logIp: foundIp, clientInfo } = await getServerIdentifiers(interaction, selectedClientId); // clientInfoも受け取る
        if (!clientInfo) { // clientInfo が取得できなかった場合
             log('WARN', `メニュー選択後、選択されたクライアントID ${selectedClientId} が見つかりません。接続が切断された可能性があります。`, { interaction, thread: logThread });
             await interaction.update({
                content: `❌ 選択されたサーバーとの接続が見つかりません。`,
                embeds: [], components: []
             });
             return;
        }
        serverIdentifier = generatedIdentifier;
        logIp = foundIp;
        log('INFO', `ユーザー ${interaction.user.tag} が構成 "${instanceName}" の起動先として ${serverIdentifier} (ClientID: ${selectedClientId}, IP: ${logIp}) を選択しました。`, { interaction, thread: logThread });
        const existingServer = serverInstances.get(instanceName);
        if (existingServer && existingServer.status === 'running') {
            log('WARN', `メニュー選択後、サーバー "${instanceName}" が既に実行されていることを検知しました (ClientID: ${existingServer.clientId})。`, { interaction, thread: logThread });
            const { serverIdentifier: existingIdentifier } = await getServerIdentifiers(interaction, existingServer.clientId);
            await interaction.update({
                content: `❌ サーバー **${instanceName}** は既に **${existingIdentifier}** で実行されています。起動処理を中止しました。`,
                embeds: [], components: []
            });
            return;
        }
        // --- チェックここまで ---

        // 1. 起動準備メッセージを表示
        await interaction.update({
            content: `⏳ ${serverIdentifier} で構成 **${instanceName}** の起動準備をしています...`,
            embeds: [], components: []
        });
        // ★★★ Stage 5: 応答メッセージIDを取得・保持 ★★★
        const replyMessage = await interaction.fetchReply();
        const startMessageId = replyMessage.id; // ★ メッセージID
        const startChannelId = replyMessage.channelId; // ★ チャンネルID
        const startGuildId = replyMessage.guildId; // ★ ギルドID
        log('DEBUG', `[開始][選択] 起動準備メッセージを送信・情報を取得: MsgID=${startMessageId}, ChID=${startChannelId}, GuildID=${startGuildId}`, { interaction, thread: logThread });
        // ------------------------------------------

        // 2. サーバー起動要求 (タイムアウト付き)
        log('DEBUG', `物理サーバー (ClientID: ${selectedClientId}, IP: ${logIp}) へ構成 "${instanceName}" の起動要求を送信します。`, { interaction, thread: logThread });
        const startPromise = serverUtils.startServer(interaction, selectedClientId, instanceName); // interaction を渡す
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('サーバーからの応答がタイムアウトしました (1分)。')), 60000));

        let result;
        try {
             result = await Promise.race([startPromise, timeoutPromise]);
        } catch (timeoutError) {
            log('ERROR', `サーバー "${instanceName}" の ${serverIdentifier} (ClientID: ${selectedClientId}, IP: ${logIp}) での起動要求がタイムアウトしました。`, { interaction, error: timeoutError, thread: logThread });
            result = { success: false, message: timeoutError.message }; // 失敗として扱う
        }

        // 3. 結果に応じてメッセージを編集 & 状態を保存
        if (result && result.success) { // result が true または success: true のオブジェクト
            const successMessage = result.message || '起動成功'; // Go側からのメッセージがあれば使う
            log('INFO', `サーバー "${instanceName}" が ${serverIdentifier} で正常に起動しました。メッセージ: ${successMessage}`, { interaction, data: result, thread: logThread });

            // --- ★ Stage 5: サーバー状態に startMessageId を追加 ---
            const newState = {
                clientId: selectedClientId,
                token: clientInfo.token, // clientInfoからトークンを取得
                ip: clientInfo.ip,
                creatorId: clientInfo.creatorId,
                status: 'running',
                instanceName: instanceName,
                startedAt: new Date().toISOString(),
                startInteractionId: interaction.id, // スラッシュコマンドのインタラクションID
                startMessageId: startMessageId,     // 応答メッセージID ★
                startChannelId: startChannelId,     // チャンネルID ★
                startGuildId: startGuildId,         // ギルドID ★
                crashNotificationMessageId: null, // ★ クラッシュ通知メッセージID用のフィールドを追加
            };
            serverInstances.set(instanceName, newState);
            console.log("t: ",clientInfo.token)
            log('DEBUG', `サーバーインスタンス "${instanceName}" の状態を 'running' として保存しました (メッセージID: ${startMessageId})。`, { interaction, data: newState, thread: logThread });
            // ---------------------------------------------------

            const successEmbed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('🚀 サーバー起動成功')
                .setDescription(`構成 **${instanceName}** は **${serverIdentifier}** で正常に起動しました。`)
                .addFields(
                    { name: '構成名', value: instanceName, inline: true },
                    { name: '起動したサーバー', value: serverIdentifier, inline: true }
                )
                .setTimestamp();

            await editReplyTarget.editReply({ // editReplyTarget は interaction
                content: '', // contentをクリア
                embeds: [successEmbed]
            });
        } else {
            // 失敗時の処理 (変更なし)
            const reason = result?.message || '不明なエラー';
            log('ERROR', `サーバー "${instanceName}" の ${serverIdentifier} での起動に失敗しました。理由: ${reason}`, { interaction, error: reason, data: result, thread: logThread });
            const errorEmbed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle('❌ サーバー起動失敗')
                .setDescription(`構成 **${instanceName}** の **${serverIdentifier}** での起動に失敗しました。`)
                .addFields(
                    { name: '構成名', value: instanceName, inline: true },
                    { name: '試行したサーバー', value: serverIdentifier, inline: true },
                    { name: '確認事項', value: 'サーバー管理者はログスレッドを確認してください。' }
                 )
                // 失敗理由はEmbedに含めない
                .setTimestamp();
            await editReplyTarget.editReply({
                content: '',
                embeds: [errorEmbed]
            });
        }

    } catch (error) {
         log('ERROR', `メニュー選択 (${interaction.customId}) 後の処理中にエラーが発生しました。`, { interaction, error, thread: logThread });
         try {
             await editReplyTarget.editReply({
                 content: messages.get('ERROR_COMMAND_INTERNAL'),
                 embeds: [],
                 components: []
             });
         } catch (editError) {
             log('ERROR', `メニュー選択後のエラー通知編集に失敗しました。`, { interaction, error: editError, thread: logThread });
         }
    }
}


/**
 * クライアントIDから識別子、IP、クライアント情報を取得するヘルパー関数 (修正)
 * @param {import('discord.js').Interaction} interaction
 * @param {string} clientId
 * @returns {Promise<{serverIdentifier: string, logIp: string, clientInfo: object | null}>} clientInfoも返す
 */
async function getServerIdentifiers(interaction, clientId) {
    let serverIdentifier = `サーバー (ID: ${clientId?.substring(0, 8)}...)`; // clientIdがnullの場合も考慮
    let logIp = '不明';
    let userName = '不明なユーザー';
    let clientInfoResult = null; // 結果格納用

    try {
        // clientManager は websocket ディレクトリ内のものを参照
        const connectedServers = clientManager.getConnectedClients(); // 整形済みリストを取得
        clientInfoResult = connectedServers.find(client => client.clientId === clientId); // clientIdで検索

        if (clientInfoResult) {
            logIp = clientInfoResult.ip;
            // サーバー番号の計算は connectedServers 全体で行う必要がある
            const allClients = clientManager.getAllClients(); // Mapの値を取得
            const serverIndex = allClients.findIndex(client => client.clientId === clientId);

            if (clientInfoResult.creatorId) {
                try {
                    const user = await interaction.client?.users?.fetch(clientInfoResult.creatorId).catch(() => null);
                    if (user) {
                        userName = user.username;
                    } else {
                         userName = `登録者ID:${clientInfoResult.creatorId.substring(0,6)}...`;
                    }
                } catch (fetchError) {
                     log('WARN', `getServerIdentifiers内でユーザー(${clientInfoResult.creatorId})情報取得失敗`, { error: fetchError, clientId: clientId });
                     userName = `登録者ID:${clientInfoResult.creatorId.substring(0,6)}...`;
                }
            }
            serverIdentifier = `${userName} のサーバー${serverIndex !== -1 ? ` ${serverIndex + 1}` : ''}`;
        } else {
            log('WARN', `getServerIdentifiers内でクライアントID ${clientId} が見つかりません。`, {clientId: clientId});
        }
    } catch (error) {
        log('ERROR', 'getServerIdentifiers でエラー発生', { error, clientId, interaction });
    }

    // clientInfo も含めて返す
    return { serverIdentifier, logIp, clientInfo: clientInfoResult };
}