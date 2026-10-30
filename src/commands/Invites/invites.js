import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { createEmbed, successEmbed, infoEmbed, formatProgressBar } from '../../utils/embeds.js';
import { respond, requireGuild, requirePermission, userError } from '../../utils/featureKit.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import {
    addBonusInvites,
    applyInviteRewards,
    cacheGuildInvites,
    getInviteConfig,
    getInviteLeaderboard,
    getInviteStats,
    resetInvites,
    updateInviteConfig,
} from '../../services/inviteService.js';
import { t } from '../../i18n/index.js';

const MEDALS = ['🥇', '🥈', '🥉'];
const ADMIN_SUBCOMMANDS = new Set(['bonus', 'reset', 'nagroda-dodaj', 'nagroda-usun', 'synchronizuj']);

function nextReward(rewards, total) {
    return [...rewards].sort((a, b) => a.invites - b.invites).find((reward) => reward.invites > total) ?? null;
}

export default {
    data: new SlashCommandBuilder()
        .setName('zaproszenia')
        .setDescription('Invite tracking: who invited whom, leaderboard and rewards')
        .addSubcommand((sub) =>
            sub
                .setName('show')
                .setDescription("Show your or someone else's invites")
                .addUserOption((option) => option.setName('user').setDescription('Member to check')),
        )
        .addSubcommand((sub) => sub.setName('top').setDescription('Top inviters on this server'))
        .addSubcommand((sub) => sub.setName('nagrody').setDescription('Roles you can earn by inviting people'))
        .addSubcommand((sub) =>
            sub
                .setName('bonus')
                .setDescription('Add or take away bonus invites (admin)')
                .addUserOption((option) => option.setName('user').setDescription('Member').setRequired(true))
                .addIntegerOption((option) =>
                    option.setName('amount').setDescription('Use a negative number to take invites away').setRequired(true).setMinValue(-10000).setMaxValue(10000),
                ),
        )
        .addSubcommand((sub) =>
            sub
                .setName('reset')
                .setDescription('Reset invites of one member or of everyone (admin)')
                .addUserOption((option) => option.setName('user').setDescription('Leave empty to reset the whole server')),
        )
        .addSubcommand((sub) =>
            sub
                .setName('nagroda-dodaj')
                .setDescription('Give a role at a number of invites (admin)')
                .addIntegerOption((option) => option.setName('invites').setDescription('Invites needed').setRequired(true).setMinValue(1).setMaxValue(100000))
                .addRoleOption((option) => option.setName('role').setDescription('Role to give').setRequired(true)),
        )
        .addSubcommand((sub) =>
            sub
                .setName('nagroda-usun')
                .setDescription('Remove an invite reward (admin)')
                .addRoleOption((option) => option.setName('role').setDescription('Reward role').setRequired(true)),
        )
        .addSubcommand((sub) => sub.setName('synchronizuj').setDescription('Re-read all invites from Discord (admin)')),
    slashOnly: true,

    async execute(interaction) {
        const guild = requireGuild(interaction);
        const subcommand = interaction.options.getSubcommand();
        if (ADMIN_SUBCOMMANDS.has(subcommand)) requirePermission(interaction, PermissionFlagsBits.ManageGuild);
        const config = await getInviteConfig(guild.id);

        if (subcommand === 'show') {
            const user = interaction.options.getUser('user') || interaction.user;
            const stats = await getInviteStats(guild.id, user.id);
            const upcoming = nextReward(config.rewards, stats.total);
            const lines = [
                t`🎯 **${stats.total}** {0|invite|invites}`,
                '',
                t`✅ Joined and stayed: **${stats.regular}**`,
                t`🚪 Left: **${stats.left}**`,
                t`🤖 Fake (new accounts): **${stats.fake}**`,
                t`🎁 Bonus: **${stats.bonus}**`,
            ];
            if (upcoming) {
                lines.push('', t`**Next reward:** <@&${upcoming.roleId}> at ${upcoming.invites} invites`, formatProgressBar(stats.total, upcoming.invites, 12));
            }
            return respond(interaction, createEmbed({
                title: t`📨 Invites — ${user.displayName || user.username}`,
                description: lines.join('\n'),
                thumbnail: user.displayAvatarURL?.({ size: 256 }),
                footer: config.enabled ? false : t('Invite tracking is turned off on this server.'),
            }));
        }

        if (subcommand === 'top') {
            const board = await getInviteLeaderboard(guild.id);
            if (board.length === 0) {
                return respond(interaction, infoEmbed(t('Nobody has invited anyone yet.')));
            }
            const position = board.findIndex((entry) => entry.userId === interaction.user.id);
            return respond(interaction, createEmbed({
                title: t('🏆 Top inviters'),
                description: board.slice(0, 15).map((entry, index) =>
                    `${MEDALS[index] ?? `**${index + 1}.**`} <@${entry.userId}> — **${entry.total}** (✅ ${entry.regular} · 🚪 ${entry.left} · 🎁 ${entry.bonus})`,
                ).join('\n'),
                footer: position === -1 ? false : t`Your place: #${position + 1}`,
            }));
        }

        if (subcommand === 'nagrody') {
            if (config.rewards.length === 0) {
                return respond(interaction, infoEmbed(t('No invite rewards are set up on this server.')));
            }
            return respond(interaction, createEmbed({
                title: t('🎖️ Invite rewards'),
                description: [...config.rewards]
                    .sort((a, b) => a.invites - b.invites)
                    .map((reward) => t`**${reward.invites}** invites ➜ <@&${reward.roleId}>`)
                    .join('\n'),
                footer: false,
            }));
        }

        if (subcommand === 'bonus') {
            const user = interaction.options.getUser('user');
            const amount = interaction.options.getInteger('amount');
            if (amount === 0) throw userError(t('The amount cannot be zero.'));
            const stats = await addBonusInvites(guild.id, user.id, amount);
            await applyInviteRewards(guild, user.id, stats.total);
            return respond(interaction, successEmbed(
                amount > 0 ? t`Added **${amount}** bonus invites to ${user}.` : t`Took **${Math.abs(amount)}** invites away from ${user}.`,
                t`They now have **${stats.total}** in total.`,
            ));
        }

        if (subcommand === 'reset') {
            const user = interaction.options.getUser('user');
            await resetInvites(guild.id, user?.id ?? null);
            return respond(interaction, successEmbed(
                user ? t`Invites of ${user} were reset.` : t('Invites of the whole server were reset.'),
            ));
        }

        if (subcommand === 'nagroda-dodaj') {
            const invites = interaction.options.getInteger('invites');
            const role = interaction.options.getRole('role');
            if (role.managed || role.id === guild.id) throw userError(t('That role cannot be given by the bot.'));
            if (!role.editable) throw userError(t`I cannot give ${role} — move my role above it in **Server Settings → Roles**.`);
            await updateInviteConfig(guild.id, (data) => {
                data.rewards = data.rewards.filter((reward) => reward.roleId !== role.id);
                if (data.rewards.length >= 20) throw userError(t('You can set up to 20 invite rewards.'));
                data.rewards.push({ invites, roleId: role.id });
            });
            return respond(interaction, successEmbed(t`${role} will be given at **${invites}** invites.`));
        }

        if (subcommand === 'nagroda-usun') {
            const role = interaction.options.getRole('role');
            let removed = false;
            await updateInviteConfig(guild.id, (data) => {
                const before = data.rewards.length;
                data.rewards = data.rewards.filter((reward) => reward.roleId !== role.id);
                removed = data.rewards.length !== before;
            });
            if (!removed) throw userError(t`${role} is not an invite reward.`);
            return respond(interaction, successEmbed(t`${role} is no longer an invite reward.`));
        }

        if (subcommand === 'synchronizuj') {
            await InteractionHelper.safeDefer(interaction);
            if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild)) {
                throw userError(t('I need the **Manage Server** permission to read invites.'));
            }
            const count = await cacheGuildInvites(guild);
            return respond(interaction, successEmbed(t`Re-read **${count}** invites from Discord.`));
        }

        throw userError(t('This subcommand is not recognised.'));
    },
};
