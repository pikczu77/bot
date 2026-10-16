// automodService.js — automatic moderation of messages and joins.
//
// Rules: slurs (never allowed), invite links, other links, banned words, message spam, mass
// mentions, excessive caps, repeated messages and emoji floods, plus anti-raid on joins.
// The night channel (visible only at night) lives in services/nightChannel.js; its settings are here.
// Detection is pure (checkMessage) so it can be tested without Discord.

import { PermissionFlagsBits } from 'discord.js';
import { createEmbed } from '../utils/embeds.js';
import { guildStore, truncate } from '../utils/featureKit.js';
import { logger } from '../utils/logger.js';
import { t } from '../i18n/index.js';
import { PRESET_SLURS } from '../config/automodPresets.js';

export const RULES = ['slurs', 'invites', 'links', 'words', 'spam', 'mentions', 'caps', 'duplicates', 'emojis'];
export const ACTIONS = ['delete', 'warn', 'timeout'];

const DEFAULT_CONFIG = {
  enabled: false,
  logChannelId: null,
  exemptRoles: [],
  exemptChannels: [],
  timeoutMinutes: 10,
  rules: {
    // Slurs (2026-10-15, owner): on by default, also during the words rule's free hours and on its
    // free channels. Digits and symbols count as letters (n1gg3r). Exempt roles/channels still apply.
    slurs: { enabled: true, action: 'warn', list: [...PRESET_SLURS] },
    invites: { enabled: false, action: 'delete' },
    links: { enabled: false, action: 'delete', allow: [] },
    // freeHours: words are allowed from freeFrom:00 until freeTo:00 (Polish time), e.g. 22 → 6.
    // freeChannels: channels (or categories) where the words are always allowed (a "vulgar chat").
    words: { enabled: false, action: 'delete', list: [], freeHours: false, freeFrom: 22, freeTo: 6, freeChannels: [] },
    spam: { enabled: false, action: 'timeout', limit: 6, seconds: 6 },
    mentions: { enabled: false, action: 'timeout', limit: 6 },
    caps: { enabled: false, action: 'delete', percent: 75, minLength: 12 },
    duplicates: { enabled: false, action: 'delete', limit: 4 },
    emojis: { enabled: false, action: 'delete', limit: 12 },
  },
  // Repeat offenders: this many violations inside the window earns a longer timeout.
  strikes: { limit: 3, windowMinutes: 30, timeoutMinutes: 60 },
  raid: { enabled: false, joins: 8, seconds: 10, action: 'alert', minAccountAgeDays: 0, lockMinutes: 10 },
  // A channel everyone sees only from `from`:00 to `to`:00 Polish time (services/nightChannel.js).
  nightChannel: { enabled: false, channelId: null, from: 22, to: 6 },
};

const store = guildStore('automod', DEFAULT_CONFIG);
const configCache = new Map(); // guildId -> { at, config }
const CONFIG_CACHE_MS = 30_000;

function withDefaults(config) {
  const merged = { ...structuredClone(DEFAULT_CONFIG), ...config };
  merged.rules = { ...structuredClone(DEFAULT_CONFIG.rules) };
  for (const rule of RULES) merged.rules[rule] = { ...DEFAULT_CONFIG.rules[rule], ...(config.rules?.[rule] ?? {}) };
  merged.strikes = { ...DEFAULT_CONFIG.strikes, ...(config.strikes ?? {}) };
  merged.raid = { ...DEFAULT_CONFIG.raid, ...(config.raid ?? {}) };
  merged.nightChannel = { ...DEFAULT_CONFIG.nightChannel, ...(config.nightChannel ?? {}) };
  return merged;
}

/** Automod settings, cached briefly because this runs for every message. */
export async function getAutomodConfig(guildId, { fresh = false } = {}) {
  const cached = configCache.get(guildId);
  if (!fresh && cached && Date.now() - cached.at < CONFIG_CACHE_MS) return cached.config;
  const config = withDefaults(await store.get(guildId));
  configCache.set(guildId, { at: Date.now(), config });
  return config;
}

export async function updateAutomodConfig(guildId, mutate) {
  const next = await store.update(guildId, (raw) => {
    const config = withDefaults(raw);
    mutate(config);
    return config;
  });
  configCache.set(guildId, { at: Date.now(), config: next });
  return next;
}

const INVITE_RE = /(?:discord\.gg|discord(?:app)?\.com\/invite|discord\.me|dsc\.gg|invite\.gg)\/[\w-]{2,}/i;
const URL_RE = /\bhttps?:\/\/([^\s/<>()]+)[^\s<>]*/gi;
const EMOJI_RE = /<a?:\w+:\d+>|\p{Extended_Pictographic}/gu;

function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l');
}

/** Does `text` contain a banned word? `*` in a word matches any letters. */
export function findBannedWord(text, words) {
  const haystack = normalize(text);
  for (const word of words) {
    const needle = normalize(word).trim();
    if (!needle) continue;
    const pattern = needle.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[\\p{L}\\p{N}]*');
    if (new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, 'u').test(haystack)) return word;
  }
  return null;
}

// Digits and symbols people use instead of letters, read as letters for the slurs rule.
const LOOKALIKES = { 0: 'o', 1: 'i', '!': 'i', '|': 'i', 3: 'e', 4: 'a', '@': 'a', 5: 's', $: 's', 7: 't' };

/** Does `text` contain a slur? Like findBannedWord, but n1gg3r counts as nigger. */
export function findSlur(text, words) {
  const plain = findBannedWord(text, words);
  if (plain) return plain;
  const read = normalize(text).replace(/[0-9!|@$]/g, (char) => LOOKALIKES[char] ?? char);
  return findBannedWord(read, words);
}

const TIME_ZONE = 'Europe/Warsaw';
let hourFormat = null;

/** Hour (0-23) in Polish time; the host's clock runs in another zone. */
export function localHour(now = Date.now()) {
  try {
    hourFormat ??= new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: 'numeric', hourCycle: 'h23' });
    return Number(hourFormat.format(new Date(now))) % 24;
  } catch {
    return new Date(now).getHours();
  }
}

/** Is `hour` inside from..to? The range may wrap past midnight (22 → 6). from === to means never. */
export function inHourRange(hour, from, to) {
  if (from === to) return false;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

/** Are banned words allowed right now (the words rule's free hours)? */
export function wordsAllowedNow(wordsRule, now = Date.now()) {
  return Boolean(wordsRule?.freeHours) && inHourRange(localHour(now), wordsRule.freeFrom, wordsRule.freeTo);
}

function hostAllowed(host, allow) {
  const value = host.toLowerCase().replace(/^www\./, '');
  return allow.some((domain) => {
    const allowed = domain.toLowerCase().replace(/^www\./, '');
    return value === allowed || value.endsWith(`.${allowed}`);
  });
}

/**
 * Check one message against the rules.
 * @param {object} config  automod config
 * @param {{ content: string, mentionCount: number, mentionsEveryone: boolean }} message
 * @param {{ timestamps: number[], recent: string[] }} history  the author's recent activity (mutated)
 * @returns {{ rule: string, detail: string } | null}
 */
export function checkMessage(config, message, history, now = Date.now()) {
  const { rules } = config;
  const content = String(message.content ?? '');

  if (rules.slurs?.enabled && rules.slurs.list?.length > 0) {
    const slur = findSlur(content, rules.slurs.list);
    if (slur) return { rule: 'slurs', detail: slur };
  }

  if (rules.invites.enabled && INVITE_RE.test(content)) {
    return { rule: 'invites', detail: content.match(INVITE_RE)[0] };
  }

  if (rules.links.enabled) {
    for (const match of content.matchAll(URL_RE)) {
      if (INVITE_RE.test(match[0])) continue; // handled by the invites rule
      if (!hostAllowed(match[1], rules.links.allow)) return { rule: 'links', detail: match[1] };
    }
  }

  const freeChannel = (rules.words.freeChannels ?? []).some((id) => id && (id === message.channelId || id === message.parentId));
  if (rules.words.enabled && rules.words.list.length > 0 && !freeChannel && !wordsAllowedNow(rules.words, now)) {
    const word = findBannedWord(content, rules.words.list);
    if (word) return { rule: 'words', detail: word };
  }

  if (rules.mentions.enabled && (message.mentionCount >= rules.mentions.limit)) {
    return { rule: 'mentions', detail: String(message.mentionCount) };
  }

  if (rules.caps.enabled) {
    const letters = content.replace(/[^\p{L}]/gu, '');
    if (letters.length >= rules.caps.minLength) {
      const upper = letters.replace(/[^\p{Lu}]/gu, '').length;
      const percent = Math.round((upper / letters.length) * 100);
      if (percent >= rules.caps.percent) return { rule: 'caps', detail: `${percent}%` };
    }
  }

  if (rules.emojis.enabled) {
    const count = (content.match(EMOJI_RE) ?? []).length;
    if (count >= rules.emojis.limit) return { rule: 'emojis', detail: String(count) };
  }

  if (history) {
    history.timestamps = history.timestamps.filter((time) => now - time < 60_000);
    history.timestamps.push(now);
    const text = normalize(content).trim();
    history.recent = history.recent.filter((entry) => now - entry.at < 30_000);
    if (text) history.recent.push({ at: now, text });

    if (rules.spam.enabled) {
      const inWindow = history.timestamps.filter((time) => now - time < rules.spam.seconds * 1000).length;
      if (inWindow >= rules.spam.limit) return { rule: 'spam', detail: `${inWindow}/${rules.spam.seconds}s` };
    }

    if (rules.duplicates.enabled && text.length >= 4) {
      const same = history.recent.filter((entry) => entry.text === text).length;
      if (same >= rules.duplicates.limit) return { rule: 'duplicates', detail: `×${same}` };
    }
  }

  return null;
}

const histories = new Map(); // `${guildId}:${userId}` -> { timestamps, recent }
const strikes = new Map(); // `${guildId}:${userId}` -> number[]
let lastSweep = Date.now();

function sweep(now) {
  if (now - lastSweep < 5 * 60_000) return;
  lastSweep = now;
  for (const [key, history] of histories) {
    if (!history.timestamps.some((time) => now - time < 60_000)) histories.delete(key);
  }
  for (const [key, times] of strikes) {
    if (!times.some((time) => now - time < 2 * 60 * 60_000)) strikes.delete(key);
  }
}

export function ruleLabel(rule) {
  return {
    slurs: t('Slurs'),
    invites: t('Invite links'),
    links: t('Links'),
    words: t('Banned words'),
    spam: t('Message spam'),
    mentions: t('Mass mentions'),
    caps: t('Too many capital letters'),
    duplicates: t('Repeated messages'),
    emojis: t('Emoji flood'),
  }[rule] ?? rule;
}

export function actionLabel(action) {
  return { delete: t('delete'), warn: t('delete + warning'), timeout: t('delete + timeout') }[action] ?? action;
}

function isExempt(message, config) {
  const member = message.member;
  if (!member) return true;
  if (member.permissions.has(PermissionFlagsBits.ManageMessages)) return true;
  if (config.exemptChannels.includes(message.channelId) || config.exemptChannels.includes(message.channel.parentId)) return true;
  return member.roles.cache.some((role) => config.exemptRoles.includes(role.id));
}

async function sendLog(guild, config, embed) {
  if (!config.logChannelId) return;
  const channel = guild.channels.cache.get(config.logChannelId);
  if (channel?.isTextBased?.()) {
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
  }
}

const freeHoursState = new Map(); // guildId -> were banned words allowed at the previous message

const hourLabel = (hour) => `${String(hour).padStart(2, '0')}:00`;

// One line in the log channel when the words rule's free hours start or end. Messages drive
// it (no timer), so the line comes with the first message after the change; nothing is
// posted for the first message after a restart, when the previous state is unknown.
async function noteFreeHours(guild, config, now) {
  const words = config.rules.words;
  if (!words.enabled || !words.freeHours) {
    freeHoursState.delete(guild.id);
    return;
  }
  const allowed = wordsAllowedNow(words, now);
  const before = freeHoursState.get(guild.id);
  freeHoursState.set(guild.id, allowed);
  if (before === undefined || before === allowed) return;

  logger.info(`Automod: banned words ${allowed ? 'allowed' : 'blocked again'} in guild ${guild.id}`);
  await sendLog(guild, config, createEmbed({
    title: allowed ? t('🌙 Automod — banned words allowed') : t('☀️ Automod — banned words blocked again'),
    description: allowed
      ? t`Until ${hourLabel(words.freeTo)} the bot does not delete messages with banned words.`
      : t`Messages with banned words are deleted again, until ${hourLabel(words.freeFrom)}.`,
    color: allowed ? 'info' : 'success',
    footer: false,
    timestamp: true,
  }));
}

/**
 * Run automod on a guild message. Returns true when the message was removed
 * (callers should stop processing it).
 */
export async function runAutomod(message) {
  const config = await getAutomodConfig(message.guild.id);
  if (!config.enabled) return false;

  const now = Date.now();
  await noteFreeHours(message.guild, config, now);
  if (isExempt(message, config)) return false;

  sweep(now);
  const key = `${message.guild.id}:${message.author.id}`;
  if (!histories.has(key)) histories.set(key, { timestamps: [], recent: [] });

  const violation = checkMessage(config, {
    content: message.content,
    channelId: message.channelId,
    parentId: message.channel?.parentId ?? null,
    mentionCount: message.mentions.users.size + message.mentions.roles.size + (message.mentions.everyone ? config.rules.mentions.limit : 0),
  }, histories.get(key), now);
  if (!violation) return false;

  const rule = config.rules[violation.rule];
  await message.delete().catch(() => {});

  const recentStrikes = (strikes.get(key) ?? []).filter((time) => now - time < config.strikes.windowMinutes * 60_000);
  recentStrikes.push(now);
  strikes.set(key, recentStrikes);
  const repeatOffender = recentStrikes.length >= config.strikes.limit;

  let timeoutMinutes = 0;
  if (repeatOffender) timeoutMinutes = config.strikes.timeoutMinutes;
  else if (rule.action === 'timeout') timeoutMinutes = config.timeoutMinutes;

  let timedOut = false;
  if (timeoutMinutes > 0 && message.member.moderatable) {
    timedOut = await message.member
      .timeout(timeoutMinutes * 60_000, `Automod: ${violation.rule}`)
      .then(() => true)
      .catch(() => false);
    if (repeatOffender) strikes.delete(key);
  }

  const label = ruleLabel(violation.rule);

  if (rule.action === 'warn') {
    try {
      const module = await import('./moderation/warningService.js');
      const Warnings = module.WarningService ?? module.default;
      await Warnings.addWarning({
        guildId: message.guild.id,
        userId: message.author.id,
        moderatorId: message.client.user.id,
        reason: t`Automod: ${label}`,
      });
    } catch (error) {
      logger.debug(`Automod could not record a warning: ${error.message}`);
    }
  }

  const notice = await message.channel.send({
    embeds: [createEmbed({
      description: [
        t`🛡️ ${message.author}, your message was removed: **${label}**.`,
        violation.rule === 'words' && rule.freeHours && rule.freeFrom !== rule.freeTo
          ? t`Swearing is allowed from ${hourLabel(rule.freeFrom)} to ${hourLabel(rule.freeTo)}.`
          : null,
        violation.rule === 'slurs' ? t('These words are never allowed - not at night and not on any channel.') : null,
        timedOut ? t`You are timed out for ${timeoutMinutes} {1|minute|minutes}.` : null,
      ].filter(Boolean).join('\n'),
      color: 'warning',
      footer: false,
    })],
    allowedMentions: { users: [message.author.id] },
  }).catch(() => null);
  if (notice) setTimeout(() => notice.delete().catch(() => {}), 8000).unref?.();

  await sendLog(message.guild, config, createEmbed({
    author: { name: message.author.tag, iconURL: message.author.displayAvatarURL() },
    title: t`🛡️ Automod — ${label}`,
    description: [
      t`**Member:** ${message.author} (\`${message.author.id}\`)`,
      t`**Channel:** ${message.channel}`,
      t`**Matched:** \`${truncate(violation.detail, 100)}\``,
      t`**Action:** ${timedOut ? t`timeout ${timeoutMinutes} min` : t('message deleted')}`,
      message.content ? `\n>>> ${truncate(message.content, 900)}` : null,
    ].filter(Boolean).join('\n'),
    color: timedOut ? 'error' : 'warning',
    footer: false,
    timestamp: true,
  }));

  logger.info(`Automod removed a message (${violation.rule}: ${truncate(violation.detail, 60)}) from ${message.author.id} in #${message.channel?.name ?? message.channelId}, guild ${message.guild.id}${timedOut ? `, timeout ${timeoutMinutes} min` : ''}`);
  return true;
}

// ---------------------------------------------------------------------------
// Anti-raid
// ---------------------------------------------------------------------------

const joinTimes = new Map(); // guildId -> number[]
const raidUntil = new Map(); // guildId -> timestamp

export function isRaidActive(guildId, now = Date.now()) {
  return (raidUntil.get(guildId) ?? 0) > now;
}

/**
 * Called for every join. Returns { kicked, reason } when the member was removed.
 */
export async function handleJoinForRaid(member) {
  const { guild } = member;
  const config = await getAutomodConfig(guild.id);
  const raid = config.raid;
  if (!config.enabled || member.user.bot) return { kicked: false };

  const now = Date.now();
  const ageDays = (now - member.user.createdTimestamp) / 86_400_000;

  // Account age gate works on its own, raid or not.
  if (raid.minAccountAgeDays > 0 && ageDays < raid.minAccountAgeDays && member.kickable) {
    await member.send({
      embeds: [createEmbed({
        description: t`Your account is too new to join **${guild.name}**. Accounts must be at least ${raid.minAccountAgeDays} {1|day|days} old. Try again later.`,
        color: 'warning',
        footer: false,
      })],
    }).catch(() => {});
    await member.kick('Automod: account too new').catch(() => {});
    await sendLog(guild, config, createEmbed({
      title: t('🛡️ Automod — new account'),
      description: t`${member.user} (\`${member.id}\`) was kicked: account created <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>.`,
      color: 'warning',
      footer: false,
      timestamp: true,
    }));
    return { kicked: true, reason: 'account_age' };
  }

  if (!raid.enabled) return { kicked: false };

  const times = (joinTimes.get(guild.id) ?? []).filter((time) => now - time < raid.seconds * 1000);
  times.push(now);
  joinTimes.set(guild.id, times);

  if (!isRaidActive(guild.id, now) && times.length >= raid.joins) {
    raidUntil.set(guild.id, now + raid.lockMinutes * 60_000);
    await sendLog(guild, config, createEmbed({
      title: t('🚨 Possible raid'),
      description: [
        t`**${times.length}** members joined within ${raid.seconds} seconds.`,
        raid.action === 'kick'
          ? t`New members will be kicked for the next ${raid.lockMinutes} minutes.`
          : t('Nobody is kicked automatically. Turn on kicking in the web panel.'),
      ].join('\n'),
      color: 'error',
      footer: false,
      timestamp: true,
    }));
    logger.warn(`Automod raid detection triggered in guild ${guild.id} (${times.length} joins)`);
  }

  if (isRaidActive(guild.id, now) && raid.action === 'kick' && member.kickable) {
    await member.kick('Automod: raid protection').catch(() => {});
    return { kicked: true, reason: 'raid' };
  }

  return { kicked: false };
}
