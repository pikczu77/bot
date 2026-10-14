import { Events, PermissionFlagsBits } from 'discord.js';
import { getWelcomeConfig, getUserApplications, deleteApplication } from '../utils/database.js';
import { buildGreetingMessage } from '../utils/welcome.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { getServerCounters, updateCounter } from '../services/serverstatsService.js';
import { getGuildBirthdays, deleteBirthday } from '../utils/database.js';
import { deleteUserLevelData, getLevelingConfig } from '../services/leveling/leveling.js';
import { getEconomySettings } from '../services/economySettings.js';
import { getEconomyKey } from '../utils/database.js';
import { endMarriageOnLeave } from '../services/marriageService.js';
import { logger } from '../utils/logger.js';
import { t } from '../i18n/index.js';

export default {
  name: Events.GuildMemberRemove,
  once: false,
  
  async execute(member) {
    try {
        const { guild, user } = member;
        
        const welcomeConfig = await getWelcomeConfig(member.client, guild.id);
        
        const goodbyeChannelId = welcomeConfig?.goodbyeChannelId;

        if (welcomeConfig?.goodbyeEnabled && goodbyeChannelId) {
            const channel = guild.channels.cache.get(goodbyeChannelId);
            if (channel?.isTextBased?.()) {
                const me = guild.members.me;
                const permissions = me ? channel.permissionsFor(me) : null;
                if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
                    return;
                }

                await channel.send(buildGreetingMessage('goodbye', welcomeConfig, {
                    user,
                    guild,
                    member,
                    canEmbed: permissions.has(PermissionFlagsBits.EmbedLinks)
                }));
            }
        }

        try {
            await logEvent({
                client: member.client,
                guildId: guild.id,
                eventType: EVENT_TYPES.MEMBER_LEAVE,
                data: {
                    title: t('User left'),
                    lines: [
                        t`**User:** ${user.toString()} (${user.tag})`,
                        t`**ID:** \`${user.id}\``,
                        t`**Joined:** <t:${Math.floor((member.joinedTimestamp || Date.now()) / 1000)}:R>`,
                        t`**Members:** ${guild.memberCount}`,
                    ],
                    quoted: false,
                    thumbnail: user.displayAvatarURL({ dynamic: true }),
                    userId: user.id,
                }
            });
        } catch (error) {
            logger.debug('Error logging member leave:', error);
        }

        try {
            const counters = await getServerCounters(member.client, guild.id);
            for (const counter of counters) {
                if (counter && counter.type && counter.channelId && counter.enabled !== false) {
                    await updateCounter(member.client, guild, counter);
                }
            }
        } catch (error) {
            logger.debug('Error updating counters on member leave:', error);
        }

        try {
            const birthdays = await getGuildBirthdays(member.client, guild.id);
            if (birthdays[user.id]) {
                const backupKey = `guild:${guild.id}:birthdays:left`;
                const backup = (await member.client.db.get(backupKey)) || {};
                backup[user.id] = birthdays[user.id];
                await member.client.db.set(backupKey, backup);
                await deleteBirthday(member.client, guild.id, user.id);
                logger.debug(`Birthday backed up and removed for user ${user.id} in guild ${guild.id}`);
            }
        } catch (error) {
            logger.debug('Error handling birthday on member leave:', error);
        }

        try {
            const userApplications = await getUserApplications(member.client, guild.id, user.id);
            if (userApplications && userApplications.length > 0) {
                for (const app of userApplications) {
                    await deleteApplication(member.client, guild.id, app.id, user.id);
                }
                logger.debug(`Removed ${userApplications.length} applications for user ${user.id} in guild ${guild.id}`);
            }
        } catch (error) {
            logger.debug('Error handling applications on member leave:', error);
        }

        try {
            const economy = await getEconomySettings(guild.id);
            if (economy.clearOnLeave) {
                await member.client.db.delete(getEconomyKey(guild.id, user.id));
                logger.debug(`Removed economy data for user ${user.id} in guild ${guild.id}`);
            }
        } catch (error) {
            logger.debug('Error handling economy data on member leave:', error);
        }

        try {
            // The joint bank ends with the marriage; the spouse keeps their own account.
            await endMarriageOnLeave(guild.id, user.id);
        } catch (error) {
            logger.debug('Error ending a marriage on member leave:', error);
        }

        try {
            const leveling = await getLevelingConfig(member.client, guild.id);
            if (leveling.clearOnLeave !== false) {
                await deleteUserLevelData(member.client, guild.id, user.id);
                logger.debug(`Removed leveling data for user ${user.id} in guild ${guild.id}`);
            }
        } catch (error) {
            logger.debug('Error handling leveling data on member leave:', error);
        }
        
    } catch (error) {
        logger.error('Error in guildMemberRemove event:', error);
    }
  }
};