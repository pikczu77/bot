// leveling.js

import { EmbedBuilder } from 'discord.js';
import { logger } from '../../utils/logger.js';
import { getGuildConfig, setGuildConfig } from '../config/guildConfig.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { addXp } from './xpSystem.js';
import { getUserLevelKey } from '../../utils/database/keys.js';
import { t } from '../../i18n/index.js';

const BASE_XP = 100;
const XP_MULTIPLIER = 1.5;
const MAX_LEVEL = 1000;
const MIN_LEVEL = 0;

/**
 * Settings added with the web panel. They live in the same `leveling` object of the
 * guild config; a config saved before they existed gets these values.
 */
export const LEVELING_EXTRAS = Object.freeze({
  // Announce in the channel where the member wrote (instead of levelUpChannel).
  levelUpSameChannel: false,
  // "block": XP everywhere except ignoredChannels / ignoredRoles; "allow": only there.
  channelMode: 'block',
  roleMode: 'block',
  // Keep only the highest reward role a member has reached.
  removePreviousRoles: false,
  // Economy money for every level gained (0 = off).
  moneyPerLevel: 0,
  // [{ id, percent }] — 150 means x1.5. With several matching roles the highest counts.
  roleMultipliers: [],
  channelMultipliers: [],
  // Extra XP in percent for a message longer than LONG_MESSAGE_LENGTH / with an attachment.
  longMessageBonusPercent: 0,
  attachmentBonusPercent: 0,
  // XP per minute in a voice channel (0 = off).
  voiceXpPerMinute: 0,
  voiceCountMuted: false,
  voiceCountAlone: false,
  // Delete a member's level when they leave the server.
  clearOnLeave: true,
});

export const LONG_MESSAGE_LENGTH = 150;
export { MAX_LEVEL };

export function getXpForLevel(level) {
  if (!Number.isInteger(level) || level < 0 || level > MAX_LEVEL) {
    throw new TitanBotError(
      `Invalid level: ${level}. Must be between ${MIN_LEVEL} and ${MAX_LEVEL}`,
      ErrorTypes.VALIDATION,
      t('The level must be a valid number.')
    );
  }
  return 5 * Math.pow(level, 2) + 50 * level + 50;
}

export function getLevelFromXp(xp) {
  if (!Number.isInteger(xp) || xp < 0) {
    throw new TitanBotError(
      `Invalid XP: ${xp}`,
      ErrorTypes.VALIDATION,
      t('XP must be a non-negative number.')
    );
  }

  let level = 0;
  let xpNeeded = 0;
  
  while (xp >= getXpForLevel(level) && level < MAX_LEVEL) {
    xpNeeded = getXpForLevel(level);
    xp -= xpNeeded;
    level++;
  }
  
  return {
    level: Math.min(level, MAX_LEVEL),
    currentXp: xp,
    xpNeeded: getXpForLevel(Math.min(level, MAX_LEVEL))
  };
}

export function calculateTotalXp(level, currentXp = 0) {
  let total = currentXp;
  for (let i = 0; i < level; i++) {
    total += getXpForLevel(i);
  }
  return total;
}

export async function getLeaderboard(client, guildId, limit = 10) {
  try {
    
    if (!guildId || typeof guildId !== 'string') {
      throw new TitanBotError(
        'Invalid guild ID',
        ErrorTypes.VALIDATION,
        t('Guild ID is required.')
      );
    }

    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      limit = Math.min(Math.max(limit, 1), 100);
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      logger.warn(`Guild ${guildId} not found in cache`);
      return [];
    }
    
    const members = await guild.members.fetch().catch(error => {
      logger.error(`Failed to fetch members for guild ${guildId}:`, error);
      return new Map();
    });

    const leaderboard = [];
    
    for (const [userId, member] of members) {
      if (member.user.bot) continue;
      
      const data = await getUserLevelData(client, guildId, userId);
      if (data && (data.totalXp > 0 || data.level > 0)) {
        leaderboard.push({
          userId,
          username: member.user.username,
          discriminator: member.user.discriminator,
          ...data
        });
      }
    }
    
    leaderboard.sort((a, b) => b.totalXp - a.totalXp);
    
    leaderboard.forEach((entry, index) => {
      entry.rank = index + 1;
    });
    
    return leaderboard.slice(0, limit);
    
  } catch (error) {
    logger.error('Error getting leaderboard:', error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Failed to fetch leaderboard: ${error.message}`,
      ErrorTypes.DATABASE,
      t('Could not fetch the leaderboard at this time.')
    );
  }
}

export function createLeaderboardEmbed(leaderboard, guild) {
  const embed = new EmbedBuilder()
    .setTitle(t`🏆 ${guild.name} Leaderboard`)
    .setColor('#2ecc71')
    .setTimestamp();
    
  if (!leaderboard || leaderboard.length === 0) {
    embed.setDescription(t('No users on the leaderboard yet!'));
    return embed;
  }
  
  const top3 = leaderboard.slice(0, 3);
  const rest = leaderboard.slice(3);
  
  const top3Text = top3.map((user, index) => {
    const medal = ['🥇', '🥈', '🥉'][index];
    return t`${medal} **#${user.rank}** ${user.username} - Level ${user.level} (${user.totalXp} XP)`;
  }).join('\n');
  
  const restText = rest.map(user => {
    return t`**#${user.rank}** ${user.username} - Level ${user.level} (${user.totalXp} XP)`;
  }).join('\n');
  
  embed.setDescription(
    t`**Top Members**\n${top3Text}${restText ? '\n\n' + restText : ''}`
  );
  
  return embed;
}

function defaultLevelingConfig() {
  return {
    enabled: true,
    xpPerMessage: { min: 15, max: 25 },
    xpCooldown: 20,
    levelUpMessage: t('{user} has leveled up to level {level}!'),
    levelUpChannel: null,
    ignoredChannels: [],
    ignoredRoles: [],
    blacklistedUsers: [],
    roleRewards: {},
    announceLevelUp: true,
    xpMultiplier: 1
  };
}

export async function getLevelingConfig(client, guildId) {
  try {
    const guildConfig = await getGuildConfig(client, guildId);
    return { ...structuredClone(LEVELING_EXTRAS), ...(guildConfig.leveling || defaultLevelingConfig()) };
  } catch (error) {
    logger.error(`Error getting leveling config for guild ${guildId}:`, error);
    return { ...structuredClone(LEVELING_EXTRAS), ...defaultLevelingConfig() };
  }
}

/** XP a message earns: lowest and highest amount, seconds between two rewards. */
export function getMessageXpRange(config) {
  const min = Math.max(1, config.xpRange?.min || config.xpPerMessage?.min || 15);
  const max = Math.max(min, config.xpRange?.max || config.xpPerMessage?.max || 25);
  return { min, max };
}

function listAllows(mode, list, ids) {
  if (!Array.isArray(list) || list.length === 0) return true;
  const listed = ids.some((id) => list.includes(id));
  return mode === 'allow' ? listed : !listed;
}

/** May this member earn XP in this channel (channel and role exceptions, blacklist)? */
export function canEarnXp(config, member, channel) {
  if (!config?.enabled || !member || member.user?.bot) return false;
  if (config.blacklistedUsers?.includes(member.id)) return false;
  if (!listAllows(config.channelMode, config.ignoredChannels, [channel?.id, channel?.parentId].filter(Boolean))) return false;
  return listAllows(config.roleMode, config.ignoredRoles, [...(member.roles?.cache?.keys?.() ?? [])]);
}

const percentOf = (entries, ids) => (Array.isArray(entries) ? entries : [])
  .filter((entry) => ids.includes(entry.id))
  .reduce((highest, entry) => Math.max(highest, Number(entry.percent) || 0), 0);

/**
 * Apply the multipliers of the server to a base XP amount: global multiplier, the best
 * role multiplier of the member, the multiplier of the channel, and (for messages)
 * the bonuses for a long text and for an attachment.
 */
export function applyXpMultipliers(config, baseXp, { member, channel, message = null } = {}) {
  let factor = Number(config.xpMultiplier) > 0 ? Number(config.xpMultiplier) : 1;

  const rolePercent = percentOf(config.roleMultipliers, [...(member?.roles?.cache?.keys?.() ?? [])]);
  if (rolePercent > 0) factor *= rolePercent / 100;

  const channelPercent = percentOf(config.channelMultipliers, [channel?.id, channel?.parentId].filter(Boolean));
  if (channelPercent > 0) factor *= channelPercent / 100;

  if (message) {
    if ((message.content?.length ?? 0) > LONG_MESSAGE_LENGTH) factor *= 1 + (Number(config.longMessageBonusPercent) || 0) / 100;
    if ((message.attachments?.size ?? 0) > 0) factor *= 1 + (Number(config.attachmentBonusPercent) || 0) / 100;
  }

  return Math.max(1, Math.floor(baseXp * factor));
}

export async function getUserLevelData(client, guildId, userId) {
  try {
    if (!guildId || !userId) {
      throw new TitanBotError(
        'Guild ID and User ID are required',
        ErrorTypes.VALIDATION
      );
    }

    const key = getUserLevelKey(guildId, userId);
    const data = await client.db.get(key);
    
    if (!data) {
      return {
        xp: 0,
        level: 0,
        totalXp: 0,
        lastMessage: 0,
        rank: 0
      };
    }
    
    return {
      xp: Math.max(0, data.xp || 0),
      level: Math.max(0, Math.min(data.level || 0, MAX_LEVEL)),
      totalXp: Math.max(0, data.totalXp || 0),
      lastMessage: data.lastMessage || 0,
      rank: data.rank || 0
    };
  } catch (error) {
    logger.error(`Error getting user level data for ${userId}:`, error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Failed to fetch user data: ${error.message}`,
      ErrorTypes.DATABASE,
      t('Could not fetch level data at this time.')
    );
  }
}

export async function saveUserLevelData(client, guildId, userId, data) {
  try {
    if (!guildId || !userId) {
      throw new TitanBotError(
        'Guild ID and User ID are required',
        ErrorTypes.VALIDATION
      );
    }

    if (!data || typeof data !== 'object') {
      throw new TitanBotError(
        'Invalid user level data',
        ErrorTypes.VALIDATION
      );
    }

    const sanitizedData = {
      xp: Math.max(0, Number(data.xp) || 0),
      level: Math.max(0, Math.min(Number(data.level) || 0, MAX_LEVEL)),
      totalXp: Math.max(0, Number(data.totalXp) || 0),
      lastMessage: Number(data.lastMessage) || 0,
      rank: Number(data.rank) || 0
    };

    const key = getUserLevelKey(guildId, userId);
    await client.db.set(key, sanitizedData);
  } catch (error) {
    logger.error(`Error saving user level data for ${userId}:`, error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Failed to save user data: ${error.message}`,
      ErrorTypes.DATABASE,
      t('Could not save level data at this time.')
    );
  }
}

export async function saveLevelingConfig(client, guildId, config) {
  try {
    if (!guildId || !config) {
      throw new TitanBotError(
        'Guild ID and config are required',
        ErrorTypes.VALIDATION
      );
    }

    const guildConfig = await getGuildConfig(client, guildId);

    if (config.xpCooldown && (config.xpCooldown < 0 || config.xpCooldown > 3600)) {
      throw new TitanBotError(
        'XP cooldown must be between 0 and 3600 seconds',
        ErrorTypes.VALIDATION,
        t('Cooldown must be between 0 and 3600 seconds.')
      );
    }

    if (config.xpRange && (config.xpRange.min < 1 || config.xpRange.max < 1 || config.xpRange.min > config.xpRange.max)) {
      throw new TitanBotError(
        'Invalid XP range configuration',
        ErrorTypes.VALIDATION,
        t('Minimum XP must be less than maximum XP, and both must be positive.')
      );
    }

    guildConfig.leveling = config;
    await setGuildConfig(client, guildId, guildConfig);
    
    logger.info(`Leveling config updated for guild ${guildId}`);
  } catch (error) {
    logger.error(`Error saving leveling config for guild ${guildId}:`, error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Failed to save config: ${error.message}`,
      ErrorTypes.DATABASE,
      t('Could not save configuration at this time.')
    );
  }
}

export async function addLevels(client, guildId, userId, levels) {
  try {
    const levelingConfig = await getLevelingConfig(client, guildId);
    if (!levelingConfig?.enabled) {
      throw new TitanBotError(
        'Leveling system is disabled on this server',
        ErrorTypes.CONFIGURATION,
        t('The leveling system is currently disabled on this server.')
      );
    }

    if (!Number.isInteger(levels) || levels <= 0) {
      throw new TitanBotError(
        `Invalid level amount: ${levels}`,
        ErrorTypes.VALIDATION,
        t('You must add a positive number of levels.')
      );
    }

    const userData = await getUserLevelData(client, guildId, userId);
    const newLevel = userData.level + levels;

    if (newLevel > MAX_LEVEL) {
      throw new TitanBotError(
        `Level ${newLevel} exceeds maximum level ${MAX_LEVEL}`,
        ErrorTypes.VALIDATION,
        t`Maximum level is ${MAX_LEVEL}.`
      );
    }

    const newXp = 0;
    const newTotalXp = calculateTotalXp(newLevel, newXp);

    userData.level = newLevel;
    userData.xp = newXp;
    userData.totalXp = newTotalXp;

    await saveUserLevelData(client, guildId, userId, userData);
    
    logger.info(`Added ${levels} levels to user ${userId} in guild ${guildId}`);
    return userData;
  } catch (error) {
    logger.error(`Error adding levels for user ${userId}:`, error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Failed to add levels: ${error.message}`,
      ErrorTypes.DATABASE,
      t('Could not add levels at this time.')
    );
  }
}

export async function removeLevels(client, guildId, userId, levels) {
  try {
    const levelingConfig = await getLevelingConfig(client, guildId);
    if (!levelingConfig?.enabled) {
      throw new TitanBotError(
        'Leveling system is disabled on this server',
        ErrorTypes.CONFIGURATION,
        t('The leveling system is currently disabled on this server.')
      );
    }

    if (!Number.isInteger(levels) || levels <= 0) {
      throw new TitanBotError(
        `Invalid level amount: ${levels}`,
        ErrorTypes.VALIDATION,
        t('You must remove a positive number of levels.')
      );
    }

    const userData = await getUserLevelData(client, guildId, userId);
    const newLevel = Math.max(MIN_LEVEL, userData.level - levels);

    const newXp = 0;
    const newTotalXp = calculateTotalXp(newLevel, newXp);

    userData.level = newLevel;
    userData.xp = newXp;
    userData.totalXp = newTotalXp;

    await saveUserLevelData(client, guildId, userId, userData);
    
    logger.info(`Removed ${levels} levels from user ${userId} in guild ${guildId}`);
    return userData;
  } catch (error) {
    logger.error(`Error removing levels for user ${userId}:`, error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Failed to remove levels: ${error.message}`,
      ErrorTypes.DATABASE,
      t('Could not remove levels at this time.')
    );
  }
}

export async function setUserLevel(client, guildId, userId, level) {
  try {
    const levelingConfig = await getLevelingConfig(client, guildId);
    if (!levelingConfig?.enabled) {
      throw new TitanBotError(
        'Leveling system is disabled on this server',
        ErrorTypes.CONFIGURATION,
        t('The leveling system is currently disabled on this server.')
      );
    }

    if (!Number.isInteger(level) || level < MIN_LEVEL || level > MAX_LEVEL) {
      throw new TitanBotError(
        `Invalid level: ${level}`,
        ErrorTypes.VALIDATION,
        t`Level must be between ${MIN_LEVEL} and ${MAX_LEVEL}.`
      );
    }

    const userData = await getUserLevelData(client, guildId, userId);
    
    const newXp = 0;
    const newTotalXp = calculateTotalXp(level, newXp);

    userData.level = level;
    userData.xp = newXp;
    userData.totalXp = newTotalXp;

    await saveUserLevelData(client, guildId, userId, userData);
    
    logger.info(`Set level for user ${userId} to ${level} in guild ${guildId}`);
    return userData;
  } catch (error) {
    logger.error(`Error setting level for user ${userId}:`, error);
    if (error instanceof TitanBotError) throw error;
    throw new TitanBotError(
      `Failed to set level: ${error.message}`,
      ErrorTypes.DATABASE,
      t('Could not set level at this time.')
    );
  }
}

export async function deleteUserLevelData(client, guildId, userId) {
  try {
    if (!guildId || !userId) {
      throw new TitanBotError(
        'Guild ID and User ID are required',
        ErrorTypes.VALIDATION
      );
    }

    const key = getUserLevelKey(guildId, userId);
    await client.db.delete(key);
    
    logger.debug(`Deleted level data for user ${userId} in guild ${guildId}`);
  } catch (error) {
    logger.error(`Error deleting level data for user ${userId}:`, error);
    if (error instanceof TitanBotError) throw error;
    logger.warn(`Could not delete level data for user ${userId} in guild ${guildId}`);
  }
}