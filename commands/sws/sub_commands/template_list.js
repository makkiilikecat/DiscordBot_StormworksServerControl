// commands/sws/sub_commands/template_list.js

const fs = require('node:fs').promises;
const path = require('node:path');
const { EmbedBuilder } = require('discord.js');
const utils = require('./utility/utils'); // ユーティリティ関数をインポート
const config = require('./utility/registry'); // 設定情報をインポート
const messages = require('./utility/messages'); // メッセージ管理モジュールをインポート

module.exports = {
    async execute(interaction) {
        try {
            // 1. 応答を保留
            await interaction.deferReply();

            // 2. テンプレートが格納されているベースディレクトリを取得
            const templateBaseDir = config.templateBasePath;
            let entries;
            try {
                entries = await fs.readdir(templateBaseDir, { withFileTypes: true });
            } catch (readDirError) {
                 console.error(`Failed to read template directory: ${templateBaseDir}`, readDirError);
                 // ディレクトリ自体が読めない場合はエラーメッセージを表示
                 await interaction.editReply({
                     content: messages.get('ERROR_DIRECTORY_READ'), // 適切なエラーメッセージキーに変更も可
                     ephemeral: true
                 });
                 return;
            }

            // 3. ディレクトリエントリのみをフィルタリング
            const templateDirs = entries.filter(entry => entry.isDirectory());

            // 4. 利用可能なテンプレートがない場合
            if (templateDirs.length === 0) {
                await interaction.editReply(messages.get('INFO_TEMPLATE_LIST_EMPTY'));
                return;
            }

            // 5. Embedを作成してテンプレートリストを表示
            const embed = new EmbedBuilder()
                .setTitle('利用可能なテンプレートリスト')
                .setColor(0x00FFAA); // 見やすい色を設定 (緑系)

            // 6. 各テンプレートの名前と説明を非同期で取得
            const templatePromises = templateDirs.map(async (dir) => {
                const templateName = dir.name;
                // utils.readDescription で description.txt を読み込む (存在しない/読めない場合はフォールバック文字列が返る)
                const description = await utils.readDescription(templateName);
                return {
                    name: templateName,       // フィールド名 (テンプレート名)
                    value: description,       // フィールド値 (説明文)
                    inline: false           // 各テンプレート情報を縦に並べる
                };
            });

            // 7. 全てのテンプレート情報の取得が完了するのを待つ
            const templateFields = await Promise.all(templatePromises);

            // 8. テンプレート名でアルファベット順にソート
            templateFields.sort((a, b) => a.name.localeCompare(b.name));

            // 9. Embedにフィールドを追加 (最大25個の制限に注意)
            embed.addFields(templateFields.slice(0, 25));
            if (templateFields.length > 25) {
                // 25件を超える場合はフッターで通知
                embed.setFooter({ text: messages.get('INFO_LIST_LIMIT', { count: templateFields.length }) });
            }

            // 10. 最終的なEmbedを返信する
            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            // 予期せぬエラーが発生した場合の処理
            console.error('Error listing templates:', error);
            const errorMessage = messages.get('ERROR_COMMAND_INTERNAL');

            // 応答が保留中か既に返信済みかで対応を分岐
            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({ content: errorMessage, ephemeral: true });
                } else {
                    await interaction.reply({ content: errorMessage, ephemeral: true });
                }
            } catch (replyError) {
                console.error("Failed to send error reply to user:", replyError);
            }
        }
    }
};