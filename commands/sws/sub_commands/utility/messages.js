// commands/sws/sub_commands/utility/messages.js

const messageTemplates = {
    // --- エラーメッセージ ---
    ERROR_GENERIC: '予期せぬエラーが発生しました。詳細はBotのログを確認してください。',
    ERROR_ENV_VAR_MISSING: '設定エラー: 必要な環境変数 `{varName}` が見つかりません。Bot管理者に連絡してください。',
    ERROR_ENV_VAR_INVALID: '設定エラー: 環境変数 `{varName}` の値が無効です。Bot管理者に連絡してください。',
    ERROR_PORT_RANGE_INVALID: '設定エラー: ポート範囲 (MIN_PORT, MAX_PORT) の設定が無効です。',
    ERROR_CONFIG_NAME_INVALID: '入力エラー: 構成名には半角英数字とアンダーバーのみ使用できます。 (`{invalidName}`)',
    ERROR_TEMPLATE_NOT_FOUND: 'エラー: 指定されたテンプレート `{templateName}` が見つかりません。`/sws template_list` で確認してください。',
    ERROR_TEMPLATE_READ_FAILED: 'エラー: テンプレート `{templateName}` の読み込み中に問題が発生しました。',
    ERROR_CONFIG_ALREADY_EXISTS: 'エラー: 構成名 `{configName}` は既に使用されています。別の名前を指定してください。',
    ERROR_CONFIG_NOT_FOUND: 'エラー: 指定された構成 `{configName}` が見つかりません。`/sws list` で確認してください。',
    ERROR_CONFIG_RUNNING: '操作エラー: サーバー `{configName}`は現在起動中です。まず `/sws stop {configName}` で停止してください。',
    ERROR_NO_PERMISSION_REMOVE: '権限エラー: 構成 `{configName}` を削除する権限がありません。管理者、またはこの構成の作成者 ({creatorTag}) のみ削除できます。',
    ERROR_NO_PERMISSION_GENERIC: '権限エラー: この操作を実行する権限がありません。',
    ERROR_PORT_NOT_AVAILABLE: 'リソースエラー: 利用可能なポート番号が指定範囲 ({minPort}～{maxPort}) にありません。不要な構成を削除するか、管理者に相談してください。',
    ERROR_METADATA_READ: 'ファイルエラー: 構成 `{configName}` のメタデータ (metadata.xml) が読み込めません。',
    ERROR_METADATA_WRITE: 'ファイルエラー: 構成 `{configName}` のメタデータ (metadata.xml) の書き込みに失敗しました。',
    ERROR_CONFIG_XML_READ: 'ファイルエラー: 構成 `{configName}` の設定ファイル (server_config.xml) が読み込めません。',
    ERROR_CONFIG_XML_WRITE: 'ファイルエラー: 構成 `{configName}` の設定ファイル (server_config.xml) の書き込みに失敗しました。',
    ERROR_CONFIG_XML_PORT_UPDATE: 'ファイルエラー: 構成 `{configName}` のポート番号更新に失敗しました。',
    ERROR_DIRECTORY_COPY: 'ファイルエラー: テンプレート `{templateName}` から構成 `{configName}` へのコピーに失敗しました。',
    ERROR_DIRECTORY_REMOVE: 'ファイルエラー: 構成 `{configName}` のディレクトリ削除に失敗しました。',
    ERROR_DIRECTORY_READ: 'ファイルエラー: 構成ディレクトリの読み込みに失敗しました。',
    ERROR_COMMAND_INTERNAL: '内部エラー: コマンドの実行中に問題が発生しました。Botのログを確認してください。',
    ERROR_SUBCOMMAND_UNKNOWN: 'コマンドエラー: 不明なサブコマンドです。',
    ERROR_TASKLIST_FAILED: 'プロセスエラー: サーバープロセスの状態確認に失敗しました。',
    ERROR_TASKKILL_FAILED: 'プロセスエラー: サーバープロセス (PID: {pid}) の停止に失敗しました。',
    ERROR_SERVER_START_FAILED: 'プロセスエラー: サーバー `{configName}` の起動に失敗しました。',
    ERROR_FETCH_USER: 'Discord APIエラー: ユーザー情報 (ID: {userId}) の取得に失敗しました。',
    ERROR_INTERACTION_TIMEOUT: 'タイムアウト: 操作が時間内に完了しませんでした。',
    ERROR_CONFIG_VALIDATION_FAILED: '❌ 設定ファイル (`{fileName}`) の検証に失敗しました ({errorCount}件のエラー):\n```\n{errorDetails}\n```\n設定ファイルの内容を確認して、修正してから再度アップロードしてください。',

    // --- 成功メッセージ ---
    SUCCESS_CREATE: '✅ サーバー構成 `{configName}` を作成しました！ (テンプレート: `{templateName}`)',
    SUCCESS_REMOVE: '✅ 構成 `{configName}` を削除しました。',
    SUCCESS_STOP: '✅ サーバー `{configName}` に停止信号を送信しました。 結果: {resultMessage}',
    SUCCESS_STOP_NOT_FOUND: 'ℹ️ 停止対象のサーバープロセス `{instanceName}` は見つかりませんでした（既に停止している可能性があります）。',
    SUCCESS_STOP_FORCE: '✅ プロセスを強制停止しました。',
    SUCCESS_START_COMMAND: '🚀 サーバー `{instanceName}` の起動コマンドを実行しました。',

    // --- 確認・情報メッセージ ---
    INFO_CREATE_STARTING: '⏳ サーバー構成 `{configName}` をテンプレート `{templateName}` から作成しています...',
    INFO_REMOVE_CONFIRM: '❓ 構成 `{configName}` を本当に削除しますか？ この操作は元に戻せません。',
    INFO_REMOVE_CANCELLED: '👌 削除をキャンセルしました。',
    INFO_REMOVE_TIMEOUT: '⌛ タイムアウトしました。削除はキャンセルされました。',
    INFO_REMOVE_STARTING: '⏳ 構成 `{configName}` を削除しています...',
    INFO_LIST_EMPTY: 'ℹ️ 作成済みのサーバー構成はありません。`/sws create` で作成できます。',
    INFO_TEMPLATE_LIST_EMPTY: 'ℹ️ 利用可能なテンプレートはありません。管理者がテンプレートを配置する必要があります。',
    INFO_STOP_REQUESTING: '⏳ サーバープロセス `{instanceName}` に停止要求を送信しています...',
    INFO_ALREADY_RUNNING: 'ℹ️ サーバー `{instanceName}` は既に実行中です。',
    INFO_START_PROCESS: '⏳ サーバー `{instanceName}` の起動プロセスを開始しました。起動には少し時間がかかる場合があります。 `/sws status {instanceName}` で状態を確認してください。', // start.js 用

    // --- ボタンラベル ---
    BUTTON_CONFIRM_REMOVE: '削除する',
    BUTTON_CANCEL: 'キャンセル（削除しない）',
};

/**
 * メッセージを取得し、プレースホルダーを置換する関数
 * @param {keyof messageTemplates} key メッセージキー
 * @param {object} [placeholders={}] プレースホルダーとその値のオブジェクト (例: { configName: 'my_server', port: 45001 })
 * @returns {string} 置換後のメッセージ文字列
 */
function get(key, placeholders = {}) {
    let message = messageTemplates[key];

    if (message === undefined) {
        console.error(`[Messages] 未定義のメッセージキーが参照されました: ${key}`);
        return `[エラー: メッセージキー "${key}" が未定義です]`; // フォールバックメッセージ
    }

    // プレースホルダーを実際の値で置換
    for (const placeholder in placeholders) {
        // グローバル置換 (gフラグ) を使用して、同じプレースホルダーが複数あっても置換
        const regex = new RegExp(`\\{${placeholder}\\}`, 'g');
        // 値が undefined や null の場合は空文字に置換するなどの考慮も可能
        const value = placeholders[placeholder] !== undefined && placeholders[placeholder] !== null
                      ? String(placeholders[placeholder]) // 文字列に変換
                      : ''; // undefined や null は空文字に
        message = message.replace(regex, value);
    }

    // 置換されなかったプレースホルダーが残っているかチェック (デバッグ用)
    const remainingPlaceholders = message.match(/\{[a-zA-Z0-9_]+\}/g);
    if (remainingPlaceholders) {
        console.warn(`[Messages] メッセージキー "${key}" で置換されなかったプレースホルダーがあります: ${remainingPlaceholders.join(', ')}`);
    }


    return message;
}

module.exports = {
    get, // メッセージ取得関数をエクスポート
    // 必要ならボタンラベルなども直接エクスポート
    Buttons: {
        CONFIRM_REMOVE: messageTemplates.BUTTON_CONFIRM_REMOVE,
        CANCEL: messageTemplates.BUTTON_CANCEL,
    }
};