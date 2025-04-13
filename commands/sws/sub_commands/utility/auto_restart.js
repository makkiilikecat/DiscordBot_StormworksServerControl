// commands/utility/sws/auto_restart.js
const utils = require('./utils');       // PID検索など
const serverUtils = require('../utility/server_utils'); // start.js の execute を呼び出すため
const sws = require('../../sws'); // start.js の execute を呼び出すため

let intervalId = null;          // setIntervalのID
let serverInstancesMap = null;  // 監視対象のサーバー状態Mapへの参照
let discordClient = null;       // Discord Clientインスタンスへの参照 (ログ用などに必要なら)
const restarting = new Set();   // 現在再起動処理中のサーバー名を保持するSet (多重起動防止)
const restartCooldown = new Map(); // 再起動クールダウンMap (キー: instanceName, 値: タイムスタンプ)

const CHECK_INTERVAL = 10 * 1000; // チェック間隔 (10秒)
const RESTART_COOLDOWN = 60 * 1000; // 再起動クールダウン (60秒) - 失敗時に連続試行を防ぐ

/**
 * 自動再起動モニタリングを開始する
 * @param {import('discord.js').Client} client Discordクライアント
 * @param {Map<string, { pid: number | null, isRun: boolean }>} serverInstances サーバー状態Map
 */
function startMonitoring(client, serverInstances) {
    if (intervalId) {
        console.warn('[AutoRestart] Monitoring is already active.');
        return;
    }
    if (!client || !serverInstances) {
        console.error('[AutoRestart] Failed to start: Discord Client or serverInstances Map is missing.');
        return;
    }

    discordClient = client;
    serverInstancesMap = serverInstances;
    restarting.clear(); // 念のためクリア
    restartCooldown.clear(); // 念のためクリア

    console.log(`[AutoRestart] Starting monitoring with ${CHECK_INTERVAL / 1000} second interval.`);

    intervalId = setInterval(async () => {
        // console.log('[AutoRestart] Checking server statuses...'); // 定期実行のログ (デバッグ用)
        if (!serverInstancesMap) return; // Mapがなければ何もしない

        const now = Date.now();

        for (const [instanceName, state] of serverInstancesMap.entries()) {
            // 1. 起動が期待されているサーバーか？
            if (!state.isRun) {
                // 起動期待でなければクールダウン解除
                if (restartCooldown.has(instanceName)) {
                    restartCooldown.delete(instanceName);
                    console.log(`[AutoRestart] Cleared cooldown for "${instanceName}" (not expected to run).`);
                }
                continue; // 次のサーバーへ
            }

            // 2. 現在再起動処理中でないか？
            if (restarting.has(instanceName)) {
                // console.log(`[AutoRestart] Server "${instanceName}" is currently being restarted. Skipping check.`);
                continue; // 次のサーバーへ
            }

            // 3. プロセス存在確認
            const windowTitle = `sws_${instanceName}`; // タイトル規則を確認
            let pid = null;
            try {
                pid = await utils.findServerPidByTitle(windowTitle);

                if (pid === null) {
                    // プロセスが見つからない -> 再起動が必要
                    console.log(`[AutoRestart] Expected process for "${instanceName}" not found.`);

                    // 4. クールダウン確認
                    const lastAttempt = restartCooldown.get(instanceName);
                    if (lastAttempt && (now - lastAttempt < RESTART_COOLDOWN)) {
                        // console.log(`[AutoRestart] Restart for "${instanceName}" is on cooldown. Skipping.`);
                        continue; // クールダウン中
                    }

                    // 5. 再起動処理開始
                    console.log(`[AutoRestart] Attempting to restart "${instanceName}"...`);
                    restarting.add(instanceName); // 再起動処理中フラグを立てる
                    restartCooldown.set(instanceName, now); // クールダウン開始

                    // start.jsのexecuteを呼び出すための擬似 interaction オブジェクト
                    // メッセージ送信は不要なので、ログ出力用のダミー関数を用意
                    const mockInteraction = {
                         options: {
                             getString: (key) => key === 'name' ? instanceName : null,
                         },
                         reply: async (options) => console.log(`[AutoRestart] Mock Reply (start ${instanceName}):`, typeof options === 'string' ? options : options.content),
                         followUp: async (options) => console.log(`[AutoRestart] Mock FollowUp (start ${instanceName}):`, typeof options === 'string' ? options : options.content),
                         deferReply: async () => console.log(`[AutoRestart] Mock DeferReply (start ${instanceName})`),
                         editReply: async (options) => console.log(`[AutoRestart] Mock EditReply (start ${instanceName}):`, typeof options === 'string' ? options : options.content),
                         user: discordClient.user, // Bot自身の情報
                         // 以下は start.js が使っていなければ不要 or null
                         channel: null,
                         guild: null,
                         member: null,
                         replied: false,
                         deferred: false,
                     };

                    try {
                        // start.js の execute を呼び出し、serverInstancesMap も渡す
                        const { serverProcess, message } = await serverUtils.runServer(serverInstancesMap, instanceName);

                        if (serverProcess == null) {
                            console.error(`[AutoRestart] Failed to start server "${instanceName}":`, message);
                            // 再起動失敗時はクールダウンを維持
                            return;
                        }

                        console.log(`[AutoRestart] Restart process initiated for "${instanceName}".`);
                        // 成功した場合もクールダウンは維持（すぐに落ちる可能性もあるため）
                    } catch (startError) {
                        console.error(`[AutoRestart] Error executing start command for "${instanceName}":`, startError);
                        // エラー発生時もクールダウンは維持
                    } finally {
                        restarting.delete(instanceName); // 再起動処理中フラグを解除
                    }

                } else {
                    // プロセスが見つかった場合
                    // MapのPIDが古ければ更新
                    if (state.pid !== pid) {
                        console.log(`[AutoRestart] Updating PID for running "${instanceName}" from ${state.pid} to ${pid}.`);
                        serverInstancesMap.set(instanceName, { ...state, pid: pid });
                    }
                    // 正常に動作しているのでクールダウン解除
                    if (restartCooldown.has(instanceName)) {
                        restartCooldown.delete(instanceName);
                        console.log(`[AutoRestart] Cleared cooldown for "${instanceName}" (process found).`);
                    }
                }

            } catch (error) {
                // findServerPidByTitle 自体のエラーなど
                console.error(`[AutoRestart] Error checking status for "${instanceName}":`, error);
            }
        }
    }, CHECK_INTERVAL);

    return intervalId; // タイマーIDを返す (必要なら)
}

/**
 * 自動再起動モニタリングを停止する
 */
function stopMonitoring() {
    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        serverInstancesMap = null; // 参照解除
        discordClient = null;
        restarting.clear();
        restartCooldown.clear();
        console.log('[AutoRestart] Monitoring stopped.');
    }
}

module.exports = {
    startMonitoring,
    stopMonitoring,
};