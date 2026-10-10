// inviteService.js — who invited whom.
//
// Discord does not say which invite a new member used, so the bot keeps a copy of
// every invite's use count and compares it when someone joins.

import { PermissionFlagsBits } from 'discord.js';
import { guildStore } from '../utils/featureKit.js';
import { logger } from '../utils/logger.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const configStore = guildStore('invites:config', {
  enabled: true,
  fakeDays: 3, // accounts younger than this do not count
  logChannelId: null,
  rewards: [], // [{ invites, roleId }]
});
const statsStore = guildStore('invites:stats', {}); // { [userId]: { regular, left, fake, bonus } }
const joinsStore = guildStore('invites:joins', {}); // { [memberId]: { inviterId, code, fake } }

const inviteCache = new Map(); // guildId -> Map<code, { uses, inviterId, maxUses }>
const vanityCache = new Map(); // guildId -> uses
const pendingJoins = new Map(); // `${guildId}:${memberId}` -> Promise<join result>

const emptyStats = () => ({ regular: 0, left: 0, fake: 0, bonus: 0 });

export const getInviteConfig = (guildId) => configStore.get(guildId);
export const updateInviteConfig = (guildId, mutate) => configStore.update(guildId, mutate);

function snapshot(invites) {
  const map = new Map();
  for (const invite of invites.values()) {
    map.set(invite.code, {
      uses: invite.uses ?? 0,
      inviterId: invite.inviter?.id ?? invite.inviterId ?? null,
      maxUses: invite.maxUses ?? 0,
    });
  }
  return map;
}

function canReadInvites(guild) {
  return Boolean(guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild));
}

/** Remember the current use counts of a guild's invites. Returns how many were cached. */
export async function cacheGuildInvites(guild) {
  if (!canReadInvites(guild)) return 0;
  try {
    const invites = await guild.invites.fetch();
    inviteCache.set(guild.id, snapshot(invites));
    if (guild.features.includes('VANITY_URL')) {
      const vanity = await guild.fetchVanityData().catch(() => null);
      if (vanity) vanityCache.set(guild.id, vanity.uses ?? 0);
    }
    return invites.size;
  } catch (error) {
    logger.debug(`Could not cache invites for guild ${guild.id}: ${error.message}`);
    return 0;
  }
}

export async function cacheAllInvites(client) {
  let total = 0;
  for (const guild of client.guilds.cache.values()) {
    total += await cacheGuildInvites(guild);
  }
  logger.info(`Invite tracker: cached ${total} invites in ${client.guilds.cache.size} guild(s)`);
}

export function onInviteCreate(invite) {
  if (!invite.guild) return;
  const map = inviteCache.get(invite.guild.id) ?? new Map();
  map.set(invite.code, { uses: invite.uses ?? 0, inviterId: invite.inviter?.id ?? null, maxUses: invite.maxUses ?? 0 });
  inviteCache.set(invite.guild.id, map);
}

export function onInviteDelete(invite) {
  if (!invite.guild) return;
  // Keep single-use invites for a moment: a join that consumed one deletes it first.
  const map = inviteCache.get(invite.guild.id);
  const cached = map?.get(invite.code);
  if (!cached) return;
  cached.deletedAt = Date.now();
  setTimeout(() => {
    if (map.get(invite.code)?.deletedAt) map.delete(invite.code);
  }, 10_000).unref?.();
}

/**
 * Work out which invite a member used by comparing use counts.
 * Pure function: `before` and `after` are Map<code, { uses, inviterId, maxUses }>.
 */
export function findUsedInvite(before, after) {
  for (const [code, fresh] of after) {
    const old = before.get(code);
    if (old ? fresh.uses > old.uses : fresh.uses > 0) return { code, inviterId: fresh.inviterId };
  }
  // A limited invite disappears once its last use is taken.
  for (const [code, old] of before) {
    if (!after.has(code) && old.maxUses > 0 && old.uses >= old.maxUses - 1) {
      return { code, inviterId: old.inviterId };
    }
  }
  return null;
}

async function detectInvite(member) {
  const { guild } = member;
  if (member.user.bot) return { type: 'bot', code: null, inviterId: null };
  if (!canReadInvites(guild)) return { type: 'unknown', code: null, inviterId: null };

  const before = inviteCache.get(guild.id) ?? new Map();
  const freshInvites = await guild.invites.fetch().catch(() => null);
  if (freshInvites) {
    const after = snapshot(freshInvites);
    inviteCache.set(guild.id, after);
    const used = findUsedInvite(before, after);
    if (used) return { type: 'invite', ...used };
  }

  if (guild.features.includes('VANITY_URL')) {
    const vanity = await guild.fetchVanityData().catch(() => null);
    const previous = vanityCache.get(guild.id) ?? 0;
    if (vanity) {
      vanityCache.set(guild.id, vanity.uses ?? 0);
      if ((vanity.uses ?? 0) > previous) return { type: 'vanity', code: vanity.code, inviterId: null };
    }
  }

  return { type: 'unknown', code: null, inviterId: null };
}

export function totalInvites(stats) {
  return Math.max(0, (stats?.regular ?? 0) + (stats?.bonus ?? 0));
}

export async function getInviteStats(guildId, userId) {
  const all = await statsStore.get(guildId);
  const stats = { ...emptyStats(), ...(all[userId] ?? {}) };
  return { ...stats, total: totalInvites(stats) };
}

export async function getInviteLeaderboard(guildId) {
  const all = await statsStore.get(guildId);
  return Object.entries(all)
    .map(([userId, stats]) => ({ userId, ...emptyStats(), ...stats, total: totalInvites(stats) }))
    .filter((entry) => entry.total > 0 || entry.left > 0 || entry.fake > 0)
    .sort((a, b) => b.total - a.total || b.regular - a.regular);
}

async function changeStats(guildId, userId, mutate) {
  let result;
  await statsStore.update(guildId, (all) => {
    const stats = { ...emptyStats(), ...(all[userId] ?? {}) };
    mutate(stats);
    for (const key of Object.keys(stats)) stats[key] = Math.round(stats[key]);
    stats.regular = Math.max(0, stats.regular);
    stats.left = Math.max(0, stats.left);
    stats.fake = Math.max(0, stats.fake);
    all[userId] = stats;
    result = { ...stats, total: totalInvites(stats) };
  });
  return result;
}

export const addBonusInvites = (guildId, userId, amount) =>
  changeStats(guildId, userId, (stats) => { stats.bonus += amount; });

export async function resetInvites(guildId, userId = null) {
  if (userId) {
    await statsStore.update(guildId, (all) => { delete all[userId]; });
  } else {
    await statsStore.set(guildId, {});
    await joinsStore.set(guildId, {});
  }
}

/** Give the reward roles a member has earned. Returns the roles that were newly added. */
export async function applyInviteRewards(guild, userId, total) {
  const { rewards } = await configStore.get(guild.id);
  if (!rewards.length) return [];
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return [];

  const granted = [];
  for (const reward of rewards) {
    if (total < reward.invites) continue;
    const role = guild.roles.cache.get(reward.roleId);
    if (!role || member.roles.cache.has(role.id) || !role.editable) continue;
    const added = await member.roles.add(role, `Invite reward: ${reward.invites} invites`).then(() => true).catch(() => false);
    if (added) granted.push(role);
  }
  return granted;
}

async function recordJoin(member) {
  const { guild } = member;
  const config = await configStore.get(guild.id);
  const detected = await detectInvite(member);
  const result = { ...detected, inviter: null, stats: null, fake: false, rewards: [], config };
  if (!config.enabled || !detected.inviterId || detected.inviterId === member.id) return result;

  result.fake = Date.now() - member.user.createdTimestamp < config.fakeDays * DAY_MS;
  result.inviter = await guild.client.users.fetch(detected.inviterId).catch(() => null);

  const joins = await joinsStore.get(guild.id);
  const previous = joins[member.id];
  // Someone who rejoins through the same person must not be counted twice.
  const rejoin = previous?.inviterId === detected.inviterId;

  result.stats = await changeStats(guild.id, detected.inviterId, (stats) => {
    if (rejoin) {
      if (!previous.fake) { stats.left -= 1; stats.regular += 1; }
    } else if (result.fake) {
      stats.fake += 1;
    } else {
      stats.regular += 1;
    }
  });

  joins[member.id] = { inviterId: detected.inviterId, code: detected.code, fake: rejoin ? Boolean(previous.fake) : result.fake };
  await joinsStore.set(guild.id, joins);

  if (!result.fake) {
    result.rewards = await applyInviteRewards(guild, detected.inviterId, result.stats.total);
  }
  return result;
}

/**
 * Detect and record a join exactly once, however many listeners ask
 * (the welcome message and the invite log both need the answer).
 */
export function resolveMemberJoin(member) {
  const key = `${member.guild.id}:${member.id}`;
  if (!pendingJoins.has(key)) {
    const promise = recordJoin(member).catch((error) => {
      logger.warn(`Invite tracking failed for ${member.id} in ${member.guild.id}: ${error.message}`);
      return { type: 'unknown', code: null, inviterId: null, inviter: null, stats: null, fake: false, rewards: [], config: null };
    });
    pendingJoins.set(key, promise);
    setTimeout(() => pendingJoins.delete(key), 60_000).unref?.();
  }
  return pendingJoins.get(key);
}

/** A member left: move their invite from "regular" to "left" for whoever invited them. */
export async function recordLeave(member) {
  const { guild } = member;
  const config = await configStore.get(guild.id);
  if (!config.enabled) return { inviter: null, stats: null, config };

  const joins = await joinsStore.get(guild.id);
  const join = joins[member.id];
  if (!join?.inviterId) return { inviter: null, stats: null, config };

  const stats = await changeStats(guild.id, join.inviterId, (current) => {
    if (join.fake) return;
    current.regular -= 1;
    current.left += 1;
  });
  const inviter = await guild.client.users.fetch(join.inviterId).catch(() => null);
  return { inviter, stats, config, code: join.code };
}
