// economyUpgrades.js — permanent, levelled economy upgrades (/ulepszenia).
//
// Levels are stored per member in economy data: `upgrades: { work: 3, bank_security: 1 }`.
// They never expire. The earning commands read the bonuses through the helpers below.

import { getEconomyData, setEconomyData } from '../utils/economy.js';
import { Mutex } from '../utils/mutex.js';
import { money } from './economySettings.js';
import { t } from '../i18n/index.js';

/** Share of the victim's bank a successful /rob takes: 50% minus 10 points per security level, never below 10%. */
export const BANK_STEAL_BASE_PERCENT = 50;
export const BANK_STEAL_STEP_PERCENT = 10;
export const BANK_STEAL_MIN_PERCENT = 10;

export const BANK_CAPACITY_PER_LEVEL = 20_000;

// price of level N+1 = basePrice * growth^N, rounded to 100.
export const UPGRADES = Object.freeze([
  { id: 'bank_security', emoji: '🛡️', name: t('Bank security'), description: t('Robbers take a smaller part of your bank.'), maxLevel: 4, basePrice: 10_000, growth: 2.2 },
  { id: 'bank_capacity', emoji: '🏦', name: t('Bigger vault'), description: t('More room in your bank.'), maxLevel: 10, basePrice: 5_000, growth: 1.5 },
  { id: 'interest', emoji: '📈', name: t('Interest'), description: t('`/daily` also pays a share of your bank.'), maxLevel: 5, basePrice: 15_000, growth: 1.8 },
  { id: 'work', emoji: '💼', name: t('Career'), description: t('Higher `/work` pay.'), maxLevel: 10, basePrice: 2_000, growth: 1.45 },
  { id: 'mine', emoji: '⛏️', name: t('Mining'), description: t('Higher `/mine` earnings.'), maxLevel: 10, basePrice: 3_000, growth: 1.45 },
  { id: 'fish', emoji: '🎣', name: t('Fishing'), description: t('Higher `/fish` earnings.'), maxLevel: 10, basePrice: 2_500, growth: 1.45 },
  { id: 'daily', emoji: '📅', name: t('Daily bonus'), description: t('Bigger `/daily` reward.'), maxLevel: 10, basePrice: 3_000, growth: 1.5 },
  { id: 'crime', emoji: '🦹', name: t('Street smarts'), description: t('Higher `/crime` and `/slut` payouts.'), maxLevel: 10, basePrice: 4_000, growth: 1.5 },
  { id: 'thief', emoji: '🥷', name: t('Thief'), description: t('Better `/rob` success chance.'), maxLevel: 5, basePrice: 5_000, growth: 1.8 },
  { id: 'luck', emoji: '🍀', name: t('Luck'), description: t('Better `/gamble` win chance.'), maxLevel: 5, basePrice: 5_000, growth: 1.8 },
  { id: 'stamina', emoji: '⚡', name: t('Stamina'), description: t('Shorter breaks after `/work`, `/mine`, `/fish` and `/beg`.'), maxLevel: 6, basePrice: 6_000, growth: 1.6 },
]);

const BY_ID = new Map(UPGRADES.map((upgrade) => [upgrade.id, upgrade]));

export const getUpgrade = (id) => BY_ID.get(id) ?? null;

export function getUpgradeLevel(userData, id) {
  const upgrade = BY_ID.get(id);
  const level = Number(userData?.upgrades?.[id]);
  if (!upgrade || !Number.isInteger(level) || level < 0) return 0;
  return Math.min(level, upgrade.maxLevel);
}

/** Price of the next level, or null when the upgrade is already at its highest level. */
export function upgradePrice(upgrade, level) {
  if (level >= upgrade.maxLevel) return null;
  return Math.round((upgrade.basePrice * upgrade.growth ** level) / 100) * 100;
}

// Bonuses read by the commands.
export const earningMultiplier = (userData, id) => 1 + getUpgradeLevel(userData, id) * 0.1;
export const bankStealPercent = (userData) =>
  Math.max(BANK_STEAL_MIN_PERCENT, BANK_STEAL_BASE_PERCENT - getUpgradeLevel(userData, 'bank_security') * BANK_STEAL_STEP_PERCENT);
export const extraBankCapacity = (userData) => getUpgradeLevel(userData, 'bank_capacity') * BANK_CAPACITY_PER_LEVEL;
export const interestPercent = (userData) => getUpgradeLevel(userData, 'interest');
export const robSuccessBonus = (userData) => getUpgradeLevel(userData, 'thief') * 5;
export const gambleWinBonus = (userData) => getUpgradeLevel(userData, 'luck') * 2;
export const staminaCooldown = (userData, ms) => Math.round(ms * (1 - getUpgradeLevel(userData, 'stamina') * 0.05));

/** "\n⚡ **Career 3/10:** +30% earnings" for the result message of an earning command, '' at level 0. */
export function upgradeBonusLine(userData, id, guildId = null) {
  const upgrade = BY_ID.get(id);
  const level = getUpgradeLevel(userData, id);
  if (!upgrade || level === 0) return '';
  return `\n${upgrade.emoji} **${t(upgrade.name)} ${level}/${upgrade.maxLevel}:** ${describeUpgradeEffect(upgrade, level, guildId)}`;
}

/** What the upgrade does at `level`, e.g. "+30% pay". */
export function describeUpgradeEffect(upgrade, level, guildId) {
  switch (upgrade.id) {
    case 'bank_security': return t`robbers take ${bankStealPercent({ upgrades: { bank_security: level } })}% of the bank`;
    case 'bank_capacity': return t`+${money(guildId, level * BANK_CAPACITY_PER_LEVEL)} bank space`;
    case 'interest': return t`${level}% of the bank with every /daily`;
    case 'thief': return t`+${level * 5}% robbery success`;
    case 'luck': return t`+${level * 2}% win chance`;
    case 'stamina': return t`-${level * 5}% break time`;
    default: return t`+${level * 10}% earnings`;
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
    const price = upgradePrice(upgrade, level);
    if (price === null) return { ok: false, reason: 'max', upgrade, userData };
    if (!spendMoney(userData, price)) return { ok: false, reason: 'money', upgrade, price, userData };

    userData.upgrades = { ...(userData.upgrades || {}), [upgrade.id]: level + 1 };
    await setEconomyData(client, guildId, userId, userData);
    return { ok: true, upgrade, level: level + 1, price, userData };
  });
}
