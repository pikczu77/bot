import { SlashCommandBuilder } from 'discord.js';
import { getEconomyData } from '../../utils/economy.js';
import { getEconomySettings } from '../../services/economySettings.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { buildAchievementsView } from './modules/progress_view.js';
import { t } from '../../i18n/index.js';

// /osiagniecia — badges for milestones (2026-10-26). Each pays a reward once. Rules: services/progress.js.

export default {
    data: new SlashCommandBuilder()
        .setName('osiagniecia')
        .setDescription('Your badges: milestones in jobs, the casino, collections and games')
        .addUserOption(option =>
            option
                .setName('osoba')
                .setDescription('Show the badges of another member')
                .setRequired(false)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const user = interaction.options.getUser('osoba') ?? interaction.user;
        if (user.bot) {
            throw createError("Bot has no badges", ErrorTypes.VALIDATION, t("Bots don't have an economy balance."), { expected: true });
        }
        const settings = await getEconomySettings(interaction.guildId);
        const userData = await getEconomyData(client, interaction.guildId, user.id);
        await InteractionHelper.safeEditReply(interaction, buildAchievementsView({ guildId: interaction.guildId, settings, user, userData }));
    }, { command: 'osiagniecia' })
};
