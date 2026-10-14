// economySettings.js — per-guild economy settings: currency, starting money, payouts
// and cooldowns of the earning commands, where the commands work, and the shop.
// Edited from the web panel (src/api/panelApi.js) and the /economy dashboard.

import { PermissionFlagsBits } from 'discord.js';
import { guildStore } from '../utils/featureKit.js';
import { botConfig } from '../config/bot.js';
import { shopItems } from '../config/shop/items.js';
import { t } from '../i18n/index.js';

const base = botConfig.economy ?? {};
const toMinutes = (ms, fallback) => Math.max(1, Math.round((Number(ms) || fallback) / 60_000));

export const ECONOMY_DEFAULTS = Object.freeze({
  currency: { symbol: base.currency?.symbol || '$', position: 'left', separator: ',' },
  startingWallet: Number(base.startingBalance) || 0,
  startingBank: 0,
  clearOnLeave: false,
  payTaxPercent: 0,
  // Money for chatting: `amount` per message, at most once per `cooldownSeconds`.
  activity: { enabled: false, amount: 5, cooldownSeconds: 60 },
  // mode "block": commands work everywhere except the listed; "allow": only on the listed.
  channels: { mode: 'block', list: [] },
  roles: { mode: 'block', list: [] },
  commands: {
    daily: { amount: Number(base.dailyAmount) || 100, cooldownMinutes: 1440 },
    work: { min: Number(base.workMin) || 10, max: Number(base.workMax) || 100, cooldownMinutes: toMinutes(base.cooldowns?.work, 30 * 60_000) },
    beg: { min: Number(base.begMin) || 50, max: Number(base.begMax) || 200, cooldownMinutes: 30, successPercent: 70 },
    fish: { min: 300, max: 900, cooldownMinutes: 45 },
    mine: { min: 400, max: 1200, cooldownMinutes: 60 },
    // payoutPercent scales the built-in payout tables (100 = unchanged).
    crime: { cooldownMinutes: 60, jailMinutes: 120, finePercent: 20, payoutPercent: 100 },
    slut: { cooldownMinutes: 45, payoutPercent: 100 },
    rob: {
      cooldownMinutes: toMinutes(base.cooldowns?.rob, 4 * 60 * 60_000),
      successPercent: Math.round((Number(base.robSuccessRate) || 0.4) * 100),
      // Share of the victim's cash a successful /rob takes. The bank part depends on the
      // victim's "Bank security" upgrade (services/economyUpgrades.js).
      stealPercent: 80,
      finePercent: 10,
      minVictimCash: 500,
    },
    // payoutPercent 200 = a won bet is doubled. maxBet 0 = no limit.
    gamble: { cooldownMinutes: 5, winPercent: 40, payoutPercent: 200, maxBet: 0 },
  },
  // items: { [itemId]: { enabled, price } } overrides for the built-in items.
  // roles: [{ roleId, price, description }] roles members can buy.
  shop: { items: {}, roles: [] },
});

const MAX_MONEY = 1_000_000_000;
const MAX_COOLDOWN = 30 * 24 * 60;

/** Allowed range of every number in `commands` — the panel API validates against this. */
export const COMMAND_LIMITS = Object.freeze({
  daily: { amount: [0, MAX_MONEY], cooldownMinutes: [1, MAX_COOLDOWN] },
  work: { min: [0, MAX_MONEY], max: [0, MAX_MONEY], cooldownMinutes: [0, MAX_COOLDOWN] },
  beg: { min: [0, MAX_MONEY], max: [0, MAX_MONEY], cooldownMinutes: [0, MAX_COOLDOWN], successPercent: [0, 100] },
  fish: { min: [0, MAX_MONEY], max: [0, MAX_MONEY], cooldownMinutes: [0, MAX_COOLDOWN] },
  mine: { min: [0, MAX_MONEY], max: [0, MAX_MONEY], cooldownMinutes: [0, MAX_COOLDOWN] },
  crime: { cooldownMinutes: [0, MAX_COOLDOWN], jailMinutes: [0, MAX_COOLDOWN], finePercent: [0, 100], payoutPercent: [1, 10_000] },
  slut: { cooldownMinutes: [0, MAX_COOLDOWN], payoutPercent: [1, 10_000] },
  rob: { cooldownMinutes: [0, MAX_COOLDOWN], successPercent: [0, 100], stealPercent: [1, 100], finePercent: [0, 100], minVictimCash: [0, MAX_MONEY] },
  gamble: { cooldownMinutes: [0, MAX_COOLDOWN], winPercent: [1, 99], payoutPercent: [101, 10_000], maxBet: [0, MAX_MONEY] },
});

export const CURRENCY_POSITIONS = ['left', 'right'];
export const CURRENCY_SEPARATORS = [',', '.', ' ', ''];
export const LIST_MODES = ['block', 'allow'];
export const MAX_SHOP_ROLES = 25;
export { MAX_MONEY };

const store = guildStore('economy-settings', {});
const cache = new Map(); // guildId -> settings

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function normalize(stored) {
  const settings = structuredClone(ECONOMY_DEFAULTS);
  if (!isPlainObject(stored)) return settings;

  for (const key of ['startingWallet', 'startingBank', 'clearOnLeave', 'payTaxPercent']) {
    if (key in stored) settings[key] = stored[key];
  }
  for (const key of ['currency', 'activity', 'channels', 'roles']) {
    if (isPlainObject(stored[key])) Object.assign(settings[key], stored[key]);
  }
  for (const name of Object.keys(settings.commands)) {
    if (isPlainObject(stored.commands?.[name])) Object.assign(settings.commands[name], stored.commands[name]);
  }
  // 15% was the old default cash share of /rob; since 2026-10-14 it is 80% (with the bank also at risk).
  if (stored.commands?.rob?.stealPercent === 15) settings.commands.rob.stealPercent = 80;
  if (isPlainObject(stored.shop)) {
    settings.shop = {
      items: isPlainObject(stored.shop.items) ? stored.shop.items : {},
      roles: Array.isArray(stored.shop.roles) ? stored.shop.roles : [],
    };
  }
  return settings;
}

export async function getEconomySettings(guildId) {
  const cached = cache.get(guildId);
  if (cached) return cached;
  const settings = normalize(await store.get(guildId));
  cache.set(guildId, settings);
  return settings;
}

/** Change the settings: `mutate` edits the object in place. Returns the saved settings. */
export async function updateEconomySettings(guildId, mutate) {
  const settings = normalize(await store.get(guildId));
  await mutate(settings);
  await store.set(guildId, settings);
  cache.set(guildId, settings);
  return settings;
}

const GROUP_RE = /\B(?=(\d{3})+(?!\d))/g;
// "$", "€", "🪙" sit right next to the number; words and custom emoji get a space.
const TIGHT_SYMBOL_RE = /^[^\p{L}\p{N}<\s]{1,2}$/u;

export function formatMoney(settings, amount) {
  const { symbol, position, separator } = settings.currency;
  const value = Math.trunc(Number(amount) || 0);
  const digits = String(Math.abs(value)).replace(GROUP_RE, separator);
  const gap = TIGHT_SYMBOL_RE.test(symbol) ? '' : ' ';
  const text = position === 'right' ? `${digits}${gap}${symbol}` : `${symbol}${gap}${digits}`;
  return value < 0 ? `-${text}` : text;
}

/**
 * Format an amount in the guild's currency. Synchronous: uses the settings loaded by
 * the last getEconomySettings() call for that guild (every economy command and
 * getEconomyData() load them first).
 */
export function money(guildId, amount) {
  return formatMoney(cache.get(guildId) ?? ECONOMY_DEFAULTS, amount);
}

/** A currency symbol: short text or one custom emoji; no mentions, line breaks or code marks. */
export function isValidCurrencySymbol(value) {
  return typeof value === 'string' && value.trim().length >= 1 && value.length <= 64 && !/[@`\r\n]/.test(value);
}

export const cooldownMs = (minutes) => Math.max(0, Number(minutes) || 0) * 60_000;

function listAllows({ mode, list }, ids) {
  if (!Array.isArray(list) || list.length === 0) return true;
  const listed = ids.some((id) => list.includes(id));
  return mode === 'allow' ? listed : !listed;
}

/**
 * Why this member cannot use an economy command here, or null when they can.
 * Members who manage the server are never restricted.
 */
export async function getEconomyAccessDenial({ guild, member, channel }, command) {
  if (!guild || command?.category !== 'Economy') return null;
  const settings = await getEconomySettings(guild.id);
  if (member?.permissions?.has?.(PermissionFlagsBits.ManageGuild)) return null;

  const channelIds = [channel?.id, channel?.parentId].filter(Boolean);
  if (!listAllows(settings.channels, channelIds)) {
    if (settings.channels.mode === 'allow') {
      const mentions = settings.channels.list.slice(0, 5).map((id) => `<#${id}>`).join(', ');
      return t`Economy commands work only in: ${mentions}`;
    }
    return t('Economy commands are switched off in this channel.');
  }

  const roleIds = member?.roles?.cache ? [...member.roles.cache.keys()] : [];
  if (!listAllows(settings.roles, roleIds)) {
    return t('Your roles do not allow you to use economy commands.');
  }
  return null;
}

export const shopRoleItemId = (roleId) => `role_${roleId}`;

/** Every shop item with this guild's price: built-in items plus roles for sale. */
export function getShopCatalog(settings, guild = null) {
  const builtIn = shopItems.map((item) => {
    const override = settings.shop.items[item.id] ?? {};
    return {
      ...item,
      defaultPrice: item.price,
      price: Number.isInteger(override.price) ? override.price : item.price,
      enabled: override.enabled !== false,
    };
  });

  const roles = settings.shop.roles.map((entry) => {
    const role = guild?.roles.cache.get(entry.roleId) ?? null;
    return {
      id: shopRoleItemId(entry.roleId),
      name: role ? `🎭 ${role.name}` : t('Role'),
      price: entry.price,
      description: entry.description || t('A role you can buy.'),
      type: 'role',
      roleId: entry.roleId,
      enabled: !guild || Boolean(role),
      custom: true,
    };
  });

  return [...builtIn, ...roles];
}

/** Items members can buy right now. */
export function getShopItems(settings, guild = null) {
  return getShopCatalog(settings, guild).filter((item) => item.enabled);
}
