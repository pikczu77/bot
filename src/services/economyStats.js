// economyStats.js — how much money the server has, where it comes from and where it goes (2026-11-01, owner
// picked the idea; balance was tuned by feel before). Shown in the web panel: Ekonomia > Statystyki.
//
// setEconomyData() reports every change of a member's cash + bank (noteMoneyChange), so no command has to remember
// to report anything. The source is what runs at that moment: a slash command, a button, a job or the panel (the
// trace context), a chat message when nothing else runs. Changes wait in memory and reach the store once a minute,
// so a restart loses at most that minute. A snapshot of all accounts is taken every SNAPSHOT_MS; the last one of a
// day is that day's closing value.
//
// Store guild:{id}:economy-stats = { days: { 'YYYY-MM-DD': { in, out, sources: { id: [in, out] }, users: [ids] (today only),
//   active, money, wallet, bank, accounts, median, top10Percent } } }. Kept for KEEP_DAYS.

import { getEconomyPrefix } from '../utils/database.js';
import { guildStore } from '../utils/featureKit.js';
import { getTraceContext, logger } from '../utils/logger.js';
import { dayKey, daysBetween } from '../utils/warsawTime.js';

export const KEEP_DAYS = 90;
const SNAPSHOT_MS = 15 * 60_000;

// Buttons and menus say which command they belong to through their custom id.
const SOURCE_ALIASES = Object.freeze({
  bj: 'blackjack', pozew: 'pozwij', wiezienie: 'bail', ekoadmin: 'economy', praca: 'work', mine: 'nagraj',
});

const store = guildStore('economy-stats', { days: {} });
const pending = new Map(); // guildId -> { [day]: { in, out, sources, users: Set } }
const lastSnapshot = new Map(); // guildId -> time

/** What caused a money change right now: a command name, 'job:<name>', 'panel', or 'chat'. */
export function moneySource() {
  const trace = getTraceContext();
  if (!trace) return 'chat';
  const command = String(trace.command ?? '');
  if (!command) return 'other';
  if (command.startsWith('job:') || command === 'panel') return command;
  const [first, second] = command.split(/[:_]/);
  const name = first.toLowerCase();
  // ponownie:<work|fish|nagraj>:<ownerId> = "do it again" under that job.
  if (name === 'ponownie') return second || 'other';
  return SOURCE_ALIASES[name] ?? name;
}

/** Called by setEconomyData with the change of cash + bank. Never throws: it must not get in the way of a save. */
export function noteMoneyChange(guildId, userId, change, now = Date.now()) {
  try {
    const amount = Math.round(Number(change) || 0);
    if (!amount) return;
    const day = dayKey(now);
    const guild = pending.get(guildId) ?? {};
    pending.set(guildId, guild);
    const bucket = (guild[day] ??= { in: 0, out: 0, sources: {}, users: new Set() });
    const source = (bucket.sources[moneySource()] ??= [0, 0]);
    if (amount > 0) {
      bucket.in += amount;
      source[0] += amount;
    } else {
      bucket.out -= amount;
      source[1] -= amount;
    }
    bucket.users.add(String(userId));
  } catch (error) {
    logger.warn(`Economy stats: ${error.message}`);
  }
}

/** Move what waits in memory to the store and tidy old days. */
export async function flushEconomyStats(guildId, now = Date.now()) {
  const waiting = pending.get(guildId);
  pending.delete(guildId);
  const today = dayKey(now);
  return store.update(guildId, (data) => {
    data.days ??= {};
    for (const [day, bucket] of Object.entries(waiting ?? {})) {
      const stored = (data.days[day] ??= { in: 0, out: 0, sources: {}, users: [] });
      stored.in = (stored.in || 0) + bucket.in;
      stored.out = (stored.out || 0) + bucket.out;
      stored.sources ??= {};
      for (const [id, [gained, lost]] of Object.entries(bucket.sources)) {
        const source = (stored.sources[id] ??= [0, 0]);
        source[0] += gained;
        source[1] += lost;
      }
      stored.users = [...new Set([...(stored.users ?? []), ...bucket.users])];
    }
    for (const [day, stored] of Object.entries(data.days)) {
      if (daysBetween(day, today) > KEEP_DAYS) {
        delete data.days[day];
      } else if (day !== today && stored.users) {
        stored.active = stored.users.length;
        delete stored.users;
      }
    }
  });
}

/** Totals over every account of the server right now. */
export async function economySnapshot(client, guildId) {
  const keys = await client.db.list(getEconomyPrefix(guildId));
  const totals = [];
  let wallet = 0;
  let bank = 0;
  for (const key of Array.isArray(keys) ? keys : []) {
    const data = await client.db.get(key);
    if (!data) continue;
    const ownWallet = Number(data.wallet) || 0;
    const ownBank = Number(data.bank) || 0;
    wallet += ownWallet;
    bank += ownBank;
    totals.push(ownWallet + ownBank);
  }
  totals.sort((a, b) => b - a);
  const money = wallet + bank;
  const middle = Math.floor(totals.length / 2);
  const median = !totals.length ? 0 : totals.length % 2 ? totals[middle] : Math.round((totals[middle - 1] + totals[middle]) / 2);
  const top10 = totals.slice(0, Math.ceil(totals.length / 10)).reduce((sum, value) => sum + value, 0);
  return { money, wallet, bank, accounts: totals.length, median, top10Percent: money > 0 ? Math.round(top10 * 100 / money) : 0 };
}

export async function takeSnapshot(client, guildId, now = Date.now()) {
  const snapshot = await economySnapshot(client, guildId);
  await store.update(guildId, (data) => {
    data.days ??= {};
    const day = dayKey(now);
    data.days[day] = { in: 0, out: 0, sources: {}, users: [], ...data.days[day], ...snapshot };
  });
  lastSnapshot.set(guildId, now);
  return snapshot;
}

function sumSources(days) {
  const sum = new Map();
  for (const day of days) {
    for (const [id, [gained, lost]] of Object.entries(day.sources ?? {})) {
      const entry = sum.get(id) ?? { id, in: 0, out: 0 };
      entry.in += gained;
      entry.out += lost;
      sum.set(id, entry);
    }
  }
  return [...sum.values()].sort((a, b) => Math.abs(b.in - b.out) - Math.abs(a.in - a.out));
}

/** For the panel: the numbers of now, the days (oldest first) and the sources of the last 7 and 30 days. */
export async function economyStatsView(client, guildId, now = Date.now()) {
  await flushEconomyStats(guildId, now);
  const snapshot = await takeSnapshot(client, guildId, now);
  const { days: stored } = await store.get(guildId);
  const today = dayKey(now);
  const within = (count) => Object.entries(stored ?? {})
    .filter(([day]) => daysBetween(day, today) < count)
    .sort(([a], [b]) => a.localeCompare(b));
  const row = ([day, data]) => ({
    day,
    in: data.in || 0,
    out: data.out || 0,
    active: data.users ? data.users.length : (data.active || 0),
    money: data.money ?? null,
  });
  return {
    now: snapshot,
    days: within(30).map(row),
    sources7: sumSources(within(7).map(([, data]) => data)),
    sources30: sumSources(within(30).map(([, data]) => data)),
  };
}

export async function runEconomyStats(client) {
  const now = Date.now();
  for (const guild of client.guilds.cache.values()) {
    try {
      await flushEconomyStats(guild.id, now);
      if (now - (lastSnapshot.get(guild.id) || 0) >= SNAPSHOT_MS) await takeSnapshot(client, guild.id, now);
    } catch (error) {
      logger.warn(`Economy stats failed in guild ${guild.id}: ${error.message}`);
    }
  }
}
