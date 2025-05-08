const { ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js')
const presets = require('./utility/presets')
const utils = require('./utility/utils')
const xml2js = require('xml2js')
const fs = require('fs').promises;
const path = require('path')
const { log } = require('../../../utility/text_chat_logger') // ロガーをインポート
const config = require('./utility/registry') // config をインポート
const messages = require('./utility/messages') // メッセージ管理モジュールをインポート

const builder = new xml2js.Builder()

module.exports = {
    async execute(interaction, serverInstances, logThread) { // logThread を受け取る
        const commandName = 'preset_create' // ログ用のコマンド名
        log('DEBUG', `/${commandName} コマンド実行開始`, { interaction, thread: logThread })

        try {
            if (interaction.isCommand()) {
                const configName = interaction.options.getString('name')
                log('INFO', `プリセット作成リクエスト受信: 構成名="${configName}"`, { interaction, data: { configName }, thread: logThread })

                // 構成名の重複チェック
                log('DEBUG', `構成名 "${configName}" の重複チェックを実行します。`, { interaction, thread: logThread })
                const configExists = await utils.checkConfigExists(configName)
                if (configExists) {
                    log('WARN', `構成名 "${configName}" は既に存在します。`, { interaction, thread: logThread })
                    await interaction.reply({
                        content: `❌ 構成名 **${configName}** は既に存在します。別の名前を指定してください。`,
                        ephemeral: false
                    })
                    return
                }
                log('DEBUG', `構成名 "${configName}" は利用可能です。`, { interaction, thread: logThread })

                // 構成名が有効な場合、選択UIを表示
                log('DEBUG', 'プリセット選択UIの準備を開始します。', { interaction, thread: logThread })
                const worldOptions = presets.worldSettingsPresets.map(preset => ({
                    label: preset.name,
                    description: preset.description || '説明がありません',
                    value: preset.value
                }))
                const addonOptions = presets.addonPresets.map(preset =>({
                    label: preset.name,
                    description: preset.description || '説明なし',
                    value: preset.value
                }))
                const modOptions = presets.modPresets.map(preset => ({
                    label: preset.name,
                    description: preset.description || '説明なし',
                    value: preset.value
                }))

                const worldSelectMenu = new StringSelectMenuBuilder()
                    .setCustomId('select_world')
                    .setPlaceholder('ワールド設定を選択')
                    .setMinValues(1)
                    .setMaxValues(1)
                    .addOptions(worldOptions)

                const addonSelectMenu = new StringSelectMenuBuilder()
                    .setCustomId('select_addons')
                    .setPlaceholder('アドオンを選択 (複数選択可)')
                    .setMinValues(0).setMaxValues(addonOptions.length || 1)
                    .addOptions(addonOptions)

                const modSelectMenu = new StringSelectMenuBuilder()
                    .setCustomId('select_mods')
                    .setPlaceholder('Modを選択 (複数選択可)')
                    .setMinValues(0).setMaxValues(modOptions.length || 1)
                    .addOptions(modOptions)

                const actionRow1 = new ActionRowBuilder().addComponents(worldSelectMenu)
                const actionRow2 = new ActionRowBuilder().addComponents(addonSelectMenu)
                const actionRow3 = new ActionRowBuilder().addComponents(modSelectMenu)
                const confirmButton = new ButtonBuilder().setCustomId(`confirm_preset_create_${configName}`).setLabel('構成を作成').setStyle(ButtonStyle.Primary)
                const cancelButton = new ButtonBuilder().setCustomId(`cancel_preset_create_${configName}`).setLabel('キャンセル').setStyle(ButtonStyle.Secondary)
                const actionRow4 = new ActionRowBuilder().addComponents(confirmButton, cancelButton)

                log('DEBUG', 'プリセット選択UIをユーザーに送信します。', { interaction, thread: logThread })
                await interaction.reply({
                    content: JSON.stringify({}), // 初期状態
                    embeds: [{ title: '現在の選択内容', description: '**ワールド設定**: 未選択\n**アドオン**: なし\n**Mod**: なし' }],
                    components: [actionRow1, actionRow2, actionRow3, actionRow4],
                    ephemeral: false
                })
                log('INFO', `プリセット選択UIを "${configName}" 用に表示しました。`, { interaction, thread: logThread })

            } else if (interaction.isStringSelectMenu()) {
                // --- セレクトメニュー選択時の処理 ---
                log('DEBUG', `セレクトメニュー "${interaction.customId}" の選択を受信しました。`, { interaction, data: { values: interaction.values }, thread: logThread })
                let currentSelections = {}
                try {
                    currentSelections = JSON.parse(interaction.message.content || '{}')
                } catch (e) {
                    log('WARN', 'メッセージコンテンツからの選択状態JSONのパースに失敗しました。', { interaction, error: e, thread: logThread })
                }

                const selectedValues = interaction.values;
                const customId = interaction.customId;
                if (customId === 'select_world') {
                    // ワールド選択処理
                    log('DEBUG', `ワールド選択: ${interaction.values[0]}`, { interaction, thread: logThread })
                    currentSelections.world = selectedValues[0]
                    log('DEBUG', `ワールド設定を "${currentSelections.world}" に更新。`, { interaction, thread: logThread })
                } else if (customId === 'select_addons') {
                    // アドオン選択処理
                    log('DEBUG', `アドオン選択: ${interaction.values.join(', ')}`, { interaction, thread: logThread })
                    currentSelections.addons = selectedValues;
                    log('DEBUG', `アドオン設定を "${(currentSelections.addons || []).join(', ')}" に更新。`, { interaction, thread: logThread })
                } else if (customId === 'select_mods') {
                    // Mod選択処理
                    log('DEBUG', `Mod選択: ${interaction.values.join(', ')}`, { interaction, thread: logThread })
                    currentSelections.mods = selectedValues;
                    log('DEBUG', `Mod設定を "${(currentSelections.mods || []).join(', ')}" に更新。`, { interaction, thread: logThread })
                } else {
                    // 未対応のcustomId
                    log('WARN', `未対応のメニュー/カスタムID: ${customId}`, { interaction, thread: logThread })
                    await interaction.reply({ content: '不明な操作が選択されました。', ephemeral: false })
                }

                const worldName = currentSelections.world ? presets.worldSettingsPresets.find(p => p.value === currentSelections.world)?.name : '未選択'
                const addonNames = (currentSelections.addons || []).map(value => presets.addonPresets.find(p => p.value === value)?.name).filter(Boolean)
                const modNames = (currentSelections.mods || []).map(value => presets.modPresets.find(p => p.value === value)?.name).filter(Boolean)

                log('DEBUG', '選択内容表示Embedを更新します。', { interaction, data: currentSelections, thread: logThread })
                // interaction.update は必須
                await interaction.update({
                    content: JSON.stringify(currentSelections),
                    embeds: [{ title: '現在の選択内容', description: `**ワールド設定**: ${worldName}\n**アドオン**: ${addonNames.join(', ') || 'なし'}\n**Mod**: ${modNames.join(', ') || 'なし'}` }],
                    components: interaction.message.components
                })
                log('INFO', '選択内容表示を更新しました。', { interaction, thread: logThread })

            } else if (interaction.isButton()) {
                // --- ボタンクリック時の処理 ---
                const configName = interaction.customId.split('_').pop()
                log('DEBUG', `ボタン "${interaction.customId}" のクリックを受信。構成名: ${configName}`, { interaction, thread: logThread })

                if (interaction.customId.startsWith('confirm_preset_create_')) {
                    // --- 作成確認ボタン ---
                    log('INFO', `構成 "${configName}" の作成確認ボタンがクリックされました。`, { interaction, thread: logThread })
                    let newConfigPath = null // エラー時の削除用パス
                    try {
                        // interaction.update は必須
                        await interaction.update({
                            content: `⏳ 構成 **${configName}** を作成中です... (選択内容を処理中)`,
                            embeds: [], components: []
                        })
                        log('DEBUG', '構成作成中のメッセージに更新。', { interaction, thread: logThread })

                        let currentSelections = {}
                        try {
                            currentSelections = JSON.parse(interaction.message.content || '{}')
                        } catch (e) {
                            // 未選択と解釈
                        }
                        log('DEBUG', '最終選択内容:', { interaction, data: currentSelections, thread: logThread })

                        const selectedWorldValue = currentSelections.world || 'default_world'
                        const selectedAddonValues = currentSelections.addons || []
                        const selectedModValues = currentSelections.mods || []

                        // --- ステップ 1: ワールド設定取得 ---
                        log('DEBUG', 'ステップ1: ワールド設定を取得します。', { interaction, thread: logThread })
                        const worldSettingsPreset = presets.worldSettingsPresets.find(p => p.value === selectedWorldValue)
                        if (!worldSettingsPreset) {
                            log('ERROR', `選択されたワールド設定プリセット "${selectedWorldValue}" が見つかりません。`, { interaction, thread: logThread })
                            await interaction.followUp({ content: 'エラー: 選択されたワールド設定が見つかりません。', ephemeral: false })
                            return
                        }
                        const worldSettings = worldSettingsPreset.settings;
                        log('INFO', `ステップ1完了: ワールド設定 "${worldSettingsPreset.name}" を取得。`, { interaction, thread: logThread })

                        // --- ステップ 2: ワークショップアイテムリストアップ ---
                        log('DEBUG', 'ステップ2: 必要なワークショップアイテムをリストアップします。', { interaction, thread: logThread })
                        const requiredItems = []
                        selectedAddonValues.forEach(value => {
                            const preset = presets.addonPresets.find(p => p.value === value)
                            if (preset) {
                                preset.items.forEach(item => {
                                    const id = item.value.split('/').pop()
                                    if (id && !requiredItems.some(r => r.id === id)) {
                                        requiredItems.push({ id, type: item.type, sourcePath: item.value })
                                    }
                                })
                            }
                        })
                        selectedModValues.forEach(value => {
                            const preset = presets.modPresets.find(p => p.value === value)
                            if (preset) {
                                preset.items.forEach(item => {
                                    const id = item.value.split('/').pop()
                                    if (id && !requiredItems.some(r => r.id === id)) {
                                        requiredItems.push({ id, type: item.type, sourcePath: item.value })
                                    }
                                })
                            }
                        })
                        log('INFO', `ステップ2完了: ${requiredItems.length} 個のユニークなワークショップアイテムを検出。`, { interaction, data: { count: requiredItems.length }, thread: logThread })

                        // --- ステップ 3: ワークショップアイテム準備 ---
                        //log('DEBUG', `ステップ3: ${requiredItems.length}個のワークショップアイテム準備を開始します。`, { interaction, thread: logThread })
                        //// editReply は update 後は使えないので followUp を使うか、update の content を更新する
                        //// ここでは followUp を使う
                        //const progressMsg = await interaction.followUp({ content: `⏳ 構成 **${configName}** を作成中です... (${requiredItems.length}個のワークショップアイテム準備中)`, //ephemeral: false })
                        //log('DEBUG', 'ワークショップ準備中の進捗メッセージを送信しました。', { interaction, thread: logThread })

                        //const requiredItemsMap = new Map()
                        //requiredItems.forEach(item => {
                        //    requiredItemsMap.set(item.id, {
                        //        type: item.type,
                        //        sourcePath: item.sourcePath,
                        //        targetPath: path.join(config.workshopContentPath, item.id)
                        //    })
                        //})
                        //// prepareWorkshopItems は内部で interaction.followUp を使う
                        //const preparationResult = await prepareWorkshopItems(requiredItemsMap, interaction)
                        //if (!preparationResult.allReady) {
                        //    log('ERROR', 'ワークショップアイテムの準備に失敗しました。', { interaction, data: preparationResult.results, thread: logThread })
                        //    // prepareWorkshopItems が失敗メッセージを followUp しているはず
                        //    // 進捗メッセージを編集して失敗を伝える
                        //    await progressMsg.edit({ content: `❌ ワークショップアイテムの準備に失敗しました。詳細はログチャンネルを確認してください。` })
                        //    return
                        //}
                        //log('INFO', 'ステップ3完了: 全てのワークショップアイテムの準備が完了しました。', { interaction, thread: logThread })
                        //// 成功したら進捗メッセージを削除
                        //await progressMsg.delete().catch(e => log('WARN', '進捗メッセージの削除に失敗', { error: e, thread: logThread }))

                        // --- ステップ 4: サーバー構成作成 ---
                        log('DEBUG', 'ステップ4: サーバー構成の作成を開始します。', { interaction, thread: logThread })
                        // 元の update されたメッセージを編集して次のステップを伝える
                        await interaction.editReply({ content: `⏳ 構成 **${configName}** を作成中です... (構成ファイル生成中)` })

                        // 4b. 構成ディレクトリ作成
                        newConfigPath = utils.getConfigPath(configName)
                        log('DEBUG', `ステップ4b: 構成ディレクトリ "${newConfigPath}" を作成します。`, { interaction, thread: logThread })
                        try {
                            await fs.mkdir(newConfigPath, { recursive: true })
                        } catch (mkdirError) {
                            log('ERROR', `構成ディレクトリ "${newConfigPath}" の作成に失敗しました。`, { interaction, error: mkdirError, thread: logThread })
                            await interaction.followUp({ content: `エラー: 構成ディレクトリの作成に失敗しました。\n${mkdirError.message}`, ephemeral: false })
                            return
                        }
                        log('INFO', `ステップ4b完了: 構成ディレクトリを作成しました。`, { interaction, thread: logThread })

                        // 4c. シンボリックリンク作成
                        //log('DEBUG', 'ステップ4c: シンボリックリンクを作成します。', { interaction, thread: logThread })
                        //const preparedItemsForSymlink = new Map()
                        //preparationResult.results.forEach(r => {
                        //    const originalInfo = requiredItemsMap.get(r.id)
                        //    if (originalInfo) {
                        //        preparedItemsForSymlink.set(r.id, {
                        //            success: r.success,
                        //            targetPath: r.targetPath,
                        //            type: originalInfo.type
                        //        })
                        //    } else {
                        //        log('WARN', `シンボリックリンク用Map構築中にID ${r.id} の元情報が見つかりません。`, { interaction, thread: logThread })
                        //    }
                        //})
                        //// createPlaylistSymlinks は内部で interaction.followUp を使う
                        //const symlinkSuccess = await createPlaylistSymlinks(configName, preparedItemsForSymlink, interaction)
                        //if (!symlinkSuccess) {
                        //    log('ERROR', 'シンボリックリンクの作成に失敗しました。ディレクトリを削除します。', { interaction, thread: logThread })
                        //    // createPlaylistSymlinks が失敗メッセージを followUp しているはず
                        //    await interaction.editReply({ content: `❌ シンボリックリンクの作成に失敗しました。詳細はログチャンネルを確認してください。` })
                        //    await fs.rm(newConfigPath, { recursive: true, force: true }).catch(rmErr => log('ERROR', `構成ディレクトリ "${newConfigPath}" の削除に失敗。`, { interaction, error: rmErr, thread: logThread }))
                        //    return
                        //}
                        //log('INFO', 'ステップ4c完了: シンボリックリンクを作成しました。', { interaction, thread: logThread })

                        // 4d. server_config.xml 生成・保存
                        log('DEBUG', `ステップ4d: server_config.xml を生成・保存します。`, { interaction, thread: logThread })
                        const serverConfigObject = {
                            server_data: {
                                $: { ...worldSettings },
                                admins: { id: [] }, authorized: { id: [] }, blacklist: { id: [] }, whitelist: { id: [] },
                                playlists: { path: [] }, mods: { path: [], published_id: [] }
                            }
                        }
                        selectedAddonValues.forEach(value => {
                            const preset = presets.addonPresets.find(p => p.value === value)
                            if (preset) {
                                preset.items.forEach(item => {
                                    const workshopMatch = item.value.match(/workshop\/(\d+)/)
                                    if (workshopMatch) {
                                        serverConfigObject.server_data.playlists.path.push({ $: { path: `${workshopMatch[1]}` } })
                                    } else if (item.value.startsWith('rom/')) {
                                        serverConfigObject.server_data.playlists.path.push({ $: { path: item.value } })
                                    } else {
                                        log('WARN', `不明な形式のアドオンパス: ${item.value}`, { interaction, thread: logThread })
                                    }
                                })
                            }
                        })
                        selectedModValues.forEach(value => {
                            const preset = presets.modPresets.find(p => p.value === value)
                            if (preset) {
                                preset.items.forEach(item => {
                                    const workshopMatch = item.value.match(/workshop\/(\d+)/)
                                    if (workshopMatch) {
                                        serverConfigObject.server_data.mods.published_id.push({ $: { value: workshopMatch[1] } })
                                    } else {
                                        log('WARN', `不明な形式のModパス（published_id期待）: ${item.value}`, { interaction, thread: logThread })
                                    }
                                })
                            }
                        })

                        try {
                            const serverConfigXml = builder.buildObject(serverConfigObject)
                            const configFilePath = path.join(newConfigPath, 'server_config.xml')
                            await fs.writeFile(configFilePath, serverConfigXml)
                            log('INFO', `ステップ4d完了: server_config.xml を "${configFilePath}" に保存しました。`, { interaction, thread: logThread })
                        } catch (xmlWriteError) {
                            log('ERROR', 'server_config.xml の保存に失敗しました。ディレクトリを削除します。', { interaction, error: xmlWriteError, thread: logThread })
                            await interaction.editReply({ content: `❌ server_config.xml の保存に失敗しました。\n${xmlWriteError.message}` })
                            await fs.rm(newConfigPath, { recursive: true, force: true }).catch(rmErr => log('ERROR', `構成ディレクトリ "${newConfigPath}" の削除に失敗。`, { interaction, error: rmErr, thread: logThread }))
                            return
                        }

                        // 4e. メタデータ保存
                        log('DEBUG', `ステップ4e: メタデータ (metadata.xml) を保存します。作成者ID: ${interaction.user.id}`, { interaction, thread: logThread })
                        try {
                            await utils.writeMetadata(configName, interaction.user.id)
                            log('INFO', 'ステップ4e完了: metadata.xml を保存しました。', { interaction, thread: logThread })
                        } catch (metaWriteError) {
                            if (metaWriteError.message.includes('既に存在します')) {
                                log('ERROR', `メタデータ書き込み時に構成名 "${configName}" の重複が検出されました。`, { interaction, error: metaWriteError, thread: logThread })
                                await interaction.editReply({ content: `❌ エラー: 構成名 "${configName}" は既に存在します。` })
                                await fs.rm(newConfigPath, { recursive: true, force: true }).catch(rmErr => log('ERROR', `構成ディレクトリ "${newConfigPath}" の削除に失敗。`, { interaction, error: rmErr, thread: logThread }))
                                return
                            } else {
                                log('ERROR', 'metadata.xml の保存に失敗しました。', { interaction, error: metaWriteError, thread: logThread })
                                await interaction.followUp({ content: `⚠️ ${messages.get('ERROR_METADATA_WRITE', { configName })}`, ephemeral: false })
                            }
                        }
                        log('INFO', 'ステップ4完了: サーバー構成の作成が完了しました。', { interaction, thread: logThread })

                        // --- ステップ 5: 完了メッセージ ---
                        log('DEBUG', 'ステップ5: 完了メッセージを送信します。', { interaction, thread: logThread })
                        const finalWorldName = worldSettingsPreset.name;
                        const finalAddonNames = selectedAddonValues.map(v => presets.addonPresets.find(p => p.value === v)?.name).filter(Boolean)
                        const finalModNames = selectedModValues.map(v => presets.modPresets.find(p => p.value === v)?.name).filter(Boolean)

                        await interaction.editReply({
                            content: `✅ 構成 **${configName}** が正常に作成されました！\n\n**選択された構成内容:**\n- **ワールド設定**: ${finalWorldName}\n- **アドオン**: ${finalAddonNames.join(', ') || 'なし'}\n- **Mod**: ${finalModNames.join(', ') || 'なし'}\n\n\`/sws start ${configName}\` で起動できます。`,
                            components: []
                        })
                        log('INFO', `構成 "${configName}" の作成が正常に完了しました。`, { interaction, thread: logThread })

                    } catch (error) {
                        // --- 作成処理中の全体エラーハンドリング ---
                        log('ERROR', `構成 "${configName}" の作成処理中に予期せぬエラーが発生しました。`, { interaction, error, thread: logThread })
                        if (newConfigPath) {
                             await fs.rm(newConfigPath, { recursive: true, force: true }).catch(rmErr => log('ERROR', `エラー発生後の構成ディレクトリ "${newConfigPath}" の削除に失敗。`, { interaction, error: rmErr, thread: logThread }))
                        }
                        try {
                            // editReply は失敗する可能性があるので followUp
                            await interaction.followUp({ content: '構成の作成中にエラーが発生しました。詳細はログを確認してください。', ephemeral: false })
                        } catch (replyError) {
                            log('ERROR', '構成作成エラー時のユーザー通知に失敗。', { interaction, error: replyError, thread: logThread })
                        }
                    }

                } else if (interaction.customId.startsWith('cancel_preset_create_')) {
                    // --- キャンセルボタン ---
                    log('INFO', `構成 "${configName}" の作成がキャンセルされました。`, { interaction, thread: logThread })
                    // interaction.update は必須
                    await interaction.update({
                        content: '操作がキャンセルされました。',
                        embeds: [], components: []
                    })
                }
            }
        } catch (error) {
            // --- コマンド全体の予期せぬエラー ---
            log('CRITICAL', `/${commandName} コマンドの処理中に予期せぬエラーが発生しました。`, { interaction, error, thread: logThread })
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: 'コマンドの実行中に予期せぬエラーが発生しました。', ephemeral: false })
                } else {
                    await interaction.followUp({ content: 'コマンドの実行中に予期せぬエラーが発生しました。', ephemeral: false })
                }
            } catch (replyError) {
                log('ERROR', '全体エラーハンドリング中の応答送信に失敗。', { interaction, error: replyError, thread: logThread })
            }
        }
    }
}