// prestige.js — /prestiz (2026-10-29, owner picked idea 3 "10 prestizy").
//
// A member with enough money (cash + own bank, PRESTIGE_COSTS) may start over: cash and bank go back to the server's
// starting amounts, upgrades, shares and buildings are removed. In return every payout is +10% for good per prestige
// level (prestigeLevel / PRESTIGE_PERCENT_PER_LEVEL in economySettings.js, applied in scaleEarnings), max 10 levels.
// Kept: items, cards, fish, badges, missions, club, marriage, boosts, Halloween candies.
// Member data: prestige = level, prestigedAt.

import { getEconomyData, setEconomyData } from '../utils/economy.js';
import { t } from '../i18n/index.js';
import { MAX_PRESTIGE, PRESTIGE_PERCENT_PER_LEVEL, getEconomySettings, money, prestigeLevel } from './economySettings.js';
import { withEconomyLock } from './economyUpgrades.js';
import { recordProgress } from './progress.js';

export { MAX_PRESTIGE, PRESTIGE_PERCENT_PER_LEVEL, prestigeLevel };

// Money needed for prestige 1, 2, ... 10 (my numbers).
export const PRESTIGE_COSTS = Object.freeze([
  500_000, 1_000_000, 2_000_000, 3_000_000, 5_000_000, 7_500_000, 10_000_000, 15_000_000, 20_000_000, 30_000_000,
]);

/** Cash plus the member's own bank (not a spouse's half). */
export const ownMoney = (userData) => Math.max(0, Math.floor(Number(userData?.wallet) || 0)) + Math.max(0, Math.floor(Number(userData?.bank) || 0));

/** What the next prestige needs: { level, cost } or null at the top. */
export function nextPrestige(userData) {
  const level = prestigeLevel(userData);
  return level >= MAX_PRESTIGE ? null : { level: level + 1, cost: PRESTIGE_COSTS[level] };
}

/** Do the prestige. Returns { level, lost, progress }. Throws `userError(text)` when not possible. */
export function doPrestige({ client, guildId, userId, userError, now = Date.now() }) {
  return withEconomyLock(guildId, userId, async () => {
    const settings = await getEconomySettings(guildId);
    const userData = await getEconomyData(client, guildId, userId, { joint: false });
    const next = nextPrestige(userData);
    if (!next) throw userError(t`You already have the highest prestige (${MAX_PRESTIGE}).`);
    const have = ownMoney(userData);
    if (have < next.cost) throw userError(t`Prestige ${next.level} needs ${money(guildId, next.cost)} in cash and bank - you have ${money(guildId, have)}.`);

    const lost = { money: have, upgrades: Object.keys(userData.upgrades ?? {}).length, stocks: Object.keys(userData.stocks ?? {}).length, properties: Object.keys(userData.properties ?? {}).length };
    userData.wallet = settings.startingWallet;
    userData.bank = settings.startingBank;
    userData.upgrades = {};
    userData.stocks = {};
    userData.properties = {};
    userData.prestige = next.level;
    userData.prestigedAt = now;
    const progress = recordProgress(userData, { prestige: 1 }, { settings, now });
    await setEconomyData(client, guildId, userId, userData);
    return { level: next.level, lost, progress };
  });
}
