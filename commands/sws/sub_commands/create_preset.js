// commands/utility/sws/create_preset.js
const {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType
} = require('discord.js');
const path = require('node:path');
const fs = require('node:fs').promises; // fs.promises を使用
const xml2js = require('xml2js');
const utils = require('./utility/utils');
const msg = require('./utility/messages');
const presets = require('./utility/presets'); // プリセット定義をインポート

const parser = new xml2js.Parser();
const builder = new xml2js.Builder();

// プリセットからドロップダウンオプションを生成するヘルパー関数
function createSelectOptions(presetArray) {
    return presetArray.map(p =>
        new StringSelectMenuOptionBuilder()
            .setLabel(p.name.substring(0, 100)) // ラベルは100文字制限
            .setDescription((p.description || '説明なし').substring(0, 100)) // 説明も100文字制限
            .setValue(p.value.substring(0, 100)) // 値も100文字制限
    );
}

/**
 * server_config.xml を読み込み、プリセット内容で playlists と mods を更新する関数
 * @param {string} configName 設定名
 * @param {string} selectedAddonPresetValue 選択されたアドオンプリセットの value
 * @param {string} selectedModPresetValue 選択されたModプリセットの value
 */
async function updateXmlWithPresets(configName, selectedAddonPresetValue, selectedModPresetValue) {
    const configFilePath = path.join(utils.getConfigPath(configName), 'server_config.xml');
    console.log(`[DEBUG] Updating XML for ${configName} at ${configFilePath}`);

    try {
        const addonPreset = presets.addonPresets.find(p => p.value === selectedAddonPresetValue);
        const modPreset = presets.modPresets.find(p => p.value === selectedModPresetValue);

        if (!addonPreset || !modPreset) {
            throw new Error(`選択されたプリセットが見つかりません (Addon: ${selectedAddonPresetValue}, Mod: ${selectedModPresetValue})`);
        }
        console.log(`[DEBUG] Found addon preset: ${addonPreset.name}, Found mod preset: ${modPreset.name}`);


        const xmlData = await fs.readFile(configFilePath, 'utf-8');
        const result = await parser.parseStringPromise(xmlData);

        if (!result.server_data) result.server_data = {};

        // --- <playlists> の更新 ---
        // 既存の playlists をクリアし、選択されたプリセットの内容で再構築
        result.server_data.playlists = [{ // playlists 要素は配列の中にオブジェクトが1つある形式
            path: addonPreset.playlists.map(p => ({ $: { path: p } })) // path要素の配列に変換
        }];
        console.log(`[DEBUG] Set playlists for ${configName} to ${addonPreset.playlists.length} items.`);

        // --- <mods> の更新 ---
        // 既存の mods をクリアし、選択されたプリセットの内容で再構築
        const modsContent = []; // <mods> の中身 (path または published_id の配列)
        if (modPreset.mods && modPreset.mods.length > 0) {
            const pathElements = [];
            const idElements = [];
            modPreset.mods.forEach(mod => {
                if (mod.type === 'published_id') {
                    idElements.push({ $: { value: mod.value } });
                } else if (mod.type === 'path') {
                    pathElements.push({ $: { path: mod.value } });
                }
            });
             // path要素とpublished_id要素を含むオブジェクトを作成
             // (StormworksのXML構造によっては、pathとpublished_idがmods直下に混在する場合と、
             // mods要素が複数になる場合があるので、実際のXML構造に合わせて調整が必要な可能性あり)
             // ここでは、path要素の配列を持つオブジェクトと、published_id要素の配列を持つオブジェクトを
             // modsContent 配列に入れる単純な例を示す。
            if (pathElements.length > 0) modsContent.push({ path: pathElements });
            if (idElements.length > 0) modsContent.push({ published_id: idElements });
        }
        result.server_data.mods = modsContent; // mods要素はオブジェクトの配列とする
        console.log(`[DEBUG] Set mods for ${configName} to ${modPreset.mods.length} items.`);


        const updatedXml = builder.buildObject(result);
        await fs.writeFile(configFilePath, updatedXml);
        console.log(`[INFO] Successfully updated server_config.xml for ${configName} with presets.`);

    } catch (error) {
        console.error(`[ERROR] Failed to update server_config.xml for ${configName}:`, error);
        throw new Error(`設定ファイル (server_config.xml) の更新に失敗しました。理由: ${error.message}`);
    }
}


module.exports = {
    async execute(interaction) {
        const configName = interaction.options.getString('name');
        const defaultTemplate = 'default'; // ベースにするテンプレート名

        try {
            // 1. 設定名のバリデーションと重複チェック
            if (!utils.isValidConfigName(configName)) {
                await interaction.reply({ content: msg.get('ERROR_CONFIG_NAME_INVALID', { invalidName: configName }), ephemeral: true });
                return;
            }
            const configExists = await utils.checkConfigExists(configName);
            if (configExists) {
                await interaction.reply({ content: msg.get('ERROR_CONFIG_ALREADY_EXISTS', { configName: configName }), ephemeral: true });
                return;
            }
             // ベーステンプレート存在チェック
             const templateExists = await utils.checkTemplateExists(defaultTemplate);
             if (!templateExists) {
                 await interaction.reply({ content: msg.get('ERROR_TEMPLATE_NOT_FOUND', { templateName: defaultTemplate }), ephemeral: true });
                 return;
             }


            // 2. ドロップダウンメニューの作成
            const addonSelect = new StringSelectMenuBuilder()
                .setCustomId('select_addon_preset')
                .setPlaceholder('アドオンプリセットを選択...')
                .addOptions(createSelectOptions(presets.addonPresets));

            const modSelect = new StringSelectMenuBuilder()
                .setCustomId('select_mod_preset')
                .setPlaceholder('Modプリセットを選択...')
                .addOptions(createSelectOptions(presets.modPresets));

            // 3. ボタンの作成
            const confirmButton = new ButtonBuilder()
                .setCustomId('confirm_preset_create')
                .setLabel('構成を作成')
                .setStyle(ButtonStyle.Success)
                .setDisabled(true); //最初は無効。両方選択されたら有効にする

            const cancelButton = new ButtonBuilder()
                .setCustomId('cancel_preset_create')
                .setLabel(msg.Buttons.CANCEL) // messages.jsから取得
                .setStyle(ButtonStyle.Secondary);

            // 4. ActionRow の作成
            const addonRow = new ActionRowBuilder().addComponents(addonSelect);
            const modRow = new ActionRowBuilder().addComponents(modSelect);
            const buttonRow = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

            // 5. メッセージの送信
            const reply = await interaction.reply({
                content: `**${configName}** の構成を作成します。\nアドオンとModのプリセットを選択してください:`,
                components: [addonRow, modRow, buttonRow],
                ephemeral: true, // 本人にのみ表示
                fetchReply: true,
            });

            // 6. ユーザーの操作を待つ Collector の設定
            const collector = reply.createMessageComponentCollector({
                // ComponentType を配列で指定
                componentType: [ComponentType.StringSelect, ComponentType.Button],
                time: 5 * 60 * 1000 // 5分間待つ
            });

            let selectedAddonValue = null;
            let selectedModValue = null;

            collector.on('collect', async i => {
                try {
                    // 同じユーザーからの操作か確認
                    if (i.user.id !== interaction.user.id) {
                        await i.reply({ content: 'この操作はコマンドを実行した本人しか行えません。', ephemeral: true });
                        return;
                    }

                    if (i.isStringSelectMenu()) {
                        // ドロップダウンが選択された
                        if (i.customId === 'select_addon_preset') {
                            selectedAddonValue = i.values[0];
                            console.log(`[DEBUG] Addon preset selected: ${selectedAddonValue}`);
                        } else if (i.customId === 'select_mod_preset') {
                            selectedModValue = i.values[0];
                            console.log(`[DEBUG] Mod preset selected: ${selectedModValue}`);
                        }

                        // 両方選択されたら作成ボタンを有効化
                        confirmButton.setDisabled(!(selectedAddonValue && selectedModValue));
                        await i.update({ components: [addonRow, modRow, buttonRow] }); // メッセージを更新してボタンの状態を反映

                    } else if (i.isButton()) {
                        // ボタンが押された
                        if (i.customId === 'confirm_preset_create') {
                            // --- 作成処理 ---
                            if (!selectedAddonValue || !selectedModValue) {
                                await i.update({ content: 'エラー: アドオンとModの両方のプリセットを選択してください。', components: [] });
                                collector.stop('incomplete');
                                return;
                            }
                            await i.update({ content: msg.get('INFO_CREATE_STARTING', {configName: configName, templateName: `プリセット(${selectedAddonValue}/${selectedModValue})`}), components: [] }); // 処理中メッセージ + コンポーネント削除
                            collector.stop('confirmed'); // Collector を停止

                            // テンプレートコピー
                            const templatePath = utils.getTemplatePath(defaultTemplate);
                            const newConfigPath = utils.getConfigPath(configName);
                            await utils.copyDirectoryRecursive(templatePath, newConfigPath);

                            // ポート割り当て
                            const usedPorts = await utils.getUsedPorts();
                            const availablePort = utils.findAvailablePort(utils.MIN_PORT, utils.MAX_PORT, usedPorts);
                            if (availablePort === null) {
                                // エラー処理: 利用可能なポートがない
                                await fs.rm(newConfigPath, { recursive: true, force: true }); // 作成したディレクトリを削除
                                await interaction.followUp({ content: msg.get('ERROR_PORT_NOT_AVAILABLE', { minPort: utils.MIN_PORT, maxPort: utils.MAX_PORT }), ephemeral: true});
                                return;
                            }
                            await utils.updateConfigXmlPort(configName, availablePort); // ポート更新

                            // XMLにプリセット内容を反映 ★★★
                            await updateXmlWithPresets(configName, selectedAddonValue, selectedModValue);

                            // メタデータ作成
                            await utils.writeMetadata(configName, interaction.user.id);

                            // 最終的な成功メッセージ
                            await interaction.followUp({ content: msg.get('SUCCESS_CREATE', { configName: configName, templateName: `プリセット(${selectedAddonValue}/${selectedModValue})`, port: availablePort }), ephemeral: false }); // 成功時は公開

                        } else if (i.customId === 'cancel_preset_create') {
                            await i.update({ content: msg.get('INFO_REMOVE_CANCELLED').replace('削除','作成'), components: [] });
                            collector.stop('cancelled');
                        }
                    }
                } catch (error) {
                     console.error('[ERROR] Error processing component interaction:', error);
                     // 処理中にエラーが発生した場合のフォールバック
                     await i.update({ content: msg.get('ERROR_GENERIC') + `\n\`${error.message}\`` , components: [] }).catch(console.error);
                     collector.stop('error');
                }
            });

            collector.on('end', (collected, reason) => {
                if (reason === 'time') {
                    interaction.editReply({ content: msg.get('ERROR_INTERACTION_TIMEOUT'), components: [] }).catch(console.error);
                } else if (reason !== 'confirmed' && reason !== 'cancelled' && reason !== 'incomplete' && reason !== 'error') {
                    // 予期せぬ理由で終了した場合
                     interaction.editReply({ content: msg.get('ERROR_GENERIC'), components: [] }).catch(console.error);
                }
                // 'confirmed', 'cancelled', 'incomplete', 'error' の場合は個別処理済み
                 console.log(`[DEBUG] Preset collector ended. Reason: ${reason}`);
            });

        } catch (error) {
            console.error(`[ERROR] Failed to execute create_preset for ${configName}:`, error);
            const replyContent = msg.get('ERROR_COMMAND_INTERNAL') + `\n\`\`\`${error.message}\`\`\``;
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: replyContent, ephemeral: true }).catch(console.error);
            } else {
                await interaction.reply({ content: replyContent, ephemeral: true }).catch(console.error);
            }
        }
    }
};