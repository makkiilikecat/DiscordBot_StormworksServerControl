// .envファイルから環境変数を読み込む設定
require('dotenv').config()

// discord.jsライブラリから必要なクラスをインポート
const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js')
const path = require('path')
const fs = require('fs')

// Botのクライアントインスタンスを作成
// 必要なIntentsを指定する
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        // 必要に応じて他のIntentsを追加
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
})

// --- コマンドハンドリングの準備 ---
client.commands = new Collection()
const foldersPath = path.join(__dirname, 'commands')
const commandFolders = fs.readdirSync(foldersPath)

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
                client.commands.set(command.data.name, command)
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
client.once('ready', async readyClient => { // async を追加
    console.log(`Logged in as ${readyClient.user.tag}!`)

    // --- sws コマンドの初期化処理を実行 ---
    if (swsCommandModule && typeof swsCommandModule.initialize === 'function') {
        console.log('[INFO] Attempting to run initialization for sws command...')
        try {
            // initialize 関数を呼び出し、client オブジェクトを渡す
            await swsCommandModule.initialize(readyClient)
            console.log('[INFO] sws command initialization completed.')
        } catch (initError) {
            console.error('[ERROR] Failed during sws command initialization:', initError)
        }
    } else {
        console.log('[INFO] sws command or its initialize function not found. Skipping initialization.')
    }
    // ---------------------------------------------

    // Botのステータス設定などもここで行える
    client.user.setActivity('サーバー監視中')
})

// スラッシュコマンドのインタラクションを受け取ったときのイベント
client.on('interactionCreate', async interaction => {
    // スラッシュコマンド以外は無視
    if (!interaction.isChatInputCommand()) return

    // コマンド名に対応するコマンドオブジェクトを取得
    const command = interaction.client.commands.get(interaction.commandName)

    // コマンドが見つからない場合
    if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`)
        try {
             await interaction.reply({ content: 'エラー: コマンドが見つかりませんでした。', ephemeral: true })
        } catch(replyError){
            console.error("Failed to send 'command not found' reply:", replyError)
        }
        return
    }

    // コマンドを実行
    try {
        // command.execute を呼び出す (sws の場合、この中でサブコマンドに処理が委譲される)
        await command.execute(interaction)
    } catch (error) {
        console.error(`Error executing command ${interaction.commandName}:`, error)
        // エラー応答を試みる
        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'コマンド実行中にエラーが発生しました！', ephemeral: true })
            } else {
                await interaction.reply({ content: 'コマンド実行中にエラーが発生しました！', ephemeral: true })
            }
        } catch (replyError) {
             console.error("Failed to send command execution error reply:", replyError)
        }
    }
})

// .envファイルからトークンを読み込んでBotにログイン
const token = process.env.DISCORD_BOT_TOKEN
if (!token) {
    console.error('Error: DISCORD_BOT_TOKEN not found in .env file.')
    process.exit(1) // トークンがない場合は終了
}
client.login(token)