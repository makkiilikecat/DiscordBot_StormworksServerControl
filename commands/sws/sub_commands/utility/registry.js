// commands/utility/sws/utils/registry.js
console.log(__dirname)
const path = require('node:path')
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') }) // ルートの .env を読み込むようにパスを調整

const config = {}

// --- パス設定 ---
config.templateBasePath = process.env.SERVER_TEMPLATE_BASE_PATH
if (!config.templateBasePath)  throw new Error('[Registry Error] 環境変数 SERVER_TEMPLATE_BASE_PATH が設定されていません。')

config.configBasePath = process.env.SERVER_CONFIG_BASE_PATH
if (!config.configBasePath) throw new Error('[Registry Error] 環境変数 SERVER_BOT_CONFIG_BASE_PATH が設定されていません。')

config.serverDirectory = process.env.SERVER_DIR_NAME
if (!config.serverDirectory) throw new Error('[Registry Error] 環境変数 SERVER_DIR_NAME が設定されていません。')

// --- 実行ファイル名 ---
config.serverExecutableName = process.env.SERVER_EXE_NAME
if (!config.serverExecutableName) throw new Error('[Registry Error] 環境変数 SERVER_EXE_NAME が設定されていません。')
if (!config.serverExecutableName.endsWith('.exe')) throw new Error('[Registry Error] 環境変数 SERVER_EXE_NAME は拡張子 .exe を含む必要があります。')

// --- ポート範囲設定 ---
config.minPort = parseInt(process.env.MIN_PORT, 10)
config.maxPort = parseInt(process.env.MAX_PORT, 10)
if (isNaN(config.minPort)) throw new Error('[Registry Error] 環境変数 MIN_PORT が数値として無効です。')
if (isNaN(config.maxPort)) throw new Error('[Registry Error] 環境変数 MAX_PORT が数値として無効です。')
if (config.minPort > config.maxPort) throw new Error(`[Registry Error] ポート範囲が無効です: MIN_PORT (<span class="math-inline">\{config\.minPort\}\) が MAX\_PORT \(</span>{config.maxPort}) より大きいです。`)
if (config.minPort < 1024 || config.maxPort > 65535) throw new Error(`[Registry Error] ポート範囲が無効です: MIN_PORT (<span class="math-inline">\{config\.minPort\}\) は 1024 以上、MAX\_PORT \(</span>{config.maxPort}) は 65535 以下でなければなりません。`)

// --- SteamCMD 設定 ---
config.steamCmdPath = process.env.STEAMCMD_PATH;
if (!config.steamCmdPath) throw new Error('[Registry Error] 環境変数 STEAMCMD_PATH が設定されていません。');

config.steamCmdLoginArgs = process.env.STEAMCMD_LOGIN_ARGS;
if (!config.steamCmdLoginArgs) throw new Error('[Registry Error] 環境変数 STEAMCMD_LOGIN_ARGS が設定されていません。');

config.stormworksAppId = process.env.STORMWORKS_APP_ID || '573090';
if (!/^\d+$/.test(config.stormworksAppId)) throw new Error('[Registry Error] 環境変数 STORMWORKS_APP_ID が数値として無効です。');

config.workshopContentPath = process.env.WORKSHOP_CONTENT_PATH;
// パスは必須とする（シンボリックリンク作成と存在確認に必要）
if (!config.workshopContentPath) throw new Error('[Registry Error] 環境変数 WORKSHOP_CONTENT_PATH が設定されていません。');
// App ID が含まれているか簡易チェック（必須ではないが推奨）
if (!config.workshopContentPath.endsWith(config.stormworksAppId)) {
    console.warn(`[Registry Warning] WORKSHOP_CONTENT_PATH (${config.workshopContentPath}) が App ID (${config.stormworksAppId}) で終わっていません。正しいパスか確認してください。`);
}


// --- 設定内容をログ出力 (デバッグ用) ---
console.log('--- Configuration Registry Loaded ---')
console.log(`Template Base Path: ${config.templateBasePath}`)
console.log(`Bot Config Base Path: ${config.configBasePath}`)
console.log(`Server Directory: ${config.serverDirectory}`)
console.log(`Server Executable: ${config.serverExecutableName}`)
console.log(`Port Range: ${config.minPort} - ${config.maxPort}`)
console.log(`SteamCMD Path: ${config.steamCmdPath}`)
console.log(`SteamCMD Login Args: ${config.steamCmdLoginArgs}`)
console.log(`Stormworks App ID: ${config.stormworksAppId}`)
console.log(`Workshop Content Path: ${config.workshopContentPath}`)
console.log('------------------------------------')

// 設定オブジェクトを凍結して変更不可にする
module.exports = Object.freeze(config)