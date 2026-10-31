// dataBackup.js — a copy of one server's data on a private Discord channel, once a day (2026-11-01,
// owner picked the idea: data/storage.json and its one backup sat in the same folder on the host).
//
// The file holds only this server's entries, so a panel user of one server never gets another server's
// data. Secrets (the Minecraft panel key) are taken out; after a restore the key has to be typed in
// again. The channel must be closed to @everyone: the file has every balance and setting of the server.
// Old copies stay on the channel. Restore: scripts/restore-backup.js.
//
// Store guild:{id}:data-backup = { channelId, hour, lastDay, lastTryAt, lastAt, lastBytes, lastEntries, lastError }.

import { promisify } from 'node:util';
import { gzip as gzipCallback } from 'node:zlib';
import { AttachmentBuilder, PermissionFlagsBits } from 'discord.js';
import { guildStore } from '../utils/featureKit.js';
import { logger } from '../utils/logger.js';
import { dayKey, warsawHour } from '../utils/warsawTime.js';
import { enterLocale, t } from '../i18n/index.js';
import { getGuildLocale } from './languageService.js';

const gzip = promisify(gzipCallback);

export const BACKUP_FORMAT = 'klubik-guild-backup-1';
// A Discord file without server boosts can have 10 MiB; a bigger copy goes as parts, one part per message.
export const PART_BYTES = 8 * 1024 * 1024;
const MAX_PARTS = 20;
const RETRY_MS = 30 * 60_000;
const SECRET_FIELD = /^(api[-_]?key|token|secret|password|webhook(url|token)?)$/i;

const store = guildStore('data-backup', {
  channelId: null, hour: 4, lastDay: null, lastTryAt: 0, lastAt: 0, lastBytes: 0, lastEntries: 0, lastError: null,
});
export const getBackupSettings = (guildId) => store.get(guildId);
export const updateBackupSettings = (guildId, mutate) => store.update(guildId, mutate);

/** A deep copy without the secret fields. */
export function withoutSecrets(value) {
  if (Array.isArray(value)) return value.map(withoutSecrets);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([field]) => !SECRET_FIELD.test(field))
    .map(([field, inner]) => [field, withoutSecrets(inner)]));
}

/** Why the copy cannot go to this channel: 'missing', 'public', 'permissions', or null when it can. */
export function backupChannelProblem(guild, channel) {
  if (!channel?.send) return 'missing';
  if (channel.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel)) return 'public';
  const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles];
  if (!guild.members.me || !channel.permissionsFor(guild.members.me)?.has(needed)) return 'permissions';
  return null;
}

export const problemText = (problem) => ({
  missing: t('That channel no longer exists.'),
  public: t('Everyone on the server can see that channel. Pick a channel closed to @everyone: the copy has all the data of the server.'),
  permissions: t('The bot needs View Channel, Send Messages and Attach Files on that channel.'),
  too_big: t('The copy is too big to send.'),
}[problem] ?? t('The copy could not be sent.'));

/** Every entry of the server, gzipped JSON. */
export async function buildBackup(client, guild, now = Date.now()) {
  const entries = {};
  for (const prefix of [`guild:${guild.id}:`, `user:${guild.id}:`]) {
    const keys = await client.db.list(prefix);
    for (const key of Array.isArray(keys) ? keys : []) {
      const value = await client.db.get(key);
      if (value !== null && value !== undefined) entries[key] = withoutSecrets(value);
    }
  }
  const text = JSON.stringify({ format: BACKUP_FORMAT, guildId: guild.id, guildName: guild.name, createdAt: new Date(now).toISOString(), entries });
  return { buffer: await gzip(text), entries: Object.keys(entries).length };
}

function splitBuffer(buffer, size = PART_BYTES) {
  const parts = [];
  for (let start = 0; start < buffer.length; start += size) parts.push(buffer.subarray(start, start + size));
  return parts;
}

const sizeText = (bytes) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** Build and post the copy now. Returns { ok, error?, entries?, bytes?, parts? } and notes the result in the store. */
export async function sendBackup(client, guild, { now = Date.now() } = {}) {
  const settings = await getBackupSettings(guild.id);
  const channel = settings.channelId ? guild.channels.cache.get(settings.channelId) : null;
  let error = backupChannelProblem(guild, channel);
  let result = null;
  if (!error) {
    const { buffer, entries } = await buildBackup(client, guild, now);
    const parts = splitBuffer(buffer);
    if (parts.length > MAX_PARTS) {
      error = 'too_big';
    } else {
      const day = dayKey(now);
      const name = `kopia-${guild.id}-${day}.json.gz`;
      const text = t`💾 Data copy of **${guild.name}** · ${day} · entries: **${entries}** · ${sizeText(buffer.length)}. Without the Minecraft key.`;
      for (const [index, part] of parts.entries()) {
        const partName = parts.length > 1 ? `${name}.part${index + 1}` : name;
        await channel.send({
          content: parts.length > 1 ? `${text} (${index + 1}/${parts.length})` : text,
          files: [new AttachmentBuilder(part, { name: partName })],
          allowedMentions: { parse: [] },
        });
      }
      result = { entries, bytes: buffer.length, parts: parts.length };
    }
  }
  await updateBackupSettings(guild.id, (stored) => {
    stored.lastTryAt = now;
    stored.lastError = error;
    if (result) {
      stored.lastDay = dayKey(now);
      stored.lastAt = now;
      stored.lastBytes = result.bytes;
      stored.lastEntries = result.entries;
    }
  });
  return result ? { ok: true, ...result } : { ok: false, error };
}

/** Every minute: the copy of the day goes at the server's hour; a failed one tries again after 30 min. */
export async function tickBackup(client, guild, now = Date.now()) {
  const settings = await getBackupSettings(guild.id);
  if (!settings.channelId || settings.lastDay === dayKey(now) || warsawHour(now) < settings.hour) return false;
  if (now - (settings.lastTryAt || 0) < RETRY_MS) return false;
  const result = await sendBackup(client, guild, { now });
  if (!result.ok) logger.warn(`Data copy not sent in guild ${guild.id}: ${result.error}`);
  return result.ok;
}

export async function runDataBackups(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      enterLocale(await getGuildLocale(client, guild.id));
      await tickBackup(client, guild);
    } catch (error) {
      logger.warn(`Data copy failed in guild ${guild.id}: ${error.message}`);
      await updateBackupSettings(guild.id, (stored) => {
        stored.lastTryAt = Date.now();
        stored.lastError = 'send';
      }).catch(() => {});
    }
  }
}
