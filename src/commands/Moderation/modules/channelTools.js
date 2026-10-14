// channelTools.js — members of the /channel group: slowmode, sticky, unsticky, nuke, lockdown.

import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ComponentType,
    MessageFlags,
    PermissionFlagsBits,
    SlashCommandBuilder,
} from 'discord.js';
import { createEmbed, successEmbed, warningEmbed } from '../../../utils/embeds.js';
import { humanDuration, parseDuration, respond, requireBotPermission, requireGuild, userError } from '../../../utils/featureKit.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { removeSticky, setSticky } from '../../../services/tagService.js';
import { endLockdown, getLockdown, startLockdown } from '../../../services/moderation/tempbanService.js';
import { t } from '../../../i18n/index.js';

export const slowmode = {
    data: new SlashCommandBuilder()
        .setName('slowmode')
        .setDescription('Set how often members can write in this channel')
        .addStringOption((option) => option.setName('time').setDescription('For example 5s, 30s, 2m, 1h — or 0 to turn it off').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    category: 'moderation',

    async execute(interaction) {
        const guild = requireGuild(interaction);
        const raw = interaction.options.getString('time').trim().toLowerCase();
        const off = ['0', 'off', '0s'].includes(raw);
        const ms = off ? 0 : parseDuration(/^\d+$/.test(raw) ? `${raw}s` : raw);
        if (ms === null || ms > 6 * 60 * 60 * 1000) {
            throw userError(t('Give a time between 1 second and 6 hours, for example `10s` or `2m`. Use `0` to turn slowmode off.'));
        }
        requireBotPermission(guild, PermissionFlagsBits.ManageChannels, interaction.channel);
        await interaction.channel.setRateLimitPerUser(Math.round(ms / 1000), `Slowmode set by ${interaction.user.tag}`);
        return respond(interaction, successEmbed(
            ms === 0
                ? t`🐇 Slowmode is off in ${interaction.channel}.`
                : t`🐢 Slowmode in ${interaction.channel}: one message every **${humanDuration(ms)}**.`,
        ));
    },
};

export const sticky = {
    data: new SlashCommandBuilder()
        .setName('sticky')
        .setDescription('Keep a message at the bottom of this channel')
        .addStringOption((option) => option.setName('text').setDescription('The message (use \\n for a new line)').setRequired(true).setMaxLength(1500))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    category: 'moderation',
    slashOnly: true,

    async execute(interaction) {
        const guild = requireGuild(interaction);
        requireBotPermission(guild, [PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ManageMessages], interaction.channel);
        await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        await setSticky(interaction.channel, interaction.options.getString('text').replace(/\\n/g, '\n'));
        return respond(interaction, successEmbed(t('📌 The message will stay at the bottom of this channel. Remove it with `/channel odepnij`.')));
    },
};

export const unsticky = {
    data: new SlashCommandBuilder()
        .setName('unsticky')
        .setDescription('Remove the message kept at the bottom of this channel')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    category: 'moderation',

    async execute(interaction) {
        requireGuild(interaction);
        if (!await removeSticky(interaction.channel)) {
            throw userError(t('This channel has no sticky message.'));
        }
        return respond(interaction, successEmbed(t('The sticky message was removed.')), { ephemeral: true });
    },
};

export const nuke = {
    data: new SlashCommandBuilder()
        .setName('nuke')
        .setDescription('Wipe this channel: replace it with an empty copy')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    category: 'moderation',
    slashOnly: true,
    abuseProtection: { enabled: true, maxAttempts: 1, windowMs: 60_000 },

    async execute(interaction) {
        const guild = requireGuild(interaction);
        const channel = interaction.channel;
        if (!channel?.isTextBased?.() || channel.isThread?.()) {
            throw userError(t('This only works in a regular text channel.'));
        }
        requireBotPermission(guild, PermissionFlagsBits.ManageChannels, channel);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('nuke_confirm').setLabel(t('Yes, wipe this channel')).setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('nuke_cancel').setLabel(t('Cancel')).setStyle(ButtonStyle.Secondary),
        );
        const prompt = await interaction.reply({
            embeds: [warningEmbed(
                t('Wipe this channel?'),
                t`Every message in ${channel} will be gone for good. The channel keeps its name, topic, position and permissions.`,
            )],
            components: [row],
            flags: MessageFlags.Ephemeral,
            withResponse: true,
        });
        const message = prompt?.resource?.message ?? await interaction.fetchReply();

        let click;
        try {
            click = await message.awaitMessageComponent({
                componentType: ComponentType.Button,
                time: 30_000,
                filter: (component) => component.user.id === interaction.user.id,
            });
        } catch {
            await interaction.editReply({ embeds: [createEmbed({ description: t('Cancelled — no answer.'), color: 'secondary', footer: false })], components: [] }).catch(() => {});
            return;
        }

        if (click.customId !== 'nuke_confirm') {
            await click.update({ embeds: [createEmbed({ description: t('Cancelled. Nothing was deleted.'), color: 'secondary', footer: false })], components: [] });
            return;
        }

        await click.update({ embeds: [createEmbed({ description: t('Wiping the channel…'), color: 'warning', footer: false })], components: [] });
        const copy = await channel.clone({ reason: `Channel wiped by ${interaction.user.tag}` });
        await copy.setPosition(channel.position).catch(() => {});
        await channel.delete(`Channel wiped by ${interaction.user.tag}`);
        await copy.send({
            embeds: [createEmbed({ description: t`💥 This channel was wiped by ${interaction.user}.`, color: 'warning', footer: false })],
            allowedMentions: { parse: [] },
        }).catch(() => {});
    },
};

export const lockdown = {
    data: new SlashCommandBuilder()
        .setName('lockdown')
        .setDescription('Lock or unlock every public text channel at once')
        .addBooleanOption((option) => option.setName('enabled').setDescription('Start (yes) or end (no) the lockdown').setRequired(true))
        .addStringOption((option) => option.setName('reason').setDescription('Why').setMaxLength(300))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    category: 'moderation',
    slashOnly: true,
    abuseProtection: { enabled: true, maxAttempts: 2, windowMs: 60_000 },

    async execute(interaction) {
        const guild = requireGuild(interaction);
        requireBotPermission(guild, [PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageRoles]);
        const enabled = interaction.options.getBoolean('enabled');
        const reason = interaction.options.getString('reason') || t('No reason provided');
        await InteractionHelper.safeDefer(interaction);

        if (enabled) {
            const result = await startLockdown(guild, interaction.member, reason);
            if (result.alreadyActive) {
                throw userError(t('A lockdown is already active. End it with `/channel lockdown enabled:False`.'));
            }
            return respond(interaction, warningEmbed(
                t('🔒 Server locked down'),
                [
                    t`**${result.channels.length}** {0|channel|channels} locked — members cannot write until the lockdown ends.`,
                    t`**Reason:** ${reason}`,
                    t('End it with `/channel lockdown enabled:False`.'),
                ].join('\n'),
            ));
        }

        const state = await getLockdown(guild.id);
        if (!state.active) throw userError(t('There is no active lockdown.'));
        const result = await endLockdown(guild, interaction.member);
        return respond(interaction, successEmbed(
            t('🔓 Lockdown ended'),
            t`**${result.channels.length}** {0|channel|channels} unlocked.`,
        ));
    },
};
