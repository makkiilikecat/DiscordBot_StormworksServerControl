// commands/sws/sub_commands/custom_create.js

const fs = require('node:fs').promises;
const path = require('node:path');
const xml2js = require('xml2js');
const fetch = require('node-fetch'); // node-fetch v2 を使っている場合
// import fetch from 'node-fetch'; // node-fetch v3 or Node.js v18+ の場合
const utils = require('./utility/utils');
const config = require('./utility/registry');
const messages = require('./utility/messages');
const { validateServerConfig } = require('./utility/check_config');
const { extractWorkshopIdsAndTypes, prepareWorkshopItems, createPlaylistSymlinks } = require('./utility/workshop_downloader');

const builder = new xml2js.Builder();

module.exports = {
    async execute(interaction) {
        const configName = interaction.options.getString('name');
        const configFileAttachment = interaction.options.getAttachment('config_file');
        let newConfigPath = null; // ディレクトリ作成後にエラーが発生した場合の削除用
        let parsedXmlData = null;

        try {
            // --- 基本チェック ---
            if (!utils.isValidConfigName(configName)) {
                await interaction.reply({ content: messages.get('ERROR_CONFIG_NAME_INVALID', { invalidName: configName }), ephemeral: true });
                return;
            }
            if (configFileAttachment.contentType !== 'text/xml' && configFileAttachment.name !== 'server_config.xml') {
                 await interaction.reply({ content: `エラー: 添付ファイルは 'server_config.xml' という名前のXMLファイルである必要があります。\n(ファイル名: ${configFileAttachment.name}, タイプ: ${configFileAttachment.contentType || '不明'})`, ephemeral: true });
                return;
            }
            const configExists = await utils.checkConfigExists(configName);
            if (configExists) {
                await interaction.reply({ content: messages.get('ERROR_CONFIG_ALREADY_EXISTS', { configName }), ephemeral: true });
                return;
            }

            await interaction.deferReply({ ephemeral: false });

            // --- ステップ 1: XMLダウンロードと検証 ---
            await interaction.editReply({ content: '添付された設定ファイル (`server_config.xml`) をダウンロードして検証中...', ephemeral: false });
            let xmlDataString;
            try {
                const response = await fetch(configFileAttachment.url);
                if (!response.ok) throw new Error(`ダウンロード失敗: ${response.status} ${response.statusText}`);
                xmlDataString = await response.text();
                if (!xmlDataString) throw new Error('ファイルが空か、内容を読み取れませんでした。');
                console.log(`[INFO] Downloaded config file from ${configFileAttachment.url}`);
            } catch (downloadError) {
                console.error(`[ERROR] Failed to download config file for ${configName}:`, downloadError);
                await interaction.editReply({ content: `添付ファイルのダウンロードに失敗しました: ${downloadError.message}`, ephemeral: true });
                return;
            }

            const validationResult = await validateServerConfig(xmlDataString);
            if (!validationResult.success) {
                const errorList = validationResult.errors.map(e => `- ${e}`).join('\n');
                console.warn(`[WARN] Config file validation failed for ${configName}:\n${errorList}`);
                await interaction.editReply({
                    // messages.js を利用
                    content: messages.get('ERROR_CONFIG_VALIDATION_FAILED', {
                        fileName: configFileAttachment.name,
                        errorCount: validationResult.errors.length,
                        errorDetails: errorList
                    }),
                    ephemeral: true // 検証エラーは本人にのみ
                });
                return;
            }
            parsedXmlData = validationResult.parsedData;
            console.log(`[INFO] Config file "${configFileAttachment.name}" validated successfully for ${configName}.`);

            // --- ステップ 2 & 3: ワークショップアイテムの準備 ---
            await interaction.editReply({ content: 'ワークショップアイテムの情報を抽出し、必要なアイテムを準備中 (ダウンロード含む)...', ephemeral: false });
            const requiredItems = extractWorkshopIdsAndTypes(parsedXmlData); // Map<id, {type, sourcePath, targetPath}>

            // prepareWorkshopItems は interaction を使って followUp で結果を報告する
            const preparationResult = await prepareWorkshopItems(requiredItems, interaction); // { allReady: boolean, results: [...] }

            if (!preparationResult.allReady) {
                console.error(`[ERROR] Failed to prepare required workshop items for ${configName}.`);
                // prepareWorkshopItems が既に失敗メッセージを FollowUp している
                await interaction.editReply({ content: '❌ 必要なワークショップアイテムの準備に失敗しました。上記の詳細を確認してください。構成の作成を中止します。', ephemeral: false });
                return; // アイテム準備失敗
            }
            console.log(`[INFO] All required workshop items are ready for ${configName}.`);


            // --- ステップ 4: サーバー構成作成 ---
            await interaction.editReply({ content: `ワークショップアイテム準備完了。サーバー構成 **${configName}** を作成中...`, ephemeral: false });

            // 4a. ポート割り当て
            const usedPorts = await utils.getUsedPorts();
            const availablePort = utils.findAvailablePort(config.minPort, config.maxPort, usedPorts);
            if (availablePort === null) {
                console.error(`[ERROR] No available ports for ${configName}.`);
                await interaction.editReply({ content: messages.get('ERROR_PORT_NOT_AVAILABLE', { minPort: config.minPort, maxPort: config.maxPort }), ephemeral: true });
                return;
            }
            console.log(`[INFO] Assigning port ${availablePort} to ${configName}.`);

            // 4b. 構成ディレクトリ作成
            newConfigPath = utils.getConfigPath(configName);
            try {
                 await fs.mkdir(newConfigPath, { recursive: true });
                 console.log(`[INFO] Created server config directory: ${newConfigPath}`);
            } catch (mkdirError) {
                 console.error(`[ERROR] Failed to create directory ${newConfigPath}:`, mkdirError);
                 await interaction.editReply({ content: `構成ディレクトリの作成に失敗しました: ${mkdirError.message}`, ephemeral: true });
                 return;
            }

            // 4c. シンボリックリンク作成 (プレイリスト用) - ディレクトリ作成後、XML保存前
            // ★ prepareWorkshopItems の結果 (配列) から Map を再構築して渡す
             const preparedItemsMap = new Map();
             preparationResult.results.forEach(r => {
                 const originalInfo = requiredItems.get(r.id); // 元の情報を取得
                 if (originalInfo) {
                    preparedItemsMap.set(r.id, {
                        success: r.success,
                        targetPath: r.targetPath,
                        type: originalInfo.type // type 情報を追加
                    });
                 }
             });

             // createPlaylistSymlinks は interaction を使って followUp で結果を報告する
             const symlinkSuccess = await createPlaylistSymlinks(configName, preparedItemsMap, interaction);
             if (!symlinkSuccess) {
                 console.error(`[ERROR] Failed to create symbolic links for ${configName}.`);
                 // createPlaylistSymlinks が既に失敗メッセージを FollowUp している
                 await interaction.editReply({ content: `❌ ワークショッププレイリストのシンボリックリンク作成に失敗しました。上記の詳細を確認してください。構成の作成を中止します。`, ephemeral: false });
                 // ★ 作成したディレクトリを削除
                 console.log(`[Cleanup] Removing directory ${newConfigPath} due to symlink error.`);
                 await fs.rm(newConfigPath, { recursive: true, force: true }).catch(err => console.error(`[Cleanup Error] Failed to remove directory ${newConfigPath}: ${err.message}`));
                 return; // シンボリックリンク失敗
             }
             console.log(`[INFO] Symbolic links created successfully for ${configName}.`);


            // 4d. XML更新と保存 (ポート番号)
            await interaction.editReply({ content: `シンボリックリンク作成完了。設定ファイルにポート番号(${availablePort})を書き込み中...`, ephemeral: false });
            try {
                 const serverDataNode = parsedXmlData.server_data; // server_dataはオブジェクトそのもの
                 if (!serverDataNode.$) serverDataNode.$ = {}; // 属性オブジェクトがなければ作成
                 serverDataNode.$.port = String(availablePort); // port属性を設定/上書き

                 const updatedXml = builder.buildObject(parsedXmlData);
                 const configFilePath = path.join(newConfigPath, 'server_config.xml');
                 await fs.writeFile(configFilePath, updatedXml);
                 console.log(`[INFO] Saved updated server_config.xml for ${configName} to ${configFilePath}`);
            } catch (xmlWriteError) {
                 console.error(`[ERROR] Failed to write server_config.xml for ${configName}:`, xmlWriteError);
                 await interaction.editReply({ content: `設定ファイル(server_config.xml)の保存中にエラーが発生しました: ${xmlWriteError.message}`, ephemeral: true });
                 console.log(`[Cleanup] Removing directory ${newConfigPath} due to XML write error.`);
                 await fs.rm(newConfigPath, { recursive: true, force: true }).catch(err => console.error(`[Cleanup Error] Failed to remove directory ${newConfigPath}: ${err.message}`));
                 return;
            }

            // 4e. メタデータ保存
            await interaction.editReply({ content: `設定ファイル保存完了。管理情報を保存中...`, ephemeral: false });
            try {
                await utils.writeMetadata(configName, interaction.user.id, availablePort);
                console.log(`[INFO] Saved metadata.xml for ${configName}.`);
            } catch (metaWriteError) {
                 console.error(`[ERROR] Failed to write metadata.xml for ${configName}:`, metaWriteError);
                 // メタデータ書き込み失敗は警告に留める
                 await interaction.followUp({
                     content: `⚠️ ${messages.get('ERROR_METADATA_WRITE', { configName })}\n構成とワークショップアイテムは準備できましたが、管理情報の保存に失敗しました。`,
                     ephemeral: true
                 });
            }

            // --- ステップ 5: 完了報告 ---
            await interaction.editReply({
                content: `✅ サーバー構成 **${configName}** が正常に作成されました！ (ポート: ${availablePort})\n設定ファイル、ワークショップアイテム、シンボリックリンクが準備できました。\n\`/sws start ${configName}\` で起動できます。`,
                ephemeral: false // 最終的な成功メッセージは全員に
            });
            console.log(`[SUCCESS] Successfully created custom server config "${configName}".`);


        } catch (error) {
            // --- 全体的なエラーハンドリング ---
            console.error(`[ERROR] Unexpected error during custom config creation (${configName}):`, error);
            const errorMessage = messages.get('ERROR_COMMAND_INTERNAL') + `\nエラー詳細: ${error.message}\nスタック: \`\`\`${error.stack}\`\`\``; // スタックトレースも入れるとデバッグしやすい

            // 作成途中のディレクトリがあれば削除
            if (newConfigPath) {
                try {
                    // ディレクトリが存在するか確認してから削除
                    await fs.access(newConfigPath); // 存在確認
                    console.log(`[Cleanup] Removing directory ${newConfigPath} due to unexpected error.`);
                    await fs.rm(newConfigPath, { recursive: true, force: true });
                } catch (cleanupError) {
                    if (cleanupError.code !== 'ENOENT') { // ENOENT (Not Found) は無視
                         console.error(`[ERROR] Failed to cleanup directory ${newConfigPath}:`, cleanupError);
                    }
                }
            }
            // エラーメッセージを送信
            try {
                if (interaction.replied || interaction.deferred) {
                     // editReply は一度しかできないので、followUp を使うのが確実
                     await interaction.followUp({ content: errorMessage, ephemeral: true });
                } else {
                    await interaction.reply({ content: errorMessage, ephemeral: true });
                }
            } catch (replyError) {
                 console.error("[ERROR] Failed to send error reply to user:", replyError);
            }
        }
    }
};