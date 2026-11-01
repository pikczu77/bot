// klubis.js — Klubiś (the bot) answers messages (2026-11-01, owner: "niech klubis nauczy sie pisac moze, daj mu odpowiedzi
// na jakies wiadomosci").
//
// Two kinds of answers, both behind the panel module "Klubiś" (one switch, one channel list):
//  - answers the server teaches it: the auto-responders of tagService (`responders`), edited in the panel. A trigger can have
//    several answers, one is picked at random. Checked first, by handleTagMessage.
//  - built-in skills (config/klubisReplies.js): always when a message calls Klubiś (mention, a reply to the bot, its name),
//    and the `alone` skills (hello, good night ...) also without a call, with the server's chance and a break per channel.
//
// Store guild:{id}:klubis = { enabled, mentions, phrases, chance, cooldownMinutes, channels }. Breaks live in memory.

import { guildStore } from '../utils/featureKit.js';
import { logger } from '../utils/logger.js';
import { KLUBIS_CALLED, KLUBIS_SKILLS, KLUBIS_UNKNOWN } from '../config/klubisReplies.js';

export const KLUBIS_DEFAULTS = { enabled: true, mentions: true, phrases: true, chance: 30, cooldownMinutes: 3, channels: [] };
export const MAX_CHANNELS = 25;
// A member who calls Klubiś gets at most one answer per this many ms.
export const MEMBER_GAP_MS = 5_000;
// A skill that answers without a call only looks at short messages: a word in a long sentence is not a greeting.
const ALONE_MAX_WORDS = 8;
const CACHE_MS = 30_000;

// Folded forms of the name: klubiś, klubisiu, klubisia, klubisiem, klubisie, klubisiowi, klubiku. Not "klubik" (the server is
// "Klubik Pikcza") and not "klubie" ("w klubie").
const NAME_RE = /\bklubi(s|siu|sia|siem|sie|siowi|ku)\b/;
const NAME_RE_G = new RegExp(NAME_RE.source, 'g');
const MENTION_RE = /<@[!&]?\d{15,22}>/g;

const store = guildStore('klubis', KLUBIS_DEFAULTS);
const cache = new Map(); // guildId -> { at, data }
const memberLast = new Map(); // `${guildId}:${userId}` -> time
const channelLast = new Map(); // `${guildId}:${channelId}:${skillId}` -> time

export async function getKlubisSettings(guildId) {
  const entry = cache.get(guildId);
  if (entry && Date.now() - entry.at < CACHE_MS) return entry.data;
  const data = await store.get(guildId);
  cache.set(guildId, { at: Date.now(), data });
  return data;
}

export async function saveKlubisSettings(guildId, updates) {
  const data = await store.update(guildId, (current) => { Object.assign(current, updates); });
  cache.set(guildId, { at: Date.now(), data });
  return data;
}

/** Lower case, no Polish letters, punctuation as spaces, stretched letters cut ("seriooo" = "serio"): what the skills match. */
export const fold = (text) => String(text ?? '').toLocaleLowerCase('pl').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, ' ').replace(/([a-z])\1{2,}/g, '$1').trim();

/** The message calls Klubiś: a mention (also of its own role), a reply to its message or its name. */
export function callsKlubis(message) {
  const botId = message.client?.user?.id;
  if (botId && (message.mentions?.users?.has?.(botId) || message.mentions?.repliedUser?.id === botId)) return true;
  if (botId && message.mentions?.roles?.some?.((role) => role.tags?.botId === botId)) return true;
  return NAME_RE.test(fold(message.content));
}

/** The skill for this text (already folded, name taken out), or null. `aloneOnly`: only skills that work without a call. */
export function findSkill(text, raw = '', { aloneOnly = false } = {}) {
  for (const skill of KLUBIS_SKILLS) {
    if (aloneOnly && !skill.alone) continue;
    if (skill.match.test(text) || (skill.question && /\?\s*$/.test(raw))) return skill;
  }
  return null;
}

/** One of the lines, at random. */
export const pickLine = (lines, random = Math.random) => lines[Math.floor(random() * lines.length) % lines.length];

/** In the channel list (or its thread's parent), or the list is empty. Also used for the taught answers. */
export const klubisChannelAllowed = (settings, channel) => !settings.channels?.length
  || settings.channels.includes(channel?.id) || (Boolean(channel?.parentId) && settings.channels.includes(channel.parentId));

function fill(line, message) {
  const name = message.member?.displayName ?? message.author?.globalName ?? message.author?.username ?? '';
  return line.replaceAll('{user}', name).replaceAll('{server}', message.guild?.name ?? '');
}

/** What Klubiś says to this message, or null. Pure apart from the breaks it reads and sets. */
export function klubisAnswer(message, settings, { now = Date.now(), random = Math.random } = {}) {
  const raw = String(message.content ?? '');
  const text = fold(raw.replace(MENTION_RE, ' ')).replace(NAME_RE_G, ' ').replace(/\s+/g, ' ').trim();
  const guildId = message.guild.id;

  if (settings.mentions && callsKlubis(message)) {
    const key = `${guildId}:${message.author.id}`;
    if (now - (memberLast.get(key) ?? 0) < MEMBER_GAP_MS) return null;
    memberLast.set(key, now);
    const skill = findSkill(text, raw);
    return pickLine(skill ? skill.replies : text ? KLUBIS_UNKNOWN : KLUBIS_CALLED, random);
  }

  if (!settings.phrases || !text || text.split(' ').length > ALONE_MAX_WORDS) return null;
  const skill = findSkill(text, raw, { aloneOnly: true });
  if (!skill) return null;
  // The break counts per skill: a "siema" a minute ago does not hold back the answer to "co robicie".
  const key = `${guildId}:${message.channelId}:${skill.id}`;
  if (now - (channelLast.get(key) ?? 0) < (Number(settings.cooldownMinutes) || 0) * 60_000) return null;
  if (!skill.always && random() * 100 >= (Number(settings.chance) || 0)) return null;
  channelLast.set(key, now);
  return pickLine(skill.replies, random);
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * featureMessages, after the taught answers: answer when it fits. Returns true when Klubiś wrote.
 * `delayMs`: how long it "types" (default by the length of the answer, 0 in tests).
 */
export async function handleKlubisMessage(message, { prefix = '!', now, random, delayMs } = {}) {
  if (!message.guild || message.author?.bot) return false;
  if (prefix && String(message.content ?? '').startsWith(prefix)) return false;
  const settings = await getKlubisSettings(message.guild.id);
  if (!settings.enabled || !klubisChannelAllowed(settings, message.channel)) return false;
  const line = klubisAnswer(message, settings, { now, random });
  if (!line) return false;

  const content = fill(line, message).slice(0, 2000);
  const wait = delayMs ?? (process.env.NODE_ENV === 'test' ? 0 : Math.min(2500, 600 + content.length * 25));
  if (wait > 0) {
    await message.channel?.sendTyping?.().catch(() => {});
    await sleep(wait);
  }
  try {
    await message.reply({ content, allowedMentions: { parse: [], repliedUser: false } });
    return true;
  } catch (error) {
    logger.warn(`Klubis answer not sent in guild ${message.guild.id}: ${error.message}`);
    return false;
  }
}

/** For the panel: what Klubiś can do by itself, with an example and one answer. */
export const klubisSkills = () => KLUBIS_SKILLS.map((skill) => ({
  id: skill.id, label: skill.label, example: skill.example, answer: skill.replies[0], alone: Boolean(skill.alone), always: Boolean(skill.always),
}));
