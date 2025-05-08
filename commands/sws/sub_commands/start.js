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
        const logThread = await getOrCreateLogThread(interaction); // ログ用スレッドを取得/作成
        let instanceName; // 処理対象の構成名

        // インタラクションの種類に応じて構成名を取得
        if (interaction.isChatInputCommand()) {
            // スラッシュコマンドの場合
            instanceName = interaction.options.getString('name');
        } else if (interaction.isStringSelectMenu()) {
            // メニュー選択の場合 (customId から抽出)
            // customId の形式例: "select_server_for_構成名"
            const customIdParts = interaction.customId.split('_');
             if (customIdParts.length >= 4 && customIdParts[0] === 'select' && customIdParts[1] === 'server') {
                 instanceName = customIdParts.slice(3).join('_'); // "select_server_for_" の後が構成名
             }
        }

        // 構成名が特定できない場合はエラー
        if (!instanceName) {
             log('ERROR', 'start.js: インタラクションから instanceName を特定できませんでした。', { customId: interaction.customId, type: interaction.type, thread: logThread });
             try {
                 if (interaction.isRepliable()) await interaction.reply({ content: '内部エラー: 操作対象を特定できませんでした。', ephemeral: true });
             } catch (e) { log('ERROR', 'instanceName特定不可エラー応答失敗', { error: e, thread: logThread }); }
             return;
        }
        log('DEBUG', `start.js execute: instanceName=${instanceName}`, { interaction, thread: logThread });

        try {
            // インタラクションのタイプに応じて処理を分岐
            if (interaction.isChatInputCommand()) {
                // スラッシュコマンド実行時の処理
                await handleSlashCommand(interaction, instanceName, serverInstances, logThread);
            } else if (interaction.isStringSelectMenu()) {
                // ドロップダウンメニュー選択時の処理
                const selectedClientId = interaction.values[0]; // 選択された物理サーバーのクライアントID
                await handleMenuSelection(interaction, instanceName, selectedClientId, serverInstances, logThread);
            }
        } catch (error) {
            // コマンド全体の予期せぬエラー処理
             const logData = { instanceName, error, interaction, thread: logThread };
            log('ERROR', `start コマンド処理中にエラーが発生しました。`, logData);
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

         // 重複起動チェック (サーバー識別子の取得方法を修正)
         const existingServer = serverInstances.get(instanceName);
         if (existingServer && existingServer.status === 'running') {
             // ★ Stage 8: 新しいヘルパー関数または直接取得で識別子を取得
             const { serverIdentifier: existingIdentifier } = await getPhysicalServerIdentifier(interaction.client, existingServer.clientId, existingServer.token); // client, clientId, token を渡す
             log('WARN', `[開始] サーバー "${instanceName}" は既に ${existingIdentifier} で実行中。`, { interaction, thread: logThread });
             await interaction.reply({
                 content: `❌ サーバー **${instanceName}** は既に **${existingIdentifier}** で実行中です。`,
                 ephemeral: false
             });
             return;
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
        const connectedClients = getConnectedClients();
        log('DEBUG', `現在接続中の物理サーバーリストを取得しました。件数: ${connectedClients.length}`, { interaction, data: connectedClients, thread: logThread });

        if (connectedClients.length === 0) {
            log('WARN', '接続中の物理サーバーがありません。', { interaction, thread: logThread });
            await interaction.reply({
                content: '❌ 起動可能な物理サーバーが現在接続されていません。物理サーバー側のクライアントが起動しているか確認してください。',
                ephemeral: false
            });
            return;
        }

        // 3. ドロップダウンメニューを作成
         // ★ Stage 8: ドロップダウンオプション作成を修正
         const serverOptionsPromises = connectedClients.map(async (client) => {
            const { serverIdentifier, _ } = await getPhysicalServerIdentifier(interaction.client, client.clientId, client.token); // ヘルパー関数を使用
            let label = serverIdentifier; // ラベルに識別子を使用
            let description = `構成 '${instanceName}' を ${serverIdentifier} で起動します。`;
            if (label.length > 100) label = label.substring(0, 97) + '...';
            if (description.length > 100) description = description.substring(0, 97) + '...';
            return { label, description, value: client.clientId }; // value は clientId
        });
        const serverOptions = await Promise.all(serverOptionsPromises);
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
//async function handleMenuSelection(interaction, instanceName, selectedClientId, serverInstances, logThread) {
//    let serverIdentifier = `選択されたサーバー`;
//    let logIp = '不明';
//    let editReplyTarget = interaction;
//
//    try {
//        // --- クライアント情報の取得と重複起動チェック (変更なし) ---
//        const clientInfo = clientManager.getClient(selectedClientId); // clientManagerから直接取得
//        if (!clientInfo) {
//             log('WARN', `メニュー選択後、クライアントID ${selectedClientId} が見つかりません。`, { interaction, thread: logThread });
//             await interaction.update({ content: `❌ 選択されたサーバーとの接続が見つかりません。`, embeds: [], components: [] });
//             return;
//        }
//        const { serverIdentifier: generatedIdentifier, logIp: foundIp } = await getPhysicalServerIdentifier(interaction.client, selectedClientId, clientInfo.token);
//        serverIdentifier = generatedIdentifier;
//        logIp = foundIp;
//        log('INFO', `[開始][選択] ユーザー ${interaction.user.tag} が ${serverIdentifier} (ClientID: ${selectedClientId}, IP: ${logIp}) を選択。`, { interaction, thread: logThread });
//
//        const existingServer = serverInstances.get(instanceName);
//        if (existingServer && existingServer.status === 'running') {
//            log('WARN', `メニュー選択後、サーバー "${instanceName}" が既に実行されていることを検知しました (ClientID: ${existingServer.clientId})。`, { interaction, thread: logThread });
//            const { serverIdentifier: existingIdentifier } = await getServerIdentifiers(interaction, existingServer.clientId);
//            await interaction.update({
//                content: `❌ サーバー **${instanceName}** は既に **${existingIdentifier}** で実行されています。起動処理を中止しました。`,
//                embeds: [], components: []
//            });
//            return;
//        }
//        // --- チェックここまで ---
//
//        // 1. 起動準備メッセージを表示
//        await interaction.update({
//            content: `⏳ ${serverIdentifier} で構成 **${instanceName}** の起動準備をしています...`,
//            embeds: [], components: []
//        });
//        // ★★★ Stage 5: 応答メッセージIDを取得・保持 ★★★
//        const replyMessage = await interaction.fetchReply();
//        const startMessageId = replyMessage.id; // ★ メッセージID
//        const startChannelId = replyMessage.channelId; // ★ チャンネルID
//        const startGuildId = replyMessage.guildId; // ★ ギルドID
//        log('DEBUG', `[開始][選択] 起動準備メッセージを送信・情報を取得: MsgID=${startMessageId}, ChID=${startChannelId}, GuildID=${startGuildId}`, { interaction, thread: logThread });
//        // ------------------------------------------
//
//        // 2. サーバー起動要求 (タイムアウト付き)
//        log('DEBUG', `物理サーバー (ClientID: ${selectedClientId}, IP: ${logIp}) へ構成 "${instanceName}" の起動要求を送信します。`, { interaction, thread: logThread });
//        const startPromise = serverUtils.startServer(interaction, selectedClientId, instanceName); // interaction を渡す
//        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('サーバーからの応答がタイムアウトしました (1分)。')), 60000));
//
//        let result;
//        try {
//             result = await Promise.race([startPromise, timeoutPromise]);
//        } catch (timeoutError) {
//            log('ERROR', `サーバー "${instanceName}" の ${serverIdentifier} (ClientID: ${selectedClientId}, IP: ${logIp}) での起動要求がタイムアウトしました。`, { interaction, error: timeoutError, thread: logThread });
//            result = { success: false, message: timeoutError.message }; // 失敗として扱う
//        }
//
//        // 3. 結果に応じてメッセージを編集 & 状態を保存
//        if (result && result.success) { // result が true または success: true のオブジェクト
//            const successMessage = result.message || '起動成功'; // Go側からのメッセージがあれば使う
//            const assignedPort = typeof result.assignedPort === 'number' || -1 // ポートがnumberでなければ-1にする
//            log('INFO', `サーバー "${instanceName}" が ${serverIdentifier} で正常に起動しました。メッセージ: ${successMessage}`, { interaction, data: result, thread: logThread });
//
//            // --- ★ Stage 5: サーバー状態に startMessageId を追加 ---
//            const newState = {
//                clientId: selectedClientId,
//                token: clientInfo.token, // clientInfoからトークンを取得
//                ip: clientInfo.ip,
//                creatorId: clientInfo.creatorId,
//                status: 'running',
//                instanceName: instanceName,
//                port: assignedPort,
//                startedAt: new Date().toISOString(),
//                startInteractionId: interaction.id, // スラッシュコマンドのインタラクションID
//                startMessageId: startMessageId,     // 応答メッセージID ★
//                startChannelId: startChannelId,     // チャンネルID ★
//                startGuildId: startGuildId,         // ギルドID ★
//                crashNotificationMessageId: null, // ★ クラッシュ通知メッセージID用のフィールドを追加
//            };
//            serverInstances.set(instanceName, newState);
//            console.log("t: ",clientInfo.token)
//            log('DEBUG', `サーバーインスタンス "${instanceName}" の状態を 'running' として保存しました (メッセージID: ${startMessageId})。`, { interaction, data: newState, thread: logThread });
//            // ---------------------------------------------------
//
//            const successEmbed = new EmbedBuilder()
//                .setColor(0x00FF00)
//                .setTitle('🚀 サーバー起動成功')
//                .setDescription(`構成 **${instanceName}** は **${serverIdentifier}** で正常に起動しました。`)
//                .addFields(
//                    { name: '構成名', value: instanceName, inline: true },
//                    { name: '起動物理サーバー', value: serverIdentifier, inline: true },
//                )
//                .setTimestamp();
//
//            await editReplyTarget.editReply({ // editReplyTarget は interaction
//                content: '', // contentをクリア
//                embeds: [successEmbed]
//            });
//        } else {
//            // 失敗時の処理 (変更なし)
//            const reason = result?.message || '不明なエラー';
//            log('ERROR', `[開始][選択] サーバー "${instanceName}" の ${serverIdentifier} での起動失敗。理由: ${reason}`, { interaction, error: reason, data: result, thread: logThread });
//            const errorEmbed = new EmbedBuilder()
//                .setColor(0xFF0000)
//                .setTitle('❌ サーバー起動失敗')
//                .setDescription(`構成 **${instanceName}** の **${serverIdentifier}** での起動に失敗しました。`)
//                .addFields(
//                    { name: '構成名', value: instanceName, inline: true },
//                    { name: '試行物理サーバー', value: serverIdentifier, inline: true }, // ★ 変更
//                    { name: '理由', value: reason.substring(0, 1000) },
//                    { name: '確認事項', value: 'サーバー管理者はログスレッドを確認してください。' }
//                 )
//                // 失敗理由はEmbedに含めない
//                .setTimestamp();
//            await editReplyTarget.editReply({
//                content: '',
//                embeds: [errorEmbed]
//            });
//        }
//
//    } catch (error) {
//         log('ERROR', `メニュー選択 (${interaction.customId}) 後の処理中にエラーが発生しました。`, { interaction, error, thread: logThread });
//         try {
//             await editReplyTarget.editReply({
//                 content: messages.get('ERROR_COMMAND_INTERNAL'),
//                 embeds: [],
//                 components: []
//             });
//         } catch (editError) {
//             log('ERROR', `メニュー選択後のエラー通知編集に失敗しました。`, { interaction, error: editError, thread: logThread });
//         }
//    }
//}

/**
 * ドロップダウンメニュー選択時の処理ハンドラ
 * 物理サーバーを選択した後、サーバーの起動処理を開始します。
 *
 * @param {import('discord.js').StringSelectMenuInteraction} interaction - メニュー選択のインタラクション
 * @param {string} instanceName - 起動対象のサーバー構成名 (例: 'highway')
 * @param {string} selectedClientId - 選択された物理サーバーのクライアントID
 * @param {Map<string, object>} serverInstances - サーバーインスタンスの状態を管理するMap
 * @param {import('discord.js').ThreadChannel} logThread - ログ出力用のスレッドチャンネル
 */
async function handleMenuSelection(interaction, instanceName, selectedClientId, serverInstances, logThread) {
    // ログやメッセージ表示用の変数を初期化
    let serverIdentifier = `物理サーバー (ID: ${selectedClientId.substring(0, 8)}...)`;
    let logIp = '不明';
    // 応答メッセージを編集するために interaction オブジェクトを保持
    let editReplyTarget = interaction;

    try {
        // --- ステップ 1: 選択された物理サーバーの情報を取得 ---
        const clientInfo = clientManager.getClient(selectedClientId);
        if (!clientInfo) {
            // 選択されたクライアントがボットに接続されていない場合
            log('WARN', `メニュー選択後、クライアントID ${selectedClientId} が見つかりません。`, { interaction, thread: logThread });
            // ユーザーに応答し、処理を終了
            await interaction.update({ content: `❌ 選択されたサーバーとの接続が見つかりません。`, embeds: [], components: [] });
            return;
        }
        // ユーザーに表示するサーバー識別子とログ用のIPアドレスを取得
        const { serverIdentifier: generatedIdentifier, logIp: foundIp } = await getPhysicalServerIdentifier(interaction.client, selectedClientId, clientInfo.token);
        serverIdentifier = generatedIdentifier;
        logIp = foundIp;
        log('INFO', `[開始][選択] ユーザー ${interaction.user.tag} が ${serverIdentifier} (ClientID: ${selectedClientId}, IP: ${logIp}) を選択。`, { interaction, thread: logThread });

        // --- ステップ 2: 重複起動チェック ---
        const existingServer = serverInstances.get(instanceName);
        if (existingServer && existingServer.status === 'running') {
            // 対象の構成名が既に 'running' 状態の場合
            log('WARN', `メニュー選択後、サーバー "${instanceName}" が既に実行されていることを検知しました (ClientID: ${existingServer.clientId})。`, { interaction, thread: logThread });
            // どの物理サーバーで実行中かを表示
            const { serverIdentifier: existingIdentifier } = await getPhysicalServerIdentifier(interaction.client, existingServer.clientId, existingServer.token);
            // ユーザーに応答し、処理を終了
            await interaction.update({
                content: `❌ サーバー **${instanceName}** は既に **${existingIdentifier}** で実行されています。起動処理を中止しました。`,
                embeds: [], components: []
            });
            return;
        }

        // --- ステップ 3: 起動準備メッセージ表示 & コンテキスト取得 ---
        // ユーザーに「起動準備中」であることを伝えるメッセージを送信（メニュー応答を更新）
        await interaction.update({
            content: `⏳ ${serverIdentifier} で構成 **${instanceName}** の起動準備をしています...`,
            embeds: [], components: [] // Embedやボタンはクリア
        });
        // 送信したメッセージオブジェクトを取得（後で編集するため）
        const replyMessage = await interaction.fetchReply();
        // message_handler.js が応答を処理する際にどのメッセージを編集すればよいか伝えるための情報
        const discordContext = {
            messageId: replyMessage.id,
            channelId: replyMessage.channelId,
            guildId: replyMessage.guildId
        };
        log('DEBUG', `[開始][選択] 起動準備メッセージを送信・コンテキスト取得: MsgID=${discordContext.messageId}, ChID=${discordContext.channelId}, GuildID=${discordContext.guildId}`, { interaction, thread: logThread });

        // --- ステップ 4: サーバー状態の先行保存 ---
        // レースコンディションを防ぐため、Goクライアントに応答を要求する *前* に
        // サーバーの状態を 'starting' として serverInstances Map に保存する。
        const preliminaryState = {
            clientId: selectedClientId,               // 接続先クライアントID
            token: clientInfo.token,                  // 接続先クライアントのトークン
            ip: clientInfo.ip,                        // 接続先クライアントのIP
            creatorId: clientInfo.creatorId,          // 物理サーバー登録者のID
            status: 'starting',                       // ★ 状態を 'starting' に設定
            instanceName: instanceName,               // 構成名
            startedAt: new Date().toISOString(),      // 起動試行開始時刻
            startInteractionId: interaction.id,       // このメニューインタラクションのID
            startMessageId: discordContext.messageId, // 編集対象のメッセージID
            startChannelId: discordContext.channelId, // 編集対象のチャンネルID
            startGuildId: discordContext.guildId,     // 編集対象のギルドID
            crashNotificationMessageId: null,         // クラッシュ通知用（初期値null）
        };
        serverInstances.set(instanceName, preliminaryState);
        log('DEBUG', `サーバーインスタンス "${instanceName}" の状態を 'starting' として先行保存しました。`, { interaction, data: preliminaryState, thread: logThread });

        // --- ステップ 5: サーバー起動要求を送信 ---
        log('DEBUG', `物理サーバー (ClientID: ${selectedClientId}, IP: ${logIp}) へ構成 "${instanceName}" の起動要求を送信します。`, { interaction, thread: logThread });
        // serverUtils を介して Goクライアントに起動要求を送信 (Promiseが返る)
        // discordContext を渡して、message_handler が応答時にメッセージを編集できるようにする
        const startPromise = serverUtils.startServer(interaction, selectedClientId, instanceName, discordContext);
        // タイムアウト処理用の Promise を作成 (例: 1分)
        const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('サーバーからの応答がタイムアウトしました (1分)。')), 60000));

        // --- ステップ 6: 起動要求の結果を待機 ---
        let result; // 起動要求の結果を格納する変数
        try {
            // 起動要求の Promise とタイムアウトの Promise のうち、先に完了した方を採用
            result = await Promise.race([startPromise, timeoutPromise]);
        } catch (timeoutError) {
            // タイムアウトした場合 (timeoutPromise が reject した場合)
            log('ERROR', `サーバー "${instanceName}" の ${serverIdentifier} での起動要求がタイムアウトしました。`, { interaction, error: timeoutError, thread: logThread });
            // 失敗として扱うための結果オブジェクトを作成
            result = { success: false, message: timeoutError.message };

            // 状態が 'starting' のまま残らないように 'stopped' に戻す
            if (serverInstances.has(instanceName) && serverInstances.get(instanceName).status === 'starting') {
                serverInstances.get(instanceName).status = 'stopped'; // タイムアウトしたので停止状態とみなす
                log('INFO', `[開始][タイムアウト] サーバー "${instanceName}" の状態を 'stopped' に更新しました (起動タイムアウト)。`);
            }
        }

        // --- ステップ 7: 結果に応じた後処理 ---
        // (注意: 最終的な成功/失敗メッセージの表示は message_handler.js が discordContext を使って行います)
        if (result && result.success) {
            // Goクライアントが起動要求を正常に受理した場合 (result.success が true)
            const successMessage = result.message || '起動成功'; // Goからのメッセージ
            const failedItems = result.failedItemIDs || []; // アイテムダウンロード失敗リスト

            log('INFO', `サーバー "${instanceName}" の起動要求が ${serverIdentifier} で受理されました。メッセージ: ${successMessage}${failedItems.length > 0 ? ` (${failedItems.length}件のアイテムDL失敗)` : ''}`, { interaction, data: result, thread: logThread });
            // 状態を 'running' にしたり、成功メッセージを編集するのは message_handler の役割

        } else {
            // Goクライアントが起動要求を失敗として応答した場合、またはタイムアウトした場合
            const reason = result?.message || '不明なエラー'; // 失敗理由
            log('ERROR', `[開始][選択] サーバー "${instanceName}" の ${serverIdentifier} での起動要求失敗。理由: ${reason}`, { interaction, error: reason, data: result, thread: logThread });

            // 状態が 'starting' のまま残らないように 'stopped' に戻す
            // (タイムアウトの場合は既に行っているが、Go側が失敗応答した場合のためにここでもチェック)
             if (serverInstances.has(instanceName) && serverInstances.get(instanceName).status === 'starting') {
                 serverInstances.get(instanceName).status = 'stopped'; // 起動に失敗したので停止状態とみなす
                 log('INFO', `[開始][失敗] サーバー "${instanceName}" の状態を 'stopped' に更新しました (起動要求失敗)。`);
             }
            // 失敗メッセージの表示は message_handler が試みる

        }
    } catch (error) {
         // この try ブロック全体で予期しないエラーが発生した場合
         log('ERROR', `メニュー選択 (${interaction.customId}) 後の処理中にエラーが発生しました。`, { interaction, error, thread: logThread });

         // エラーが発生した場合も、'starting' 状態が残らないように 'stopped' に戻す試み
         if (instanceName && serverInstances.has(instanceName) && serverInstances.get(instanceName).status === 'starting') {
             serverInstances.get(instanceName).status = 'stopped'; // エラーなので停止状態とみなす
             log('INFO', `[開始][エラー] サーバー "${instanceName}" の状態を 'stopped' に更新しました (ハンドルエラー)。`);
         }

         // ユーザーに内部エラーを通知する試み
         try {
             await editReplyTarget.editReply({
                 content: messages.get('ERROR_COMMAND_INTERNAL'), // 定義済みのエラーメッセージ
                 embeds: [], components: [] // Embedやボタンはクリア
             });
         } catch (editError) {
             // エラー通知の編集に失敗した場合のログ
             log('ERROR', `メニュー選択後のエラー通知編集に失敗しました。`, { interaction, error: editError, thread: logThread });
         }
    }
}


/**
 * ★ Stage 8: 物理サーバー識別子取得ヘルパー (修正・共通化推奨)
 * ClientID と Token から、ユーザー表示用の物理サーバー識別子とログ用IPを取得
 * @param {import('discord.js').Client} client
 * @param {string | null} clientId - 現在の接続ID (なければ null)
 * @param {string} token - 物理サーバーのトークン
 * @returns {Promise<{serverIdentifier: string, logIp: string, clientInfo: object | null}>}
 */
async function getPhysicalServerIdentifier(client, clientId, token) {
    let serverIdentifier = `物理サーバー (Token: ...${token?.slice(-4)})`; // デフォルト
    let logIp = '不明';
    let physicalServerName = '名称未設定';
    let ownerName = '不明なユーザー';
    let clientInfo = null; // clientId があれば取得

     if(clientId) {
         clientInfo = clientManager.getClient(clientId);
     }
     // clientId がなくてもトークンから情報を引く試み (token_manager を使う)
     let tokenData = null;
     if (!clientInfo && token) {
         try {
             // tokenManager.loadTokens を直接使うか、新しい関数を作る
             const allTokens = await tokenManager.loadTokens(); // 全トークン読み込み
             tokenData = allTokens.find(t => t.token === token);
         } catch (e) { log('ERROR', 'トークンデータ読み込み失敗 in getPhysicalServerIdentifier', { error: e }); }
     } else if (clientInfo) {
         // clientInfo から tokenData 相当の情報を取得
         tokenData = { creatorId: clientInfo.creatorId, name: clientInfo.physicalServerName };
         logIp = clientInfo.ip;
     }


    if (tokenData) {
        physicalServerName = tokenData.name || 'のサーバー';
        if (tokenData.creatorId && client) {
            try {
                const user = await client.users?.fetch(tokenData.creatorId).catch(() => null);
                if (user) {
                    ownerName = user.displayName || user.username; // ディスプレイ名を優先
                } else {
                    ownerName = `登録者ID:${tokenData.creatorId.substring(0, 6)}...`;
                }
            } catch (fetchError) {
                log('WARN', `getServerIdentifiers内でユーザー(${tokenData.creatorId})情報取得失敗`, { error: fetchError, tokenEnding: `...${token?.slice(-4)}` });
                ownerName = `登録者ID:${tokenData.creatorId.substring(0, 6)}...`;
            }
        } else if (tokenData.creatorId) {
             ownerName = `登録者ID:${tokenData.creatorId.substring(0, 6)}...`;
        }
        // ★ 新しい形式: 所有者ディスプレイ名: 物理サーバー名
        serverIdentifier = `${ownerName}: ${physicalServerName}`;
    }

    // clientInfo が見つからない場合（オフライン時など）のために IP は tokenData からは取れない
    // オンラインの場合のみ clientInfo から IP を取得する
    if (clientInfo) {
        logIp = clientInfo.ip;
    }


    return { serverIdentifier, logIp, clientInfo }; // clientInfo も返す（必要なら）
}