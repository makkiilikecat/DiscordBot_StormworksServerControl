// [ルート]/commands/sws/sub_commands/utility/token_manager.js

const fs = require('fs/promises'); // ファイル非同期操作用
const crypto = require('crypto'); // トークン生成用
const path = require('path');     // パス操作用
const { log } = require('../../../../utility/text_chat_logger'); // ロガーのパス修正
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') }); // .env のパス修正

// --- 定数定義 ---
const TOKENS_FILE_PATH = process.env.TOKENS_STORAGE || './tokens.json'; // トークン保存ファイルパス
const UNUSED_TOKEN_EXPIRY_DAYS = 3; // 未使用トークンの有効期限（日数）

// --- 内部関数 (loadTokens, saveTokensToFile は変更なし) ---

/**
 * トークンデータをファイルから読み込む。
 * ファイルが存在しない、空、または不正なJSONの場合は空の配列を返す。
 * @returns {Promise<Array<object>>} トークンデータの配列
 * @throws {Error} 致命的なファイル読み込みエラーが発生した場合 (例: 権限不足)
 */
async function loadTokens() {
    try {
        const absolutePath = path.resolve(TOKENS_FILE_PATH);
        const data = await fs.readFile(absolutePath, 'utf-8');

        if (!data || data.trim() === '') {
            return [];
        }

        try {
            const parsedData = JSON.parse(data);
            if (!Array.isArray(parsedData)) {
                log('WARN', `[トークン管理] 警告: トークンファイル (${TOKENS_FILE_PATH}) の内容がJSON配列形式ではありません。空のリストとして扱います。`, { data: { fileContentStart: data.substring(0, 100) }});
                return [];
            }
            return parsedData;
        } catch (parseError) {
            log('ERROR', `[トークン管理] エラー: トークンファイル (${TOKENS_FILE_PATH}) の内容が有効なJSONではありません。空のリストとして扱います。`, { error: parseError });
            return [];
        }
    } catch (error) {
        if (error.code === 'ENOENT') {
            log('INFO', `[トークン管理] トークンファイル (${TOKENS_FILE_PATH}) が見つかりません。新規作成されます。`);
            return [];
        }
        log('ERROR', `[トークン管理] トークンファイルの読み込み中に予期せぬエラーが発生しました。`, { error });
        throw new Error(`トークンファイルの読み込みに失敗しました (${error.code || 'Unknown Error'})。`);
    }
}

/**
 * トークンデータをファイルに書き込む
 * @param {Array<object>} tokens 保存するトークンデータの配列 (必ず配列が渡される想定)
 * @returns {Promise<void>}
 * @throws {Error} ファイル書き込み中にエラーが発生した場合
 */
async function saveTokensToFile(tokens) {
    if (!Array.isArray(tokens)) {
        log('ERROR', "[トークン管理] 内部エラー: saveTokensToFile に配列でないデータが渡されました。", { data: tokens });
        throw new Error("トークンデータの保存に失敗しました: 無効なデータ形式です。");
    }
    try {
        const absolutePath = path.resolve(TOKENS_FILE_PATH);
        const dir = path.dirname(absolutePath);
        await fs.mkdir(dir, { recursive: true });
        const jsonString = JSON.stringify(tokens, null, 2);
        await fs.writeFile(absolutePath, jsonString, 'utf-8');
        // log('DEBUG', `[トークン管理] トークンデータをファイルに保存しました: ${absolutePath}`);
    } catch (error) {
        log('ERROR', `[トークン管理] トークンファイル (${TOKENS_FILE_PATH}) の書き込みに失敗しました。`, { error });
        throw new Error(`トークンファイルの書き込みに失敗しました (${error.code || 'Unknown Error'})。`);
    }
}

// --- 公開関数 ---

/**
 * 安全なランダムトークンを生成する
 * @param {number} [length=32] 生成するトークンの長さ (バイト単位)
 * @returns {string} Base64エンコードされたトークン文字列
 */
function createToken(length = 32) {
    return crypto.randomBytes(length).toString('base64');
}

/**
 * 新しいトークンを生成し、指定された作成者IDと共に保存する
 * @param {string} creatorId トークン作成者のDiscordユーザーID
 * @returns {Promise<{success: boolean, token: string|null, error: string|null}>} 保存結果。成功時はトークンも返す。
 */
async function saveToken(creatorId, serverName) {
    try {
        if (!serverName || serverName.length === 0 || serverName.length > 50) { // 名前長チェックなど
            return { success: false, token: null, error: '物理サーバー名は1文字以上50文字以下で指定してください。' };
       }
        const newToken = createToken();
        const tokens = await loadTokens();
        const tokenData = {
            token: newToken,
            creatorId: creatorId,
            name: serverName,
            connectionCount: 0,
            lastConnectedAt: null,
            createdAt: new Date().toISOString(),
        };
        tokens.push(tokenData);
        await saveTokensToFile(tokens);
        log('INFO', `[トークン管理] 新トークン生成・保存: ...${newToken.slice(-4)} (作成者: ${creatorId}, サーバー名: ${serverName})`);
        return { success: true, token: newToken, error: null };
    } catch (error) {
        log('ERROR', '[トークン管理] トークンの保存中にエラーが発生しました。', { error: error });
        return { success: false, token: null, error: `トークンの保存に失敗しました: ${error.message}` };
    }
}

/**
 * 提供されたトークンが有効か検証する。有効な場合は接続情報を更新する。
 * @param {string} tokenToValidate 検証するトークン文字列
 * @returns {Promise<{isValid: boolean, creatorId: string|null, tokenData: object|null, error: string|null}>} 検証結果。有効な場合は作成者IDとトークン情報も返す。
 */
async function validateToken(tokenToValidate) {
    try {
        const tokens = await loadTokens();
        const foundTokenIndex = tokens.findIndex(t => t.token === tokenToValidate);

        if (foundTokenIndex === -1) {
            return { isValid: false, creatorId: null, tokenData: null, error: '無効なトークンです。' };
        }

        const foundToken = tokens[foundTokenIndex];
        foundToken.connectionCount = (foundToken.connectionCount || 0) + 1;
        foundToken.lastConnectedAt = new Date().toISOString();
        await saveTokensToFile(tokens);
        // ログは connection_handler で出すのでここでは抑制
        // log('DEBUG', `[トークン管理] トークンが検証されました: ${tokenToValidate.substring(0,8)}... (作成者: ${foundToken.creatorId})`);
        // 修正: tokenData も返すようにする
        return { isValid: true, creatorId: foundToken.creatorId, tokenData: foundToken, error: null };
    } catch (error) {
        log('ERROR', '[トークン管理] トークンの検証中にエラーが発生しました。', { error: error });
        return { isValid: false, creatorId: null, tokenData: null, error: `トークンの検証中にエラーが発生しました: ${error.message}` };
    }
}

/**
 * 古い未使用トークンを削除する (Bot起動時などに呼び出す)
 */
async function checkTokens() {
    // (この関数の実装は変更なし)
    try {
        let tokens = await loadTokens();
        const initialCount = tokens.length;
        const now = new Date();
        const expiryDate = new Date(now);
        expiryDate.setDate(now.getDate() - UNUSED_TOKEN_EXPIRY_DAYS);

        const validTokens = tokens.filter(token => {
             if (token.connectionCount && token.connectionCount > 0) {
                 return true;
             }
             let createdAtDate;
             try {
                 createdAtDate = new Date(token.createdAt);
                 if (isNaN(createdAtDate.getTime())) throw new Error("Invalid date");
             } catch (e) {
                 log('WARN',`[トークン管理] トークン ${token.token?.substring(0,8)}... の作成日時 (${token.createdAt}) が不正です。安全のため保持します。`);
                 return true;
             }
             if (createdAtDate > expiryDate) {
                 return true;
             }
             log('INFO', `[トークン管理] 期限切れの未使用トークンを削除します: ${token.token?.substring(0,8)}... (作成日時: ${token.createdAt})`);
             return false;
        });

        const removedCount = initialCount - validTokens.length;
        if (removedCount > 0) {
            await saveTokensToFile(validTokens);
            log('INFO', `[トークン管理] ${removedCount} 件の期限切れ未使用トークンを削除しました。`);
        } else {
            // log('DEBUG', '[トークン管理] 削除対象の期限切れ未使用トークンはありませんでした。');
        }
        return { success: true, removedCount: removedCount, error: null };
    } catch (error) {
        log('ERROR', '[トークン管理] トークンのチェック（期限切れ削除）中にエラーが発生しました。', { error: error });
        return { success: false, removedCount: 0, error: `トークンのチェック中にエラーが発生しました: ${error.message}` };
    }
}

/**
 * ★ 新規追加: 指定された作成者IDに紐づくトークンリスト（末尾4文字）を取得する
 * @param {string} creatorId - DiscordユーザーID
 * @returns {Promise<string[]>} - トークン末尾4文字の配列
 */
async function getTokenList(creatorId) {
    if (!creatorId) {
        return [];
    }
    try {
        const tokens = await loadTokens();
        const userTokens = tokens
            .filter(token => token.creatorId === creatorId && token.token) // 作成者が一致し、トークンが存在するもの
            .map(token => `...${token.token.slice(-4)}`); // 末尾4文字を取得
        return userTokens;
    } catch (error) {
        log('ERROR', `[トークン管理] ユーザー (${creatorId}) のトークンリスト取得中にエラーが発生しました。`, { error: error });
        return []; // エラー時は空リストを返す
    }
}

// --- モジュールエクスポート ---
module.exports = {
    createToken,
    saveToken,
    validateToken,
    checkTokens,
    getTokenList, // ★ 追加
    loadTokens, // 状態同期などで外部から参照する可能性を考慮してエクスポート
};