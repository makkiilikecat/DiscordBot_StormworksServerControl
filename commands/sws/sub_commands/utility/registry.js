console.log(__dirname)
const path = require('node:path')
const chalk = require('chalk') // chalkのインポート形式を修正

// デバッグモードの設定
const DEBUG_MODE = true // true: 詳細なデバッグログを表示, false: 基本的なログのみ

if (DEBUG_MODE) {
    console.log(chalk.blue('[DEBUG] Loading configuration registry...'))
} else {
    console.log('[INFO] Loading configuration registry...')
}

// --- .env ファイルのパスをプロジェクトルートからの相対パスで解決 ---
// テスト実行時(__dirname が test/integration/ などになる)でも、
// 通常実行時(__dirname が commands/sws/sub_commands/utility になる)でも
// プロジェクトルートの .env を参照するようにする
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') })

const config = {}

// --- パス設定 ---
config.templateBasePath = process.env.SERVER_TEMPLATE_BASE_PATH
if (!config.templateBasePath) {
    console.error(chalk.red('[ERROR] SERVER_TEMPLATE_BASE_PATH is not set.'))
    throw new Error('[Registry Error] 環境変数 SERVER_TEMPLATE_BASE_PATH が設定されていません。')
} else if (DEBUG_MODE) {
    console.log(chalk.green(`[DEBUG] SERVER_TEMPLATE_BASE_PATH: ${config.templateBasePath}`))
}

config.configBasePath = process.env.SERVER_CONFIG_BASE_PATH
if (!config.configBasePath) throw new Error('[Registry Error] 環境変数 SERVER_BOT_CONFIG_BASE_PATH が設定されていません。')

config.serverDirectory = process.env.SERVER_DIR_NAME
if (!config.serverDirectory) throw new Error('[Registry Error] 環境変数 SERVER_DIR_NAME が設定されていません。')

config.maxServerConfigCount = process.env.MAX_SERVER_CONFIG_COUNT
if (!config.maxServerConfigCount) throw new Error('[Registry Error] 環境変数 MAX_SERVER_CONFIG_COUNT が設定されていません。')
if (isNaN(config.maxServerConfigCount)) throw new Error('[Registry Error] 環境変数 MAX_SERVER_CONFIG_COUNT が数値ではありません。')

// --- 実行ファイル名 ---
config.serverExecutableName = process.env.SERVER_EXE_NAME
if (!config.serverExecutableName) throw new Error('[Registry Error] 環境変数 SERVER_EXE_NAME が設定されていません。')
if (!config.serverExecutableName.endsWith('.exe')) throw new Error('[Registry Error] 環境変数 SERVER_EXE_NAME は拡張子 .exe を含む必要があります。')

// --- SteamCMD 設定 ---
config.steamCmdPath = process.env.STEAMCMD_PATH;
if (!config.steamCmdPath) throw new Error('[Registry Error] 環境変数 STEAMCMD_PATH が設定されていません。')

config.steamCmdLoginArgs = process.env.STEAMCMD_LOGIN_ARGS;
if (!config.steamCmdLoginArgs) throw new Error('[Registry Error] 環境変数 STEAMCMD_LOGIN_ARGS が設定されていません。')

config.stormworksAppId = process.env.STORMWORKS_APP_ID || '573090'
if (!/^\d+$/.test(config.stormworksAppId)) throw new Error('[Registry Error] 環境変数 STORMWORKS_APP_ID が数値として無効です。')

config.workshopContentPath = process.env.WORKSHOP_CONTENT_PATH;
// パスは必須とする（シンボリックリンク作成と存在確認に必要）
if (!config.workshopContentPath) throw new Error('[Registry Error] 環境変数 WORKSHOP_CONTENT_PATH が設定されていません。')
// App ID が含まれているか簡易チェック（必須ではないが推奨）
if (!config.workshopContentPath.endsWith(config.stormworksAppId)) {
    console.warn(`[Registry Warning] WORKSHOP_CONTENT_PATH (${config.workshopContentPath}) が App ID (${config.stormworksAppId}) で終わっていません。正しいパスか確認してください。`)
}

// --- Discord Log Channel ---
config.discordLogChannelId = process.env.DISCORD_LOG_CHANNEL_ID;
if (!config.discordLogChannelId) {
    console.warn(chalk.yellow('[Registry Warning] DISCORD_LOG_CHANNEL_ID が .env に設定されていません。Discordへのログ出力は無効になります。'))
}

// --- 設定内容をログ出力 (デバッグ用) ---
console.log('--- Configuration Registry Loaded ---')
console.log(`Template Base Path: ${config.templateBasePath}`)
console.log(`Bot Config Base Path: ${config.configBasePath}`)
console.log(`Server Directory: ${config.serverDirectory}`)
console.log(`Server Executable: ${config.serverExecutableName}`)
console.log(`SteamCMD Path: ${config.steamCmdPath}`)
console.log(`SteamCMD Login Args: ${config.steamCmdLoginArgs}`)
console.log(`Stormworks App ID: ${config.stormworksAppId}`)
console.log(`Workshop Content Path: ${config.workshopContentPath}`)
console.log('------------------------------------')

if (DEBUG_MODE) {
    console.log(chalk.green('[DEBUG] Configuration registry loaded successfully.'))
    console.log(`Stormworks App ID: ${config.stormworksAppId}`)
    console.log(`Workshop Content Path: ${config.workshopContentPath}`)
    console.log(`Token Storage Path: ${config.tokenStoragePath}`)
    console.log('------------------------------------')
}

if (DEBUG_MODE) {
    console.log(chalk.green('[DEBUG] Configuration registry loaded successfully.'))
} else {
    console.log('[INFO] Configuration registry loaded successfully.')
}

// 設定オブジェクトを凍結して変更不可にする
module.exports = Object.freeze(config)