import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { userError } from '../../utils/featureKit.js';
import { MAX_MONEY, getEconomySettings, money } from '../../services/economySettings.js';
import {
    CLUB_UPGRADES, WEEKLY_PRIZE_SHARES, clubChoices, clubLabel, clubOf, clubRanking, depositToClub, findClub, foundClub,
    getClubs, inviteToClub, kickMember, leaveClub, levelOf, memberLimit, transferClub, upgradeClub, weekPoints, withdrawFromClub,
} from '../../services/clubs.js';
import { progressEmbeds } from '../../services/progress.js';
import { nextWeekStart } from '../../utils/warsawTime.js';
import { t } from '../../i18n/index.js';

// /klub — clubs: a shared treasury, upgrades and a weekly ranking (2026-10-27). Rules: services/clubs.js.
// Invite buttons: interactions/buttons/economy/club.js (klub:tak|nie:<clubId>:<userId>).

const COLOR = '#0A84FF';
const MEDALS = ['🥇', '🥈', '🥉'];

function upgradeLines(guildId, club) {
    return CLUB_UPGRADES.map((upgrade) => {
        const level = levelOf(club, upgrade.id);
        const next = upgrade.prices[level];
        return t`${upgrade.emoji} **${upgrade.name}** ${level}/${upgrade.prices.length}: ${upgrade.effect(level)}`
            + (next ? t`\n-# next level ${money(guildId, next)}` : t('\n-# top level'));
    }).join('\n');
}

async function clubEmbed(client, guildId, club, notice = '') {
    const points = await weekPoints(client, guildId, club);
    const ranking = await clubRanking(client, guildId);
    const place = ranking.findIndex((row) => row.club.id === club.id) + 1;
    const members = points.members.map((member) => `${member.id === club.ownerId ? '👑' : '•'} <@${member.id}> · ${money(guildId, member.points)}`);
    return createEmbed({
        title: clubLabel(club),
        description: [
            notice,
            t`**Owner:** <@${club.ownerId}>`,
            t`**Treasury:** ${money(guildId, club.treasury || 0)}`,
            t`**This week:** ${money(guildId, points.total)} earned · place **${place}** of ${ranking.length}`,
        ].filter(Boolean).join('\n'),
        color: COLOR,
        fields: [
            { name: t`Members ${club.members.length}/${memberLimit(club)}`, value: members.join('\n').slice(0, 1024) || '-', inline: true },
            { name: t('⬆️ Upgrades'), value: upgradeLines(guildId, club), inline: true },
        ],
        footer: false,
    });
}

async function rankingEmbed(client, guildId) {
    const ranking = await clubRanking(client, guildId);
    const data = await getClubs(guildId);
    const settings = await getEconomySettings(guildId);
    const prizes = WEEKLY_PRIZE_SHARES.map((share) => money(guildId, Math.round(settings.commands.clubs.weeklyPrize * share)));
    const last = data.lastWeek?.ranking?.filter((row) => row.prize > 0) ?? [];
    return createEmbed({
        title: t('🏆 Club ranking of the week'),
        description: [
            ranking.length
                ? ranking.slice(0, 10).map((row, index) => `${MEDALS[index] ?? `**${index + 1}.**`} ${clubLabel(row.club)} · ${money(guildId, row.total)} · ${row.club.members.length} 👤`).join('\n')
                : t('No clubs yet. Found the first one with `/klub zaloz`.'),
            '',
            t`Points = money members earn from jobs this week. The week ends <t:${Math.floor(nextWeekStart() / 1000)}:R>.`,
            t`Prizes for the treasury: 🥇 ${prizes[0]} · 🥈 ${prizes[1]} · 🥉 ${prizes[2]} (times the server multiplier).`,
            last.length ? t`\nLast week: ${last.map((row, index) => `${MEDALS[index]} ${row.emoji} ${row.name}`).join(' · ')}` : null,
        ].filter((line) => line !== null).join('\n'),
        color: '#F1C40F',
        footer: false,
    });
}

export default {
    data: new SlashCommandBuilder()
        .setName('klub')
        .setDescription('Clubs: a shared treasury, upgrades and a weekly ranking')
        .addSubcommand((sub) => sub
            .setName('zaloz')
            .setDescription('Found a club')
            .addStringOption((option) => option.setName('nazwa').setDescription('Club name').setRequired(true).setMinLength(3).setMaxLength(24))
            .addStringOption((option) => option.setName('emoji').setDescription('One emoji for the club').setMaxLength(16)))
        .addSubcommand((sub) => sub
            .setName('info')
            .setDescription('Your club or another one')
            .addStringOption((option) => option.setName('nazwa').setDescription('Which club').setAutocomplete(true)))
        .addSubcommand((sub) => sub
            .setName('zapros')
            .setDescription('Invite someone to your club')
            .addUserOption((option) => option.setName('osoba').setDescription('Who').setRequired(true)))
        .addSubcommand((sub) => sub
            .setName('wplac')
            .setDescription('Put money into the club treasury')
            .addIntegerOption((option) => option.setName('kwota').setDescription('How much').setRequired(true).setMinValue(1).setMaxValue(MAX_MONEY)))
        .addSubcommand((sub) => sub
            .setName('wyplac')
            .setDescription('Pay money out of the treasury (owner)')
            .addIntegerOption((option) => option.setName('kwota').setDescription('How much').setRequired(true).setMinValue(1).setMaxValue(MAX_MONEY))
            .addUserOption((option) => option.setName('osoba').setDescription('To which member (default: you)')))
        .addSubcommand((sub) => sub
            .setName('ulepsz')
            .setDescription('Buy a club upgrade from the treasury (owner)')
            .addStringOption((option) => option.setName('co').setDescription('Upgrade').setRequired(true)
                .addChoices(...CLUB_UPGRADES.map((upgrade) => ({ name: `${upgrade.emoji} ${upgrade.name}`, value: upgrade.id })))))
        .addSubcommand((sub) => sub
            .setName('ranking')
            .setDescription('Clubs of the week and the prizes'))
        .addSubcommand((sub) => sub
            .setName('wyrzuc')
            .setDescription('Remove a member (owner)')
            .addUserOption((option) => option.setName('osoba').setDescription('Who').setRequired(true)))
        .addSubcommand((sub) => sub
            .setName('oddaj')
            .setDescription('Hand the club to another member (owner)')
            .addUserOption((option) => option.setName('osoba').setDescription('New owner').setRequired(true)))
        .addSubcommand((sub) => sub
            .setName('wyjdz')
            .setDescription('Leave your club (the last member closes it)')),

    async autocomplete(interaction) {
        const focused = interaction.options.getFocused(true);
        await interaction.respond(clubChoices(await getClubs(interaction.guildId), focused.value));
    },

    execute: withErrorHandling(async (interaction, config, client) => {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;
        const userId = interaction.user.id;
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;
        const reply = (payload) => InteractionHelper.safeEditReply(interaction, payload);

        if (sub === 'zaloz') {
            const { club, price, progress } = await foundClub({
                client, guildId, userId, name: interaction.options.getString('nazwa'), emoji: interaction.options.getString('emoji'), userError,
            });
            const notice = t`✅ You founded ${clubLabel(club)} for ${money(guildId, price)}. Invite friends with \`/klub zapros\`.`;
            return reply({ embeds: [await clubEmbed(client, guildId, club, notice), ...progressEmbeds(progress, guildId)] });
        }
        if (sub === 'info') {
            const data = await getClubs(guildId);
            const query = interaction.options.getString('nazwa');
            const club = query ? findClub(data, query) : clubOf(data, userId);
            if (!club) {
                throw userError(query ? t('There is no such club. See `/klub ranking`.') : t('You are not in a club. Found one with `/klub zaloz` or ask for an invite.'));
            }
            return reply({ embeds: [await clubEmbed(client, guildId, club)] });
        }
        if (sub === 'zapros') {
            const target = interaction.options.getUser('osoba');
            const { club, expiresAt } = await inviteToClub({ guildId, inviterId: userId, target, userError });
            return reply({
                content: `<@${target.id}>`,
                embeds: [createEmbed({
                    title: t`📨 Invite to ${clubLabel(club)}`,
                    description: t`**${interaction.user.username}** invites **${target.username}** to the club. Valid until <t:${Math.floor(expiresAt / 1000)}:f>.\n-# Members get the club's bonuses and earn points for the weekly ranking.`,
                    color: COLOR,
                    footer: false,
                })],
                components: [new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`klub:tak:${club.id}:${target.id}`).setLabel(t('Join')).setEmoji('✅').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId(`klub:nie:${club.id}:${target.id}`).setLabel(t('No thanks')).setStyle(ButtonStyle.Secondary),
                )],
                allowedMentions: { users: [target.id] },
            });
        }
        if (sub === 'wplac') {
            const { club, amount, progress } = await depositToClub({ client, guildId, userId, amount: interaction.options.getInteger('kwota'), userError });
            return reply({ embeds: [await clubEmbed(client, guildId, club, t`✅ You put **${money(guildId, amount)}** into the treasury.`), ...progressEmbeds(progress, guildId)] });
        }
        if (sub === 'wyplac') {
            const to = interaction.options.getUser('osoba');
            const { club, amount, toId } = await withdrawFromClub({ client, guildId, ownerId: userId, amount: interaction.options.getInteger('kwota'), toId: to?.id ?? null, userError });
            return reply({ embeds: [await clubEmbed(client, guildId, club, t`✅ **${money(guildId, amount)}** from the treasury went to <@${toId}>.`)] });
        }
        if (sub === 'ulepsz') {
            const { club, upgrade, level, price } = await upgradeClub({ client, guildId, ownerId: userId, upgradeId: interaction.options.getString('co'), userError });
            return reply({ embeds: [await clubEmbed(client, guildId, club, t`✅ ${upgrade.emoji} **${upgrade.name}** is now level ${level} (${money(guildId, price)} from the treasury): ${upgrade.effect(level)}.`)] });
        }
        if (sub === 'wyrzuc') {
            const target = interaction.options.getUser('osoba');
            const { club } = await kickMember({ client, guildId, ownerId: userId, targetId: target.id, userError });
            return reply({ embeds: [await clubEmbed(client, guildId, club, t`✅ <@${target.id}> is no longer in the club.`)] });
        }
        if (sub === 'oddaj') {
            const target = interaction.options.getUser('osoba');
            const { club } = await transferClub({ guildId, ownerId: userId, targetId: target.id, userError });
            return reply({ embeds: [await clubEmbed(client, guildId, club, t`👑 <@${target.id}> is the new owner.`)] });
        }
        if (sub === 'wyjdz') {
            const { club, closed, newOwnerId, refund } = await leaveClub({ client, guildId, userId, userError });
            const text = closed
                ? t`You were the last member: ${clubLabel(club)} is closed.` + (refund > 0 ? t` The treasury (${money(guildId, refund)}) went to your cash.` : '')
                : t`You left ${clubLabel(club)}.` + (newOwnerId ? t` <@${newOwnerId}> is the new owner.` : '');
            return reply({ embeds: [createEmbed({ title: t('🚪 Club'), description: text, color: COLOR, footer: false })] });
        }
        return reply({ embeds: [await rankingEmbed(client, guildId)] });
    }, { command: 'klub' })
};
