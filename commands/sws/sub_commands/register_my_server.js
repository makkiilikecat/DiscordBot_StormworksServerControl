// [ルート]/commands/sws/sub_commands/register_my_server.js

const { SlashCommandSubcommandBuilder } = require('discord.js');
const tokenManager = require('./utility/token_manager');
const { log, getOrCreateLogThread } = require('../../../utility/text_chat_logger'); // ロガー追加

module.exports = {
    async execute(interaction) {
        const logThread = await getOrCreateLogThread(interaction); // ログスレッド取得
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.user.id;
        // ★ Stage 8: オプションから物理サーバー名を取得
        try {
            ownerName = interaction.user.displayName || user.username; // ディスプレイ名を優先
            ownerMention = interaction.user.toString(); // <@USER_ID>
        } catch {
            ownerName = `ID:${client.creatorId.substring(0, 6)}...`;
        }
        serverName = interaction.options.getString('server_name') || `[${ownerName}のサーバー]`;

        log('INFO', `[登録] サーバー登録リクエスト受信: User=${interaction.user.tag}, ServerName=${serverName}`, { interaction, thread: logThread });

        try {

            // ★ Stage 8: saveToken に serverName を渡す
            const result = await tokenManager.saveToken(userId, serverName);

            if (result.success && result.token) {
                try {
                    const dmChannel = await interaction.user.createDM();
                    await dmChannel.send(
                        `サーバー登録ありがとうございます。\n` +
                        `物理サーバー名: **${serverName}**\n` +
                        `あなたの認証トークンは以下になります。物理サーバー側のクライアント設定で使用してください。\n` +
                        `\`\`\`${result.token}\`\`\`\n` +
                        `**このトークンは他人に教えないでください。**\n` +
                        `このトークンは${process.env.UNUSED_TOKEN_EXPIRY_DAYS || 3}日以内に初回接続されない場合自動的に削除されます。`
                    );
                    await interaction.editReply('認証トークンをDMに送信しました。ご確認ください。');
                    log('INFO', `[登録] ユーザー ${interaction.user.tag} (${userId}) にトークン送信完了 (ServerName: ${serverName})。`, { interaction, thread: logThread });
                } catch (dmError) {
                    log('ERROR', `[登録] ユーザー ${interaction.user.tag} へのDM送信失敗。`, { error: dmError, interaction, thread: logThread });
                    await interaction.editReply('トークン生成成功、DM送信失敗。\nDiscord設定でDM許可を確認してください。\n生成トークンは管理者ログ参照。');
                    console.error(`[登録] DM送信失敗: User=${userId}, ServerName=${serverName}, Token=${result.token}`); // コンソールには出す
                }
            } else {
                log('WARN', `[登録] トークン生成または保存失敗。User=${interaction.user.tag}, ServerName=${serverName}`, { error: result.error, interaction, thread: logThread });
                await interaction.editReply(`トークンの生成/保存失敗。\nエラー: ${result.error || '不明なエラー'}`);
            }
        } catch (error) {
            log('ERROR', '[登録] サーバー登録処理中に予期せぬエラー発生。', { error, interaction, thread: logThread });
            await interaction.editReply('サーバー登録処理中に予期せぬエラーが発生しました。');
        }
    },
};