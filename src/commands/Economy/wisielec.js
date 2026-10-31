import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { requireBotPermission } from '../../utils/featureKit.js';
import { startGame } from '../../services/hangman.js';
import { t } from '../../i18n/index.js';

// /wisielec — hangman for money, everyone on the channel can play (2026-11-01). Rules: services/hangman.js.

export default {
    data: new SlashCommandBuilder()
        .setName('wisielec')
        .setDescription('Start hangman on this channel: whoever finishes the password wins money')
        .setDMPermission(false),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;
        const { guild, channel, user } = interaction;
        requireBotPermission(guild, [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks], channel);
        await startGame({ client, guild, channel, user });
        await InteractionHelper.safeEditReply(interaction, { content: t('🪢 The game has started. Pick the first letter!') });
    }, { command: 'wisielec' })
};
