// economyJobs.js — jobs of /work.
//
// The first /work offers 3 jobs picked for the member's server level (leveling module):
// the higher the level, the better the pay, up to the CEO at level 100 ($100-$300 a shift).
// A job lasts JOB_SHIFTS shifts; after the last one the next /work offers 3 new jobs.
// Per member economy data: `job: { id, shiftsLeft }`, `jobOffers: [jobId, ...]`,
// `workStreak` (shifts since the last full break, see the Overtime upgrade).

import { getUserLevelData } from './leveling/leveling.js';
import { logger } from '../utils/logger.js';
import { t } from '../i18n/index.js';

export const JOB_SHIFTS = 5;
export const OFFER_COUNT = 3;
// Offers come from the best OFFER_POOL jobs the member's level allows.
const OFFER_POOL = 5;

// Pay per shift before upgrades, items and the server multiplier.
export const JOBS = Object.freeze([
  { id: 'flyers', emoji: '🗞️', name: t('Flyer distributor'), level: 0, min: 10, max: 35 },
  { id: 'dishwasher', emoji: '🍽️', name: t('Dishwasher'), level: 0, min: 12, max: 32 },
  { id: 'cleaner', emoji: '🧹', name: t('Cleaner'), level: 0, min: 10, max: 38 },
  { id: 'cashier', emoji: '🛒', name: t('Cashier'), level: 5, min: 15, max: 50 },
  { id: 'barista', emoji: '☕', name: t('Barista'), level: 10, min: 20, max: 60 },
  { id: 'courier', emoji: '📦', name: t('Courier'), level: 15, min: 25, max: 70 },
  { id: 'warehouse', emoji: '🏭', name: t('Warehouse worker'), level: 20, min: 30, max: 85 },
  { id: 'mechanic', emoji: '🔧', name: t('Mechanic'), level: 25, min: 35, max: 100 },
  { id: 'electrician', emoji: '⚡', name: t('Electrician'), level: 30, min: 40, max: 120 },
  { id: 'designer', emoji: '🎨', name: t('Graphic designer'), level: 40, min: 50, max: 140 },
  { id: 'programmer', emoji: '💻', name: t('Programmer'), level: 50, min: 60, max: 165 },
  { id: 'youtuber', emoji: '🎬', name: 'YouTuber', level: 60, min: 70, max: 190 },
  { id: 'doctor', emoji: '🩺', name: t('Doctor'), level: 70, min: 75, max: 215 },
  { id: 'pilot', emoji: '✈️', name: t('Pilot'), level: 80, min: 85, max: 240 },
  { id: 'lawyer', emoji: '⚖️', name: t('Lawyer'), level: 90, min: 90, max: 270 },
  { id: 'ceo', emoji: '👔', name: t('CEO'), level: 100, min: 100, max: 300 },
]);

const BY_ID = new Map(JOBS.map((job) => [job.id, job]));
export const getJob = (id) => BY_ID.get(id) ?? null;

/** The member's level in the server's leveling module (0 when it has none). */
export async function getServerLevel(client, guildId, userId) {
  try {
    return (await getUserLevelData(client, guildId, userId)).level || 0;
  } catch (error) {
    logger.warn(`[ECONOMY] Could not read the level of ${userId} for /work offers: ${error.message}`);
    return 0;
  }
}

/** 3 different jobs for `level`, cheapest first. `random` is replaceable in tests. */
export function pickOffers(level, random = Math.random) {
  const open = JOBS.filter((job) => job.level <= level);
  const pool = open.slice(-OFFER_POOL);
  const offers = [];
  while (offers.length < OFFER_COUNT && pool.length > 0) {
    offers.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  }
  return offers.sort((a, b) => a.min - b.min || a.max - b.max);
}

/** The member's current job, or null when they have none or its shifts are used up. */
export function activeJob(userData) {
  const job = getJob(userData?.job?.id);
  return job && (userData.job.shiftsLeft || 0) > 0 ? job : null;
}

/** The stored offers (fresh ones for `level` when none are stored). Mutates `userData`. */
export function ensureOffers(userData, level, random = Math.random) {
  const stored = (Array.isArray(userData.jobOffers) ? userData.jobOffers : []).map(getJob).filter(Boolean);
  if (stored.length === OFFER_COUNT) return stored;
  const offers = pickOffers(level, random);
  userData.jobOffers = offers.map((job) => job.id);
  return offers;
}

/** Sign the contract for one of the offered jobs. Returns the job, or null when it was not offered. */
export function takeJob(userData, jobId) {
  if (!Array.isArray(userData.jobOffers) || !userData.jobOffers.includes(jobId)) return null;
  const job = getJob(jobId);
  if (!job) return null;
  userData.job = { id: job.id, shiftsLeft: JOB_SHIFTS };
  userData.jobOffers = [];
  return job;
}

export const randomPay = (job, random = Math.random) => job.min + Math.floor(random() * (job.max - job.min + 1));
