import { SlashCommandBuilder } from 'discord.js';
import { getEconomyData } from '../../utils/economy.js';
import { getEconomySettings } from '../../services/economySettings.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { buildIndexView } from './modules/collection_view.js';
import { t } from '../../i18n/index.js';

// /index — the collection book (2026-10-15): Club'o'mony cards from /paczka and every fish
// caught with /fish. On your own index you can sell cards and open packs.

export default {
    data: new SlashCommandBuilder()
        .setName('index')
        .setDescription("Your collection: Club'o'mony cards and the fish you caught")
        .addUserOption(option =>
            option
                .setName('osoba')
                .setDescription('Show the index of another member')
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName('zakladka')
                .setDescription('What to show first')
                .setRequired(false)
                .addChoices(
                    { name: "Club'o'mony cards", value: 'karty' },
                    { name: 'Fish', value: 'ryby' },
                )
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const user = interaction.options.getUser('osoba') ?? interaction.user;
        if (user.bot) {
            throw createError("Bot has no index", ErrorTypes.VALIDATION, t("Bots don't have an economy balance."), { expected: true });
        }
        await getEconomySettings(interaction.guildId);
        const userData = await getEconomyData(client, interaction.guildId, user.id);
        const tab = interaction.options.getString('zakladka') ?? 'karty';
        await InteractionHelper.safeEditReply(interaction, buildIndexView({ guildId: interaction.guildId, user, viewerId: interaction.user.id, userData, tab }));
    }, { command: 'index' })
};
