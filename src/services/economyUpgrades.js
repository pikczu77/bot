// economyUpgrades.js — permanent, levelled economy upgrades (/ulepszenia).
//
// Levels are stored per member in economy data: `upgrades: { work: 3, bank_security: 1 }`.
// They never expire. The earning commands read the bonuses through the helpers below.
//
// Balance (2026-10-14): every next level costs little more than the one before (growth 1.3
// for ten-level upgrades), so a step takes hours, while maxing everything is well over a
// million — months of play at payouts like /nagraj (internal id "mine") 300-800.

import { getEconomyData, setEconomyData } from '../utils/economy.js';
import { Mutex } from '../utils/mutex.js';
import { FORTUNE_MAX_LEVEL, FORTUNE_PERCENT_PER_LEVEL, money } from './economySettings.js';
import { collectionBonusLine, collectionBonusPercent } from './collections.js';
import { t } from '../i18n/index.js';

/** Share of the victim's bank a successful /rob takes: 50% minus 10 points per security level, never below 10%. */
export const BANK_STEAL_BASE_PERCENT = 50;
export const BANK_STEAL_STEP_PERCENT = 10;
export const BANK_STEAL_MIN_PERCENT = 10;

export const BANK_CAPACITY_PER_LEVEL = 20_000;
export const DISCOUNT_PER_LEVEL = 5;
export const LUCK_PER_LEVEL = 1;
export const STAMINA_PER_LEVEL = 5;

// price of level N+1 = basePrice * growth^N, rounded to 100. `step` = earnings percent per level.
export const UPGRADES = Object.freeze([
  { id: 'fortune', emoji: '💰', name: t('Fortune'), description: t('Every payout is bigger: work, videos, fishing, crime, begging, /daily, chat and level-up money.'), maxLevel: FORTUNE_MAX_LEVEL, basePrice: 25_000, growth: 2, step: FORTUNE_PERCENT_PER_LEVEL },
  { id: 'work', emoji: '💼', name: t('Career'), description: t('Higher `/work` pay.'), maxLevel: 10, basePrice: 2_000, growth: 1.3, step: 10 },
  { id: 'overtime', emoji: '⏰', name: t('Overtime'), description: t('Work several times in a row before the break.'), maxLevel: 4, basePrice: 5_000, growth: 1.8 },
  // id "mine" = /nagraj (renamed from /mine on 2026-10-15; levels bought before still count).
  { id: 'mine', emoji: '🎬', name: t('YouTube'), description: t('Higher `/nagraj` earnings.'), maxLevel: 10, basePrice: 2_500, growth: 1.3, step: 10 },
  { id: 'fish', emoji: '🎣', name: t('Fishing'), description: t('Higher `/fish` earnings.'), maxLevel: 10, basePrice: 2_000, growth: 1.3, step: 10 },
  { id: 'crime', emoji: '🦹', name: t('Street smarts'), description: t('Higher `/crime`, `/slut` and `/pozwij` payouts.'), maxLevel: 10, basePrice: 2_500, growth: 1.3, step: 10 },
  { id: 'daily', emoji: '📅', name: t('Daily bonus'), description: t('Bigger `/daily` reward.'), maxLevel: 10, basePrice: 800, growth: 1.3, step: 25 },
  { id: 'luck', emoji: '🍀', name: t('Luck'), description: t('+1% win chance in every casino game per level.'), maxLevel: 15, basePrice: 1_500, growth: 1.3 },
  { id: 'stamina', emoji: '⚡', name: t('Stamina'), description: t('Shorter breaks after every earning command and casino game (not /daily, not jail).'), maxLevel: 10, basePrice: 3_000, growth: 1.35 },
  { id: 'thief', emoji: '🥷', name: t('Thief'), description: t('Better `/rob` success chance.'), maxLevel: 5, basePrice: 3_000, growth: 1.6 },
  { id: 'discount', emoji: '🏷️', name: t('Discount'), description: t('Everything in `/sklep` and `/ulepszenia` is cheaper.'), maxLevel: 5, basePrice: 5_000, growth: 1.8 },
  { id: 'bank_security', emoji: '🛡️', name: t('Bank security'), description: t('Robbers take a smaller part of your bank.'), maxLevel: 4, basePrice: 5_000, growth: 1.8 },
  { id: 'bank_capacity', emoji: '🏦', name: t('Bigger vault'), description: t('More room in your bank.'), maxLevel: 10, basePrice: 3_000, growth: 1.3 },
  { id: 'interest', emoji: '📈', name: t('Interest'), description: t('`/daily` also pays a share of your bank.'), maxLevel: 5, basePrice: 15_000, growth: 1.6 },
]);

const BY_ID = new Map(UPGRADES.map((upgrade) => [upgrade.id, upgrade]));

export const getUpgrade = (id) => BY_ID.get(id) ?? null;

export function getUpgradeLevel(userData, id) {
  const upgrade = BY_ID.get(id);
  const level = Number(userData?.upgrades?.[id]);
  if (!upgrade || !Number.isInteger(level) || level < 0) return 0;
  return Math.min(level, upgrade.maxLevel);
}

/** List price of the next level, or null when the upgrade is already at its highest level. */
export function upgradePrice(upgrade, level) {
  if (level >= upgrade.maxLevel) return null;
  return Math.round((upgrade.basePrice * upgrade.growth ** level) / 100) * 100;
}

/** Percent the "Discount" upgrade takes off shop items, item tiers and other upgrades. */
export const discountPercent = (userData) => getUpgradeLevel(userData, 'discount') * DISCOUNT_PER_LEVEL;
export const discountedPrice = (price, userData) => Math.ceil(price * (100 - discountPercent(userData)) / 100);

/** What this member pays for the next level (the discount does not apply to itself). */
export function upgradeCost(upgrade, level, userData) {
  const price = upgradePrice(upgrade, level);
  if (price === null || upgrade.id === 'discount') return price;
  return discountedPrice(price, userData);
}

// Bonuses read by the commands.
// The upgrade of `id` plus the collection bonuses (services/collections.js), added together.
export const earningMultiplier = (userData, id) =>
  1 + (getUpgradeLevel(userData, id) * (BY_ID.get(id)?.step ?? 10) + collectionBonusPercent(userData, id)) / 100;
export const bankStealPercent = (userData) =>
  Math.max(BANK_STEAL_MIN_PERCENT, BANK_STEAL_BASE_PERCENT - getUpgradeLevel(userData, 'bank_security') * BANK_STEAL_STEP_PERCENT);
export const extraBankCapacity = (userData) => getUpgradeLevel(userData, 'bank_capacity') * BANK_CAPACITY_PER_LEVEL;
export const interestPercent = (userData) => getUpgradeLevel(userData, 'interest');
export const robSuccessBonus = (userData) => getUpgradeLevel(userData, 'thief') * 5;
/** Break of an earning command or casino game after the Stamina upgrade (-5% a level, -50% at 10). */
export const staminaCooldown = (userData, ms) => Math.round(ms * (1 - getUpgradeLevel(userData, 'stamina') * STAMINA_PER_LEVEL / 100));
/** How many `/work` shifts fit in a row before the break: 1, or up to 5 with Overtime. */
export const workShiftsInARow = (userData) => 1 + getUpgradeLevel(userData, 'overtime');

/** "\n⚡ **Career 3/10:** +30% earnings" for the result message of an earning command, '' at level 0. */
export function upgradeBonusLine(userData, id, guildId = null) {
  const upgrade = BY_ID.get(id);
  const level = getUpgradeLevel(userData, id);
  const collection = collectionBonusLine(userData, id);
  if (!upgrade || level === 0) return collection;
  return `\n${upgrade.emoji} **${t(upgrade.name)} ${level}/${upgrade.maxLevel}:** ${describeUpgradeEffect(upgrade, level, guildId)}${collection}`;
}

/** What the upgrade does at `level`, e.g. "+30% pay". */
export function describeUpgradeEffect(upgrade, level, guildId) {
  switch (upgrade.id) {
    case 'bank_security': return t`robbers take ${bankStealPercent({ upgrades: { bank_security: level } })}% of the bank`;
    case 'bank_capacity': return t`+${money(guildId, level * BANK_CAPACITY_PER_LEVEL)} bank space`;
    case 'interest': return t`${level}% of the bank with every /daily`;
    case 'thief': return t`+${level * 5}% robbery success`;
    case 'luck': return t`+${level * LUCK_PER_LEVEL}% win chance`;
    case 'stamina': return t`-${level * STAMINA_PER_LEVEL}% break time`;
    case 'fortune': return t`+${level * FORTUNE_PERCENT_PER_LEVEL}% all earnings`;
    case 'work': return t`+${level * upgrade.step}% /work pay`;
    case 'mine': return t`+${level * upgrade.step}% from /nagraj`;
    case 'fish': return t`+${level * upgrade.step}% from /fish`;
    case 'crime': return t`+${level * upgrade.step}% from /crime, /slut and /pozwij`;
    case 'daily': return t`+${level * upgrade.step}% /daily reward`;
    case 'overtime': return t`${level + 1} {0|shift|shifts} in a row`;
    case 'discount': return t`-${level * DISCOUNT_PER_LEVEL}% prices`;
    default: return t`+${level * (upgrade.step ?? 10)}% earnings`;
  }
}

/**
 * Take `amount` from cash first, then from the bank. Mutates `userData`.
 * Returns false (and changes nothing) when the member cannot afford it.
 */
export function spendMoney(userData, amount) {
  const wallet = userData.wallet || 0;
  const bank = userData.bank || 0;
  if (wallet + bank < amount) return false;
  const fromWallet = Math.min(wallet, amount);
  userData.wallet = wallet - fromWallet;
  userData.bank = bank - (amount - fromWallet);
  return true;
}

/** One economy write per member at a time (double clicks, two commands at once). */
export const withEconomyLock = (guildId, userId, task) => Mutex.runExclusive(`economy:${guildId}:${userId}`, task);

/**
 * Buy the next level of an upgrade.
 * @returns {Promise<{ ok: true, upgrade, level, price, userData } | { ok: false, reason: 'unknown'|'max'|'money', upgrade?, price?, userData? }>}
 */
export function buyUpgrade(client, guildId, userId, upgradeId) {
  const upgrade = getUpgrade(upgradeId);
  if (!upgrade) return Promise.resolve({ ok: false, reason: 'unknown' });

  return withEconomyLock(guildId, userId, async () => {
    const userData = await getEconomyData(client, guildId, userId);
    const level = getUpgradeLevel(userData, upgrade.id);
    const price = upgradeCost(upgrade, level, userData);
    if (price === null) return { ok: false, reason: 'max', upgrade, userData };
    if (!spendMoney(userData, price)) return { ok: false, reason: 'money', upgrade, price, userData };

    userData.upgrades = { ...(userData.upgrades || {}), [upgrade.id]: level + 1 };
    await setEconomyData(client, guildId, userId, userData);
    return { ok: true, upgrade, level: level + 1, price, userData };
  });
}
