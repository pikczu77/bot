// halloween.js — the Halloween 2026 event (2026-10-29, owner: "zrobmy event halloween, ale ja chce z tego eventu duzo
// za pisanie ... w sklepie halloweenowym maja byc boosty ... najdrozsza ranga Halloween 2026").
//
// While the event runs every message on the server gives `perMessage` candies 🍬 (at most once per `cooldownSeconds`,
// it needs two letters or a file) and a caught chat drop gives `dropCandies` more (services/chatEngagement.js).
// Candies buy boosts (services/boosts.js), a pack, money and, as the most expensive thing, the role "Halloween 2026"
// (the picked one, else a role of that name, else the bot creates it). Earning stops at `endsAt`; the shop stays
// open SHOP_GRACE_MS longer. The announcement (events channel, else the chat channel) is deleted at the end and
// the top three are posted. Checked every minute (features.js).
//
// Store guild:{id}:halloween = { enabled, startsAt, endsAt, perMessage, cooldownSeconds, dropCandies, roleId, channelId,
//   totals: { userId: earned }, announcement: { channelId, messageId } | null, finished }.
// Member data: halloween = { year, candies, earned }.

import { PermissionFlagsBits } from 'discord.js';
import { createEmbed } from '../utils/embeds.js';
import { guildStore } from '../utils/featureKit.js';
import { logger } from '../utils/logger.js';
import { getEconomyData, setEconomyData } from '../utils/economy.js';
import { enterLocale, t } from '../i18n/index.js';
import { midnightOf } from '../utils/warsawTime.js';
import { getGuildLocale } from './languageService.js';
import { getEconomySettings, money, scaleEarnings } from './economySettings.js';
import { withEconomyLock } from './economyUpgrades.js';
import { addBoost, getBoostType, MAX_BOOST_HOURS } from './boosts.js';
import { openBonusPack, recordProgress } from './progress.js';

export const HALLOWEEN_YEAR = 2026;
export const ROLE_NAME = 'Halloween 2026';
const ROLE_COLOR = 0xFF7518;
export const SHOP_GRACE_MS = 24 * 60 * 60 * 1000;
export const HALLOWEEN_DEFAULTS = Object.freeze({
  enabled: true,
  startsAt: midnightOf('2026-10-29'),
  // The event runs through 2 November (Zaduszki) and ends at midnight.
  endsAt: midnightOf('2026-11-03'),
  perMessage: 5,
  cooldownSeconds: 20,
  dropCandies: 30,
  roleId: null,
  channelId: null,
});
// The panel may move the last day within this range.
export const LAST_DAY_RANGE = Object.freeze(['2026-10-29', '2026-11-15']);

export const HALLOWEEN_SHOP = Object.freeze([
  { id: 'money1', emoji: '💰', name: t('Double money for 1 h'), price: 150, boost: { type: 'money', minutes: 60 } },
  { id: 'money3', emoji: '💰', name: t('Double money for 3 h'), price: 400, boost: { type: 'money', minutes: 180 } },
  { id: 'xp1', emoji: '⭐', name: t('Double XP for 1 h'), price: 100, boost: { type: 'xp', minutes: 60 } },
  { id: 'xp3', emoji: '⭐', name: t('Double XP for 3 h'), price: 250, boost: { type: 'xp', minutes: 180 } },
  { id: 'pack', emoji: '🎁', name: t('Collector Pack'), price: 300, pack: 'kolekcjonera' },
  { id: 'cash', emoji: '💵', name: t('Bag of money'), price: 400, cash: 10_000 },
  { id: 'rank', emoji: '🎃', name: ROLE_NAME, price: 3_000, role: true },
]);
export const getShopItem = (id) => HALLOWEEN_SHOP.find((item) => item.id === id) ?? null;

const store = guildStore('halloween', { ...HALLOWEEN_DEFAULTS, totals: {}, announcement: null, finished: false });
// Read only, for the channel fallback (chatEngagement.js imports this file, so no import back).
const chatStore = guildStore('chat-engagement', {});

export const getHalloween = (guildId) => store.get(guildId);
export const updateHalloween = (guildId, mutate) => withEconomyLock(guildId, '#halloween', () => store.update(guildId, mutate));

export const halloweenActive = (settings, now = Date.now()) => Boolean(settings?.enabled) && now >= settings.startsAt && now < settings.endsAt;
export const shopOpen = (settings, now = Date.now()) => Boolean(settings?.enabled) && now >= settings.startsAt && now < settings.endsAt + SHOP_GRACE_MS;

/** This year's candies of a member: { candies, earned }. */
export function candiesOf(userData) {
  const data = userData?.halloween;
  return data?.year === HALLOWEEN_YEAR ? { candies: Math.max(0, Number(data.candies) || 0), earned: Math.max(0, Number(data.earned) || 0) } : { candies: 0, earned: 0 };
}

/** Add (or with a negative amount take) candies. Mutates `userData`. */
export function addCandies(userData, amount) {
  const { candies, earned } = candiesOf(userData);
  userData.halloween = { year: HALLOWEEN_YEAR, candies: candies + amount, earned: earned + Math.max(0, amount) };
  return userData.halloween;
}

async function noteTotal(guildId, userId, amount) {
  if (amount <= 0) return;
  await updateHalloween(guildId, (data) => {
    data.totals = { ...(data.totals ?? {}), [userId]: (Number(data.totals?.[userId]) || 0) + amount };
  });
}

// ---------------------------------------------------------------- earning

const lastAward = new Map(); // `${guildId}:${userId}` -> time of the last candies for a message
const TWO_LETTERS_RE = /\p{L}.*\p{L}/su;

/** featureMessages.js: a member wrote. Returns the candies given (0 when none). */
export async function handleHalloweenMessage(message, now = Date.now()) {
  if (!message.guild || message.author?.bot) return 0;
  const settings = await getHalloween(message.guild.id);
  if (!halloweenActive(settings, now) || settings.perMessage <= 0) return 0;
  if (!TWO_LETTERS_RE.test(message.content ?? '') && !(message.attachments?.size > 0)) return 0;
  const key = `${message.guild.id}:${message.author.id}`;
  if (now - (lastAward.get(key) ?? 0) < settings.cooldownSeconds * 1000) return 0;
  if (lastAward.size > 50_000) lastAward.clear();
  lastAward.set(key, now);
  await giveCandies(message.client, message.guild.id, message.author.id, settings.perMessage, now);
  return settings.perMessage;
}

/** Give candies to a member (messages, drops). */
export async function giveCandies(client, guildId, userId, amount, now = Date.now()) {
  const economy = await getEconomySettings(guildId);
  await withEconomyLock(guildId, userId, async () => {
    const userData = await getEconomyData(client, guildId, userId, { joint: false });
    addCandies(userData, amount);
    recordProgress(userData, { candies: amount }, { settings: economy, now });
    await setEconomyData(client, guildId, userId, userData);
  });
  await noteTotal(guildId, userId, amount);
}

/** Candies for a caught chat drop now (0 outside the event). */
export async function dropCandies(guildId, now = Date.now()) {
  const settings = await getHalloween(guildId);
  return halloweenActive(settings, now) ? Math.max(0, Number(settings.dropCandies) || 0) : 0;
}

// ---------------------------------------------------------------- shop

async function rankRole(guild, settings, userError) {
  let role = settings.roleId ? guild.roles.cache.get(settings.roleId) : null;
  role ??= [...guild.roles.cache.values()].find((entry) => entry.name === ROLE_NAME) ?? null;
  if (!role) {
    if (!guild.members.me?.permissions?.has?.(PermissionFlagsBits.ManageRoles)) {
      throw userError(t`The bot cannot create the role ${ROLE_NAME} (it needs Manage Roles). Tell an admin.`);
    }
    role = await guild.roles.create({ name: ROLE_NAME, color: ROLE_COLOR, hoist: true, reason: 'Halloween 2026 event (/halloween)' })
      .catch(() => null);
    if (!role) throw userError(t`The bot could not create the role ${ROLE_NAME}. Tell an admin.`);
  }
  if (settings.roleId !== role.id) await updateHalloween(guild.id, (data) => { data.roleId = role.id; });
  return role;
}

/**
 * Buy an item of the Halloween shop with candies. Returns { item, candies, note, progress }.
 * Throws `userError(text)` when not possible.
 */
export async function buyHalloweenItem({ client, guild, member, itemId, userError, now = Date.now() }) {
  const item = getShopItem(itemId);
  if (!item) throw userError(t('Pick an item from the list.'));
  const settings = await getHalloween(guild.id);
  if (!shopOpen(settings, now)) throw userError(t('The Halloween shop is closed.'));
  const role = item.role ? await rankRole(guild, settings, userError) : null;
  if (role && member.roles?.cache?.has?.(role.id)) throw userError(t`You already have the role ${ROLE_NAME}.`);
  const economy = await getEconomySettings(guild.id);

  return withEconomyLock(guild.id, member.id, async () => {
    const userData = await getEconomyData(client, guild.id, member.id, { joint: false });
    const { candies } = candiesOf(userData);
    if (candies < item.price) throw userError(t`${item.emoji} ${item.name} costs **${item.price} 🍬** - you have ${candies} 🍬. Write on the server to get more.`);
    let note = '';
    let progress = null;
    if (item.boost) {
      const until = addBoost(userData, item.boost.type, item.boost.minutes, now);
      if (!until) throw userError(t`A boost can run at most ${MAX_BOOST_HOURS} h ahead. Wait until it runs down a little.`);
      note = t`${getBoostType(item.boost.type).emoji} runs until <t:${Math.floor(until / 1000)}:t>.`;
    } else if (item.pack) {
      const { drawn } = openBonusPack(userData, item.pack);
      progress = recordProgress(userData, { packs: 1 }, { settings: economy, now });
      note = drawn.map(({ card, variant, isNew }) => `${variant.emoji || card.emoji} ${card.name}${isNew ? ' 🆕' : ''}`).join(', ');
    } else if (item.cash) {
      const amount = scaleEarnings(economy, item.cash);
      userData.wallet = (Number(userData.wallet) || 0) + amount;
      note = t`+${money(guild.id, amount)} in cash.`;
    } else if (role) {
      const added = await member.roles.add(role, 'Halloween 2026 shop').then(() => true).catch(() => false);
      if (!added) throw userError(t`The bot could not give you the role ${ROLE_NAME} (its own role must be higher). Your candies stay.`);
      note = t`You have the role <@&${role.id}>. 🎃`;
    }
    addCandies(userData, -item.price);
    await setEconomyData(client, guild.id, member.id, userData);
    return { item, candies: candiesOf(userData).candies, note, progress };
  });
}

/** The best collectors of the event: [{ userId, earned }]. */
export async function candyRanking(guildId, limit = 10) {
  const settings = await getHalloween(guildId);
  return Object.entries(settings.totals ?? {})
    .map(([userId, earned]) => ({ userId, earned: Number(earned) || 0 }))
    .sort((a, b) => b.earned - a.earned)
    .slice(0, limit);
}

// ---------------------------------------------------------------- announcement

async function announcementChannel(guild, settings) {
  const economy = await getEconomySettings(guild.id);
  const chat = await chatStore.get(guild.id);
  const id = settings.channelId || economy.events?.channelId || chat.channelId;
  return id ? guild.channels.cache.get(id) ?? null : null;
}

export function announcementEmbed(settings) {
  return createEmbed({
    title: t('🎃 Halloween on the server!'),
    description: [
      t`Every message gives **${settings.perMessage} 🍬** (at most once every ${settings.cooldownSeconds} s). A caught chat drop gives **${settings.dropCandies} 🍬** more.`,
      t`Spend your candies in \`/halloween sklep\`: double money, double XP, packs, money and the rank **${ROLE_NAME}**.`,
      t`Until <t:${Math.floor(settings.endsAt / 1000)}:f>. The shop stays open one day longer. \`/halloween ranking\``,
    ].join('\n'),
    color: '#FF7518',
    footer: false,
  });
}

/** Post the announcement at the start, delete it and post the top three at the end. */
export async function tickHalloween(client, guild, now = Date.now()) {
  const settings = await getHalloween(guild.id);
  if (halloweenActive(settings, now) && !settings.announcement) {
    const channel = await announcementChannel(guild, settings);
    if (!channel?.send) return;
    const message = await channel.send({ embeds: [announcementEmbed(settings)] })
      .catch((error) => { logger.warn(`Halloween announcement not posted in guild ${guild.id}: ${error.message}`); return null; });
    await updateHalloween(guild.id, (data) => { data.announcement = { channelId: channel.id, messageId: message?.id ?? null }; });
    return;
  }
  const over = now >= settings.endsAt || !settings.enabled;
  if (!over || !settings.announcement) return;
  const { channelId, messageId } = settings.announcement;
  const channel = guild.channels.cache.get(channelId);
  if (messageId) await channel?.messages?.delete?.(messageId).catch(() => {});
  await updateHalloween(guild.id, (data) => { data.announcement = null; data.finished = true; });
  const top = (await candyRanking(guild.id, 3)).filter((row) => row.earned > 0);
  if (!settings.enabled || !top.length || !channel?.send) return;
  const medals = ['🥇', '🥈', '🥉'];
  await channel.send({
    embeds: [createEmbed({
      title: t('🎃 Halloween is over'),
      description: top.map((row, index) => `${medals[index]} <@${row.userId}> · **${row.earned} 🍬**`).join('\n')
        + t('\n\nThanks for chatting! The shop is open one more day: `/halloween sklep`.'),
      color: '#FF7518',
      footer: false,
    })],
    allowedMentions: { parse: [] },
  }).catch(() => {});
}

export async function runHalloween(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      enterLocale(await getGuildLocale(guild.id));
      await tickHalloween(client, guild);
    } catch (error) {
      logger.warn(`Halloween failed in guild ${guild.id}: ${error.message}`);
    }
  }
}
