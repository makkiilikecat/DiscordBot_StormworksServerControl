// commands/utility/sws.js
const client = require('../../index.js').client; // Discord Clientインスタンスを取得
const { SlashCommandBuilder } = require('discord.js')
const path = require('node:path')
const fs = require('node:fs')
const autoRestart = require('./sub_commands/utility/auto_restart.js');

// サーバーインスタンスの状態を管理 (Bot実行中のみ有効)
// Key: instanceName (string), Value: { pid: number | null, isExpectedToRun: boolean }
const serverInstances = new Map()

// サブコマンドのファイルを動的に読み込むための準備
const subcommands = {}
const subcommandFilesPath = path.join(__dirname, 'sub_commands') // このファイルと同じディレクトリ
const subcommandFiles = fs.readdirSync(subcommandFilesPath).filter(file => file.endsWith('.js'))
console.log(`[INFO] Found ${subcommandFiles.length} subcommand files in ${subcommandFilesPath}`)

for (const file of subcommandFiles) {
    const commandName = file.substring(0, file.length - '.js'.length) //例: start
    try {
        const commandModule = require(path.join(subcommandFilesPath, file))
        if ('execute' in commandModule) {
             subcommands[commandName] = commandModule
             console.log(`[INFO] Loaded subcommand: ${commandName}`)
        } else {
            console.warn(`[WARN] Subcommand file ${file} is missing 'execute' function.`)
        }
    } catch(error) {
        console.error(`[ERROR] Failed to load subcommand file ${file}:`, error)
    }
}


module.exports = {
    data: new SlashCommandBuilder()
        .setName('sws')
        .setDescription('Stormworks サーバーを管理します')
        .addSubcommand(subcommand =>
            subcommand
                .setName('start')
                .setDescription('指定した名前のサーバーを起動します')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('起動するサーバーの名前 (例: examplename1)')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('stop')
                .setDescription('指定した名前のサーバーを停止します')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('停止するサーバーの名前')
                        .setRequired(true)))
         .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('サーバーの状態を表示します')
                 .addStringOption(option =>
                    option.setName('name')
                        .setDescription('状態を確認するサーバーの名前 (省略時はすべて)')))
        .addSubcommand(subcommand =>
            subcommand
                .setName('create')
                .setDescription('テンプレートから新しいサーバー構成を作成します')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('作成する構成の名前 (英数字とアンダーバーのみ)')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('template')
                        .setDescription('使用するテンプレートの名前 (省略時は default)')
                        .setRequired(false))) // required: false
        .addSubcommand(subcommand =>
            subcommand
                .setName('custom_create')
                .setDescription('server_config.xml をアップロードして新しいサーバー構成を作成します')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('作成する構成の名前 (英数字とアンダーバーのみ)')
                        .setRequired(true))
                .addAttachmentOption(option =>
                    option.setName('config_file')
                        .setDescription('使用する server_config.xml ファイル')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('指定したサーバー構成を削除します (管理者または作成者のみ)')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('削除する構成の名前')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('作成済みのサーバー構成をリスト表示します'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('template_list')
                .setDescription('利用可能なテンプレートのリストを表示します'))
        .addSubcommand(subcommand =>
            subcommand
                .setName('create_preset')
                .setDescription('プリセットを選んで新しいサーバー構成を作成します。')
                .addStringOption(option =>
                    option.setName('name')
                        .setDescription('作成する構成の名前 (英数字とアンダーバーのみ)')
                        .setRequired(true))),

    async execute(interaction) {
        const subcommandName = interaction.options.getSubcommand()

        if (subcommands[subcommandName]) {
            try {
                // 対応するサブコマンドのexecute関数を実行し、interactionと状態Mapを渡す
                await subcommands[subcommandName].execute(interaction, serverInstances)
            } catch (error) {
                console.error(`Error executing subcommand ${subcommandName}:`, error)
                const replyOptions = { content: 'コマンドの実行中に内部エラーが発生しました。', ephemeral: true }
                 try {
                     if (interaction.replied || interaction.deferred) {
                         await interaction.followUp(replyOptions)
                     } else {
                         await interaction.reply(replyOptions)
                     }
                 } catch (replyError) {
                    console.error("Failed to send error reply to user:", replyError)
                 }
            }
        } else {
            await interaction.reply({ content: '不明なサブコマンドです。', ephemeral: true })
        }
    },
    // Bot起動時に実行する初期化処理を追加
    async initialize(client) {
         console.log('[INFO] Initializing sws command - Stopping all potential orphan servers...')
         const utils = require('./sub_commands/utility/utils.js') // ユーティリティ関数を読み込み
        try {
            const pids = await utils.findAllServerPidsByTitlePattern('sws_*')
            if (pids.length > 0) {
                console.log(`[INFO] Found ${pids.length} potential orphan server process(es): ${pids.join(', ')}. Attempting to stop...`)
                 let stopCount = 0
                 let failCount = 0
                for (const pid of pids) {
                    try {
                         const result = await utils.forceStopProcess(pid)
                         console.log(`[INFO] Stop result for PID ${pid}: ${result}`)
                         stopCount++
                    } catch (stopError) {
                         console.error(`[ERROR] Failed to stop orphan process PID ${pid}:`, stopError)
                         failCount++
                    }
                 }
                 console.log(`[INFO] Orphan server cleanup finished. Stopped: ${stopCount}, Failed: ${failCount}`)
            } else {
                console.log('[INFO] No potential orphan server processes found.')
            }
        } catch (error) {
            console.error('[ERROR] Failed to perform initial server cleanup:', error)
        }
        // サーバー状態Mapをクリア
        serverInstances.clear()
        autoRestart.startMonitoring(client, serverInstances);
        console.log('[INFO] Server instance map cleared.')
    }
}

// Bot終了時に監視を停止する処理も入れると良い
//process.on('SIGINT', () => {
//    autoRestart.stopMonitoring();
//    client.destroy();
//    process.exit();
//});
//process.on('SIGTERM', () => {
//    autoRestart.stopMonitoring();
//    client.destroy();
//    process.exit();
//});