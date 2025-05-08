// [ルート]/commands/sws/sub_commands/status.js

const { EmbedBuilder, time } = require('discord.js');
const clientManager = require('./utility/websocket/client_manager'); // クライアントマネージャー
const { log, getOrCreateLogThread } = require('../../../utility/text_chat_logger'); // ロガー
const config = require('./utility/registry'); // ポート範囲取得用 (最大数計算)

// ★ serverInstances Map を外部から受け取る想定
//    起動中サーバー数をカウントするために必要
let serverInstancesRef = null;
function setServerInstances(map) {
    serverInstancesRef = map;
}

module.exports = {
    // ★ serverInstances を受け取るように execute を変更
    async execute(interaction, serverInstances) {
        setServerInstances(serverInstances); // 参照を設定
        const logThread = await getOrCreateLogThread(interaction);
        await interaction.deferReply({ ephemeral: false }); // 公開情報として表示
        log('INFO', '[ステータス] /sws status コマンド実行', { interaction, thread: logThread });

        try {
            const connectedClients = clientManager.getConnectedClients(); // オンラインの物理サーバーリスト取得

            if (connectedClients.length === 0) {
                log('INFO', '[ステータス] 接続中の物理サーバーはありません。', { interaction, thread: logThread });
                await interaction.editReply('現在オンラインの物理サーバーはありません。');
                return;
            }

            log('DEBUG', `[ステータス] ${connectedClients.length} 件のオンライン物理サーバー情報取得。`, { data: connectedClients, thread: logThread });

            const embed = new EmbedBuilder()
                .setTitle('🖥️ 物理サーバーステータス')
                .setColor(0x0099FF) // 青色
                .setTimestamp();

            // ★ 各オンラインサーバーの情報を非同期で取得・整形
            const fieldPromises = connectedClients.map(async (client) => {
                // サーバー所有者情報の取得
                let ownerName = '不明なユーザー';
                let ownerMention = '';
                if (client.creatorId && interaction.client) {
                    try {
                        const user = await interaction.client.users.fetch(client.creatorId);
                        ownerName = user.displayName || user.username; // ディスプレイ名を優先
                        ownerMention = user.toString(); // <@USER_ID>
                    } catch {
                        ownerName = `ID:${client.creatorId.substring(0, 6)}...`;
                    }
                } else if (client.creatorId) {
                     ownerName = `ID:${client.creatorId.substring(0, 6)}...`;
                }

                // オンライン時間の計算
                let onlineDuration = '不明';
                if (client.connectedAt) {
                    try {
                        const connectedTimestamp = Math.floor(new Date(client.connectedAt).getTime() / 1000);
                        onlineDuration = time(connectedTimestamp, 'R'); // 相対時間を表示 (例: "3時間前")
                    } catch { /* Ignore date parse error */ }
                }

                // 起動中サーバー数のカウント
                let runningServerCount = 0;
                if (serverInstancesRef) {
                    for (const instanceState of serverInstancesRef.values()) {
                        // ★ トークンで紐付ける
                        if (instanceState.token === client.token && instanceState.status === 'running') {
                            runningServerCount++;
                        }
                    }
                } else {
                     log('WARN', '[ステータス] serverInstances が参照できないため、起動中サーバー数をカウントできません。');
                }

                // Ping値
                const ping = client.ping !== null ? `${client.ping}ms` : '計測中/失敗';
                // 物理サーバー側で同時起動可能なサーバー数
                const maxServerCount = client.maxServers || "最大数不明"

                // フィールド作成
                return {
                    name: `🔹 ${client.physicalServerName} (所有者: ${ownerName})`,
                    value: `オンライン: ${onlineDuration}\n起動中サーバー: ${runningServerCount} / ${maxServerCount}\nPing: ${ping}\n所有者メンション: ${ownerMention}`, // 必要ならメンションも追加
                    inline: false // 各サーバー情報を縦に表示
                };
            });

            // 全てのフィールド情報が解決するのを待つ
            const fields = await Promise.all(fieldPromises);

            // Embedにフィールドを追加 (最大25件)
            if (fields.length > 0) {
                 embed.addFields(fields.slice(0, 25));
                 if (fields.length > 25) {
                      embed.setFooter({ text: `⚠️ 表示件数の上限を超えています (${fields.length}件中25件表示)` });
                 }
            } else {
                embed.setDescription('オンラインの物理サーバー情報が取得できませんでした。'); // 念のため
            }


            await interaction.editReply({ embeds: [embed] });
            log('INFO', '[ステータス] 物理サーバーステータス表示完了。', { interaction, thread: logThread });

        } catch (error) {
            log('ERROR', '[ステータス] ステータス表示中にエラー発生。', { error, interaction, thread: logThread });
            try {
                await interaction.editReply({ content: messages.get('ERROR_COMMAND_INTERNAL'), embeds: [], components: [] });
            } catch (e) {
                log('ERROR', '[ステータス] エラー応答編集失敗。', { error: e, thread: logThread });
            }
        }
    }
};