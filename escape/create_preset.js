// commands/utility/sws/create_preset.js
const {
    ActionRowBuilder,
    StringSelectMenuBuilder,
    StringSelectMenuOptionBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType
} = require('discord.js')
const path = require('node:path')
const fs = require('node:fs').promises // fs.promises を使用
const xml2js = require('xml2js')
const utils = require('../commands/sws/sub_commands/utility/utils')
const msg = require('../commands/sws/sub_commands/utility/messages')
const presets = require('../commands/sws/sub_commands/utility/presets') // プリセット定義をインポート

const parser = new xml2js.Parser()
const builder = new xml2js.Builder()

// プリセットからドロップダウンオプションを生成するヘルパー関数
function createSelectOptions(presetArray) {
    return presetArray.map(p =>
        new StringSelectMenuOptionBuilder()
            .setLabel(p.name.substring(0, 100)) // ラベルは100文字制限
            .setDescription((p.description || '説明なし').substring(0, 100)) // 説明も100文字制限
            .setValue(p.value.substring(0, 100)) // 値も100文字制限
    )
}

/**
 * server_config.xml を読み込み、複数のプリセット内容で playlists と mods を更新する関数
 * @param {string} configName 設定名
 * @param {string[]} selectedAddonPresetValues 選択されたアドオンプリセットの values
 * @param {string[]} selectedModPresetValues 選択されたModプリセットの values
 */
async function updateXmlWithPresets(configName, selectedAddonPresetValues, selectedModPresetValues) {
    const configFilePath = path.join(utils.getConfigPath(configName), 'server_config.xml')
    console.log(`[DEBUG] Updating XML for ${configName} at ${configFilePath}`)

    try {
        const addonPresets = presets.addonPresets.filter(p => selectedAddonPresetValues.includes(p.value))
        const modPresets = presets.modPresets.filter(p => selectedModPresetValues.includes(p.value))

        if (addonPresets.length === 0 || modPresets.length === 0) {
            throw new Error(`選択されたプリセットが見つかりません (Addon: ${selectedAddonPresetValues}, Mod: ${selectedModPresetValues})`)
        }
        console.log(`[DEBUG] Found addon presets: ${addonPresets.map(p => p.name).join(', ')}, Found mod presets: ${modPresets.map(p => p.name).join(', ')}`)

        const xmlData = await fs.readFile(configFilePath, 'utf-8')
        const result = await parser.parseStringPromise(xmlData)

        if (!result.server_data) result.server_data = {}

        // --- <playlists> の更新 ---
        const playlistPaths = addonPresets.flatMap(p => p.playlists)
        result.server_data.playlists = [{
            path: playlistPaths.map(p => ({ $: { path: p } }))
        }]
        console.log(`[DEBUG] Set playlists for ${configName} to ${playlistPaths.length} items.`)

        // --- <mods> の更新 ---
        const modsContent = []
        const pathElements = []
        const idElements = []
        modPresets.forEach(preset => {
            preset.mods.forEach(mod => {
                if (mod.type === 'published_id') {
                    idElements.push({ $: { value: mod.value } })
                } else if (mod.type === 'path') {
                    pathElements.push({ $: { path: mod.value } })
                }
            })
        })
        if (pathElements.length > 0) modsContent.push({ path: pathElements })
        if (idElements.length > 0) modsContent.push({ published_id: idElements })
        result.server_data.mods = modsContent;
        console.log(`[DEBUG] Set mods for ${configName} to ${pathElements.length + idElements.length} items.`)

        const updatedXml = builder.buildObject(result)
        await fs.writeFile(configFilePath, updatedXml)
        console.log(`[INFO] Successfully updated server_config.xml for ${configName} with presets.`)

    } catch (error) {
        console.error(`[ERROR] Failed to update server_config.xml for ${configName}:`, error)
        throw new Error(`設定ファイル (server_config.xml) の更新に失敗しました。理由: ${error.message}`)
    }
}

module.exports = {
    async execute(interaction) {
        const configName = interaction.options.getString('name')
        const defaultTemplate = 'default'

        try {
            if (!utils.isValidConfigName(configName)) {
                await interaction.reply({ content: msg.get('ERROR_CONFIG_NAME_INVALID', { invalidName: configName }), ephemeral: false })
                return
            }
            const configExists = await utils.checkConfigExists(configName)
            if (configExists) {
                await interaction.reply({ content: msg.get('ERROR_CONFIG_ALREADY_EXISTS', { configName: configName }), ephemeral: false })
                return
            }
            const templateExists = await utils.checkTemplateExists(defaultTemplate)
            if (!templateExists) {
                await interaction.reply({ content: msg.get('ERROR_TEMPLATE_NOT_FOUND', { templateName: defaultTemplate }), ephemeral: false })
                return
            }

            const addonSelect = new StringSelectMenuBuilder()
                .setCustomId('select_addon_preset')
                .setPlaceholder('アドオンプリセットを選択...')
                .setMinValues(1)
                .setMaxValues(presets.addonPresets.length)
                .addOptions(createSelectOptions(presets.addonPresets))

            const modSelect = new StringSelectMenuBuilder()
                .setCustomId('select_mod_preset')
                .setPlaceholder('Modプリセットを選択...')
                .setMinValues(1)
                .setMaxValues(presets.modPresets.length)
                .addOptions(createSelectOptions(presets.modPresets))

            const confirmButton = new ButtonBuilder()
                .setCustomId('confirm_preset_create')
                .setLabel('構成を作成')
                .setStyle(ButtonStyle.Success)
                .setDisabled(true)

            const cancelButton = new ButtonBuilder()
                .setCustomId('cancel_preset_create')
                .setLabel(msg.Buttons.CANCEL)
                .setStyle(ButtonStyle.Secondary)

            const addonRow = new ActionRowBuilder().addComponents(addonSelect)
            const modRow = new ActionRowBuilder().addComponents(modSelect)
            const buttonRow = new ActionRowBuilder().addComponents(confirmButton, cancelButton)

            const reply = await interaction.reply({
                content: `**${configName}** の構成を作成します。アドオンとModのプリセットを選択してください:`,
                components: [addonRow, modRow, buttonRow],
                ephemeral: false,
                fetchReply: true,
            })

            const collector = reply.createMessageComponentCollector({
                componentType: [ComponentType.StringSelect, ComponentType.Button],
                time: 5 * 60 * 1000
            })

            let selectedAddonValues = []
            let selectedModValues = []

            collector.on('collect', async i => {
                try {
                    console.log(`[DEBUG] Interaction collected: ${i.customId}`) // デバッグログ追加
                    console.log(`[DEBUG] Interaction type: ${i.type}`)
                    console.log(`[DEBUG] User ID: ${i.user.id}`)

                    if (i.user.id !== interaction.user.id) {
                        console.log(`[DEBUG] Interaction rejected: User ID mismatch.`)
                        await i.reply({ content: 'この操作はコマンドを実行した本人しか行えません。', ephemeral: false })
                        return
                    }

                    if (i.isStringSelectMenu()) {
                        console.log(`[DEBUG] StringSelectMenu interaction: ${i.customId}`)
                        if (i.customId === 'select_addon_preset') {
                            selectedAddonValues = i.values;
                            console.log(`[DEBUG] Addon presets selected: ${selectedAddonValues}`)
                        } else if (i.customId === 'select_mod_preset') {
                            selectedModValues = i.values;
                            console.log(`[DEBUG] Mod presets selected: ${selectedModValues}`)
                        }

                        confirmButton.setDisabled(!(selectedAddonValues.length > 0 && selectedModValues.length > 0))
                        console.log(`[DEBUG] Confirm button state: ${confirmButton.data.disabled ? 'Disabled' : 'Enabled'}`)
                        await i.update({ components: [addonRow, modRow, buttonRow] })

                    } else if (i.isButton()) {
                        console.log(`[DEBUG] Button interaction: ${i.customId}`)
                        if (i.customId === 'confirm_preset_create') {
                            if (selectedAddonValues.length === 0 || selectedModValues.length === 0) {
                                console.log(`[DEBUG] Confirm button pressed with incomplete selection.`)
                                await i.update({ content: 'エラー: アドオンとModの両方のプリセットを選択してください。', components: [] })
                                collector.stop('incomplete')
                                return
                            }
                            console.log(`[DEBUG] Confirm button pressed with valid selection.`)
                            await i.update({ content: msg.get('INFO_CREATE_STARTING', {configName: configName, templateName: `プリセット(${selectedAddonValues.join(', ')}/${selectedModValues.join(', ')})`}), components: [] })
                            collector.stop('confirmed')

                            const templatePath = utils.getTemplatePath(defaultTemplate)
                            const newConfigPath = utils.getConfigPath(configName)
                            await utils.copyDirectoryRecursive(templatePath, newConfigPath)

                            const usedPorts = await utils.getUsedPorts()
                            const availablePort = utils.findAvailablePort(utils.MIN_PORT, utils.MAX_PORT, usedPorts)
                            if (availablePort === null) {
                                console.log(`[DEBUG] No available port found.`)
                                await fs.rm(newConfigPath, { recursive: true, force: true })
                                await interaction.followUp({ content: msg.get('ERROR_PORT_NOT_AVAILABLE', { minPort: utils.MIN_PORT, maxPort: utils.MAX_PORT }), ephemeral: false})
                                return
                            }
                            console.log(`[DEBUG] Available port found: ${availablePort}`)
                            await utils.updateConfigXmlPort(configName, availablePort)

                            await updateXmlWithPresets(configName, selectedAddonValues, selectedModValues)

                            await utils.writeMetadata(configName, interaction.user.id)

                            await interaction.followUp({ content: msg.get('SUCCESS_CREATE', { configName: configName, templateName: `プリセット(${selectedAddonValues.join(', ')}/${selectedModValues.join(', ')})`, port: availablePort }), ephemeral: false })

                        } else if (i.customId === 'cancel_preset_create') {
                            console.log(`[DEBUG] Cancel button pressed.`)
                            await i.update({ content: msg.get('INFO_REMOVE_CANCELLED').replace('削除','作成'), components: [] })
                            collector.stop('cancelled')
                        }
                    }
                } catch (error) {
                    console.error('[ERROR] Error processing component interaction:', error)
                    await i.update({ content: msg.get('ERROR_GENERIC') + `\n\`${error.message}\`` , components: [] }).catch(console.error)
                    collector.stop('error')
                }
            })

            collector.on('end', (collected, reason) => {
                if (reason === 'time') {
                    interaction.editReply({ content: msg.get('ERROR_INTERACTION_TIMEOUT'), components: [] }).catch(console.error)
                } else if (reason !== 'confirmed' && reason !== 'cancelled' && reason !== 'incomplete' && reason !== 'error') {
                    interaction.editReply({ content: msg.get('ERROR_GENERIC'), components: [] }).catch(console.error)
                }
                console.log(`[DEBUG] Preset collector ended. Reason: ${reason}`)
            })

        } catch (error) {
            console.error(`[ERROR] Failed to execute create_preset for ${configName}:`, error)
            const replyContent = msg.get('ERROR_COMMAND_INTERNAL') + `\n\`\`\`${error.message}\`\`\``
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: replyContent, ephemeral: false }).catch(console.error)
            } else {
                await interaction.reply({ content: replyContent, ephemeral: false }).catch(console.error)
            }
        }
    }
}