// chalkのインポート形式を修正
const chalk = require('chalk')

// デバッグモードの設定
const DEBUG_MODE = true // true: 詳細なデバッグログを表示, false: 基本的なログのみ

if (DEBUG_MODE) {
    console.log(chalk.blue('[DEBUG] Initializing message templates...'))
} else {
    console.log('[INFO] Initializing message templates...')
}

// commands/sws/sub_commands/utility/messages.js

const messageTemplates = {
    // =============================================
    // --- ユーザー操作に関するエラー ---
    // =============================================

    // --- 入力・指定に関するエラー ---
    ERROR_CONFIG_NAME_INVALID: '❌ 入力エラー: 構成名には半角英数字とアンダーバーのみ使用できます (`{invalidName}`)',
    ERROR_TEMPLATE_NOT_FOUND: '❌ エラー: 指定されたテンプレート `{templateName}` が見つかりません。`/sws template_list` で利用可能なテンプレートを確認してください。',
    ERROR_CONFIG_NOT_FOUND: '❌ エラー: 指定された構成 `{configName}` が見つかりません。`/sws list` で存在する構成を確認してください。',
    ERROR_CONFIG_ALREADY_EXISTS: '❌ エラー: 構成名 `{configName}` は既に使用されています。別の名前を指定してください。',
    ERROR_SUBCOMMAND_UNKNOWN: '❓ コマンドエラー: `{subCommand}` は不明なサブコマンドです。使用可能なコマンドを確認してください。', // どのサブコマンドが不明かを示すように変更

    // --- 権限に関するエラー ---
    ERROR_NO_PERMISSION_REMOVE: '🚫 権限エラー: 構成 `{configName}` を削除する権限がありません。削除できるのは、管理者またはこの構成の作成者 ({creatorTag}) のみです。',
    ERROR_NO_PERMISSION_GENERIC: '🚫 権限エラー: この操作を実行するための権限がありません。',

    // --- サーバーの状態に関するエラー ---
    ERROR_CONFIG_RUNNING: '⚠️ 操作エラー: サーバー `{configName}` は現在起動中です。まず `/sws stop {configName}` で停止してください。',

    // --- 設定ファイルの検証エラー ---
    ERROR_CONFIG_VALIDATION_FAILED: '❌ 設定ファイル (`{fileName}`) の検証に失敗しました ({errorCount}件のエラー):\n```\n{errorDetails}\n```\nファイルの内容を確認し、修正してから再度アップロードしてください。', // ユーザーが直接修正する必要があるため詳細は表示

    // =============================================
    // --- Botの設定・環境に関するエラー (主に管理者向け) ---
    // =============================================
    ERROR_ENV_VAR_MISSING: '🛠️ 設定エラー: Botの動作に必要な設定 (`{varName}`) が見つかりません。Bot管理者に連絡してください。',
    ERROR_ENV_VAR_INVALID: '🛠️ 設定エラー: Botの設定 (`{varName}`) の値が無効です。Bot管理者に連絡してください。',
    ERROR_PORT_RANGE_INVALID: '🛠️ 設定エラー: Botのポート番号範囲 (MIN_PORT, MAX_PORT) の設定が無効です。Bot管理者に連絡してください。',
    ERROR_PORT_NOT_AVAILABLE: '⚠️ リソースエラー: サーバーに使用できるポート番号 ({minPort}～{maxPort}) が見つかりません。不要なサーバー構成を削除するか、Bot管理者に相談してください。',
    INFO_TEMPLATE_LIST_EMPTY: 'ℹ️ 利用可能なテンプレートがありません。管理者がテンプレートを準備する必要があります。', // エラーというより情報

    // =============================================
    // --- 内部処理エラー (主に管理者向け) ---
    // =============================================

    // --- ファイルシステム関連エラー ---
    ERROR_TEMPLATE_READ_FAILED: '📂 ファイルエラー: テンプレート `{templateName}` の読み込みに失敗しました。Bot管理者に連絡してください。',
    ERROR_METADATA_READ: '📂 ファイルエラー: 構成 `{configName}` の情報ファイルの読み込みに失敗しました。Bot管理者に連絡してください。',
    ERROR_METADATA_WRITE: '📂 ファイルエラー: 構成 `{configName}` の情報ファイルの書き込みに失敗しました。Bot管理者に連絡してください。',
    ERROR_CONFIG_XML_READ: '📂 ファイルエラー: 構成 `{configName}` の設定ファイルの読み込みに失敗しました。Bot管理者に連絡してください。',
    ERROR_CONFIG_XML_WRITE: '📂 ファイルエラー: 構成 `{configName}` の設定ファイルの書き込みに失敗しました。Bot管理者に連絡してください。',
    ERROR_CONFIG_XML_PORT_UPDATE: '📂 ファイルエラー: 構成 `{configName}` の設定ファイル（ポート番号）の更新に失敗しました。Bot管理者に連絡してください。',
    ERROR_DIRECTORY_COPY: '📂 ファイルエラー: テンプレート `{templateName}` から `{configName}` へのコピー中にエラーが発生しました。Bot管理者に連絡してください。',
    ERROR_DIRECTORY_REMOVE: '📂 ファイルエラー: 構成 `{configName}` の削除中にエラーが発生しました。Bot管理者に連絡してください。',
    ERROR_DIRECTORY_READ: '📂 ファイルエラー: サーバー構成フォルダの読み込みに失敗しました。Bot管理者に連絡してください。',

    // --- プロセス管理関連エラー ---
    ERROR_TASKLIST_FAILED: '🖥️ プロセスエラー: 実行中のサーバーの状態を確認できませんでした。Bot管理者に連絡してください。',
    ERROR_TASKKILL_FAILED: '🖥️ プロセスエラー: サーバープロセス (関連PID: {pid}) の停止に失敗しました。Bot管理者に連絡してください。', // PIDは管理者向け情報として残す場合
    ERROR_SERVER_START_FAILED: '🖥️ プロセスエラー: サーバー `{configName}` の起動に失敗しました。Bot管理者に連絡してください。',
    ERROR_STOP_FAILED: '❌ サーバー `{configName}` の停止に失敗しました。Bot管理者に確認してください。', // configNameを追加

    // =============================================
    // --- Discord API / ネットワークエラー ---
    // =============================================
    ERROR_FETCH_USER: '🌐 Discord連携エラー: ユーザー情報 (ID: {userId}) を取得できませんでした。時間をおいて再度試すか、Bot管理者に連絡してください。',
    ERROR_INTERACTION_TIMEOUT: '⌛ タイムアウト: 操作が時間内に完了しませんでした。もう一度試してください。',

    // =============================================
    // --- 一般的なエラー / フォールバック ---
    // =============================================
    ERROR_GENERIC: '❌ 予期せぬエラーが発生しました。問題が解決しない場合は、Bot管理者に連絡してください。',
    ERROR_COMMAND_INTERNAL: '⚙️ 内部エラー: コマンドの処理中に問題が発生しました。Bot管理者に連絡してください。',

    // =============================================
    // --- 成功メッセージ ---
    // =============================================
    SUCCESS_CREATE: '✅ サーバー構成 `{configName}` を作成しました！ (テンプレート: `{templateName}`)',
    SUCCESS_REMOVE: '✅ 構成 `{configName}` を削除しました。',
    SUCCESS_STOP: '✅ サーバー `{configName}` を停止しました。',
    SUCCESS_STOP_NOT_FOUND: 'ℹ️ 停止対象のサーバープロセス `{instanceName}` は見つかりませんでした（既に停止している可能性があります）。',
    SUCCESS_STOP_FORCE: '✅ プロセスを強制停止しました。', // instanceName は taskkill コマンドの性質上、特定が難しい場合があるため汎用的なメッセージに
    SUCCESS_START_COMMAND: '🚀 サーバー `{instanceName}` の起動を開始しました。', // 「コマンドを実行」より「開始」の方が簡潔

    // =============================================
    // --- 確認・情報メッセージ ---
    // =============================================
    INFO_CREATE_STARTING: '⏳ サーバー構成 `{configName}` をテンプレート `{templateName}` から作成しています...',
    INFO_REMOVE_CONFIRM: '❓ 構成 `{configName}` を本当に削除しますか？ この操作は元に戻せません。',
    INFO_REMOVE_CANCELLED: '👌 削除をキャンセルしました。',
    INFO_REMOVE_TIMEOUT: '⌛ 時間切れのため、削除はキャンセルされました。',
    INFO_REMOVE_STARTING: '⏳ 構成 `{configName}` を削除しています...',
    INFO_LIST_EMPTY: 'ℹ️ 作成済みのサーバー構成はありません。`/sws create` で作成できます。',
    INFO_ALREADY_STOPPED: 'ℹ️ サーバー `{instanceName}` は既に停止しています。',
    INFO_ALREADY_RUNNING: 'ℹ️ サーバー `{instanceName}` は既に実行中です。',
    INFO_START_PROCESS: '⏳ サーバー `{instanceName}` を起動中です。起動には時間がかかる場合があります。`/sws status {instanceName}` で状態を確認できます。', // start.js 用, 状態確認コマンドを案内

    // =============================================
    // --- ボタンラベル ---
    // =============================================
    BUTTON_CONFIRM_REMOVE: 'はい、削除します', // より明確に
    BUTTON_CANCEL: 'いいえ、キャンセルします', // より明確に
}

/**
 * メッセージを取得し、プレースホルダーを置換する関数
 * @param {keyof messageTemplates} key メッセージキー
 * @param {object} [placeholders={}] プレースホルダーとその値のオブジェクト (例: { configName: 'my_server', port: 45001 })
 * @returns {string} 置換後のメッセージ文字列
 */
function get(key, placeholders = {}) {
    let message = messageTemplates[key]

    if (message === undefined) {
        console.error(`[Messages] 未定義のメッセージキーが参照されました: ${key}`)
        // ユーザーにはシンプルなエラーメッセージを表示
        return `[エラー: メッセージを準備できませんでした。キー: ${key}]`
    }

    // プレースホルダーを実際の値で置換
    for (const placeholder in placeholders) {
        // グローバル置換 (gフラグ) を使用して、同じプレースホルダーが複数あっても置換
        const regex = new RegExp(`\\{${placeholder}\\}`, 'g')
        // 値が undefined や null の場合は空文字に置換するなどの考慮も可能
        const value = placeholders[placeholder] !== undefined && placeholders[placeholder] !== null
                        ? String(placeholders[placeholder]) // 文字列に変換
                        : '' // undefined や null は空文字に
        message = message.replace(regex, value)
    }

    // 置換されなかったプレースホルダーが残っているかチェック (デバッグモード時のみ)
    if (DEBUG_MODE) {
        const remainingPlaceholders = message.match(/\{[a-zA-Z0-9_]+\}/g)
        if (remainingPlaceholders) {
            console.warn(chalk.yellow(`[Messages] メッセージキー "${key}" で置換されなかったプレースホルダーがあります: ${remainingPlaceholders.join(', ')}`))
        }
    }

    return message;
}

if (DEBUG_MODE) {
    console.log(chalk.green('[DEBUG] Message templates initialized successfully.'))
} else {
    console.log('[INFO] Message templates initialized successfully.')
}

module.exports = {
    get, // メッセージ取得関数をエクスポート
    // ボタンラベルも直接エクスポート (より直感的なキー名に変更)
    Buttons: {
        CONFIRM_REMOVE: messageTemplates.BUTTON_CONFIRM_REMOVE,
        CANCEL_REMOVE: messageTemplates.BUTTON_CANCEL, // キー名を変更
    }
}