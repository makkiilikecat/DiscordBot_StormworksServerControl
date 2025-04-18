// D:\_Develop\VSCode\DiscordBot_StormworksServerControl\deploy-commands.js

const { REST, Routes } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config(); // .env ファイルを読み込む

const commands = [];
// commands フォルダからコマンドファイルを取得
const foldersPath = path.join(__dirname, 'commands');
const commandFolders = fs.readdirSync(foldersPath);

for (const folder of commandFolders) {
	const commandsPath = path.join(foldersPath, folder);
	if (!fs.existsSync(commandsPath)) {
		console.error(`[ERROR] The path ${commandsPath} does not exist.`);
		continue;
	}
	const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
	// 各コマンドファイルの .data をJSON形式で取得
	for (const file of commandFiles) {
		const filePath = path.join(commandsPath, file);
		const command = require(filePath);
		if ('data' in command && 'execute' in command) {
			commands.push(command.data.toJSON());
            console.log(`[INFO] Loaded command data from: ${filePath}`);
		} else {
			console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
		}
	}
}

// Discord API と通信するための REST モジュールをインスタンス化
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

// コマンドをデプロイ (登録)
(async () => {
	try {
        // 環境変数から必須情報を取得
        const clientId = process.env.DISCORD_CLIENT_ID;
        const guildId = process.env.DISCORD_GUILD_ID; // テスト用サーバーID

        if (!clientId || !guildId) {
            console.error('Error: DISCORD_CLIENT_ID or DISCORD_GUILD_ID not found in .env file.');
            console.log('Please add DISCORD_CLIENT_ID=(Your Bot Client ID) and DISCORD_GUILD_ID=(Your Test Server ID) to your .env file.');
            return;
        }

		console.log(`Started refreshing ${commands.length} application (/) commands.`);

		// put メソッドで、指定したサーバー (Guild) にコマンドを登録
        // Guildコマンドは即時反映されるため、開発中はGuildコマンドを推奨
		const data = await rest.put(
			Routes.applicationGuildCommands(clientId, guildId), // 特定サーバー用
            // Routes.applicationCommands(clientId), // グローバル用 (反映に最大1時間かかる)
			{ body: commands },
		);

		console.log(`Successfully reloaded ${data.length} application (/) commands.`);
	} catch (error) {
		// エラーをキャッチしてログに出力
		console.error('[ERROR] An error occurred while deploying commands:', error);
        if (error.response && error.response.data) {
            console.error('[ERROR DETAILS]', error.response.data);
        }
	}
})();