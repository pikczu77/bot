// nightChannel.js — channels everyone sees only in chosen hours (2026-10-15, owner: "#wulgarny-chat ...
// pojawia się od 22 do 6 rano ... o 6:00 ma znikać dla każdego, być niewidoczny aż do kolejnej 22").
// 2026-10-17 (owner: "niech bedzie w automoderacji jako kanaly do ustawienia z godzinami na stronie"):
// a list of channels, each with its own hours, instead of one night channel.
//
// Settings: automod config `nightChannels: [{ channelId, from, to }]` (Polish hours), set in the web
// panel. Checked every minute (features.js) and right after the panel saves.
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
// guildId -> { channels: { [channelId]: { closed, done, everyone: true|false|null, allowed: [{ id, type }] } } }
// A channel that is open has no entry. `done: false` = closing stopped half-way (it is retried).
const store = guildStore('night-channel', {});

/** Should the channel be open now? */
export const nightChannelOpen = (settings, now = Date.now()) => inHourRange(localHour(now), settings.from, settings.to);

/** Stored states; the single-channel shape from before 2026-10-17 is read as a one-entry map. */
function readStates(stored) {
  if (stored?.channels) return { ...stored.channels };
  if (stored?.channelId && stored.closed) return { [stored.channelId]: { closed: true, everyone: stored.everyone ?? null, allowed: stored.allowed ?? [] } };
  return {};
}

/** What the overwrites say about View Channel: true (allowed), false (denied) or null (not set). */
function viewState(overwrite) {
  if (!overwrite) return null;
  if (overwrite.allow.has(VIEW)) return true;
  if (overwrite.deny.has(VIEW)) return false;
  return null;
}

async function close(channel, states, save) {
  const { guild } = channel;
  const everyoneId = guild.roles.everyone.id;
  const botId = guild.members.me?.id ?? channel.client.user.id;
  // Remember first, so a failure half-way never loses who could see the channel; a retry reuses it.
  let remembered = states[channel.id];
  if (!remembered?.closed) {
    const allowed = [...channel.permissionOverwrites.cache.values()]
      .filter((overwrite) => overwrite.id !== everyoneId && overwrite.id !== botId && overwrite.allow.has(VIEW))
      .map((overwrite) => ({ id: overwrite.id, type: overwrite.type }));
    remembered = { closed: true, done: false, everyone: viewState(channel.permissionOverwrites.cache.get(everyoneId)), allowed };
    states[channel.id] = remembered;
    await save();
  }

  // The bot first gives itself access, so it can still open the channel later.
  await channel.permissionOverwrites.edit(botId, { ViewChannel: true }, { type: OverwriteType.Member, reason: 'Night channel: the bot keeps access' });
  await channel.permissionOverwrites.edit(everyoneId, { ViewChannel: false }, { type: OverwriteType.Role, reason: 'Night channel: closed until its hours' });
  for (const entry of remembered.allowed) {
    await channel.permissionOverwrites.edit(entry.id, { ViewChannel: false }, { type: entry.type, reason: 'Night channel: closed until its hours' });
  }
  states[channel.id] = { ...remembered, done: true };
  await save();
}

async function open(channel, state, states, save) {
  const everyoneId = channel.guild.roles.everyone.id;
  // Nothing remembered (first start while open hours): @everyone sees it.
  await channel.permissionOverwrites.edit(everyoneId, { ViewChannel: state?.everyone ?? null }, { type: OverwriteType.Role, reason: 'Night channel: open in its hours' });
  for (const entry of state?.allowed ?? []) {
    await channel.permissionOverwrites.edit(entry.id, { ViewChannel: true }, { type: entry.type, reason: 'Night channel: open in its hours' }).catch(() => {});
  }
  delete states[channel.id];
  await save();
}

async function applyNow(guild, now) {
  const { nightChannels: list } = await getAutomodConfig(guild.id, { fresh: true });
  const states = readStates(await store.get(guild.id));
  const save = () => store.set(guild.id, { channels: states });
  const changes = {};
  const step = async (channelId, run) => {
    try {
      await run();
    } catch (error) {
      logger.warn(`Night channel ${channelId} failed in guild ${guild.id}: ${error.message}`);
    }
  };

  // Taken off the list (or deleted on Discord) while closed: opened once and forgotten.
  for (const [channelId, state] of Object.entries(states)) {
    if (list.some((entry) => entry.channelId === channelId)) continue;
    const channel = guild.channels.cache.get(channelId);
    await step(channelId, async () => {
      if (!channel?.permissionOverwrites) {
        delete states[channelId];
        await save();
        return;
      }
      await open(channel, state, states, save);
      changes[channelId] = 'opened';
    });
  }

  for (const entry of list) {
    const channel = guild.channels.cache.get(entry.channelId);
    if (!channel?.permissionOverwrites) continue;
    const state = states[entry.channelId];
    const shouldBeOpen = nightChannelOpen(entry, now);
    await step(entry.channelId, async () => {
      if (shouldBeOpen && state?.closed) {
        await open(channel, state, states, save);
        changes[entry.channelId] = 'opened';
        logger.info(`Night channel #${channel.name} opened in guild ${guild.id}`);
      } else if (!shouldBeOpen && !(state?.closed && state.done !== false)) {
        await close(channel, states, save);
        changes[entry.channelId] = 'closed';
        logger.info(`Night channel #${channel.name} closed in guild ${guild.id}`);
      }
    });
  }
  return changes;
}

// One run per guild at a time: the minute job and a panel save must not both remember the
// permissions of a channel the other one is closing.
const running = new Map(); // guildId -> Promise

/**
 * Open or close the hour-limited channels of `guild` when the hour says so. Returns what changed:
 * `{ [channelId]: 'opened' | 'closed' }` (empty when nothing did).
 */
export function applyNightChannel(guild, now = Date.now()) {
  const next = (running.get(guild.id) ?? Promise.resolve()).catch(() => {}).then(() => applyNow(guild, now));
  running.set(guild.id, next);
  const forget = () => { if (running.get(guild.id) === next) running.delete(guild.id); };
  next.then(forget, forget);
  return next;
}

/** The minute job: every guild the bot is in. */
export async function applyNightChannels(client) {
  for (const guild of client.guilds.cache.values()) {
    await applyNightChannel(guild).catch((error) => logger.warn(`Night channel failed in guild ${guild.id}: ${error.message}`));
  }
}
