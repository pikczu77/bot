// levelRestore.js — gives members their level back from the level roles they still hold (2026-11-10).
//
// The old host expired and data/storage.json went with it: every level was lost, while the members kept
// their "LVL 3" ... "LVL 50" roles on Discord. At the first start on an empty data file the bot reads
// those roles and sets each member to the highest level among the roles they have (XP 0 inside that
// level). A level is never lowered, so XP earned since the new start stays.
//
// A level role is a reward role from the leveling settings, or a role whose whole name is
// "LVL 10" / "Level 10" / "Poziom 10". When the leveling settings have no reward roles (they were lost
// too), the roles found by name become the rewards again, so new level-ups give them as before. If most
// members above the lowest level role hold a single level role, "keep only the highest role" is turned on.
//
// Runs once per data file: the marker below lives in the same file, so a lost file means a new run.

import { logger } from '../../utils/logger.js';
import { calculateTotalXp, getLevelingConfig, getUserLevelData, saveLevelingConfig, saveUserLevelData, MAX_LEVEL } from './leveling.js';

export const RESTORE_MARKER = 'bot:levels-from-roles';
const LEVEL_ROLE_NAME = /^\s*(?:lvl|level|poziom)\s*\.?\s*(\d{1,4})\s*$/i;

/** Level written in a role name ("LVL 10" = 10), or null. */
export function levelFromRoleName(name) {
  const match = LEVEL_ROLE_NAME.exec(String(name ?? ''));
  if (!match) return null;
  const level = Number(match[1]);
  return level >= 1 && level <= MAX_LEVEL ? level : null;
}

/** roleId -> level: reward roles from the settings first, then roles named like a level. */
export function levelRolesOf(guild, config) {
  const levels = new Map();
  for (const [level, roleId] of Object.entries(config?.roleRewards || {})) {
    const value = Number(level);
    if (roleId && Number.isInteger(value) && value >= 1 && value <= MAX_LEVEL) levels.set(String(roleId), value);
  }
  for (const role of guild.roles.cache.values()) {
    if (levels.has(role.id)) continue;
    const value = levelFromRoleName(role.name);
    if (value) levels.set(role.id, value);
  }
  return levels;
}

/** Sets every member with a level role to at least that level. Returns { levelRoles, members, restored, rewardsAdded, onlyHighest? }. */
export async function restoreLevelsFromRoles(client, guild) {
  const summary = { levelRoles: 0, members: 0, restored: 0, rewardsAdded: 0 };
  const config = await getLevelingConfig(client, guild.id);
  const levelRoles = levelRolesOf(guild, config);
  summary.levelRoles = levelRoles.size;
  if (levelRoles.size === 0) return summary;

  const members = [...(await guild.members.fetch()).values()].filter((member) => !member.user?.bot);
  const held = (member) => [...member.roles.cache.keys()].map((roleId) => levelRoles.get(roleId) || 0).filter(Boolean);

  if (Object.keys(config.roleRewards || {}).length === 0) {
    const rewards = {};
    for (const [roleId, level] of levelRoles) if (!rewards[level]) rewards[level] = roleId;
    config.roleRewards = rewards;
    // How the server kept the roles: members above the lowest level role who hold only one level role
    // mean "keep only the highest" was on, so the role sync must not hand out the lower ones again.
    const lowest = Math.min(...levelRoles.values());
    const above = members.map(held).filter((levels) => levels.some((level) => level > lowest));
    const single = above.filter((levels) => levels.length === 1).length;
    if (above.length > 0 && single * 2 > above.length) {
      config.removePreviousRoles = true;
      summary.onlyHighest = true;
    }
    await saveLevelingConfig(client, guild.id, config);
    summary.rewardsAdded = Object.keys(rewards).length;
  }

  for (const member of members) {
    const level = Math.max(0, ...held(member));
    if (!level) continue;
    summary.members += 1;
    const data = await getUserLevelData(client, guild.id, member.id);
    if (data.level >= level) continue;
    await saveUserLevelData(client, guild.id, member.id, { ...data, level, xp: 0, totalXp: calculateTotalXp(level, 0) });
    summary.restored += 1;
  }
  return summary;
}

/** At start: once per data file, on every server. */
export async function restoreLevelsOnce(client) {
  if (await client.db.get(RESTORE_MARKER)) return null;
  const done = {};
  for (const guild of client.guilds.cache.values()) {
    try {
      done[guild.id] = await restoreLevelsFromRoles(client, guild);
    } catch (error) {
      logger.warn(`Level restore from roles failed in guild ${guild.id}: ${error.message}`);
      done[guild.id] = { error: error.message };
    }
  }
  await client.db.set(RESTORE_MARKER, { at: Date.now(), guilds: done });
  logger.info(`Levels restored from level roles: ${JSON.stringify(done)}`);
  return done;
}
