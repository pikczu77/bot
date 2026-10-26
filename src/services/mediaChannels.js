// mediaChannels.js — channels for pictures, e.g. fan art (2026-10-26, owner: "na fanarty jak sie wrzuci zdjecie to sa
// emotki serdusza a wiadomosci usuwaja sie automatycznie").
//
// A message with a picture or a video (an attachment or a link to one) gets the channel's reactions (a heart by
// default) and, when `thread` is on, its own thread for comments. Any other message is deleted at once with a short
// notice that disappears too. Members with Manage Messages may write normally (pins, rules, answers).
// Settings: guild:{id}:media-channels = { channels: [{ channelId, reactions, deleteOther, thread }] }, set with
// /channel zdjecia and in the web panel ("Kanały na zdjęcia").

import { PermissionFlagsBits } from 'discord.js';
import { createEmbed } from '../utils/embeds.js';
import { guildStore } from '../utils/featureKit.js';
import { logger } from '../utils/logger.js';
import { t } from '../i18n/index.js';

export const MAX_MEDIA_CHANNELS = 10;
export const MAX_REACTIONS = 5;
export const DEFAULT_REACTIONS = Object.freeze(['❤️']);
export const NOTICE_MS = 6000;

const store = guildStore('media-channels', { channels: [] });
export const getMediaChannels = async (guildId) => (await store.get(guildId)).channels ?? [];
export const updateMediaChannels = (guildId, mutate) => store.update(guildId, mutate);

const MEDIA_TYPES = /^(image|video)\//;
const MEDIA_URL = /https?:\/\/\S+\.(?:png|jpe?g|gif|webp|avif|bmp|mp4|mov|webm)(?:[?#]\S*)?/i;
const MEDIA_HOSTS = /https?:\/\/(?:\S+\.)?(?:tenor\.com|giphy\.com|imgur\.com|i\.redd\.it|pinterest\.\S+|pin\.it|deviantart\.com|artstation\.com|pixiv\.net|twitter\.com|x\.com|instagram\.com)\//i;

/** True when the message carries a picture or a video. */
export function hasMedia(message) {
  if ([...(message.attachments?.values?.() ?? [])].some((file) => MEDIA_TYPES.test(file.contentType ?? '') || MEDIA_URL.test(file.url ?? file.name ?? ''))) return true;
  if ((message.stickers?.size ?? 0) > 0) return false;
  if ((message.embeds ?? []).some((embed) => ['image', 'gifv', 'video'].includes(embed.data?.type ?? embed.type) || embed.image || embed.thumbnail)) return true;
  const content = message.content ?? '';
  return MEDIA_URL.test(content) || MEDIA_HOSTS.test(content);
}

/** Emoji text the bot can react with: unicode emoji or a custom one written as <:name:id>. */
export function parseReactions(text) {
  const custom = [...String(text ?? '').matchAll(/<a?:\w{2,32}:(\d{17,20})>/g)].map((match) => match[0]);
  const plain = String(text ?? '').replace(/<a?:\w{2,32}:\d{17,20}>/g, ' ')
    .match(/(?:\p{Extended_Pictographic}|\p{Regional_Indicator}{2})(?:️|‍(?:\p{Extended_Pictographic})️?|\p{Emoji_Modifier})*/gu) ?? [];
  return [...new Set([...custom, ...plain])].slice(0, MAX_REACTIONS);
}

const reactionKey = (emoji) => (/^<a?:\w+:(\d+)>$/.test(emoji) ? emoji.replace(/^<a?:\w+:(\d+)>$/, '$1') : emoji);

/** messageCreate: true when the message was removed here (other handlers should skip it). */
export async function handleMediaMessage(message) {
  if (!message.guild) return false;
  const settings = (await getMediaChannels(message.guild.id)).find((entry) => entry.channelId === message.channelId);
  if (!settings) return false;

  if (hasMedia(message)) {
    for (const emoji of settings.reactions?.length ? settings.reactions : DEFAULT_REACTIONS) {
      await message.react(reactionKey(emoji)).catch((error) => logger.debug(`Media channel reaction ${emoji} failed: ${error.message}`));
    }
    if (settings.thread && message.startThread) {
      const name = t`Comments: ${message.member?.displayName ?? message.author?.username ?? ''}`.slice(0, 90);
      await message.startThread({ name, autoArchiveDuration: 1440 }).catch((error) => logger.debug(`Media channel thread failed: ${error.message}`));
    }
    return false;
  }

  if (settings.deleteOther === false) return false;
  if (message.member?.permissions?.has?.(PermissionFlagsBits.ManageMessages)) return false;
  await message.delete().catch((error) => logger.debug(`Media channel delete failed: ${error.message}`));
  const notice = await message.channel.send({
    embeds: [createEmbed({
      description: settings.thread
        ? t`📸 ${message.author}, this channel is for pictures only. Comment in the thread under a picture.`
        : t`📸 ${message.author}, this channel is for pictures only. Talk about them on the chat.`,
      color: 'warning',
      footer: false,
    })],
    allowedMentions: { users: [message.author.id] },
  }).catch(() => null);
  if (notice) setTimeout(() => notice.delete().catch(() => {}), NOTICE_MS).unref?.();
  return true;
}

/** Add or change one channel. Returns the saved list. */
export async function setMediaChannel(guildId, channelId, { reactions, deleteOther, thread } = {}) {
  const saved = await updateMediaChannels(guildId, (data) => {
    const list = [...(data.channels ?? [])];
    const index = list.findIndex((entry) => entry.channelId === channelId);
    const current = index >= 0 ? list[index] : { channelId, reactions: [...DEFAULT_REACTIONS], deleteOther: true, thread: false };
    const next = {
      ...current,
      ...(reactions?.length ? { reactions: reactions.slice(0, MAX_REACTIONS) } : {}),
      ...(typeof deleteOther === 'boolean' ? { deleteOther } : {}),
      ...(typeof thread === 'boolean' ? { thread } : {}),
    };
    if (index >= 0) list[index] = next;
    else {
      if (list.length >= MAX_MEDIA_CHANNELS) throw new Error('too many media channels');
      list.push(next);
    }
    data.channels = list;
  });
  return saved.channels;
}

export async function removeMediaChannel(guildId, channelId) {
  const saved = await updateMediaChannels(guildId, (data) => {
    data.channels = (data.channels ?? []).filter((entry) => entry.channelId !== channelId);
  });
  return saved.channels;
}
