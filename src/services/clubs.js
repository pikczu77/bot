// clubs.js — /klub: members found clubs, invite friends, fill a shared treasury and race in a weekly
// ranking (2026-10-27, owner picked idea 9 and called them "kluby").
//
// Store guild:{id}:clubs = { clubs: { [clubId]: club }, nextId, week, lastWeek: { week, ranking } }
//   club = { id, name, emoji, ownerId, createdAt, treasury, upgrades: { size, bonus, crew },
//            members: [{ id, joinedAt, baseline }], invites: { [userId]: expiresAt } }
// Weekly points = job money (stat `earned`, services/progress.js) the members made since Monday or since they
// joined: `baseline` is their `earned` at that moment. On Monday the three best clubs get a prize in their
// treasury (posted on the events channel when one is set) and every baseline starts again.
// Members carry `club = { id, bonus, crew }` in their economy data, so earningMultiplier() and /napad read the
// perks without another lookup. It is written on join, leave, kick, upgrade and disband (syncMembers).
// Store changes run under one lock per server ('#clubs'), member money under the member's lock, always in that order.

import { createEmbed } from '../utils/embeds.js';
import { guildStore } from '../utils/featureKit.js';
import { logger } from '../utils/logger.js';
import { getEconomyData, setEconomyData } from '../utils/economy.js';
import { enterLocale, t } from '../i18n/index.js';
import { weekKey } from '../utils/warsawTime.js';
import { getGuildLocale } from './languageService.js';
import { getEconomySettings, money, scaleEarnings } from './economySettings.js';
import { spendMoney, withEconomyLock } from './economyUpgrades.js';
import { recordProgress, stat } from './progress.js';

export const BASE_MEMBERS = 5;
export const MEMBERS_PER_LEVEL = 3;
export const BONUS_PER_LEVEL = 2;
export const CREW_PER_LEVEL = 4;
export const INVITE_TTL_MS = 24 * 60 * 60 * 1000;
export const NAME_LIMITS = Object.freeze([3, 24]);
export const DEFAULT_EMOJI = '🛡️';
// Shares of commands.clubs.weeklyPrize for the 1st, 2nd and 3rd club of the week.
export const WEEKLY_PRIZE_SHARES = Object.freeze([1, 0.4, 0.2]);

// Paid from the club's treasury by the owner.
export const CLUB_UPGRADES = Object.freeze([
  { id: 'size', emoji: '🏠', name: t('Clubhouse'), prices: [10_000, 25_000, 50_000, 100_000, 200_000],
    effect: (level) => t`up to ${BASE_MEMBERS + level * MEMBERS_PER_LEVEL} members` },
  { id: 'bonus', emoji: '💰', name: t('Club bonus'), prices: [20_000, 40_000, 80_000, 160_000, 320_000],
    effect: (level) => t`+${level * BONUS_PER_LEVEL}% job pay for every member` },
  { id: 'crew', emoji: '🦹', name: t('Heist crew'), prices: [15_000, 40_000, 100_000],
    effect: (level) => t`+${level * CREW_PER_LEVEL}% heist chance with 2+ members in the crew` },
]);
export const getClubUpgrade = (id) => CLUB_UPGRADES.find((upgrade) => upgrade.id === id) ?? null;

const store = guildStore('clubs', { clubs: {}, nextId: 1, week: null, lastWeek: null });
export const getClubs = (guildId) => store.get(guildId);
const withClubLock = (guildId, task) => withEconomyLock(guildId, '#clubs', task);

// ---------------------------------------------------------------- reading

const fold = (text) => String(text ?? '').toLocaleLowerCase('pl').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').trim();

export const clubList = (data) => Object.values(data?.clubs ?? {});
export const clubOf = (data, userId) => clubList(data).find((club) => club.members.some((member) => member.id === userId)) ?? null;
export const clubLabel = (club) => `${club.emoji || DEFAULT_EMOJI} ${club.name}`;
export const levelOf = (club, id) => Math.max(0, Number(club?.upgrades?.[id]) || 0);
export const memberLimit = (club) => BASE_MEMBERS + levelOf(club, 'size') * MEMBERS_PER_LEVEL;

/** A club by id or name (any case, without Polish letters). */
export function findClub(data, query) {
  const wanted = fold(query);
  if (!wanted) return null;
  return data?.clubs?.[query] ?? clubList(data).find((club) => fold(club.name) === wanted) ?? null;
}

/** What members of the club carry in their economy data. */
export const clubPerks = (club) => ({ id: club.id, bonus: levelOf(club, 'bonus') * BONUS_PER_LEVEL, crew: levelOf(club, 'crew') * CREW_PER_LEVEL });

/** Extra /napad chance: the best "Heist crew" level of a club with at least two members in the crew. */
export function clubCrewBonus(userDatas) {
  const byClub = new Map();
  for (const userData of userDatas) {
    const club = userData?.club;
    if (!club?.id) continue;
    const entry = byClub.get(club.id) ?? { count: 0, crew: Number(club.crew) || 0 };
    entry.count += 1;
    byClub.set(club.id, entry);
  }
  return Math.max(0, ...[...byClub.values()].filter((entry) => entry.count >= 2).map((entry) => entry.crew));
}

/** Club names for the autocomplete: `[{ name, value }]`. */
export function clubChoices(data, query = '') {
  const wanted = fold(query);
  return clubList(data)
    .filter((club) => !wanted || fold(club.name).includes(wanted))
    .sort((a, b) => b.members.length - a.members.length)
    .slice(0, 25)
    .map((club) => ({ name: `${clubLabel(club)} (${club.members.length})`.slice(0, 100), value: club.id }));
}

const earnedOf = async (client, guildId, userId) => stat(await getEconomyData(client, guildId, userId, { joint: false }), 'earned');

/** Points of the week: { total, members: [{ id, points }] } (best first). */
export async function weekPoints(client, guildId, club) {
  const members = [];
  for (const member of club.members) {
    const points = Math.max(0, (await earnedOf(client, guildId, member.id)) - (Number(member.baseline) || 0));
    members.push({ id: member.id, points });
  }
  members.sort((a, b) => b.points - a.points);
  return { total: members.reduce((sum, member) => sum + member.points, 0), members };
}

/** Every club with its points this week, best first. */
export async function clubRanking(client, guildId) {
  const data = await getClubs(guildId);
  const rows = [];
  for (const club of clubList(data)) rows.push({ club, ...(await weekPoints(client, guildId, club)) });
  return rows.sort((a, b) => b.total - a.total || a.club.createdAt - b.club.createdAt);
}

// ---------------------------------------------------------------- member data

/** Write the club's perks (or none) into the members' economy data. */
async function syncMembers(client, guildId, userIds, club) {
  for (const userId of userIds) {
    await withEconomyLock(guildId, userId, async () => {
      const userData = await getEconomyData(client, guildId, userId, { joint: false });
      if (club) userData.club = clubPerks(club);
      else delete userData.club;
      await setEconomyData(client, guildId, userId, userData);
    });
  }
}

function checkName(name, data, userError) {
  const clean = String(name ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length < NAME_LIMITS[0] || clean.length > NAME_LIMITS[1]) {
    throw userError(t`A club name needs ${NAME_LIMITS[0]}-${NAME_LIMITS[1]} characters.`);
  }
  if (!/^[\p{L}\p{N} '._!-]+$/u.test(clean)) throw userError(t('Use letters, digits, spaces and - . _ \' ! in the club name.'));
  if (clubList(data).some((club) => fold(club.name) === fold(clean))) throw userError(t`There is already a club called **${clean}**.`);
  return clean;
}

function checkEmoji(emoji, userError) {
  if (!emoji) return DEFAULT_EMOJI;
  const clean = String(emoji).trim();
  if (clean.length > 16 || !/^\p{Extended_Pictographic}/u.test(clean) || /\s/.test(clean)) {
    throw userError(t('Pick one emoji for the club (for example 🦊).'));
  }
  return clean;
}

const ownClub = (data, userId, userError) => {
  const club = clubOf(data, userId);
  if (!club) throw userError(t('You are not in a club. Found one with `/klub zaloz` or ask for an invite.'));
  return club;
};
const requireOwner = (club, userId, userError) => {
  if (club.ownerId !== userId) throw userError(t`Only the owner of ${clubLabel(club)} can do that.`);
};

// ---------------------------------------------------------------- actions

/** Found a club for `foundPrice` (cash first, then the bank). Returns { club, price, progress }. */
export function foundClub({ client, guildId, userId, name, emoji, userError, now = Date.now() }) {
  return withClubLock(guildId, async () => {
    const data = await getClubs(guildId);
    if (clubOf(data, userId)) throw userError(t('You are already in a club. Leave it first with `/klub wyjdz`.'));
    const clean = checkName(name, data, userError);
    const icon = checkEmoji(emoji, userError);
    const settings = await getEconomySettings(guildId);
    const price = settings.commands.clubs.foundPrice;
    const id = `k${data.nextId || 1}`;
    const club = {
      id, name: clean, emoji: icon, ownerId: userId, createdAt: now, treasury: 0,
      upgrades: { size: 0, bonus: 0, crew: 0 }, members: [], invites: {},
    };
    const progress = await withEconomyLock(guildId, userId, async () => {
      const userData = await getEconomyData(client, guildId, userId);
      if (!spendMoney(userData, price)) throw userError(t`A club costs ${money(guildId, price)} - you do not have that much (cash and bank).`);
      club.members.push({ id: userId, joinedAt: now, baseline: stat(userData, 'earned') });
      userData.club = clubPerks(club);
      const result = recordProgress(userData, { clubJoin: 1 }, { settings, now });
      await setEconomyData(client, guildId, userId, userData);
      return result;
    });
    data.clubs = { ...data.clubs, [id]: club };
    data.nextId = (data.nextId || 1) + 1;
    data.week ??= weekKey(now);
    await store.set(guildId, data);
    return { club, price, progress };
  });
}

/** Invite someone to the inviter's club (any member may invite). Returns { club, expiresAt }. */
export function inviteToClub({ guildId, inviterId, target, userError, now = Date.now() }) {
  return withClubLock(guildId, async () => {
    const data = await getClubs(guildId);
    const club = ownClub(data, inviterId, userError);
    if (target.bot || target.id === inviterId) throw userError(t('Pick another member to invite.'));
    const theirs = clubOf(data, target.id);
    if (theirs) throw userError(t`${target.username} is already in ${clubLabel(theirs)}.`);
    if (club.members.length >= memberLimit(club)) throw userError(t`${clubLabel(club)} is full (${memberLimit(club)} members). A bigger clubhouse makes room.`);
    const expiresAt = now + INVITE_TTL_MS;
    const invites = Object.fromEntries(Object.entries(club.invites ?? {}).filter(([, until]) => until > now));
    club.invites = { ...invites, [target.id]: expiresAt };
    await store.set(guildId, data);
    return { club, expiresAt };
  });
}

/** Answer an invite. Returns { club, joined, progress }. */
export function answerInvite({ client, guildId, clubId, userId, accept, userError, now = Date.now() }) {
  return withClubLock(guildId, async () => {
    const data = await getClubs(guildId);
    const club = data.clubs?.[clubId];
    if (!club || !(club.invites?.[userId] > now)) throw userError(t('This invite is no longer valid.'));
    delete club.invites[userId];
    if (!accept) {
      await store.set(guildId, data);
      return { club, joined: false };
    }
    const theirs = clubOf(data, userId);
    if (theirs) {
      await store.set(guildId, data);
      throw userError(t`You are already in ${clubLabel(theirs)}.`);
    }
    if (club.members.length >= memberLimit(club)) {
      await store.set(guildId, data);
      throw userError(t`${clubLabel(club)} is full.`);
    }
    const settings = await getEconomySettings(guildId);
    const progress = await withEconomyLock(guildId, userId, async () => {
      const userData = await getEconomyData(client, guildId, userId, { joint: false });
      userData.club = clubPerks(club);
      const result = recordProgress(userData, { clubJoin: 1 }, { settings, now });
      club.members.push({ id: userId, joinedAt: now, baseline: stat(userData, 'earned') });
      await setEconomyData(client, guildId, userId, userData);
      return result;
    });
    await store.set(guildId, data);
    return { club, joined: true, progress };
  });
}

/**
 * Leave the club. The owner hands it to the member who joined first; the last member closes it and
 * gets the treasury. Returns { club, closed, newOwnerId, refund }.
 */
export function leaveClub({ client, guildId, userId, userError }) {
  return withClubLock(guildId, async () => {
    const data = await getClubs(guildId);
    const club = ownClub(data, userId, userError);
    club.members = club.members.filter((member) => member.id !== userId);
    let closed = false;
    let refund = 0;
    let newOwnerId = null;
    if (club.members.length === 0) {
      closed = true;
      refund = Math.max(0, Math.floor(club.treasury || 0));
      delete data.clubs[club.id];
    } else if (club.ownerId === userId) {
      newOwnerId = [...club.members].sort((a, b) => a.joinedAt - b.joinedAt)[0].id;
      club.ownerId = newOwnerId;
    }
    await store.set(guildId, data);
    await withEconomyLock(guildId, userId, async () => {
      const userData = await getEconomyData(client, guildId, userId, { joint: false });
      delete userData.club;
      if (refund > 0) userData.wallet = (Number(userData.wallet) || 0) + refund;
      await setEconomyData(client, guildId, userId, userData);
    });
    return { club, closed, newOwnerId, refund };
  });
}

/** The owner removes a member. Returns { club }. */
export function kickMember({ client, guildId, ownerId, targetId, userError }) {
  return withClubLock(guildId, async () => {
    const data = await getClubs(guildId);
    const club = ownClub(data, ownerId, userError);
    requireOwner(club, ownerId, userError);
    if (targetId === ownerId) throw userError(t('You cannot remove yourself. Use `/klub wyjdz`.'));
    if (!club.members.some((member) => member.id === targetId)) throw userError(t`<@${targetId}> is not in ${clubLabel(club)}.`);
    club.members = club.members.filter((member) => member.id !== targetId);
    await store.set(guildId, data);
    await syncMembers(client, guildId, [targetId], null);
    return { club };
  });
}

/** The owner hands the club to another member. Returns { club }. */
export function transferClub({ guildId, ownerId, targetId, userError }) {
  return withClubLock(guildId, async () => {
    const data = await getClubs(guildId);
    const club = ownClub(data, ownerId, userError);
    requireOwner(club, ownerId, userError);
    if (targetId === ownerId || !club.members.some((member) => member.id === targetId)) {
      throw userError(t`Pick a member of ${clubLabel(club)}.`);
    }
    club.ownerId = targetId;
    await store.set(guildId, data);
    return { club };
  });
}

/** A member puts money into the treasury (cash first, then the bank). Returns { club, amount, progress }. */
export function depositToClub({ client, guildId, userId, amount, userError, now = Date.now() }) {
  return withClubLock(guildId, async () => {
    const data = await getClubs(guildId);
    const club = ownClub(data, userId, userError);
    const settings = await getEconomySettings(guildId);
    const progress = await withEconomyLock(guildId, userId, async () => {
      const userData = await getEconomyData(client, guildId, userId);
      if (!spendMoney(userData, amount)) throw userError(t`You do not have ${money(guildId, amount)} (cash and bank).`);
      const result = recordProgress(userData, { clubDeposit: amount }, { settings, now });
      await setEconomyData(client, guildId, userId, userData);
      return result;
    });
    club.treasury = (Number(club.treasury) || 0) + amount;
    await store.set(guildId, data);
    return { club, amount, progress };
  });
}

/** The owner pays money out of the treasury to a member (cash). Returns { club, amount, toId }. */
export function withdrawFromClub({ client, guildId, ownerId, amount, toId = null, userError }) {
  return withClubLock(guildId, async () => {
    const data = await getClubs(guildId);
    const club = ownClub(data, ownerId, userError);
    requireOwner(club, ownerId, userError);
    const target = toId ?? ownerId;
    if (!club.members.some((member) => member.id === target)) throw userError(t`Money from the treasury goes only to members of ${clubLabel(club)}.`);
    if (amount > (club.treasury || 0)) throw userError(t`The treasury has only ${money(guildId, club.treasury || 0)}.`);
    club.treasury -= amount;
    await store.set(guildId, data);
    await withEconomyLock(guildId, target, async () => {
      const userData = await getEconomyData(client, guildId, target);
      userData.wallet = (Number(userData.wallet) || 0) + amount;
      await setEconomyData(client, guildId, target, userData);
    });
    return { club, amount, toId: target };
  });
}

/** The owner buys the next level of an upgrade from the treasury. Returns { club, upgrade, level, price }. */
export function upgradeClub({ client, guildId, ownerId, upgradeId, userError }) {
  return withClubLock(guildId, async () => {
    const data = await getClubs(guildId);
    const club = ownClub(data, ownerId, userError);
    requireOwner(club, ownerId, userError);
    const upgrade = getClubUpgrade(upgradeId);
    if (!upgrade) throw userError(t('Pick an upgrade from the list.'));
    const level = levelOf(club, upgrade.id);
    if (level >= upgrade.prices.length) throw userError(t`${upgrade.emoji} ${upgrade.name} is already at the top level.`);
    const price = upgrade.prices[level];
    if ((club.treasury || 0) < price) {
      throw userError(t`${upgrade.emoji} ${upgrade.name} level ${level + 1} costs ${money(guildId, price)}; the treasury has ${money(guildId, club.treasury || 0)}.`);
    }
    club.treasury -= price;
    club.upgrades = { ...club.upgrades, [upgrade.id]: level + 1 };
    await store.set(guildId, data);
    if (upgrade.id !== 'size') await syncMembers(client, guildId, club.members.map((member) => member.id), club);
    return { club, upgrade, level: level + 1, price };
  });
}

// ---------------------------------------------------------------- weekly ranking

/** On a new week: prizes for the best three clubs, new baselines. Returns the finished ranking or null. */
export async function settleClubWeek(client, guild, now = Date.now()) {
  const week = weekKey(now);
  const result = await withClubLock(guild.id, async () => {
    const data = await getClubs(guild.id);
    if (!data.week || clubList(data).length === 0) {
      if (data.week !== week) {
        data.week = week;
        await store.set(guild.id, data);
      }
      return null;
    }
    if (data.week === week) return null;

    const settings = await getEconomySettings(guild.id);
    const rows = [];
    for (const club of clubList(data)) rows.push({ club, ...(await weekPoints(client, guild.id, club)) });
    rows.sort((a, b) => b.total - a.total || a.club.createdAt - b.club.createdAt);
    const ranking = rows.slice(0, 5).map((row, index) => {
      const share = row.total > 0 ? WEEKLY_PRIZE_SHARES[index] ?? 0 : 0;
      const prize = share > 0 ? scaleEarnings(settings, Math.round(settings.commands.clubs.weeklyPrize * share)) : 0;
      if (prize > 0) row.club.treasury = (Number(row.club.treasury) || 0) + prize;
      return { id: row.club.id, name: row.club.name, emoji: row.club.emoji, points: row.total, prize };
    });
    for (const club of clubList(data)) {
      for (const member of club.members) member.baseline = await earnedOf(client, guild.id, member.id);
    }
    data.lastWeek = { week: data.week, ranking };
    data.week = week;
    await store.set(guild.id, data);
    return { ranking, settings };
  });
  if (!result) return null;

  const winners = result.ranking.filter((row) => row.prize > 0);
  const channel = result.settings.events?.channelId ? guild.channels.cache.get(result.settings.events.channelId) : null;
  if (winners.length && channel?.send) {
    const medals = ['🥇', '🥈', '🥉'];
    const embed = createEmbed({
      title: t('🏆 Clubs of the week'),
      description: winners.map((row, index) => t`${medals[index]} ${row.emoji || DEFAULT_EMOJI} **${row.name}**: ${money(guild.id, row.points)} earned · **+${money(guild.id, row.prize)}** to the treasury`).join('\n')
        + t('\n\nA new week has started: `/klub ranking`.'),
      color: '#F1C40F',
      footer: false,
    });
    await channel.send({ embeds: [embed] }).catch((error) => logger.warn(`Club ranking not posted in guild ${guild.id}: ${error.message}`));
  }
  return result.ranking;
}

export async function runClubs(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      enterLocale(await getGuildLocale(guild.id));
      await settleClubWeek(client, guild);
    } catch (error) {
      logger.warn(`Club week failed in guild ${guild.id}: ${error.message}`);
    }
  }
}
