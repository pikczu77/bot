// season_command.js — the command of a holiday event: /halloween, /swieta, /wielkanoc (sklep | kup | ranking).
// One builder for all of them (2026-10-29); the rules are in services/seasonalEvents.js.

import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../../utils/embeds.js';
import { withErrorHandling } from '../../../utils/errorHandler.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { userError } from '../../../utils/featureKit.js';
import { getEconomyData } from '../../../utils/economy.js';
import { getEconomySettings, money, scaleEarnings } from '../../../services/economySettings.js';
import {
    SHOP_GRACE_MS, amountOf, buySeasonItem, claimSeasonDaily, getSeason, getSeasonEvent, seasonActive, seasonRanking, seasonShop, shopOpen,
} from '../../../services/seasonalEvents.js';
import { dayKey, midnightOf } from '../../../utils/warsawTime.js';
import { progressEmbeds } from '../../../services/progress.js';
import { t } from '../../../i18n/index.js';

const ts = (ms, style = 'f') => `<t:${Math.floor(ms / 1000)}:${style}>`;

async function shopEmbed(event, client, guildId, user, notice = '') {
    const settings = await getSeason(event, guildId);
    const economy = await getEconomySettings(guildId);
    const { amount, earned } = amountOf(event, await getEconomyData(client, guildId, user.id, { joint: false }));
    const now = Date.now();
    const status = seasonActive(settings, now)
        ? t`${event.emoji} The event runs until ${ts(settings.endsAt)}. Every message gives **${settings.perMessage} ${event.currency}** (once every ${settings.cooldownSeconds} s).`
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
            t`-# Buy with \`/${event.command} kup\`. Boosts also: \`/boosty\`.`,
        ].filter((line) => line !== null).join('\n'),
        color: event.color,
        footer: false,
    });
}

/** The daily collection of the event `eventId`: /cukierki, /pierniczki, /pisanki. */
export function seasonDailyCommand(eventId) {
    const event = getSeasonEvent(eventId);
    return {
        data: new SlashCommandBuilder()
            .setName(event.daily)
            .setDescription(event.dailyDescription),

        execute: withErrorHandling(async (interaction, config, client) => {
            const deferred = await InteractionHelper.safeDefer(interaction);
            if (!deferred) return;
            const { amount, total } = await claimSeasonDaily({ event, client, guildId: interaction.guildId, userId: interaction.user.id, userError });
            const tomorrow = midnightOf(dayKey(midnightOf(dayKey()) + 36 * 3_600_000));
            return InteractionHelper.safeEditReply(interaction, {
                embeds: [createEmbed({
                    title: `${event.emoji} ${event.texts.name()}`,
                    description: [
                        t`✅ You collected **+${amount} ${event.currency}**! You have **${total} ${event.currency}**.`,
                        t`Next ones ${ts(tomorrow, 'R')}. More for every message on the server.`,
                        t`-# Shop: \`/${event.command} sklep\` · event upgrades: \`/ulepszenia\``,
                    ].join('\n'),
                    color: event.color,
                    footer: false,
                })],
            });
        }, { command: event.daily }),
    };
}

/** The slash command of the event `eventId`. */
export function seasonCommand(eventId) {
    const event = getSeasonEvent(eventId);
    return {
        data: new SlashCommandBuilder()
            .setName(event.command)
            .setDescription(event.description)
            .addSubcommand((sub) => sub
                .setName('sklep')
                .setDescription('What you collected and what it buys'))
            .addSubcommand((sub) => sub
                .setName('kup')
                .setDescription('Buy something in the event shop')
                .addStringOption((option) => option.setName('przedmiot').setDescription('What').setRequired(true)
                    .addChoices(...seasonShop(event).map((item) => ({ name: `${item.emoji} ${item.name} (${item.price})`, value: item.id })))))
            .addSubcommand((sub) => sub
                .setName('ranking')
                .setDescription('Who collected the most')),

        execute: withErrorHandling(async (interaction, config, client) => {
            const sub = interaction.options.getSubcommand();
            const guildId = interaction.guildId;
            const deferred = await InteractionHelper.safeDefer(interaction);
            if (!deferred) return;

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
        }, { command: event.command }),
    };
}
