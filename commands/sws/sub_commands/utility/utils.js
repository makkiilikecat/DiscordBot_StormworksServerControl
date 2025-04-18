// commands/utility/utils.js
const fs = require('node:fs').promises;
const path = require('node:path')
const { exec } = require('node:child_process')
const iconvLite = require('iconv-lite')
const xml2js = require('xml2js')
const config = require('./registry')
const chalk = require('chalk')

const SERVER_EXECUTABLE_NAME = config.serverExecutableName;
const SERVER_TEMPLATE_BASE_PATH = config.templateBasePath;
const SERVER_CONFIG_BASE_PATH = config.configBasePath;
const MIN_PORT = config.minPort;
const MAX_PORT = config.maxPort;

// デバッグモードの設定
const DEBUG_MODE = true // true: 詳細なデバッグログを表示, false: 基本的なログのみ

// XMLパーサーとビルダー
const parser = new xml2js.Parser()
const builder = new xml2js.Builder()

/**
 * 構成名が有効かチェック (英数字とアンダーバーのみ)
 * @param {string} name チェックする構成名
 * @returns {boolean} 有効な場合は true, 無効な場合は false
 */
function isValidConfigName(name) {
    if (!name) {
        if (DEBUG_MODE) {
            console.log(chalk.yellow('[DEBUG] Config name is empty or undefined.'))
        }
        return false;
    }
    // 半角英数字とアンダーバーのみ許可
    const validNameRegex = /^[a-zA-Z0-9_]+$/;
    const isValid = validNameRegex.test(name)
    if (DEBUG_MODE) {
        console.log(chalk.blue(`[DEBUG] Config name validation for "${name}": ${isValid}`))
    }
    return isValid;
}

/**
 * テンプレートディレクトリのパスを取得
 * @param {string} templateName テンプレート名
 * @returns {string} テンプレートディレクトリのフルパス
 */
function getTemplatePath(templateName) {
    const fullPath = path.join(SERVER_TEMPLATE_BASE_PATH, templateName)
    if (DEBUG_MODE) {
        console.log(chalk.green(`[DEBUG] Resolved template path for "${templateName}": ${fullPath}`))
    }
    return fullPath;
}

/**
 * Bot用構成ディレクトリのパスを取得
 * @param {string} configName 構成名
 * @returns {string} 構成ディレクトリのフルパス
 */
function getConfigPath(configName) {
    return path.join(SERVER_CONFIG_BASE_PATH, configName)
}

/**
 * テンプレートが存在するかチェック
 * @param {string} templateName テンプレート名
 * @returns {Promise<boolean>} 存在する場合は true
 */
async function checkTemplateExists(templateName) {
    const templatePath = getTemplatePath(templateName)
    try {
        await fs.access(templatePath)
        // server_config.xml の存在もチェックするとより確実
        await fs.access(path.join(templatePath, 'server_config.xml'))
        return true
    } catch (error) {
        return false
    }
}

/**
 * 構成が存在するかチェック
 * @param {string} configName 構成名
 * @returns {Promise<boolean>} 存在する場合は true
 */
async function checkConfigExists(configName) {
    const configPath = getConfigPath(configName)
    try {
        await fs.access(configPath)
        // metadata.xml や server_config.xml の存在もチェックするとより確実
        await fs.access(path.join(configPath, 'metadata.xml'))
        await fs.access(path.join(configPath, 'server_config.xml'))
        return true
    } catch (error) {
        return false
    }
}

/**
 * ディレクトリの内容を再帰的にコピーする
 * (Node.js v16.7.0 未満向け。それ以降は fs.cp() が使える)
 * @param {string} src コピー元ディレクトリパス
 * @param {string} dest コピー先ディレクトリパス
 */
async function copyDirectoryRecursive(src, dest) {
    await fs.mkdir(dest, { recursive: true })
    const entries = await fs.readdir(src, { withFileTypes: true })

    for (let entry of entries) {
        const srcPath = path.join(src, entry.name)
        const destPath = path.join(dest, entry.name)

        if (entry.isDirectory()) {
            await copyDirectoryRecursive(srcPath, destPath)
        } else {
            await fs.copyFile(srcPath, destPath)
            console.log(`Copied: ${srcPath} -> ${destPath}`) // デバッグ用ログ
        }
    }
     console.log(`Directory copied successfully: ${src} -> ${dest}`) // デバッグ用ログ
}

/**
 * metadata.xml を読み込む
 * @param {string} configName 構成名
 * @returns {Promise<object|null>} メタデータオブジェクト、ファイルがない場合は null
 */
async function readMetadata(configName) {
    const metaPath = path.join(getConfigPath(configName), 'metadata.xml')
    try {
        const xmlData = await fs.readFile(metaPath, 'utf-8')
        const result = await parser.parseStringPromise(xmlData)
        // metadata ルート要素とその中の assigned_port を数値で返すように試みる
        if (result.metadata) {
            if (result.metadata.assigned_port && result.metadata.assigned_port[0]) {
                 // ポート番号があれば数値に変換して追加
                 result.metadata.assigned_port_int = parseInt(result.metadata.assigned_port[0], 10)
            }
            return result.metadata;
        }
        return null
    } catch (error) {
        if (error.code === 'ENOENT') {
            return null // ファイルが存在しない
        }
        console.error(`Error reading metadata for ${configName}:`, error)
        throw new Error(`metadata.xml の読み込みに失敗しました: ${configName}`)
    }
}


/**
 * metadata.xml を書き込む (または上書きする) - ポート情報付き
 * @param {string} configName 構成名
 * @param {string} creatorId 作成者の Discord User ID
 * @param {number|null} [assignedPort=null] 割り当てられたポート番号 (省略可能)
 * @returns {Promise<void>}
 */
async function writeMetadata(configName, creatorId, assignedPort = null) {
    const metaPath = path.join(getConfigPath(configName), 'metadata.xml')
    const metadataDir = path.dirname(metaPath)

    // ディレクトリが存在しない場合は作成
    try {
        await fs.mkdir(metadataDir, { recursive: true })
    } catch (mkdirError) {
        console.error(`Failed to create directory for metadata: ${metadataDir}`, mkdirError)
        throw new Error(`メタデータディレクトリの作成に失敗しました: ${metadataDir}`)
    }

    // 既にmetadata.xmlが存在する場合はエラーを出す
    try {
        await fs.access(metaPath)
        throw new Error(`構成名 "${configName}" は既に存在します。別の名前を指定してください。`)
    } catch (accessError) {
        if (accessError.code !== 'ENOENT') {
            throw accessError // 他のエラーは再スロー
        }
    }

    const metadataContent = {
        creator_id: creatorId,
        creation_timestamp: new Date().toISOString(),
    }

    if (assignedPort !== null) {
        metadataContent.assigned_port = assignedPort;
    }

    const metadata = { metadata: metadataContent }

    try {
        const xml = builder.buildObject(metadata)
        await fs.writeFile(metaPath, xml)
        console.log(`Metadata written for ${configName}: Creator ID ${creatorId}${assignedPort !== null ? `, Port ${assignedPort}` : ''}`)
    } catch (error) {
        console.error(`Error writing metadata for ${configName}:`, error)
        throw new Error(`metadata.xml の書き込みに失敗しました: ${configName}`)
    }
}

/**
 * description.txt を読み込む
 * @param {string} templateName テンプレート名
 * @returns {Promise<string>} 説明文、ファイルがない場合は "説明なし"
 */
async function readDescription(templateName) {
    const descPath = path.join(getTemplatePath(templateName), 'description.txt')
    try {
        const description = await fs.readFile(descPath, 'utf-8')
        return description.trim()
    } catch (error) {
        if (error.code === 'ENOENT') {
            return "説明なし" // ファイルが存在しない
        }
        console.warn(`Could not read description for template ${templateName}:`, error)
        return "説明の読み込みに失敗"
    }
}

/**
 * 指定されたPIDのプロセスを強制終了する
 * @param {number} pid 終了させるプロセスID
 * @returns {Promise<string>} 実行結果のメッセージ
 */
function forceStopProcess(pid) {
    return new Promise((resolve, reject) => {
        const command = `taskkill /F /PID ${pid}`
        exec(command, { encoding: 'buffer' }, (error, stdoutBuffer, stderrBuffer) => {
            const stdout = iconvLite.decode(stdoutBuffer, 'cp932').trim()
            const stderr = iconvLite.decode(stderrBuffer, 'cp932').trim()

            if (error) {
                if (stderr.includes('プロセスが見つかりません') || error.code === 128) {
                    return resolve(`PID ${pid} は見つかりませんでしたが、停止済みとみなします。`)
                }
                return reject(`PID ${pid} の停止に失敗しました: ${error.message}\nstderr: ${stderr}`)
            }
             if (stderr) {
                 console.warn(`taskkill stderr (PID: ${pid}): ${stderr}`)
             }
             if (stdout.includes('成功') || stdout.includes('Success')) {
                 resolve(`サーバーを停止しました。`)
             } else if (stdout) {
                 console.warn(`taskkill の予期せぬ応答 (PID: ${pid}): ${stdout}`)
                 resolve(`PID ${pid} の停止コマンドは実行されましたが、応答が予期せぬものでした: ${stdout}`)
             } else {
                resolve(`PID ${pid} の停止コマンドは応答なく完了しました (成功とみなします)。`)
            }
        })
    })
}
// ---------------------------------------------------------------------------------

/**
 * 現在 Bot が管理する構成で使用中のポート番号リストを取得する
 * metadata.xml と server_config.xml の両方から取得を試みる
 * @returns {Promise<number[]>} 使用中のポート番号の配列
 */
async function getUsedPorts() {
    const usedPorts = new Set()
    try {
        const entries = await fs.readdir(SERVER_CONFIG_BASE_PATH, { withFileTypes: true })
        const configDirs = entries.filter(entry => entry.isDirectory())

        for (const dir of configDirs) {
            const configName = dir.name;
            let portFound = false;

            // 1. metadata.xml からポート取得試行
            try {
                 const metadata = await readMetadata(configName)
                 if (metadata?.assigned_port_int && !isNaN(metadata.assigned_port_int)) {
                    usedPorts.add(metadata.assigned_port_int)
                    portFound = true
                 }
            } catch (metaError) {
                 console.warn(`[WARN] Could not read metadata port for ${configName}: ${metaError.message}`)
            }

            // 2. メタデータにポートがなければ server_config.xml から取得試行
            if (!portFound) {
                const configFilePath = path.join(SERVER_CONFIG_BASE_PATH, configName, 'server_config.xml')
                try {
                    const xmlData = await fs.readFile(configFilePath, 'utf-8')
                    const result = await parser.parseStringPromise(xmlData)
                    if (result.server_data?.$?.port) {
                        const port = parseInt(result.server_data.$.port, 10)
                        if (!isNaN(port)) {
                            usedPorts.add(port)
                        } else {
                            console.warn(`[WARN] Invalid port format found in ${configFilePath}: ${result.server_data.$.port}`)
                        }
                    }
                } catch (error) {
                     if (error.code !== 'ENOENT') {
                        console.warn(`[WARN] Could not read or parse ${configFilePath}: ${error.message}`)
                     }
                }
            }
        }
    } catch (error) {
         console.error(`[ERROR] Error reading config directories in ${SERVER_CONFIG_BASE_PATH}: ${error.message}`)
         throw new Error('構成ディレクトリの読み込みに失敗しました。パスが正しいか確認してください。')
    }
    console.log('[DEBUG] Currently used ports found:', Array.from(usedPorts))
    return Array.from(usedPorts)
}

/**
 * 指定された範囲内で利用可能なポート番号を見つける
 * @param {number} minPort 最小ポート番号
 * @param {number} maxPort 最大ポート番号
 * @param {number[]} usedPorts 使用中のポート番号リスト
 * @returns {number|null} 利用可能なポート番号、見つからない場合は null
 */
function findAvailablePort(minPort, maxPort, usedPorts) {
    const usedSet = new Set(usedPorts)
    for (let port = minPort; port <= maxPort; port++) {
        if (!usedSet.has(port)) {
            console.log(`[DEBUG] Found available port: ${port}`)
            return port;
        }
    }
    console.log(`[DEBUG] No available port found in range ${minPort}-${maxPort}. Used:`, usedPorts)
    return null // 空きがない
}


/**
 * server_config.xml の port 属性を更新する
 * @param {string} configName 構成名
 * @param {number} newPort 新しいポート番号
 * @returns {Promise<void>}
 */
async function updateConfigXmlPort(configName, newPort) {
    const configFilePath = path.join(getConfigPath(configName), 'server_config.xml')
    try {
        const xmlData = await fs.readFile(configFilePath, 'utf-8')
        const result = await parser.parseStringPromise(xmlData)

        // server_data 要素と属性オブジェクトが存在することを確認・作成
        if (!result.server_data) {
            console.warn(`[WARN] <server_data> tag not found in ${configFilePath}. Creating it.`)
            result.server_data = {}
        }
        if (!result.server_data.$) {
             console.warn(`[WARN] Attributes object for <server_data> not found in ${configFilePath}. Creating it.`)
            result.server_data.$ = {}
        }

        const oldPort = result.server_data.$.port;
        result.server_data.$.port = String(newPort) // ポート番号を文字列として設定

        const updatedXml = builder.buildObject(result)
        await fs.writeFile(configFilePath, updatedXml)
        console.log(`[INFO] Updated port for ${configName} from ${oldPort || '(not set)'} to ${newPort} in ${configFilePath}`)

    } catch (error) {
        console.error(`[ERROR] Error updating port for ${configName} in ${configFilePath}:`, error)
        throw new Error(`server_config.xml のポート更新に失敗しました: ${configName}`)
    }
}

/**
 * ファイルにデータを書き込むユーティリティ関数
 * @param {string} filePath - 書き込むファイルのパス
 * @param {string} data - 書き込むデータ
 * @returns {Promise<void>} - 書き込み完了時に解決されるPromise
 */
async function writeFile(filePath, data) {
    try {
        await fs.writeFile(filePath, data, 'utf8')
        console.log(`[INFO] File written successfully: ${filePath}`)
    } catch (error) {
        console.error(`[ERROR] Failed to write file: ${filePath}`, error)
        throw error;
    }
}

module.exports = {    
    isValidConfigName,
    getTemplatePath,
    getConfigPath,
    checkTemplateExists,
    checkConfigExists,
    copyDirectoryRecursive,
    readMetadata,
    writeMetadata,
    readDescription,
    getUsedPorts,
    findAvailablePort,
    updateConfigXmlPort,
    forceStopProcess,
    writeFile,
}