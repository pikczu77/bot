// languageService.js — per-server language (stored in the guild config as `language`).

import { getGuildConfig, updateGuildConfig } from './config/guildConfig.js';
import {
  DEFAULT_LOCALE,
  cacheGuildLocale,
  getCachedGuildLocale,
  normalizeLocale,
  runWithLocale,
  localeFromDiscord,
} from '../i18n/index.js';
import { logger } from '../utils/logger.js';

const pendingLoads = new Map();

/** Language of a guild, loading it from the database the first time it is needed. */
export async function getGuildLocale(client, guildId) {
  if (!guildId) return DEFAULT_LOCALE;

  const cached = getCachedGuildLocale(guildId);
  if (cached) return cached;

  const id = String(guildId);
  if (!pendingLoads.has(id)) {
    pendingLoads.set(id, (async () => {
      try {
        const config = await getGuildConfig(client, id);
        const locale = normalizeLocale(config?.language) ?? DEFAULT_LOCALE;
        cacheGuildLocale(id, locale);
        return locale;
      } catch (error) {
        logger.warn(`Could not load language for guild ${id}, using ${DEFAULT_LOCALE}: ${error.message}`);
        cacheGuildLocale(id, DEFAULT_LOCALE);
        return DEFAULT_LOCALE;
      } finally {
        pendingLoads.delete(id);
      }
    })());
  }

  return pendingLoads.get(id);
}

export async function setGuildLocale(client, guildId, locale) {
  const normalized = normalizeLocale(locale);
  if (!normalized) {
    throw new Error(`Unsupported language: ${locale}`);
  }

  await updateGuildConfig(client, guildId, { language: normalized });
  cacheGuildLocale(guildId, normalized);
  return normalized;
}

function guildIdFromEventArgs(args) {
  for (const arg of args) {
    if (!arg || typeof arg !== 'object') continue;
    const guildId = arg.guildId ?? arg.guild?.id ?? arg.message?.guildId ?? arg.message?.guild?.id;
    if (guildId) return guildId;
    // Guild objects themselves (guildCreate, guildDelete).
    if (arg.members && arg.channels && arg.id) return arg.id;
  }
  return null;
}

/** Resolve the language for a gateway event from its arguments. */
export async function resolveEventLocale(client, args) {
  const guildId = guildIdFromEventArgs(args);
  if (guildId) return getGuildLocale(client, guildId);

  // DMs: follow the user's Discord client language when Discord tells us.
  for (const arg of args) {
    const fromDiscord = localeFromDiscord(arg?.locale);
    if (fromDiscord) return fromDiscord;
  }

  return DEFAULT_LOCALE;
}

/** Run a task in a guild's language (cron jobs, timers, external events). */
export async function withGuildLocale(client, guildId, callback) {
  const locale = await getGuildLocale(client, guildId);
  return runWithLocale(locale, callback);
}
