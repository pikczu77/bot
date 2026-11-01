// serverBoost.js — rewards for members who boost the server (2026-11-01, owner: "trzeba cos wymyslic dla boostow").
// Not /boosty (services/boosts.js): those are x2 potions bought with money.
//
// Perks, set in the panel (settings.serverBoost, economySettings.js): thanks on a channel, money and a free pack when a
// boost starts and every 30 days after that, +% money and +% XP while boosting (userData.serverBooster), a short x2 money
// event for the whole server, two badges (stat boostRewards).
//
// Three things lead here: guildMemberUpdate (premiumSince changed), the system message "X boosted the server" (the only
// sign of a second boost by the same member) and the job every 10 minutes (what happened while the bot was off, the
// 30-day rewards). All of them may fire for one boost, so every decision is taken and saved inside the store lock.
//
// Store guild:{id}:server-boost = { members: { [userId]: { active, since, nextRewardAt, rewards, lastThanksAt, lastEventAt } },
// info: { channelId, messageId, rev } } (the "what a boost gives" message posted from the panel).
// nextRewardAt stays after a boost ends: taking a boost off and on again pays nothing extra.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageType } from 'discord.js';
import { createEmbed } from '../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../utils/economy.js';
import { guildStore, userError } from '../utils/featureKit.js';
import { createTraceId, logger, runWithTraceContext } from '../utils/logger.js';
import { enterLocale, t, tr } from '../i18n/index.js';
import { getGuildLocale } from './languageService.js';
import { PACKS } from './collections.js';
import { activeEventType, getEconomySettings, money } from './economySettings.js';
import { MIN_EVENT_MINUTES, startEvent } from './economyEvents.js';
import { withEconomyLock } from './economyUpgrades.js';
import { openBonusPack, recordProgress } from './progress.js';

export const REWARD_EVERY_DAYS = 30;
export const REWARD_EVERY_MS = REWARD_EVERY_DAYS * 86_400_000;
export const THANKS_GAP_MS = 86_400_000;
export const EVENT_GAP_MS = 7 * 86_400_000;
export const MESSAGE_MAX = 500;
// A boost the job finds this soon after it started still gets the thanks and the event. Older ones (members who boosted
// before this code, a long time offline) only get the reward.
const FRESH_MS = 2 * 3_600_000;
const MEMBERS_FETCH_EVERY_MS = 3_600_000;
const LOCK = '#server-boost';
const GONE_CODES = new Set([10007, 10013]); // Unknown Member, Unknown User
const COLOR = '#F47FFF';

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

// /booster rola is gone (2026-11-01, owner: "nie chce tego wcale dodawac"). A role someone made before that goes with the next job run.
async function dropOldRole(guild, entry) {
  if (!entry.roleId) return;
  await guild.roles.cache.get(entry.roleId)?.delete(t('The boost ended or the own role was removed')).catch((error) => {
    logger.warn(`Booster role ${entry.roleId} not deleted in guild ${guild.id}: ${error.message}`);
  });
  delete entry.roleId;
  delete entry.roleChangedAt;
}

/** A boost is over (or the member left): no more bonus. Keeps nextRewardAt. */
async function endBoost(guild, userId) {
  await withEconomyLock(guild.id, LOCK, async () => {
    const data = await store.get(guild.id);
    const entry = data.members?.[userId];
    if (!entry?.active) return;
    await dropOldRole(guild, entry);
    entry.active = false;
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
    await dropOldRole(guild, entry);
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
  const { members, info } = await getBoostData(guild.id);
  if (info?.messageId && info.rev !== INFO_REV) await refreshBoostInfo(guild);
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
// Bump when the text changes: the job edits a message posted earlier once. 2 = no own role in the list.
const INFO_REV = 2;

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
    data.info = { channelId, messageId: message.id, rev: INFO_REV };
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
    if (info.rev !== INFO_REV) {
      await withEconomyLock(guild.id, LOCK, async () => {
        const data = await store.get(guild.id);
        if (data.info?.messageId === info.messageId) data.info.rev = INFO_REV;
        await store.set(guild.id, data);
      });
    }
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
