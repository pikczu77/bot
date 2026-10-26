import { SlashCommandBuilder } from 'discord.js';
import { getEconomyData } from '../../utils/economy.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { cardChoices, createOffer } from './modules/trade.js';

// /wymiana — offer another member a swap of Club'o'mony cards and money (2026-10-26).
// Code and buttons: modules/trade.js, interactions/buttons/economy/trade.js.

export default {
    data: new SlashCommandBuilder()
        .setName('wymiana')
        .setDescription("Trade Club'o'mony cards and money with another member")
        .addUserOption(option =>
            option
                .setName('osoba')
                .setDescription('Who you trade with')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('daje')
                .setDescription('Your card you give')
                .setRequired(false)
                .setAutocomplete(true)
        )
        .addStringOption(option =>
            option
                .setName('chce')
                .setDescription('Their card you want')
                .setRequired(false)
                .setAutocomplete(true)
        )
        .addIntegerOption(option =>
            option
                .setName('doplacam')
                .setDescription('Money you add')
                .setRequired(false)
                .setMinValue(1)
        )
        .addIntegerOption(option =>
            option
                .setName('chce_kasy')
                .setDescription('Money you want from them')
                .setRequired(false)
                .setMinValue(1)
        ),

    async autocomplete(interaction, client) {
        const focused = interaction.options.getFocused(true);
        const ownerId = focused.name === 'chce' ? interaction.options.get('osoba')?.value : interaction.user.id;
        if (!ownerId) return interaction.respond([]);
        const userData = await getEconomyData(client ?? interaction.client, interaction.guildId, String(ownerId), { joint: false });
        await interaction.respond(cardChoices(userData, focused.value));
    },

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const payload = await createOffer({
            client,
            guildId: interaction.guildId,
            from: interaction.user,
            to: interaction.options.getUser('osoba'),
            give: { card: interaction.options.getString('daje'), money: interaction.options.getInteger('doplacam') ?? 0 },
            want: { card: interaction.options.getString('chce'), money: interaction.options.getInteger('chce_kasy') ?? 0 },
        });
        await InteractionHelper.safeEditReply(interaction, payload);
    }, { command: 'wymiana' })
};
