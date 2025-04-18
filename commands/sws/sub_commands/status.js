const { EmbedBuilder } = require('discord.js')

module.exports = {
    async execute(interaction, serverInstances) {
        const instanceName = interaction.options.getString('name')
        const embed = new EmbedBuilder()
            .setTitle('サーバー状態')
            .setColor(0x00FF00)

        if (instanceName) {
            const serverState = serverInstances.get(instanceName)
            if (!serverState) {
                await interaction.reply({
                    content: `サーバー "${instanceName}" は存在しません。`,
                    ephemeral: true
                })
                return
            }

            embed.addFields(
                { name: 'サーバー名', value: instanceName, inline: true },
                { name: '起動状態', value: serverState.isRun ? '起動中' : '停止中', inline: true },
                { name: '起動時間', value: serverState.startTime || 'N/A', inline: true },
                { name: '起動者', value: serverState.startedBy || '不明', inline: true }
            )
        } else {
            serverInstances.forEach((state, name) => {
                embed.addFields(
                    { name: 'サーバー名', value: name, inline: true },
                    { name: '起動状態', value: state.isRun ? '起動中' : '停止中', inline: true },
                    { name: '起動時間', value: state.startTime || 'N/A', inline: true },
                    { name: '起動者', value: state.startedBy || '不明', inline: true }
                )
            })
        }

        await interaction.reply({ embeds: [embed] })
    }
}