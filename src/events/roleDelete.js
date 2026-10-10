import { Events } from 'discord.js';
import { logEvent, EVENT_TYPES } from '../services/loggingService.js';
import { logger } from '../utils/logger.js';
import { buildRoleAuditLines } from '../utils/logging/logEmbeds.js';
import { t } from '../i18n/index.js';

export default {
  name: Events.GuildRoleDelete,
  once: false,

  async execute(role) {
    try {
      if (!role.guild) return;

      const lines = buildRoleAuditLines(role, { includeMemberCount: true });

      await logEvent({
        client: role.client,
        guildId: role.guild.id,
        eventType: EVENT_TYPES.ROLE_DELETE,
        data: {
          title: t('Role Deleted'),
          headline: t`**${role.name}** was deleted`,
          lines,
        },
      });

    } catch (error) {
      logger.error('Error in roleDelete event:', error);
    }
  }
};