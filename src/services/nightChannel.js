// nightChannel.js — a channel everyone sees only at night (2026-10-15, owner: "#wulgarny-chat ...
// pojawia się od 22 do 6 rano ... o 6:00 ma znikać dla każdego, być niewidoczny aż do kolejnej 22").
//
// Settings: automod config `nightChannel: { enabled, channelId, from, to }` (Polish hours), set in
// the web panel. Checked every minute (features.js) and right after the panel saves.
//
// Closing: whatever the admins set up as "who sees the channel" is remembered first (the
// @everyone overwrite and every role/member overwrite that allows View Channel), then View
// Channel is denied to @everyone and to each of them. The bot keeps its own access. Opening
// puts the remembered permissions back. Members with Administrator always see every channel.
// What swearing is allowed there: automod `rules.words.freeChannels` (slurs stay banned).

import { OverwriteType, PermissionFlagsBits } from 'discord.js';
import { guildStore } from '../utils/featureKit.js';
import { logger } from '../utils/logger.js';
import { getAutomodConfig, inHourRange, localHour } from './automodService.js';

const VIEW = PermissionFlagsBits.ViewChannel;
// guildId -> { channelId, closed, everyone: true|false|null, allowed: [{ id, type }] }
const store = guildStore('night-channel', {});

/** Should the channel be open now? */
export const nightChannelOpen = (settings, now = Date.now()) => inHourRange(localHour(now), settings.from, settings.to);

/** What the overwrites say about View Channel: true (allowed), false (denied) or null (not set). */
function viewState(overwrite) {
  if (!overwrite) return null;
  if (overwrite.allow.has(VIEW)) return true;
  if (overwrite.deny.has(VIEW)) return false;
  return null;
}

async function close(channel) {
  const { guild } = channel;
  const everyoneId = guild.roles.everyone.id;
  const botId = guild.members.me?.id ?? channel.client.user.id;
  const allowed = [...channel.permissionOverwrites.cache.values()]
    .filter((overwrite) => overwrite.id !== everyoneId && overwrite.id !== botId && overwrite.allow.has(VIEW))
    .map((overwrite) => ({ id: overwrite.id, type: overwrite.type }));
  const remembered = { channelId: channel.id, closed: true, everyone: viewState(channel.permissionOverwrites.cache.get(everyoneId)), allowed };

  // The bot first gives itself access, so it can still open the channel in the morning.
  await channel.permissionOverwrites.edit(botId, { ViewChannel: true }, { type: OverwriteType.Member, reason: 'Night channel: the bot keeps access' });
  await channel.permissionOverwrites.edit(everyoneId, { ViewChannel: false }, { type: OverwriteType.Role, reason: 'Night channel: closed until the evening' });
  for (const entry of allowed) {
    await channel.permissionOverwrites.edit(entry.id, { ViewChannel: false }, { type: entry.type, reason: 'Night channel: closed until the evening' });
  }
  await store.set(guild.id, remembered);
  return remembered;
}

async function open(channel, state) {
  const { guild } = channel;
  const everyoneId = guild.roles.everyone.id;
  // Nothing remembered (first start while open hours): @everyone sees it.
  const everyone = state?.channelId === channel.id ? state.everyone : null;
  await channel.permissionOverwrites.edit(everyoneId, { ViewChannel: everyone }, { type: OverwriteType.Role, reason: 'Night channel: open for the night' });
  for (const entry of state?.channelId === channel.id ? state.allowed ?? [] : []) {
    await channel.permissionOverwrites.edit(entry.id, { ViewChannel: true }, { type: entry.type, reason: 'Night channel: open for the night' }).catch(() => {});
  }
  const next = { channelId: channel.id, closed: false, everyone: null, allowed: [] };
  await store.set(guild.id, next);
  return next;
}

/**
 * Open or close the night channel of `guild` when the hour says so. Returns 'opened', 'closed'
 * or null (nothing to do).
 */
export async function applyNightChannel(guild, now = Date.now()) {
  const { nightChannel: settings } = await getAutomodConfig(guild.id, { fresh: true });
  const state = await store.get(guild.id);
  const channel = settings.channelId ? guild.channels.cache.get(settings.channelId) : null;

  // Turned off or moved to another channel: the old channel is opened once and forgotten.
  if (state?.closed && (!settings.enabled || state.channelId !== settings.channelId)) {
    const old = guild.channels.cache.get(state.channelId);
    if (old) await open(old, state);
    else await store.set(guild.id, {});
    if (!settings.enabled) return 'opened';
  }
  if (!settings.enabled || !channel?.permissionOverwrites) return null;

  const shouldBeOpen = nightChannelOpen(settings, now);
  const isClosed = state?.channelId === channel.id && state.closed === true;
  if (shouldBeOpen && isClosed) {
    await open(channel, state);
    logger.info(`Night channel #${channel.name} opened in guild ${guild.id}`);
    return 'opened';
  }
  if (!shouldBeOpen && !isClosed) {
    await close(channel);
    logger.info(`Night channel #${channel.name} closed in guild ${guild.id}`);
    return 'closed';
  }
  return null;
}

/** The minute job: every guild the bot is in. */
export async function applyNightChannels(client) {
  for (const guild of client.guilds.cache.values()) {
    await applyNightChannel(guild).catch((error) => logger.warn(`Night channel failed in guild ${guild.id}: ${error.message}`));
  }
}
