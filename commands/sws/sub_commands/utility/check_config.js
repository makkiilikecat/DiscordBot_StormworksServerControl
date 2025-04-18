const chalk = require('chalk') // ログの色分け用ライブラリ
const fs = require('node:fs').promises;
const path = require('node:path')
const xml2js = require('xml2js')
const util = require('util') // オブジェクトの詳細表示用
const configFormat = require('./config_format') // 設定フォーマット定義 (defaultPlaylistPaths, defaultBaseIslandPaths を含む)
const serverInfo = require('./registry') // SERVER_DIR 等のパス情報

// --- デバッグ設定 ---
const DEBUG_MODE = true // trueにすると詳細なログを出力します

const parser = new xml2js.Parser({ explicitArray: true })

if (DEBUG_MODE) {
    console.log(chalk.blue('[DEBUG] Initializing configuration checker...'))
} else {
    console.log('[INFO] Initializing configuration checker...')
}

/**
 * server_config.xml の内容文字列を検証するメイン関数
 * @param {string} xmlString - 検証するXMLファイルの内容
 * @returns {Promise<{success: boolean, errors: string[], parsedData: object|null}>} - 検証結果。成功時は parsedData も返す。
 */
async function validateServerConfig(xmlString) {
    const errors = []
    let parsedData = null

    if (DEBUG_MODE) console.log(chalk.blue('[DEBUG] === Starting XML Validation ==='))

    // --- 1. XMLとしてパース可能かチェック ---
    if (DEBUG_MODE) console.log(chalk.blue('[DEBUG] Step 1: Parsing XML string...'))
    try {
        parsedData = await parser.parseStringPromise(xmlString)
        if (DEBUG_MODE) {
            console.log(chalk.blue('[DEBUG] Step 1: XML Parsing SUCCESSFUL.'))
            console.log('--- [DEBUG] XML Parsed Data ---')
            console.log(util.inspect(parsedData, { showHidden: false, depth: null, colors: true }))
            console.log('--- [DEBUG] End of Parsed Data ---')
        }
    } catch (e) {
        if (DEBUG_MODE) console.error(chalk.red('[DEBUG] Step 1: XML Parsing FAILED.'), e)
        errors.push(`XMLファイルの形式が不正です。パースに失敗しました: ${e.message}`)
        if (DEBUG_MODE) console.log(chalk.blue('[DEBUG] === Ending XML Validation (Parse Error) ==='))
        return { success: false, errors, parsedData: null }
    }

    // --- 2. ルート要素 <server_data> の存在と形式をチェック ---
    if (DEBUG_MODE) console.log(chalk.blue('[DEBUG] Step 2: Checking root element <server_data>...'))
    if (!parsedData || !parsedData.server_data || typeof parsedData.server_data !== 'object' || Array.isArray(parsedData.server_data)) {
        errors.push('XMLのルート要素として <server_data> オブジェクトが一つだけ必要です。')
        if (DEBUG_MODE) console.error(chalk.red('[DEBUG] Step 2: Root element check FAILED. <server_data> object not found or invalid structure.'))
        if (DEBUG_MODE) console.log(chalk.blue('[DEBUG] === Ending XML Validation (Root Element Error) ==='))
        return { success: errors.length === 0, errors, parsedData }
    } else {
        if (DEBUG_MODE) console.log(chalk.green('[DEBUG] Step 2: Root element check PASSED.'))
    }

    const serverDataNode = parsedData.server_data;
    const attributes = serverDataNode.$ || {}
    const children = serverDataNode // 子要素は serverDataNode 自身に

    // --- 空の要素に対するチェックを追加 ---
    if (DEBUG_MODE) console.log(chalk.blue('[DEBUG] Step 2.1: Checking for empty elements...'))
    if (Object.keys(serverDataNode).length === 0) {
        errors.push('XMLファイルが空です。<server_data> 要素に内容がありません。')
        if (DEBUG_MODE) console.error(chalk.red('[DEBUG] Step 2.1: Empty <server_data> element detected.'))
        return { success: false, errors, parsedData: null }
    }

    // --- 3. <server_data> の属性を検証 ---
    if (DEBUG_MODE) console.log(chalk.blue('[DEBUG] Step 3: Validating <server_data> attributes...'))
    await validateAttributes(attributes, configFormat.serverData, '<server_data>', errors)
    if (DEBUG_MODE) console.log(chalk.blue(`[DEBUG] Step 3: Finished validating attributes. Current errors: ${errors.length}`))

    // --- 4. <server_data> の子要素の構成を検証 ---
    if (DEBUG_MODE) console.log(chalk.blue('[DEBUG] Step 4: Validating <server_data> children structure...'))
    validateChildren(children, configFormat.serverData, '<server_data>', errors)
    if (DEBUG_MODE) console.log(chalk.blue(`[DEBUG] Step 4: Finished validating children structure. Current errors: ${errors.length}`))

    // --- 5. 特定の子要素の内容を詳しく検証 ---
    if (DEBUG_MODE) console.log(chalk.blue('[DEBUG] Step 5: Validating specific child elements content...'))

    // 5a. IDリスト系 (admins, authorized, blacklist, whitelist)
    for (const elementName in configFormat.idListElements) {
        if (children[elementName] && Array.isArray(children[elementName])) {
            if (DEBUG_MODE) console.log(chalk.blue(`[DEBUG]   Step 5a: Validating <${elementName}>...`))
            validateIdListElement(children[elementName][0], elementName, configFormat.idListElements[elementName], errors)
        } else if (children[elementName]) {
             if (DEBUG_MODE) console.warn(chalk.yellow(`[DEBUG]   Step 5a: <${elementName}> exists but is not an array as expected.`))
             errors.push(`設定ファイル内の <${elementName}> の構造が予期しない形式です (配列ではありません)。`)
        }
    }

    // 5b. パスリスト系 (playlists)
    for (const elementName in configFormat.pathListElements) {
        if (children[elementName] && Array.isArray(children[elementName])) {
             if (DEBUG_MODE) console.log(chalk.blue(`[DEBUG]   Step 5b: Validating <${elementName}>...`))
             // ★ await が必要 (checkPathExists が非同期になったため)
             await validatePathListElement(children[elementName][0], elementName, configFormat.pathListElements[elementName], errors)
        } else if (children[elementName]) {
            if (DEBUG_MODE) console.warn(chalk.yellow(`[DEBUG]   Step 5b: <${elementName}> exists but is not an array as expected.`))
            errors.push(`設定ファイル内の <${elementName}> の構造が予期しない形式です (配列ではありません)。`)
        }
    }

    // 5c. mods 要素
    if (children.mods && Array.isArray(children.mods)) {
        if (DEBUG_MODE) console.log(chalk.blue('[DEBUG]   Step 5c: Validating <mods>...'))
        // ★ await が必要 (checkPathExists が非同期になったため)
        await validateModsElement(children.mods[0], configFormat.modsElement, errors)
    } else if (children.mods) {
        if (DEBUG_MODE) console.warn(chalk.yellow('[DEBUG]   Step 5c: <mods> exists but is not an array as expected.'))
        errors.push('設定ファイル内の <mods> の構造が予期しない形式です (配列ではありません)。')
    }

    if (DEBUG_MODE) console.log(chalk.blue(`[DEBUG] Step 5: Finished validating specific children content. Current errors: ${errors.length}`))

    // --- 6. パス存在チェック (型チェックと checkPathExists でカバーされるため、このステップは不要) ---
    // if (DEBUG_MODE) console.log('[DEBUG] Step 6: Performing additional path existence checks...')
    // ★★★ base_island の追加チェックは不要になった ★★★
    // if (DEBUG_MODE) console.log(`[DEBUG] Step 6: Finished additional path checks. Total errors: ${errors.length}`)


    // --- 検証完了 ---
    const success = errors.length === 0;
    if (DEBUG_MODE) console.log(chalk.blue(`[DEBUG] === Ending XML Validation (Success: ${success}) ===`))

    return { success, errors, parsedData }
}


// ==========================================================================
// == 検証ヘルパー関数群 (内部実装) ==
// ==========================================================================
// validateAttributes, validateChildren, validateIdListElement, validatePathListElement, validateModsElement は変更なし
// checkPathExists を修正
// ==========================================================================

/**
 * 要素の属性を検証する内部関数 (変更なし)
 */
async function validateAttributes(attributes, formatDefinition, elementNameForError, errors) { // async 追加
    const definedAttributes = formatDefinition.attributes || {}
    const attributeKeys = Object.keys(attributes)
    const definedKeys = Object.keys(definedAttributes)

    if (DEBUG_MODE) console.log(chalk.blue(`[DEBUG]   Validating attributes for ${elementNameForError}: Found ${attributeKeys.length} attributes.`))

    // 不明な属性チェック
    for (const key of attributeKeys) {
        if (!definedAttributes[key]) {
             if (DEBUG_MODE) console.warn(chalk.yellow(`[DEBUG]     Unknown attribute found in ${elementNameForError}: "${key}"`))
            errors.push(`${elementNameForError} に不明な属性 "${key}" が含まれています。`)
        }
    }

    // 定義された属性チェック
    for (const key of definedKeys) {
        const definition = definedAttributes[key]
        const value = attributes[key]

        if (DEBUG_MODE) console.log(chalk.blue(`[DEBUG]     Checking attribute "${key}" for ${elementNameForError} (Value: ${value === undefined ? '<undefined>' : `"${value}"`}). Definition:`), definition)

        // Bot自動割り当てはスキップ (ただし、値が明示的に設定されている場合は検証する)
        if (definition.autoAssign && value === undefined) {
            if (DEBUG_MODE) console.log(chalk.blue(`[DEBUG]       Skipping validation for auto-assigned attribute "${key}" as it's not explicitly set.`))
            continue
        }

        // 必須チェック (ループの最後に移動)
        // if (definition.required && value === undefined) { ... }

        // 値が存在する場合のチェック
        if (value !== undefined) {
            // ★★★ パス存在チェックを先に行う (base_island のみ) ★★★
            let pathExistsFailed = false;
            if (key === 'base_island' && definition.type === 'filepath_baseisland') {
                if (DEBUG_MODE) console.log(chalk.blue(`[DEBUG]         Checking path existence for attribute "${key}" value "${value}"...`))
                await checkPathExists(value, key, errors) // ★ await
                // checkPathExists がエラーを追加した場合、後続の型チェックエラーは抑制したい
                // エラーメッセージが追加されたかを確認
                if (errors.some(e => e.startsWith(`[${key}]`))) {
                    pathExistsFailed = true
                }
            }

            // ★★★ 属性値に対する型チェック ★★★
            const typeChecker = configFormat.types[definition.type]
            let isValidType = typeChecker ? typeChecker(value) : true // 型定義がなければ常にtrue

            // boolean 型の厳密チェック
            if (definition.type === 'boolean' && value !== 'true' && value !== 'false') {
                if (DEBUG_MODE) console.error(chalk.red(`[DEBUG]       Boolean attribute "${key}" in ${elementNameForError} has invalid value: "${value}". Should be "true" or "false".`))
                errors.push(`${elementNameForError} の属性 "${key}" の値は "true" または "false" である必要があります (現在値: "${value}")。`)
                isValidType = false;
            }

            // 型チェックNG (パス存在チェックで既にエラーが出ていない場合のみ)
            if (!isValidType && !pathExistsFailed) {
                if (DEBUG_MODE && definition.type !== 'boolean') {
                    console.error(chalk.red(`[DEBUG]       Attribute "${key}" in ${elementNameForError} FAILED type check (${definition.type}). Value: "${value}".`))
                }
                if(definition.type !== 'boolean'){
                  errors.push(`${elementNameForError} の属性 "${key}" の値 "${value}" は期待される形式 (${definition.type}) ではありません。`)
                }
            } else if (isValidType) {
                 if (DEBUG_MODE && !pathExistsFailed) console.log(chalk.green(`[DEBUG]       Attribute "${key}" type check PASSED (${definition.type}).`))
                 // パス存在チェックは base_island のみ先に行ったので、ここでは不要
            }

            // 型が正しい場合の追加チェック (範囲、空文字など - パス以外)
            if (isValidType && !definition.type.startsWith('filepath')) {
                // 範囲チェック (integer)
                if (definition.type === 'integer' && definition.range) {
                    const numValue = parseInt(value, 10)
                    if (numValue < definition.range[0] || numValue > definition.range[1]) {
                        if (DEBUG_MODE) console.error(chalk.red(`[DEBUG]       Integer attribute "${key}" in ${elementNameForError} is out of range (${definition.range.join('~')}). Value: ${numValue}.`))
                        errors.push(`${elementNameForError} の属性 "${key}" の値 ${numValue} は許容範囲 (${definition.range[0]}～${definition.range[1]}) 外です。`)
                    } else {
                         if (DEBUG_MODE) console.log(chalk.green(`[DEBUG]       Integer attribute "${key}" range check PASSED.`))
                    }
                }
                // 空チェック (string, allowEmpty: false)
                if (definition.type === 'string' && definition.allowEmpty === false && value === '') {
                     if (DEBUG_MODE) console.error(chalk.red(`[DEBUG]       String attribute "${key}" in ${elementNameForError} cannot be empty.`))
                    errors.push(`${elementNameForError} の属性 "${key}" は空にできません。`)
                }
            }
        } else {
             // 必須チェックはループの後に行う
             if (!definition.required) {
                 if (DEBUG_MODE) console.log(chalk.blue(`[DEBUG]       Optional attribute "${key}" is not present. Skipping type/content check.`))
             }
        }
    } // End of loop through defined keys

    // ★★★ 必須属性チェック (ループの後に行う) ★★★
    for (const key of definedKeys) {
        const definition = definedAttributes[key]
        const value = attributes[key]
        if (definition.required && value === undefined) {
            if (DEBUG_MODE) console.error(chalk.red(`[DEBUG]       Required attribute "${key}" is MISSING in ${elementNameForError}.`))
            errors.push(`${elementNameForError} に必須属性 "${key}" がありません。`)
        }
    }
}

/**
 * 要素の子要素の構成を検証する内部関数 (変更なし)
 */
function validateChildren(children, formatDefinition, elementNameForError, errors) {
    const allowedChildrenSet = new Set(formatDefinition.allowedChildren || [])
    const requiredChildrenSet = new Set(formatDefinition.requiredChildren || [])
    const presentChildrenNames = Object.keys(children).filter(k => k !== '$' && k !== '_')

    if (DEBUG_MODE) console.log(chalk.blue(`[DEBUG]   Validating children structure for ${elementNameForError}: Found ${presentChildrenNames.length} children types.`))
    if (DEBUG_MODE) console.log(chalk.blue(`[DEBUG]     Allowed children: [${Array.from(allowedChildrenSet).join(', ')}]`))
    if (DEBUG_MODE) console.log(chalk.blue(`[DEBUG]     Required children: [${Array.from(requiredChildrenSet).join(', ')}]`))
    if (DEBUG_MODE) console.log(chalk.blue(`[DEBUG]     Present children: [${presentChildrenNames.join(', ')}]`))

    // 不明な子要素チェック
    for (const childName of presentChildrenNames) {
        if (!allowedChildrenSet.has(childName)) {
            if (DEBUG_MODE) console.warn(chalk.yellow(`[DEBUG]     Unknown child element found in ${elementNameForError}: <${childName}>`))
            errors.push(`${elementNameForError} に不明な子要素 <${childName}> が含まれています。`)
        }
    }

    // 必須子要素チェック
    for (const reqChild of requiredChildrenSet) {
        if (!children[reqChild]) {
            if (DEBUG_MODE) console.error(chalk.red(`[DEBUG]     Required child element <${reqChild}> is MISSING in ${elementNameForError}.`))
            errors.push(`${elementNameForError} に必須の子要素 <${reqChild}> がありません。`)
        }
    }
}

/**
 * <id value="..."> 形式のリスト要素の内容を検証する内部関数 (変更なし)
 */
function validateIdListElement(elementContent, elementName, definition, errors) {
    if (!elementContent || typeof elementContent !== 'object') {
         if (DEBUG_MODE) console.log(chalk.blue(`[DEBUG]     Element <${elementName}> is empty or invalid, skipping content validation.`))
        return
    }

    const childTag = definition.childTag;
    const valueAttr = definition.valueAttribute;
    const expectedType = definition.type;
    const idNodes = elementContent[childTag]

    const unexpectedContent = Object.keys(elementContent).filter(k => k !== childTag && k !== '$')
    if (unexpectedContent.length > 0) {
        if (DEBUG_MODE) console.warn(chalk.yellow(`[DEBUG]     Unexpected content found in <${elementName}>: [${unexpectedContent.join(', ')}]. Expected only <${childTag}> tags.`))
        errors.push(`<${elementName}> 要素内に予期しない内容 (<${unexpectedContent.join(', ')}>) が含まれています。`)
        return
    }

    if (idNodes && Array.isArray(idNodes)) {
         if (DEBUG_MODE) console.log(chalk.blue(`[DEBUG]     Found ${idNodes.length} <${childTag}> tags in <${elementName}>.`))
        idNodes.forEach((idNode, index) => {
            if (typeof idNode !== 'object' || idNode === null) {
                if (DEBUG_MODE) console.error(chalk.red(`[DEBUG]       Invalid <${childTag}> node structure at index ${index} in <${elementName}>.`))
                errors.push(`<${elementName}> 内の ${index + 1} 番目の <${childTag}> タグの構造が不正です。`)
                return
            }
            const attributes = idNode.$
            if (!attributes || attributes[valueAttr] === undefined) {
                if (DEBUG_MODE) console.error(chalk.red(`[DEBUG]       Attribute "${valueAttr}" is MISSING in ${index + 1}th <${childTag}> tag of <${elementName}>.`))
                errors.push(`<${elementName}> 内の ${index + 1} 番目の <${childTag}> タグに "${valueAttr}" 属性がありません。`)
            } else {
                const idValue = attributes[valueAttr]
                const typeChecker = configFormat.types[expectedType]
                 if (DEBUG_MODE) console.log(chalk.blue(`[DEBUG]       Checking ${index + 1}th <${childTag}> value in <${elementName}>: "${idValue}" (Expected type: ${expectedType})`))
                if (typeChecker && !typeChecker(idValue)) {
                     if (DEBUG_MODE) console.error(chalk.red(`[DEBUG]         Value "${idValue}" FAILED type check (${expectedType}).`))
                    errors.push(`<${elementName}> 内の <${childTag}> の値 "${idValue}" は期待される形式 (${expectedType}) ではありません。`)
                } else if (typeChecker) {
                     if (DEBUG_MODE) console.log(chalk.green(`[DEBUG]         Value "${idValue}" PASSED type check.`))
                } else {
                    console.error(`[Config Check Error] Type checker for "${expectedType}" not found in configFormat.types!`)
                    errors.push(`[内部エラー] ${elementName} の型 (${expectedType}) のチェック関数が見つかりません。`)
                }
            }
        })
    } else if (idNodes === undefined && Object.keys(elementContent).length > 0) {
         if (DEBUG_MODE) console.warn(chalk.yellow(`[DEBUG]     Element <${elementName}> exists but contains no <${childTag}> tags.`))
    } else if (idNodes !== undefined && !Array.isArray(idNodes)) {
         if (DEBUG_MODE) console.error(chalk.red(`[DEBUG]     Content of <${elementName}> (${childTag}) is not an array as expected.`))
         errors.push(`<${elementName}> 内の <${childTag}> タグの構造が不正です (配列ではありません)。`)
    }
}

/**
 * <path path="..."> 形式のリスト要素の内容を検証する内部関数 (パス存在チェックは checkPathExists で行う)
 * @param {object} elementContent - 要素の内容オブジェクト
 * @param {string} elementName - 要素名
 * @param {object} definition - config_format.js の定義
 * @param {string[]} errors - エラーメッセージを追加する配列
 */
async function validatePathListElement(elementContent, elementName, definition, errors) { // async は checkPathExists のため維持
    if (!elementContent || typeof elementContent !== 'object') {
        if (DEBUG_MODE) console.log(chalk.blue(`[DEBUG]     Element <${elementName}> is empty or invalid, skipping content validation.`))
        return
    }

    const childTag = definition.childTag;
    const pathAttr = definition.pathAttribute;
    const expectedType = definition.type;
    const pathNodes = elementContent[childTag]

    const unexpectedContent = Object.keys(elementContent).filter(k => k !== childTag && k !== '$')
    if (unexpectedContent.length > 0) {
        if (DEBUG_MODE) console.warn(chalk.yellow(`[DEBUG]     Unexpected content found in <${elementName}>: [${unexpectedContent.join(', ')}]. Expected only <${childTag}> tags.`))
        errors.push(`<${elementName}> 要素内に予期しない内容 (<${unexpectedContent.join(', ')}>) が含まれています。`)
        return
    }

    if (pathNodes && Array.isArray(pathNodes)) {
        if (DEBUG_MODE) console.log(chalk.blue(`[DEBUG]     Found ${pathNodes.length} <${childTag}> tags in <${elementName}>.`))
        for (const [index, pathNode] of pathNodes.entries()) {
            if (typeof pathNode !== 'object' || pathNode === null) {
                if (DEBUG_MODE) console.error(chalk.red(`[DEBUG]       Invalid <${childTag}> node structure at index ${index} in <${elementName}>.`))
                errors.push(`<${elementName}> 内の ${index + 1} 番目の <${childTag}> タグの構造が不正です。`)
                continue
            }
            const attributes = pathNode.$
            if (!attributes || attributes[pathAttr] === undefined) {
                if (DEBUG_MODE) console.error(chalk.red(`[DEBUG]       Attribute "${pathAttr}" is MISSING in ${index + 1}th <${childTag}> tag of <${elementName}>.`))
                errors.push(`<${elementName}> 内の ${index + 1} 番目の <${childTag}> タグに "${pathAttr}" 属性がありません。`)
            } else {
                const pathValue = attributes[pathAttr]
                const typeChecker = configFormat.types[expectedType]
                if (DEBUG_MODE) console.log(chalk.blue(`[DEBUG]       Checking ${index + 1}th <${childTag}> path in <${elementName}>: "${pathValue}" (Expected type: ${expectedType})`))

                // ★★★ パス存在チェックを先に呼び出す ★★★
                let pathExistsFailed = false;
                if (DEBUG_MODE) console.log(chalk.blue(`[DEBUG]         Checking path existence for "${pathValue}"...`))
                await checkPathExists(pathValue, elementName, errors) // ★ await
                // エラーが追加されたか確認
                if (errors.some(e => e.startsWith(`[${elementName}]`) && e.includes(`"${pathValue}"`))) {
                    pathExistsFailed = true
                }

                // ★★★ 型チェック (パス存在チェックでエラーが出ていない場合のみ) ★★★
                if (!pathExistsFailed) {
                    if (typeChecker && !typeChecker(pathValue)) {
                        if (DEBUG_MODE) console.error(chalk.red(`[DEBUG]         Path "${pathValue}" FAILED type check (${expectedType}).`))
                        errors.push(`<${elementName}> 内の <${childTag}> の "${pathAttr}" 属性値 "${pathValue}" は期待される形式 (${expectedType}) ではありません。`)
                    } else if (typeChecker) {
                        if (DEBUG_MODE) console.log(chalk.green(`[DEBUG]         Path "${pathValue}" PASSED type check。`))
                    } else {
                         console.error(`[Config Check Error] Type checker for "${expectedType}" not found!`)
                         errors.push(`[内部エラー] ${elementName} の型 (${expectedType}) のチェック関数が見つかりません。`)
                    }
                }
            }
        }
    } else if (pathNodes === undefined && Object.keys(elementContent).length > 0) {
         if (DEBUG_MODE) console.warn(chalk.yellow(`[DEBUG]     Element <${elementName}> exists but contains no <${childTag}> tags.`))
    } else if (pathNodes !== undefined && !Array.isArray(pathNodes)) {
        if (DEBUG_MODE) console.error(chalk.red(`[DEBUG]     Content of <${elementName}> (${childTag}) is not an array as expected.`))
        errors.push(`<${elementName}> 内の <${childTag}> タグの構造が不正です (配列ではありません)。`)
    }
}


/**
 * <mods> 要素の内容を検証する内部関数 (パス存在チェックは checkPathExists で行う)
 * @param {object} modsContent - mods 要素の内容オブジェクト
 * @param {object} definition - config_format.js の modsElement 定義
 * @param {string[]} errors - エラーメッセージを追加する配列
 */
async function validateModsElement(modsContent, definition, errors) { // async は checkPathExists のため維持
    if (!modsContent || typeof modsContent !== 'object') {
        if (DEBUG_MODE) console.log(chalk.blue(`[DEBUG]     Element <mods> is empty or invalid, skipping content validation.`))
        return
    }

    const presentModChildren = Object.keys(modsContent).filter(k => k !== '$')
    for (const modChildName of presentModChildren) {
        if (!definition.allowedChildren.includes(modChildName)) {
            if (DEBUG_MODE) console.warn(chalk.yellow(`[DEBUG]     Unknown child element found in <mods>: <${modChildName}>`))
            errors.push(`<mods> 要素内に不明な子要素 <${modChildName}> が含まれています。`)
        }
    }

    // --- <path> タグのチェック ---
    if (modsContent.path) {
        if (Array.isArray(modsContent.path)) {
            const pathDef = definition.path;
            if (DEBUG_MODE) console.log(chalk.blue(`[DEBUG]     Found ${modsContent.path.length} <path> tags in <mods>.`))
            for (const [index, pathNode] of modsContent.path.entries()) {
                if (typeof pathNode !== 'object' || pathNode === null) {
                    if (DEBUG_MODE) console.error(chalk.red(`[DEBUG]       Invalid <path> node structure at index ${index} in <mods>.`))
                    errors.push(`<mods> 内の ${index + 1} 番目の <path> タグの構造が不正です。`)
                    continue
                }
                const attributes = pathNode.$
                if (!attributes || attributes[pathDef.pathAttribute] === undefined) {
                     if (DEBUG_MODE) console.error(chalk.red(`[DEBUG]       Attribute "${pathDef.pathAttribute}" is MISSING in ${index + 1}th <path> tag of <mods>.`))
                    errors.push(`<mods> 内の ${index + 1} 番目の <path> タグに "${pathDef.pathAttribute}" 属性がありません。`)
                } else {
                    const pathValue = attributes[pathDef.pathAttribute]
                    const typeChecker = configFormat.types[pathDef.type]
                    if (DEBUG_MODE) console.log(chalk.blue(`[DEBUG]       Checking ${index + 1}th <path> path in <mods>: "${pathValue}" (Expected type: ${pathDef.type})`))
                    if (typeChecker && !typeChecker(pathValue)) {
                        if (DEBUG_MODE) console.error(chalk.red(`[DEBUG]         Path "${pathValue}" FAILED type check (${pathDef.type}).`))
                        errors.push(`<mods> 内の <path> の "${pathDef.pathAttribute}" 属性値 "${pathValue}" は期待される形式 (${pathDef.type}) ではありません。`)
                    } else if (typeChecker) {
                        if (DEBUG_MODE) console.log(chalk.green(`[DEBUG]         Path "${pathValue}" PASSED type check.`))
                        // ★★★ パス存在チェックを呼び出す ★★★
                        if (DEBUG_MODE) console.log(chalk.blue(`[DEBUG]         Checking mod path existence for "${pathValue}"...`))
                        await checkPathExists(pathValue, 'mods', errors) // ★ await
                    } else {
                         console.error(`[Config Check Error] Type checker for "${pathDef.type}" not found!`)
                         errors.push(`[内部エラー] mods の型 (${pathDef.type}) のチェック関数が見つかりません。`)
                    }
                }
            }
        } else {
            if (DEBUG_MODE) console.error(chalk.red(`[DEBUG]     Content of <mods> (<path>) is not an array as expected.`))
            errors.push(`<mods> 内の <path> タグの構造が不正です (配列ではありません)。`)
        }
    }

    // --- <published_id> タグのチェック ---
    if (modsContent.published_id) {
        if (Array.isArray(modsContent.published_id)) {
            const idDef = definition.published_id;
            if (DEBUG_MODE) console.log(chalk.blue(`[DEBUG]     Found ${modsContent.published_id.length} <published_id> tags in <mods>.`))
            modsContent.published_id.forEach((idNode, index) => {
                 if (typeof idNode !== 'object' || idNode === null) {
                    if (DEBUG_MODE) console.error(chalk.red(`[DEBUG]       Invalid <published_id> node structure at index ${index} in <mods>.`))
                    errors.push(`<mods> 内の ${index + 1} 番目の <published_id> タグの構造が不正です。`)
                    return
                }
                const attributes = idNode.$
                if (!attributes || attributes[idDef.valueAttribute] === undefined) {
                     if (DEBUG_MODE) console.error(chalk.red(`[DEBUG]       Attribute "${idDef.valueAttribute}" is MISSING in ${index + 1}th <published_id> tag of <mods>.`))
                    errors.push(`<mods> 内の ${index + 1} 番目の <published_id> タグに "${idDef.valueAttribute}" 属性がありません。`)
                } else {
                    const idValue = attributes[idDef.valueAttribute]
                    const typeChecker = configFormat.types[idDef.type]
                    if (DEBUG_MODE) console.log(chalk.blue(`[DEBUG]       Checking ${index + 1}th <published_id> value in <mods>: "${idValue}" (Expected type: ${idDef.type})`))
                    if (typeChecker && !typeChecker(idValue)) {
                         if (DEBUG_MODE) console.error(chalk.red(`[DEBUG]         Value "${idValue}" FAILED type check (${idDef.type}).`))
                        errors.push(`<mods> 内の <published_id> の値 "${idValue}" は期待される形式 (${idDef.type}) ではありません。`)
                    } else if (typeChecker) {
                         if (DEBUG_MODE) console.log(chalk.green(`[DEBUG]         Value "${idValue}" PASSED type check.`))
                         // 存在確認は不要
                    } else {
                         console.error(`[Config Check Error] Type checker for "${idDef.type}" not found!`)
                          errors.push(`[内部エラー] mods の型 (${idDef.type}) のチェック関数が見つかりません。`)
                    }
                }
            })
        } else {
             if (DEBUG_MODE) console.error(chalk.red(`[DEBUG]     Content of <mods> (<published_id>) is not an array as expected.`))
             errors.push(`<mods> 内の <published_id> タグの構造が不正です (配列ではありません)。`)
        }
    }
}

/**
 * (★★★ 修正版 ★★★) ファイル/ディレクトリパスの存在を確認し、エラーがあれば配列に追加するヘルパー関数
 * - ワークショップアイテム: 存在しなくてもエラーとしない
 * - デフォルトパス (Playlist, BaseIsland): リストに含まれ、かつ実ファイルが存在するか確認
 * - その他パス (Mod等): パス形式に応じた実ファイル/ディレクトリが存在するか確認
 * @param {string} filePath - チェックするパス (XML内の値)
 * @param {string} contextName - エラーメッセージ用のコンテキスト名 (要素名 or 属性名)
 * @param {string[]} errors - エラーメッセージを追加する配列
 */
async function checkPathExists(filePath, contextName, errors) {
    // 1. 基本チェック (空パスは無効)
    if (typeof filePath !== 'string' || filePath.trim() === '') {
        errors.push(`[${contextName}] 設定されているパスが空です。`)
        if (DEBUG_MODE) console.warn(chalk.yellow(`[DEBUG][checkPathExists] Found empty path in context "${contextName}".`))
        return
    }

    const stormworksBaseDir = serverInfo.serverDirectory;
    const workshopContentDir = serverInfo.workshopContentPath;

    let pathToCheck;
    let isWorkshopItemCheck = false;
    let isDefaultItemCheck = false;
    let pathTypeDescription = "指定されたパス" // エラーメッセージ用

    // --- パスの種類に応じて確認対象を決定 ---
    const workshopPlaylistRegex = /^rom\/data\/workshop_missions\/(\d{10,11})$/;
    const workshopMatch = filePath.match(workshopPlaylistRegex)

    // a) ワークショッププレイリストのパス形式か？
    if (workshopMatch) {
        const workshopId = workshopMatch[1]
        if (!workshopContentDir) {
             errors.push(`[${contextName}] Botの設定エラー: ワークショップコンテンツのパス(WORKSHOP_CONTENT_PATH)が未設定です。プレイリスト "${workshopId}" の検証を続行できません。`)
             return
        }
        pathToCheck = path.join(workshopContentDir, workshopId)
        isWorkshopItemCheck = true
        pathTypeDescription = "ワークショッププレイリスト"
        if (DEBUG_MODE) console.log(chalk.blue(`[DEBUG][checkPathExists] Workshop playlist path detected for "${filePath}". Checking target existence: ${pathToCheck}`))

    // b) デフォルトプレイリストのパスか？
    } else if (configFormat.defaultPlaylistPaths && configFormat.defaultPlaylistPaths.includes(filePath)) {
        if (!stormworksBaseDir) {
             errors.push(`[${contextName}] Stormworks の基準ディレクトリが不明なため、デフォルトプレイリスト "${filePath}" の存在を確認できません。`)
             return
        }
        pathToCheck = path.join(stormworksBaseDir, filePath) // デフォルトは stormworksBaseDir/rom/data/missions/...
        isDefaultItemCheck = true
        pathTypeDescription = "デフォルトプレイリスト"
        if (DEBUG_MODE) console.log(chalk.blue(`[DEBUG][checkPathExists] Default playlist path detected for "${filePath}". Checking existence: ${pathToCheck}`))

    // ★★★ c) デフォルト Base Island のパスか？ ★★★
    } else if (contextName === 'base_island' && configFormat.defaultBaseIslandPaths && configFormat.defaultBaseIslandPaths.includes(filePath)) {
        if (!stormworksBaseDir) {
            errors.push(`[${contextName}] Stormworks の基準ディレクトリが不明なため、ベースアイランド "${filePath}" の存在を確認できません。`)
            return
        }
        // ★★★ 正しいパスを組み立てる: stormworksBaseDir/rom/filePath ★★★
        pathToCheck = path.join(stormworksBaseDir, 'rom', filePath)
        isDefaultItemCheck = true
        pathTypeDescription = "デフォルトベースアイランド"
        if (DEBUG_MODE) console.log(chalk.blue(`[DEBUG][checkPathExists] Default base island path detected for "${filePath}". Checking existence: ${pathToCheck}`))

    // d) Modの絶対パスで、かつワークショップコンテンツパス形式か？
    } else if (contextName === 'mods' && path.isAbsolute(filePath) && workshopContentDir && filePath.startsWith(workshopContentDir)) {
        // workshopContentDir が設定されており、filePath がそのパスで始まる場合
        pathToCheck = filePath;
        isWorkshopItemCheck = true
        pathTypeDescription = "ワークショップMod"
        if (DEBUG_MODE) console.log(chalk.blue(`[DEBUG][checkPathExists] Absolute workshop mod path detected for "${filePath}". Checking existence: ${pathToCheck}`))

    // e) その他のパス (ローカルModなど)
    } else {
        if (!stormworksBaseDir) {
             errors.push(`[${contextName}] Stormworks の基準ディレクトリが不明なため、パス "${filePath}" の存在を確認できません。`)
             return
        }
        if (contextName === 'mods') {
            pathTypeDescription = "Modパス"
            if (!path.isAbsolute(filePath)) {
                // ローカルMod相対パス (基準はサーバーのルート)
                pathToCheck = path.join(stormworksBaseDir, filePath)
            } else {
                // ローカルMod絶対パス
                pathToCheck = filePath;
            }
        } else {
             // base_island でリストに含まれない場合や、その他の不明なパス
             // 型チェックで弾かれているはずだが、念のためエラー
             errors.push(`[${contextName}] パス "${filePath}" は許可されていません。`)
             if (DEBUG_MODE) console.warn(chalk.yellow(`[DEBUG][checkPathExists] Unhandled/Disallowed path format for "${filePath}" in context "${contextName}".`))
             return
        }
        if (DEBUG_MODE) console.log(chalk.blue(`[DEBUG][checkPathExists] Local/Other path detected for "${filePath}". Checking existence: ${pathToCheck}`))
    }

    // --- 存在チェック実行 ---
    try {
        await fs.access(pathToCheck)
        if (DEBUG_MODE) console.log(chalk.green(`[DEBUG][checkPathExists] PASSED: ${pathToCheck}`))
    } catch (error) {
        if (error.code === 'ENOENT') { // Not Found
            if (DEBUG_MODE) console.error(chalk.red(`[DEBUG][checkPathExists] FAILED (Not Found): ${pathToCheck}`))
            // ★★★ ワークショップアイテムが見つからない場合はエラーにしない ★★★
            if (isWorkshopItemCheck) {
                console.log(chalk.yellow(`[INFO][checkPathExists] Workshop item not found for "${filePath}" (Target: ${pathToCheck}). Will attempt download later。`))
            } else {
                // ★★★ エラーメッセージをテストの期待値に合わせる ★★★
                let errorMsg = `[${contextName}] ${pathTypeDescription}が見つかりません: "${filePath}" (確認先: ${pathToCheck})`
                // テストケースに合わせた具体的なメッセージに変更
                if (contextName === 'playlists' && pathTypeDescription === 'デフォルトプレイリスト') {
                    errorMsg = `[playlists] デフォルトプレイリストが見つかりません: "${filePath}" (確認先: ${pathToCheck})`
                } else if (contextName === 'base_island' && pathTypeDescription === 'デフォルトベースアイランド') {
                    errorMsg = `[base_island] デフォルトベースアイランドが見つかりません: "${filePath}" (確認先: ${pathToCheck})`
                } else if (contextName === 'mods' && pathTypeDescription === 'Modパス') {
                     errorMsg = `[mods] Modパスが見つかりません: "${filePath}" (確認先: ${pathToCheck})`
                }
                errors.push(errorMsg)
            }
        } else { // Access Error など
            if (DEBUG_MODE) console.error(chalk.red(`[DEBUG][checkPathExists] FAILED (Access Error): ${pathToCheck}`), error)
            // アクセスエラーなどはワークショップアイテムでもエラーとする
            errors.push(`[${contextName}] ${pathTypeDescription} "${filePath}" の確認中にエラーが発生しました: ${error.message}`)
            console.error(`[ConfigCheck] Error accessing path ${pathToCheck}:`, error)
        }
    }
}

// --- モジュールとして検証関数をエクスポート ---
module.exports = {
    validateServerConfig,
}