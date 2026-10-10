// featureKit.js — small helpers shared by the feature modules (storage, durations,
// permission checks, HTTP).

import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { getFromDb, setInDb, deleteFromDb } from './database/wrapper.js';
import { TitanBotError, ErrorTypes } from './errorHandler.js';
import { InteractionHelper } from './interactionHelper.js';
import { isBotOwner } from '../config/bot.js';
import { t } from '../i18n/index.js';

/**
 * Per-guild JSON document stored under `guild:{guildId}:{name}`.
 * Reads always return a fresh merge of `defaults` and the stored value.
 */
export function guildStore(name, defaults = {}) {
  const keyOf = (guildId) => `guild:${guildId}:${name}`;
  const isPlainObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

  return {
    key: keyOf,
    async get(guildId) {
      const stored = await getFromDb(keyOf(guildId), null);
      if (Array.isArray(defaults)) return Array.isArray(stored) ? stored : [...defaults];
      return isPlainObject(stored) ? { ...structuredClone(defaults), ...stored } : structuredClone(defaults);
    },
    async set(guildId, value) {
      return setInDb(keyOf(guildId), value);
    },
    async update(guildId, mutate) {
      const current = await this.get(guildId);
      const next = (await mutate(current)) ?? current;
      await setInDb(keyOf(guildId), next);
      return next;
    },
    async clear(guildId) {
      return deleteFromDb(keyOf(guildId));
    },
  };
}

const DURATION_UNITS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

/** "10m", "2h30m", "1d" -> milliseconds. Returns null when the text is not a duration. */
export function parseDuration(text) {
  if (typeof text !== 'string') return null;
  const cleaned = text.trim().toLowerCase().replace(/\s+/g, '');
  if (!cleaned || !/^(\d+[smhdw])+$/.test(cleaned)) return null;
  let total = 0;
  for (const [, amount, unit] of cleaned.matchAll(/(\d+)([smhdw])/g)) {
    total += Number(amount) * DURATION_UNITS[unit];
  }
  return total > 0 ? total : null;
}

/** Parse a duration option or throw a user-facing validation error. */
export function requireDuration(text, { min = 1000, max = 28 * DURATION_UNITS.d } = {}) {
  const ms = parseDuration(text);
  if (ms === null) {
    throw userError(t('That is not a valid duration. Use something like `10m`, `2h` or `1d12h`.'));
  }
  if (ms < min || ms > max) {
    throw userError(t`The duration must be between ${humanDuration(min)} and ${humanDuration(max)}.`);
  }
  return ms;
}

/** 5400000 -> "1h 30m" */
export function humanDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '0s';
  const parts = [];
  let rest = Math.round(ms / 1000);
  for (const [unit, size] of [['d', 86400], ['h', 3600], ['m', 60], ['s', 1]]) {
    const amount = Math.floor(rest / size);
    if (amount > 0) {
      parts.push(`${amount}${unit}`);
      rest -= amount * size;
    }
    if (parts.length === 2) break;
  }
  return parts.join(' ') || '0s';
}

/** Discord relative timestamp, e.g. "in 5 minutes". */
export function relativeTime(dateOrMs) {
  const ms = dateOrMs instanceof Date ? dateOrMs.getTime() : Number(dateOrMs);
  return `<t:${Math.floor(ms / 1000)}:R>`;
}

export function fullTime(dateOrMs) {
  const ms = dateOrMs instanceof Date ? dateOrMs.getTime() : Number(dateOrMs);
  return `<t:${Math.floor(ms / 1000)}:f>`;
}

/** An expected, user-facing error (shown as a friendly embed, not logged as a failure). */
export function userError(message, type = ErrorTypes.USER_INPUT) {
  return new TitanBotError(message, type, message, { expected: true });
}

/** Throw unless the member has the permission (server owner and bot owners always pass). */
export function requirePermission(interaction, permission, message = null) {
  const member = interaction.member;
  if (isBotOwner(interaction.user?.id)) return;
  if (member?.guild?.ownerId === member?.id) return;
  if (member?.permissions?.has?.(PermissionFlagsBits.Administrator)) return;
  if (member?.permissions?.has?.(permission)) return;
  throw userError(message ?? t('You do not have permission to use this command.'), ErrorTypes.PERMISSION);
}

export function requireGuild(interaction) {
  if (!interaction.guild) {
    throw userError(t('This command can only be used in a server.'), ErrorTypes.VALIDATION);
  }
  return interaction.guild;
}

/** Throw unless the bot has the permissions (optionally in a specific channel). */
export function requireBotPermission(guild, permissions, channel = null) {
  const me = guild.members.me;
  const has = channel ? channel.permissionsFor(me)?.has(permissions) : me?.permissions.has(permissions);
  if (!has) {
    throw userError(
      channel
        ? t`I am missing permissions in ${channel}. Check my role and the channel settings.`
        : t('I am missing required permissions to perform this action.'),
      ErrorTypes.PERMISSION,
    );
  }
}

/** Reply (or edit the deferred reply) with one embed. */
export function respond(interaction, embed, { ephemeral = false, components = [], content = undefined } = {}) {
  return InteractionHelper.universalReply(interaction, {
    content,
    embeds: embed ? [embed] : [],
    components,
    ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}),
  });
}

export function truncate(text, max) {
  const value = String(text ?? '');
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** fetch() with a timeout and a browser-like user agent. Returns the Response. */
export async function httpGet(url, { timeoutMs = 10_000, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; KlubikPikczaBot/3.0; +https://pikczu.pl)',
        'Accept-Language': 'en-US,en;q=0.8',
        ...headers,
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function httpJson(url, options) {
  const response = await httpGet(url, options);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.json();
}

export async function httpText(url, options) {
  const response = await httpGet(url, options);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  return response.text();
}
