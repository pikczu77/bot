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
//  - a member: store guild:{id}:klubis-memory = { members: { [id]: { talks, firstAt, lastAt, name, age, city, partner, loves, notes, likes, dislikes, plays } } }. What the
//    member wrote to it (services/klubisBrain.js, factsOf). Name, age and city are said only to that member; likes and games also to someone who
//    asks about them. "Zapomnij o mnie" and /wipedata delete it; the switch `memory` stops it. Owner: "brac wszystkie informacje", server 16+.
//
// A sentence is read by services/klubisBrain.js, real questions are answered by services/klubisFacts.js.

import { guildStore } from '../utils/featureKit.js';
import { logger } from '../utils/logger.js';
import {
  KLUBIS_ABOUT, KLUBIS_CALLED, KLUBIS_FOLLOW, KLUBIS_FOLLOW_KINDS, KLUBIS_FOLLOW_SKILLS, KLUBIS_SKILLS, KLUBIS_UNKNOWN, KLUBIS_WELCOME_BACK,
} from '../config/klubisReplies.js';
import { PRESET_SLURS } from '../config/automodPresets.js';
import { findSlur } from './automodService.js';
import { MENTION_RE, cleanText, factsOf, fold, learnedLine, likeOf, likesTouchy, onlyCalls, parseSentence, plural, recalledLine, relationshipOf, safeLike, touchyKind, touchyLine, understand, yearsOld } from './klubisBrain.js';
import { klubisFact, noteChannelMessage } from './klubisFacts.js';

export { fold, likeOf };

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
// A greeting after this many days without a talk mentions the break.
const WELCOME_BACK_DAYS = 3;

// Folded forms of the name: klubiś, klubisiu, klubisia, klubisiem, klubisie, klubisiowi, klubiku. Not "klubik" (the server is
// "Klubik Pikcza") and not "klubie" ("w klubie").
const NAME_RE = /\bklubi(s|siu|sia|siem|sie|siowi|ku)\b/;
const NAME_RE_G = new RegExp(NAME_RE.source, 'g');

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

function fill(line, message, talk = null, remembered = null) {
  const name = remembered?.name ?? message.member?.displayName ?? message.author?.globalName ?? message.author?.username ?? '';
  return line.replaceAll('{user}', () => name).replaceAll('{server}', () => message.guild?.name ?? '')
    .replaceAll('{asked}', () => talk?.asked ?? '').replaceAll('{said}', () => talk?.said ?? '');
}

const cut = (text, max) => (text.length > max ? `${text.slice(0, max).trimEnd()}...` : text);

/** The member's words, fit to be said back. Empty when they hold a slur (the server's rule) or a touchy word: Klubiś never repeats those. */
export function quoteOf(raw) {
  const text = cleanText(raw);
  return text.length < 2 || findSlur(text, PRESET_SLURS) || touchyKind(text) ? '' : cut(text, QUOTE_MAX);
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
  const generic = kind === 'recall' && !talk.asked ? KLUBIS_FOLLOW.recallAlone : KLUBIS_FOLLOW[kind];
  const lines = usable(another ? skill.replies : (Array.isArray(own) ? own : generic), talk);
  if (!lines?.length) return null;
  return pickFresh(lines, guildId, another ? skill.id : `${talk.skillId}:${kind}`, random);
}

/** What Klubiś knows about the member, in one line. */
function aboutLine(member) {
  const since = new Date(member.firstAt).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw', day: 'numeric', month: 'long' });
  const known = [
    member.name && `imię ${member.name}`, member.age && yearsOld(member.age), member.city,
    member.partner, member.loves?.length && `kochasz: ${member.loves.join(', ')}`,
    member.plays?.length && `grasz ${member.plays.join(', ')}`, member.dislikes?.length && `nie lubisz: ${member.dislikes.join(', ')}`,
    member.notes?.length && `zapisane: ${member.notes.join('; ')}`,
  ].filter(Boolean).join(', ');
  const likes = member.likes?.length ? KLUBIS_ABOUT.likes.replace('{likes}', () => member.likes.join(', ')) : KLUBIS_ABOUT.noLikes;
  const talks = member.talks ?? 1;
  const about = KLUBIS_ABOUT.known.replace('{since}', since).replace('{talks}', `${talks} ${plural(talks, 'rozmowa', 'rozmowy', 'rozmów')}`);
  return [about, known && KLUBIS_ABOUT.facts.replace('{facts}', () => known), likes].filter(Boolean).join(' ');
}

/** "Poderwij @Kuba" -> who it is for, and a silly line. "Teksty na podryw" -> a line to use. */
function flirtLine(skill, message, text, line) {
  if (!/^(a |no |to )?(poderwij|podrywaj|zarwij|zbajeruj|zagadaj do|rizzuj)\b/.test(text)) return `Spróbuj tak: „${line}”`;
  const botId = message.client?.user?.id;
  const other = [...(message.mentions?.users?.values?.() ?? [])].find((user) => user.id !== botId);
  if (other) return `Podrywam <@${other.id}>: ${line}`;
  if (touchyKind(text)) return null;
  const target = quoteOf(cleanText(message.content).replace(/^(a |no |to )?(poderwij|podrywaj|zarwij|zbajeruj|zagadaj do|rizzuj)\s*/iu, '').replace(/[?!.,]+$/, ''));
  return target && fold(target) !== 'mnie' ? `Podrywam ${target}: ${line}` : `{user}, ${line[0].toLocaleLowerCase('pl')}${line.slice(1)}`;
}

/** The line of a skill. The member's memory changes two of them: "co o mnie wiesz" and a greeting after a long break. */
function skillLine(skill, guildId, member, now, random, message, text) {
  if (skill.id === 'aboutMe' && member?.firstAt) return aboutLine(member);
  const days = member?.lastAt ? Math.floor((now - member.lastAt) / 86_400_000) : 0;
  if (skill.id === 'hello' && days >= WELCOME_BACK_DAYS) return pickFresh(KLUBIS_WELCOME_BACK, guildId, 'welcomeBack', random).replaceAll('{days}', String(days));
  const line = pickFresh(skill.replies, guildId, skill.id, random);
  return skill.id === 'flirt' ? flirtLine(skill, message, text, line) : line;
}

/**
 * What Klubiś says to this message, or null: { line, skillId, followUp, facts }. Pure apart from the breaks it reads and sets.
 * `talk` = the talk it continues, `member` = what it remembers about the member, `remembers` = it may learn, `fact` = a real answer found.
 */
export function klubisAnswer(message, settings, { now = Date.now(), random = Math.random, talk = null, member = null, remembers = false, fact = null } = {}) {
  const raw = String(message.content ?? '');
  const text = fold(raw.replace(MENTION_RE, ' ')).replace(NAME_RE_G, ' ').replace(/\s+/g, ' ').trim();
  const guildId = message.guild.id;

  if (settings.mentions && callsKlubis(message)) {
    const key = `${guildId}:${message.author.id}`;
    if (now - (memberLast.get(key) ?? 0) < MEMBER_GAP_MS) return null;
    memberLast.set(key, now);
    if (fact) return { line: fact, skillId: 'fact' };
    const pick = (lines, list) => pickFresh(lines, guildId, list, random);
    // Before anything that repeats or agrees. The helpline answer and a sad reply stay first.
    const touchy = touchyKind(text);
    const serious = touchy ? findSkill(text, raw) : null;
    if (touchy && !serious?.serious) return { line: touchyLine(touchy, pick, text), skillId: 'unknown' };
    const follow = talk && text ? followUp(text, talk, guildId, random) : null;
    if (follow) return { line: follow, skillId: talk.skillId, followUp: true };
    if (!text) return { line: pick(KLUBIS_CALLED, 'called'), skillId: 'called' };
    const recalled = recalledLine(text, member, pick);
    if (recalled) return { line: recalled, skillId: 'aboutMe' };

    const parsed = parseSentence(raw);
    if (likesTouchy(parsed)) return { line: touchyLine('touchy', pick), skillId: 'unknown' };
    const facts = remembers ? { ...factsOf(parsed), ...relationshipOf(raw) } : {};
    const learned = facts.likes && !member?.likes?.includes(facts.likes) ? facts.likes : null;
    const withLearned = (line) => (!learned ? line : `${line} ${line.includes(learned) || !safeLike(learned) ? KLUBIS_ABOUT.noted : KLUBIS_ABOUT.learned.replace('{like}', () => learned)}`);
    const introduced = learnedLine(facts, pick);
    if (introduced) return { line: introduced, skillId: 'understood', facts };

    // A greeting in front of a sentence changes nothing: "siema, lubię pizzę".
    const body = parsed.greeted ? fold(parsed.words.join(' ')) : text;
    const skill = findSkill(body, raw) ?? null;
    const asksFact = parsed.person !== 'you' && (parsed.question || parsed.asks || parsed.qSkill);
    if (skill && (!skill.broad || (skill.broad === 'topic' && asksFact))) {
      return { line: withLearned(skillLine(skill, guildId, member, now, random, message, text)), skillId: skill.id, facts };
    }
    // A reply nothing understood: part of the time say which talk it belongs to, so it is clear Klubiś knows.
    if (talk?.replied && parsed.person === 'other' && !parsed.asks && !parsed.qSkill && !skill && random() < 0.4) {
      const stay = usable(KLUBIS_FOLLOW.stay, talk);
      if (stay.length) return { line: pick(stay, 'stay'), skillId: talk.skillId, followUp: true };
    }
    // A question about a topic takes the topic's lines ("gdzie jest pikczu"), a sentence can have them after what it says back.
    const catchSkill = skill?.broad === 'catch' || (skill?.broad === 'talk' && parsed.qSkill) ? skill : null;
    const sense = understand(parsed, { pick, random, topic: skill?.broad === 'talk' ? skill : null, catchSkill });
    if (sense) return { line: withLearned(`${parsed.greeted ? 'Siema! ' : ''}${sense.line}`), skillId: sense.skillId, facts };
    if (skill) return { line: skillLine(skill, guildId, member, now, random, message, text), skillId: skill.id, facts };
    if (onlyCalls(parsed)) return { line: pick(KLUBIS_CALLED, 'called'), skillId: 'called' };
    return { line: pick(KLUBIS_UNKNOWN, 'unknown'), skillId: 'unknown' };
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

async function noteMember(guildId, userId, facts, now) {
  await writeMemory(guildId, (data) => {
    const member = data.members[userId] ?? { talks: 0, firstAt: now, likes: [] };
    member.talks += 1;
    member.lastAt = now;
    for (const key of ['name', 'age', 'city', 'partner']) if (facts?.[key]) member[key] = facts[key];
    for (const [key, field] of [['likes', 'likes'], ['dislikes', 'dislikes'], ['plays', 'plays'], ['loves', 'loves'], ['note', 'notes']]) {
      const list = member[field] ?? [];
      if (facts?.[key] && !list.includes(facts[key])) member[field] = [...list, facts[key]].slice(-MAX_LIKES);
    }
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
  const memory = remembers ? (await memoryStore.get(message.guild.id)).members : null;
  const member = memory?.[message.author.id] ?? null;
  noteChannelMessage(message);
  const text = called ? fold(String(message.content ?? '').replace(MENTION_RE, ' ')).replace(NAME_RE_G, ' ').replace(/\s+/g, ' ').trim() : '';
  const fact = text && !touchyKind(text) ? await klubisFact(message, text, { now: at, memoryOf: async (id) => memory?.[id] ?? null }).catch((error) => {
    logger.warn(`Klubis fact failed in guild ${message.guild.id}: ${error.message}`);
    return null;
  }) : null;
  const answer = klubisAnswer(message, settings, { now: at, random, talk, member, remembers, fact });
  if (!answer) return false;

  const content = fill(answer.line, message, talk, member).slice(0, 2000);
  const wait = delayMs ?? (process.env.NODE_ENV === 'test' ? 0 : Math.min(2500, 600 + content.length * 25));
  if (wait > 0) {
    await message.channel?.sendTyping?.().catch(() => {});
    await sleep(wait);
  }
  try {
    const sent = await message.reply({ content, allowedMentions: { parse: [], repliedUser: false } });
    rememberTalk(message, sent, answer, content, talk, at);
    if (called && answer.skillId === 'forget') await forgetKlubisMember(message.guild.id, message.author.id);
    else if (remembers) await noteMember(message.guild.id, message.author.id, answer.facts, at);
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
