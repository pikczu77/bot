import { Events } from 'discord.js';
import { handleJoinForRaid } from '../services/automodService.js';
import { logger } from '../utils/logger.js';

export default {
  name: Events.GuildMemberAdd,
  async execute(member) {
    try {
      await handleJoinForRaid(member);
    } catch (error) {
      logger.error('Error in automod join handler:', error);
    }
  },
};
