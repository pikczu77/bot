// properties.js — /nieruchomosci: buildings that bring money every hour (2026-10-27, owner picked idea 10).
//
// Six buildings, each owned once. A building earns `income` a day (counted by the hour) times the server
// multiplier and commands.property.incomePercent; Fortune and events do not count (passive money). The rent
// waits in the building until /nieruchomosci odbierz, at most commands.property.maxHours of it, so members
// have to come back. Three upgrade levels, each +30% rent for 50% / 75% / 100% of the price. Selling returns
// commands.property.sellPercent of everything spent on the building. Buildings are safe from /rob.
//
// Member data: properties = { [id]: { level, collectedAt, spent } }.

import { getEconomyData, setEconomyData } from '../utils/economy.js';
import { t } from '../i18n/index.js';
import { getEconomySettings, money, scaleEarnings } from './economySettings.js';
import { spendMoney, withEconomyLock } from './economyUpgrades.js';
import { recordProgress } from './progress.js';

// income = money a day before upgrades; pays back the price in about 20-28 days.
export const PROPERTIES = Object.freeze([
  { id: 'namiot', emoji: '⛺', name: t('Tent'), price: 5_000, income: 250 },
  { id: 'kawalerka', emoji: '🏚️', name: t('Studio flat'), price: 20_000, income: 900 },
  { id: 'dom', emoji: '🏠', name: t('House'), price: 60_000, income: 2_500 },
  { id: 'sklep', emoji: '🏪', name: t('Corner shop'), price: 120_000, income: 4_800 },
  { id: 'kamienica', emoji: '🏢', name: t('Tenement house'), price: 300_000, income: 11_500 },
  { id: 'zamek', emoji: '🏰', name: t('Castle'), price: 1_000_000, income: 36_000 },
]);
export const getProperty = (id) => PROPERTIES.find((property) => property.id === id) ?? null;

export const MAX_PROPERTY_LEVEL = 3;
export const LEVEL_INCOME_PERCENT = 30;
const HOUR_MS = 3_600_000;

/** Price of upgrade level `level` (1-3): 50%, 75%, 100% of the building's price. */
export const propertyUpgradePrice = (property, level) => Math.round(property.price * (0.25 + 0.25 * level));

export const ownedProperty = (userData, id) => {
  const entry = userData?.properties?.[id];
  return entry ? { level: Math.max(0, Math.min(MAX_PROPERTY_LEVEL, Number(entry.level) || 0)), collectedAt: Number(entry.collectedAt) || 0, spent: Number(entry.spent) || 0 } : null;
};

/** Rent a day of a building at `level` on this server. */
export function dailyIncome(settings, property, level = 0) {
  const percent = Number(settings?.commands?.property?.incomePercent ?? 100);
  return scaleEarnings(settings, property.income * (100 + level * LEVEL_INCOME_PERCENT) / 100 * percent / 100);
}

/** Rent waiting in one building: { amount, hours, full }. */
export function waitingRent(settings, property, owned, now = Date.now()) {
  const maxHours = Math.max(1, Number(settings?.commands?.property?.maxHours) || 48);
  const hours = Math.min(maxHours, Math.max(0, Math.floor((now - owned.collectedAt) / HOUR_MS)));
  return { amount: Math.floor(dailyIncome(settings, property, owned.level) * hours / 24), hours, full: hours >= maxHours };
}

/** Everything a member owns: rows with rent waiting, and the totals. */
export function propertyOverview(settings, userData, now = Date.now()) {
  const rows = PROPERTIES.map((property) => {
    const owned = ownedProperty(userData, property.id);
    return owned ? { property, owned, daily: dailyIncome(settings, property, owned.level), waiting: waitingRent(settings, property, owned, now) } : null;
  }).filter(Boolean);
  return {
    rows,
    daily: rows.reduce((sum, row) => sum + row.daily, 0),
    waiting: rows.reduce((sum, row) => sum + row.waiting.amount, 0),
  };
}

function setOwned(userData, id, owned) {
  const properties = { ...(userData.properties ?? {}) };
  if (owned) properties[id] = owned;
  else delete properties[id];
  userData.properties = properties;
}

const findProperty = (id, userError) => {
  const property = getProperty(id);
  if (!property) throw userError(t('Pick a building from the list.'));
  return property;
};

/** Buy a building (cash first, then the bank). Returns { property, price, progress }. */
export function buyProperty({ client, guildId, userId, propertyId, userError, now = Date.now() }) {
  const property = findProperty(propertyId, userError);
  return withEconomyLock(guildId, userId, async () => {
    const settings = await getEconomySettings(guildId);
    const userData = await getEconomyData(client, guildId, userId);
    if (ownedProperty(userData, property.id)) throw userError(t`You already own the ${property.emoji} ${property.name}. Upgrade it with \`/nieruchomosci ulepsz\`.`);
    if (!spendMoney(userData, property.price)) {
      throw userError(t`The ${property.emoji} ${property.name} costs ${money(guildId, property.price)} - you do not have that much (cash and bank).`);
    }
    setOwned(userData, property.id, { level: 0, collectedAt: now, spent: property.price });
    const progress = recordProgress(userData, { propertyBuy: 1 }, { settings, now });
    await setEconomyData(client, guildId, userId, userData);
    return { property, price: property.price, progress };
  });
}

/** Take the rent of every building into cash. Returns { total, rows, progress }. */
export function collectRent({ client, guildId, userId, userError, now = Date.now() }) {
  return withEconomyLock(guildId, userId, async () => {
    const settings = await getEconomySettings(guildId);
    const userData = await getEconomyData(client, guildId, userId);
    const { rows } = propertyOverview(settings, userData, now);
    if (!rows.length) throw userError(t('You have no buildings yet. See `/nieruchomosci lista`.'));
    const total = rows.reduce((sum, row) => sum + row.waiting.amount, 0);
    if (total <= 0) throw userError(t('No rent yet: buildings pay by the full hour. Come back later.'));
    for (const row of rows) {
      // A full building starts again now; otherwise the part of the hour not paid yet carries over.
      const collectedAt = row.waiting.full ? now : row.owned.collectedAt + row.waiting.hours * HOUR_MS;
      setOwned(userData, row.property.id, { ...row.owned, collectedAt });
    }
    userData.wallet = (Number(userData.wallet) || 0) + total;
    const progress = recordProgress(userData, { propertyCollect: 1, propertyIncome: total }, { settings, now });
    await setEconomyData(client, guildId, userId, userData);
    return { total, rows, progress };
  });
}

/** Buy the next upgrade level. The rent waiting so far is paid at the old level first. Returns { property, level, price, rent }. */
export function upgradeProperty({ client, guildId, userId, propertyId, userError, now = Date.now() }) {
  const property = findProperty(propertyId, userError);
  return withEconomyLock(guildId, userId, async () => {
    const settings = await getEconomySettings(guildId);
    const userData = await getEconomyData(client, guildId, userId);
    const owned = ownedProperty(userData, property.id);
    if (!owned) throw userError(t`You do not own the ${property.emoji} ${property.name}.`);
    if (owned.level >= MAX_PROPERTY_LEVEL) throw userError(t`The ${property.emoji} ${property.name} is already at the top level.`);
    const price = propertyUpgradePrice(property, owned.level + 1);
    const rent = waitingRent(settings, property, owned, now).amount;
    userData.wallet = (Number(userData.wallet) || 0) + rent;
    if (!spendMoney(userData, price)) {
      throw userError(t`Level ${owned.level + 1} of the ${property.emoji} ${property.name} costs ${money(guildId, price)} - you do not have that much (cash and bank).`);
    }
    setOwned(userData, property.id, { level: owned.level + 1, collectedAt: now, spent: owned.spent + price });
    await setEconomyData(client, guildId, userId, userData);
    return { property, level: owned.level + 1, price, rent };
  });
}

/** Sell a building: sellPercent of what it cost, plus the rent waiting in it. Returns { property, price, rent }. */
export function sellProperty({ client, guildId, userId, propertyId, userError, now = Date.now() }) {
  const property = findProperty(propertyId, userError);
  return withEconomyLock(guildId, userId, async () => {
    const settings = await getEconomySettings(guildId);
    const userData = await getEconomyData(client, guildId, userId);
    const owned = ownedProperty(userData, property.id);
    if (!owned) throw userError(t`You do not own the ${property.emoji} ${property.name}.`);
    const price = Math.floor(owned.spent * (Number(settings.commands.property.sellPercent) || 0) / 100);
    const rent = waitingRent(settings, property, owned, now).amount;
    userData.wallet = (Number(userData.wallet) || 0) + price + rent;
    setOwned(userData, property.id, null);
    await setEconomyData(client, guildId, userId, userData);
    return { property, price, rent };
  });
}
