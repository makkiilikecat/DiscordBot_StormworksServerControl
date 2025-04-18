// commands/sws/sub_commands/stop.js

const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const serverUtils = require('./utility/server_utils'); // サーバー関連ユーティリティ
const { getConnectedClients } = require('./utility/websocket/client_manager'); // 接続クライアント取得
const { log, getOrCreateLogThread } = require('../../../utility/text_chat_logger'); // ロガー
const messages = require('./utility/messages'); // メッセージ管理

// serverInstances Map を外部から受け取る想定
// この Map には { clientId: string, ip: string, creatorId: string, status: 'running' | 'stopped' | ... } のような情報が入る

module.exports = {
    /**
     * stop コマンドの実行処理
     * @param {import('discord.js').Interaction} interaction - コマンドまたはボタンのインタラクション
     * @param {Map<string, object>} serverInstances - サーバーインスタンスの状態を管理するMap
     */
    async execute(interaction, serverInstances) {
        const logThread = await getOrCreateLogThread(interaction); // ログスレッドを取得/作成
        const configName = interaction.options.getString('name');

        try {
            log('INFO', `サーバー "${configName}" の停止リクエストを受信しました。`, { interaction, thread: logThread });

            if (interaction.isChatInputCommand()) {
                await handleStopCommand(interaction, serverInstances, logThread);
            } else if (interaction.isButton()) {
                await handleStopConfirmation(interaction, serverInstances, logThread);
            } else {
                log('WARN', `stop.js で未対応のインタラクションタイプです: ${interaction.type}`, { interaction, thread: logThread });
                try {
                    if (interaction.isRepliable()) {
                        await interaction.reply({ content: 'この操作は現在サポートされていません。', ephemeral: true });
                    }
                } catch (e) {
                    log('ERROR', '未対応インタラクションエラー応答の送信に失敗', { error: e, thread: logThread });
                }
            }
        } catch (error) {
            log('ERROR', `サーバー "${configName}" の停止中にエラーが発生しました: ${error.message}`, { error, interaction, thread: logThread });
            await interaction.reply({
                content: '❌ サーバーの停止中にエラーが発生しました。',
                ephemeral: true
            });
        }
    }
};

/**
 * /sws stop コマンド実行時の処理
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {Map<string, object>} serverInstances
 * @param {import('discord.js').ThreadChannel} logThread
 */
async function handleStopCommand(interaction, serverInstances, logThread) {
    const instanceName = interaction.options.getString('name');
    log('INFO', `サーバー "${instanceName}" の停止リクエストを受信しました。`, { interaction, thread: logThread });

    // 1. サーバーインスタンスの状態を確認
    const serverState = serverInstances.get(instanceName);
    if (!serverState || serverState.status !== 'running') {
        log('WARN', `停止対象のサーバー "${instanceName}" が見つからないか、実行中ではありません。現在の状態: ${serverState?.status}`, { interaction, thread: logThread });
        await interaction.reply({
            content: `❌ サーバー "${instanceName}" は現在実行されていません。`,
            ephemeral: true // 本人にのみ表示
        });
        return;
    }

    const { clientId } = serverState; // 状態からクライアントIDを取得
    if (!clientId) {
        log('ERROR', `サーバー "${instanceName}" の状態にクライアントIDが含まれていません。`, { interaction, data: serverState, thread: logThread });
        await interaction.reply({ content: messages.get('ERROR_COMMAND_INTERNAL'), ephemeral: true });
        return;
    }

    // サーバー識別子とログ用IPを取得
    const { serverIdentifier, logIp } = await getServerIdentifiers(interaction, clientId);
    log('DEBUG', `停止対象サーバー: ${serverIdentifier} (ClientID: ${clientId}, IP: ${logIp})`, { interaction, thread: logThread });

    try {
        // 2. 最初の停止要求を送信 (確認フラグなし)
        await interaction.deferReply({ ephemeral: false }); // 応答を保留 (公開)
        log('DEBUG', `物理サーバー (ClientID: ${clientId}, IP: ${logIp}) へ構成 "${instanceName}" の停止要求を送信します (初回)。`, { interaction, thread: logThread });

        const result = await serverUtils.stopServer(clientId, instanceName, false);

        // 3. 結果に基づいて応答を処理
        await handleStopResult(interaction, result, instanceName, clientId, serverIdentifier, logIp, serverInstances, logThread);

    } catch (error) {
        log('ERROR', `サーバー "${instanceName}" の停止処理中に予期せぬエラーが発生しました。`, { interaction, error, thread: logThread });
        try {
            await interaction.editReply({ content: messages.get('ERROR_COMMAND_INTERNAL'), embeds: [], components: [] });
        } catch (e) {
            log('ERROR', '停止処理中のエラー応答編集に失敗', { error: e, thread: logThread });
        }
    }
}

/**
 * 確認ボタンが押された時の処理
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {Map<string, object>} serverInstances
 * @param {import('discord.js').ThreadChannel} logThread
 */
async function handleStopConfirmation(interaction, serverInstances, logThread) {
    // customIdの形式を解析 (例: stop_confirm_instanceName_clientId または stop_cancel_instanceName_clientId)
    const parts = interaction.customId.split('_');
    if (parts.length < 4) {
        log('WARN', `無効な形式の停止確認ボタン customId: ${interaction.customId}`, { interaction, thread: logThread });
        await interaction.update({ content: '無効なボタン操作です。', components: [], embeds: [] });
        return;
    }

    const action = parts[1]; // 'confirm' または 'cancel'
    const instanceName = parts[2];
    const clientId = parts[3]; // このボタンが押された時点でのクライアントID

    const { serverIdentifier, logIp } = await getServerIdentifiers(interaction, clientId); // 識別子を再取得

    if (action === 'cancel') {
        log('INFO', `ユーザー ${interaction.user.tag} がサーバー "${instanceName}" (${serverIdentifier}) の停止をキャンセルしました。`, { interaction, thread: logThread });
        await interaction.update({
            content: `サーバー **${instanceName}** (${serverIdentifier}) の停止はキャンセルされました。`,
            components: [], // ボタンを削除
            embeds: []
        });
        return;
    }

    // action === 'confirm' の場合
    log('INFO', `ユーザー ${interaction.user.tag} がサーバー "${instanceName}" (${serverIdentifier}) の停止を確認しました。`, { interaction, thread: logThread });

    try {
        // ボタンの応答を更新して処理中を示す
        await interaction.update({
            content: `⏳ サーバー **${instanceName}** (${serverIdentifier}) の停止処理を実行中です...`,
            components: [], // ボタンを削除
            embeds: []
        });

        // 確認済みとして停止要求を再送信
        log('DEBUG', `物理サーバー (ClientID: ${clientId}, IP: ${logIp}) へ構成 "${instanceName}" の停止要求を送信します (確認済み)。`, { interaction, thread: logThread });
        const result = await serverUtils.stopServer(clientId, instanceName, true); // confirmed: true

        // 結果に基づいて応答を処理 (今回は interaction.editReply でボタン応答を編集)
        await handleStopResult(interaction, result, instanceName, clientId, serverIdentifier, logIp, serverInstances, logThread);

    } catch (error) {
        log('ERROR', `サーバー "${instanceName}" の停止確認後の処理中にエラーが発生しました。`, { interaction, error, thread: logThread });
        try {
            // interaction.update は既に実行されているので editReply を使う
            await interaction.editReply({ content: messages.get('ERROR_COMMAND_INTERNAL'), embeds: [], components: [] });
        } catch (e) {
            log('ERROR', '停止確認後のエラー応答編集に失敗', { error: e, thread: logThread });
        }
    }
}

/**
 * serverUtils.stopServer の結果を処理し、ユーザーに応答する
 * @param {import('discord.js').ChatInputCommandInteraction | import('discord.js').ButtonInteraction} interaction - 元のインタラクションまたはボタンインタラクション
 * @param {object} result - stopServer の結果オブジェクト
 * @param {string} instanceName
 * @param {string} clientId
 * @param {string} serverIdentifier - ユーザー向けのサーバー識別子
 * @param {string} logIp - ログ用のIPアドレス
 * @param {Map<string, object>} serverInstances
 * @param {import('discord.js').ThreadChannel} logThread
 */
async function handleStopResult(interaction, result, instanceName, clientId, serverIdentifier, logIp, serverInstances, logThread) {
    try {
        // プレイヤーがいて確認が必要な場合
        if (result.requiresConfirmation) {
            log('INFO', `サーバー "${instanceName}" (${serverIdentifier}) の停止には確認が必要です。プレイヤー数: ${result.players}`, { interaction, thread: logThread });

            const confirmButton = new ButtonBuilder()
                .setCustomId(`stop_confirm_${instanceName}_${clientId}`)
                .setLabel('はい、停止します')
                .setStyle(ButtonStyle.Danger);

            const cancelButton = new ButtonBuilder()
                .setCustomId(`stop_cancel_${instanceName}_${clientId}`)
                .setLabel('キャンセル')
                .setStyle(ButtonStyle.Secondary);

            const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

            const embed = new EmbedBuilder()
                .setColor(0xFFCC00) // 黄色
                .setTitle('⚠️ 停止確認')
                .setDescription(`サーバー **${instanceName}** (${serverIdentifier}) には現在 ${result.players} 人のプレイヤーがいます。\n本当に停止しますか？`)
                .setTimestamp();

            // deferReply 後の応答なので editReply を使う
            await interaction.editReply({
                content: '', // contentをクリア
                embeds: [embed],
                components: [row]
            });

        } else if (result.success) {
            // 停止成功 (確認不要または確認後)
            log('INFO', `サーバー "${instanceName}" (${serverIdentifier}, ClientID: ${clientId}, IP: ${logIp}) が正常に停止されました。設定保存: ${result.savedConfig}`, { interaction, thread: logThread });

            // インスタンスの状態を更新
            serverInstances.delete(instanceName); // または status を 'stopped' に更新
            log('DEBUG', `サーバーインスタンス "${instanceName}" の状態を更新/削除しました。`, { interaction, thread: logThread });

            const successEmbed = new EmbedBuilder()
                .setColor(0x00FF00) // 緑色
                .setTitle('✅ サーバー停止完了')
                .setDescription(`サーバー **${instanceName}** (${serverIdentifier}) は正常に停止されました。`)
                .addFields({ name: '構成名', value: instanceName, inline: true }, { name: '停止したサーバー', value: serverIdentifier, inline: true })
                // 設定ファイルが保存されたかどうかの情報 (任意)
                .addFields({ name: '設定ファイルの保存', value: result.savedConfig ? '成功' : 'なし/失敗', inline: true })
                .setTimestamp();

            // editReply で最終結果を表示
            await interaction.editReply({
                content: '',
                embeds: [successEmbed],
                components: [] // ボタンなどをクリア
            });

        } else {
            // 停止失敗 (確認不要または確認後)
            log('ERROR', `サーバー "${instanceName}" (${serverIdentifier}, ClientID: ${clientId}, IP: ${logIp}) の停止に失敗しました。理由: ${result.message}`, { interaction, error: result.message, thread: logThread });

            const errorEmbed = new EmbedBuilder()
                .setColor(0xFF0000) // 赤色
                .setTitle('❌ サーバー停止失敗')
                .setDescription(`サーバー **${instanceName}** (${serverIdentifier}) の停止に失敗しました。`)
                .addFields(
                    { name: '構成名', value: instanceName, inline: true },
                    { name: '試行したサーバー', value: serverIdentifier, inline: true },
                    { name: '確認事項', value: 'サーバー管理者はログスレッドを確認してください。' }
                )
                // 失敗理由はEmbedに含めない (ログで確認)
                .setTimestamp();

            // editReply で最終結果を表示
            await interaction.editReply({
                content: '',
                embeds: [errorEmbed],
                components: []
            });
        }
    } catch (error) {
        log('ERROR', `停止結果の処理中にエラーが発生しました (instance: ${instanceName}, client: ${clientId})。`, { interaction, error, thread: logThread });
        // エラー応答を試みる (既に editReply している可能性もある)
        try {
            await interaction.editReply({ content: messages.get('ERROR_COMMAND_INTERNAL'), embeds: [], components: [] });
        } catch (e) {
            log('ERROR', '停止結果処理中のエラー応答編集に失敗', { error: e, thread: logThread });
        }
    }
}

/**
 * クライアントIDからユーザー向けのサーバー識別子とログ用IPアドレスを取得するヘルパー関数
 * @param {import('discord.js').Interaction} interaction
 * @param {string} clientId
 * @returns {Promise<{serverIdentifier: string, logIp: string}>}
 */
async function getServerIdentifiers(interaction, clientId) {
    let serverIdentifier = `サーバー (ID: ${clientId.substring(0, 8)}...)`; // デフォルト
    let logIp = '不明';
    let userName = '不明なユーザー';

    try {
        const connectedServers = getConnectedClients();
        const clientInfo = connectedServers.find(client => client.id === clientId);

        if (clientInfo) {
            logIp = clientInfo.ip;
            const serverIndex = connectedServers.findIndex(client => client.id === clientId);
            if (clientInfo.creatorId) {
                try {
                    const user = await interaction.client.users.fetch(clientInfo.creatorId).catch(() => null);
                    if (user) {
                        userName = user.username; // または user.tag
                    } else {
                        userName = `登録者ID:${clientInfo.creatorId.substring(0, 6)}...`;
                    }
                } catch (fetchError) {
                    // ログは呼び出し元で記録される想定なのでここでは省略
                    userName = `登録者ID:${clientInfo.creatorId.substring(0, 6)}...`;
                }
            }
            serverIdentifier = `${userName} のサーバー${serverIndex !== -1 ? ` ${serverIndex + 1}` : ''}`;
        }
    } catch (error) {
        log('ERROR', 'getServerIdentifiers でエラー発生', { error, clientId, interaction });
    }

    return { serverIdentifier, logIp };
}