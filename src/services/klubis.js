// klubis.js — Klubiś (the bot) answers messages (2026-11-01, owner: "niech klubis nauczy sie pisac moze, daj mu odpowiedzi
// na jakies wiadomosci").
//
// Two kinds of answers, both behind the panel module "Klubiś" (one switch, one channel list):
//  - answers the server teaches it: the auto-responders of tagService (`responders`), edited in the panel. A trigger can have
//    several answers, one is picked at random. Checked first, by handleTagMessage.
//  - built-in skills (config/klubisReplies.js): always when a message calls Klubiś (mention, a reply to the bot, its name),
//    and the `alone` skills (hello, good night ...) also without a call, with the server's chance and a break per channel.
//
// Store guild:{id}:klubis = { enabled, mentions, phrases, memory, chance, cooldownMinutes, channels }. Breaks live in memory.
//
// What it remembers (owner: "brakuje mi takiego czegos ze on wie na co odpowiada"):
//  - a talk: what it said and what that answered. In memory only, a restart forgets. A reply to its message finds the talk by
//    message id, also when someone else replies; a call by name continues this member's last talk for CONTEXT_MS.
//  - a member: store guild:{id}:klubis-memory = { members: { [id]: { talks, firstAt, lastAt, likes } } }. Only what the member wrote
//    to it ("lubię ..."), said back only to that member. "Zapomnij o mnie" and /wipedata delete it; the switch `memory` stops it.

import { guildStore } from '../utils/featureKit.js';
import { logger } from '../utils/logger.js';
import {
  KLUBIS_ABOUT, KLUBIS_CALLED, KLUBIS_FOLLOW, KLUBIS_FOLLOW_KINDS, KLUBIS_FOLLOW_SKILLS, KLUBIS_SKILLS, KLUBIS_UNKNOWN, KLUBIS_WELCOME_BACK,
} from '../config/klubisReplies.js';
import { PRESET_ALLOWED_WORDS, PRESET_SLURS, PRESET_WORDS } from '../config/automodPresets.js';
import { findBannedWord, findSlur } from './automodService.js';

export const KLUBIS_DEFAULTS = { enabled: true, mentions: true, phrases: true, memory: true, chance: 30, cooldownMinutes: 3, channels: [] };
export const MAX_CHANNELS = 25;
// A member who calls Klubiś gets at most one answer per this many ms.
export const MEMBER_GAP_MS = 5_000;
// A skill that answers without a call only looks at short messages: a word in a long sentence is not a greeting.
const ALONE_MAX_WORDS = 8;
const CACHE_MS = 30_000;
// A call by name without a reply continues the member's last talk for this long.
const CONTEXT_MS = 10 * 60_000;
const MAX_TALKS = 3000;
// The last lines of a skill that are not said again.
const RECENT_LINES = 6;
const QUOTE_MAX = 60;
const SAID_MAX = 80;
const MAX_LIKES = 8;
const LIKE_MAX = 40;
const LIKE_WORDS_MAX = 5;
// A greeting after this many days without a talk mentions the break.
const WELCOME_BACK_DAYS = 3;

// Folded forms of the name: klubiś, klubisiu, klubisia, klubisiem, klubisie, klubisiowi, klubiku. Not "klubik" (the server is
// "Klubik Pikcza") and not "klubie" ("w klubie").
const NAME_RE = /\bklubi(s|siu|sia|siem|sie|siowi|ku)\b/;
const NAME_RE_G = new RegExp(NAME_RE.source, 'g');
const MENTION_RE = /<@[!&]?\d{15,22}>/g;

const store = guildStore('klubis', KLUBIS_DEFAULTS);
const cache = new Map(); // guildId -> { at, data }
const memberLast = new Map(); // `${guildId}:${userId}` -> time
const channelLast = new Map(); // `${guildId}:${channelId}:${skillId}` -> time
const sentTalks = new Map(); // id of Klubiś's message -> talk
const lastTalks = new Map(); // `${guildId}:${channelId}:${userId}` -> talk
const recentLines = new Map(); // `${guildId}:${skill or list}` -> lines said lately
const memoryStore = guildStore('klubis-memory', { members: {} });
const memoryWrites = new Map(); // guildId -> the last write, so two members at once do not overwrite each other

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

/** One of the lines, but not one this list said lately. */
function pickFresh(lines, guildId, list, random) {
  const key = `${guildId}:${list}`;
  const recent = recentLines.get(key) ?? [];
  const fresh = lines.filter((line) => !recent.includes(line));
  const line = pickLine(fresh.length ? fresh : lines, random);
  recent.push(line);
  while (recent.length > Math.min(RECENT_LINES, lines.length - 1)) recent.shift();
  recentLines.set(key, recent);
  return line;
}

/** In the channel list (or its thread's parent), or the list is empty. Also used for the taught answers. */
export const klubisChannelAllowed = (settings, channel) => !settings.channels?.length
  || settings.channels.includes(channel?.id) || (Boolean(channel?.parentId) && settings.channels.includes(channel.parentId));

function fill(line, message, talk = null) {
  const name = message.member?.displayName ?? message.author?.globalName ?? message.author?.username ?? '';
  return line.replaceAll('{user}', () => name).replaceAll('{server}', () => message.guild?.name ?? '')
    .replaceAll('{asked}', () => talk?.asked ?? '').replaceAll('{said}', () => talk?.said ?? '');
}

const cut = (text, max) => (text.length > max ? `${text.slice(0, max).trimEnd()}...` : text);

/**
 * The member's words, fit to be said back: no mentions, links, Klubiś's name or Discord formatting. Empty when they hold a word from
 * the ready lists, because Klubiś must never repeat one, also on a server or channel where automod lets it through.
 */
export function quoteOf(raw) {
  const text = String(raw ?? '').replace(MENTION_RE, ' ').replace(/https?:\S+/gi, ' ').replace(/klubi[sś]\p{L}*/giu, ' ')
    .replace(/[`*_~|>#@<{}\\]/g, '').replace(/\s+/g, ' ').replace(/^[\s,.:;!?-]+/, '').trim();
  if (text.length < 2 || findBannedWord(text, PRESET_WORDS, PRESET_ALLOWED_WORDS) || findSlur(text, PRESET_SLURS)) return '';
  return cut(text, QUOTE_MAX);
}

/** "Lubię grać w minecraft, a ty?" -> "grać w minecraft". Not people ("lubię cię") and no numbers, so nothing private stays by accident. */
export function likeOf(raw) {
  const match = /^(?:a )?(?:ja )?(?:tez |też )?(?:lubie|lubię|uwielbiam)\s+(.+?)(?:[,\s]+a ty)?[\s?!.]*$/iu.exec(quoteOf(raw));
  if (!match) return null;
  const like = match[1].trim();
  if (like.length > LIKE_MAX || like.split(' ').length > LIKE_WORDS_MAX || /\d/.test(like)) return null;
  return /^(cie|ciebie|cb|to|tego|tak|go|ja|jego|ich|was|nas|mnie|siebie)\b/.test(fold(like)) ? null : like;
}

function keepTalk(map, key, talk) {
  map.delete(key);
  map.set(key, talk);
  if (map.size > MAX_TALKS) map.delete(map.keys().next().value);
}

const talkKey = (message) => `${message.guild.id}:${message.channelId}:${message.author.id}`;

/** The talk this message continues: the one it replies to, else the member's last one here, if recent. */
function talkFor(message, now) {
  const replied = sentTalks.get(message.reference?.messageId);
  if (replied) return { ...replied, replied: true };
  const last = lastTalks.get(talkKey(message));
  return last && now - last.at <= CONTEXT_MS ? last : null;
}

function rememberTalk(message, sent, answer, said, talk, now) {
  const next = {
    skillId: answer.skillId, said: cut(said, SAID_MAX), asked: answer.followUp ? talk?.asked ?? '' : quoteOf(message.content), at: now,
  };
  if (sent?.id) keepTalk(sentTalks, sent.id, next);
  keepTalk(lastTalks, talkKey(message), next);
}

/** Lines that can be said in this talk: a line that quotes the member needs something to quote. */
const usable = (lines, talk) => lines?.filter((line) => talk.asked || !line.includes('{asked}'));

/** The answer to a short reply, knowing the talk. Null when this is not one: the normal skills decide. */
function followUp(text, talk, guildId, random) {
  const skill = KLUBIS_SKILLS.find((item) => item.id === talk.skillId);
  if (skill?.serious) return talk.replied ? pickFresh(skill.replies, guildId, skill.id, random) : null;
  const kind = KLUBIS_FOLLOW_KINDS.find((item) => item.match.test(text))?.id;
  if (!kind) return null;
  const own = KLUBIS_FOLLOW_SKILLS[talk.skillId]?.[kind];
  const another = (own === 'more' || (!own && kind === 'more')) && skill?.replies.length > 1;
  const lines = usable(another ? skill.replies : (Array.isArray(own) ? own : KLUBIS_FOLLOW[kind]), talk);
  if (!lines?.length) return null;
  return pickFresh(lines, guildId, another ? skill.id : `${talk.skillId}:${kind}`, random);
}

/** The line of a skill. The member's memory changes two of them: "co o mnie wiesz" and a greeting after a long break. */
function skillLine(skill, guildId, member, now, random) {
  if (skill.id === 'aboutMe' && member?.firstAt) {
    const since = new Date(member.firstAt).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw', day: 'numeric', month: 'long' });
    const likes = member.likes?.length ? KLUBIS_ABOUT.likes.replace('{likes}', () => member.likes.join(', ')) : KLUBIS_ABOUT.noLikes;
    return `${KLUBIS_ABOUT.known.replace('{since}', since).replace('{talks}', String(member.talks ?? 1))} ${likes}`;
  }
  const days = member?.lastAt ? Math.floor((now - member.lastAt) / 86_400_000) : 0;
  if (skill.id === 'hello' && days >= WELCOME_BACK_DAYS) return pickFresh(KLUBIS_WELCOME_BACK, guildId, 'welcomeBack', random).replaceAll('{days}', String(days));
  return pickFresh(skill.replies, guildId, skill.id, random);
}

/**
 * What Klubiś says to this message, or null: { line, skillId, followUp, learned }. Pure apart from the breaks it reads and sets.
 * `talk` = the talk it continues, `member` = what it remembers about the member, `like` = what this message says they like.
 */
export function klubisAnswer(message, settings, { now = Date.now(), random = Math.random, talk = null, member = null, like = null } = {}) {
  const raw = String(message.content ?? '');
  const text = fold(raw.replace(MENTION_RE, ' ')).replace(NAME_RE_G, ' ').replace(/\s+/g, ' ').trim();
  const guildId = message.guild.id;

  if (settings.mentions && callsKlubis(message)) {
    const key = `${guildId}:${message.author.id}`;
    if (now - (memberLast.get(key) ?? 0) < MEMBER_GAP_MS) return null;
    memberLast.set(key, now);
    const follow = talk && text ? followUp(text, talk, guildId, random) : null;
    if (follow) return { line: follow, skillId: talk.skillId, followUp: true };
    const skill = findSkill(text, raw);
    if (skill) {
      const learned = like && skill.id !== 'forget' && !member?.likes?.includes(like) ? like : null;
      const line = skillLine(skill, guildId, member, now, random);
      return { line: learned ? `${line} ${KLUBIS_ABOUT.learned.replace('{like}', () => learned)}` : line, skillId: skill.id, learned };
    }
    if (!text) return { line: pickFresh(KLUBIS_CALLED, guildId, 'called', random), skillId: 'called' };
    // A reply nothing understood: half of the time say which talk it belongs to, so it is clear Klubiś knows.
    const stay = talk?.replied && random() < 0.5 ? usable(KLUBIS_FOLLOW.stay, talk) : null;
    if (stay?.length) return { line: pickFresh(stay, guildId, 'stay', random), skillId: talk.skillId, followUp: true };
    return { line: pickFresh(KLUBIS_UNKNOWN, guildId, 'unknown', random), skillId: 'unknown' };
  }

  if (!settings.phrases || !text || text.split(' ').length > ALONE_MAX_WORDS) return null;
  const skill = findSkill(text, raw, { aloneOnly: true });
  if (!skill) return null;
  // The break counts per skill: a "siema" a minute ago does not hold back the answer to "co robicie".
  const key = `${guildId}:${message.channelId}:${skill.id}`;
  if (now - (channelLast.get(key) ?? 0) < (Number(settings.cooldownMinutes) || 0) * 60_000) return null;
  if (!skill.always && random() * 100 >= (Number(settings.chance) || 0)) return null;
  channelLast.set(key, now);
  return { line: pickFresh(skill.replies, guildId, skill.id, random), skillId: skill.id };
}

/** One write at a time per server: a store update reads, changes and saves, and two at once would lose one. */
function writeMemory(guildId, mutate) {
  const next = (memoryWrites.get(guildId) ?? Promise.resolve()).then(() => memoryStore.update(guildId, mutate));
  const settled = next.catch(() => {});
  memoryWrites.set(guildId, settled);
  settled.then(() => { if (memoryWrites.get(guildId) === settled) memoryWrites.delete(guildId); });
  return next;
}

async function noteMember(guildId, userId, like, now) {
  await writeMemory(guildId, (data) => {
    const member = data.members[userId] ?? { talks: 0, firstAt: now, likes: [] };
    member.talks += 1;
    member.lastAt = now;
    if (like && !member.likes.includes(like)) member.likes = [...member.likes, like].slice(-MAX_LIKES);
    data.members[userId] = member;
  });
}

/** "Klubiś, zapomnij o mnie" and /wipedata. */
export async function forgetKlubisMember(guildId, userId) {
  for (const key of lastTalks.keys()) if (key.startsWith(`${guildId}:`) && key.endsWith(`:${userId}`)) lastTalks.delete(key);
  await writeMemory(guildId, (data) => { delete data.members[userId]; });
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

  const at = now ?? Date.now();
  const called = Boolean(settings.mentions && callsKlubis(message));
  const remembers = called && settings.memory !== false;
  const talk = called ? talkFor(message, at) : null;
  const member = remembers ? (await memoryStore.get(message.guild.id)).members[message.author.id] ?? null : null;
  const answer = klubisAnswer(message, settings, { now: at, random, talk, member, like: remembers ? likeOf(message.content) : null });
  if (!answer) return false;

  const content = fill(answer.line, message, talk).slice(0, 2000);
  const wait = delayMs ?? (process.env.NODE_ENV === 'test' ? 0 : Math.min(2500, 600 + content.length * 25));
  if (wait > 0) {
    await message.channel?.sendTyping?.().catch(() => {});
    await sleep(wait);
  }
  try {
    const sent = await message.reply({ content, allowedMentions: { parse: [], repliedUser: false } });
    rememberTalk(message, sent, answer, content, talk, at);
    if (called && answer.skillId === 'forget') await forgetKlubisMember(message.guild.id, message.author.id);
    else if (remembers) await noteMember(message.guild.id, message.author.id, answer.learned, at);
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
