// [ルート]/commands/sws/sub_commands/utility/server_utils.js

const fs = require('fs/promises');
const path = require('path');
// ★ 修正: websocket_server の代わりに message_sender をインポート
const messageSender = require('./websocket/message_sender'); // メッセージ送信ユーティリティ
const utils = require('./utils');
const messages = require('./messages');
const checkConfig = require('./check_config');
// 修正: text_chat_logger のパス修正
const { log, getOrCreateLogThread } = require('../../../../utility/text_chat_logger'); // getOrCreateLogThread もインポート

/**
 * 指定された構成名の server_config.xml を読み込む
 * @param {string} configName - 構成名
 * @returns {Promise<string>} XMLファイルの内容文字列
 */
async function loadConfig(configName) {
    const dirPath = utils.getConfigPath(configName);
    const filePath = path.join(dirPath, 'server_config.xml')
    try {
        const xmlString = await fs.readFile(filePath, 'utf-8');
        return xmlString;
    } catch (error) {
        if (error.code === 'ENOENT') {
            throw new Error(`[サーバーUtils] 設定ファイルが見つかりません: ${filePath}`); // エラーメッセージに印追加
        }
        log('ERROR', `[サーバーUtils] 設定ファイル (${filePath}) の読み込みに失敗しました。`, { error });
        throw new Error(`[サーバーUtils] 設定ファイル (${configName}) の読み込みに失敗しました。`);
    }
}

/**
 * 更新された server_config.xml を保存する
 * @param {string} configName - 構成名
 * @param {string} xmlString - 保存するXMLファイルの内容文字列
 * @returns {Promise<void>}
 */
async function saveConfig(configName, xmlString) {
    const dirPath = utils.getConfigPath(configName);
    const filePath = path.join(dirPath, 'server_config.xml')
    try {
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(filePath, xmlString, 'utf-8');
        log('INFO', `[サーバーUtils] 設定ファイルが更新されました: ${filePath}`);
    } catch (error) {
        log('ERROR', `[サーバーUtils] 設定ファイル (${filePath}) の保存に失敗しました。`, { error });
        throw new Error(`[サーバーUtils] 設定ファイル (${configName}) の保存に失敗しました。`);
    }
}

// --- 公開関数 ---

/**
 * 物理サーバーにゲームサーバーの起動要求を送信する
 * @param {import('discord.js').Interaction} interaction - Discordのインタラクション (ログ用)
 * @param {string} clientId - ターゲットの物理サーバー (WebSocketクライアントID)
 * @param {string} configName - 起動するサーバー構成名
 * @returns {Promise<{success: boolean, message?: string}>} 起動要求の結果 (応答ペイロードから抜粋)
 */
async function startServer(interaction, clientId, configName) {
    const logThread = await getOrCreateLogThread(interaction);
    try {
        log('INFO', `[サーバーUtils][開始] 構成 '${configName}' の設定ファイル読み込み中...`, { interaction, thread: logThread });
        const configXml = await loadConfig(configName);
        log('INFO', `[サーバーUtils][開始] 設定ファイル '${configName}' 読み込み完了 (${configXml.length} バイト)。`, { interaction, thread: logThread });

        log('INFO', `[サーバーUtils][開始] Client ${clientId} へ起動要求送信中 (構成: ${configName})...`, { interaction, thread: logThread });
        const payload = {
            name: configName,
            config: configXml
        };
        // ★ 修正: messageSender.sendPacket を使用
        const response = await messageSender.sendPacket(clientId, { type: 'startServer', payload });

        if (response && response.success) {
            log('INFO', `[サーバーUtils][開始] サーバー '${configName}' 起動要求 成功。応答: ${response.message || '成功'}`, { interaction, data: response, thread: logThread });
            return { success: true, message: response.message }; // 応答メッセージも返す
        } else {
            const reason = response?.message || '不明な応答';
            log('WARN', `[サーバーUtils][開始] サーバー '${configName}' 起動要求 失敗。理由: ${reason}`, { interaction, data: response, thread: logThread });
            return { success: false, message: `起動要求が物理サーバー側で失敗しました: ${reason}` };
        }
    } catch (error) {
        log('ERROR', `[サーバーUtils][開始] サーバー '${configName}' の起動処理中にエラー発生。`, { error, interaction, thread: logThread });
        return { success: false, message: `内部エラーが発生しました: ${error.message}` };
    }
}

/**
 * 物理サーバーにゲームサーバーの停止要求を送信し、返却された設定ファイルを検証・保存する
 * @param {string} clientId - ターゲットの物理サーバー (WebSocketクライアントID)
 * @param {string} configName - 停止するサーバー構成名
 * @param {boolean} [confirmed=false] - プレイヤーがいても停止するかどうかの確認フラグ
 * @returns {Promise<{success: boolean, message: string, requiresConfirmation?: boolean, players?: number, savedConfig?: boolean}>} 停止要求の結果
 */
async function stopServer(clientId, configName, confirmed = false) {
    try {
        log('INFO', `[サーバーUtils][停止] Client ${clientId} へ停止要求送信中 (構成: ${configName}, 確認済: ${confirmed})...`);
        const payload = {
            name: configName,
            confirmed: confirmed
        };
        // ★ 修正: messageSender.sendPacket を使用
        const response = await messageSender.sendPacket(clientId, { type: 'stopServer', payload });

        if (!response) {
            log('ERROR', `[サーバーUtils][停止] 物理サーバー (Client: ${clientId}) から応答がありませんでした。(${configName} 停止要求)`);
            return { success: false, message: `サーバー '${configName}' の停止要求に応答がありませんでした。`, requiresConfirmation: false, savedConfig: false };
        }

        log('DEBUG', `[サーバーUtils][停止] 停止応答受信 from Client ${clientId} (${configName}):`, { data: response });

        // プレイヤー確認が必要な場合
        if (!confirmed && response.needsConfirmation && typeof response.players === 'number') {
            log('WARN', `[サーバーUtils][停止] サーバー '${configName}' (Client: ${clientId}) の停止には確認が必要です。プレイヤー数: ${response.players}`);
            return {
                success: false,
                message: `サーバー '${configName}' には現在 ${response.players} 人のプレイヤーがいます。本当に停止しますか？`,
                requiresConfirmation: true,
                players: response.players,
                savedConfig: false
            };
        }

        // 停止成功 or 確認済み
        if (response.success) {
            let savedConfig = false;
            let finalMessage = `サーバー '${configName}' の停止処理が完了しました。`;
            if (response.message) finalMessage += ` (${response.message})`;

            if (response.config && typeof response.config === 'string') {
                log('INFO', `[サーバーUtils][停止] サーバー '${configName}' から更新された設定ファイルを受信、検証します...`);
                const validationResult = await checkConfig.validateServerConfig(response.config); // checkConfig を使用
                if (validationResult.success) {
                    log('INFO', `[サーバーUtils][停止] 設定ファイル '${configName}' 検証成功、保存します...`);
                    await saveConfig(configName, response.config);
                    savedConfig = true;
                    finalMessage = `サーバー '${configName}' の停止処理が完了し、設定ファイルが更新・保存されました。`;
                    log('INFO', `[サーバーUtils][停止] 設定ファイル '${configName}' が正常に保存されました。`);
                } else {
                    log('ERROR', `[サーバーUtils][停止] 受信した設定ファイル '${configName}' の検証に失敗しました。`, { errors: validationResult.errors });
                    finalMessage = `サーバー '${configName}' は停止されましたが、受信した設定ファイルの検証に失敗しました。`;
                }
            } else {
                 log('INFO', `[サーバーUtils][停止] サーバー '${configName}' は停止されましたが、応答に設定ファイルは含まれていませんでした。`);
            }
            return { success: true, message: finalMessage, requiresConfirmation: false, savedConfig: savedConfig };

        } else {
            // 停止失敗
            const reason = response.message || '不明な理由';
            log('ERROR', `[サーバーUtils][停止] サーバー '${configName}' (Client: ${clientId}) の停止要求が物理サーバー側で失敗しました。理由: ${reason}`);
            return { success: false, message: `サーバー '${configName}' の停止要求は失敗しました: ${reason}`, requiresConfirmation: false, savedConfig: false };
        }

    } catch (error) {
        log('ERROR', `[サーバーUtils][停止] サーバー '${configName}' (Client: ${clientId}) の停止処理中にエラーが発生しました。`, { error });
        return { success: false, message: `サーバー '${configName}' の停止中に内部エラーが発生しました: ${error.message}`, requiresConfirmation: false, savedConfig: false };
    }
}

// --- モジュールエクスポート ---
module.exports = {
    startServer,
    stopServer,
    loadConfig,
    saveConfig,
};