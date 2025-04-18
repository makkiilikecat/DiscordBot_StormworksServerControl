// commands/sws/sub_commands/list.js

const fs = require('node:fs').promises;
const path = require('node:path')
const { EmbedBuilder } = require('discord.js')
const utils = require('./utility/utils') // ユーティリティ関数をインポート
const config = require('./utility/registry') // 設定情報をインポート
const messages = require('./utility/messages') // メッセージ管理モジュールをインポート
const chalk = require('chalk') // ログの色分け用ライブラリ

const configBaseDir = config.configBasePath // 構成が保存されるベースディレクトリ

// デバッグモードの設定
const DEBUG_MODE = true // true: 詳細なデバッグログを表示, false: 基本的なログのみ

if (DEBUG_MODE) {
    console.log(chalk.blue('[DEBUG] Initializing list command...'))
} else {
    console.log('[INFO] Initializing list command...')
}

module.exports = {
    async execute(interaction, serverInstances) {
        try {
            // 処理に時間がかかる可能性があるため、応答を保留
            await interaction.deferReply({ ephemeral: true })

            if (DEBUG_MODE) {
                console.log(chalk.blue('[DEBUG] Fetching server configuration list...'))
            }

            // 構成ディレクトリを読み込む
            let entries;
            try {
                entries = await fs.readdir(configBaseDir, { withFileTypes: true })
                if (DEBUG_MODE) {
                    console.log(chalk.green(`[DEBUG] Found ${entries.length} server configurations.`))
                }
            } catch (readDirError) {
                 console.error(chalk.red(`[ERROR] Failed to read config directory: ${configBaseDir}`, readDirError))
                 await interaction.editReply({
                    content: messages.get('ERROR_DIRECTORY_READ'),
                    ephemeral: true
                 })
                 return
            }

            const configDirs = entries.filter(entry => entry.isDirectory())

            // 構成が存在しない場合
            if (configDirs.length === 0) {
                await interaction.editReply({content:messages.get('INFO_LIST_EMPTY'), ephemeral: true})
                return
            }


            // 各構成の詳細情報を非同期で取得
            const configPromises = configDirs.map(async (dir) => {
                const configName = dir.name;
                let creatorName = '不明' // デフォルト値
                let status = '停止中' // デフォルト値
                let creationDate = '不明'
                let worldSettings = '不明'
                let addons = '不明'
                let mods = '不明'

                // メタデータから作成者情報と作成日時を取得試行
                try {
                    const metadata = await utils.readMetadata(configName)
                    const creatorId = metadata?.creator_id?.[0] // xml2jsは配列に入れるため[0]
                    creationDate = metadata?.creation_timestamp?.[0] || '不明'

                    if (creatorId) {
                        try {
                            // Discord APIからユーザー情報を取得 (キャッシュを優先)
                            //const creator = await interaction.client.users.fetch(creatorId, { cache: true })
                            // creatorName = creator.tag // 例: user#1234 ← これをメンションに変更
                            creatorName = `<@${creatorId}>` // メンション形式に変更
                        } catch (fetchError) {
                            console.warn(chalk.yellow(`[WARN] Failed to fetch user ${creatorId} for config ${configName}: ${fetchError.message}`))
                            // creatorName = `不明 (${creatorId})` // 取得失敗時の表示 ← これも調整
                            creatorName = `不明ユーザー (ID: ${creatorId})` // 取得失敗時の表示を調整
                        }
                    }

                    // ワールド設定、アドオン、Mod情報を取得
                    worldSettings = metadata?.world_settings?.[0] || '不明'
                    addons = metadata?.addons?.join(', ') || '不明'
                    mods = metadata?.mods?.join(', ') || '不明'
                } catch (metaError) {
                    console.warn(chalk.yellow(`[WARN] Could not read metadata for ${configName}: ${metaError.message}`))
                }

                // serverInstances Map からサーバーの実行状態を確認
                const instanceState = serverInstances.get(configName)
                if (instanceState?.isRun) {
                    status = '起動中' // isRun が true なら起動中
                } else {
                    status = '停止中' // isRun が false または存在しない場合は停止中
                }

                // Embedフィールド用のオブジェクトを返す
                return {
                    name: `----------------------------\n${configName}`,  // embedの幅が狭くなりすぎるのを防ぐ
                    value: `作成者: ${creatorName}\n作成日時: <t:${Math.floor(new Date(creationDate).getTime() / 1000)}:R>\nワールド設定: \`${worldSettings}\`\nアドオン:\n\`\`\`\n${addons.split(', ').join('\n') || 'なし'}\n\`\`\`\nMod:\n\`\`\`\n${mods.split(', ').join('\n') || 'なし'}\n\`\`\`\n*状態:* ${status}`, // フィールド値をフォーマット (アドオン/Modをコードブロックに)
                    inline: true // 各構成情報を縦に並べる
                }
            })

            // 全ての構成情報の取得が完了するのを待つ
            const configFields = await Promise.all(configPromises)

            // 構成名でアルファベット順にソート
            configFields.sort((a, b) => a.name.localeCompare(b.name))


            // Embedを作成してリスト表示
            const embed = new EmbedBuilder()
                .setTitle('サーバー構成リスト')
                .setColor(0x00AAFF) // 見やすい色を設定
                .addFields(configFields.slice(0, 25)) // Embedにフィールドを追加 (最大25個の制限に注意)

            if (configFields.length > 25) { // 25件を超えている場合
                embed.setDescription(messages.get('INFO_LIST_LIMIT', { count: configFields.length }))
            } else {
                const portRange = config.maxPort - config.minPort
                const serverCount = configFields.length
                embed.setDescription(`あと\`${portRange - serverCount}/${portRange}\`個サーバーを作成できます。`)
            }

            // 最終的なEmbedを返信する
            await interaction.editReply({ embeds: [embed], ephemeral: true })

        } catch (error) {
            // 予期せぬエラーが発生した場合の処理
            console.error(chalk.red('[ERROR] Error listing server configs:'), error)
            const errorMessage = messages.get('ERROR_COMMAND_INTERNAL')

            // 応答が保留中か既に返信済みかで対応を分岐
            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({ content: errorMessage, ephemeral: true })
                } else {
                    await interaction.reply({ content: errorMessage, ephemeral: true })
                }
            } catch (replyError) {
                console.error(chalk.red("[ERROR] Failed to send error reply to user:"), replyError)
            }
        }
    }
}