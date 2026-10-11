// autoRoleService.js — roles given to everyone who joins (members and bots), and the
// sync that hands those roles to members who are already on the server without them.

import { getWelcomeConfig, updateWelcomeConfig } from '../utils/database.js';
import { logger } from '../utils/logger.js';

const MEMBER_FETCH_INTERVAL_MS = 5 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const SCHEDULE_CHECK_MS = 60 * 60_000;

// guildId -> { running, done, total, failed }; kept in memory, a restart ends a running sync.
const syncStates = new Map();
const lastMemberFetch = new Map();

const list = (value) => (Array.isArray(value) ? value : []);

/** Auto-role settings as stored inside the welcome config, with defaults. */
export function getAutoRoleSettings(config = {}) {
  return {
    roleIds: list(config.roleIds),
    delaySeconds: Number(config.autoRoleDelay) || 0,
    bots: {
      enabled: config.autoRoleBots !== false,
      delay: config.autoRoleBotDelay !== false,
      different: config.autoRoleBotsDifferent === true,
      roleIds: list(config.autoRoleBotRoleIds),
    },
    sync: {
      excludeRoleIds: list(config.autoRoleSyncExclude),
      daily: config.autoRoleSyncDaily === true,
      lastSyncAt: config.autoRoleLastSync ?? null,
    },
  };
}

/** Roles this member gets on join; an empty list means none. */
export function autoRolesFor(settings, member) {
  if (!member.user?.bot) return settings.roleIds;
  if (!settings.bots.enabled) return [];
  return settings.bots.different ? settings.bots.roleIds : settings.roleIds;
}

/** Seconds to wait before the roles are given to this member. */
export function autoRoleDelayFor(settings, member) {
  return member.user?.bot && !settings.bots.delay ? 0 : settings.delaySeconds;
}

// Members who lack a join role the bot is able to give. The bot itself and members
// holding an excluded role are left out.
function membersMissingRoles(guild, settings) {
  const missing = [];
  for (const member of guild.members.cache.values()) {
    if (member.id === guild.members.me?.id) continue;
    if (settings.sync.excludeRoleIds.some((roleId) => member.roles.cache.has(roleId))) continue;
    const roles = autoRolesFor(settings, member)
      .map((roleId) => guild.roles.cache.get(roleId))
      .filter((role) => role?.editable && !member.roles.cache.has(role.id));
    if (roles.length) missing.push({ member, roles });
  }
  return missing;
}

// Loads the full member list, at most once per interval (the gateway request is rate limited).
async function fetchMembers(guild) {
  if (Date.now() - (lastMemberFetch.get(guild.id) ?? 0) < MEMBER_FETCH_INTERVAL_MS) return;
  lastMemberFetch.set(guild.id, Date.now());
  try {
    await guild.members.fetch();
  } catch (error) {
    lastMemberFetch.delete(guild.id);
    logger.warn(`Could not load the member list of guild ${guild.id}:`, error);
  }
}

/** Progress of the sync plus how many members miss a join role right now. */
export async function getAutoRoleSyncStatus(client, guild) {
  const settings = getAutoRoleSettings(await getWelcomeConfig(client, guild.id));
  await fetchMembers(guild);
  const state = syncStates.get(guild.id);
  return {
    running: state?.running === true,
    done: state?.done ?? 0,
    total: state?.total ?? 0,
    failed: state?.failed ?? 0,
    missing: membersMissingRoles(guild, settings).length,
    lastSyncAt: settings.sync.lastSyncAt,
  };
}

/** Starts giving the join roles to everyone who misses them. Returns false when a sync is already running. */
export async function startAutoRoleSync(client, guild) {
  if (syncStates.get(guild.id)?.running) return false;
  const state = { running: true, done: 0, total: 0, failed: 0 };
  syncStates.set(guild.id, state);

  try {
    const settings = getAutoRoleSettings(await getWelcomeConfig(client, guild.id));
    await fetchMembers(guild);
    const queue = membersMissingRoles(guild, settings);
    state.total = queue.length;

    (async () => {
      for (const { member, roles } of queue) {
        try {
          await member.roles.add(roles, 'Auto-role sync');
        } catch (error) {
          state.failed += 1;
          logger.warn(`Auto-role sync: could not give roles to ${member.id} in guild ${guild.id}:`, error);
        }
        state.done += 1;
      }
      await updateWelcomeConfig(client, guild.id, { autoRoleLastSync: Date.now() });
      logger.info(`Auto-role sync in guild ${guild.id} finished: ${state.done - state.failed} of ${state.total} members updated`);
    })()
      .catch((error) => logger.error(`Auto-role sync in guild ${guild.id} failed:`, error))
      .finally(() => { state.running = false; });
  } catch (error) {
    state.running = false;
    throw error;
  }
  return true;
}

/** Once an hour: run the sync in every guild that asked for a daily one and had none for a day. */
export function startAutoRoleSchedule(client) {
  const timer = setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      try {
        const settings = getAutoRoleSettings(await getWelcomeConfig(client, guild.id));
        if (!settings.sync.daily || Date.now() - (settings.sync.lastSyncAt ?? 0) < DAY_MS) continue;
        await startAutoRoleSync(client, guild);
      } catch (error) {
        logger.warn(`Scheduled auto-role sync failed in guild ${guild.id}:`, error);
      }
    }
  }, SCHEDULE_CHECK_MS);
  timer.unref?.();
  return timer;
}
