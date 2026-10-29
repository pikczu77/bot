// boosts.js — /boosty: x2 money or x2 XP for a while (2026-10-29, owner: "/boosty - mozna kupic 2x hajs na godzine").
//
// Member data: boosts = { money: until, xp: until } (ms). The money boost doubles every payout that goes through
// scaleEarnings() with the member's data (like the "kasa" event, and on top of it); the XP boost doubles message XP
// (events/messageCreate.js). Buying more of a running boost adds time; at most MAX_BOOST_HOURS ahead.
// Sold for money in /boosty (prices in commands.boosts) and in the holiday event shops (services/seasonalEvents.js).

import { getEconomyData, setEconomyData } from '../utils/economy.js';
import { t } from '../i18n/index.js';
import { BOOST_FACTOR, boostFactor, getEconomySettings, money } from './economySettings.js';
import { spendMoney, withEconomyLock } from './economyUpgrades.js';

export const BOOST_TYPES = Object.freeze([
  { id: 'money', emoji: '💰', name: t('Double money'), priceKey: 'moneyHourPrice' },
  { id: 'xp', emoji: '⭐', name: t('Double XP'), priceKey: 'xpHourPrice' },
]);
export const getBoostType = (id) => BOOST_TYPES.find((type) => type.id === id) ?? null;
export const BOOST_HOURS = Object.freeze([1, 3, 6]);
export const MAX_BOOST_HOURS = 24;
const HOUR_MS = 3_600_000;

/** When the member's boost of `type` ends (0 = not running). */
export const boostUntil = (userData, type, now = Date.now()) => {
  const until = Number(userData?.boosts?.[type]) || 0;
  return until > now ? until : 0;
};

/**
 * Add `minutes` of a boost. Mutates `userData`; returns the new end or null when it would go
 * more than MAX_BOOST_HOURS ahead.
 */
export function addBoost(userData, type, minutes, now = Date.now()) {
  const until = Math.max(now, boostUntil(userData, type, now)) + minutes * 60_000;
  if (until - now > MAX_BOOST_HOURS * HOUR_MS) return null;
  userData.boosts = { ...(userData.boosts ?? {}), [type]: until };
  return until;
}

export const boostPrice = (settings, type, hours) => Math.max(0, Number(settings.commands.boosts[getBoostType(type).priceKey]) || 0) * hours;

/** /boosty kup: pay with cash first, then the bank. Returns { type, hours, price, until }. Throws `userError(text)`. */
export function buyBoost({ client, guildId, userId, typeId, hours, userError, now = Date.now() }) {
  const type = getBoostType(typeId);
  if (!type || !BOOST_HOURS.includes(hours)) throw userError(t('Pick a boost from the list.'));
  return withEconomyLock(guildId, userId, async () => {
    const settings = await getEconomySettings(guildId);
    const userData = await getEconomyData(client, guildId, userId);
    const price = boostPrice(settings, type.id, hours);
    const until = addBoost(userData, type.id, hours * 60, now);
    if (!until) throw userError(t`A boost can run at most ${MAX_BOOST_HOURS} h ahead. Wait until it runs down a little.`);
    if (!spendMoney(userData, price)) throw userError(t`${hours} h of ${type.emoji} ${type.name} costs ${money(guildId, price)} - you do not have that much (cash and bank).`);
    await setEconomyData(client, guildId, userId, userData);
    return { type, hours, price, until };
  });
}

/** x2 when the member's XP boost runs (read for message XP). */
export async function xpBoostFactor(client, guildId, userId, now = Date.now()) {
  return boostFactor(await getEconomyData(client, guildId, userId, { joint: false }), 'xp', now);
}

export { BOOST_FACTOR };
