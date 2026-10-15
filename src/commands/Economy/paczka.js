import { SlashCommandBuilder } from 'discord.js';
import { getEconomyData } from '../../utils/economy.js';
import { getEconomySettings } from '../../services/economySettings.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { buildPackShop, buildPackView, openPack } from './modules/collection_view.js';

// /paczka — buy and open a Club'o'mony card pack (2026-10-15). Without a choice it shows the
// three packs with their odds and buttons. Cards land in /index. Odds: services/collections.js.

export default {
    data: new SlashCommandBuilder()
        .setName('paczka')
        .setDescription("Buy and open a Club'o'mony card pack")
        .addStringOption(option =>
            option
                .setName('rodzaj')
                .setDescription('Which pack to open (without it: all packs and their odds)')
                .setRequired(false)
                .addChoices(
                    { name: 'Starter Pack - 1 card', value: 'startowa' },
                    { name: 'Collector Pack - 2 cards', value: 'kolekcjonera' },
                    { name: 'Legend Pack - 3 cards', value: 'legend' },
                )
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const guildId = interaction.guildId;
        const userId = interaction.user.id;
        const packId = interaction.options.getString('rodzaj');
        await getEconomySettings(guildId);

        if (!packId) {
            const userData = await getEconomyData(client, guildId, userId);
            await InteractionHelper.safeEditReply(interaction, buildPackShop({ guildId, ownerId: userId, userData }));
            return;
        }

        const result = await openPack({ client, guildId, userId, packId });
        await InteractionHelper.safeEditReply(interaction, buildPackView({ guildId, ownerId: userId, ...result }));
    }, { command: 'paczka' })
};
