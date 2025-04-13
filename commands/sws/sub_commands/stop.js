// commands/sws/sub_commands/stop.js

const utils = require('./utility/utils'); // ユーティリティ関数をインポート
const messages = require('./utility/messages'); // メッセージ管理モジュールをインポート

module.exports = {
    async execute(interaction, serverInstances) { // serverInstances Map を受け取る
        const instanceName = interaction.options.getString('name');
        const windowTitle = `sws_${instanceName}`; // start.js に合わせたウィンドウタイトル

        try {
            // 1. 応答を保留 (ephemeral: true で本人にのみ表示)
            await interaction.deferReply({ ephemeral: false });

            // 2. 指定されたウィンドウタイトルでサーバープロセスのPIDを検索
            let pid = null;
            try {
                pid = await utils.findServerPidByTitle(windowTitle);
            } catch (pidError) {
                 console.error(`Error checking server status for stop (${instanceName}):`, pidError);
                 await interaction.editReply({
                     content: messages.get('ERROR_TASKLIST_FAILED')
                 });
                 return;
            }


            // 3. PIDが見つからなかった場合
            if (!pid) {
                await interaction.editReply({
                    content: messages.get('SUCCESS_STOP_NOT_FOUND', { instanceName, windowTitle })
                });
                // Mapの状態も「停止中」に更新
                serverInstances.set(instanceName, { pid: null, isRun: false });
                return;
            }

            // 4. PIDが見つかった場合、停止要求を送信中であることを通知
            await interaction.editReply(messages.get('INFO_STOP_REQUESTING', { instanceName, pid }));

            // 5. プロセスを強制停止 (taskkill /F)
            let resultMessage = '';
            try {
                resultMessage = await utils.forceStopProcess(pid);
                console.log(`[INFO] Stop result for PID ${pid} ("${instanceName}"): ${resultMessage}`);
                // 停止成功/失敗に関わらず結果メッセージを followUp で表示
                await interaction.editReply({
                    content: resultMessage, ephemeral: false
                    // ポート不足エラーは本人にのみ表示が良い場合もあるが、状況により false でも可
                });

                // forceStopProcess が成功・失敗に関わらず解決した場合 (プロセスが見つからない場合も含む)
                // Mapの状態を「停止中」に更新
                serverInstances.set(instanceName, { pid: null, isRun: false });
                console.log(`[INFO] Server instance map updated for "${instanceName}" to not running.`);

            } catch (stopError) {
                // forceStopProcess が reject した場合 (taskkill 自体の実行エラーなど)
                console.error(`[ERROR] Failed to execute forceStopProcess for PID ${pid} ("${instanceName}"):`, stopError);
                await interaction.followUp({
                    content: messages.get('ERROR_TASKKILL_FAILED', { pid }),
                    ephemeral: true
                });
                // エラーが発生した場合、Mapの状態は不明瞭なため、そのままにするか、
                // あるいは停止試行はしたので isExpectedToRun=false にするかは要件次第。
                // ここでは isExpectedToRun=false にしておく。
                 serverInstances.set(instanceName, { pid: pid, isRun: false }); // PIDは残し、期待状態をfalseに
                 console.warn(`[WARN] Server instance map for "${instanceName}" set to not expected running due to stop error.`);
            }

        } catch (error) {
            // この try ブロック全体での予期せぬエラー
            console.error(`[ERROR] Unexpected error during server stop process ("${instanceName}"):`, error);
            // deferReply を使っているので editReply でエラー表示
            await interaction.editReply({ content: messages.get('ERROR_COMMAND_INTERNAL') }).catch(console.error);
            // エラー時のMapの状態は不明瞭なため、ここでは変更しない
        }
    }
};