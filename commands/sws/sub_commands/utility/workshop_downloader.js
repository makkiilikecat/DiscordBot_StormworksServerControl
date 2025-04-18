// commands/sws/sub_commands/utility/workshop_downloader.js
const { exec } = require('child_process')
const path = require('path')
const fs = require('node:fs').promises // promises API を使用
const { EmbedBuilder } = require('discord.js')
const chalk = require('chalk') // chalkのインポート形式を修正
// ★ config (registry.js) をインポートしてサーバーディレクトリパスを取得
const config = require('./registry')
const configFormat = require('./config_format')
// utils は createPlaylistSymlinks では直接使わないので削除 (必要なら戻す)
// const utils = require('./utils')

// --- 設定 ---
const STEAMCMD_PATH = config.steamCmdPath;
const STEAMCMD_LOGIN_ARGS = config.steamCmdLoginArgs;
const STORMWORKS_APP_ID = config.stormworksAppId;
const STEAMCMD_DIR = path.dirname(STEAMCMD_PATH)
const WORKSHOP_CONTENT_PATH = config.workshopContentPath;
// ★ サーバーのインストールディレクトリパスを取得
const SERVER_DIRECTORY = config.serverDirectory;

// --- 定数 ---
const WORKSHOP_ID_REGEX = /^\d{10,11}$/;
// ワークショッププレイリスト形式のパス: rom/data/workshop_missions/数字ID (末尾)
const WORKSHOP_PLAYLIST_PATH_REGEX = /^rom\/data\/workshop_missions\/(\d{10,11})$/;
// ワークショップMod形式のパス (絶対パス想定): .../workshop/content/<appid>/数字ID
const WORKSHOP_MOD_PATH_REGEX = /[\\\/]workshop[\\\/]content[\\\/]\d+[\\\/](\d{10,11})/;

// デバッグモードの設定
const DEBUG_MODE = true // true: 詳細なデバッグログを表示, false: 基本的なログのみ

/**
 * パースされた server_config.xml データからワークショップIDとタイプ、元のパスを抽出する
 * @param {object} parsedXmlData - xml2js でパースされたデータ
 * @returns {Map<string, {type: 'playlist' | 'mod', sourcePath: string | null, targetPath: string}>} - Key: ID, Value: {type, sourcePath, targetPath}
 */
function extractWorkshopIdsAndTypes(parsedXmlData) {
    const items = new Map()
    if (!parsedXmlData || !parsedXmlData.server_data) {
        console.warn('[WorkshopDownloader] Invalid parsed XML data provided for ID extraction.')
        return items;
    }

    const serverData = parsedXmlData.server_data;

    // 1. Playlists から抽出
    try {
        const playlists = serverData.playlists?.[0]?.path;
        if (playlists && Array.isArray(playlists)) {
            playlists.forEach(p => {
                const playlistPath = p?.$?.path // 例: "rom/data/workshop_missions/12345"
                if (playlistPath) {
                    const workshopMatch = playlistPath.match(WORKSHOP_PLAYLIST_PATH_REGEX)
                    if (workshopMatch && workshopMatch[1]) {
                        const id = workshopMatch[1]
                        // ターゲットパスは SteamCMD のダウンロード先
                        const targetPath = path.join(WORKSHOP_CONTENT_PATH, id)
                        if (!items.has(id)) {
                            // sourcePath は XML 内のパス、targetPath はダウンロード先
                            items.set(id, { type: 'playlist', sourcePath: playlistPath, targetPath })
                            console.log(`[WorkshopDownloader] Found playlist workshop ID from path: ${id} (Source: ${playlistPath}, Target: ${targetPath})`)
                        }
                    }
                }
            })
        }
    } catch (e) { console.error('[WorkshopDownloader] Error extracting IDs from playlists:', e) }

    // 2. Mods (<published_id>) から抽出
    try {
        const publishedIds = serverData.mods?.[0]?.published_id;
        if (publishedIds && Array.isArray(publishedIds)) {
            publishedIds.forEach(pid => {
                const modId = pid?.$?.value;
                if (modId && configFormat.types.workshopid(modId)) {
                     // ターゲットパスは SteamCMD のダウンロード先
                     const targetPath = path.join(WORKSHOP_CONTENT_PATH, modId)
                     if (!items.has(modId)) {
                         // published_id の sourcePath は null
                         items.set(modId, { type: 'mod', sourcePath: null, targetPath })
                         console.log(`[WorkshopDownloader] Found mod workshop ID from published_id: ${modId} (Target: ${targetPath})`)
                     }
                }
            })
        }
    } catch (e) { console.error('[WorkshopDownloader] Error extracting IDs from mod published_id:', e) }

    // 3. Mods (<path>) から抽出 (ワークショップパスの場合)
    try {
        const modPaths = serverData.mods?.[0]?.path;
        if (modPaths && Array.isArray(modPaths)) {
            modPaths.forEach(p => {
                const modPath = p?.$?.path // 例: "C:/.../workshop/content/573090/123"
                if (modPath) {
                    const match = modPath.match(WORKSHOP_MOD_PATH_REGEX)
                    if (match && match[1]) {
                        const id = match[1]
                        // <path> で指定された場合、sourcePath はそのパス自体、targetPath も同じとみなせる
                        const targetPath = modPath // modPath は既に実際のパスのはず
                         if (!items.has(id)) {
                             items.set(id, { type: 'mod', sourcePath: modPath, targetPath })
                             console.log(`[WorkshopDownloader] Found mod workshop ID from path: ${id} (Source/Target: ${targetPath})`)
                         }
                    }
                }
            })
        }
    } catch (e) { console.error('[WorkshopDownloader] Error extracting IDs from mod path:', e) }

    console.log(`[WorkshopDownloader] Extracted unique workshop items: ${items.size} items.`)
    return items;
}

/**
 * 指定されたワークショップIDのアイテムがダウンロード先に存在するか確認する
 * @param {string} workshopId - 確認するアイテムのID
 * @returns {Promise<boolean>} - 存在すれば true
 */
async function checkItemExists(workshopId) {
    if (!WORKSHOP_CONTENT_PATH) {
        console.warn(`[WorkshopDownloader] Cannot check existence for ID ${workshopId}: WORKSHOP_CONTENT_PATH is not set.`)
        return false;
    }
    const itemPath = path.join(WORKSHOP_CONTENT_PATH, workshopId)
    try {
        await fs.access(itemPath)
        return true
    } catch (error) {
        return false;
    }
}

/**
 * 指定されたワークショップIDのアイテムをSteamCMDでダウンロードする (単一アイテム用)
 * @param {string} workshopId - ダウンロードするアイテムのID
 * @returns {Promise<{success: boolean, message: string}>} - ダウンロード結果
 */
function downloadSingleItem(workshopId) {
    return new Promise((resolve) => {
        // SteamCMDコマンド実行
        const command = `"${STEAMCMD_PATH}" +force_install_dir "${STEAMCMD_DIR}" ${STEAMCMD_LOGIN_ARGS} +workshop_download_item ${STORMWORKS_APP_ID} ${workshopId} +quit`
        console.log(`[WorkshopDownloader] Executing download for ID ${workshopId}: ${command}`)

        exec(command, { timeout: 300000 }, (error, stdout, stderr) => {
             console.log(`[WorkshopDownloader] SteamCMD stdout (ID: ${workshopId}):\n${stdout}`)
             console.error(`[WorkshopDownloader] SteamCMD stderr (ID: ${workshopId}):\n${stderr}`)

            if (error) {
                console.error(`[WorkshopDownloader] SteamCMD execution error for ID ${workshopId}: ${error.message}`)
                resolve({ success: false, message: `ID \`${workshopId}\`: コマンド実行エラー\n\`\`\`${error.message}\`\`\`` })
                return
            }

            // SteamCMDのエラー出力を厳密にチェック
            const stderrLower = stderr.toLowerCase()
            const errorKeywords = ['error!', 'failed', 'no subscription', 'invalid password', 'access denied', 'disk write failure']
            const timeoutKeywords = ['timeout downloading item', 'connection timed out']

            const hasError = errorKeywords.some(keyword => stderrLower.includes(keyword))
            const hasTimeout = timeoutKeywords.some(keyword => stderrLower.includes(keyword))
            const hasSuccess = stdout.includes(`Success. Downloaded item ${workshopId}`)

            if (hasError || hasTimeout) {
                console.error(`[WorkshopDownloader] SteamCMD reported failure for ID ${workshopId}. Error found: ${hasError}, Timeout found: ${hasTimeout}`)
                let failReason = 'ダウンロード失敗 (エラー検出)'
                if (hasTimeout) failReason = 'ダウンロード失敗 (タイムアウト)'
                if (stderrLower.includes('no subscription')) failReason = 'ダウンロード失敗 (サブスクリプション未検出)'
                resolve({ success: false, message: `ID \`${workshopId}\`: ${failReason}\n\`\`\`stderr:\n${stderr}\`\`\`` })
            } else if (hasSuccess) {
                console.log(`[WorkshopDownloader] Successfully downloaded item ${workshopId}`)
                resolve({ success: true, message: `✅ ID \`${workshopId}\`: ダウンロード成功` })
            } else {
                console.warn(`[WorkshopDownloader] SteamCMD output for ID ${workshopId} ambiguous. Assuming success.`)
                resolve({ success: true, message: `❓ ID \`${workshopId}\`: ダウンロード処理完了 (出力から成功/失敗を断定できず)` })
            }
        })
    })
}

/**
 * 必要なワークショップアイテムを準備（存在確認＋ダウンロード）する
 * @param {Map<string, {type: string, sourcePath: string | null, targetPath: string}>} requiredItems - 抽出されたワークショップアイテム情報
 * @param {import('discord.js').CommandInteraction} interaction - Discordインタラクション (フィードバック用)
 * @returns {Promise<{ allReady: boolean, results: {id: string, success: boolean, message: string, targetPath: string, type: string}[] }>}
 */
async function prepareWorkshopItems(requiredItems, interaction) {
    if (DEBUG_MODE) {
        console.log(chalk.blue(`[DEBUG] Starting preparation of ${requiredItems.size} workshop items.`))
    } else {
        console.log(`[INFO] Preparing workshop items...`)
    }

    const progressMessage = await interaction.followUp({ content: `**${requiredItems.size}個** のワークショップアイテムの準備を開始します... (存在確認とダウンロード)`, ephemeral: false })

    let currentItemIndex = 0;
    const totalItems = requiredItems.size;

    // デバッグログを追加して、resultsが正しく更新されるように修正
    const results = [] // 各アイテムの処理結果を格納

    for (const [id, itemInfo] of requiredItems.entries()) {
        currentItemIndex++;
        const targetPath = itemInfo.targetPath // ダウンロード/確認される実際のワークショップコンテンツパス

        console.log(`[DEBUG] Processing item ID: ${id}, Target Path: ${targetPath}`)

        // 進捗メッセージを更新
        const progressMsg = `ワークショップアイテム準備中 (${currentItemIndex}/${totalItems}) ID: ${id}`
        try {
            if (progressMessage) {
                await progressMessage.edit({ content: progressMsg })
            } else {
                console.log(`[WorkshopDownloader] Cannot update progress message: progressMessage is null.`)
            }
        } catch (sendError) {
            console.error(`[WorkshopDownloader] Failed to update progress message:`, sendError)
        }

        const exists = await checkItemExists(id) // 存在確認はIDで行う
        if (exists) {
            console.log(`[WorkshopDownloader] Item ${id} already exists. Skipping download.`)
            results.push({ id, success: true, message: `✅ ID \`${id}\`: 既に存在`, targetPath, type: itemInfo.type })
            continue
        }

        console.log(`[WorkshopDownloader] Item ${id} not found. Attempting download...`)
        const downloadResult = await downloadSingleItem(id)
        results.push({
            id,
            success: downloadResult.success,
            message: downloadResult.message,
            targetPath,
            type: itemInfo.type // typeを追加
        })

        if (!downloadResult.success) {
            console.error(chalk.red(`[ERROR] Failed to download item ${id}.`))
        } else {
            const existsAfterDownload = await checkItemExists(id)
            if (!existsAfterDownload) {
                console.error(chalk.red(`[CRITICAL] Item ${id} reported as downloaded but not found at ${targetPath}!`))
            } else if (DEBUG_MODE) {
                console.log(chalk.green(`[DEBUG] Item ${id} successfully downloaded and verified.`))
            }
        }
    }

    if (DEBUG_MODE) {
        console.log(chalk.blue(`[DEBUG] Results after preparation: ${JSON.stringify(results, null, 2)}`))
    }

    // 最終的に進捗メッセージを削除
    try {
        if (progressMessage) {
            await progressMessage.delete()
            if (DEBUG_MODE) {
                console.log(chalk.green(`[DEBUG] Progress message deleted successfully.`))
            }
        }
    } catch (deleteError) {
        console.error(chalk.red(`[ERROR] Failed to delete progress message:`, deleteError))
    }

    console.log(chalk.green(`[INFO] Finished preparing items.`))

    return { allReady: results.every(r => r.success), results }
}

/**
 * (★★★ 修正版 ★★★) ワークショッププレイリスト用のシンボリックリンクを作成する
 * 作成先を Stormworks サーバーディレクトリに変更
 * @param {string} configName - サーバー構成名 (ログ出力やエラーメッセージ用)
 * @param {Map<string, {success: boolean, targetPath: string, type: 'playlist' | 'mod'}>} preparedItemsMap - 準備済みのアイテム情報Map
 * @param {import('discord.js').CommandInteraction} interaction - Discordインタラクション
 * @returns {Promise<boolean>} - 全てのリンク作成に成功すれば true
 */
async function createPlaylistSymlinks(configName, preparedItemsMap, interaction) {

    console.log('[Symlink] Starting symbolic link creation... configName = ' + configName)

    // シンボリックリンク作成対象はプレイリストかつ準備成功したもの
    const playlistItems = Array.from(preparedItemsMap.entries())
                               .filter(([id, info]) => info.type === 'playlist' && info.success)

    if (playlistItems.length === 0) {
        console.log(`[Symlink] No playlist items require symbolic links for config ${configName}.`)
        return true // 作成対象がなければ成功
    }

    // ★★★ シンボリックリンクの作成先ベースディレクトリをサーバーディレクトリに変更 ★★★
    if (!SERVER_DIRECTORY) {
        console.error('[Symlink] Cannot create symlinks: SERVER_DIRECTORY is not defined in registry.')
        await interaction.followUp({
             content: `❌ シンボリックリンク作成失敗: Botの設定エラー (サーバーディレクトリ未設定)`,
             ephemeral: false
        })
        return false;
    }
    const symlinkBaseDir = path.join(SERVER_DIRECTORY, 'rom', 'data', 'workshop_missions')

    console.log(`[Symlink] Creating symbolic links for ${playlistItems.length} playlist items in ${symlinkBaseDir}`)
    // ユーザーへの通知メッセージは messages.js を使うべきだが、ここでは直接記述
    //await interaction.followUp({ content: `ワークショッププレイリスト用のシンボリックリンクをサーバーディレクトリ内に作成します... (${playlistItems.length}件)`, ephemeral: false })

    let allLinksCreated = true
    const results = [] // 各リンク作成結果のメッセージ

    try {
        // リンク先の親ディレクトリを作成 (例: C:/.../Stormworks/rom/data/workshop_missions)
        // recursive: true で親ディレクトリもまとめて作成
        await fs.mkdir(symlinkBaseDir, { recursive: true })
        console.log(`[Symlink] Ensured base directory exists: ${symlinkBaseDir}`)
    } catch (mkdirError) {
        console.error(`[Symlink] Failed to create base directory for symlinks: ${symlinkBaseDir}`, mkdirError)
        // ディレクトリ作成失敗は致命的エラー
        await interaction.followUp({
             content: `❌ シンボリックリンク作成のためのディレクトリ作成に失敗しました。\nパス: \`${symlinkBaseDir}\`\nエラー: \`${mkdirError.message}\`\n(ヒント: Botの実行ユーザーにサーバーディレクトリへの書き込み権限があるか確認してください)`,
             ephemeral: false
        })
        return false;
    }

    for (const [id, itemInfo] of playlistItems) {
        const targetPath = itemInfo.targetPath // ダウンロード/確認された実際のワークショップコンテンツパス
        const linkPath = path.join(symlinkBaseDir, id) // 作成するシンボリックリンクのパス (例: .../Stormworks/rom/data/workshop_missions/123)

        // ターゲットパスが実際に存在するか最終確認 (念のため)
        try {
             await fs.access(targetPath)
        } catch {
             console.error(`[Symlink] Target path for ID ${id} does not exist or is inaccessible: ${targetPath}. Skipping link creation.`)
             results.push(`⚠️ ID \`${id}\`: リンク元のワークショップコンテンツが見つからないため、リンクを作成できません。`)
             allLinksCreated = false;
             continue
        }

        console.log(`[Symlink] Creating link: "${linkPath}" -> "${targetPath}"`)
        try {
            // 既存のリンクやファイルを削除 (古いリンクや失敗した残骸を消すため)
            try {
                const lstat = await fs.lstat(linkPath)
                if (lstat.isSymbolicLink() || lstat.isFile() || lstat.isDirectory()) {
                    console.log(`[Symlink] Removing existing file/link at ${linkPath} before creating new one.`)
                    await fs.rm(linkPath, { recursive: true, force: true })
                }
            } catch (rmError) {
                if (rmError.code !== 'ENOENT') { // Not Found 以外は警告
                    console.warn(`[Symlink] Failed to remove existing item at ${linkPath}: ${rmError.message}. Proceeding anyway...`)
                }
            }

            // デバッグログを追加して、シンボリックリンク作成時のパスを出力
            try {
                console.log(`[Symlink] Attempting to create link: "${linkPath}" -> "${targetPath}"`)
                await fs.symlink(targetPath, linkPath, 'dir')

                // 作成後にリンクの存在を確認
                const linkExists = await fs.lstat(linkPath)
                if (!linkExists) {
                    throw new Error(`Link verification failed: ${linkPath}`)
                }
                console.log(`[Symlink] Successfully created link: "${linkPath}" -> "${targetPath}"`)
                results.push(`✅ ID \`${id}\`: シンボリックリンク作成成功`)
            } catch (symlinkError) {
                console.error(`[Symlink] Failed to create symbolic link for ID ${id} (\"${linkPath}\" -> \"${targetPath}\"):`, symlinkError)
                results.push(`❌ ID \`${id}\`: シンボリックリンク作成失敗`)
                allLinksCreated = false;

                // エラー原因に応じたヒントを追加
                if (symlinkError.code === 'EPERM') {
                    results.push(`   理由: アクセス権限がありません。\n   (ヒント: Botの実行ユーザーにサーバーディレクトリへの書き込み権限があるか、Windowsで開発者モードが有効か確認してください)`)
                } else if (symlinkError.code === 'EEXIST') {
                    results.push(`   理由: 同名のファイルまたはディレクトリが既に存在します。\n   (ヒント: 既存のファイルを削除できませんでした)`)
                } else if (symlinkError.code === 'ENOENT') {
                    results.push(`   理由: リンク元 (${targetPath}) またはリンク先の親ディレクトリ (${symlinkBaseDir}) が見つかりません。`)
                } else {
                    results.push(`   理由: ${symlinkError.message}`)
                }
            }
        } catch (symlinkError) {
             // ★ デバッグモードに関わらずログ出力（要件）
            console.error(`[Symlink] Failed to create symbolic link for ID ${id} ("${linkPath}" -> "${targetPath}\"):`, symlinkError)
            results.push(`❌ ID \`${id}\`: シンボリックリンク作成失敗`)
            allLinksCreated = false;
            // エラー原因に応じたヒントを追加
            if (symlinkError.code === 'EPERM') {
                 results.push(`   理由: アクセス権限がありません。\n   (ヒント: Botの実行ユーザーにサーバーディレクトリへの書き込み権限があるか、Windowsで開発者モードが有効か確認してください)`)
            } else if (symlinkError.code === 'EEXIST') {
                 results.push(`   理由: 同名のファイルまたはディレクトリが既に存在します。\n   (ヒント: 既存のファイルを削除できませんでした)`)
            } else if (symlinkError.code === 'ENOENT') {
                 results.push(`   理由: リンク元 (${targetPath}) またはリンク先の親ディレクトリ (${symlinkBaseDir}) が見つかりません。`)
            } else {
                 results.push(`   理由: ${symlinkError.message}`)
            }
        }
    }

    // シンボリックリンク作成結果をEmbedで報告
    //const embed = new EmbedBuilder()
    //    .setTitle('シンボリックリンク作成結果')
    //    .setColor(allLinksCreated ? 0x00FF00 : (results.some(r => r.startsWith('❌')) ? 0xFF0000 : 0xFFCC00))
    //    .setDescription(results.join('\n'))
    //    // ★ フッターのパス表示を修正
    //    .setFooter({text: `リンク作成先 (サーバーディレクトリ内): ${symlinkBaseDir}`})
    //await interaction.followUp({ embeds: [embed], ephemeral: false })

    return allLinksCreated;
}


module.exports = {
    extractWorkshopIdsAndTypes,
    prepareWorkshopItems,
    createPlaylistSymlinks
}