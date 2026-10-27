// stockMarket.js — /gielda: a pretend stock market of six made-up companies (2026-10-27, owner picked idea 8).
//
// Every server has its own prices. Once an hour each price moves at random by a few percent and is pulled
// back a little towards the company's base price, so prices wander but stay between 20% and 500% of the base.
// Sometimes (NEWS_CHANCE an hour) a headline moves one company by 8-25% at once. Members buy and sell whole
// shares at the current price; a fee (commands.stocks.feePercent) on every trade stops quick flips. Shares are
// safe from /rob. Prices move in the `stock_market` job (features.js) and before every trade or view.
//
// Store guild:{id}:stock-market = { hour, prices: { [id]: price }, history: { [id]: [hourly prices] },
//   news: [{ at, id, change, story }] }.
// Member data: stocks = { [id]: { shares, cost } }; cost = what the shares still held cost, fees included.

import { guildStore } from '../utils/featureKit.js';
import { logger } from '../utils/logger.js';
import { getEconomyData, setEconomyData } from '../utils/economy.js';
import { t } from '../i18n/index.js';
import { getEconomySettings, money } from './economySettings.js';
import { spendMoney, withEconomyLock } from './economyUpgrades.js';
import { recordProgress } from './progress.js';

// Names are made up (parodies), on purpose not real companies. volatility = typical move in an hour.
export const COMPANIES = Object.freeze([
  { id: 'KEBS', name: 'Kebab u Stefana', emoji: '🥙', base: 120, volatility: 0.02 },
  { id: 'CRPR', name: 'Creeper Corp', emoji: '💥', base: 250, volatility: 0.06 },
  { id: 'CLUB', name: "Club'o'mony", emoji: '🃏', base: 300, volatility: 0.045 },
  { id: 'PIKC', name: 'Pikczu Media', emoji: '🎬', base: 500, volatility: 0.04 },
  { id: 'DIAM', name: 'Diamentowa Kopalnia', emoji: '💎', base: 800, volatility: 0.03 },
  { id: 'ENDR', name: 'Ender Energia', emoji: '⚡', base: 1000, volatility: 0.07 },
]);
export const getCompany = (id) => COMPANIES.find((company) => company.id === String(id ?? '').toUpperCase()) ?? null;

export const HOUR_MS = 3_600_000;
export const HISTORY_HOURS = 24;
export const PRICE_LIMITS = Object.freeze([0.2, 5]);
const PULL_BACK = 0.03;
export const NEWS_CHANCE = 0.08;
const NEWS_MOVE = [0.08, 0.25];
// After a long stop (bot offline) at most this many hours are played back.
const MAX_CATCH_UP_HOURS = 72;

// Headlines: index `story` of the list for the direction of the move.
const STORIES = {
  up: [
    (name) => t`${name} signs a huge deal`,
    (name) => t`${name} beats every forecast`,
    (name) => t`Pikczu mentions ${name} in a video`,
  ],
  down: [
    (name) => t`${name} is under investigation`,
    (name) => t`${name} loses its biggest client`,
    (name) => t`A scandal shakes ${name}`,
  ],
};

const store = guildStore('stock-market', { hour: 0, prices: {}, history: {}, news: [] });

const hourOf = (now) => Math.floor(now / HOUR_MS);
export const nextPriceChange = (now = Date.now()) => (hourOf(now) + 1) * HOUR_MS;

/** A standard normal number (Box-Muller); 0 when `random` returns 0. */
function gaussian(random) {
  const u = 1 - random();
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** One hour of a price: a random move, a pull back towards the base, an optional headline shock. */
export function stepPrice(company, price, random = Math.random, shock = 0) {
  let x = Math.log(price / company.base);
  x = x * (1 - PULL_BACK) + company.volatility * gaussian(random) + shock;
  x = Math.min(Math.log(PRICE_LIMITS[1]), Math.max(Math.log(PRICE_LIMITS[0]), x));
  return Math.max(1, Math.round(company.base * Math.exp(x)));
}

/** Move the prices to the hour of `now`. Mutates `market`; returns how many hours were played. */
export function advanceMarket(market, now = Date.now(), random = Math.random) {
  const hour = hourOf(now);
  market.prices ??= {};
  market.history ??= {};
  market.news ??= [];
  for (const company of COMPANIES) {
    if (market.prices[company.id] > 0) continue;
    market.prices[company.id] = company.base;
    market.history[company.id] = [company.base];
  }
  if (!(market.hour > 0)) {
    market.hour = hour;
    return 0;
  }
  const steps = Math.max(0, Math.min(MAX_CATCH_UP_HOURS, hour - market.hour));
  for (let step = 0; step < steps; step += 1) {
    const stepHour = hour - steps + step + 1;
    let shocked = null;
    let shock = 0;
    if (random() < NEWS_CHANCE) {
      shocked = COMPANIES[Math.floor(random() * COMPANIES.length)];
      const size = NEWS_MOVE[0] + random() * (NEWS_MOVE[1] - NEWS_MOVE[0]);
      shock = random() < 0.5 ? -size : size;
    }
    for (const company of COMPANIES) {
      const before = market.prices[company.id];
      const after = stepPrice(company, before, random, company === shocked ? shock : 0);
      market.prices[company.id] = after;
      market.history[company.id] = [...(market.history[company.id] ?? []), after].slice(-(HISTORY_HOURS + 1));
      if (company === shocked) {
        const story = Math.floor(random() * STORIES.up.length);
        market.news = [{ at: stepHour * HOUR_MS, id: company.id, change: after / before - 1, story }, ...market.news].slice(0, 5);
      }
    }
  }
  if (hour > market.hour) market.hour = hour;
  return steps;
}

/** The market of a server, moved to the current hour (saved when it moved). */
export function getMarket(guildId, now = Date.now(), random = Math.random) {
  return withEconomyLock(guildId, '#stock-market', async () => {
    const market = await store.get(guildId);
    const hourBefore = market.hour;
    const steps = advanceMarket(market, now, random);
    if (steps > 0 || market.hour !== hourBefore) await store.set(guildId, market);
    return market;
  });
}

/** The headline of a stored news item. */
export function newsText(item) {
  const company = getCompany(item.id);
  const list = item.change >= 0 ? STORIES.up : STORIES.down;
  return (list[item.story] ?? list[0])(company ? `${company.emoji} ${company.name}` : item.id);
}

/** Price change over the last hour and the last 24 hours (0.05 = +5%). */
export function priceChanges(market, id) {
  const history = market.history?.[id] ?? [];
  const price = market.prices?.[id] ?? 0;
  const hourAgo = history.length >= 2 ? history.at(-2) : price;
  const dayAgo = history[0] ?? price;
  return { hour: hourAgo > 0 ? price / hourAgo - 1 : 0, day: dayAgo > 0 ? price / dayAgo - 1 : 0 };
}

export const holdingOf = (userData, id) => {
  const holding = userData?.stocks?.[id];
  return { shares: Math.max(0, Math.floor(Number(holding?.shares) || 0)), cost: Math.max(0, Number(holding?.cost) || 0) };
};

/** The fee on a trade worth `total`: at least 1 when the server has a fee. */
export function tradeFee(settings, total) {
  const percent = Number(settings?.commands?.stocks?.feePercent) || 0;
  return percent > 0 && total > 0 ? Math.max(1, Math.ceil(total * percent / 100)) : 0;
}

/** Everything a member holds, with value and profit at the current prices. */
export function portfolio(userData, market) {
  const rows = COMPANIES.map((company) => {
    const { shares, cost } = holdingOf(userData, company.id);
    const value = shares * (market.prices?.[company.id] ?? company.base);
    return { company, shares, cost, value, profit: value - cost };
  }).filter((row) => row.shares > 0);
  const value = rows.reduce((sum, row) => sum + row.value, 0);
  const cost = rows.reduce((sum, row) => sum + row.cost, 0);
  return { rows, value, cost, profit: value - cost };
}

function setHolding(userData, id, shares, cost) {
  const stocks = { ...(userData.stocks ?? {}) };
  if (shares > 0) stocks[id] = { shares, cost: Math.max(0, Math.round(cost)) };
  else delete stocks[id];
  userData.stocks = stocks;
}

/**
 * Buy `shares` shares, or as many as `budget` pays for (fee included). Cash first, then the bank.
 * Returns { company, count, price, total, fee, paid, holding, progress }. Throws `userError(text)`.
 */
export async function buyShares({ client, guildId, userId, companyId, shares = null, budget = null, userError, now = Date.now(), random = Math.random }) {
  const company = getCompany(companyId);
  if (!company) throw userError(t('Pick a company from the list.'));
  return withEconomyLock(guildId, userId, async () => {
    const market = await getMarket(guildId, now, random);
    const price = market.prices[company.id];
    const settings = await getEconomySettings(guildId);
    const userData = await getEconomyData(client, guildId, userId);
    const held = holdingOf(userData, company.id);
    const limit = Number(settings.commands.stocks.maxShares) || 0;

    let count = Math.floor(Number(shares) || 0);
    if (!(count > 0) && budget > 0) {
      count = Math.floor(budget / price);
      while (count > 0 && count * price + tradeFee(settings, count * price) > budget) count -= 1;
      if (count <= 0) throw userError(t`${money(guildId, budget)} is not enough for one share of ${company.name} (${money(guildId, price)} + fee).`);
    }
    if (!(count > 0)) count = 1;
    if (limit > 0 && held.shares + count > limit) {
      const room = Math.max(0, limit - held.shares);
      if (room === 0) throw userError(t`You already hold the most shares of one company (${limit}).`);
      count = room;
    }

    const total = count * price;
    const fee = tradeFee(settings, total);
    if (!spendMoney(userData, total + fee)) {
      throw userError(t`${count} {0|share|shares} of ${company.name} cost ${money(guildId, total + fee)} with the fee - you do not have that much (cash and bank).`);
    }
    setHolding(userData, company.id, held.shares + count, held.cost + total + fee);
    const progress = recordProgress(userData, { stockTrades: 1 }, { settings, now });
    await setEconomyData(client, guildId, userId, userData);
    return { company, count, price, total, fee, paid: total + fee, holding: holdingOf(userData, company.id), progress };
  });
}

/**
 * Sell `shares` shares (all when not given). The money goes to cash.
 * Returns { company, count, price, total, fee, received, profit, holding, progress }. Throws `userError(text)`.
 */
export async function sellShares({ client, guildId, userId, companyId, shares = null, userError, now = Date.now(), random = Math.random }) {
  const company = getCompany(companyId);
  if (!company) throw userError(t('Pick a company from the list.'));
  return withEconomyLock(guildId, userId, async () => {
    const market = await getMarket(guildId, now, random);
    const price = market.prices[company.id];
    const settings = await getEconomySettings(guildId);
    const userData = await getEconomyData(client, guildId, userId);
    const held = holdingOf(userData, company.id);
    if (held.shares <= 0) throw userError(t`You have no shares of ${company.name}.`);

    const count = Math.min(held.shares, Math.floor(Number(shares) || 0) || held.shares);
    const total = count * price;
    const fee = tradeFee(settings, total);
    const received = Math.max(0, total - fee);
    const costPart = held.cost * count / held.shares;
    const profit = Math.round(received - costPart);
    userData.wallet = (Number(userData.wallet) || 0) + received;
    setHolding(userData, company.id, held.shares - count, held.cost - costPart);
    const progress = recordProgress(userData, { stockTrades: 1, stockProfit: Math.max(0, profit) }, { settings, now });
    await setEconomyData(client, guildId, userId, userData);
    return { company, count, price, total, fee, received, profit, holding: holdingOf(userData, company.id), progress };
  });
}

/** The `stock_market` job: keeps the hourly history of servers that use the market. */
export async function runStockMarket(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      const stored = await store.get(guild.id);
      if (stored.hour > 0) await getMarket(guild.id);
    } catch (error) {
      logger.warn(`Stock market failed in guild ${guild.id}: ${error.message}`);
    }
  }
}
