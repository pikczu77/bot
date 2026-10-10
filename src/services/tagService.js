// tagService.js — server-made text commands ("tags") and auto-responders,
// plus sticky messages that stay at the bottom of a channel.

import { createEmbed } from '../utils/embeds.js';
import { guildStore, userError } from '../utils/featureKit.js';
import { t } from '../i18n/index.js';

const MAX_TAGS = 100;
const MAX_RESPONDERS = 50;
const NAME_RE = /^[\p{L}\p{N}_-]{1,32}$/u;

const store = guildStore('tags', { tags: {}, responders: [] });
const stickyStore = guildStore('sticky', {}); // { [channelId]: { text, messageId } }

const cache = new Map(); // guildId -> { at, data }
const stickyCache = new Map(); // guildId -> { at, data }
const CACHE_MS = 30_000;

async function cached(map, guildId, load, fresh = false) {
  const entry = map.get(guildId);
  if (!fresh && entry && Date.now() - entry.at < CACHE_MS) return entry.data;
  const data = await load(guildId);
  map.set(guildId, { at: Date.now(), data });
  return data;
}

export const getTagData = (guildId, options = {}) => cached(cache, guildId, (id) => store.get(id), options.fresh);

export function normalizeTagName(name) {
  const value = String(name ?? '').trim().toLowerCase();
  if (!NAME_RE.test(value)) {
    throw userError(t('A tag name can use letters, numbers, `-` and `_` (up to 32 characters, no spaces).'));
  }
  return value;
}

export async function saveTag(guildId, name, text, authorId) {
  const key = normalizeTagName(name);
  const data = await store.update(guildId, (current) => {
    if (!current.tags[key] && Object.keys(current.tags).length >= MAX_TAGS) {
      throw userError(t`A server can have up to ${MAX_TAGS} tags.`);
    }
    current.tags[key] = { text, createdBy: current.tags[key]?.createdBy ?? authorId, uses: current.tags[key]?.uses ?? 0, updatedAt: Date.now() };
  });
  cache.set(guildId, { at: Date.now(), data });
  return key;
}

export async function deleteTag(guildId, name) {
  const key = String(name ?? '').trim().toLowerCase();
  let removed = false;
  const data = await store.update(guildId, (current) => {
    removed = key in current.tags;
    delete current.tags[key];
  });
  cache.set(guildId, { at: Date.now(), data });
  return removed;
}

export async function countTagUse(guildId, name) {
  const data = await store.update(guildId, (current) => {
    if (current.tags[name]) current.tags[name].uses = (current.tags[name].uses ?? 0) + 1;
  });
  cache.set(guildId, { at: Date.now(), data });
}

export async function addResponder(guildId, responder) {
  const data = await store.update(guildId, (current) => {
    if (current.responders.length >= MAX_RESPONDERS) {
      throw userError(t`A server can have up to ${MAX_RESPONDERS} auto-responders.`);
    }
    const trigger = responder.trigger.toLowerCase();
    current.responders = current.responders.filter((entry) => entry.trigger !== trigger);
    current.responders.push({ ...responder, trigger });
  });
  cache.set(guildId, { at: Date.now(), data });
}

export async function removeResponder(guildId, trigger) {
  const key = String(trigger ?? '').trim().toLowerCase();
  let removed = false;
  const data = await store.update(guildId, (current) => {
    const before = current.responders.length;
    current.responders = current.responders.filter((entry) => entry.trigger !== key);
    removed = current.responders.length !== before;
  });
  cache.set(guildId, { at: Date.now(), data });
  return removed;
}

/** Fill {user}, {server}, {channel}, {members} in tag and responder text. */
export function renderTagText(text, message) {
  return String(text)
    .replace(/\{user\}/g, message.author?.toString?.() ?? message.user?.toString?.() ?? '')
    .replace(/\{server\}/g, message.guild?.name ?? '')
    .replace(/\{channel\}/g, message.channel?.toString?.() ?? '')
    .replace(/\{members\}/g, String(message.guild?.memberCount ?? ''))
    .slice(0, 2000);
}

/** Which responder (if any) matches this text. Pure. */
export function matchResponder(responders, content) {
  const text = String(content ?? '').toLowerCase().trim();
  if (!text) return null;
  for (const responder of responders) {
    const trigger = responder.trigger;
    if (responder.mode === 'exact' && text === trigger) return responder;
    if (responder.mode === 'starts' && text.startsWith(trigger)) return responder;
    if (responder.mode === 'contains' && text.includes(trigger)) return responder;
    if (responder.mode === 'word' && new RegExp(`(?<![\\p{L}\\p{N}])${trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'u').test(text)) return responder;
  }
  return null;
}

const responderCooldown = new Map(); // `${channelId}:${trigger}` -> timestamp

/**
 * Answer `!tagname` and auto-responder triggers. Returns true when something was sent.
 */
export async function handleTagMessage(message, prefix) {
  const data = await getTagData(message.guild.id);
  const content = message.content ?? '';

  if (content.startsWith(prefix)) {
    const name = content.slice(prefix.length).trim().split(/\s+/)[0]?.toLowerCase();
    const tag = name ? data.tags[name] : null;
    if (tag && !message.client.commands?.has(name) && !message.client.groupedCommands?.has(name)) {
      await message.channel.send({ content: renderTagText(tag.text, message), allowedMentions: { parse: [], users: [message.author.id] } }).catch(() => {});
      countTagUse(message.guild.id, name).catch(() => {});
      return true;
    }
    return false;
  }

  const responder = matchResponder(data.responders, content);
  if (!responder) return false;

  // The same answer in the same channel at most once every 10 seconds.
  const key = `${message.channelId}:${responder.trigger}`;
  if (Date.now() - (responderCooldown.get(key) ?? 0) < 10_000) return false;
  responderCooldown.set(key, Date.now());

  await message.channel.send({ content: renderTagText(responder.response, message), allowedMentions: { parse: [], users: [message.author.id] } }).catch(() => {});
  return true;
}

// ---------------------------------------------------------------------------
// Sticky messages
// ---------------------------------------------------------------------------

export const getStickies = (guildId, options = {}) => cached(stickyCache, guildId, (id) => stickyStore.get(id), options.fresh);

function stickyPayload(text) {
  return {
    embeds: [createEmbed({ description: text, color: 'primary', footer: t('📌 Pinned message') })],
    allowedMentions: { parse: [] },
  };
}

export async function setSticky(channel, text) {
  const guildId = channel.guild.id;
  const previous = (await stickyStore.get(guildId))[channel.id];
  if (previous?.messageId) await channel.messages.delete(previous.messageId).catch(() => {});
  const sent = await channel.send(stickyPayload(text));
  const data = await stickyStore.update(guildId, (current) => { current[channel.id] = { text, messageId: sent.id }; });
  stickyCache.set(guildId, { at: Date.now(), data });
}

export async function removeSticky(channel) {
  const guildId = channel.guild.id;
  let previous = null;
  const data = await stickyStore.update(guildId, (current) => {
    previous = current[channel.id] ?? null;
    delete current[channel.id];
  });
  stickyCache.set(guildId, { at: Date.now(), data });
  if (previous?.messageId) await channel.messages.delete(previous.messageId).catch(() => {});
  return Boolean(previous);
}

const stickyTimers = new Map(); // channelId -> timeout

/** A message was sent in a channel: move its sticky back to the bottom (debounced). */
export async function bumpSticky(message) {
  const stickies = await getStickies(message.guild.id);
  const sticky = stickies[message.channelId];
  if (!sticky || message.id === sticky.messageId) return;
  if (stickyTimers.has(message.channelId)) return;

  const timer = setTimeout(async () => {
    stickyTimers.delete(message.channelId);
    try {
      const current = (await stickyStore.get(message.guild.id))[message.channelId];
      if (!current) return;
      if (current.messageId) await message.channel.messages.delete(current.messageId).catch(() => {});
      const sent = await message.channel.send(stickyPayload(current.text));
      const data = await stickyStore.update(message.guild.id, (all) => {
        if (all[message.channelId]) all[message.channelId].messageId = sent.id;
      });
      stickyCache.set(message.guild.id, { at: Date.now(), data });
    } catch {
      // Channel gone or permissions lost — the next message will try again.
    }
  }, 4000);
  timer.unref?.();
  stickyTimers.set(message.channelId, timer);
}
