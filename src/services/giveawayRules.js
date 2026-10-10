// giveawayRules.js — entry requirements and extra entries for giveaways.

import { getUserLevelData } from './leveling/leveling.js';
import { getInviteStats } from './inviteService.js';
import { t } from '../i18n/index.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Can this member enter, and with how many entries?
 * @returns {Promise<{ ok: boolean, missing: string[], tickets: number }>}
 */
export async function checkGiveawayEntry(client, member, giveaway) {
  const rules = giveaway.requirements ?? {};
  const missing = [];
  const now = Date.now();

  if (rules.roleId && !member.roles.cache.has(rules.roleId)) {
    missing.push(t`• You need the role <@&${rules.roleId}>.`);
  }

  if (rules.minLevel) {
    const data = await getUserLevelData(client, member.guild.id, member.id).catch(() => null);
    const level = data?.level ?? 0;
    if (level < rules.minLevel) missing.push(t`• You need level ${rules.minLevel} (you have ${level}).`);
  }

  if (rules.minInvites) {
    const stats = await getInviteStats(member.guild.id, member.id).catch(() => ({ total: 0 }));
    if (stats.total < rules.minInvites) missing.push(t`• You need ${rules.minInvites} {0|invite|invites} (you have ${stats.total}).`);
  }

  if (rules.minAccountAgeDays && now - member.user.createdTimestamp < rules.minAccountAgeDays * DAY_MS) {
    missing.push(t`• Your account must be older than ${rules.minAccountAgeDays} {0|day|days}.`);
  }

  if (rules.minMemberDays && now - (member.joinedTimestamp ?? now) < rules.minMemberDays * DAY_MS) {
    missing.push(t`• You must be on this server for at least ${rules.minMemberDays} {0|day|days}.`);
  }

  let tickets = 1;
  for (const bonus of giveaway.bonusEntries ?? []) {
    if (member.roles.cache.has(bonus.roleId)) tickets += bonus.entries;
  }

  return { ok: missing.length === 0, missing, tickets };
}
