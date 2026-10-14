import { SlashCommandBuilder } from 'discord.js';
import { getEconomyData } from '../../utils/economy.js';
import { getEconomySettings } from '../../services/economySettings.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { buildUpgradesView } from './modules/upgrades_view.js';
import { t } from '../../i18n/index.js';

export default {
    data: new SlashCommandBuilder()
        .setName('ulepszenia')
        .setDescription('Your permanent economy upgrades - see them and buy the next level')
        .addUserOption(option =>
            option
                .setName('uzytkownik')
                .setDescription('Show the upgrades of another member')
                .setRequired(false)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const user = interaction.options.getUser('uzytkownik') ?? interaction.user;
        if (user.bot) {
            throw createError("Bot has no upgrades", ErrorTypes.VALIDATION, t("Bots don't have an economy balance."), { expected: true });
        }

        await getEconomySettings(interaction.guildId);
        const userData = await getEconomyData(client, interaction.guildId, user.id);
        const own = user.id === interaction.user.id;
        const view = buildUpgradesView({ guildId: interaction.guildId, userData, user, ownerId: own ? user.id : null });
        await InteractionHelper.safeEditReply(interaction, view);
    }, { command: 'ulepszenia' })
};
