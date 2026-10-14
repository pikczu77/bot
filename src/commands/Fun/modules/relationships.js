// Messages and button logic of /randka and /slub. The commands build the first message;
// the buttons are routed here from src/interactions/buttons/fun/.
//
//   randka:tak|nie:<inviterId>:<targetId>:<placeId>:<time>   date invitation
//   slub:tak|nie:<proposerId>:<targetId>:<time>              marriage proposal
//   slub:rozwod|anuluj:<userId>:<time>                       divorce confirmation
// <time> is Date.now() in base 36; the message stops working after the TTL.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { createEmbed, formatDuration, formatProgressBar } from '../../../utils/embeds.js';
import { getEconomyData, setEconomyData, splitJointBank } from '../../../utils/economy.js';
import { getEconomySettings, money } from '../../../services/economySettings.js';
import { spendMoney, withEconomyLock } from '../../../services/economyUpgrades.js';
import {
    DATE_COOLDOWN_MS,
    DATE_INVITE_TTL_MS,
    MARRIED_DATE_BONUS,
    PROPOSAL_TTL_MS,
    dateCooldownLeft,
    divorce,
    getDatePlace,
    getPair,
    getSpouse,
    getSpouseId,
    marry,
    recordDate,
    relationshipLevel,
    rollDate,
    withDateLock,
} from '../../../services/marriageService.js';
import { loveScore } from '../ship.js';
import { t, tr } from '../../../i18n/index.js';

const mention = (id) => `<@${id}>`;
const stamp = (ms, style = 'R') => `<t:${Math.floor(ms / 1000)}:${style}>`;
const encodeTime = (ms) => Math.floor(ms).toString(36);
const decodeTime = (text) => parseInt(text, 36) || 0;

function ephemeral(interaction, text) {
    return interaction.reply({
        embeds: [createEmbed({ description: text, color: 'warning', footer: false })],
        flags: MessageFlags.Ephemeral,
    });
}

/** Closed message: same look, no buttons, a short note instead. */
function closed(interaction, text, color = 'gray') {
    return interaction.update({
        content: '',
        embeds: [createEmbed({ description: text, color, footer: false })],
        components: [],
        allowedMentions: { parse: [] },
    });
}

function levelLine(hearts) {
    const level = relationshipLevel(hearts);
    const next = level.next === null ? '' : `\n-# ${t`${level.next - hearts} more hearts to the next level`}`;
    return `${level.emoji} **${tr(level.name)}** · ❤️ ${hearts}${next}`;
}

// ---------------------------------------------------------------- dates

export async function buildDateInvite({ guildId, inviterId, targetId, place, now = Date.now() }) {
    await getEconomySettings(guildId);
    const pair = await getPair(guildId, inviterId, targetId);
    const married = (await getSpouseId(guildId, inviterId)) === targetId;
    const args = `${inviterId}:${targetId}:${place.id}:${encodeTime(now)}`;

    const lines = [
        t`${mention(inviterId)} asks ${mention(targetId)} out on a date: **${place.emoji} ${tr(place.name)}**`,
        place.price > 0 ? t`${mention(inviterId)} pays **${money(guildId, place.price)}**.` : t('It costs nothing.'),
        t`The invitation expires ${stamp(now + DATE_INVITE_TTL_MS)}.`,
    ];
    if (pair.dates > 0) {
        lines.push('', t`Dates together so far: **${pair.dates}**`, levelLine(pair.hearts));
    }
    if (married) lines.push('', t`💍 Married couple: +${MARRIED_DATE_BONUS} to the date.`);

    return {
        content: mention(targetId),
        embeds: [createEmbed({ title: t('💌 Date invitation'), description: lines.join('\n'), color: 'fuchsia', footer: false })],
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`randka:tak:${args}`).setLabel(t('Say yes')).setEmoji('💘').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`randka:nie:${args}`).setLabel(t('Not this time')).setStyle(ButtonStyle.Secondary),
            ),
        ],
        allowedMentions: { users: [targetId] },
    };
}

/** Settle an accepted date. Exported for tests. */
export function settleDate(client, guildId, inviterId, targetId, place, { random = Math.random, now = Date.now() } = {}) {
    return withDateLock(guildId, async () => {
        const before = await getPair(guildId, inviterId, targetId);
        const left = dateCooldownLeft(before, now);
        if (left > 0) return { ok: false, reason: 'cooldown', left };

        if (place.price > 0) {
            const paid = await withEconomyLock(guildId, inviterId, async () => {
                const data = await getEconomyData(client, guildId, inviterId);
                if (!spendMoney(data, place.price)) return false;
                return setEconomyData(client, guildId, inviterId, data);
            });
            if (!paid) return { ok: false, reason: 'money' };
        }

        const married = (await getSpouseId(guildId, inviterId)) === targetId;
        const roll = rollDate({ shipScore: loveScore(inviterId, targetId), place, married, random });
        const pair = await recordDate(guildId, inviterId, targetId, { score: roll.score, hearts: roll.tier.hearts }, now);
        return { ok: true, roll, pair, married };
    });
}

function dateResultEmbed(guildId, { inviterId, targetId, place, roll, pair, married }) {
    const bar = formatProgressBar(roll.score, 100, 12).replace(/ \d+%$/, '');
    const fields = [
        { name: t('Hearts'), value: t`+${roll.tier.hearts} (now ${pair.hearts})`, inline: true },
        { name: t('Relationship'), value: levelLine(pair.hearts), inline: true },
    ];
    if (place.price > 0) fields.push({ name: t('Paid'), value: `${mention(inviterId)} · ${money(guildId, place.price)}`, inline: true });

    const footer = [t`Dates together: ${pair.dates}`, t`next date in ${formatDuration(DATE_COOLDOWN_MS)}`];
    if (married) footer.push(t`💍 marriage bonus +${MARRIED_DATE_BONUS}`);

    return createEmbed({
        title: `${roll.tier.emoji} ${tr(roll.tier.title)}`,
        description: [
            `${mention(inviterId)} ❤️ ${mention(targetId)} · ${place.emoji} ${tr(place.name)}`,
            '',
            `*${tr(roll.line)}*`,
            '',
            `**${roll.score}%** ${bar}`,
        ].join('\n'),
        color: roll.tier.hearts >= 3 ? 'fuchsia' : roll.tier.hearts > 0 ? 'warning' : 'gray',
        fields,
        footer: footer.join(' · '),
    });
}

export async function handleDateButton(interaction, client, args = []) {
    const [action, inviterId, targetId, placeId, time] = args;
    const { guildId, user } = interaction;
    const place = getDatePlace(placeId);

    if (!place || !inviterId || !targetId) return closed(interaction, t('This invitation does not work any more.'));
    if (user.id !== inviterId && user.id !== targetId) return ephemeral(interaction, t('This invitation is not for you.'));

    if (action === 'nie') {
        return closed(interaction, user.id === inviterId
            ? t`💔 ${mention(inviterId)} took the date invitation back.`
            : t`💔 ${mention(targetId)} says no to the date with ${mention(inviterId)}. Maybe next time.`);
    }

    if (Date.now() - decodeTime(time) > DATE_INVITE_TTL_MS) {
        return closed(interaction, t`⌛ The date invitation from ${mention(inviterId)} has expired.`);
    }
    if (user.id !== targetId) return ephemeral(interaction, t`Only ${mention(targetId)} can accept this date.`);

    await getEconomySettings(guildId);
    const result = await settleDate(client, guildId, inviterId, targetId, place);
    if (!result.ok && result.reason === 'cooldown') {
        return closed(interaction, t`⏳ You were on a date not long ago. Next date in **${formatDuration(result.left)}**.`);
    }
    if (!result.ok) {
        return closed(interaction, t`💸 ${mention(inviterId)} cannot pay **${money(guildId, place.price)}** for this date any more (cash and bank).`);
    }

    return interaction.update({
        content: '',
        embeds: [dateResultEmbed(guildId, { inviterId, targetId, place, ...result })],
        components: [],
        allowedMentions: { parse: [] },
    });
}

// ---------------------------------------------------------------- marriage

export async function buildProposal({ guildId, proposerId, targetId, now = Date.now() }) {
    const pair = await getPair(guildId, proposerId, targetId);
    const args = `${proposerId}:${targetId}:${encodeTime(now)}`;
    const lines = [
        t`${mention(proposerId)} proposes to ${mention(targetId)}! 💍`,
        '',
        t('After the wedding you share one bank: each of you keeps their own account, both of you can use the money on both, and `/rob` takes from the whole joint bank. A divorce splits the joint bank in half.'),
        '',
        t`The proposal expires ${stamp(now + PROPOSAL_TTL_MS)}.`,
    ];
    if (pair.dates > 0) lines.push(t`Dates together: **${pair.dates}** · ${levelLine(pair.hearts)}`);

    return {
        content: mention(targetId),
        embeds: [createEmbed({ title: t('💍 Marriage proposal'), description: lines.join('\n'), color: 'fuchsia', footer: false })],
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`slub:tak:${args}`).setLabel(t('Yes, I do')).setEmoji('💍').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId(`slub:nie:${args}`).setLabel(t('Turn it down')).setStyle(ButtonStyle.Secondary),
            ),
        ],
        allowedMentions: { users: [targetId] },
    };
}

export async function buildDivorceConfirm({ client, guildId, userId, now = Date.now() }) {
    await getEconomySettings(guildId);
    const data = await getEconomyData(client, guildId, userId);
    const joint = data._joint;
    const total = data.bank || 0;
    const half = Math.floor(total / 2);
    const lines = [
        t`Do you really want a divorce from ${mention(joint?.partnerId ?? '0')}?`,
        '',
        t`The joint bank (**${money(guildId, total)}**) is split in half. Each of you gets:`,
        `${mention(userId)}: **${money(guildId, half)}**`,
        `${mention(joint?.partnerId ?? '0')}: **${money(guildId, total - half)}**`,
    ];
    const args = `${userId}:${encodeTime(now)}`;
    return {
        embeds: [createEmbed({ title: t('💔 Divorce'), description: lines.join('\n'), color: 'warning', footer: false })],
        components: [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`slub:rozwod:${args}`).setLabel(t('Divorce')).setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId(`slub:anuluj:${args}`).setLabel(t('Cancel')).setStyle(ButtonStyle.Secondary),
            ),
        ],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
    };
}

export async function buildMarriageInfo({ client, guildId, userId, viewerId }) {
    await getEconomySettings(guildId);
    const spouse = await getSpouse(guildId, userId);
    if (!spouse) {
        const lines = [t`${mention(userId)} is not married.`];
        if (userId === viewerId) lines.push('', t('Propose with `/slub oswiadcz`. Go on a few dates first with `/randka`.'));
        return { embeds: [createEmbed({ title: t('💍 Marriage'), description: lines.join('\n'), color: 'gray', footer: false })] };
    }

    const data = await getEconomyData(client, guildId, userId);
    const joint = data._joint ?? { ownBank: data.bank || 0, partnerBank: 0 };
    const pair = await getPair(guildId, userId, spouse.partnerId);
    const days = Math.max(0, Math.floor((Date.now() - spouse.since) / 86_400_000));

    return {
        embeds: [createEmbed({
            title: t('💒 Marriage'),
            description: t`${mention(userId)} ❤️ ${mention(spouse.partnerId)}`,
            color: 'fuchsia',
            fields: [
                { name: t('Married since'), value: `${stamp(spouse.since, 'D')} (${t`${days} days`})`, inline: true },
                { name: t('Joint bank'), value: `🏦 **${money(guildId, data.bank || 0)}**`, inline: true },
                {
                    name: t('Accounts'),
                    value: `${mention(userId)}: ${money(guildId, joint.ownBank)}\n${mention(spouse.partnerId)}: ${money(guildId, joint.partnerBank)}`,
                    inline: false,
                },
                { name: t('Dates together'), value: `${pair.dates}`, inline: true },
                { name: t('Relationship'), value: levelLine(pair.hearts), inline: true },
            ],
            footer: false,
        })],
        allowedMentions: { parse: [] },
    };
}

export async function handleMarriageButton(interaction, client, args = []) {
    const [action, firstId, secondId, time] = args;
    const { guildId, user } = interaction;

    if (action === 'rozwod' || action === 'anuluj') {
        const userId = firstId;
        if (user.id !== userId) return ephemeral(interaction, t('This button is not for you.'));
        if (action === 'anuluj') return closed(interaction, t('No divorce. 💞'));
        if (Date.now() - decodeTime(secondId) > PROPOSAL_TTL_MS) return closed(interaction, t('⌛ This confirmation has expired. Use `/slub rozwod` again.'));

        const result = await divorce(guildId, userId);
        if (!result.ok) return closed(interaction, t('You are not married.'));
        await getEconomySettings(guildId);
        const split = await splitJointBank(client, guildId, userId, result.partnerId);
        await closed(interaction, t`💔 You are divorced from ${mention(result.partnerId)}.`);
        await interaction.followUp?.({
            embeds: [createEmbed({
                title: t('💔 Divorce'),
                description: [
                    t`${mention(userId)} and ${mention(result.partnerId)} are not married any more. The joint bank was split in half:`,
                    `${mention(userId)}: **${money(guildId, split.first)}**`,
                    `${mention(result.partnerId)}: **${money(guildId, split.second)}**`,
                ].join('\n'),
                color: 'gray',
                footer: false,
            })],
            allowedMentions: { parse: [] },
        }).catch(() => null);
        return;
    }

    const proposerId = firstId;
    const targetId = secondId;
    if (!proposerId || !targetId) return closed(interaction, t('This proposal does not work any more.'));
    if (user.id !== proposerId && user.id !== targetId) return ephemeral(interaction, t('This proposal is not for you.'));

    if (action === 'nie') {
        return closed(interaction, user.id === proposerId
            ? t`${mention(proposerId)} took the proposal back.`
            : t`💔 ${mention(targetId)} turned down the proposal of ${mention(proposerId)}.`);
    }
    if (Date.now() - decodeTime(time) > PROPOSAL_TTL_MS) {
        return closed(interaction, t`⌛ The proposal of ${mention(proposerId)} has expired.`);
    }
    if (user.id !== targetId) return ephemeral(interaction, t`Only ${mention(targetId)} can answer this proposal.`);

    const result = await marry(guildId, proposerId, targetId);
    if (!result.ok) {
        const who = result.reason === 'married' ? proposerId : targetId;
        return closed(interaction, t`${mention(who)} is already married to ${mention(result.partnerId ?? '0')}.`);
    }

    await getEconomySettings(guildId);
    const data = await getEconomyData(client, guildId, proposerId);
    return interaction.update({
        content: '',
        embeds: [createEmbed({
            title: t('💒 Just married!'),
            description: [
                t`${mention(proposerId)} and ${mention(targetId)} are now married! 🎉`,
                '',
                t`From now on they share one bank: **${money(guildId, data.bank || 0)}** together. Each keeps their own account, both can use the money on both.`,
            ].join('\n'),
            color: 'fuchsia',
            footer: false,
        })],
        components: [],
        allowedMentions: { parse: [] },
    });
}
