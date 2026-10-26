// /economy event start|stop|ustaw — timed economy events (services/economyEvents.js).

import { ChannelType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { createEmbed } from '../../../utils/embeds.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { requireBotPermission } from '../../../utils/featureKit.js';
import { getEconomySettings, updateEconomySettings } from '../../../services/economySettings.js';
import { EVENT_TYPES, MAX_EVENT_MINUTES, MIN_EVENT_MINUTES, endEvent, nextAutoTime, runningEvent, startEvent } from '../../../services/economyEvents.js';
import { t, tr } from '../../../i18n/index.js';

const DEFAULT_MINUTES = 60;

export function eventSubcommandGroup(group) {
    return group
        .setName('event')
        .setDescription('Timed economy events: double money, fishing frenzy, pack sale and more')
        .addSubcommand((sub) => sub
            .setName('start')
            .setDescription('Start an event now (ends the running one)')
            .addStringOption((option) => option
                .setName('typ')
                .setDescription('Which event')
                .setRequired(true)
                .addChoices(...EVENT_TYPES.map((type) => ({ name: type.name, value: type.id }))))
            .addIntegerOption((option) => option
                .setName('minuty')
                .setDescription('How long it lasts in minutes (default 60)')
                .setMinValue(MIN_EVENT_MINUTES)
                .setMaxValue(MAX_EVENT_MINUTES)))
        .addSubcommand((sub) => sub
            .setName('stop')
            .setDescription('End the running event now'))
        .addSubcommand((sub) => sub
            .setName('ustaw')
            .setDescription('Announcement channel, role ping and automatic events')
            .addChannelOption((option) => option
                .setName('kanal')
                .setDescription('Channel for event announcements (deleted when the event ends)')
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
            .addRoleOption((option) => option
                .setName('rola')
                .setDescription('Role pinged when an event starts'))
            .addBooleanOption((option) => option
                .setName('bez_pingu')
                .setDescription('Stop pinging a role'))
            .addBooleanOption((option) => option
                .setName('automatyczne')
                .setDescription('Start a random event by itself every few hours'))
            .addIntegerOption((option) => option
                .setName('co_ile_godzin')
                .setDescription('Automatic events: about every this many hours (1-168)')
                .setMinValue(1)
                .setMaxValue(168))
            .addIntegerOption((option) => option
                .setName('czas_minut')
                .setDescription('Automatic events: how long each lasts in minutes')
                .setMinValue(MIN_EVENT_MINUTES)
                .setMaxValue(MAX_EVENT_MINUTES)));
}

function statusEmbed(settings, notice = '') {
    const { events } = settings;
    const running = runningEvent(settings);
    const lines = [
        notice,
        running
            ? t`🎉 Running: **${running.emoji} ${tr(running.name)}**, ends <t:${Math.floor(events.active.endsAt / 1000)}:R>.`
            : t('No event is running.'),
        events.channelId ? t`📢 Announcements: <#${events.channelId}>` : t('📢 Announcements: no channel (set one with `/economy event ustaw kanal`).'),
        events.roleId ? t`🔔 Ping: <@&${events.roleId}>` : t('🔔 Ping: nobody'),
        events.auto
            ? t`🔁 Automatic: about every **${events.everyHours} h**, **${events.durationMinutes} min** each${events.nextAutoAt > Date.now() ? t`, next <t:${Math.floor(events.nextAutoAt / 1000)}:R>` : ''}.`
            : t('🔁 Automatic events: off'),
    ].filter(Boolean);
    return createEmbed({ title: t('🎉 Economy events'), description: lines.join('\n'), color: '#F1C40F', footer: false });
}

export async function runEventCommand(interaction) {
    const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
    if (!deferred) return;
    const guild = interaction.guild;
    const sub = interaction.options.getSubcommand();

    if (sub === 'start') {
        const settings = await startEvent(guild, interaction.options.getString('typ'), interaction.options.getInteger('minuty') ?? DEFAULT_MINUTES);
        const posted = settings.events.active?.messageId;
        const notice = settings.events.channelId && !posted ? t('⚠️ The announcement could not be posted - check the bot\'s permissions in the channel.') : '';
        return InteractionHelper.safeEditReply(interaction, { embeds: [statusEmbed(settings, notice)] });
    }
    if (sub === 'stop') {
        const ended = await endEvent(guild);
        const notice = ended ? t`⏹️ **${ended.emoji} ${tr(ended.name)}** ended.` : '';
        return InteractionHelper.safeEditReply(interaction, { embeds: [statusEmbed(await getEconomySettings(guild.id), notice)] });
    }

    const channel = interaction.options.getChannel('kanal');
    if (channel) requireBotPermission(guild, [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks], channel);
    const role = interaction.options.getRole('rola');
    const noPing = interaction.options.getBoolean('bez_pingu');
    const auto = interaction.options.getBoolean('automatyczne');
    const everyHours = interaction.options.getInteger('co_ile_godzin');
    const durationMinutes = interaction.options.getInteger('czas_minut');
    const settings = await updateEconomySettings(guild.id, (data) => {
        if (channel) data.events.channelId = channel.id;
        if (role) data.events.roleId = role.id;
        if (noPing) data.events.roleId = null;
        if (everyHours) data.events.everyHours = everyHours;
        if (durationMinutes) data.events.durationMinutes = durationMinutes;
        if (auto !== null) {
            if (auto && !data.events.auto) data.events.nextAutoAt = nextAutoTime(data.events);
            data.events.auto = auto;
        }
    });
    return InteractionHelper.safeEditReply(interaction, { embeds: [statusEmbed(settings, t('✅ Saved.'))] });
}
