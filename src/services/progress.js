// progress.js — what members do in the economy (2026-10-26, owner: missions, achievements and badges).
//
//   stats:        { work: 12, fish: 40, earned: 51200, ... } counters, only ever go up
//   missions:     { daily: { period, list, rerolled }, weekly: { ... } }
//                 three daily missions (new every Warsaw midnight) and three weekly ones (Monday)
//   achievements: { [id]: unlockedAt } badges, each with a one-time reward
//
// Every earning command calls recordProgress() with what happened before it saves the member's
// data, and adds progressEmbeds() to its reply. A finished mission pays at once; all three
// missions of a day give a free Starter pack, all three of a week a free Collector pack.
// Rewards follow the server's earnings multiplier (no Fortune). Views: /misje and /osiagniecia.

import { t } from '../i18n/index.js';
import { createEmbed } from '../utils/embeds.js';
import { dayKey, nextMidnight, nextWeekStart, weekKey } from '../utils/warsawTime.js';
import { money, scaleEarnings } from './economySettings.js';
import {
  CARDS, FISH, addTo, getPack, hasAllCards, hasAllFish, hasAny, indexKey, parseIndexKey, rollCard,
} from './collections.js';

// ---------------------------------------------------------------- stats

export const stat = (userData, key) => Math.max(0, Number(userData?.stats?.[key]) || 0);

/** Fish caught ever: the /index record knows catches from before the stats existed. */
const fishCaught = (userData) => Math.max(stat(userData, 'fish'),
  Object.values(userData?.fishIndex ?? {}).reduce((sum, count) => sum + (Number(count) || 0), 0));
const legendaryFish = (userData) => Math.max(stat(userData, 'fishLegendary'),
  Object.entries(userData?.fishIndex ?? {}).filter(([key, count]) =>
    count > 0 && FISH.find((fish) => fish.id === parseIndexKey(key).id)?.rarity === 'legendary').length > 0 ? 1 : 0);
const netWorth = (userData) => (Number(userData?.wallet) || 0) + (Number(userData?.bank) || 0);
const maxedUpgrade = (userData) => Object.values(userData?.upgrades ?? {}).some((level) => level >= 10);

// ---------------------------------------------------------------- missions

// goal [min, max] is rolled when the mission is handed out; reward grows with the goal.
// `text` gets the goal; `stat` is the counter that moves it.
export const MISSIONS = {
  daily: [
    { id: 'work', stat: 'work', goal: [3, 4], reward: 450, text: (goal) => t`Work ${goal} shifts with \`/work\`` },
    { id: 'fish', stat: 'fish', goal: [3, 4], reward: 450, text: (goal) => t`Catch ${goal} fish with \`/fish\`` },
    { id: 'nagraj', stat: 'nagraj', goal: [3, 4], reward: 450, text: (goal) => t`Record ${goal} videos with \`/nagraj\`` },
    { id: 'beg', stat: 'beg', goal: [3, 5], reward: 250, text: (goal) => t`Beg ${goal} times with \`/beg\`` },
    { id: 'casino', stat: 'casino', goal: [4, 6], reward: 250, text: (goal) => t`Play ${goal} casino games` },
    { id: 'casinoWin', stat: 'casinoWin', goal: [2, 3], reward: 600, text: (goal) => t`Win ${goal} casino games` },
    { id: 'crimeWin', stat: 'crimeWin', goal: [1, 2], reward: 1200, text: (goal) => t`Pull off ${goal} successful \`/crime\`` },
    { id: 'earned', stat: 'earned', goal: [2_500, 4_000], reward: 0.5, text: (goal, guildId) => t`Earn ${money(guildId, goal)} from jobs` },
    { id: 'pack', stat: 'packs', goal: [1, 1], reward: 1000, text: () => t('Open a pack with `/paczka`') },
    { id: 'wordle', stat: 'wordle', goal: [1, 1], reward: 1500, text: () => t('Solve today\'s `/wordle`') },
    { id: 'quiz', stat: 'quiz', goal: [1, 1], reward: 1500, text: () => t('Answer a quiz question first') },
    { id: 'rareFish', stat: 'fishRare', goal: [1, 1], reward: 1500, text: () => t('Catch a rare or better fish') },
  ],
  weekly: [
    { id: 'work', stat: 'work', goal: [20, 30], reward: 450, text: (goal) => t`Work ${goal} shifts with \`/work\`` },
    { id: 'fish', stat: 'fish', goal: [15, 25], reward: 500, text: (goal) => t`Catch ${goal} fish with \`/fish\`` },
    { id: 'nagraj', stat: 'nagraj', goal: [15, 25], reward: 500, text: (goal) => t`Record ${goal} videos with \`/nagraj\`` },
    { id: 'casino', stat: 'casino', goal: [30, 50], reward: 200, text: (goal) => t`Play ${goal} casino games` },
    { id: 'casinoWin', stat: 'casinoWin', goal: [12, 20], reward: 600, text: (goal) => t`Win ${goal} casino games` },
    { id: 'earned', stat: 'earned', goal: [40_000, 60_000], reward: 0.3, text: (goal, guildId) => t`Earn ${money(guildId, goal)} from jobs` },
    { id: 'packs', stat: 'packs', goal: [4, 6], reward: 1500, text: (goal) => t`Open ${goal} packs with \`/paczka\`` },
    { id: 'crimeWin', stat: 'crimeWin', goal: [6, 10], reward: 1200, text: (goal) => t`Pull off ${goal} successful \`/crime\`` },
    { id: 'robWin', stat: 'robWin', goal: [2, 4], reward: 3000, text: (goal) => t`Rob someone successfully ${goal} times` },
    { id: 'wordle', stat: 'wordle', goal: [4, 6], reward: 2500, text: (goal) => t`Solve \`/wordle\` ${goal} times` },
    { id: 'quiz', stat: 'quiz', goal: [3, 5], reward: 2500, text: (goal) => t`Win ${goal} quiz questions` },
    { id: 'viral', stat: 'videoViral', goal: [2, 3], reward: 5000, text: (goal) => t`Record ${goal} epic or legendary videos` },
    { id: 'trade', stat: 'trades', goal: [1, 2], reward: 4000, text: (goal) => t`Finish ${goal} trades with \`/wymiana\`` },
  ],
};
export const MISSIONS_PER_PERIOD = 3;
// A finished set of missions gives a free pack (opened at once, cards go to /index).
export const BONUS_PACKS = { daily: 'startowa', weekly: 'kolekcjonera' };

const periodOf = (scope, now) => (scope === 'daily' ? dayKey(now) : weekKey(now));
export const periodEnd = (scope, now = Date.now()) => (scope === 'daily' ? nextMidnight(now) : nextWeekStart(now));
const missionDef = (scope, id) => MISSIONS[scope].find((mission) => mission.id === id) ?? null;

const roll = ([min, max], random) => min + Math.floor(random() * (max - min + 1));
// Big goals read better rounded: 3,217 -> 3,200.
const tidy = (value) => (value >= 1000 ? Math.round(value / 100) * 100 : value);

/** Reward before the server multiplier: per unit of the goal, or a share of the goal for money goals. */
const baseReward = (def, goal) => Math.round(def.reward < 1 ? goal * def.reward : def.reward * goal);

function newMission(scope, def, random) {
  const goal = tidy(roll(def.goal, random));
  return { id: def.id, goal, reward: baseReward(def, goal), progress: 0, done: false };
}

function pickMissions(scope, random, exclude = []) {
  const pool = MISSIONS[scope].filter((def) => !exclude.includes(def.id));
  const picked = [];
  while (picked.length < MISSIONS_PER_PERIOD && pool.length) {
    picked.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  }
  return picked.map((def) => newMission(scope, def, random));
}

/** Hand out new missions when a day or week has passed. Mutates `userData`; returns the missions. */
export function ensureMissions(userData, now = Date.now(), random = Math.random) {
  const missions = { ...(userData.missions ?? {}) };
  for (const scope of ['daily', 'weekly']) {
    const period = periodOf(scope, now);
    const current = missions[scope];
    if (current?.period === period && Array.isArray(current.list)) continue;
    missions[scope] = { period, list: pickMissions(scope, random), rerolled: false, bonus: false };
  }
  userData.missions = missions;
  return missions;
}

/** Text of a stored mission. */
export function missionText(scope, mission, guildId) {
  const def = missionDef(scope, mission.id);
  return def ? def.text(mission.goal, guildId) : mission.id;
}

/** One free swap per period: replaces the unfinished mission at `index`. Returns the new one or null. */
export function rerollMission(userData, scope, index, now = Date.now(), random = Math.random) {
  ensureMissions(userData, now, random);
  const state = userData.missions[scope];
  const old = state?.list?.[index];
  if (!old || old.done || state.rerolled) return null;
  const [replacement] = pickMissions(scope, random, state.list.map((mission) => mission.id));
  if (!replacement) return null;
  const list = [...state.list];
  list[index] = replacement;
  userData.missions = { ...userData.missions, [scope]: { ...state, list, rerolled: true } };
  return replacement;
}

// ---------------------------------------------------------------- achievements

// reward: paid once when the badge is unlocked (times the server multiplier).
// progress(userData) -> [current, goal] for the list of locked badges.
const counter = (key, goal) => (userData) => [Math.min(goal, stat(userData, key)), goal];
export const ACHIEVEMENTS = [
  { id: 'first_fish', emoji: '🎣', name: t('First catch'), description: t('Catch your first fish.'), reward: 500, progress: (u) => [Math.min(1, fishCaught(u)), 1] },
  { id: 'fisher', emoji: '🐟', name: t('Angler'), description: t('Catch 100 fish.'), reward: 5000, progress: (u) => [Math.min(100, fishCaught(u)), 100] },
  { id: 'sea_legend', emoji: '🐋', name: t('Legend of the seas'), description: t('Catch a legendary fish.'), reward: 5000, progress: (u) => [legendaryFish(u), 1] },
  { id: 'full_fish', emoji: '📖', name: t('Fish atlas'), description: t('Catch every fish species.'), reward: 10000, progress: (u) => [FISH.filter((fish) => hasAny(u?.fishIndex, fish.id)).length, FISH.length] },
  { id: 'first_video', emoji: '🎬', name: t('First upload'), description: t('Record your first video.'), reward: 500, progress: counter('nagraj', 1) },
  { id: 'youtuber', emoji: '📹', name: t('YouTuber'), description: t('Record 100 videos.'), reward: 5000, progress: counter('nagraj', 100) },
  { id: 'viral', emoji: '🔥', name: t('Gone viral'), description: t('Record a legendary video.'), reward: 5000, progress: counter('videoLegendary', 1) },
  { id: 'collector', emoji: '🃏', name: t('Collector'), description: t('Hold every Club\'o\'mony card at once.'), reward: 15000, progress: (u) => [CARDS.filter((card) => hasAny(u?.cards, card.id)).length, CARDS.length] },
  { id: 'hard_worker', emoji: '💼', name: t('Hard worker'), description: t('Work 100 shifts.'), reward: 5000, progress: counter('work', 100) },
  { id: 'gambler', emoji: '🎰', name: t('Gambler'), description: t('Play 100 casino games.'), reward: 3000, progress: counter('casino', 100) },
  { id: 'jackpot', emoji: '💎', name: t('Jackpot'), description: t('Hit the slots jackpot.'), reward: 5000, progress: counter('jackpot', 1) },
  { id: 'lucky_number', emoji: '🎯', name: t('Lucky number'), description: t('Win a roulette bet on one number.'), reward: 5000, progress: counter('rouletteNumber', 1) },
  { id: 'natural', emoji: '♠️', name: t('Blackjack!'), description: t('Get a blackjack.'), reward: 1000, progress: counter('blackjackNatural', 1) },
  { id: 'criminal', emoji: '🦹', name: t('Career criminal'), description: t('Pull off 25 successful crimes.'), reward: 5000, progress: counter('crimeWin', 25) },
  { id: 'jailbird', emoji: '🚔', name: t('Jailbird'), description: t('Go to jail 5 times.'), reward: 1000, progress: counter('jail', 5) },
  { id: 'thief', emoji: '🥷', name: t('Master thief'), description: t('Rob someone successfully 10 times.'), reward: 5000, progress: counter('robWin', 10) },
  { id: 'lawyer', emoji: '⚖️', name: t('Lawyer'), description: t('Win 3 lawsuits.'), reward: 3000, progress: counter('sueWin', 3) },
  { id: 'rich', emoji: '💵', name: t('Well off'), description: t('Have 100,000 in cash and bank.'), reward: 5000, progress: (u) => [Math.min(100_000, netWorth(u)), 100_000] },
  { id: 'millionaire', emoji: '🤑', name: t('Millionaire'), description: t('Have 1,000,000 in cash and bank.'), reward: 25000, progress: (u) => [Math.min(1_000_000, netWorth(u)), 1_000_000] },
  { id: 'wordle_master', emoji: '🟩', name: t('Wordle master'), description: t('Solve Wordle in 2 guesses or fewer.'), reward: 5000, progress: (u) => [stat(u, 'wordleBest') > 0 && stat(u, 'wordleBest') <= 2 ? 1 : 0, 1] },
  { id: 'wordle_streak', emoji: '📅', name: t('Wordle week'), description: t('Solve Wordle 7 days in a row.'), reward: 5000, progress: (u) => [Math.min(7, Math.max(stat(u, 'wordleBestStreak'), Number(u?.wordle?.streak) || 0)), 7] },
  { id: 'quiz_master', emoji: '🧠', name: t('Big brain'), description: t('Win 25 quiz questions.'), reward: 5000, progress: counter('quiz', 25) },
  { id: 'trader', emoji: '🤝', name: t('Trader'), description: t('Finish 5 trades.'), reward: 3000, progress: counter('trades', 5) },
  { id: 'missionary', emoji: '🎯', name: t('On a mission'), description: t('Finish 50 missions.'), reward: 10000, progress: counter('missions', 50) },
  { id: 'married', emoji: '💍', name: t('For better or worse'), description: t('Get married with `/slub`.'), reward: 2000, progress: (u) => [u?._joint?.partnerId || stat(u, 'married') ? 1 : 0, 1] },
  { id: 'maxed', emoji: '⬆️', name: t('Maxed out'), description: t('Take any upgrade to level 10.'), reward: 5000, progress: (u) => [maxedUpgrade(u) ? 1 : 0, 1] },
];
const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENTS.map((achievement) => [achievement.id, achievement]));
export const getAchievement = (id) => ACHIEVEMENT_BY_ID.get(id) ?? null;

export const isUnlocked = (userData, id) => Boolean(userData?.achievements?.[id]);
export const unlockedCount = (userData) => ACHIEVEMENTS.filter((achievement) => isUnlocked(userData, achievement.id)).length;

/** Badges reached but not yet given: gives them and pays their rewards. Mutates `userData`. */
export function checkAchievements(userData, settings, now = Date.now()) {
  const unlocked = [];
  for (const achievement of ACHIEVEMENTS) {
    if (isUnlocked(userData, achievement.id)) continue;
    const [current, goal] = achievement.progress(userData);
    if (current < goal) continue;
    const reward = scaleEarnings(settings, achievement.reward);
    userData.achievements = { ...(userData.achievements ?? {}), [achievement.id]: now };
    userData.wallet = (Number(userData.wallet) || 0) + reward;
    unlocked.push({ achievement, reward });
  }
  return unlocked;
}

// ---------------------------------------------------------------- recording

// Older tests check exact balances, so the test run keeps progress off unless a test turns it on.
export const progressOptions = { enabled: process.env.NODE_ENV !== 'test' };

function openBonusPack(userData, packId, random) {
  const pack = getPack(packId);
  const drawn = [];
  for (let index = 0; index < pack.cards; index += 1) {
    const card = rollCard(pack, random);
    const isNew = !hasAny(userData.cards, card.card.id);
    userData.cards = addTo(userData.cards, indexKey(card.card.id, card.variant));
    drawn.push({ ...card, isNew });
  }
  return { pack, drawn };
}

/**
 * Count what happened (`events`: { work: 1, earned: 420, ... }), move missions, hand out badges.
 * Mutates `userData` (rewards go to cash); call it before saving. Returns what to tell the member.
 */
export function recordProgress(userData, events, { settings, now = Date.now(), random = Math.random } = {}) {
  const result = { missions: [], bonuses: [], achievements: [] };
  if (!userData || !progressOptions.enabled) return result;

  const stats = { ...(userData.stats ?? {}) };
  for (const [key, value] of Object.entries(events ?? {})) {
    const amount = Math.floor(Number(value) || 0);
    if (amount > 0) stats[key] = (Number(stats[key]) || 0) + amount;
  }
  // Best values (not added up).
  if (events?.wordleGuesses > 0) {
    stats.wordleBest = stats.wordleBest > 0 ? Math.min(stats.wordleBest, events.wordleGuesses) : events.wordleGuesses;
  }
  if (events?.wordleStreak > 0) stats.wordleBestStreak = Math.max(Number(stats.wordleBestStreak) || 0, events.wordleStreak);
  delete stats.wordleGuesses;
  delete stats.wordleStreak;
  userData.stats = stats;

  ensureMissions(userData, now, random);
  for (const scope of ['daily', 'weekly']) {
    const state = userData.missions[scope];
    let changed = false;
    const list = state.list.map((mission) => {
      const def = missionDef(scope, mission.id);
      const amount = def ? Math.floor(Number(events?.[def.stat]) || 0) : 0;
      if (mission.done || amount <= 0) return mission;
      changed = true;
      const progress = Math.min(mission.goal, (mission.progress || 0) + amount);
      if (progress < mission.goal) return { ...mission, progress };
      const reward = scaleEarnings(settings, mission.reward);
      userData.wallet = (Number(userData.wallet) || 0) + reward;
      userData.stats.missions = (Number(userData.stats.missions) || 0) + 1;
      result.missions.push({ scope, mission: { ...mission, progress }, reward });
      return { ...mission, progress, done: true };
    });
    if (!changed) continue;
    const next = { ...state, list };
    if (!state.bonus && list.every((mission) => mission.done)) {
      next.bonus = true;
      result.bonuses.push({ scope, ...openBonusPack(userData, BONUS_PACKS[scope], random) });
    }
    userData.missions = { ...userData.missions, [scope]: next };
  }

  result.achievements = checkAchievements(userData, settings, now);
  return result;
}

export const hasNews = (result) => Boolean(result && (result.missions.length || result.bonuses.length || result.achievements.length));

/** A small embed under a command's answer with finished missions, free packs and new badges; [] when nothing happened. */
export function progressEmbeds(result, guildId) {
  if (!hasNews(result)) return [];
  const lines = [];
  for (const { scope, mission, reward } of result.missions) {
    const label = scope === 'daily' ? t('Daily mission done') : t('Weekly mission done');
    lines.push(t`🎯 **${label}:** ${missionText(scope, mission, guildId)} · **+${money(guildId, reward)}**`);
  }
  for (const { scope, pack, drawn } of result.bonuses) {
    const cards = drawn.map(({ card, variant, isNew }) => `${variant.emoji || card.emoji} ${card.name}${isNew ? ' 🆕' : ''}`).join(', ');
    lines.push(scope === 'daily'
      ? t`🎁 **All daily missions done!** Free ${pack.emoji} pack: ${cards}`
      : t`🎁 **All weekly missions done!** Free ${pack.emoji} pack: ${cards}`);
  }
  for (const { achievement, reward } of result.achievements) {
    lines.push(t`🏅 **New badge:** ${achievement.emoji} ${achievement.name}${reward > 0 ? ` · **+${money(guildId, reward)}**` : ''}`);
  }
  return [createEmbed({ description: lines.join('\n'), color: '#F1C40F', footer: false })];
}

/** Record and return the embeds in one go, for commands that only need the note. */
export function trackAndNote(userData, events, { settings, guildId, now, random } = {}) {
  return progressEmbeds(recordProgress(userData, events, { settings, now, random }), guildId);
}
