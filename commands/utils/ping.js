// D:\_Develop\VSCode\DiscordBot_StormworksServerControl\commands\utility\ping.js

const { SlashCommandBuilder } = require('discord.js') // v14.7以降は discord.js から直接インポート可能

module.exports = {
	// スラッシュコマンドの定義
	data: new SlashCommandBuilder()
		.setName('ping') // コマンド名 (スラッシュは不要)
		.setDescription('Replies with Pong!!'), // コマンドの説明

	// コマンドが実行されたときの処理
	async execute(interaction) {
		// interaction.reply() でコマンド実行者に返信する
		await interaction.reply('Pong!!')
	},
}