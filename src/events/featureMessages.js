import { Events } from 'discord.js';
import { getCommandPrefix } from '../config/bot.js';
import { runAutomod } from '../services/automodService.js';
import { handleWhitelistMessage } from '../services/minecraftWhitelist.js';
import { handleConsoleMessage } from '../services/minecraftConsole.js';
import { noteQuizActivity } from '../services/quiz.js';
import { handleChatBridgeMessage } from '../services/minecraftChat.js';
import { handleMediaMessage } from '../services/mediaChannels.js';
import { handleChatMessage } from '../services/chatEngagement.js';
import { handleHalloweenMessage } from '../services/halloween.js';
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
      noteQuizActivity(message);
      // The Minecraft nick, console and chat channels handle every message themselves.
      if (await handleWhitelistMessage(message)) return;
      if (await handleConsoleMessage(message)) return;
      if (await handleChatBridgeMessage(message)) return;
      // Picture channels (fan art): reactions under pictures, other messages are deleted.
      if (await handleMediaMessage(message)) return;
      // Halloween 2026: candies for every message (never stops the other handlers).
      await handleHalloweenMessage(message).catch((error) => logger.warn(`Halloween candies failed: ${error.message}`));
      // Main chat: activity for drops and the Dead Chat ping, catching a drop.
      if (await handleChatMessage(message)) return;

      const guildConfig = await getGuildConfig(client, message.guild.id);
      await handleTagMessage(message, guildConfig?.prefix || getCommandPrefix());
      await bumpSticky(message);
    } catch (error) {
      logger.error('Error in feature message handler:', error);
    }
  },
};
