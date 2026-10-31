import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getEconomySettings } from '../../services/economySettings.js';
import { buildRemindersView, getReminders } from '../../services/reminders.js';

// /przypomnienia — a DM when /daily, /work and the like are ready (2026-11-01). Rules: services/reminders.js.

export default {
    data: new SlashCommandBuilder()
        .setName('przypomnienia')
        .setDescription('Get a DM when your daily, jobs or rent are ready')
        .setDMPermission(false),

    execute: withErrorHandling(async (interaction) => {
        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;
        const { guildId, user } = interaction;
        const settings = await getEconomySettings(guildId);
        const entry = (await getReminders(guildId)).members?.[user.id];
        await InteractionHelper.safeEditReply(interaction, buildRemindersView({ guildId, ownerId: user.id, entry, enabled: settings.reminders?.enabled !== false }));
    }, { command: 'przypomnienia' })
};
