// minecraftServer.js — Minecraft server power and backups (2026-10-26, owner picked ideas 2 and 3).
//
// Uses the panel connection of the whitelist (src/services/minecraftWhitelist.js, Pterodactyl client API):
//   GET  ''            name, limits, feature_limits.backups (how many backups the plan keeps)
//   GET  /resources    state, CPU, RAM, disk, uptime
//   POST /power        start | stop | restart
//   GET/POST /backups, DELETE /backups/<uuid>
// Settings in the whitelist store: backupEveryHours (0 = off), lastAutoBackupAt, lastBackup { at, ok, auto, error }.
// Automatic backups (job `minecraft_backup` every minute) are named AUTO_PREFIX; when the plan's limit is full
// the oldest unlocked automatic backup is deleted first (like Pterodactyl's own scheduled backups).
// Backups made by hand or locked in the panel are never deleted.

import { logger } from '../utils/logger.js';
import { t } from '../i18n/index.js';
import { getWhitelistConfig, panelErrorText, panelOf, panelRequest, updateWhitelistSettings } from './minecraftWhitelist.js';

export const AUTO_PREFIX = 'Discord auto';
export const MAX_BACKUP_HOURS = 168;
const RETRY_MS = 30 * 60_000;
export const POWER_SIGNALS = ['start', 'stop', 'restart'];

const busy = new Set(); // guildIds with an automatic backup in progress

/** Panel numbers for the status view: { name, state, cpu, cpuLimit, memory, memoryLimit, disk, diskLimit, uptime, backupLimit }. */
export async function serverStatus(panel) {
  const [details, resources] = await Promise.all([
    panelRequest(panel, 'GET', '').then((response) => response.json()),
    panelRequest(panel, 'GET', '/resources').then((response) => response.json()),
  ]);
  const info = details?.attributes ?? {};
  const now = resources?.attributes ?? {};
  const used = now.resources ?? {};
  return {
    name: info.name ?? null,
    state: now.current_state ?? 'offline',
    suspended: Boolean(now.is_suspended),
    cpu: Number(used.cpu_absolute) || 0,
    cpuLimit: Number(info.limits?.cpu) || 0,
    memory: Number(used.memory_bytes) || 0,
    memoryLimit: (Number(info.limits?.memory) || 0) * 1024 * 1024,
    disk: Number(used.disk_bytes) || 0,
    diskLimit: (Number(info.limits?.disk) || 0) * 1024 * 1024,
    uptime: Number(used.uptime) || 0,
    backupLimit: Number(info.feature_limits?.backups) || 0,
  };
}

export async function sendPower(panel, signal) {
  if (!POWER_SIGNALS.includes(signal)) throw new Error(`unknown power signal ${signal}`);
  await panelRequest(panel, 'POST', '/power', { json: { signal } });
}

/** Backups on the panel, newest first: [{ uuid, name, bytes, createdAt, completedAt, ok, locked }]. */
export async function listBackups(panel) {
  const data = await (await panelRequest(panel, 'GET', '/backups?per_page=50')).json();
  return (data?.data ?? []).map(({ attributes: backup = {} }) => ({
    uuid: backup.uuid,
    name: String(backup.name ?? ''),
    bytes: Number(backup.bytes) || 0,
    createdAt: Date.parse(backup.created_at) || 0,
    completedAt: backup.completed_at ? Date.parse(backup.completed_at) || 0 : 0,
    ok: backup.is_successful !== false,
    locked: Boolean(backup.is_locked),
  })).sort((a, b) => b.createdAt - a.createdAt);
}

/** Backups that take a slot: finished and successful, or still running. Failed ones do not count on Pterodactyl. */
const takesSlot = (backup) => backup.ok || !backup.completedAt;

/** "Discord auto 2026-10-26 14:00" in Warsaw time. */
export function backupName(prefix, now = Date.now()) {
  const stamp = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(new Date(now));
  return `${prefix} ${stamp}`.slice(0, 191);
}

export class BackupError extends Error {
  constructor(reason, limit = 0) {
    super(`backup not made: ${reason}`);
    this.name = 'BackupError';
    this.reason = reason; // none | full
    this.limit = limit;
  }
}

/**
 * Start a backup. `auto` = an automatic one: when the plan's limit is full, the oldest unlocked automatic
 * backup is deleted first. A backup made by hand never deletes anything.
 * Returns { name, replaced: name | null }.
 */
export async function createBackup(panel, { auto = false, by = '', now = Date.now() } = {}) {
  const status = await serverStatus(panel);
  if (status.backupLimit <= 0) throw new BackupError('none');
  const backups = await listBackups(panel);
  let replaced = null;
  if (backups.filter(takesSlot).length >= status.backupLimit) {
    const oldestAuto = auto ? backups.filter((backup) => !backup.locked && backup.name.startsWith(AUTO_PREFIX) && takesSlot(backup)).at(-1) : null;
    if (!oldestAuto) throw new BackupError('full', status.backupLimit);
    await panelRequest(panel, 'DELETE', `/backups/${encodeURIComponent(oldestAuto.uuid)}`);
    replaced = oldestAuto.name;
  }
  const name = backupName(auto ? AUTO_PREFIX : `Discord${by ? ` (${String(by).slice(0, 40)})` : ''}`, now);
  await panelRequest(panel, 'POST', '/backups', { json: { name, is_locked: false } });
  return { name, replaced, limit: status.backupLimit };
}

/** What an admin sees when a backup was not made. */
export function backupErrorText(error) {
  if (error?.reason === 'none') return t('Your hosting plan has no backup slots. Backups are not available for this server.');
  if (error?.reason === 'full') {
    return t`All ${error.limit} backup slots are taken. Delete an old backup in the panel; automatic backups replace only their own oldest copy.`;
  }
  if (error?.status === 429) return t('The panel allows only a few backups in a row. Try again in about 10 minutes.');
  return panelErrorText(error);
}

export function setBackupSchedule(guildId, hours) {
  return updateWhitelistSettings(guildId, (data) => {
    data.backupEveryHours = hours;
    // The first automatic backup comes `hours` after turning it on, not at once.
    data.lastAutoBackupAt = Date.now();
  });
}

export const recordBackup = (guildId, result) => updateWhitelistSettings(guildId, (data) => { data.lastBackup = result; });

/** One guild: make the automatic backup when it is due. Returns true when a backup was started. */
export async function tickBackup(guild, now = Date.now()) {
  const config = await getWhitelistConfig(guild.id);
  const hours = Number(config.backupEveryHours) || 0;
  if (!config.apiKey || !config.serverId || hours <= 0 || busy.has(guild.id)) return false;
  if (now - (Number(config.lastAutoBackupAt) || 0) < hours * 3_600_000) return false;
  busy.add(guild.id);
  try {
    await updateWhitelistSettings(guild.id, (data) => { data.lastAutoBackupAt = now; });
    try {
      const result = await createBackup(panelOf(config), { auto: true, now });
      await recordBackup(guild.id, { at: now, ok: true, auto: true, name: result.name, replaced: result.replaced });
      return true;
    } catch (error) {
      // Try again in 30 minutes instead of waiting a whole period.
      await updateWhitelistSettings(guild.id, (data) => {
        data.lastAutoBackupAt = now - hours * 3_600_000 + RETRY_MS;
        data.lastBackup = { at: now, ok: false, auto: true, error: backupErrorText(error) };
      });
      logger.warn(`Minecraft backup failed in guild ${guild.id}: ${error.message}`);
      return false;
    }
  } finally {
    busy.delete(guild.id);
  }
}

export async function runBackups(client) {
  for (const guild of client.guilds.cache.values()) {
    await tickBackup(guild).catch((error) => logger.warn(`Minecraft backup check failed in guild ${guild.id}: ${error.message}`));
  }
}
