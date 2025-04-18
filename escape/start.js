// commands/sws/sub_commands/start.js

const { spawn } = require('child_process')
const path = require('node:path')
const fs = require('node:fs')
const config = require('../commands/sws/sub_commands/utility/registry') // 設定情報をインポート
const messages = require('../commands/sws/sub_commands/utility/messages') // メッセージ管理モジュールをインポート
const serverUtils = require('../commands/sws/sub_commands/utility/server_utils') // サーバー関連のユーティリティ関数をインポート
const { log, getOrCreateLogThread } = require('../utility/text_chat_logger') // ロガーをインポート

const serverDirectory = config.serverDirectory;
const serverExeName = config.serverExecutableName;
const configBasePath = config.configBasePath // Botが管理する設定ファイルのベースパス

module.exports = {
    async execute(interaction, serverInstances) { // serverInstances Map を受け取る
        const instanceName = interaction.options.getString('name')
        const windowTitle = `sws_${instanceName}` // サーバープロセスのウィンドウタイトル
        const logThread = await getOrCreateLogThread(interaction)

        try {
            // 0. 設定値の基本的なチェック (registry.jsでエラーになるはずだが念のため)
            if (!serverDirectory || !configBasePath || !serverExeName) {
                await interaction.reply({
                    content: messages.get('ERROR_ENV_VAR_MISSING', { varName: 'SERVER_DIR_NAME, SERVER_CONFIG_BASE_PATH, or SERVER_EXE_NAME' }),
                    ephemeral: false
                })
                return
            }

            // 1. サーバー実行ファイルが存在するかチェック
            const serverExePath = path.join(serverDirectory, serverExeName)
            try {
                await fs.promises.access(serverExePath)
            } catch {
                await interaction.reply({
                    content: messages.get('ERROR_ENV_VAR_INVALID', { varName: `SERVER_EXE_NAME (Path: ${serverExePath})` }),
                    ephemeral: false
                })
                return
            }

            // 2. 指定された構成ディレクトリと設定ファイルが存在するかチェック
            const configDir = path.join(configBasePath, instanceName)
            const configFile = path.join(configDir, 'server_config.xml') // server_config.xml を期待
            try {
                await fs.promises.access(configDir)
                await fs.promises.access(configFile)
            } catch {
                await interaction.reply({
                    content: messages.get('ERROR_CONFIG_NOT_FOUND', { configName: instanceName }),
                    ephemeral: false
                })
                return
            }

            log('INFO', `サーバー "${instanceName}" の起動を試みます。`, { interaction, thread: logThread })

            const message = await serverUtils.runServer(serverInstances, instanceName, interaction, logThread)
            
            log('INFO', `サーバー "${instanceName}" が正常に起動しました。`, { interaction, thread: logThread })
        
        } catch (error) {
            // この try ブロック全体での予期せぬエラー
            console.error(`[ERROR] Unexpected error during server start process ("${instanceName}"):`, error)
            const replyOptions = { content: messages.get('ERROR_COMMAND_INTERNAL'), ephemeral: false }
            // エラー時にもMapの状態をリセット
            serverInstances.set(instanceName, { pid: null, isRun: false })
            log('ERROR', `サーバー "${instanceName}" の起動中にエラーが発生しました。`, { interaction, error, thread: logThread })
            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(replyOptions)
                } else {
                    await interaction.reply(replyOptions)
                }
            } catch (replyError) {
                console.error(`Failed to send error reply for "${instanceName}" start:`, replyError)
            }
        }
    }
}