// serverBoost.js — rewards for members who boost the server (2026-11-01, owner: "trzeba cos wymyslic dla boostow").
// Not /boosty (services/boosts.js): those are x2 potions bought with money.
//
// Perks, set in the panel (settings.serverBoost, economySettings.js): thanks on a channel, money and a free pack when a
// boost starts and every 30 days after that, +% money and +% XP while boosting (userData.serverBooster), a short x2 money
// event for the whole server, an own role with a name and a colour (/booster rola), two badges (stat boostRewards).
//
// Three things lead here: guildMemberUpdate (premiumSince changed), the system message "X boosted the server" (the only
// sign of a second boost by the same member) and the job every 10 minutes (what happened while the bot was off, the
// 30-day rewards). All of them may fire for one boost, so every decision is taken and saved inside the store lock.
//
// Store guild:{id}:server-boost = { members: { [userId]: { active, since, nextRewardAt, rewards, lastThanksAt, lastEventAt, roleId, roleChangedAt } },
// info: { channelId, messageId } } (the "what a boost gives" message posted from the panel).
// nextRewardAt stays after a boost ends: taking a boost off and on again pays nothing extra.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageType, PermissionFlagsBits, resolveColor } from 'discord.js';
import { createEmbed } from '../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../utils/economy.js';
import { guildStore, userError } from '../utils/featureKit.js';
import { createTraceId, logger, runWithTraceContext } from '../utils/logger.js';
import { enterLocale, t, tr } from '../i18n/index.js';
import { getGuildLocale } from './languageService.js';
import { findBannedWord, findSlur, getAutomodConfig } from './automodService.js';
import { PACKS } from './collections.js';
import { activeEventType, getEconomySettings, money } from './economySettings.js';
import { MIN_EVENT_MINUTES, startEvent } from './economyEvents.js';
import { withEconomyLock } from './economyUpgrades.js';
import { openBonusPack, recordProgress } from './progress.js';

export const REWARD_EVERY_DAYS = 30;
export const REWARD_EVERY_MS = REWARD_EVERY_DAYS * 86_400_000;
export const THANKS_GAP_MS = 86_400_000;
export const EVENT_GAP_MS = 7 * 86_400_000;
export const ROLE_CHANGE_GAP_MS = 10 * 60_000;
export const ROLE_NAME_MAX = 32;
export const MESSAGE_MAX = 500;
const ROLE_NAME_MIN = 2;
// A boost the job finds this soon after it started still gets the thanks and the event. Older ones (members who boosted
// before this code, a long time offline) only get the reward.
const FRESH_MS = 2 * 3_600_000;
const MEMBERS_FETCH_EVERY_MS = 3_600_000;
const LOCK = '#server-boost';
const GONE_CODES = new Set([10007, 10013]); // Unknown Member, Unknown User
const COLOR = '#F47FFF';
const COLOR_RE = /^#?[0-9a-f]{6}$/i;
const RESERVED_ROLE_NAME = /admin|moder|\bmod\b|w[lł]a[sś]ciciel|owner|staff|ekipa|support|discord|everyone|https?:|[@#`]/iu;

export const BOOST_MESSAGE_TYPES = new Set([MessageType.GuildBoost, MessageType.GuildBoostTier1, MessageType.GuildBoostTier2, MessageType.GuildBoostTier3]);

const store = guildStore('server-boost', { members: {} });
export const getBoostData = (guildId) => store.get(guildId);

export const perksOn = (settings) => settings?.serverBoost?.enabled !== false;
const rewardPack = (settings) => PACKS.find((pack) => pack.id === settings.serverBoost.pack) ?? null;
const rewardCash = (settings) => Math.max(0, Number(settings.serverBoost.cashReward) || 0);
const hasReward = (settings) => rewardCash(settings) > 0 || Boolean(rewardPack(settings));

export const defaultThanks = () => t('💎 {user} boosted {server}! Thank you!');

/** The perks as they are set now, one line each (/booster info and the info message). */
export function perkLines(guildId, boost) {
  const pack = PACKS.find((item) => item.id === boost.pack) ?? null;
  const reward = [boost.cashReward > 0 ? `**${money(guildId, boost.cashReward)}**` : null, pack ? `${pack.emoji} ${tr(pack.name)}` : null].filter(Boolean).join(' + ');
  return [
    reward ? t`🎁 ${reward} at once, then every ${REWARD_EVERY_DAYS} days of boosting` : null,
    boost.moneyPercent > 0 ? t`💰 **+${boost.moneyPercent}%** of every payout while you boost` : null,
    boost.xpPercent > 0 ? t`⭐ **+${boost.xpPercent}%** XP for messages while you boost` : null,
    boost.customRole ? t`🎨 your own role, name and colour: \`/booster rola\`` : null,
    boost.eventMinutes > 0 ? t`💸 **${boost.eventMinutes} min** of double money for the whole server` : null,
    t('🏅 two badges in `/osiagniecia`'),
  ].filter(Boolean);
}

async function setBoosterFlag(client, guildId, userId, on) {
  await withEconomyLock(guildId, userId, async () => {
    const userData = await getEconomyData(client, guildId, userId);
    if (Boolean(userData.serverBooster) === on) return;
    userData.serverBooster = on;
    await setEconomyData(client, guildId, userId, userData);
  });
}

// The trace names the source in the economy statistics: events carry no trace and would count as chat money.
function payReward(client, guildId, userId, settings, now, random) {
  return runWithTraceContext({ traceId: createTraceId('job'), command: 'job:server_boost' }, () => withEconomyLock(guildId, userId, async () => {
    const userData = await getEconomyData(client, guildId, userId);
    const cash = rewardCash(settings);
    const pack = rewardPack(settings);
    userData.wallet = (Number(userData.wallet) || 0) + cash;
    userData.serverBooster = true;
    const opened = pack ? openBonusPack(userData, pack.id, random) : null;
    recordProgress(userData, { boostRewards: 1 }, { settings, now, random });
    await setEconomyData(client, guildId, userId, userData);
    return { cash, pack: opened?.pack ?? null, drawn: opened?.drawn ?? [] };
  }));
}

async function deleteRole(guild, roleId) {
  const role = roleId ? guild.roles.cache.get(roleId) : null;
  await role?.delete(t('The boost ended or the own role was removed')).catch((error) => {
    logger.warn(`Booster role ${roleId} not deleted in guild ${guild.id}: ${error.message}`);
  });
}

/** A boost is over (or the member left): no more bonus, the own role goes. Keeps nextRewardAt. */
async function endBoost(guild, userId) {
  await withEconomyLock(guild.id, LOCK, async () => {
    const data = await store.get(guild.id);
    const entry = data.members?.[userId];
    if (!entry?.active) return;
    await deleteRole(guild, entry.roleId);
    entry.active = false;
    entry.roleId = null;
    await store.set(guild.id, data);
    await setBoosterFlag(guild.client, guild.id, userId, false);
  });
}

function canThrowParty(settings, entry, now) {
  const minutes = Number(settings.serverBoost.eventMinutes) || 0;
  return minutes >= MIN_EVENT_MINUTES && now - (Number(entry.lastEventAt) || 0) >= EVENT_GAP_MS && !activeEventType(settings, now);
}

function thanksMessage(guild, member, settings, entry, { thanks, reward, partyMinutes }) {
  const text = (settings.serverBoost.message || defaultThanks())
    .replaceAll('{user}', member.toString())
    .replaceAll('{server}', guild.name)
    .replaceAll('{boosts}', String(guild.premiumSubscriptionCount ?? 0));
  const lines = thanks ? [text] : [t`💎 ${member.toString()}: reward number ${entry.rewards} for boosting. Thank you!`];
  if (reward) {
    const parts = [];
    if (reward.cash > 0) parts.push(`**+${money(guild.id, reward.cash)}**`);
    if (reward.pack) parts.push(`${reward.pack.emoji} ${tr(reward.pack.name)}: ${reward.drawn.map(({ card, variant, isNew }) => `${variant.emoji || card.emoji} ${card.name}${isNew ? ' 🆕' : ''}`).join(', ')}`);
    lines.push(`🎁 ${parts.join(' · ')}`);
  }
  if (partyMinutes) lines.push(t`💸 **Double money for everyone** for ${partyMinutes} min!`);
  lines.push(t`-# What a boost gives: \`/booster info\``);
  return {
    content: member.toString(),
    embeds: [createEmbed({ description: lines.join('\n'), color: COLOR, footer: false })],
    allowedMentions: { parse: [], users: [member.id] },
  };
}

/**
 * Bring one member's record in line with Discord: bonus flag, reward when it is due, thanks and event for a new boost.
 * `boosted`: this call comes from a real new boost (not from the job). Safe to call any number of times.
 */
export async function processBooster(guild, member, { boosted = false, now = Date.now(), random = Math.random } = {}) {
  if (!member?.premiumSinceTimestamp) {
    await endBoost(guild, member.id);
    return null;
  }
  const settings = await getEconomySettings(guild.id);
  const result = await withEconomyLock(guild.id, LOCK, async () => {
    const data = await store.get(guild.id);
    data.members ??= {};
    const entry = data.members[member.id] ?? {};
    const isNew = boosted || (!entry.active && now - member.premiumSinceTimestamp < FRESH_MS);
    entry.active = true;
    entry.since = member.premiumSinceTimestamp;
    entry.rewards = Number(entry.rewards) || 0;

    let reward = null;
    let thanks = false;
    let party = false;
    if (perksOn(settings)) {
      if (hasReward(settings) && now >= (Number(entry.nextRewardAt) || 0)) {
        reward = await payReward(guild.client, guild.id, member.id, settings, now, random);
        entry.nextRewardAt = now + REWARD_EVERY_MS;
        entry.rewards += 1;
      }
      thanks = isNew && now - (Number(entry.lastThanksAt) || 0) >= THANKS_GAP_MS;
      if (thanks) entry.lastThanksAt = now;
      party = thanks && canThrowParty(settings, entry, now);
      if (party) entry.lastEventAt = now;
    }
    data.members[member.id] = entry;
    await store.set(guild.id, data);
    // Also after a member's data was reset in the panel.
    if (!reward) await setBoosterFlag(guild.client, guild.id, member.id, true);
    return { entry, reward, thanks, party };
  });

  const { entry, reward, thanks, party } = result;
  let partyMinutes = 0;
  if (party) {
    const minutes = Number(settings.serverBoost.eventMinutes);
    await startEvent(guild, 'kasa', minutes, { now }).then(() => { partyMinutes = minutes; }).catch((error) => {
      logger.warn(`Boost event not started in guild ${guild.id}: ${error.message}`);
    });
  }
  if (thanks || reward) {
    const channel = settings.serverBoost.channelId ? guild.channels.cache.get(settings.serverBoost.channelId) : null;
    await channel?.send?.(thanksMessage(guild, member, settings, entry, { thanks, reward, partyMinutes })).catch((error) => {
      logger.warn(`Boost thanks not posted in guild ${guild.id}: ${error.message}`);
    });
  }
  return result;
}

/** guildMemberUpdate: premiumSince appeared or went away. */
export async function noteBoostChange(member) {
  enterLocale(await getGuildLocale(member.client, member.guild.id));
  return processBooster(member.guild, member, { boosted: Boolean(member.premiumSinceTimestamp) });
}

/** The system message "X boosted the server". */
export async function handleBoostMessage(message) {
  const { guild } = message;
  enterLocale(await getGuildLocale(guild.client, guild.id));
  let member = message.member ?? await guild.members.fetch(message.author.id);
  // A cached member can lag behind the message by a moment.
  if (!member.premiumSinceTimestamp) member = await guild.members.fetch({ user: member.id, force: true });
  if (!member.premiumSinceTimestamp) return null;
  return processBooster(guild, member, { boosted: true });
}

const lastMembersFetch = new Map(); // guildId -> time

/** Every 10 minutes: whoever boosts now and whoever has an active record. */
export async function tickServerBoost(guild, now = Date.now()) {
  if (now - (lastMembersFetch.get(guild.id) ?? 0) >= MEMBERS_FETCH_EVERY_MS) {
    lastMembersFetch.set(guild.id, now);
    await guild.members.fetch().catch((error) => logger.warn(`Members not fetched for boosts in guild ${guild.id}: ${error.message}`));
  }
  const { members } = await getBoostData(guild.id);
  const ids = new Set(Object.entries(members ?? {}).filter(([, entry]) => entry.active).map(([id]) => id));
  for (const member of guild.members.cache.values()) if (member.premiumSinceTimestamp) ids.add(member.id);

  for (const id of ids) {
    let member = guild.members.cache.get(id);
    if (!member) {
      try {
        member = await guild.members.fetch(id);
      } catch (error) {
        if (GONE_CODES.has(error?.code)) await endBoost(guild, id);
        continue;
      }
    }
    await processBooster(guild, member, { now });
  }
}

export async function runServerBoost(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      enterLocale(await getGuildLocale(client, guild.id));
      await tickServerBoost(guild);
    } catch (error) {
      logger.warn(`Server boost job failed in guild ${guild.id}: ${error.message}`);
    }
  }
}

// ---------------------------------------------------------------- info message
// "What a boost gives" for the boosts channel (owner, 2026-11-01). Posted from the panel; a later save of the settings
// edits it, so the numbers on the channel are always the ones that apply. The button opens /booster info privately.

const UNKNOWN_MESSAGE = 10008;

export function boostInfoMessage(guild, settings) {
  const lines = perksOn(settings)
    ? [t`Boost **${guild.name}** and you get:`, '', ...perkLines(guild.id, settings.serverBoost)]
    : [t('⚠️ Booster rewards are turned off on this server.')];
  lines.push(
    '',
    t('💜 Every boost also gives the whole server more emoji slots and better voice quality.'),
    '',
    t('**How to boost:** click the server name above the channel list, then **Server Boost**.'),
    t('-# Rewards come by themselves, at the latest after 10 minutes. Your status: the button below or `/booster info`.'),
  );
  const button = new ButtonBuilder().setCustomId('booster:status').setLabel(t('My boost')).setEmoji('💎').setStyle(ButtonStyle.Secondary);
  return {
    embeds: [createEmbed({ title: t('💎 What a server boost gives'), description: lines.join('\n'), color: COLOR, footer: false })],
    components: [new ActionRowBuilder().addComponents(button)],
    allowedMentions: { parse: [] },
  };
}

/** Panel "send the info": the same channel edits the posted message, another channel replaces it. Throws `userError`. */
export async function postBoostInfo(guild, channelId) {
  const channel = guild.channels.cache.get(channelId);
  const payload = boostInfoMessage(guild, await getEconomySettings(guild.id));
  return withEconomyLock(guild.id, LOCK, async () => {
    const data = await store.get(guild.id);
    const old = data.info;
    let message = null;
    if (old?.messageId && old.channelId === channelId) {
      message = await channel.messages.edit(old.messageId, payload).catch(() => null);
    } else if (old?.messageId) {
      await guild.channels.cache.get(old.channelId)?.messages?.delete(old.messageId).catch(() => {});
    }
    if (!message) {
      try {
        message = await channel.send(payload);
      } catch (error) {
        logger.warn(`Boost info not posted in guild ${guild.id}: ${error.message}`);
        throw userError(t`The bot cannot write on #${channel.name}. Check its permissions there.`);
      }
    }
    data.info = { channelId, messageId: message.id };
    await store.set(guild.id, data);
    return data.info;
  });
}

/** After a settings save: bring the posted message up to date. A message someone deleted is forgotten. */
export async function refreshBoostInfo(guild) {
  const { info } = await store.get(guild.id);
  if (!info?.messageId) return false;
  const channel = guild.channels.cache.get(info.channelId);
  const payload = boostInfoMessage(guild, await getEconomySettings(guild.id));
  try {
    if (!channel) throw Object.assign(new Error('channel gone'), { code: UNKNOWN_MESSAGE });
    await channel.messages.edit(info.messageId, payload);
    return true;
  } catch (error) {
    if (error?.code !== UNKNOWN_MESSAGE) {
      logger.warn(`Boost info not edited in guild ${guild.id}: ${error.message}`);
      return false;
    }
    await withEconomyLock(guild.id, LOCK, async () => {
      const data = await store.get(guild.id);
      if (data.info?.messageId === info.messageId) data.info = null;
      await store.set(guild.id, data);
    });
    return false;
  }
}

// ---------------------------------------------------------------- own role

/**
 * Why the bot cannot make own roles, or null. They sit right above the server's booster role: higher, a booster could
 * outrank moderators and they could no longer ban that member.
 */
export function roleProblem(guild) {
  const me = guild.members.me;
  if (!me?.permissions?.has?.(PermissionFlagsBits.ManageRoles)) return t('The bot needs the Manage Roles permission.');
  const anchor = guild.roles.premiumSubscriberRole;
  if (!anchor) return t('The server has no booster role yet: it appears after the first boost.');
  if (me.roles.highest.position <= anchor.position) return t`Move the bot's role above ${anchor.name} in the server settings.`;
  return null;
}

async function roleNameProblem(guild, name, ownRoleId) {
  if (name.length < ROLE_NAME_MIN || name.length > ROLE_NAME_MAX) return t`The name has ${ROLE_NAME_MIN}-${ROLE_NAME_MAX} characters.`;
  if (RESERVED_ROLE_NAME.test(name)) return t('That name is not allowed: it looks like a staff role or a link.');
  const { rules } = await getAutomodConfig(guild.id);
  if (findSlur(name, rules.slurs?.list ?? []) || findBannedWord(name, rules.words?.list ?? [], rules.words?.allow ?? [])) return t('That name is not allowed.');
  const taken = [...guild.roles.cache.values()].some((role) => role.id !== ownRoleId && role.name?.toLowerCase() === name.toLowerCase());
  return taken ? t('A role with that name already exists.') : null;
}

async function createRole(guild, name, colorValue, reason) {
  const role = await guild.roles.create({ name, colors: { primaryColor: colorValue }, permissions: [], hoist: false, mentionable: false, reason });
  try {
    await role.setPosition(guild.roles.premiumSubscriberRole.position + 1, { reason });
  } catch (error) {
    await role.delete(reason).catch(() => {});
    logger.warn(`Booster role not moved in guild ${guild.id}: ${error.message}`);
    throw userError(t`Move the bot's role above ${guild.roles.premiumSubscriberRole.name} in the server settings.`);
  }
  return role;
}

/** /booster rola: make or change the member's own role. Throws `userError`. Returns the role. */
export async function setBoosterRole({ guild, member, name, color, now = Date.now() }) {
  const settings = await getEconomySettings(guild.id);
  if (!perksOn(settings) || !settings.serverBoost.customRole) throw userError(t('Own roles are turned off on this server.'));
  if (!member.premiumSinceTimestamp) throw userError(t('Only members who boost the server can have their own role.'));
  const problem = roleProblem(guild);
  if (problem) throw userError(problem);
  const cleanName = String(name ?? '').trim().replace(/\s+/g, ' ');
  if (!COLOR_RE.test(String(color ?? '').trim())) throw userError(t('Give the colour as a hex code, for example #ff66cc.'));
  // Discord reads colour 0 as "no colour".
  const colorValue = resolveColor(`#${String(color).trim().replace('#', '')}`) || 1;

  await processBooster(guild, member, { now });
  return withEconomyLock(guild.id, LOCK, async () => {
    const data = await store.get(guild.id);
    const entry = data.members[member.id];
    const nameProblem = await roleNameProblem(guild, cleanName, entry.roleId);
    if (nameProblem) throw userError(nameProblem);
    const nextChange = (Number(entry.roleChangedAt) || 0) + ROLE_CHANGE_GAP_MS;
    if (now < nextChange) throw userError(t`You can change your role again <t:${Math.ceil(nextChange / 1000)}:R>.`);

    const reason = t`Own role of a booster: ${member.user?.tag ?? member.id}`;
    let role = entry.roleId ? guild.roles.cache.get(entry.roleId) : null;
    if (role) await role.edit({ name: cleanName, colors: { primaryColor: colorValue }, reason });
    else role = await createRole(guild, cleanName, colorValue, reason);
    if (!member.roles.cache.has(role.id)) await member.roles.add(role, reason);

    entry.roleId = role.id;
    entry.roleChangedAt = now;
    await store.set(guild.id, data);
    return role;
  });
}

/** Remove a member's own role (/booster usun-role, a moderator in the panel). Returns false when there was none. */
export function removeBoosterRole(guild, userId) {
  return withEconomyLock(guild.id, LOCK, async () => {
    const data = await store.get(guild.id);
    const entry = data.members?.[userId];
    if (!entry?.roleId) return false;
    await deleteRole(guild, entry.roleId);
    entry.roleId = null;
    await store.set(guild.id, data);
    return true;
  });
}
