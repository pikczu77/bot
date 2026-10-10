// modTools.js — members of the /mod group: tempban, softban, nick, history.

import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { createEmbed, successEmbed } from '../../../utils/embeds.js';
import { fullTime, humanDuration, relativeTime, requireDuration, requireGuild, respond, truncate, userError } from '../../../utils/featureKit.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { ModerationService } from '../../../services/moderation/moderationService.js';
import { getTempbans, scheduleUnban } from '../../../services/moderation/tempbanService.js';
import { getModerationCases } from '../../../utils/moderation.js';
import { t } from '../../../i18n/index.js';

function assertNotSelfOrBot(interaction, user, client) {
    if (user.id === interaction.user.id) throw userError(t('You cannot use this on yourself.'));
    if (user.id === client.user.id) throw userError(t('You cannot use this on the bot.'));
}

export const tempban = {
    data: new SlashCommandBuilder()
        .setName('tempban')
        .setDescription('Ban a member for a set time')
        .addUserOption((option) => option.setName('target').setDescription('Member to ban').setRequired(true))
        .addStringOption((option) => option.setName('duration').setDescription('For example 12h, 3d, 2w').setRequired(true))
        .addStringOption((option) => option.setName('reason').setDescription('Reason for the ban').setMaxLength(400))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    category: 'moderation',

    async execute(interaction, config, client) {
        const guild = requireGuild(interaction);
        const user = interaction.options.getUser('target');
        assertNotSelfOrBot(interaction, user, client);
        const ms = requireDuration(interaction.options.getString('duration'), { min: 60_000, max: 365 * 86_400_000 });
        const reason = interaction.options.getString('reason') || t('No reason provided');
        await InteractionHelper.safeDefer(interaction);

        const until = Date.now() + ms;
        const result = await ModerationService.banUser({
            guild,
            user,
            moderator: interaction.member,
            reason: `${reason} (${humanDuration(ms)})`,
        });
        await scheduleUnban(guild.id, { userId: user.id, until, moderatorId: interaction.user.id, reason });

        return respond(interaction, successEmbed(
            t`⏳ **Banned** ${user.tag} for ${humanDuration(ms)}`,
            [
                t`**Reason:** ${reason}`,
                t`**Unban:** ${fullTime(until)} (${relativeTime(until)})`,
                t`**Case ID:** #${result.caseId}`,
            ].join('\n'),
        ));
    },
};

export const softban = {
    data: new SlashCommandBuilder()
        .setName('softban')
        .setDescription('Kick a member and delete their recent messages (ban + instant unban)')
        .addUserOption((option) => option.setName('target').setDescription('Member to softban').setRequired(true))
        .addIntegerOption((option) => option.setName('days').setDescription('Delete messages from this many days (default 1)').setMinValue(1).setMaxValue(7))
        .addStringOption((option) => option.setName('reason').setDescription('Reason').setMaxLength(400))
        .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),
    category: 'moderation',

    async execute(interaction, config, client) {
        const guild = requireGuild(interaction);
        const user = interaction.options.getUser('target');
        assertNotSelfOrBot(interaction, user, client);
        const days = interaction.options.getInteger('days') ?? 1;
        const reason = interaction.options.getString('reason') || t('No reason provided');

        const member = await guild.members.fetch(user.id).catch(() => null);
        if (!member) throw userError(t('The target user is not currently in this server.'));
        ModerationService.assertModerationHierarchy(interaction.member, member, 'ban');
        if (!member.bannable) throw userError(t('I cannot ban this member. Check my role position and permissions.'));
        await InteractionHelper.safeDefer(interaction);

        await guild.members.ban(user.id, { deleteMessageSeconds: days * 86_400, reason: `Softban by ${interaction.user.tag}: ${reason}` });
        await guild.members.unban(user.id, 'Softban').catch(() => {});

        return respond(interaction, successEmbed(
            t`🧹 **Softbanned** ${user.tag}`,
            [
                t`**Reason:** ${reason}`,
                t`Messages from the last ${days} {0|day|days} were deleted. They can rejoin with an invite.`,
            ].join('\n'),
        ));
    },
};

export const nick = {
    data: new SlashCommandBuilder()
        .setName('nick')
        .setDescription("Change or reset a member's nickname")
        .addUserOption((option) => option.setName('target').setDescription('Member').setRequired(true))
        .addStringOption((option) => option.setName('nickname').setDescription('New nickname (leave empty to reset)').setMaxLength(32))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames),
    category: 'moderation',

    async execute(interaction) {
        const guild = requireGuild(interaction);
        const user = interaction.options.getUser('target');
        const nickname = interaction.options.getString('nickname')?.trim() || null;
        const member = await guild.members.fetch(user.id).catch(() => null);
        if (!member) throw userError(t('The target user is not currently in this server.'));
        if (!member.manageable) throw userError(t('I cannot change the nickname of this member. Their role is above mine or they own the server.'));

        const before = member.displayName;
        await member.setNickname(nickname, `Nickname changed by ${interaction.user.tag}`);
        return respond(interaction, successEmbed(
            nickname
                ? t`✏️ Nickname changed: **${before}** ➜ **${nickname}**`
                : t`✏️ Nickname of **${before}** was reset.`,
        ));
    },
};

export const history = {
    data: new SlashCommandBuilder()
        .setName('history')
        .setDescription('Everything the moderation team has on a member')
        .addUserOption((option) => option.setName('target').setDescription('Member').setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
    category: 'moderation',

    async execute(interaction, config, client) {
        const guild = requireGuild(interaction);
        const user = interaction.options.getUser('target');
        await InteractionHelper.safeDefer(interaction);

        const [{ WarningService }, cases, tempbans] = await Promise.all([
            import('../../../services/moderation/warningService.js').then((module) => ({ WarningService: module.WarningService ?? module.default })),
            getModerationCases(guild.id, { userId: user.id, limit: 50 }).catch(() => []),
            getTempbans(guild.id),
        ]);
        const warnings = await WarningService.getWarnings(guild.id, user.id).catch(() => []);
        const member = await guild.members.fetch(user.id).catch(() => null);
        const activeBan = tempbans.find((entry) => entry.userId === user.id);
        const caseList = Array.isArray(cases) ? cases : (cases?.cases ?? []);

        const lines = [
            t`**Account created:** ${relativeTime(user.createdTimestamp)}`,
            member?.joinedTimestamp ? t`**Joined the server:** ${relativeTime(member.joinedTimestamp)}` : t('**Not on the server.**'),
            member?.communicationDisabledUntilTimestamp > Date.now() ? t`**Timed out until:** ${fullTime(member.communicationDisabledUntilTimestamp)}` : null,
            activeBan ? t`**Temporary ban until:** ${fullTime(activeBan.until)}` : null,
        ].filter(Boolean);

        const fields = [
            {
                name: t`⚠️ Warnings (${warnings.length})`,
                value: warnings.length > 0
                    ? truncate(warnings.slice(-5).reverse().map((warning) => `• ${truncate(warning.reason ?? '—', 80)} — ${relativeTime(warning.timestamp)}`).join('\n'), 1024)
                    : t('None'),
            },
            {
                name: t`📁 Cases (${caseList.length})`,
                value: caseList.length > 0
                    ? truncate(caseList.slice(0, 6).map((entry) => `• **#${entry.caseId ?? entry.id ?? '?'}** ${entry.action ?? ''} — ${truncate(entry.reason ?? '—', 60)}`).join('\n'), 1024)
                    : t('None'),
            },
        ];

        return respond(interaction, createEmbed({
            author: { name: user.tag, iconURL: user.displayAvatarURL() },
            title: t('🗂️ Moderation history'),
            description: lines.join('\n'),
            fields,
            color: warnings.length + caseList.length > 0 ? 'warning' : 'success',
            footer: `ID: ${user.id}`,
        }), { ephemeral: true });
    },
};
