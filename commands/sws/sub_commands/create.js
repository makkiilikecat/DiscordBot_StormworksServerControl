// commands/sws/sub_commands/create.js

const path = require('node:path');
const utils = require('./utility/utils'); // ユーティリティ関数をインポート
const config = require('./utility/registry'); // 設定情報をインポート
const messages = require('./utility/messages'); // メッセージ管理モジュールをインポート

const MIN_PORT = config.minPort;
const MAX_PORT = config.maxPort;

module.exports = {
    async execute(interaction) {
        const configName = interaction.options.getString('name');
        const templateName = interaction.options.getString('template') || 'default'; // 指定がない場合は 'default' テンプレートを使用

        try {
            // 1. 構成名の妥当性をチェック
            if (!utils.isValidConfigName(configName)) {
                await interaction.reply({
                    content: messages.get('ERROR_CONFIG_NAME_INVALID', { invalidName: configName }),
                    ephemeral: true // エラーメッセージは本人にのみ表示
                });
                return;
            }

            // 2. テンプレートが存在し、有効かチェック
            const templateExists = await utils.checkTemplateExists(templateName);
            if (!templateExists) {
                await interaction.reply({
                    content: messages.get('ERROR_TEMPLATE_NOT_FOUND', { templateName }),
                    ephemeral: true
                });
                return;
            }

            // 3. 同じ名前の構成が既に存在しないかチェック
            const configExists = await utils.checkConfigExists(configName);
            if (configExists) {
                await interaction.reply({
                    content: messages.get('ERROR_CONFIG_ALREADY_EXISTS', { configName }),
                    ephemeral: true
                });
                return;
            }

            // 4. 処理に時間がかかる可能性があるため、応答を保留 (ephemeral: false で成功時は公開)
            await interaction.deferReply({ ephemeral: false });

            // 5. 使用中のポート番号を取得し、利用可能なポートを探す
            const usedPorts = await utils.getUsedPorts();
            const availablePort = utils.findAvailablePort(MIN_PORT, MAX_PORT, usedPorts);

            // 利用可能なポートがない場合はエラーを返す
            if (availablePort === null) {
                await interaction.editReply({
                    content: messages.get('ERROR_PORT_NOT_AVAILABLE', { minPort: MIN_PORT, maxPort: MAX_PORT }),
                    ephemeral: true // ポート不足エラーは本人にのみ表示が良い場合もあるが、状況により false でも可
                });
                return;
            }
            console.log(`[INFO] Assigning port ${availablePort} to new config ${configName}`);

            // 6. テンプレートから新しい構成ディレクトリへファイルをコピー
            const templatePath = utils.getTemplatePath(templateName);
            const newConfigPath = utils.getConfigPath(configName);
            try {
                await utils.copyDirectoryRecursive(templatePath, newConfigPath);
            } catch(copyError) {
                 console.error(`Directory copy failed for ${configName} from ${templateName}:`, copyError);
                 await interaction.editReply({
                    content: messages.get('ERROR_DIRECTORY_COPY', { templateName, configName }),
                    ephemeral: true
                 });
                 return; // コピー失敗時は以降の処理を中断
            }


            // 7. server_config.xml のポート番号を更新
            try {
                await utils.updateConfigXmlPort(configName, availablePort);
            } catch(portUpdateError) {
                 console.error(`Port update failed for ${configName}:`, portUpdateError);
                 // ポート更新失敗時の処理（ディレクトリ削除など）を追加することも検討
                 await interaction.editReply({
                    content: messages.get('ERROR_CONFIG_XML_PORT_UPDATE', { configName }),
                    ephemeral: true
                 });
                 return;
            }

            // 8. 作成者情報などを記録するメタデータを書き込む
            try {
                await utils.writeMetadata(configName, interaction.user.id);
            } catch (metaWriteError) {
                 console.error(`Metadata write failed for ${configName}:`, metaWriteError);
                 // メタデータ書き込み失敗時の処理を検討
                 await interaction.editReply({
                    content: messages.get('ERROR_METADATA_WRITE', { configName }),
                    ephemeral: true
                 });
                 return;
            }


            // 9. 成功メッセージを編集して表示
            await interaction.editReply(messages.get('SUCCESS_CREATE', { configName, templateName }));

        } catch (error) {
            // 予期せぬエラーが発生した場合の処理
            console.error(`Error during config creation (${configName}):`, error);
            const errorMessage = messages.get('ERROR_COMMAND_INTERNAL'); // より具体的なエラーはログで確認

            // 応答が保留中か既に返信済みかで対応を分岐
            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply({ content: errorMessage, ephemeral: true });
                } else {
                    await interaction.reply({ content: errorMessage, ephemeral: true });
                }
            } catch (replyError) {
                 console.error("Failed to send error reply to user:", replyError);
            }
        }
    }
};