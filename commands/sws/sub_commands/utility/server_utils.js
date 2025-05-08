// [ルート]/commands/sws/sub_commands/utility/server_utils.js

// --- Node.js 標準モジュール ---
const fs = require('fs/promises'); // ファイルシステム (Promiseベース)
const path = require('path');     // パス操作

// --- 外部モジュール ---
// WebSocketメッセージ送信ユーティリティ (応答待ち機能付き)
const messageSender = require('./websocket/message_sender');
// 内部ユーティリティ関数 (パス取得など)
const utils = require('./utils');
// ユーザー向けメッセージテンプレート
const messages = require('./messages');
// server_config.xml 検証ユーティリティ
const checkConfig = require('./check_config');
// ログ出力ユーティリティ
const { log, getOrCreateLogThread } = require('../../../../utility/text_chat_logger');

/**
 * 指定された構成名の server_config.xml ファイルの内容を読み込む
 * @param {string} configName - 読み込む構成の名前
 * @returns {Promise<string>} 読み込んだXMLファイルの内容 (UTF-8文字列)
 * @throws {Error} ファイルが見つからない、または読み込みに失敗した場合
 */
async function loadConfig(configName) {
    // utils を使って設定ファイルのフルパスを取得
    const dirPath = utils.getConfigPath(configName);
    const filePath = path.join(dirPath, 'server_config.xml');
    try {
        // ファイルの内容をUTF-8で読み込む
        const xmlString = await fs.readFile(filePath, 'utf-8');
        return xmlString;
    } catch (error) {
        if (error.code === 'ENOENT') {
            // ファイルが存在しない場合のエラー
            log('WARN', `[サーバーUtils] 設定ファイルが見つかりません: ${filePath}`, { configName });
            throw new Error(`[サーバーUtils] 設定ファイルが見つかりません: ${configName}`);
        }
        // その他の読み込みエラー
        log('ERROR', `[サーバーUtils] 設定ファイル (${filePath}) の読み込みに失敗しました。`, { error, configName });
        throw new Error(`[サーバーUtils] 設定ファイル (${configName}) の読み込みに失敗しました。`);
    }
}

/**
 * 指定された構成名で server_config.xml ファイルを保存する
 * @param {string} configName - 保存する構成の名前
 * @param {string} xmlString - 保存するXMLファイルの内容 (UTF-8文字列)
 * @returns {Promise<void>}
 * @throws {Error} ディレクトリ作成またはファイル書き込みに失敗した場合
 */
async function saveConfig(configName, xmlString) {
    // utils を使って設定ファイルのフルパスを取得
    const dirPath = utils.getConfigPath(configName);
    const filePath = path.join(dirPath, 'server_config.xml');
    try {
        // 保存先ディレクトリが存在しない場合は再帰的に作成
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });
        // ファイルをUTF-8で書き込む
        await fs.writeFile(filePath, xmlString, 'utf-8');
        log('INFO', `[サーバーUtils] 設定ファイルが更新/保存されました: ${filePath}`, { configName });
    } catch (error) {
        // 書き込みエラー
        log('ERROR', `[サーバーUtils] 設定ファイル (${filePath}) の保存に失敗しました。`, { error, configName });
        throw new Error(`[サーバーUtils] 設定ファイル (${configName}) の保存に失敗しました。`);
    }
}

// --- 公開関数 ---

/**
 * 物理サーバーにゲームサーバーの起動要求を送信する
 * @param {import('discord.js').Interaction} interaction - Discordのインタラクション (ログスレッド取得用)
 * @param {string} clientId - ターゲットの物理サーバー (WebSocketクライアントID)
 * @param {string} configName - 起動するサーバー構成名
 * @param {object} [discordContext=null] - Discordメッセージのコンテキスト情報 { messageId, channelId, guildId } (任意)
 * @returns {Promise<{success: boolean, message?: string, assignedPort?: number, failedItemIDs?: string[], name?: string}>}
 * 起動要求の結果。Goクライアントからの応答ペイロードを含む。
 */
async function startServer(interaction, clientId, configName, discordContext = null) {
    const logThread = await getOrCreateLogThread(interaction); // ログ出力用のスレッドを取得/作成
    try {
        // 1. 設定ファイル読み込み
        log('INFO', `[サーバーUtils][開始] 構成 '${configName}' の設定ファイル読み込み中...`, { interaction, thread: logThread });
        const configXml = await loadConfig(configName);
        log('INFO', `[サーバーUtils][開始] 設定ファイル '${configName}' 読み込み完了 (${configXml.length} バイト)。`, { interaction, thread: logThread });

        // 2. 起動要求ペイロード作成
        const payload = {
            name: configName, // 構成名をペイロードに含める
            config: configXml // 設定ファイル内容をペイロードに含める
        };

        // 3. WebSocketで起動要求を送信
        log('INFO', `[サーバーUtils][開始] Client ${clientId} へ起動要求送信中 (構成: ${configName})...`, { interaction, thread: logThread });
        const response = await messageSender.sendPacket(
            clientId,                      // 送信先クライアントID
            { type: 'startServer', payload }, // 送信するデータ
            undefined,                     // タイムアウト (デフォルト値を使用)
            'startServer',                 // リクエストタイプ (message_handlerでの識別用)
            configName,                    // インスタンス名
            discordContext                 // Discordメッセージコンテキスト (進捗更新用)
        );

        // 4. Goクライアントからの応答を処理
        if (response && response.success) {
            // 起動成功
            log('INFO', `[サーバーUtils][開始] サーバー '${configName}' 起動要求 成功。応答: ${response.message || '成功'}`, { interaction, data: response, thread: logThread });
            return {
                success: true,
                message: response.message,          // Goクライアントからのメッセージ
                assignedPort: response.assignedPort,  // Goクライアントが割り当てたポート番号
                failedItemIDs: response.failedItemIDs, // ワークショップダウンロード失敗リスト
                name: configName                    // 構成名も返す (message_handler用)
            };
        } else {
            // 起動失敗
            const reason = response?.message || '不明な応答';
            log('WARN', `[サーバーUtils][開始] サーバー '${configName}' 起動要求 失敗。理由: ${reason}`, { interaction, data: response, thread: logThread });
            return { success: false, message: `起動要求が物理サーバー側で失敗しました: ${reason}`, name: configName };
        }
    } catch (error) {
        // この関数内での予期せぬエラー
        log('ERROR', `[サーバーUtils][開始] サーバー '${configName}' の起動処理中にエラー発生。`, { error, interaction, thread: logThread });
        return { success: false, message: `内部エラーが発生しました: ${error.message}`, name: configName };
    }
}

/**
 * 物理サーバーにゲームサーバーの停止要求を送信し、返却された設定ファイルを検証・保存する
 * @param {string} clientId - ターゲットの物理サーバー (WebSocketクライアントID)
 * @param {string} configName - 停止するサーバー構成名
 * @param {boolean} [confirmed=false] - プレイヤーがいても停止するかどうかの確認フラグ
 * @param {object} [discordContext=null] - Discordメッセージのコンテキスト情報 { messageId, channelId, guildId } (任意、停止時にも使う場合)
 * @returns {Promise<{success: boolean, message: string, requiresConfirmation?: boolean, players?: number, savedConfig?: boolean, name?: string}>}
 * 停止要求の結果。Goクライアントからの応答ペイロードを含む。
 */
async function stopServer(clientId, configName, confirmed = false, discordContext = null) {
    // この関数はインタラクションオブジェクトを直接使わないため、ログスレッドは取得しない
    try {
        // 1. 停止要求ペイロード作成
        log('INFO', `[サーバーUtils][停止] Client ${clientId} へ停止要求送信中 (構成: ${configName}, 確認済: ${confirmed})...`);
        const payload = {
            name: configName,    // 構成名をペイロードに含める
            confirmed: confirmed // 停止確認済みフラグ
        };

        // 2. WebSocketで停止要求を送信
        const response = await messageSender.sendPacket(
            clientId,                      // 送信先クライアントID
            { type: 'stopServer', payload },  // 送信するデータ
            undefined,                     // タイムアウト (デフォルト値を使用)
            'stopServer',                  // リクエストタイプ (message_handlerでの識別用)
            configName,                    // インスタンス名
            discordContext                 // Discordメッセージコンテキスト (停止完了通知の更新用など)
        );

        // 3. Goクライアントからの応答を処理
        if (!response) {
            // 応答がない場合
            log('ERROR', `[サーバーUtils][停止] 物理サーバー (Client: ${clientId}) から応答がありませんでした。(${configName} 停止要求)`);
            return { success: false, message: `サーバー '${configName}' の停止要求に応答がありませんでした。`, requiresConfirmation: false, savedConfig: false, name: configName };
        }

        log('DEBUG', `[サーバーUtils][停止] 停止応答受信 from Client ${clientId} (${configName}):`, { data: response });

        // 3a. プレイヤーがいて確認が必要な場合
        if (!confirmed && response.needsConfirmation && typeof response.players === 'number') {
            log('WARN', `[サーバーUtils][停止] サーバー '${configName}' (Client: ${clientId}) の停止には確認が必要です。プレイヤー数: ${response.players}`);
            return {
                success: false,
                message: `サーバー '${configName}' には現在 ${response.players} 人のプレイヤーがいます。本当に停止しますか？`,
                requiresConfirmation: true, // stop.js がこれをみて確認ボタンを出す
                players: response.players,
                savedConfig: false,
                name: configName
            };
        }

        // 3b. 停止成功の場合 (確認不要 or 確認済み)
        if (response.success) {
            let savedConfig = false; // 設定ファイルが保存されたかフラグ
            let finalMessage = `サーバー '${configName}' の停止処理が完了しました。`;
            if (response.message) {
                finalMessage += ` (${response.message})`; // Goクライアントからのメッセージを追加
            }

            // 応答に設定ファイルが含まれていれば検証・保存
            if (response.config && typeof response.config === 'string') {
                log('INFO', `[サーバーUtils][停止] サーバー '${configName}' から更新された設定ファイルを受信、検証します...`);
                const validationResult = await checkConfig.validateServerConfig(response.config);
                if (validationResult.success) {
                    // 検証成功
                    log('INFO', `[サーバーUtils][停止] 設定ファイル '${configName}' 検証成功、保存します...`);
                    await saveConfig(configName, response.config); // ファイル保存
                    savedConfig = true;
                    finalMessage = `サーバー '${configName}' の停止処理が完了し、設定ファイルが更新・保存されました。`;
                    log('INFO', `[サーバーUtils][停止] 設定ファイル '${configName}' が正常に保存されました。`);
                } else {
                    // 検証失敗
                    log('ERROR', `[サーバーUtils][停止] 受信した設定ファイル '${configName}' の検証に失敗しました。`, { errors: validationResult.errors });
                    finalMessage = `サーバー '${configName}' は停止されましたが、受信した設定ファイルの検証に失敗しました。`;
                    // 設定ファイルは保存しない
                }
            } else {
                 // 応答に設定ファイルが含まれていない場合
                 log('INFO', `[サーバーUtils][停止] サーバー '${configName}' は停止されましたが、応答に設定ファイルは含まれていませんでした。`);
            }
            // 最終的な結果を返す
            return { success: true, message: finalMessage, requiresConfirmation: false, savedConfig: savedConfig, name: configName };

        } else {
            // 3c. 停止失敗の場合
            const reason = response.message || '不明な理由';
            log('ERROR', `[サーバーUtils][停止] サーバー '${configName}' (Client: ${clientId}) の停止要求が物理サーバー側で失敗しました。理由: ${reason}`);
            return { success: false, message: `サーバー '${configName}' の停止要求は失敗しました: ${reason}`, requiresConfirmation: false, savedConfig: false, name: configName };
        }

    } catch (error) {
        // この関数内での予期せぬエラー
        log('ERROR', `[サーバーUtils][停止] サーバー '${configName}' (Client: ${clientId}) の停止処理中にエラーが発生しました。`, { error });
        return { success: false, message: `サーバー '${configName}' の停止中に内部エラーが発生しました: ${error.message}`, requiresConfirmation: false, savedConfig: false, name: configName };
    }
}

// --- モジュールエクスポート ---
module.exports = {
    startServer,
    stopServer,
    loadConfig,
    saveConfig,
};