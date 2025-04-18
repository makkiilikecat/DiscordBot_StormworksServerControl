// commands/sws/subcommands/register_my_server.js

const { SlashCommandSubcommandBuilder } = require('discord.js');
const tokenManager = require('./utility/token_manager'); // トークン管理ユーティリティ

module.exports = {
    // サブコマンドの定義
    data: new SlashCommandSubcommandBuilder()
        .setName('register_my_server')
        .setDescription('あなたの物理サーバーをBotに登録し、認証トークンを取得します。'),

    // コマンド実行時の処理
    async execute(interaction) {
        // 処理中であることをユーザーに示す (ephemeral: true で本人にのみ表示)
        await interaction.deferReply({ ephemeral: true });

        const userId = interaction.user.id; // コマンド実行者のDiscord IDを取得

        try {
            // トークンを生成・保存
            const result = await tokenManager.saveToken(userId);

            if (result.success && result.token) {
                // 成功した場合、DMでトークンを送信
                try {
                    const dmChannel = await interaction.user.createDM();
                    await dmChannel.send(`サーバー登録ありがとうございます。\nあなたの認証トークンは以下になります。物理サーバー側の設定で使用してください。\n\`\`\`${result.token}\`\`\`\n**このトークンは他人に教えないでください。**\nこのトークンは初回接続が行われるまで、${process.env.UNUSED_TOKEN_EXPIRY_DAYS || 3}日後に自動的に削除されます。`);

                    // 元のインタラクションに成功メッセージを送信
                    await interaction.editReply('認証トークンをDMに送信しました。ご確認ください。');
                    console.log(`ユーザー ${interaction.user.tag} (${userId}) にトークンをDMで送信しました。`);
                } catch (dmError) {
                    // DM送信に失敗した場合 (ユーザーがDMを拒否しているなど)
                    console.error(`ユーザー ${interaction.user.tag} へのDM送信に失敗しました:`, dmError);
                    await interaction.editReply('トークンの生成には成功しましたが、DMの送信に失敗しました。\nDiscordの設定で「サーバーメンバーからのダイレクトメッセージを許可する」が有効になっているか確認してください。\n生成されたトークンはコンソールログに出力されています（管理者向け）。');
                    // 管理者向けにコンソールにもトークンを表示（本番環境では注意）
                    console.error(`DM送信失敗: ユーザー ${userId} のトークン: ${result.token}`);
                }
            } else {
                // トークン保存に失敗した場合
                await interaction.editReply(`トークンの生成または保存に失敗しました。\nエラー: ${result.error || '不明なエラー'}`);
            }
        } catch (error) {
            // 予期せぬエラーが発生した場合
            console.error('サーバー登録処理中にエラーが発生しました:', error);
            await interaction.editReply('サーバー登録処理中に予期せぬエラーが発生しました。');
        }
    },
};