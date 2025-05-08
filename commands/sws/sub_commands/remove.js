// commands/sws/sub_commands/remove.js

const fs = require('node:fs').promises;
const { PermissionsBitField, ButtonBuilder, ButtonStyle, ActionRowBuilder } = require('discord.js')
const utils = require('../../../escape/utils') // ユーティリティ関数をインポート
const messages = require('./utility/messages') // メッセージ管理モジュールをインポート
const chalk = require('chalk') // ログの色分け用ライブラリ
const { log, getOrCreateLogThread } = require('../../../utility/text_chat_logger') // ロガーをインポート

// デバッグモードの設定
const DEBUG_MODE = true // true: 詳細なデバッグログを表示, false: 基本的なログのみ

if (DEBUG_MODE) {
    console.log(chalk.blue('[DEBUG] Initializing remove command...'))
} else {
    console.log('[INFO] Initializing remove command...')
}

module.exports = {
    async execute(interaction, serverInstances) {
        // ★ ボタンインタラクションかどうかを判定
        const isButtonInteraction = interaction.isButton();
        let configName;

        if (isButtonInteraction) {
            // ボタンインタラクションの場合、customIdからconfigNameを抽出する
            // confirm_remove_xxxx の形式を想定
            if (interaction.customId.startsWith('confirm_remove_')) {
                configName = interaction.customId.substring('confirm_remove_'.length);
            }
            // cancel_remove の場合は configName は不要 (あるいは別の方法で取得)
        } else {
            // スラッシュコマンドの場合
            configName = interaction.options.getString('name');
        }

        // configName が特定できない場合（主にキャンセルボタン以外で問題が発生した場合）
        // ただし、キャンセルボタンのロジックはこの後にあるため、ここでは主に初期のコマンド実行時を想定
        if (!isButtonInteraction && !configName) {
            log('ERROR', 'removeコマンドでconfigNameが取得できませんでした。', { interaction });
            await interaction.reply({ content: 'コマンドの実行に必要な情報が不足しています。', ephemeral: true });
            return;
        }


        if (DEBUG_MODE && !isButtonInteraction) { // ボタンの時はconfigNameがまだ取れないことがある
            console.log(chalk.blue(`[DEBUG] Attempting to remove server configuration: ${configName}`))
        }

        // ★ スラッシュコマンドの初期実行時のみ実行する処理
        if (!isButtonInteraction) {
            try {
                // 1. 構成名の妥当性をチェック (念のため)
                if (!utils.isValidConfigName(configName)) {
                    await interaction.reply({
                        content: messages.get('ERROR_CONFIG_NAME_INVALID', { invalidName: configName }),
                        ephemeral: false
                    });
                    return;
                }

                // 2. 構成が存在するかチェック
                const configExists = await utils.checkConfigExists(configName);
                if (!configExists) {
                    await interaction.reply({
                        content: messages.get('ERROR_CONFIG_NOT_FOUND', { configName }),
                        ephemeral: false
                    });
                    return;
                }

                // 3. サーバーが起動中でないかチェック
                const serverState = serverInstances.get(configName);
                if (serverState?.isRun) {
                    await interaction.reply({
                        content: messages.get('ERROR_CONFIG_RUNNING', { configName }),
                        ephemeral: false
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
                }

                const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
                const isCreator = creatorId && interaction.user.id === creatorId;

                if (!isAdmin && !isCreator) {
                    await interaction.reply({
                        content: messages.get('ERROR_NO_PERMISSION_REMOVE', { configName, creatorTag: creatorTag || '取得不可' }),
                        ephemeral: false
                    });
                    return;
                }

                // 5. 削除確認のボタンを表示
                const confirmButton = new ButtonBuilder()
                    .setCustomId(`confirm_remove_${configName}`)
                    .setLabel(messages.Buttons.CONFIRM_REMOVE)
                    .setStyle(ButtonStyle.Danger);

                const cancelButton = new ButtonBuilder()
                    .setCustomId(`cancel_remove_${configName}`) // ★ キャンセルボタンにもconfigNameを含める
                    .setLabel(messages.Buttons.CANCEL_REMOVE)
                    .setStyle(ButtonStyle.Secondary);

                const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

                await interaction.reply({
                    content: messages.get('INFO_REMOVE_CONFIRM', { configName }),
                    components: [row],
                    ephemeral: false,
                    fetchReply: true,
                });
                return; // ボタンの応答は別のインタラクションとして処理されるため、ここで一旦終了

            } catch (error) {
                console.error(`Error during initial config removal process (${configName}):`, error);
                const errorMessage = messages.get('ERROR_COMMAND_INTERNAL');
                if (interaction.replied || interaction.deferred) {
                    await interaction.editReply({ content: errorMessage, components: [], ephemeral: false });
                } else {
                    await interaction.reply({ content: errorMessage, components: [], ephemeral: false });
                }
                return;
            }
        }

        // ★ ボタンインタラクションの処理
        if (isButtonInteraction) {
            try {
                // ボタンインタラクションの deferUpdate は、ボタンを押したユーザーへの応答として適切
                await interaction.deferUpdate(); // interaction はこの場合 ButtonInteraction

                if (interaction.customId.startsWith('confirm_remove_')) {
                    // configName はこのスコープの先頭で customId から取得済み
                    await interaction.editReply({ // ButtonInteraction に対して editReply
                        content: messages.get('INFO_REMOVE_STARTING', { configName }),
                        components: []
                    });

                    const configPath = utils.getConfigPath(configName);
                    try {
                        await fs.rm(configPath, { recursive: true, force: true });
                        if (DEBUG_MODE) {
                            console.log(chalk.green(`[DEBUG] Successfully removed configuration: ${configName}`));
                        }
                        await interaction.editReply({
                            content: messages.get('SUCCESS_REMOVE', { configName }),
                            components: []
                        });
                        // followUp は元のインタラクションではなく、新しいメッセージとして送信される
                        await interaction.followUp({ content: `${interaction.user.tag} が構成 "${configName}" を削除しました。`, ephemeral: false });
                    } catch (removeError) {
                        console.error(chalk.red(`Failed to remove directory ${configPath}:`), removeError);
                        await interaction.editReply({
                            content: messages.get('ERROR_DIRECTORY_REMOVE', { configName }),
                            components: []
                        });
                    }
                } else if (interaction.customId.startsWith('cancel_remove_')) {
                    // configName は customId から取得可能だが、このメッセージでは使わない
                    await interaction.editReply({
                        content: messages.get('INFO_REMOVE_CANCELLED'),
                        components: []
                    });
                }
            } catch (e) {
                console.error('Error processing button interaction for remove:', e);
                // ボタンインタラクションの応答が既にタイムアウトなどで失敗している場合がある
                // この時点で editReply が失敗する可能性も考慮
                try {
                    if (e.code === 'InteractionCollectorError' || e.code === 10062 /* Unknown Interaction */) {
                         // タイムアウトや不明なインタラクションの場合は、元のメッセージを編集しようとせず、
                         // 可能であれば新しいメッセージで通知するか、ログに記録するだけにする。
                         // ここでは、元のメッセージのボタンを消す試みはしない。
                        log('WARN', `ボタン応答処理中にエラーまたはタイムアウトが発生しました (remove): ${e.message}`, { customId: interaction.customId });
                        // ユーザーへのフィードバックが難しい場合は、ログのみで対応
                    } else {
                        await interaction.editReply({
                            content: messages.get('ERROR_GENERIC'),
                            components: []
                        });
                    }
                } catch (finalError) {
                    log('ERROR', `ボタンインタラクションの最終エラー応答送信に失敗しました (remove): ${finalError.message}`, { customId: interaction.customId });
                }
            }
        }
    }
};