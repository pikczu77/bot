import { SlashCommandBuilder } from 'discord.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { showMissions } from './modules/progress_view.js';
import { t } from '../../i18n/index.js';

// /misje — three daily and three weekly missions (2026-10-26). Rules: services/progress.js.

export default {
    data: new SlashCommandBuilder()
        .setName('misje')
        .setDescription('Your daily and weekly missions: rewards for jobs, games and packs')
        .addUserOption(option =>
            option
                .setName('osoba')
                .setDescription('Show the missions of another member')
                .setRequired(false)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const user = interaction.options.getUser('osoba') ?? interaction.user;
        if (user.bot) {
            throw createError("Bot has no missions", ErrorTypes.VALIDATION, t("Bots don't have an economy balance."), { expected: true });
        }
        await InteractionHelper.safeEditReply(interaction, await showMissions({ client, guildId: interaction.guildId, user, viewerId: interaction.user.id }));
    }, { command: 'misje' })
};
