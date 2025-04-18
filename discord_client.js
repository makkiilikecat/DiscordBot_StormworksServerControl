const { Client, GatewayIntentBits, Partials } = require('discord.js'); // 必要なものをインポート

// Botのクライアントインスタンスを作成
// 必要なIntentsを指定する
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction],
})

function getDiscordClient() {
    return client;
}

module.exports = {
    client,
    getDiscordClient,
};