import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Events } from 'discord.js';
import { createEmbed, infoEmbed } from '../utils/embeds.js';
import { truncate } from '../utils/featureKit.js';
import { getCommandPrefix } from '../config/bot.js';
import {
  NOTE_PREFIX,
  findModmailGuilds,
  getModmailConfig,
  getThreadByChannel,
  getThreadByUser,
  isModmailStaff,
  relayToStaff,
  relayToUser,
} from '../services/modmailService.js';
import { logger } from '../utils/logger.js';
import { t } from '../i18n/index.js';

// First DM of a conversation, kept until the user picks a server.
export const pendingFirstMessages = new Map();
const PENDING_TTL_MS = 10 * 60 * 1000;
const promptCooldown = new Map();

async function handleDirectMessage(message, client) {
  const thread = await getThreadByUser(message.author.id);
  if (thread) {
    const delivered = await relayToStaff(client, thread, message);
    await message.react(delivered ? '✅' : '❌').catch(() => {});
    if (!delivered) {
      await message.channel.send({ embeds: [infoEmbed(t('That conversation was closed. Send your message again to start a new one.'))] }).catch(() => {});
    }
    return;
  }

  // One prompt at a time: several quick messages must not spam buttons.
  const lastPrompt = promptCooldown.get(message.author.id) ?? 0;
  pendingFirstMessages.set(message.author.id, { message, at: Date.now() });
  setTimeout(() => {
    const pending = pendingFirstMessages.get(message.author.id);
    if (pending && Date.now() - pending.at >= PENDING_TTL_MS) pendingFirstMessages.delete(message.author.id);
  }, PENDING_TTL_MS + 1000).unref?.();
  if (Date.now() - lastPrompt < 30_000) return;
  promptCooldown.set(message.author.id, Date.now());

  const guilds = await findModmailGuilds(client, message.author.id);
  if (guilds.length === 0) {
    pendingFirstMessages.delete(message.author.id);
    await message.channel.send({
      embeds: [infoEmbed(t('I cannot pass this on'), t('None of the servers we share accepts private messages to staff.'))],
    }).catch(() => {});
    return;
  }

  const row = new ActionRowBuilder().addComponents(
    ...guilds.slice(0, 4).map((guild) =>
      new ButtonBuilder()
        .setCustomId(`modmail_open:${guild.id}`)
        .setLabel(truncate(guild.name, 70))
        .setEmoji('📨')
        .setStyle(ButtonStyle.Primary),
    ),
    new ButtonBuilder().setCustomId('modmail_cancel').setLabel(t('Cancel')).setStyle(ButtonStyle.Secondary),
  );

  await message.channel.send({
    embeds: [createEmbed({
      title: t('📬 Contact the staff'),
      description: guilds.length === 1
        ? t`Do you want to send this message to the staff of **${guilds[0].name}**? They will answer you here.`
        : t('Which server do you want to write to? The staff will answer you here.'),
      color: 'info',
      footer: false,
    })],
    components: [row],
  }).catch((error) => logger.debug(`Modmail prompt failed: ${error.message}`));
}

async function handleStaffMessage(message, client) {
  const thread = await getThreadByChannel(message.guild.id, message.channel.id);
  if (!thread) return;

  const content = message.content ?? '';
  const prefix = getCommandPrefix();
  if (content.startsWith(NOTE_PREFIX)) {
    await message.react('📝').catch(() => {});
    return;
  }
  if (content.startsWith(prefix) || (!content.trim() && message.attachments.size === 0)) return;

  const config = await getModmailConfig(message.guild.id);
  if (!isModmailStaff(message.member, config)) return;

  const delivered = await relayToUser(client, thread, message.member, content, message.attachments, { anonymous: config.anonymous });
  await message.react(delivered ? '✅' : '❌').catch(() => {});
  if (!delivered) {
    await message.reply({
      embeds: [infoEmbed(t('Not delivered'), t('The user has DMs closed or left every shared server.'))],
      allowedMentions: { repliedUser: false },
    }).catch(() => {});
  }
}

export default {
  name: Events.MessageCreate,
  async execute(message, client) {
    try {
      if (message.author?.bot) return;

      if (!message.guild) {
        await handleDirectMessage(message, client);
        return;
      }

      // Conversation channels are tagged in their topic — cheap check before any lookup.
      if (message.channel?.topic?.startsWith('Modmail ·')) {
        await handleStaffMessage(message, client);
      }
    } catch (error) {
      logger.error('Error in modmail message handler:', error);
    }
  },
};
