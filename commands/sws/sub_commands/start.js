// commands/sws/sub_commands/start.js

const { spawn } = require('child_process');
const path = require('node:path');
const fs = require('node:fs');
const config = require('./utility/registry'); // 設定情報をインポート
const messages = require('./utility/messages'); // メッセージ管理モジュールをインポート
const serverUtils = require('./utility/server_utils'); // サーバー関連のユーティリティ関数をインポート

const serverDirectory = config.serverDirectory;
const serverExeName = config.serverExecutableName;
const configBasePath = config.configBasePath; // Botが管理する設定ファイルのベースパス

module.exports = {
    async execute(interaction, serverInstances) { // serverInstances Map を受け取る
        const instanceName = interaction.options.getString('name');
        const windowTitle = `sws_${instanceName}`; // サーバープロセスのウィンドウタイトル

        try {
            // 0. 設定値の基本的なチェック (registry.jsでエラーになるはずだが念のため)
            if (!serverDirectory || !configBasePath || !serverExeName) {
                await interaction.reply({
                    content: messages.get('ERROR_ENV_VAR_MISSING', { varName: 'SERVER_DIR_NAME, SERVER_CONFIG_BASE_PATH, or SERVER_EXE_NAME' }),
                    ephemeral: true
                });
                return;
            }

            // 1. サーバー実行ファイルが存在するかチェック
            const serverExePath = path.join(serverDirectory, serverExeName);
            try {
                await fs.promises.access(serverExePath);
            } catch {
                await interaction.reply({
                    content: messages.get('ERROR_ENV_VAR_INVALID', { varName: `SERVER_EXE_NAME (Path: ${serverExePath})` }),
                    ephemeral: true
                });
                return;
            }

            // 2. 指定された構成ディレクトリと設定ファイルが存在するかチェック
            const configDir = path.join(configBasePath, instanceName);
            const configFile = path.join(configDir, 'server_config.xml'); // server_config.xml を期待
            try {
                await fs.promises.access(configDir);
                await fs.promises.access(configFile);
            } catch {
                await interaction.reply({
                    content: messages.get('ERROR_CONFIG_NOT_FOUND', { configName: instanceName }),
                    ephemeral: true
                });
                return;
            }


            const message = await serverUtils.runServer(serverInstances, instanceName)
            if (message != null) {
                 await interaction.reply({content: messages.get('ERROR_TASKLIST_FAILED'), ephemeral: true});
                 return;
            }

            // if (serverProcess == null) {
            //     await interaction.reply({
            //         content: messages.get('ERROR_SERVER_START_FAILED', { configName: instanceName }),
            //         ephemeral: true
            //     });
            //     return;
            // }

            // 4. 起動をユーザーに通知
            await interaction.reply(messages.get('INFO_START_PROCESS', { instanceName }));

        } catch (error) {
            // この try ブロック全体での予期せぬエラー
            console.error(`[ERROR] Unexpected error during server start process ("${instanceName}"):`, error);
            const replyOptions = { content: messages.get('ERROR_COMMAND_INTERNAL'), ephemeral: true };
            // エラー時にもMapの状態をリセット
            serverInstances.set(instanceName, { pid: null, isRun: false });
            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp(replyOptions);
                } else {
                    await interaction.reply(replyOptions);
                }
            } catch (replyError) {
                console.error(`Failed to send error reply for "${instanceName}" start:`, replyError);
            }
        }
    }
};