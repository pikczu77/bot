import { Events } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';
import { t } from '../i18n/index.js';

export default {
  name: Events.GuildMemberUpdate,
  once: false,

  async execute(oldMember, newMember) {
    try {
      if (!newMember.guild) return;

      if (oldMember.nickname !== newMember.nickname) {
        await logEvent({
          client: newMember.client,
          guildId: newMember.guild.id,
          eventType: EVENT_TYPES.MEMBER_NAME_CHANGE,
          data: {
            title: t('Nickname changed'),
            lines: [
              t`**User:** ${newMember.user.toString()} (${newMember.user.tag})`,
              t`**ID:** \`${newMember.user.id}\``,
              t`**Before:** ${oldMember.nickname || t('*(no nickname)*')}`,
              t`**After:** ${newMember.nickname || t('*(no nickname)*')}`,
            ],
            thumbnail: newMember.user.displayAvatarURL({ dynamic: true }),
            userId: newMember.user.id,
          }
        });

        return;
      }

    } catch (error) {
      logger.error('Error in guildMemberUpdate event:', error);
    }
  }
};