import { Events } from 'discord.js';
import { getCommandPrefix } from '../config/bot.js';
import { runAutomod } from '../services/automodService.js';
import { bumpSticky, handleTagMessage } from '../services/tagService.js';
import { getGuildConfig } from '../services/config/guildConfig.js';
import { logger } from '../utils/logger.js';

// Automod first (a removed message gets no reply), then tags/auto-responders,
// then sticky messages.
export default {
  name: Events.MessageCreate,
  async execute(message, client) {
    if (!message.guild || message.author?.bot) {
      // Keep stickies at the bottom even after bot messages (but never after our own sticky).
      if (message.guild && message.author?.id !== client.user.id) {
        await bumpSticky(message).catch(() => {});
      }
      return;
    }

    try {
      if (await runAutomod(message)) return;

      const guildConfig = await getGuildConfig(client, message.guild.id);
      await handleTagMessage(message, guildConfig?.prefix || getCommandPrefix());
      await bumpSticky(message);
    } catch (error) {
      logger.error('Error in feature message handler:', error);
    }
  },
};
