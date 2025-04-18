const { EmbedBuilder, ThreadAutoArchiveDuration } = require('discord.js')
const chalk = require('chalk')
const config = require('../commands/sws/sub_commands/utility/registry') // DISCORD_LOG_CHANNEL_ID を取得

// --- グローバル変数 ---
let logChannel = null // ログ出力先のテキストチャンネルオブジェクト
let clientInstance = null // Discordクライアントインスタンス
const activeThreads = new Map() // インタラクションIDとスレッドのマッピングを保持するキャッシュ

// --- 定数 ---
const LOG_LEVELS = {
    INFO: { color: chalk.green, discordColor: 0x00FF00, prefix: '[情報]' },
    WARN: { color: chalk.yellow, discordColor: 0xFFFF00, prefix: '[警告]' },
    ERROR: { color: chalk.red, discordColor: 0xFF0000, prefix: '[エラー]' },
    DEBUG: { color: chalk.blue, discordColor: 0x0000FF, prefix: '[デバッグ]' },
    CRITICAL: { color: chalk.bgRed.white, discordColor: 0xFF0000, prefix: '[致命的]' }, // 特に重要なエラー用
}

// デバッグモード (registry.js から直接参照はせず、初期化時に設定)
let isDebugMode = true // デフォルトは true

/**
 * ロガーを初期化する関数。Bot起動時に呼び出す。
 * @param {import('discord.js').Client} client Discordクライアントインスタンス
 * @param {boolean} debugMode デバッグモードが有効か
 */
async function initializeLogger(client, debugMode = true) {
    clientInstance = client;
    isDebugMode = debugMode // デバッグモードを設定

    console.log(chalk.blue('[DEBUG] Initializing logger...'))
    console.log(chalk.blue(`[DEBUG] Debug mode: ${debugMode}`))
    console.log(chalk.blue(`[DEBUG] Discord log channel ID: ${config.discordLogChannelId}`))

    // .env でログチャンネルIDが設定されているか確認
    if (!config.discordLogChannelId) {
        console.warn(chalk.yellow('[ロガー初期化] DiscordログチャンネルIDが未設定のため、Discordへのログ出力は無効です。'))
        return
    }

    try {
        // チャンネルIDからチャンネルオブジェクトを取得
        logChannel = await client.channels.fetch(config.discordLogChannelId)
        if (!logChannel || !logChannel.isTextBased()) {
            console.error(chalk.red(`[ロガー初期化] ログチャンネルID (${config.discordLogChannelId}) が見つからないか、テキストチャンネルではありません。`))
            logChannel = null // 無効なチャンネルなのでnullに戻す
        } else {
            console.log(chalk.green(`[ロガー初期化] Discordログチャンネル (${logChannel.name}) への出力準備完了。`))
        }
    } catch (error) {
        console.error(chalk.red(`[ロガー初期化] ログチャンネル (${config.discordLogChannelId}) の取得中にエラーが発生しました:`), error)
        logChannel = null
    }
}

/**
 * ログをコンソールとDiscordチャンネルに出力する関数。
 * @param {'INFO' | 'WARN' | 'ERROR' | 'DEBUG' | 'CRITICAL'} level ログレベル
 * @param {string} message ログメッセージ
 * @param {object} [options={}] オプション
 * @param {import('discord.js').CommandInteraction | import('discord.js').ButtonInteraction | import('discord.js').StringSelectMenuInteraction} [options.interaction] 関連するインタラクション
 * @param {Error} [options.error] エラーオブジェクト (スタックトレース表示用)
 * @param {object} [options.data] 追加データ (JSON形式で表示)
 * @param {import('discord.js').ThreadChannel} [options.thread] 送信先スレッド (指定された場合、interactionより優先)
 * @param {string} [options.threadName] スレッド名 (threadもinteractionもない場合に使用)
 * @param {boolean} [options.forceDiscord] デバッグモード無効時でもDiscordに強制出力するか (主にエラー用)
 */
async function log(level, message, options = {}) {
    const { interaction, error, data, thread: providedThread, threadName: customThreadName, forceDiscord = false } = options;
    const levelInfo = LOG_LEVELS[level] || LOG_LEVELS.INFO // 不明なレベルはINFO扱い

    // --- コンソールへのログ出力 ---
    if (!isDebugMode && level === 'DEBUG') {
        // デバッグモード無効時はDEBUGログをコンソールに出さない
    } else {
        let consoleMessage = `${levelInfo.prefix} ${message}`
        if (error) {
            consoleMessage += `\n${error.stack || error}`
        }
        if (data) {
            try {
                consoleMessage += `\nデータ: ${JSON.stringify(data, null, 2)}`
            } catch { /* JSON変換エラーは無視 */ }
        }
        console.log(levelInfo.color(consoleMessage))
    }

    // --- Discordチャンネルへのログ出力 ---
    if (!logChannel || (!isDebugMode && level === 'DEBUG' && !forceDiscord)) {
        return // ログチャンネル無効、またはデバッグログ非表示設定
    }

    try {
        // Embedを作成 (共通)
        const embed = new EmbedBuilder()
            .setColor(levelInfo.discordColor)
            .setTitle(`${levelInfo.prefix} ${message.substring(0, 250)}`)
            .setTimestamp(new Date())

        // 説明部分に詳細情報を追加 (共通)
        let description = `**メッセージ:**\n\`\`\`\n${message}\n\`\`\``
        if (interaction) {
            description += `\n\n**関連インタラクション:**`
            try {
                // interaction.commandName が存在するか確認
                const commandName = interaction.commandName || '不明なコマンド'
                const subcommand = interaction.options?.getSubcommand(false)
                description += `\n- **コマンド:** \`/${commandName}${subcommand ? ' ' + subcommand : ''}\``
            } catch (e) {
                 description += `\n- **コマンド:** (取得エラー)`
                 console.warn(chalk.yellow('[Discordログ] interaction.commandName の取得に失敗'), e)
            }
            description += `\n- **ユーザー:** ${interaction.user?.tag || '不明'} (${interaction.user?.id || '不明'})`
            if (interaction.guild) {
                description += `\n- **サーバー:** ${interaction.guild.name} (${interaction.guild.id})`
            }
            if (interaction.channel) {
                description += `\n- **チャンネル:** ${interaction.channel.name} (${interaction.channel.id})`
            }
        }
        if (error) {
            description += `\n\n**エラー情報:**\n\`\`\`\n${error.stack || error}\n\`\`\``
        }
        if (data) {
            try {
                description += `\n\n**追加データ:**\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``
            } catch {
                description += `\n\n**追加データ:** (JSON変換失敗)`
            }
        }
        if (description.length > 4096) {
            description = description.substring(0, 4090) + '\n... (省略)'
        }
        embed.setDescription(description)

        // --- 送信先の決定 (スレッド or メインチャンネル) ---
        let targetChannel = null // ★ 初期値を null に変更

        if (providedThread) {
            // ★ オプションでスレッドが直接指定された場合、それを最優先
            targetChannel = providedThread;
        } else if (interaction) {
            // ★ インタラクションがあり、スレッドが指定されていない場合のみ取得/作成を試みる
            const interactionId = interaction.id;
            const cachedThread = activeThreads.get(interactionId)
            if (cachedThread && !cachedThread.archived) {
                targetChannel = cachedThread;
            } else {
                // getOrCreateLogThread は interaction がないと null を返す
                const thread = await getOrCreateLogThread(interaction)
                if (thread) {
                    targetChannel = thread;
                }
                // スレッド取得/作成失敗時は targetChannel は null のまま
            }
        }

        // ★ targetChannel が決定できなかった場合 (初期化ログ or スレッド作成失敗) はメインチャンネルに送信
        if (!targetChannel) {
            targetChannel = logChannel;
            if (interaction) { // スレッド作成失敗の場合のみフッターを追加
                 embed.setFooter({ text: `⚠️ スレッド取得/作成失敗のためメインチャンネルに送信` })
                 console.log(chalk.yellow(`[Discordログ] スレッド取得/作成失敗のため、メインチャンネル (${logChannel.name}) にフォールバックします。`))
            }
        }

        // 決定された送信先にEmbedを送信
        await targetChannel.send({ embeds: [embed] })

    } catch (discordError) {
        console.error(chalk.red('[Discordログ] Discordへのログ送信中にエラーが発生しました:'), discordError)
    }
}

/**
 * 特定のインタラクションに対応するログスレッドを取得または作成する関数。
 * index.js でインタラクション開始時に呼び出す。
 * @param {import('discord.js').Interaction} interaction
 * @returns {Promise<import('discord.js').ThreadChannel | null>} スレッドオブジェクト、またはエラー時はnull
 */
async function getOrCreateLogThread(interaction) {
    console.log(chalk.blue('[DEBUG] Attempting to create or fetch log thread...'))
    if (!logChannel || !interaction) {
        console.warn(chalk.yellow('[getOrCreateLogThread] ログチャンネルが無効またはインタラクションがありません。'))
        return null // ログチャンネルが無効またはインタラクションがない場合はnull
    }

    const interactionId = interaction.id;
    let thread = activeThreads.get(interactionId)

    // キャッシュに存在し、アーカイブされていなければそれを返す
    if (thread && !thread.archived) {
        console.log(chalk.cyan(`[getOrCreateLogThread] キャッシュされたスレッド "${thread.name}" (ID: ${thread.id}) を返します。`))
        return thread;
    }

    // スレッド名を生成
    let commandString = '不明なインタラクション'
    try {
        if (interaction.isCommand()) {
            commandString = `/${interaction.commandName}${interaction.options?.getSubcommand(false) ? ' ' + interaction.options.getSubcommand(false) : ''}`
        } else if (interaction.isButton()) {
            commandString = `ボタン: ${interaction.customId}`
        } else if (interaction.isStringSelectMenu()) {
            commandString = `メニュー: ${interaction.customId}`
        } else {
            commandString = `インタラクションタイプ: ${interaction.type}`
        }
    } catch (e) {
        console.warn(chalk.yellow('[getOrCreateLogThread] コマンド/インタラクション情報の取得に失敗'), e)
    }

    let threadName = `${commandString} (${interaction.user?.tag || '不明'})`
    if (threadName.length > 100) {
        threadName = threadName.substring(0, 97) + '...'
    }

    console.log(chalk.blue('[DEBUG] Creating new thread...'))
    try {
        // 既存のスレッドを名前で検索 (キャッシュが消えた場合などのフォールバック)
        // 注意: 完全に同じ名前のスレッドが短時間に複数作られると問題になる可能性がある
        const existingThread = logChannel.threads?.cache.find(t => t.name === threadName && !t.archived)
        if (existingThread) {
            thread = existingThread;
            console.log(chalk.cyan(`[getOrCreateLogThread] 既存のスレッド "${threadName}" (ID: ${thread.id}) を再利用します (キャッシュ外)。`))
        } else {
            // 新規作成
            thread = await logChannel.threads.create({
                name: threadName,
                autoArchiveDuration: ThreadAutoArchiveDuration.OneHour,
                reason: `ログ記録用: ${commandString} by ${interaction.user?.tag || '不明'}`
            })
            console.log(chalk.cyan(`[getOrCreateLogThread] 新規スレッド "${threadName}" (ID: ${thread.id}) を作成しました。`))
        }

        // スレッドをキャッシュに保存
        activeThreads.set(interactionId, thread)
        // 古いキャッシュを削除するタイマーを設定 (例: 1時間後に削除)
        setTimeout(() => {
            activeThreads.delete(interactionId)
            // console.log(chalk.magenta(`[getOrCreateLogThread] スレッドキャッシュ (${interactionId}) を削除しました。`))
        }, 60 * 60 * 1000) // 1時間

        return thread;
    } catch (threadError) {
        console.error(chalk.red(`[getOrCreateLogThread] スレッド "${threadName}" の作成/取得に失敗しました:`), threadError)
        return null // エラー時はnullを返す
    }
}


module.exports = {
    initializeLogger,
    log,
    getOrCreateLogThread, // 新しい関数をエクスポート
    LOG_LEVELS
}