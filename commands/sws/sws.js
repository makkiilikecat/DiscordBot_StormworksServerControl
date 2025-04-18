const chalk = require('chalk')
const path = require('path')
const fs = require('fs')
const { SlashCommandBuilder } = require('discord.js')
const { log, getOrCreateLogThread } = require('../../utility/text_chat_logger') // ロガーをインポート
const wsServer = require('./sub_commands/utility/websocket/websocket_server');
const tokenManager = require('./sub_commands/utility/token_manager')

// --- サーバーインスタンスの状態管理 ---
// このMapは sws コマンドモジュール内で管理する
const serverInstances = new Map()

// --- サブコマンドの動的読み込み ---
const subcommands = {}
const subcommandFilesPath = path.join(__dirname, 'sub_commands')
const subcommandFiles = fs.readdirSync(subcommandFilesPath).filter(file => file.endsWith('.js'))

const DEBUG_MODE = true // 仮設定

if (DEBUG_MODE) {
    console.log(chalk.blue(`[DEBUG] Found ${subcommandFiles.length} subcommand files in ${subcommandFilesPath}`))
}

for (const file of subcommandFiles) {
    const commandName = file.substring(0, file.length - '.js'.length)
    try {
        const commandModule = require(path.join(subcommandFilesPath, file))
        if ('execute' in commandModule) {
            subcommands[commandName] = commandModule;
            if (DEBUG_MODE) {
                console.log(chalk.green(`[DEBUG] Successfully loaded subcommand: ${commandName}`))
            }
        } else {
            console.warn(chalk.yellow(`[WARN] Subcommand file ${file} is missing 'execute' function.`))
        }
    } catch (error) {
        // preset_create.js のロードエラーを無視しないように修正
        console.error(chalk.red(`[ERROR] Failed to load subcommand file ${file}:`), error)
        // エラーが発生しても処理を続ける場合があるが、必須のサブコマンドなら Bot を停止させるべきかもしれない
    }
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('sws')
        .setDescription('Stormworks サーバーを管理します')
        
        .addSubcommand(subcommand => subcommand.setName('start')
            .setDescription('指定した名前のサーバーを起動します')
                .addStringOption(option => option.setName('name')
                    .setDescription('起動するサーバーの名前')
                    .setRequired(true)))

        .addSubcommand(subcommand => subcommand.setName('stop')
            .setDescription('指定した名前のサーバーを停止します')
                .addStringOption(option => option.setName('name')
                    .setDescription('停止するサーバーの名前')
                    .setRequired(true)))

        .addSubcommand(subcommand => subcommand.setName('status')
            .setDescription('サーバーの状態を表示します')
                .addStringOption(option => option.setName('name')
                    .setDescription('状態を確認するサーバーの名前 (省略時はすべて)')))

        .addSubcommand(subcommand => subcommand.setName('create')
            .setDescription('テンプレートから新しいサーバー構成を作成します')
                .addStringOption(option => option.setName('name')
                    .setDescription('作成する構成の名前')
                    .setRequired(true))
                .addStringOption(option => option.setName('template')
                    .setDescription('使用するテンプレートの名前 (省略時は default)')))
        
        .addSubcommand(subcommand => subcommand.setName('custom_create')
            .setDescription('server_config.xml をアップロードして新しいサーバー構成を作成します')
                .addStringOption(option => option.setName('name')
                    .setDescription('作成する構成の名前')
                    .setRequired(true))
                .addAttachmentOption(option => option.setName('config_file')
                    .setDescription('使用する server_config.xml ファイル')
                    .setRequired(true)))

        .addSubcommand(subcommand => subcommand.setName('remove')
            .setDescription('指定したサーバー構成を削除します')
                .addStringOption(option => option.setName('name')
                    .setDescription('削除する構成の名前').setRequired(true)))

        .addSubcommand(subcommand => subcommand.setName('list')
            .setDescription('作成済みのサーバー構成をリスト表示します'))

        .addSubcommand(subcommand => subcommand.setName('template_list')
            .setDescription('利用可能なテンプレートのリストを表示します'))

        .addSubcommand(subcommand => subcommand.setName('preset_create')
            .setDescription('プリセットを選んで新しいサーバー構成を作成します')
                .addStringOption(option => option.setName('name')
                    .setDescription('作成する構成の名前')
                    .setRequired(true)))
            
        .addSubcommand(subcommand => subcommand.setName('register_my_server')
                .setDescription('あなたの物理サーバーをBotに登録し、認証トークンを取得します。'))
        
        ,   // ,は必須
        

    // ★ execute の引数に logThread を追加 (serverInstances はこのモジュール内で管理)
    async execute(interaction, _serverInstancesInternal, logThread) { // 第2引数は使わない
        let commandToExecute;
        let isSubcommand = false;

        if (interaction.isChatInputCommand()) {
            commandToExecute = interaction.options.getSubcommand(false)
            isSubcommand = true
            if (!commandToExecute) {
                 log('WARN', 'スラッシュコマンドですが、サブコマンドが取得できませんでした。', { interaction, thread: logThread })
                 await interaction.reply({ content: 'コマンドの形式が正しくありません。', ephemeral: false })
                 return
            }
        } else if (interaction.isButton() || interaction.isStringSelectMenu()) {
            // --- ★ 新しいドロップダウン形式 (start.js用) の処理を追加 ---
            if (interaction.isStringSelectMenu() && interaction.customId.startsWith('select_server_for_')) {
                // start.jsの物理サーバー選択ドロップダウン
                const configName = interaction.customId.replace('select_server_for_', '');
                const selectedConnectionId = interaction.values[0];
                const userId = interaction.user.id;
                log('INFO', `メニューインタラクション "select_server_for_${configName}" で物理サーバー (接続ID: ${selectedConnectionId}) が選択されました。`, { interaction, thread: logThread });
                // start.jsのexecuteを呼び出し（serverInstances, logThreadも渡す）
                if (subcommands['start']) {
                    await subcommands['start'].execute(interaction, serverInstances, logThread, { configName, selectedConnectionId, userId });
                } else {
                    log('ERROR', 'start.jsのサブコマンドが見つかりません。', { interaction, thread: logThread });
                    await interaction.reply({ content: '内部エラー: startコマンドが見つかりません。', ephemeral: true });
                }
                return;
            }
            // ボタン/メニューの customId から対応するサブコマンド名を特定するロジックが必要
            // 例: customId が "confirm_preset_create_..." なら preset_create
            if (interaction.customId.includes('preset_create') ||
                interaction.customId.includes('select_world') ||
                interaction.customId.includes('select_addons') ||
                interaction.customId.includes('select_mods')) {
                commandToExecute = 'preset_create'
            } else if (interaction.customId.includes('remove')) {
                 commandToExecute = 'remove' // remove コマンドのボタンの場合
            }
            // 他のボタン/メニューに対応するサブコマンドも追加...
            else {
                log('WARN', `未対応のボタン/メニュー customId: ${interaction.customId}`, { interaction, thread: logThread })
                await interaction.editReply({ content: '不明な操作です。', ephemeral: false }).catch(e => log('ERROR', '不明操作エラー応答失敗', { error: e, thread: logThread }))
                return
            }
            log('DEBUG', `ボタン/メニュー (${interaction.customId}) からサブコマンド "${commandToExecute}" を特定しました。`, { interaction, thread: logThread })
        } else {
            log('WARN', '未対応のインタラクションタイプです。', { interaction, thread: logThread })
            await interaction.reply({ content: '不明なインタラクションタイプです。', ephemeral: false })
            return
        }

        if (subcommands[commandToExecute]) {
            try {
                log('DEBUG', `サブコマンド "${commandToExecute}" を実行します。`, { interaction, thread: logThread })
                // ★ logThread を渡す (serverInstances はこのモジュール内の変数を使用)
                // サブコマンドを実行
                try {
                    await subcommands[commandToExecute].execute(interaction, serverInstances, logThread)
                } catch (error) {
                    log('ERROR', `サブコマンド "${commandToExecute}" の実行中にエラーが発生しました。`, { interaction, error, thread: logThread })
                    const replyOptions = { content: 'コマンドの実行中に内部エラーが発生しました。', ephemeral: false }
                     try {
                         // deferReply/deferUpdate されている可能性を考慮
                         if (interaction.replied || interaction.deferred) {
                             await interaction.followUp(replyOptions)
                         } else {
                             await interaction.reply(replyOptions)
                         }
                     } catch (replyError) {
                        log('ERROR', "サブコマンドエラー応答の送信に失敗", { error: replyError, thread: logThread })
                     }
                }
            } catch (error) {
                log('ERROR', `サブコマンド "${commandToExecute}" の実行中にエラーが発生しました。`, { interaction, error, thread: logThread })
                const replyOptions = { content: 'コマンドの実行中に内部エラーが発生しました。', ephemeral: false }
                 try {
                     // deferReply/deferUpdate されている可能性を考慮
                     if (interaction.replied || interaction.deferred) {
                         await interaction.followUp(replyOptions)
                     } else {
                         await interaction.reply(replyOptions)
                     }
                 } catch (replyError) {
                    log('ERROR', "サブコマンドエラー応答の送信に失敗", { error: replyError, thread: logThread })
                 }
            }
        } else {
            log('WARN', `不明なサブコマンド "${commandToExecute}" が指定されました。`, { interaction, thread: logThread })
            // isSubcommand フラグで応答方法を分ける
            if (isSubcommand) {
                 await interaction.reply({ content: '不明なサブコマンドです。', ephemeral: false })
            } else {
                 // ボタン/メニューの場合、元のメッセージを編集するか followUp する
                 await interaction.followUp({ content: '不明な操作に対応する処理が見つかりません。', ephemeral: false }).catch(e => log('ERROR', '不明操作エラー応答失敗', { error: e, thread: logThread }))
            }
        }
    },

    initialize() {
         // WebSocketサーバーを起動
        wsServer.startWebSocket(8080, serverInstances);
        console.log('[WebSocketServer] WebSocketサーバーが起動しました。');

        // 無効なトークンがあれば削除
        tokenManager.checkTokens()
        console.log('[TokenManager] 無効なトークンが削除されました。')
    },

    stopBot() {
        // WebSocketサーバーを停止
        wsServer.stopWebSocket();
    }
}