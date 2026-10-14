// marriageService.js — marriages (/slub) and dates (/randka).
//
// Stored per guild under `guild:{guildId}:relationships`:
//   spouses: { [userId]: { partnerId, since } }                 (both directions)
//   pairs:   { [pairKey]: { dates, hearts, lastDate, bestScore } }
//
// A married couple has one bank with two accounts: each spouse keeps their own bank
// balance, and both can spend (and lose to /rob) the money on both accounts. That
// part lives in getEconomyData / setEconomyData (src/utils/economy.js), which ask
// getSpouseId() below. A divorce (/slub rozwod) splits the joint bank in half
// (splitJointBank in utils/economy.js); leaving the server ends the marriage and
// leaves both accounts as they are.

import { guildStore } from '../utils/featureKit.js';
import { Mutex } from '../utils/mutex.js';
import { t } from '../i18n/index.js';

const store = guildStore('relationships', { spouses: {}, pairs: {} });

/** Pending proposals and date invitations expire after this long. */
export const PROPOSAL_TTL_MS = 15 * 60 * 1000;
export const DATE_INVITE_TTL_MS = 10 * 60 * 1000;
/** One date per pair in this time. */
export const DATE_COOLDOWN_MS = 2 * 60 * 60 * 1000;
export const MARRIED_DATE_BONUS = 10;

// price in coins (before the server's currency formatting), bonus = points added to the date score
export const DATE_PLACES = Object.freeze([
  { id: 'spacer', emoji: '🌳', name: t('Walk in the park'), price: 0, bonus: 0 },
  { id: 'kawa', emoji: '☕', name: t('Coffee'), price: 250, bonus: 5 },
  { id: 'kino', emoji: '🎬', name: t('Cinema'), price: 600, bonus: 8 },
  { id: 'pizza', emoji: '🍕', name: t('Pizza'), price: 1000, bonus: 12 },
  { id: 'lunapark', emoji: '🎡', name: t('Amusement park'), price: 2000, bonus: 16 },
  { id: 'kolacja', emoji: '🕯️', name: t('Candlelit dinner'), price: 4000, bonus: 22 },
]);

const PLACES_BY_ID = new Map(DATE_PLACES.map((place) => [place.id, place]));
export const getDatePlace = (id) => PLACES_BY_ID.get(id) ?? null;

const DATE_TIERS = Object.freeze([
  {
    id: 'magic', min: 85, emoji: '💞', hearts: 5, title: t('A magical date!'),
    lines: [
      t('The conversation lasted until closing time and nobody wanted to go home.'),
      t('It ended with a kiss under the stars.'),
      t('Time flew by. Everyone around was jealous.'),
      t('There was so much chemistry that strangers asked if they were a couple.'),
    ],
  },
  {
    id: 'good', min: 60, emoji: '💖', hearts: 3, title: t('A lovely date'),
    lines: [
      t('The conversation flowed and there was a lot of laughing.'),
      t('Nice and easy - a second date is in the air.'),
      t('A few bad jokes, but the smiles were real.'),
      t('On the way back they swapped playlists.'),
    ],
  },
  {
    id: 'awkward', min: 35, emoji: '😬', hearts: 1, title: t('An awkward date'),
    lines: [
      t('Long silences. Very long silences.'),
      t('Someone spent half the date on their phone.'),
      t('They talked about the weather. Three times.'),
      t('The goodbye was a handshake.'),
    ],
  },
  {
    id: 'disaster', min: 0, emoji: '💀', hearts: 0, title: t('A total disaster'),
    lines: [
      t('Someone spilled a whole drink on the other person.'),
      t('Halfway through, an ex showed up.'),
      t('It started pouring and nobody had an umbrella.'),
      t('Both of them left early. Separately.'),
    ],
  },
]);

const RELATIONSHIP_LEVELS = Object.freeze([
  { min: 100, emoji: '👑', name: t('Legendary love') },
  { min: 60, emoji: '💞', name: t('Soulmates') },
  { min: 30, emoji: '💕', name: t('Couple') },
  { min: 15, emoji: '😊', name: t('Crush') },
  { min: 5, emoji: '🙂', name: t('Friends') },
  { min: 0, emoji: '🤝', name: t('Strangers') },
]);

export const pairKey = (first, second) => [String(first), String(second)].sort().join('-');

const EMPTY_PAIR = Object.freeze({ dates: 0, hearts: 0, lastDate: 0, bestScore: 0 });

/** Every write to the relationships document of a guild goes through this lock. */
const withRelationshipsLock = (guildId, task) => Mutex.runExclusive(`relationships:${guildId}`, task);

/** `{ partnerId, since }` or null. */
export async function getSpouse(guildId, userId) {
  const data = await store.get(guildId);
  const entry = data.spouses?.[userId];
  return entry?.partnerId ? { partnerId: String(entry.partnerId), since: Number(entry.since) || 0 } : null;
}

export async function getSpouseId(guildId, userId) {
  return (await getSpouse(guildId, userId))?.partnerId ?? null;
}

/**
 * @returns {Promise<{ ok: true, since: number } | { ok: false, reason: 'self'|'married'|'partnerMarried', partnerId?: string }>}
 */
export function marry(guildId, firstId, secondId, now = Date.now()) {
  const first = String(firstId);
  const second = String(secondId);
  if (first === second) return Promise.resolve({ ok: false, reason: 'self' });

  return withRelationshipsLock(guildId, async () => {
    let result;
    await store.update(guildId, (data) => {
      data.spouses ??= {};
      if (data.spouses[first]) {
        result = { ok: false, reason: 'married', partnerId: data.spouses[first].partnerId };
        return data;
      }
      if (data.spouses[second]) {
        result = { ok: false, reason: 'partnerMarried', partnerId: data.spouses[second].partnerId };
        return data;
      }
      data.spouses[first] = { partnerId: second, since: now };
      data.spouses[second] = { partnerId: first, since: now };
      result = { ok: true, since: now };
      return data;
    });
    return result;
  });
}

/** @returns {Promise<{ ok: true, partnerId: string, since: number } | { ok: false }>} */
export function divorce(guildId, userId) {
  const id = String(userId);
  return withRelationshipsLock(guildId, async () => {
    let result = { ok: false };
    await store.update(guildId, (data) => {
      const entry = data.spouses?.[id];
      if (!entry) return data;
      delete data.spouses[id];
      if (data.spouses[entry.partnerId]?.partnerId === id) delete data.spouses[entry.partnerId];
      result = { ok: true, partnerId: String(entry.partnerId), since: Number(entry.since) || 0 };
      return data;
    });
    return result;
  });
}

export async function getPair(guildId, firstId, secondId) {
  const data = await store.get(guildId);
  return { ...EMPTY_PAIR, ...(data.pairs?.[pairKey(firstId, secondId)] ?? {}) };
}

/** Milliseconds until this pair may go on another date (0 = now). */
export function dateCooldownLeft(pair, now = Date.now()) {
  return Math.max(0, (Number(pair?.lastDate) || 0) + DATE_COOLDOWN_MS - now);
}

/**
 * Run `task(pair)` while no other date of the guild is being settled, so a double click on
 * "accept" cannot start two dates. `task` returns the result passed back to the caller.
 */
export function withDateLock(guildId, task) {
  return withRelationshipsLock(guildId, task);
}

/** Save a finished date. Call it inside withDateLock. Returns the updated pair. */
export async function recordDate(guildId, firstId, secondId, { score, hearts }, now = Date.now()) {
  const key = pairKey(firstId, secondId);
  let pair;
  await store.update(guildId, (data) => {
    data.pairs ??= {};
    const current = { ...EMPTY_PAIR, ...(data.pairs[key] ?? {}) };
    pair = {
      dates: current.dates + 1,
      hearts: current.hearts + hearts,
      lastDate: now,
      bestScore: Math.max(current.bestScore, score),
    };
    data.pairs[key] = pair;
    return data;
  });
  return pair;
}

/**
 * Score a date. `shipScore` is the /ship percentage of the pair (0-100).
 * @returns {{ score: number, tier: object, line: string }}
 */
export function rollDate({ shipScore, place, married = false, random = Math.random }) {
  const raw = shipScore * 0.4 + random() * 60 + (place?.bonus ?? 0) + (married ? MARRIED_DATE_BONUS : 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  const tier = DATE_TIERS.find((candidate) => score >= candidate.min) ?? DATE_TIERS.at(-1);
  const line = tier.lines[Math.floor(random() * tier.lines.length) % tier.lines.length];
  return { score, tier, line };
}

/** `{ emoji, name, next }` for a number of hearts; `next` = hearts needed for the next level or null. */
export function relationshipLevel(hearts) {
  const index = RELATIONSHIP_LEVELS.findIndex((level) => hearts >= level.min);
  const level = RELATIONSHIP_LEVELS[index === -1 ? RELATIONSHIP_LEVELS.length - 1 : index];
  const higher = index > 0 ? RELATIONSHIP_LEVELS[index - 1] : null;
  return { emoji: level.emoji, name: level.name, next: higher ? higher.min : null };
}

/** A member left the server: the marriage ends, both accounts stay as they are. */
export async function endMarriageOnLeave(guildId, userId) {
  if (!(await getSpouseId(guildId, userId))) return null;
  return divorce(guildId, userId);
}
