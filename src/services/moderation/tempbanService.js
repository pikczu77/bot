// tempbanService.js — bans that lift themselves, and the server-wide lockdown state.

import { PermissionFlagsBits, ChannelType } from 'discord.js';
import { guildStore } from '../../utils/featureKit.js';
import { logger } from '../../utils/logger.js';

const tempbanStore = guildStore('tempbans', []); // [{ userId, until, moderatorId, reason }]
const lockdownStore = guildStore('lockdown', { active: false, channels: [], startedAt: null, by: null });

export async function scheduleUnban(guildId, entry) {
  await tempbanStore.update(guildId, (list) => {
    const next = list.filter((item) => item.userId !== entry.userId);
    next.push(entry);
    return next;
  });
}

export async function cancelScheduledUnban(guildId, userId) {
  await tempbanStore.update(guildId, (list) => list.filter((item) => item.userId !== userId));
}

export const getTempbans = (guildId) => tempbanStore.get(guildId);

/** Scheduled job: lift temporary bans that have run out. */
export async function liftExpiredBans(client) {
  const now = Date.now();
  for (const guild of client.guilds.cache.values()) {
    const list = await tempbanStore.get(guild.id);
    if (list.length === 0) continue;
    const due = list.filter((entry) => entry.until <= now);
    if (due.length === 0) continue;

    const failed = [];
    for (const entry of due) {
      try {
        await guild.members.unban(entry.userId, 'Temporary ban expired');
        logger.info(`Temporary ban expired for ${entry.userId} in guild ${guild.id}`);
      } catch (error) {
        // 10026 = Unknown Ban: someone already unbanned them, nothing left to do.
        if (error.code !== 10026) {
          entry.attempts = (entry.attempts ?? 0) + 1;
          if (entry.attempts < 5) failed.push(entry);
          logger.warn(`Could not lift temporary ban for ${entry.userId} in guild ${guild.id}: ${error.message}`);
        }
      }
    }
    await tempbanStore.set(guild.id, [...list.filter((entry) => entry.until > now), ...failed]);
  }
}

export const getLockdown = (guildId) => lockdownStore.get(guildId);

/**
 * Stop @everyone from writing in every text channel that is currently open,
 * remembering which channels were changed so the lockdown can be undone exactly.
 */
export async function startLockdown(guild, moderator, reason) {
  const state = await lockdownStore.get(guild.id);
  if (state.active) return { alreadyActive: true, channels: state.channels };

  const everyone = guild.roles.everyone;
  const me = guild.members.me;
  const locked = [];
  for (const channel of guild.channels.cache.values()) {
    if (![ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum].includes(channel.type)) continue;
    if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageRoles)) continue;
    const permissions = channel.permissionsFor(everyone);
    // Skip channels @everyone cannot see or already cannot write in.
    if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.SendMessages)) continue;
    const ok = await channel.permissionOverwrites
      .edit(everyone, { SendMessages: false }, { reason: `Lockdown by ${moderator.user.tag}: ${reason}` })
      .then(() => true)
      .catch(() => false);
    if (ok) locked.push(channel.id);
  }

  await lockdownStore.set(guild.id, { active: true, channels: locked, startedAt: Date.now(), by: moderator.id });
  return { alreadyActive: false, channels: locked };
}

export async function endLockdown(guild, moderator) {
  const state = await lockdownStore.get(guild.id);
  if (!state.active) return { wasActive: false, channels: [] };

  const everyone = guild.roles.everyone;
  const restored = [];
  for (const channelId of state.channels) {
    const channel = guild.channels.cache.get(channelId);
    if (!channel) continue;
    const ok = await channel.permissionOverwrites
      .edit(everyone, { SendMessages: null }, { reason: `Lockdown lifted by ${moderator.user.tag}` })
      .then(() => true)
      .catch(() => false);
    if (ok) restored.push(channelId);
  }

  await lockdownStore.set(guild.id, { active: false, channels: [], startedAt: null, by: null });
  return { wasActive: true, channels: restored };
}
