// commands/utility/server_utils.js
const fs = require('fs')
const utils = require('../commands/sws/sub_commands/utility/utils') // ユーティリティ関数をインポート
const messages = require('../commands/sws/sub_commands/utility/messages') // メッセージ管理モジュールをインポート
const config = require('../commands/sws/sub_commands/utility/registry') // 設定情報をインポート
const path = require('node:path')
const { spawn } = require('child_process')
const chalk = require('chalk')
const { log } = require('../utility/text_chat_logger') // ロガーをインポート

// --- 設定値を取得 ---
const serverDirectory = config.serverDirectory;
const serverExeName = config.serverExecutableName;
const configBasePath = config.configBasePath;
const serverExePath = path.join(serverDirectory, serverExeName)

// runServer内で使用するメッセージキー (必要に応じてmessages.jsに追加してください)
const MSG_KEYS = {
    SERVER_EXE_NOT_FOUND: 'ERROR_SERVER_EXE_NOT_FOUND', // 仮: サーバー実行ファイルが見つからない
    CONFIG_FILE_NOT_FOUND: 'ERROR_CONFIG_FILE_NOT_FOUND', // 仮: 設定ファイルが見つからない
    ALREADY_RUNNING: 'INFO_ALREADY_RUNNING',
    START_PROCESS: 'INFO_START_PROCESS',
    START_FAILED_SPAWN: 'ERROR_SERVER_START_FAILED', // spawn自体に失敗した場合
    START_FAILED_PROCESS: 'ERROR_SERVER_START_FAILED_PROCESS', // 仮: プロセスエラーイベント
    STOPPED_UNEXPECTEDLY: 'WARN_SERVER_STOPPED_UNEXPECTEDLY', // 仮: 予期せず停止
    AUTO_RESTART_SUCCESS: 'INFO_AUTO_RESTART_SUCCESS', // 仮: 自動再起動成功
    AUTO_RESTART_FAILED: 'ERROR_AUTO_RESTART_FAILED', // 仮: 自動再起動失敗
    AUTO_RESTART_EXCEPTION: 'ERROR_AUTO_RESTART_EXCEPTION' // 仮: 自動再起動中例外
}

async function runServer(serverInstances, instanceName, interaction, logThread) {

    log('INFO', `サーバー起動リクエスト受信: "${instanceName}"`, { interaction, thread: logThread })

    const windowTitle = `sws_${instanceName}` // サーバープロセスのウィンドウタイトル
    const configDir = path.join(configBasePath, instanceName)

    // --- 事前チェック ---
    // 1. 実行ファイル存在確認
    if (!fs.existsSync(serverExePath)) {
        const errorMsg = messages.get(MSG_KEYS.SERVER_EXE_NOT_FOUND, { filePath: serverExePath })
        log('ERROR', `サーバー実行ファイルが見つかりません: ${serverExePath}`, { interaction, thread: logThread })
        await interaction.reply({ content: errorMsg, ephemeral: true }) // ユーザーに設定ミスを通知
        return // 処理中断
    }
    // 2. 設定ファイル存在確認
    const configFile = path.join(configDir, 'server_config.xml')
    if (!fs.existsSync(configDir) || !fs.existsSync(configFile)) {
        const errorMsg = messages.get(MSG_KEYS.CONFIG_FILE_NOT_FOUND, { filePath: configFile })
        log('ERROR', `サーバー設定ファイルが見つかりません: ${configFile}`, { interaction, thread: logThread })
        await interaction.reply({ content: errorMsg, ephemeral: true }) // ユーザーに設定ミスを通知
        return // 処理中断
    }

    // 3. 既に実行中か確認
    const serverState = serverInstances.get(instanceName)
    if (serverState?.isRun) {
        const infoMsg = messages.get(MSG_KEYS.ALREADY_RUNNING, { instanceName })
        log('INFO', `サーバー "${instanceName}" は既に実行中です。`, { interaction, thread: logThread })
        await interaction.reply({ content: infoMsg, ephemeral: false }) // 既に実行中であることを通知
        return // 処理中断
    }

    // 5. 実行するコマンド文字列を構築
    const command = `start "${windowTitle}" /D "${serverDirectory}" "${serverExePath}" +server_dir "${configDir}"`

    log('INFO', `サーバー "${instanceName}" の起動コマンドを準備しました。`, {
        interaction,
        thread: logThread,
        details: {
            workingDir: serverDirectory,
            configDir: configDir,
            command: command
        }
    })
    console.log(chalk.bgCyan(`[INFO] Starting server ${instanceName}...`))
    console.log(chalk.bgCyan(`   Working Directory: ${serverDirectory}`))
    console.log(chalk.bgCyan(`   Config Directory: ${configDir}`))
    console.log(chalk.bgCyan(`   Command: ${command}`))

    try {
        // 6. `spawn` を使用して `start` コマンドを実行
        const serverProcess = spawn(command, [], {
            shell: true,    // OSのシェル (cmd.exe) を介して実行
            detached: true, // Botプロセスから切り離す (Botが落ちてもサーバーは残る場合がある)
            // stdio: 'ignore' // 必要に応じて標準入出力を無視する設定
        })

        // `spawn` 自体の成功/失敗イベントリスナー
        serverProcess.on('spawn', () => {
            // これは `cmd.exe` (シェル) が起動したことを示す。サーバー自体の起動成功は別。
            log('INFO', `サーバー "${instanceName}" の起動シェルプロセス (PID: ${serverProcess.pid}) が開始されました。`, { interaction, thread: logThread })
            // 状態マップを「起動試行中」として更新 (サーバー自身のPIDはまだ不明)
            　(instanceName, { pid: serverProcess.pid, isRun: true }) // pidは後で特定する必要がある
        })

        serverProcess.on('error', async (err) => {
            const errorMsg = messages.get(MSG_KEYS.START_FAILED_PROCESS, { configName: instanceName })
            log('ERROR', `サーバープロセス "${instanceName}" の起動中にエラーが発生しました。`, { interaction, error: err, thread: logThread })
            serverInstances.set(instanceName, { pid: null, isRun: false }) // 失敗時は状態をリセット

            // interactionが未応答の場合のみfollowUpでエラー通知
            if (!interaction.replied && !interaction.deferred) {
                await interaction.followUp({ content: errorMsg, ephemeral: false })
            } else if (interaction.replied || interaction.deferred) {
                // 既に 'INFO_START_PROCESS' で応答済みの場合は編集する
                await interaction.editReply({ content: errorMsg })
            }
        })

        serverProcess.on('close', async (code) => {
            log('INFO', `サーバー "${instanceName}" の起動シェルプロセスが終了しました (コード: ${code})。`, { interaction, thread: logThread })

            const state = serverInstances.get(instanceName)
            // isRunがtrue = Botとしては起動しているはずなのにシェルプロセスが終了した場合 -> 予期せぬ停止の可能性
            if (state?.isRun) {
                const warnMsg = messages.get(MSG_KEYS.STOPPED_UNEXPECTEDLY, { instanceName }) // messages.js に追加想定
                log('WARN', `サーバー "${instanceName}" が予期せず停止した可能性があります (シェル終了コード: ${code})。自動再起動を試みます...`, { interaction, thread: logThread })

                // ユーザーにも通知 (再起動試行中)
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: warnMsg, ephemeral: false })
                }

                // 状態を一旦リセットしてから再起動
                serverInstances.set(instanceName, { pid: null, isRun: false })

                try {
                    // runServer を再帰呼び出しで再起動を試みる
                    // 注意: 即時クラッシュが繰り返されると無限ループの可能性あり。リトライ回数制限などを検討。
                    await runServer(serverInstances, instanceName, interaction, logThread)
                    // 再帰呼び出し内で応答するため、ここでは成功/失敗の応答は不要
                    // log('INFO', `サーバー "${instanceName}" の自動再起動プロセスを開始しました。`, { interaction, thread: logThread })

                } catch (restartError) {
                    log('ERROR', `サーバー "${instanceName}" の自動再起動中に予期せぬエラーが発生しました。`, { interaction, error: restartError, thread: logThread })
                    if (interaction.replied || interaction.deferred) {
                        await interaction.followUp({ content: messages.get(MSG_KEYS.AUTO_RESTART_EXCEPTION, { instanceName }), ephemeral: false })
                    }
                    serverInstances.set(instanceName, { pid: null, isRun: false }) // 念のため状態リセット
                }
            } else {
                // isRunがfalse = 停止コマンド実行後など、予期された停止
                log('DEBUG', `サーバー "${instanceName}" は実行期待状態ではないため、再起動はスキップします。`, { interaction, thread: logThread })
                // この場合、既にstopServerなどで応答しているはずなので、ここでは応答しない
            }
        })

        // 7. 親プロセス (Node.js) がシェルプロセスを待たずに終了できるように `unref` を呼ぶ
        // detached: true と併用することで、Botが終了してもサーバープロセスが独立して動作し続けることを期待
        serverProcess.unref()

        // spawnの呼び出し自体は成功したので、ユーザーに「起動プロセス開始」を通知
        const startMsg = messages.get(MSG_KEYS.START_PROCESS, { instanceName })
        log('INFO', `サーバー "${instanceName}" の起動プロセスを開始しました。`, { interaction, thread: logThread })
        // 初回応答 or defer後の編集
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: startMsg, ephemeral: false })
        } else if (interaction.deferred) {
            await interaction.editReply({ content: startMsg })
        }
        // 正常に起動プロセスを開始した場合、ここで一旦終了。結果はイベントハンドラが処理する。

    } catch (spawnError) {
        // spawn自体が例外を投げた場合 (コマンドが見つからない、権限問題など)
        const errorMsg = messages.get(MSG_KEYS.START_FAILED_SPAWN, { configName: instanceName })
        log('ERROR', `サーバープロセス "${instanceName}" の起動(spawn)に失敗しました。`, { interaction, error: spawnError, thread: logThread })
        serverInstances.set(instanceName, { pid: null, isRun: false }) // 失敗時は状態をリセット
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: errorMsg, ephemeral: false })
        } else if (interaction.deferred) {
            await interaction.editReply({ content: errorMsg })
        }
    }
}


async function stopServer(interaction, serverInstances, logThread) { // serverInstances Map を受け取る
    const instanceName = interaction.options.getString('name')
    const serverState = serverInstances.get(instanceName)

    // メッセージキーを定数化 (例)
    const STOP_MSG_KEYS = {
        ALREADY_STOPPED: 'INFO_ALREADY_STOPPED',
        SUCCESS_STOP: 'SUCCESS_STOP', // SUCCESS_STOPはresultMessageプレースホルダが必要かもしれない
        STOP_FAILED: 'ERROR_STOP_FAILED'
    }


    if (!serverState?.isRun || serverState?.pid === null) { // pidがない場合も停止しているとみなす
        const stopMsg = messages.get(STOP_MSG_KEYS.ALREADY_STOPPED, { instanceName: instanceName }) // instanceName を渡す
        log('INFO', `サーバー "${instanceName}" は既に停止しています。`, { interaction, thread: logThread })
        await interaction.reply({ content: stopMsg, ephemeral: false })
        return
    }

    log('INFO', `サーバー "${instanceName}" (PID: ${serverState.pid}) の停止を開始します。`, { interaction, thread: logThread })

    try {
        // forceStopProcess に PID を渡す
        const resultMessage = await utils.forceStopProcess(serverState.pid) // forceStopProcessがメッセージを返すように変更想定
        serverInstances.set(instanceName, { pid: null, isRun: false })
        log('INFO', `サーバー "${instanceName}" を停止しました。結果: ${resultMessage}`, { interaction, thread: logThread })

        // messages.js の SUCCESS_STOP が {resultMessage} を受け取れるか確認が必要
        // 受け取れない場合は、resultMessageの内容に応じてメッセージキーを変えるか、固定メッセージにする
        let successMsg;
        if (resultMessage.includes("見つかりません")) {
             // forceStopProcessが見つからない旨を返した場合、INFO_ALREADY_STOPPED を使う方が適切かもしれない
             successMsg = messages.get(STOP_MSG_KEYS.ALREADY_STOPPED, { instanceName: instanceName }) + ` (プロセス情報: ${resultMessage})`
        } else {
             // messages.jsのSUCCESS_STOPがresultMessageを受け取らない場合、固定メッセージ
             successMsg = messages.get(STOP_MSG_KEYS.SUCCESS_STOP, { configName: instanceName, resultMessage: "停止処理を実行しました。" }) // 固定メッセージ例
             // もし受け取れるなら: messages.get(STOP_MSG_KEYS.SUCCESS_STOP, { configName: instanceName, resultMessage: resultMessage })
        }

        await interaction.reply({ content: successMsg, ephemeral: false })

    } catch (error) {
        const errorMsg = messages.get(STOP_MSG_KEYS.STOP_FAILED, { configName: instanceName })
        console.error(`[ERROR] Failed to stop server instance "${instanceName}" (PID: ${serverState?.pid}):`, error)
        log('ERROR', `サーバー "${instanceName}" (PID: ${serverState?.pid}) の停止に失敗しました。`, { interaction, error, thread: logThread })

        // 失敗した場合でも状態をリセットするかは要検討 (リトライさせたい場合など)
        // serverInstances.set(instanceName, { pid: serverState.pid, isRun: true }) // 失敗時は状態を戻す？ or falseのまま？

        await interaction.reply({ content: errorMsg, ephemeral: false })
    }
}

module.exports = {
    runServer,
    stopServer
}