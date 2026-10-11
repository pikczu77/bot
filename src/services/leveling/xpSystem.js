// xpSystem.js

import { logger } from '../../utils/logger.js';
import { getLevelingConfig, getXpForLevel, getUserLevelData, saveUserLevelData } from './leveling.js';
import { logEvent, EVENT_TYPES } from '../loggingService.js';
import { formatLogLine } from '../../utils/logging/logEmbeds.js';
import { Mutex } from '../../utils/mutex.js';
import { wrapServiceBoundary } from '../../utils/errorHandler.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { money } from '../economySettings.js';
import { t, trAny } from '../../i18n/index.js';

/**
 * Award XP to a member. Returns null when XP is skipped (disabled/invalid amount).
 * Throws on storage or unexpected failures.
 *
 * options.channel: where the XP was earned (for "announce in the same channel").
 * options.touchCooldown: false for XP that is not a message (voice), so it does not
 * restart the message cooldown.
 */
export const addXp = wrapServiceBoundary(async function addXp(client, guild, member, xpToAdd, options = {}) {
  const lockKey = `leveling:${guild.id}:${member.user.id}`;
  return await Mutex.runExclusive(lockKey, async () => {
    if (!xpToAdd || xpToAdd <= 0) {
      return null;
    }

    const config = await getLevelingConfig(client, guild.id);

    if (!config.enabled) {
      return null;
    }

    const levelData = await getUserLevelData(client, guild.id, member.user.id);

    levelData.xp += xpToAdd;
    levelData.totalXp += xpToAdd;
    if (options.touchCooldown !== false) levelData.lastMessage = Date.now();
    let rewardRole = null;

    let xpNeededForNextLevel = getXpForLevel(levelData.level);
    let didLevelUp = false;
    const initialLevel = levelData.level;

    while (levelData.xp >= xpNeededForNextLevel && levelData.level < 1000) {
      levelData.xp -= xpNeededForNextLevel;
      levelData.level += 1;
      didLevelUp = true;
      xpNeededForNextLevel = getXpForLevel(levelData.level);

      logger.info(`🎉 ${member.user.tag} leveled up to level ${levelData.level} in ${guild.name}`);

      if (config.roleRewards && config.roleRewards[levelData.level]) {
        rewardRole = await awardRoleReward(guild, member, config.roleRewards[levelData.level], levelData.level, config) ?? rewardRole;
      }
    }

    if (didLevelUp) {
      const moneyReward = await payLevelMoney(client, guild, member, config, levelData.level - initialLevel);

      if (config.announceLevelUp) {
        await sendLevelUpAnnouncement(guild, member, levelData, config, { channel: options.channel, moneyReward, rewardRole });
      }

      try {
        await logEvent({
          client,
          guildId: guild.id,
          eventType: EVENT_TYPES.LEVELING_LEVELUP,
          data: {
            title: t('Level Up'),
            lines: [
              formatLogLine(t('Member'), `${member.user.tag} (\`${member.user.id}\`)`),
              formatLogLine(t('New Level'), levelData.level.toString()),
              formatLogLine(t('Levels Gained'), (levelData.level - initialLevel).toString()),
              formatLogLine(t('Total XP'), levelData.totalXp.toString()),
            ],
            userId: member.user.id,
          },
        });
      } catch (logError) {
        logger.debug('Failed to log leveling event:', logError.message);
      }
    }

    await saveUserLevelData(client, guild.id, member.user.id, levelData);

    return {
      level: levelData.level,
      xp: levelData.xp,
      totalXp: levelData.totalXp,
      xpNeeded: getXpForLevel(levelData.level + 1),
      leveledUp: didLevelUp,
    };
  });
}, {
  service: 'xpSystem',
  operation: 'addXp',
  userMessage: t('Failed to award XP. Please try again.'),
});

// Gives the reward role of a level. Returns the role when the member has it afterwards.
async function awardRoleReward(guild, member, roleId, level, config) {
  try {
    const role = guild.roles.cache.get(roleId);

    if (!role) {
      logger.warn(`Role ${roleId} not found for level ${level} reward in guild ${guild.id}`);
      return null;
    }

    if (!member.roles.cache.has(roleId)) {
      await member.roles.add(role, t`Level ${level} reward`);
      logger.info(`✅ Awarded role ${role.name} to ${member.user.tag} for reaching level ${level}`);
    }

    if (config.removePreviousRoles) {
      for (const [rewardLevel, previousRoleId] of Object.entries(config.roleRewards)) {
        if (Number(rewardLevel) >= level || previousRoleId === roleId || !member.roles.cache.has(previousRoleId)) continue;
        await member.roles.remove(guild.roles.cache.get(previousRoleId) ?? previousRoleId, t`Level ${level} reward`).catch((error) => {
          logger.warn(`Could not remove the level ${rewardLevel} role from ${member.user.id}: ${error.message}`);
        });
      }
    }

    return role;
  } catch (error) {
    logger.error(`Failed to award role reward to ${member.user.id}:`, error);
    return null;
  }
}

// Economy money for the levels gained. Returns the amount paid (0 when the reward is off).
async function payLevelMoney(client, guild, member, config, levelsGained) {
  const amount = Math.max(0, Math.floor(Number(config.moneyPerLevel) || 0)) * levelsGained;
  if (amount <= 0) return 0;
  try {
    const account = await getEconomyData(client, guild.id, member.user.id);
    account.wallet = (account.wallet || 0) + amount;
    await setEconomyData(client, guild.id, member.user.id, account);
    return amount;
  } catch (error) {
    logger.error(`Failed to pay the level reward to ${member.user.id}:`, error);
    return 0;
  }
}

async function sendLevelUpAnnouncement(guild, member, levelData, config, { channel = null, moneyReward = 0, rewardRole = null } = {}) {
  try {
    const sameChannel = config.levelUpSameChannel && channel ? channel : null;
    const levelUpChannel = sameChannel ?? (config.levelUpChannel
      ? guild.channels.cache.get(config.levelUpChannel)
      : guild.systemChannel);

    if (!levelUpChannel || !levelUpChannel.isTextBased()) {
      return;
    }

    const permissions = levelUpChannel.permissionsFor(guild.members.me);
    if (!permissions || !permissions.has(['SendMessages', 'EmbedLinks'])) {
      logger.warn(`Missing permissions to send levelup message in ${levelUpChannel.id}`);
      return;
    }

    const message = trAny(config.levelUpMessage)
      .replace(/{user}/g, member.toString())
      .replace(/{level}/g, levelData.level)
      .replace(/{xp}/g, levelData.xp)
      .replace(/{xpNeeded}/g, getXpForLevel(levelData.level + 1))
      .replace(/{money}/g, moneyReward > 0 ? money(guild.id, moneyReward) : '')
      .replace(/{role}/g, rewardRole ? `**${rewardRole.name}**` : '')
      .replace(/ {2,}/g, ' ')
      .trim();

    await levelUpChannel.send({ content: message, allowedMentions: { users: [member.user.id] } }).catch(error => {
      logger.error(`Failed to send level up message in channel ${levelUpChannel.id}:`, error);
    });
  } catch (error) {
    logger.error('Error sending level up announcement:', error);
  }
}
