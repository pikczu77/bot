// lottery.js — weekly lottery (2026-10-26, owner picked idea 3: "rob").
//
// Members buy tickets all week with /loteria kup; on Sunday at 20:00 (Polish time) one ticket wins the
// whole pot: every ticket sold plus the server's bonus. More tickets = a bigger chance. A week without
// tickets just starts again. The draw is posted on the lottery channel (or the channel of the last
// purchase) and the winner gets a DM. Checked every minute (features.js).
//
// Store guild:{id}:lottery = { channelId, ticketPrice, maxTickets, bonus, round: { drawAt, tickets: { userId: n },
// lastChannelId }, last: { winnerId, pot, tickets, players, at } }.

import { createEmbed } from '../utils/embeds.js';
import { guildStore } from '../utils/featureKit.js';
import { logger } from '../utils/logger.js';
import { getEconomyData, setEconomyData } from '../utils/economy.js';
import { enterLocale, t } from '../i18n/index.js';
import { midnightOf, weekKey } from '../utils/warsawTime.js';
import { getGuildLocale } from './languageService.js';
import { getEconomySettings, money, scaleEarnings } from './economySettings.js';
import { spendMoney, withEconomyLock } from './economyUpgrades.js';
import { recordProgress } from './progress.js';

export const DRAW_HOUR = 20;
export const LOTTERY_DEFAULTS = Object.freeze({ channelId: null, ticketPrice: 500, maxTickets: 50, bonus: 2000 });
const store = guildStore('lottery', { ...LOTTERY_DEFAULTS, round: null, last: null });

export const getLottery = (guildId) => store.get(guildId);
export const updateLottery = (guildId, mutate) => store.update(guildId, mutate);

/** Sunday 20:00 Warsaw time of the week of `now`, or of the next week when that has passed. */
export function nextDrawTime(now = Date.now()) {
  const drawOfWeek = (monday) => {
    const [year, month, day] = monday.split('-').map(Number);
    const sunday = new Date(Date.UTC(year, month - 1, day + 6)).toISOString().slice(0, 10);
    return midnightOf(sunday) + DRAW_HOUR * 3_600_000;
  };
  const draw = drawOfWeek(weekKey(now));
  return draw > now ? draw : drawOfWeek(weekKey(now + 7 * 86_400_000));
}

const ticketCount = (round) => Object.values(round?.tickets ?? {}).reduce((sum, count) => sum + count, 0);

/** The pot of the running round: tickets times the price plus the bonus (server multiplier). */
export function potOf(lottery, settings) {
  return ticketCount(lottery.round) * lottery.ticketPrice + scaleEarnings(settings, lottery.bonus);
}

function ensureRound(lottery, now) {
  if (!lottery.round || !(lottery.round.drawAt > 0)) lottery.round = { drawAt: nextDrawTime(now), tickets: {}, lastChannelId: null };
  return lottery.round;
}

/** The running round (started if needed) and what it means for `userId`. */
export async function lotteryState(guildId, userId, now = Date.now()) {
  const lottery = await getLottery(guildId);
  const settings = await getEconomySettings(guildId);
  const round = ensureRound(lottery, now);
  const total = ticketCount(round);
  const mine = Number(round.tickets[userId]) || 0;
  return { lottery, round, total, mine, pot: potOf(lottery, settings), chance: total > 0 ? mine / total : 0, settings };
}

/**
 * Buy `count` tickets (cash first, then the bank). Returns { bought, mine, total, pot, cost, progress }.
 * Throws a user error (`userError(text)`) when not allowed.
 */
export async function buyTickets({ client, guildId, userId, count, channelId = null, userError, now = Date.now() }) {
  return withEconomyLock(guildId, userId, async () => {
    const lottery = await getLottery(guildId);
    const round = ensureRound(lottery, now);
    const mine = Number(round.tickets[userId]) || 0;
    const room = Math.max(0, lottery.maxTickets - mine);
    if (room <= 0) throw userError(t`You already have the most tickets one person can buy this week (${lottery.maxTickets}).`);
    const bought = Math.min(room, count);
    const cost = bought * lottery.ticketPrice;
    const settings = await getEconomySettings(guildId);
    const userData = await getEconomyData(client, guildId, userId);
    if (!spendMoney(userData, cost)) {
      throw userError(t`${bought} {0|ticket costs|tickets cost} ${money(guildId, cost)} - you do not have that much (cash and bank).`);
    }
    const progress = recordProgress(userData, { lotteryTickets: bought }, { settings, now });
    await setEconomyData(client, guildId, userId, userData);
    const saved = await updateLottery(guildId, (data) => {
      const current = ensureRound(data, now);
      current.tickets[userId] = (Number(current.tickets[userId]) || 0) + bought;
      if (channelId) current.lastChannelId = channelId;
    });
    return { bought, mine: saved.round.tickets[userId], total: ticketCount(saved.round), pot: potOf(saved, settings), cost, progress };
  });
}

/** Pick the winning ticket: every ticket has the same chance. */
export function pickWinner(tickets, random = Math.random) {
  const entries = Object.entries(tickets ?? {}).filter(([, count]) => count > 0);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  let roll = Math.floor(random() * total);
  for (const [userId, count] of entries) {
    if (roll < count) return userId;
    roll -= count;
  }
  return entries.at(-1)?.[0] ?? null;
}

/** Draw when it is time. Returns the result or null. */
export async function drawLottery(client, guild, now = Date.now(), random = Math.random) {
  const lottery = await getLottery(guild.id);
  if (!lottery.round || lottery.round.drawAt > now) return null;
  const round = lottery.round;
  const total = ticketCount(round);
  const settings = await getEconomySettings(guild.id);
  const pot = potOf(lottery, settings);

  if (total === 0) {
    await updateLottery(guild.id, (data) => { data.round = { drawAt: nextDrawTime(now + 60_000), tickets: {}, lastChannelId: null }; });
    return { winnerId: null, pot: 0, total: 0 };
  }

  const winnerId = pickWinner(round.tickets, random);
  await withEconomyLock(guild.id, winnerId, async () => {
    const userData = await getEconomyData(client, guild.id, winnerId);
    userData.wallet = (Number(userData.wallet) || 0) + pot;
    recordProgress(userData, { lotteryWin: 1 }, { settings, now });
    await setEconomyData(client, guild.id, winnerId, userData);
  });
  const players = Object.keys(round.tickets).length;
  await updateLottery(guild.id, (data) => {
    data.last = { winnerId, pot, tickets: total, players, winnerTickets: round.tickets[winnerId], at: now };
    data.round = { drawAt: nextDrawTime(now + 60_000), tickets: {}, lastChannelId: null };
  });

  const embed = createEmbed({
    title: t('🎟️ Lottery draw'),
    description: [
      t`<@${winnerId}> wins **${money(guild.id, pot)}**!`,
      t`${total} {0|ticket|tickets} from ${players} {1|player|players}; the winner had ${round.tickets[winnerId]}.`,
      t`New round: tickets with \`/loteria kup\`, next draw <t:${Math.floor(nextDrawTime(now + 60_000) / 1000)}:F>.`,
    ].join('\n'),
    color: '#F1C40F',
    footer: false,
  });
  const channelId = lottery.channelId || round.lastChannelId;
  const channel = channelId ? guild.channels.cache.get(channelId) : null;
  if (channel?.send) {
    await channel.send({ content: `<@${winnerId}>`, embeds: [embed], allowedMentions: { users: [winnerId] } })
      .catch((error) => logger.warn(`Lottery result not posted in guild ${guild.id}: ${error.message}`));
  }
  const winner = await client.users?.fetch?.(winnerId).catch(() => null);
  await winner?.send?.({ embeds: [createEmbed({ title: t`🎟️ You won the lottery on ${guild.name}!`, description: t`**${money(guild.id, pot)}** is in your cash.`, color: '#F1C40F', footer: false })] })
    .catch(() => {});
  return { winnerId, pot, total };
}

export async function runLottery(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      enterLocale(await getGuildLocale(guild.id));
      await drawLottery(client, guild);
    } catch (error) {
      logger.warn(`Lottery failed in guild ${guild.id}: ${error.message}`);
    }
  }
}
