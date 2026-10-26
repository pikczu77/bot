// warningPunishments.js — what each number of warnings does (2026-10-26, owner: "zresetuj wszystkie warny,
// i ogarnij pokolei co robi ile warnow").
//
// Every warning (/warn and automod rules with the "warn" action) goes through warnMember(): it is stored
// by WarningService, the warnings of the last `expireDays` are counted and the step for that number runs:
// nothing, a timeout, a kick or a ban (a ban with minutes lifts itself, services/moderation/tempbanService.js).
// The member gets a DM with the reason, the count, the punishment and what the next warning brings.
// Settings: guild:{id}:warning-punishments = { enabled, expireDays, steps: [{ count, action, minutes }] }, web panel module
// "Ostrzeżenia". A count above the last step uses the last step.

import { guildStore } from '../../utils/featureKit.js';
import { db, getFromDb, setInDb, getWarningsPrefix } from '../../utils/database.js';
import { createEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';
import { logModerationAction } from '../../utils/moderation.js';
import { t } from '../../i18n/index.js';
import { WarningService } from './warningService.js';
import { scheduleUnban } from './tempbanService.js';

export const PUNISHMENT_ACTIONS = ['none', 'timeout', 'kick', 'ban'];
export const MAX_TIMEOUT_MINUTES = 28 * 24 * 60; // Discord's limit
export const MAX_BAN_MINUTES = 365 * 24 * 60;
export const MAX_STEPS = 15;

// My ladder for a server with young members: two light steps, then longer timeouts, a kick, temporary bans.
// A permanent ban stays a decision of the moderators.
export const DEFAULT_STEPS = Object.freeze([
  { count: 1, action: 'none', minutes: 0 },
  { count: 2, action: 'timeout', minutes: 10 },
  { count: 3, action: 'timeout', minutes: 60 },
  { count: 4, action: 'timeout', minutes: 6 * 60 },
  { count: 5, action: 'timeout', minutes: 24 * 60 },
  { count: 6, action: 'timeout', minutes: 3 * 24 * 60 },
  { count: 7, action: 'kick', minutes: 0 },
  { count: 8, action: 'ban', minutes: 7 * 24 * 60 },
  { count: 9, action: 'ban', minutes: 30 * 24 * 60 },
]);

const store = guildStore('warning-punishments', { enabled: true, expireDays: 30, steps: DEFAULT_STEPS.map((step) => ({ ...step })) });
export const getPunishmentSettings = (guildId) => store.get(guildId);
export const updatePunishmentSettings = (guildId, mutate) => store.update(guildId, mutate);

/** The step for `count` warnings: the exact one, or the highest below it. */
export function stepFor(settings, count) {
  const steps = [...(settings.steps ?? [])].sort((a, b) => a.count - b.count);
  let found = null;
  for (const step of steps) if (step.count <= count) found = step;
  return found;
}

/** Warnings of the member that still count (the last `expireDays`; 0 = all). */
export async function activeWarnings(guildId, userId, settings, now = Date.now()) {
  const warnings = await WarningService.getWarnings(guildId, userId);
  const days = Number(settings.expireDays) || 0;
  return days > 0 ? warnings.filter((warning) => now - (Number(warning.timestamp) || 0) < days * 86_400_000) : warnings;
}

/** "timeout 1 h" / "ban 7 days" in words. */
export function describeStep(step) {
  if (!step || step.action === 'none') return t('only a warning');
  const minutes = Number(step.minutes) || 0;
  const time = minutes >= 1440 && minutes % 1440 === 0 ? t`${minutes / 1440} {0|day|days}`
    : minutes >= 60 && minutes % 60 === 0 ? t`${minutes / 60} h` : t`${minutes} min`;
  if (step.action === 'timeout') return t`timeout ${time}`;
  if (step.action === 'kick') return t('kick from the server');
  return minutes > 0 ? t`ban for ${time}` : t('permanent ban');
}

async function applyStep({ client, guild, member, userId, step, count, reason, now }) {
  if (!step || step.action === 'none') return false;
  const why = t`${count} warnings: ${reason}`.slice(0, 500);
  const me = guild.members.me;
  try {
    if (step.action === 'timeout') {
      if (!member?.moderatable) return false;
      const until = now + Math.min(MAX_TIMEOUT_MINUTES, step.minutes) * 60_000;
      // A longer timeout already running (automod, a moderator) is not shortened.
      if ((member.communicationDisabledUntilTimestamp ?? 0) >= until) return false;
      await member.timeout(until - now, why);
    } else if (step.action === 'kick') {
      if (!member?.kickable) return false;
      await member.kick(why);
    } else if (step.action === 'ban') {
      if (member && !member.bannable) return false;
      await guild.members.ban(userId, { reason: why });
      if (step.minutes > 0) {
        await scheduleUnban(guild.id, { userId, until: now + step.minutes * 60_000, moderatorId: client.user?.id ?? me?.id ?? null, reason: why });
      }
    }
    await logModerationAction({
      client,
      guild,
      event: {
        action: t`Warning punishment: ${describeStep(step)}`,
        target: member?.user ? `${member.user.tag ?? member.user.username} (${userId})` : userId,
        executor: client.user ? `${client.user.tag ?? client.user.username} (${client.user.id})` : 'bot',
        reason: why,
        metadata: { userId, warnings: count, action: step.action, minutes: step.minutes },
      },
    }).catch(() => {});
    return true;
  } catch (error) {
    logger.warn(`Warning punishment ${step.action} failed for ${userId} in ${guild.id}: ${error.message}`);
    return false;
  }
}

/**
 * Add a warning and run the step for the new count. `member` may be null (not on the server).
 * Returns { id, count, step, applied, next }.
 */
export async function warnMember({ client, guild, member = null, userId, moderatorId, reason, now = Date.now() }) {
  const targetId = userId ?? member?.id;
  const { id } = await WarningService.addWarning({ guildId: guild.id, userId: targetId, moderatorId, reason, timestamp: now });
  const settings = await getPunishmentSettings(guild.id);
  const count = (await activeWarnings(guild.id, targetId, settings, now)).length;
  const step = settings.enabled ? stepFor(settings, count) : null;
  const next = settings.enabled ? stepFor(settings, count + 1) : null;

  // The DM goes first: after a kick or a ban the bot can no longer reach the member through the server.
  const user = member?.user ?? null;
  if (user?.send) {
    const lines = [
      t`**Reason:** ${reason}`,
      settings.expireDays > 0 ? t`**Warnings in the last ${settings.expireDays} days:** ${count}` : t`**Warnings:** ${count}`,
      settings.enabled ? t`**Punishment:** ${describeStep(step)}` : null,
      settings.enabled && next ? t`**Next warning:** ${describeStep(next)}` : null,
    ].filter(Boolean);
    await user.send({ embeds: [createEmbed({ title: t`⚠️ Warning on ${guild.name}`, description: lines.join('\n'), color: 'warning', footer: false })] })
      .catch(() => {});
  }

  const applied = await applyStep({ client, guild, member, userId: targetId, step, count, reason, now });
  return { id, count, step, applied, next };
}

/** Delete every warning on a server. Returns how many members had warnings. */
export async function resetGuildWarnings(guildId) {
  const keys = await db.list(getWarningsPrefix(guildId));
  let members = 0;
  for (const key of Array.isArray(keys) ? keys : []) {
    const warnings = await getFromDb(key, []);
    if (Array.isArray(warnings) && warnings.length) members += 1;
    await setInDb(key, []);
  }
  return members;
}

// Owner on 2026-10-26: "zresetuj wszystkie warny". Runs once after the next start on every server.
const RESET_MARKER = 'bot:warnings-reset:2026-10-26';

export async function resetAllWarningsOnce(client) {
  if (await getFromDb(RESET_MARKER, null)) return null;
  const done = {};
  for (const guild of client.guilds.cache.values()) {
    done[guild.id] = await resetGuildWarnings(guild.id).catch((error) => {
      logger.warn(`Warnings reset failed in guild ${guild.id}: ${error.message}`);
      return -1;
    });
  }
  await setInDb(RESET_MARKER, { at: Date.now(), guilds: done });
  logger.info(`All warnings reset once (owner's request): ${JSON.stringify(done)}`);
  return done;
}

/** Members with warnings that still count, most first (for the panel). */
export async function warnedMembers(guildId, settings, now = Date.now(), limit = 25) {
  const keys = await db.list(getWarningsPrefix(guildId));
  const prefix = getWarningsPrefix(guildId);
  const rows = [];
  for (const key of Array.isArray(keys) ? keys : []) {
    const userId = String(key).slice(prefix.length);
    const count = (await activeWarnings(guildId, userId, settings, now)).length;
    if (count > 0) rows.push({ userId, count });
  }
  return rows.sort((a, b) => b.count - a.count).slice(0, limit);
}
