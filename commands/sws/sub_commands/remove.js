// commands/sws/sub_commands/remove.js

const fs = require('node:fs').promises;
const { PermissionsBitField, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js');
const utils = require('./utility/utils'); // ユーティリティ関数をインポート
const messages = require('./utility/messages'); // メッセージ管理モジュールをインポート

module.exports = {
    async execute(interaction) {
        const configName = interaction.options.getString('name');

        try {
            // 1. 構成名の妥当性をチェック (念のため)
            if (!utils.isValidConfigName(configName)) {
                await interaction.reply({
                    content: messages.get('ERROR_CONFIG_NAME_INVALID', { invalidName: configName }),
                    ephemeral: true
                });
                return;
            }

            // 2. 構成が存在するかチェック
            const configExists = await utils.checkConfigExists(configName);
            if (!configExists) {
                await interaction.reply({
                    content: messages.get('ERROR_CONFIG_NOT_FOUND', { configName }),
                    ephemeral: true
                });
                return;
            }

            // 3. サーバーが起動中でないかチェック
            const windowTitle = `sws_${configName}`; // start.jsに合わせたウィンドウタイトル
            let pid = null;
            try {
                 pid = await utils.findServerPidByTitle(windowTitle);
            } catch(pidError) {
                console.error(`Error checking server status for removal (${configName}):`, pidError);
                 await interaction.reply({
                     content: messages.get('ERROR_TASKLIST_FAILED'), // プロセス確認失敗エラー
                     ephemeral: true
                 });
                 return;
            }

            if (pid) {
                await interaction.reply({
                    content: messages.get('ERROR_CONFIG_RUNNING', { configName, pid }),
                    ephemeral: true
                });
                return;
            }

            // 4. 削除権限を確認 (管理者 または 構成の作成者)
            let creatorId = null;
            let creatorTag = '不明';
            try {
                const metadata = await utils.readMetadata(configName);
                creatorId = metadata?.creator_id?.[0];
                if (creatorId) {
                    try {
                        const creator = await interaction.client.users.fetch(creatorId);
                        creatorTag = creator.tag;
                    } catch { /* ignore fetch error */ }
                }
            } catch (metaError) {
                console.warn(`Could not read metadata for permission check (${configName}): ${metaError.message}`);
                // メタデータ読めなくても管理者は削除可能
            }

            const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
            const isCreator = creatorId && interaction.user.id === creatorId;

            if (!isAdmin && !isCreator) {
                await interaction.reply({
                    content: messages.get('ERROR_NO_PERMISSION_REMOVE', { configName, creatorTag: creatorTag || '取得不可' }),
                    ephemeral: true
                });
                return;
            }

            // 5. 削除確認のボタンを表示
            const confirmButton = new ButtonBuilder()
                .setCustomId(`confirm_remove_${configName}`) // customIdに構成名を含めて一意にする
                .setLabel(messages.Buttons.CONFIRM_REMOVE) // messages.jsからラベル取得
                .setStyle(ButtonStyle.Danger);

            const cancelButton = new ButtonBuilder()
                .setCustomId('cancel_remove')
                .setLabel(messages.Buttons.CANCEL) // messages.jsからラベル取得
                .setStyle(ButtonStyle.Secondary);

            const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

            // 確認メッセージを送信 (ephemeral: true で本人にのみ表示)
            const reply = await interaction.reply({
                content: messages.get('INFO_REMOVE_CONFIRM', { configName }),
                components: [row],
                ephemeral: true,
                fetchReply: true, // メッセージオブジェクトを取得するため
            });

            // ボタンの応答を待つフィルター (押したユーザーがコマンド実行者であり、対象メッセージのボタンであること)
            const collectorFilter = i => i.user.id === interaction.user.id && i.message.id === reply.id;

            try {
                // ボタン応答を60秒待つ
                const confirmation = await reply.awaitMessageComponent({ filter: collectorFilter, time: 60_000 });

                // interactionの更新（ボタンのローディング解除）
                await confirmation.deferUpdate();

                if (confirmation.customId === `confirm_remove_${configName}`) {
                    // 「はい、削除します」が押された場合
                    await interaction.editReply({
                        content: messages.get('INFO_REMOVE_STARTING', { configName }),
                        components: [] // ボタンを消す
                    });

                    // 6. 構成ディレクトリを再帰的に削除
                    const configPath = utils.getConfigPath(configName);
                    try {
                        await fs.rm(configPath, { recursive: true, force: true });
                        await interaction.editReply({
                            content: messages.get('SUCCESS_REMOVE', { configName }),
                            components: []
                        });
                        // 必要であれば公開チャンネルに削除完了を通知
                        await interaction.followUp({ content: `${interaction.user.tag} が構成 "${configName}" を削除しました。`, ephemeral: false });
                    } catch(removeError) {
                        console.error(`Failed to remove directory ${configPath}:`, removeError);
                        await interaction.editReply({
                            content: messages.get('ERROR_DIRECTORY_REMOVE', { configName }),
                            components: []
                        });
                    }

                } else if (confirmation.customId === 'cancel_remove') {
                    // 「キャンセル」が押された場合
                    await interaction.editReply({
                        content: messages.get('INFO_REMOVE_CANCELLED'),
                        components: []
                    });
                }

            } catch (e) {
                // awaitMessageComponent がタイムアウトした場合 (InteractionCollectorError)
                if (e.code === 'InteractionCollectorError') {
                    await interaction.editReply({
                        content: messages.get('INFO_REMOVE_TIMEOUT'),
                        components: [] // タイムアウト後もボタンは消す
                    });
                } else {
                    // その他の予期せぬエラー
                    console.error('Error awaiting button confirmation:', e);
                    await interaction.editReply({
                        content: messages.get('ERROR_GENERIC'), // 汎用エラーメッセージ
                        components: []
                    });
                }
            }

        } catch (error) {
            // このtryブロック全体での予期せぬエラー
            console.error(`Error during config removal process (${configName}):`, error);
            const errorMessage = messages.get('ERROR_COMMAND_INTERNAL');

            // エラー発生時も応答を試みる
            try {
                 // ボタン応答待ちの後などで interaction が更新されている可能性があるため editReply を使う
                 // ephemeral は true のまま
                await interaction.editReply({ content: errorMessage, components: [], ephemeral: false });
            } catch (replyError) {
                 // editReply すら失敗した場合
                console.error("Failed to send final error reply to user:", replyError);
            }
        }
    }
};