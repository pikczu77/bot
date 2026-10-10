import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { createEmbed, errorEmbed, warningEmbed } from '../../utils/embeds.js';
import { getConfirmationButtons } from '../../utils/components.js';
import { logger } from '../../utils/logger.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
import { t } from '../../i18n/index.js';
export default {
    slashOnly: true,
    data: new SlashCommandBuilder()
        .setName('wipedata')
        .setDescription('Delete all your personal data from the bot (irreversible)'),

    async execute(interaction, guildConfig, client) {
        const warningMessage = 
            t`⚠️ **THIS ACTION IS IRREVERSIBLE!** ⚠️\n\n` +
            t`This will permanently delete **ALL** your data from this server including:\n` +
            t`• 💰 Economy balance (wallet & bank)\n` +
            t`• 📊 Levels and XP\n` +
            t`• 🎒 Inventory items\n` +
            t`• 🛍️ Shop purchases\n` +
            t`• 🎂 Birthday information\n` +
            t`• 🔢 Counter data\n` +
            t`• 📋 All other personal data\n\n` +
            t`**This cannot be undone. Are you absolutely sure?**`;

        const embed = warningEmbed(t('Wipe All Data'), warningMessage);

        const confirmButtons = getConfirmationButtons('wipedata');

        await InteractionHelper.safeReply(interaction, {
            embeds: [embed],
            components: [confirmButtons],
            flags: MessageFlags.Ephemeral
        });

        logger.info(`Wipedata command executed - confirmation prompt shown`, {
            userId: interaction.user.id,
            guildId: interaction.guildId
        });
    }
};