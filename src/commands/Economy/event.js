// /event sklep | kup | zbierz | ranking | lista — the holiday events (services/seasonalEvents.js).
// Owner 2026-10-29 picked "12,13" from my list: more events (New Year's Eve, Valentine's Day, Children's Day, summer holidays) and
// one command for all of them instead of /halloween, /swieta, /wielkanoc and the daily /cukierki, /pierniczki, /pisanki.
// Without `event` a subcommand uses the event that runs now, else the one whose shop is still open.

import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { userError } from '../../utils/featureKit.js';
import { getEconomyData } from '../../utils/economy.js';
import { getEconomySettings, money, scaleEarnings } from '../../services/economySettings.js';
import {
    QUESTION_FACTOR, SEASONAL_EVENTS, SHOP_GRACE_MS, amountOf, buySeasonItem, claimSeasonDaily, eventOf, getSeason, getSeasonEvent, nextSeason,
    openSeason, seasonActive, seasonRanking, seasonShop, shopOpen,
} from '../../services/seasonalEvents.js';
import { dayKey, midnightOf } from '../../utils/warsawTime.js';
import { progressEmbeds } from '../../services/progress.js';
import { t } from '../../i18n/index.js';

const ts = (ms, style = 'f') => `<t:${Math.floor(ms / 1000)}:${style}>`;

// The shop is the same for every event except the rank (its name and price belong to the event).
const ITEM_CHOICES = seasonShop(SEASONAL_EVENTS[0]).map((item) => ({
    name: item.role ? '👑 Event rank' : `${item.emoji} ${item.name} (${item.price})`,
    value: item.id,
}));
// Without the year: each server picks its own year in the panel.
const EVENT_CHOICES = SEASONAL_EVENTS.map((event) => ({ name: `${event.emoji} ${event.roleBase}`, value: event.id }));

/** The event a subcommand is about: the picked one, else the open one. Throws a user error when there is none. */
async function pickEvent(interaction) {
    const picked = interaction.options.getString('event');
    if (picked) {
        const settings = await getSeason(getSeasonEvent(picked), interaction.guildId);
        return { event: eventOf(getSeasonEvent(picked), settings), settings };
    }
    const open = await openSeason(interaction.guildId);
    if (open) return open;
    const next = await nextSeason(interaction.guildId);
    throw userError(next
        ? t`No event is running now. Next: ${next.event.emoji} **${next.event.texts.name()}** ${ts(next.settings.startsAt, 'R')}. All of them: \`/event lista\`.`
        : t('No event is running now. All of them: `/event lista`.'));
}

/** How to collect the currency of an event, from its settings. */
function earnLines(event, settings) {
    const cur = event.currency;
    const job = settings.jobMin === settings.jobMax ? settings.jobMin : `${settings.jobMin}-${settings.jobMax}`;
    return [
        t`💬 Message: **${settings.perMessage} ${cur}** (once every ${settings.cooldownSeconds} s)`,
        t`📅 \`/event zbierz\`: **${settings.dailyAmount} ${cur}** a day`,
        t`💼 Every job (\`/work\`, \`/fish\`, \`/nagraj\`, \`/beg\`, \`/slut\`, \`/crime\`): **${job} ${cur}**`,
        t`🎁 Chat drop: **${settings.dropCandies} ${cur}** · 🎮 quiz, Wordle: **${settings.gameCandies} ${cur}** · ❓ question of the day: **${settings.gameCandies * QUESTION_FACTOR} ${cur}**`,
        ...(event.dateReward ? [t`💞 Accepted \`/randka\`: **${event.dateReward} ${cur}** each (x2 for a married couple)`] : []),
    ];
}

async function shopEmbed(base, client, guildId, user, notice = '') {
    const settings = await getSeason(base, guildId);
    const event = eventOf(base, settings);
    const economy = await getEconomySettings(guildId);
    const { amount, earned } = amountOf(event, await getEconomyData(client, guildId, user.id, { joint: false }));
    const now = Date.now();
    const status = seasonActive(settings, now)
        ? t`${event.emoji} The event runs until ${ts(settings.endsAt)}.`
        : shopOpen(settings, now)
            ? t`${event.emoji} The event is over; the shop is open until ${ts(settings.endsAt + SHOP_GRACE_MS)}.`
            : now < settings.startsAt && settings.enabled
                ? t`${event.emoji} The event starts ${ts(settings.startsAt)}.`
                : t`${event.emoji} The event shop is closed.`;
    return createEmbed({
        title: event.texts.shop(),
        description: [
            notice,
            status,
            t`**You have:** ${amount} ${event.currency} (collected ${earned})`,
            '',
            ...seasonShop(event).map((item) => `${item.emoji} **${item.name}** · ${item.price} ${event.currency}`
                + (item.cash ? ` (${money(guildId, scaleEarnings(economy, item.cash))})` : '')),
            '',
            t('**How to collect:**'),
            ...earnLines(event, settings),
            '',
            t('-# Buy with `/event kup`. Event upgrades: `/ulepszenia`. Boosts also: `/boosty`.'),
        ].filter((line) => line !== null).join('\n'),
        color: event.color,
        footer: false,
    });
}

function listEmbed(rows, now = Date.now()) {
    const day = (ms) => ts(ms, 'd');
    return createEmbed({
        title: t('🎉 Server events'),
        description: rows.map(({ event, settings }) => {
            const status = !settings.enabled
                ? t('⚪ off')
                : seasonActive(settings, now)
                    ? t`🟢 now, until ${ts(settings.endsAt, 'R')}`
                    : now < settings.startsAt ? t`🕒 ${ts(settings.startsAt, 'R')}` : t('✔️ over');
            return `${event.emoji} **${event.texts.name()}** · ${event.currency} · ${day(settings.startsAt)} - ${day(settings.endsAt - 60_000)}\n${status}`;
        }).join('\n\n') + t('\n\n-# During an event: `/event sklep`, `/event zbierz` and `/event ranking`.'),
        color: '#FF7518',
        footer: false,
    });
}

export default {
    data: new SlashCommandBuilder()
        .setName('event')
        .setDescription('Holiday events: shop, daily collection and ranking')
        .addSubcommand((sub) => sub
            .setName('sklep')
            .setDescription('What you collected and what it buys')
            .addStringOption((option) => option.setName('event').setDescription('Which event (default: the one now)').addChoices(...EVENT_CHOICES)))
        .addSubcommand((sub) => sub
            .setName('kup')
            .setDescription('Buy something in the event shop')
            .addStringOption((option) => option.setName('przedmiot').setDescription('What').setRequired(true).addChoices(...ITEM_CHOICES))
            .addStringOption((option) => option.setName('event').setDescription('Which event (default: the one now)').addChoices(...EVENT_CHOICES)))
        .addSubcommand((sub) => sub
            .setName('zbierz')
            .setDescription('Collect the event currency of the day'))
        .addSubcommand((sub) => sub
            .setName('ranking')
            .setDescription('Who collected the most')
            .addStringOption((option) => option.setName('event').setDescription('Which event (default: the one now)').addChoices(...EVENT_CHOICES)))
        .addSubcommand((sub) => sub
            .setName('lista')
            .setDescription('Every event and its days')),

    execute: withErrorHandling(async (interaction, config, client) => {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        if (sub === 'lista') {
            const rows = [];
            for (const event of SEASONAL_EVENTS) {
                const settings = await getSeason(event, guildId);
                rows.push({ event: eventOf(event, settings), settings });
            }
            return InteractionHelper.safeEditReply(interaction, { embeds: [listEmbed(rows)] });
        }

        if (sub === 'zbierz') {
            const { event } = (await openSeason(guildId)) ?? await pickEvent(interaction);
            const { amount, total, married } = await claimSeasonDaily({ event, client, guildId, userId: interaction.user.id, userError });
            const tomorrow = midnightOf(dayKey(midnightOf(dayKey()) + 36 * 3_600_000));
            return InteractionHelper.safeEditReply(interaction, {
                embeds: [createEmbed({
                    title: `${event.emoji} ${event.texts.name()}`,
                    description: [
                        t`✅ You collected **+${amount} ${event.currency}**! You have **${total} ${event.currency}**.`,
                        married ? t`💍 Married: +${event.marriedDailyPercent}%.` : null,
                        t`Next ones ${ts(tomorrow, 'R')}. More for every message, job and won chat game.`,
                        t('-# Shop: `/event sklep` · event upgrades: `/ulepszenia`'),
                    ].filter(Boolean).join('\n'),
                    color: event.color,
                    footer: false,
                })],
            });
        }

        const { event } = await pickEvent(interaction);

        if (sub === 'kup') {
            const member = interaction.member ?? await interaction.guild.members.fetch(interaction.user.id);
            const { item, note, progress } = await buySeasonItem({
                event, client, guild: interaction.guild, member, itemId: interaction.options.getString('przedmiot'), userError,
            });
            const notice = t`✅ You bought ${item.emoji} **${item.name}** for ${item.price} ${event.currency}. ${note}`;
            return InteractionHelper.safeEditReply(interaction, {
                embeds: [await shopEmbed(event, client, guildId, interaction.user, notice), ...progressEmbeds(progress, guildId)],
                allowedMentions: { parse: [] },
            });
        }
        if (sub === 'ranking') {
            const top = await seasonRanking(event, guildId, 10);
            const medals = ['🥇', '🥈', '🥉'];
            return InteractionHelper.safeEditReply(interaction, {
                embeds: [createEmbed({
                    title: event.texts.ranking(),
                    description: top.length
                        ? top.map((row, index) => `${medals[index] ?? `**${index + 1}.**`} <@${row.userId}> · **${row.earned} ${event.currency}**`).join('\n')
                        : t('Nobody has collected anything yet. Write on the server!'),
                    color: event.color,
                    footer: false,
                })],
                allowedMentions: { parse: [] },
            });
        }
        return InteractionHelper.safeEditReply(interaction, { embeds: [await shopEmbed(event, client, guildId, interaction.user)] });
    }, { command: 'event' }),
};
