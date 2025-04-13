// commands/utility/server_utils.js
const fs = require('fs');
const utils = require('./utils'); // ユーティリティ関数をインポート
const messages = require('./messages'); // メッセージ管理モジュールをインポート
const config = require('./registry'); // 設定情報をインポート
const path = require('node:path');
const { spawn } = require('child_process');

 // --- 設定値を取得 ---
 const serverDirectory = config.serverDirectory;
 const serverExeName = config.serverExecutableName;
 const configBasePath = config.configBasePath;
 const serverExePath = path.join(serverDirectory, serverExeName);


async function runServer(serverInstances, instanceName) {

    console.log(`[INFO] Starting server instance: ${instanceName}`);

    const windowTitle = `sws_${instanceName}`; // サーバープロセスのウィンドウタイトル
    const configDir = path.join(configBasePath, instanceName);

  // --- 事前チェック ---
    // 1. 実行ファイル存在確認
    if (!fs.existsSync(serverExePath)) {
        const errorMsg = messages.get('ERROR_SERVER_EXE_NOT_FOUND', { filePath: serverExePath });
        console.error(`[runServer] ${errorMsg}`);
        return { success: false, error: errorMsg };
    }
    // 2. 設定ファイル存在確認
    const configFile = path.join(configDir, 'server_config.xml');
    if (!fs.existsSync(configDir) || !fs.existsSync(configFile)) {
        const errorMsg = messages.get('ERROR_CONFIG_FILE_NOT_FOUND', { filePath: configFile });
        console.error(`[runServer] ${errorMsg}`);
        return { success: false, error: errorMsg };
    }

    let currentPid = null;
    try {
        // ★ await を使って Promise の解決を待つ
        currentPid = await utils.findServerPidByTitle(windowTitle);
        console.log(`[runServer] Checked for existing PID for "${instanceName}": ${currentPid}`);

        if (currentPid) {
            console.log(`[runServer] ${infoMsg}`);
            // 状態マップ更新
            serverInstances.set(instanceName, { pid: currentPid, isRun: true });
            return  messages.get('INFO_ALREADY_RUNNING', { instanceName, windowTitle, pid: currentPid });
        }

        // Map上は実行中だがプロセスが見つからない場合のリセット
        const instanceState = serverInstances.get(instanceName);
        // ★ isExpectedToRun をチェック
        if (instanceState?.isRun) {
            console.warn(`[runServer][WARN] Process for "${instanceName}" not found, but state was 'expected running'. Resetting state before attempt.`);
            // 起動試行前に isExpectedToRun を false にする必要はないかもしれない
            // serverInstances.set(instanceName, { pid: null, isExpectedToRun: false });
        }

    } catch (pidError) {
        console.error(`[runServer] Error checking PID for "${instanceName}": ${pidError}`);
        return messages.get('ERROR_TASKLIST_FAILED')
    }


    // 5. 実行するコマンド文字列を構築
    // `start "タイトル"` で新しいウィンドウで起動
    // `/D "作業ディレクトリ"` で実行時のカレントディレクトリを指定
    // `"+server_dir パス"` でStormworksサーバーに設定ディレクトリを渡す
    const command = `start "${windowTitle}" /D "${serverDirectory}" "${serverExePath}" +server_dir "${configDir}"`;

    console.log(`[INFO] Starting server ${instanceName}...`);
    console.log(`  Working Directory: ${serverDirectory}`);
    console.log(`  Config Directory: ${configDir}`);
    console.log(`  Command: ${command}`);

    // 6. `spawn` を使用して `start` コマンドを実行
    const serverProcess = spawn(command, [], {
        //stdio: 'ignore', // startコマンドを実行するシェル自体の入出力は無視
        shell: true,     // OSのシェル (cmd.exe) を介して実行
        detached: true   // 親プロセス (Node.js) から切り離す
    });

    if (serverProcess.error) {
        console.error(`[ERROR] Failed to spawn server process for "${instanceName}":`, serverProcess.error);
        return messages.get('ERROR_SERVER_START_FAILED', { configName: instanceName });
    }

    // `spawn` 自体の成功/失敗イベントリスナー
    serverProcess.on('spawn', () => {
        // これは `cmd.exe` が起動したことを示す。サーバー自体が起動成功したかは別。
        console.log(`[INFO] Shell process (PID: ${serverProcess.pid}) for starting "${instanceName}" spawned successfully.`);
        // 状態マップを「起動試行中」として更新 (PIDはまだ不明)
        serverInstances.set(instanceName, { pid: null, isRun: true });
    });

    serverProcess.on('error', (err) => {
        // `start` コマンドの実行自体に失敗した場合 (コマンドが見つからない等)
        console.error(`[ERROR] Failed to spawn shell process for starting "${instanceName}":`, err);
        interaction.followUp({
            content: messages.get('ERROR_SERVER_START_FAILED', { configName: instanceName }),
            ephemeral: true
        }).catch(console.error);
        // 状態マップをリセット
        serverInstances.set(instanceName, { pid: null, isRun: false });
    });

    serverProcess.on('close', (code) => {
        // シェルプロセスが終了した際のログ (通常はすぐに終了する)
        console.log(`[INFO] Shell process for starting "${instanceName}" closed with code ${code}.`);
        // シェルが正常終了しても、startされたサーバーがエラー終了する可能性はある
    });

    // 7. 親プロセス (Node.js) がシェルプロセスを待たずに終了できるように `unref` を呼ぶ
    serverProcess.unref();

    return null; // サーバープロセスを返す
}

module.exports = {
    runServer
}