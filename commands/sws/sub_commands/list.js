// commands/sws/sub_commands/list.js

const fs = require('node:fs').promises;
const path = require('node:path');
const { EmbedBuilder } = require('discord.js');
const utils = require('./utility/utils'); // ユーティリティ関数をインポート
const config = require('./utility/registry'); // 設定情報をインポート
const messages = require('./utility/messages'); // メッセージ管理モジュールをインポート

const configBaseDir = config.configBasePath; // 構成が保存されるベースディレクトリ

module.exports = {
    async execute(interaction) {
        try {
            // 処理に時間がかかる可能性があるため、応答を保留
            await interaction.deferReply();

            // 構成ディレクトリを読み込む
            let entries;
            try {
                entries = await fs.readdir(configBaseDir, { withFileTypes: true });
            } catch (readDirError) {
                 console.error(`Failed to read config directory: ${configBaseDir}`, readDirError);
                 await interaction.editReply({
                    content: messages.get('ERROR_DIRECTORY_READ'),
                    ephemeral: true
                 });
                 return;
            }

            const configDirs = entries.filter(entry => entry.isDirectory());

            // 構成が存在しない場合
            if (configDirs.length === 0) {
                await interaction.editReply({content:messages.get('INFO_LIST_EMPTY'), ephemeral: true});
                return;
            }

            // Embedを作成してリスト表示
            const embed = new EmbedBuilder()
                .setTitle('サーバー構成リスト')
                .setColor(0x00AAFF); // 見やすい色を設定

            // 各構成の詳細情報を非同期で取得
            const configPromises = configDirs.map(async (dir) => {
                const configName = dir.name;
                let creatorName = '不明'; // デフォルト値
                let status = '停止中'; // デフォルト値
                let pid = null;

                // メタデータから作成者情報を取得試行
                try {
                    const metadata = await utils.readMetadata(configName);
                    const creatorId = metadata?.creator_id?.[0]; // xml2jsは配列に入れるため[0]
                    if (creatorId) {
                        try {
                            // Discord APIからユーザー情報を取得
                            const creator = await interaction.client.users.fetch(creatorId);
                            creatorName = creator.tag; // 例: user#1234
                        } catch (fetchError) {
                            console.warn(`Failed to fetch user ${creatorId} for config ${configName}: ${fetchError.message}`);
                            creatorName = `不明 (${creatorId})`; // 取得失敗時の表示
                        }
                    }
                } catch (metaError) {
                    // メタデータ読み込みエラー（ファイル欠損など）は警告ログに
                    console.warn(`Could not read metadata for ${configName}: ${metaError.message}`);
                     // creatorName は '不明' のまま
                }

                // プロセスリストからサーバーの実行状態を確認試行
                try {
                    const windowTitle = `sws_${configName}`; // start.js で定義されるウィンドウタイトル
                    pid = await utils.findServerPidByTitle(windowTitle);
                    if (pid) {
                        status = `起動中 (PID: ${pid})`;
                    }
                    // pid が null なら status は '停止中' のまま
                } catch (pidError) {
                    console.error(`Error checking status for ${configName}:`, pidError);
                    status = '状態確認エラー'; // プロセス確認自体に失敗した場合
                }

                // Embedフィールド用のオブジェクトを返す
                return {
                    name: configName, // フィールド名 (構成名)
                    value: `作成者: ${creatorName}\n状態: ${status}`, // フィールド値
                    inline: false // 各構成情報を縦に並べる
                };
            });

            // 全ての構成情報の取得が完了するのを待つ
            const configFields = await Promise.all(configPromises);

            // 構成名でアルファベット順にソート
            configFields.sort((a, b) => a.name.localeCompare(b.name));

            // Embedにフィールドを追加 (最大25個の制限に注意)
            embed.addFields(configFields.slice(0, 25));
            if (configFields.length > 25) {
                // 25件を超える場合はフッターで通知
                embed.setFooter({ text: messages.get('INFO_LIST_LIMIT', { count: configFields.length }) });
            }

            // 最終的なEmbedを返信する
            await interaction.editReply({ embeds: [embed], ephemeral: true }); // ephemeral: false で全員に表示

        } catch (error) {
            // 予期せぬエラーが発生した場合の処理
            console.error('Error listing server configs:', error);
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