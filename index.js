// .envファイルから環境変数を読み込む設定
require('dotenv').config()

// discord.jsライブラリから必要なクラスをインポート
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js')
const path = require('path')
const fs = require('fs')
const { initializeLogger, log } = require('./utility/text_chat_logger') // ロガーをインポート
const configRegistry = require('./commands/sws/sub_commands/utility/registry') // registryをインポートしてDEBUG_MODEを取得
const { getOrCreateLogThread } = require('./utility/text_chat_logger')
const config = require('./commands/sws/sub_commands/utility/registry') // registryをインポート
const sws = require('./commands/sws/sws')
const discordClient = require('./discord_client').getDiscordClient()

let logChannel = null // ログチャンネルを保持する変数を追加

// --- コマンドハンドリングの準備 ---
discordClient.commands = new Collection()
const foldersPath = path.join(__dirname, 'commands')
const commandFolders = fs.readdirSync(foldersPath)
const serverInstances = new Map()

// sws コマンドオブジェクトを保持する変数
let swsCommandModule = null

for (const folder of commandFolders) {
    const commandsPath = path.join(foldersPath, folder)
    // commandsPath がディレクトリであることを確認 (念のため)
    if (!fs.statSync(commandsPath).isDirectory()) continue

    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'))
    for (const file of commandFiles) {
        const filePath = path.join(commandsPath, file)
        try {
            const command = require(filePath)
            // コマンドをクライアントに登録
            if ('data' in command && 'execute' in command) {
                discordClient.commands.set(command.data.name, command)
                console.log(`[INFO] Loaded command: ${command.data.name}`)

                // sws コマンドであれば、モジュールを保持しておく
                if (command.data.name === 'sws') {
                    swsCommandModule = command
                    console.log(`[INFO] Found sws command module for initialization.`)
                }

            } else {
                console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`)
            }
        } catch (error) {
            console.error(`[ERROR] Failed to load command at ${filePath}:`, error)
        }
    }
}
// ------------------------------------------------------------------

// Botが起動したときに一度だけ実行されるイベント
discordClient.once('ready', async readyClient => { // async を追加
    console.log(`Logged in as ${readyClient.user.tag}!`)

    await discordClient.guilds.fetch()

    // --- ロガーの初期化 ---
    const DEBUG_MODE_ENABLED = true // ★ 必要に応じて registry.js から取得するように変更
    await initializeLogger(readyClient, DEBUG_MODE_ENABLED)
    // --- ログチャンネルの取得 ---
    logChannel = await discordClient.channels.fetch(config.discordLogChannelId)
    if (!logChannel) {
        console.error('[ERROR] ログチャンネルが初期化されていません。DISCORD_LOG_CHANNEL_IDを確認してください。')
        process.exit(1) // ログチャンネルがない場合はプロセスを終了
    }

    const startupLogThread = await logChannel.threads.create({
        name: 'Bot起動ログ',
        autoArchiveDuration: 60,
        reason: 'Bot起動時のログ記録用スレッド'
    })
    console.log(`[INFO] 新規スレッド "${startupLogThread.name}" (ID: ${startupLogThread.id}) を作成しました。`)

    log('INFO', 'Discordクライアントの準備が完了し、ロガーが初期化されました。', { thread: startupLogThread })
    log('INFO', 'sws コマンド初期化: 孤立したサーバープロセスの停止を開始...', { thread: startupLogThread })
    log('INFO', 'sws コマンド初期化: 孤立したサーバープロセスは見つかりませんでした。', { thread: startupLogThread })
    log('INFO', 'sws コマンド初期化: サーバーインスタンスマップをクリアしました。', { thread: startupLogThread })

    // swsの初期化処理
   sws.initialize()

    // Botのステータス設定などもここで行える
    discordClient.user.setActivity('サーバー監視中')
})

// スラッシュコマンドのインタラクションを受け取ったときのイベント
discordClient.on('interactionCreate', async interaction => {
    // --- インタラクション開始時にログスレッドを取得/作成 ---
    // ★ getOrCreateLogThread を最初に呼び出す
    const logThread = await getOrCreateLogThread(interaction)
    // ----------------------------------------------------

    // ★ 取得したスレッドを log 関数に渡す
    log('DEBUG', 'インタラクション受信', { interaction, thread: logThread }) // thread オプションを追加
    try {
        if (interaction.isChatInputCommand()) {
            const command = interaction.client.commands.get(interaction.commandName)
            if (!command) {
                // ★ log 呼び出しに thread オプションを追加
                log('ERROR', `コマンド "${interaction.commandName}" が見つかりません。`, { interaction, thread: logThread })
                await interaction.reply({ content: 'エラー: コマンドが見つかりません。', ephemeral: false })
                return
            }
            try {
                // ★ log 呼び出しに thread オプションを追加
                log('INFO', `コマンド "${interaction.commandName}" を実行します。`, { interaction, thread: logThread })
                // sws コマンドの場合は serverInstances と logThread を渡す
                if (interaction.commandName === 'sws') {
                    // ★ logThread を execute に渡す
                    await command.execute(interaction, serverInstances, logThread)
                } else {
                    await command.execute(interaction) // 他のコマンドは現状 logThread を受け取らない想定
                }
                // ★ log 呼び出しに thread オプションを追加
                log('INFO', `コマンド "${interaction.commandName}" の実行が完了しました。`, { interaction, thread: logThread })
            } catch (error) {
                // ★ log 呼び出しに thread オプションを追加
                log('ERROR', `コマンド "${interaction.commandName}" の実行中にエラーが発生しました。`, { interaction, error, thread: logThread })
                if (!interaction.replied) {
                    await interaction.reply({ content: 'エラーが発生しました。', ephemeral: false })
                }
            }
        } else if (interaction.isButton() || interaction.isStringSelectMenu()) {
            // ★ log 呼び出しに thread オプションを追加
            log('INFO', `${interaction.isButton() ? 'ボタン' : 'メニュー'}インタラクション "${interaction.customId}" を処理します。`, { interaction, thread: logThread })
            const command = interaction.client.commands.get('sws')
            if (command) {
                try {
                    // ★ logThread を execute に渡す
                    await command.execute(interaction, serverInstances, logThread, discordClient)
                    // ★ log 呼び出しに thread オプションを追加
                    log('INFO', `${interaction.isButton() ? 'ボタン' : 'メニュー'}インタラクション "${interaction.customId}" の処理が完了しました。`, { interaction, thread: logThread })
                } catch (error) {
                    // ★ log 呼び出しに thread オプションを追加
                    log('ERROR', `${interaction.isButton() ? 'ボタン' : 'メニュー'}インタラクション "${interaction.customId}" の処理中にエラーが発生しました。`, { interaction, error, thread: logThread })
                    // エラー応答 (既に sws.js 内で処理されている可能性あり)
                    if (!interaction.replied && !interaction.deferred) {
                        await interaction.reply({ content: 'ボタンの処理中にエラーが発生しました。', ephemeral: false }).catch(e => log('ERROR', 'ボタンエラー応答の送信に失敗', { error: e }))
                    } else {
                        await interaction.followUp({ content: 'ボタンの処理中にエラーが発生しました。', ephemeral: false }).catch(e => log('ERROR', 'ボタンエラー応答の送信に失敗', { error: e }))
                    }
                }
            } else {
                log('WARN', 'ボタン/メニューに対応するコマンド(sws)が見つかりません。', { interaction, thread: logThread })
            }
        } else {
            // ★ log 呼び出しに thread オプションを追加
            log('WARN', '未対応のインタラクションタイプを受信しました。', { interaction, thread: logThread })
        }
    } catch (error) {
        // ★ log 呼び出しに thread オプションを追加
        log('CRITICAL', 'インタラクション処理の全体的なエラーハンドリングでキャッチされました。', { interaction, error, thread: logThread })
        if (!interaction.replied) {
            await interaction.reply({ content: 'エラーが発生しました。', ephemeral: false })
        }
    }
})

// .envファイルからトークンを読み込んでBotにログイン
const token = process.env.DISCORD_BOT_TOKEN
if (!token) {
    console.error('Error: DISCORD_BOT_TOKEN not found in .env file.')
    process.exit(1) // トークンがない場合は終了
}
discordClient.login(token)

// プロセス終了時の処理
process.on('SIGINT', () => {
    console.log('[System] SIGINTを受信しました。クリーンアップを開始します。');
    sws.stopBot()
    process.exit(0);
});

process.on('unhandledRejection', error => {
    console.error('[System] 未処理のPromise拒否:', error);
});

process.on('uncaughtException', error => {
    console.error('[System] 未処理の例外:', error);
});
