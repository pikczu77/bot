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
import { UPGRADES, getUpgradeLevel } from './economyUpgrades.js';
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
// Own money only: for a married member `bank` is the joint bank, and marrying someone rich earns no badge.
const netWorth = (userData) => (Number(userData?.wallet) || 0) + (Number(userData?._joint?.ownBank ?? userData?.bank) || 0);
const upgradesAtTop = (userData) => UPGRADES.filter((upgrade) => getUpgradeLevel(userData, upgrade.id) >= upgrade.maxLevel).length;
const hasDiamond = (userData) => [userData?.fishIndex, userData?.cards]
  .some((map) => Object.entries(map ?? {}).some(([key, count]) => count > 0 && key.endsWith(':diamond')));

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
    { id: 'heist', stat: 'heist', goal: [1, 1], reward: 1200, text: () => t('Take part in a `/napad` heist') },
    { id: 'duelWin', stat: 'duelWin', goal: [1, 1], reward: 1200, text: () => t('Win a duel with `/pojedynek`') },
    { id: 'drop', stat: 'drop', goal: [1, 1], reward: 600, text: () => t('Catch a chat drop first') },
    { id: 'stocks', stat: 'stockTrades', goal: [1, 2], reward: 400, text: (goal) => t`Make ${goal} {0|trade|trades} on \`/gielda\`` },
    { id: 'rent', stat: 'propertyCollect', goal: [1, 1], reward: 500, text: () => t('Collect rent with `/nieruchomosci odbierz`') },
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
    { id: 'heistWin', stat: 'heistWin', goal: [2, 3], reward: 3000, text: (goal) => t`Pull off ${goal} successful \`/napad\` heists` },
    // A ticket costs 500 by default, so the mission pays back a part of it, not more.
    { id: 'lottery', stat: 'lotteryTickets', goal: [3, 5], reward: 300, text: (goal) => t`Buy ${goal} lottery tickets with \`/loteria kup\`` },
    { id: 'duelWin', stat: 'duelWin', goal: [3, 5], reward: 1200, text: (goal) => t`Win ${goal} duels with \`/pojedynek\`` },
    // Pays a small part of the deposit back, so it never makes money from nothing.
    { id: 'clubDeposit', stat: 'clubDeposit', goal: [5_000, 10_000], reward: 0.2, text: (goal, guildId) => t`Put ${money(guildId, goal)} into your club treasury (\`/klub wplac\`)` },
    { id: 'stockProfit', stat: 'stockProfit', goal: [2_000, 5_000], reward: 0.5, text: (goal, guildId) => t`Make ${money(guildId, goal)} profit on \`/gielda\`` },
    { id: 'rent', stat: 'propertyIncome', goal: [5_000, 10_000], reward: 0.2, text: (goal, guildId) => t`Collect ${money(guildId, goal)} of rent from \`/nieruchomosci\`` },
  ],
};
export const MISSIONS_PER_PERIOD = 3;
// A finished set of missions gives a free pack (opened at once, cards go to /index).
export const BONUS_PACKS = { daily: 'startowa', weekly: 'kolekcjonera' };

/** Missions on in the server's economy settings (panel: Ekonomia > Gry). */
export const missionsEnabled = (settings) => settings?.missions?.enabled !== false;

/** What a mission pays: its reward x the panel's mission percent x the server multiplier. */
export function missionReward(settings, mission) {
  const percent = Number(settings?.missions?.rewardPercent ?? 100);
  return scaleEarnings(settings, Math.round((Number(mission.reward) || 0) * (Number.isFinite(percent) ? percent : 100) / 100));
}

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
const worth = (goal) => (userData) => [Math.min(goal, netWorth(userData)), goal];
const prestigeLevel = (goal) => (userData) => [Math.min(goal, Number(userData?.prestige) || 0), goal];
const dailyInARow = (goal) => (userData) => [Math.min(goal, Math.max(stat(userData, 'dailyBestStreak'), Number(userData?.dailyStreak) || 0)), goal];

// Holiday badges have their own section in /osiagniecia (owner, 2026-10-30). They show from `startsAt`, the event's first day
// (owner: "niech narazie inne nie beda wyswietlane"), to `endsAt`, the day after its last day; an earned one always shows.
const dayAfter = (year, month, day) => Date.UTC(year, month - 1, day + 1);
const firstDay = (year, month, day) => Date.UTC(year, month - 1, day);
const eventBadge = ({ id, emoji, name, description, reward = 2000, field, year, goal = 1000, startsAt, endsAt }) => ({
  id, emoji, name, description, reward, section: 'event', startsAt, endsAt,
  progress: (userData) => [Math.min(goal, userData?.[field]?.year === year ? Number(userData[field].earned) || 0 : 0), goal],
});
// Pressing the "2026" button in the event section gives it (claimYearBadge in modules/progress_view.js).
export const YEAR_BADGE = 'year_2026';

export const ACHIEVEMENTS = [
  { id: 'first_fish', emoji: '🎣', name: t('First catch'), description: t('Catch your first fish.'), reward: 500, progress: (u) => [Math.min(1, fishCaught(u)), 1] },
  { id: 'fisher', emoji: '🐟', name: t('Angler'), description: t('Catch 100 fish.'), reward: 5000, progress: (u) => [Math.min(100, fishCaught(u)), 100] },
  { id: 'sea_wolf', emoji: '🦈', name: t('Old sea dog'), description: t('Catch 100 rare or better fish.'), reward: 5000, progress: counter('fishRare', 100) },
  { id: 'sea_legend', emoji: '🐋', name: t('Legend of the seas'), description: t('Catch a legendary fish.'), reward: 5000, progress: (u) => [legendaryFish(u), 1] },
  { id: 'full_fish', emoji: '📖', name: t('Fish atlas'), description: t('Catch every fish species.'), reward: 10000, progress: (u) => [FISH.filter((fish) => hasAny(u?.fishIndex, fish.id)).length, FISH.length] },
  { id: 'first_video', emoji: '🎬', name: t('First upload'), description: t('Record your first video.'), reward: 500, progress: counter('nagraj', 1) },
  { id: 'youtuber', emoji: '📹', name: t('YouTuber'), description: t('Record 100 videos.'), reward: 5000, progress: counter('nagraj', 100) },
  { id: 'yt_star', emoji: '📺', name: t('YouTube star'), description: t('Record 25 epic or legendary videos.'), reward: 10000, progress: counter('videoViral', 25) },
  { id: 'viral', emoji: '🔥', name: t('Gone viral'), description: t('Record a legendary video.'), reward: 5000, progress: counter('videoLegendary', 1) },
  { id: 'pack_addict', emoji: '📦', name: t('Pack addict'), description: t('Open 100 packs.'), reward: 5000, progress: counter('packs', 100) },
  { id: 'merger', emoji: '🔨', name: t('Card smith'), description: t('Merge cards 10 times with `/polacz`.'), reward: 3000, progress: counter('merges', 10) },
  { id: 'diamond_luck', emoji: '💠', name: t('Diamond luck'), description: t('Get a diamond fish or a diamond card.'), reward: 5000, progress: (u) => [hasDiamond(u) ? 1 : 0, 1] },
  { id: 'king_pikczu', emoji: '🤴', name: t('King Pikczu'), description: t('Hold the Król Pikczu card.'), reward: 10000, progress: (u) => [hasAny(u?.cards, 'krolpikczu') ? 1 : 0, 1] },
  { id: 'collector', emoji: '🃏', name: t('Collector'), description: t('Hold every Club\'o\'mony card at once.'), reward: 15000, progress: (u) => [CARDS.filter((card) => hasAny(u?.cards, card.id)).length, CARDS.length] },
  { id: 'trader', emoji: '🤝', name: t('Trader'), description: t('Finish 5 trades.'), reward: 3000, progress: counter('trades', 5) },
  { id: 'hard_worker', emoji: '💼', name: t('Hard worker'), description: t('Work 100 shifts.'), reward: 5000, progress: counter('work', 100) },
  { id: 'beg_king', emoji: '🥫', name: t('King of beggars'), description: t('Beg 100 times with `/beg`.'), reward: 3000, progress: counter('beg', 100) },
  { id: 'job_million', emoji: '💪', name: t('Hard-earned million'), description: t('Earn 1,000,000 from jobs.'), reward: 25000, progress: counter('earned', 1_000_000) },
  { id: 'gambler', emoji: '🎰', name: t('Gambler'), description: t('Play 100 casino games.'), reward: 3000, progress: counter('casino', 100) },
  { id: 'card_sharp', emoji: '🤵', name: t('Card sharp'), description: t('Win 500 casino games.'), reward: 10000, progress: counter('casinoWin', 500) },
  { id: 'natural', emoji: '♠️', name: t('Blackjack!'), description: t('Get a blackjack.'), reward: 1000, progress: counter('blackjackNatural', 1) },
  { id: 'hot_hand', emoji: '♨️', name: t('Hot hand'), description: t('Win 10 casino games in a row.'), reward: 10000, progress: counter('casinoBestStreak', 10) },
  { id: 'unlucky', emoji: '🌧️', name: t('Unlucky'), description: t('Lose 10 casino games in a row.'), reward: 5000, progress: counter('casinoBestLossStreak', 10) },
  { id: 'whale', emoji: '🐳', name: t('Whale'), description: t('Win 100,000 or more in one casino game.'), reward: 10000, progress: counter('casinoBiggestWin', 100_000) },
  { id: 'jackpot', emoji: '💎', name: t('Jackpot'), description: t('Hit the slots jackpot.'), reward: 5000, progress: counter('jackpot', 1) },
  { id: 'lucky_number', emoji: '🎯', name: t('Lucky number'), description: t('Win a roulette bet on one number.'), reward: 5000, progress: counter('rouletteNumber', 1) },
  { id: 'lottery_win', emoji: '🎟️', name: t('Lucky ticket'), description: t('Win the weekly lottery.'), reward: 2000, progress: counter('lotteryWin', 1) },
  { id: 'criminal', emoji: '🦹', name: t('Career criminal'), description: t('Pull off 25 successful crimes.'), reward: 5000, progress: counter('crimeWin', 25) },
  { id: 'jailbird', emoji: '🚔', name: t('Jailbird'), description: t('Go to jail 5 times.'), reward: 1000, progress: counter('jail', 5) },
  { id: 'bail_10', emoji: '🔓', name: t('Regular client'), description: t('Pay bail 10 times.'), reward: 3000, progress: counter('bail', 10) },
  { id: 'thief', emoji: '🥷', name: t('Master thief'), description: t('Rob someone successfully 10 times.'), reward: 5000, progress: counter('robWin', 10) },
  { id: 'robbed_10', emoji: '😵', name: t('Favourite target'), description: t('Get robbed 10 times.'), reward: 3000, progress: counter('robbed', 10) },
  { id: 'lawyer', emoji: '⚖️', name: t('Lawyer'), description: t('Win 3 lawsuits.'), reward: 3000, progress: counter('sueWin', 3) },
  { id: 'heist_crew', emoji: '💣', name: t('The crew'), description: t('Pull off 10 successful `/napad` heists.'), reward: 10000, progress: counter('heistWin', 10) },
  { id: 'heist_bank', emoji: '🏛️', name: t('Heist of the century'), description: t('Pull off a `/napad` on the bank.'), reward: 15000, progress: counter('heistBank', 1) },
  { id: 'rich', emoji: '💵', name: t('Well off'), description: t('Have 100,000 in cash and bank.'), reward: 5000, progress: worth(100_000) },
  { id: 'millionaire', emoji: '🤑', name: t('Millionaire'), description: t('Have 1,000,000 in cash and bank.'), reward: 25000, progress: worth(1_000_000) },
  { id: 'multimillionaire', emoji: '💰', name: t('Multimillionaire'), description: t('Have 10,000,000 in cash and bank.'), reward: 100000, progress: worth(10_000_000) },
  { id: 'wordle_master', emoji: '🟩', name: t('Wordle master'), description: t('Solve Wordle in 2 guesses or fewer.'), reward: 5000, progress: (u) => [stat(u, 'wordleBest') > 0 && stat(u, 'wordleBest') <= 2 ? 1 : 0, 1] },
  { id: 'wordle_streak', emoji: '📅', name: t('Wordle week'), description: t('Solve Wordle 7 days in a row.'), reward: 5000, progress: (u) => [Math.min(7, Math.max(stat(u, 'wordleBestStreak'), Number(u?.wordle?.streak) || 0)), 7] },
  { id: 'dictionary', emoji: '📚', name: t('Dictionary'), description: t('Solve `/wordle` 100 times.'), reward: 10000, progress: counter('wordle', 100) },
  { id: 'quiz_master', emoji: '🧠', name: t('Big brain'), description: t('Win 25 quiz questions.'), reward: 5000, progress: counter('quiz', 25) },
  { id: 'duelist', emoji: '⚔️', name: t('Duelist'), description: t('Win 10 duels.'), reward: 5000, progress: counter('duelWin', 10) },
  { id: 'chat_star', emoji: '💬', name: t('Chat star'), description: t('Answer the question of the day first 5 times.'), reward: 5000, progress: counter('questionWin', 5) },
  { id: 'drop_hunter', emoji: '🪂', name: t('Drop hunter'), description: t('Catch 25 chat drops.'), reward: 5000, progress: counter('drop', 25) },
  { id: 'level_10', emoji: '🎖️', name: t('Level 10'), description: t('Reach server level 10.'), reward: 2000, progress: counter('levelBest', 10) },
  { id: 'level_50', emoji: '🏵️', name: t('Level 50'), description: t('Reach server level 50.'), reward: 10000, progress: counter('levelBest', 50) },
  { id: 'level_100', emoji: '👑', name: t('Level 100'), description: t('Reach server level 100.'), reward: 50000, progress: counter('levelBest', 100) },
  { id: 'daily_week', emoji: '🗓️', name: t('Seven days straight'), description: t('Claim /daily 7 days in a row.'), reward: 1000, progress: dailyInARow(7) },
  { id: 'daily_month', emoji: '📆', name: t('Never missed a day'), description: t('Claim /daily 30 days in a row.'), reward: 10000, progress: dailyInARow(30) },
  { id: 'daily_100', emoji: '🏆', name: t('Daily regular'), description: t('Claim /daily 100 days in a row.'), reward: 25000, progress: dailyInARow(100) },
  { id: 'daily_sets', emoji: '✅', name: t('Full set'), description: t('Finish all daily missions 25 times.'), reward: 10000, progress: counter('dailySets', 25) },
  { id: 'missionary', emoji: '🧭', name: t('On a mission'), description: t('Finish 50 missions.'), reward: 10000, progress: counter('missions', 50) },
  { id: 'married', emoji: '💍', name: t('For better or worse'), description: t('Get married with `/slub`.'), reward: 2000, progress: (u) => [u?._joint?.partnerId || stat(u, 'married') ? 1 : 0, 1] },
  { id: 'club_member', emoji: '🛡️', name: t('Club member'), description: t('Join or found a club with `/klub`.'), reward: 1000, progress: (u) => [u?.club?.id || stat(u, 'clubJoin') ? 1 : 0, 1] },
  { id: 'league_champ', emoji: '🥇', name: t('League champion'), description: t('Be in the club that wins the week.'), reward: 10000, progress: counter('clubWeekWin', 1) },
  { id: 'broker', emoji: '🧾', name: t('Broker'), description: t('Make 100 trades on `/gielda`.'), reward: 5000, progress: counter('stockTrades', 100) },
  { id: 'stock_shark', emoji: '📈', name: t('Market shark'), description: t('Make 50,000 profit on the stock market.'), reward: 10000, progress: counter('stockProfit', 50_000) },
  { id: 'rentier', emoji: '🏦', name: t('Rentier'), description: t('Collect 250,000 of rent.'), reward: 10000, progress: counter('propertyIncome', 250_000) },
  { id: 'landlord', emoji: '🏘️', name: t('Landlord'), description: t('Own 3 buildings at once.'), reward: 5000, progress: (u) => [Math.min(3, Object.keys(u?.properties ?? {}).length), 3] },
  { id: 'castle', emoji: '🏰', name: t('Lord of the castle'), description: t('Buy the castle.'), reward: 25000, progress: (u) => [u?.properties?.zamek ? 1 : 0, 1] },
  // Six = PROPERTIES.length in services/properties.js (that file imports this one).
  { id: 'developer', emoji: '🏗️', name: t('Developer'), description: t('Own all 6 buildings at once.'), reward: 50000, progress: (u) => [Math.min(6, Object.keys(u?.properties ?? {}).length), 6] },
  // Owner, 2026-10-30: one whole upgrade at its top level (it was "any upgrade at level 10", and Luck has 15).
  { id: 'maxed', emoji: '⬆️', name: t('Maxed out'), description: t('Take one upgrade all the way to its top level.'), reward: 5000, progress: (u) => [upgradesAtTop(u) > 0 ? 1 : 0, 1] },
  { id: 'all_maxed', emoji: '🚀', name: t('Everything maxed'), description: t('Take every upgrade to its top level.'), reward: 100000, progress: (u) => [upgradesAtTop(u), UPGRADES.length] },
  { id: 'prestige_1', emoji: '⭐', name: t('Fresh start'), description: t('Do your first prestige with `/prestiz`.'), reward: 5000, progress: prestigeLevel(1) },
  { id: 'prestige_5', emoji: '🌠', name: t('Halfway there'), description: t('Reach prestige 5.'), reward: 25000, progress: prestigeLevel(5) },
  { id: 'prestige_10', emoji: '🌟', name: t('Server legend'), description: t('Reach prestige 10.'), reward: 100000, progress: prestigeLevel(10) },
  eventBadge({ id: 'halloween_2026', emoji: '🎃', name: t('Halloween 2026'), description: t('Collect 1,000 candies in the Halloween 2026 event.'), field: 'halloween', year: 2026, startsAt: firstDay(2026, 10, 29), endsAt: dayAfter(2026, 11, 2) }),
  eventBadge({ id: 'swieta_2026', emoji: '🎄', name: t('Christmas 2026'), description: t('Collect 1,000 gingerbread in the Christmas 2026 event.'), field: 'swieta', year: 2026, startsAt: firstDay(2026, 12, 19), endsAt: dayAfter(2026, 12, 29) }),
  eventBadge({ id: 'sylwester_2026', emoji: '🥂', name: t("New Year's Eve 2026"), description: t("Collect 1,000 fireworks in the New Year's Eve 2026 event."), field: 'sylwester', year: 2026, startsAt: firstDay(2026, 12, 30), endsAt: dayAfter(2027, 1, 2) }),
  eventBadge({ id: 'walentynki_2027', emoji: '💘', name: t("Valentine's Day 2027"), description: t("Collect 1,000 love letters in the Valentine's Day 2027 event."), field: 'walentynki', year: 2027, startsAt: firstDay(2027, 2, 12), endsAt: dayAfter(2027, 2, 16) }),
  eventBadge({ id: 'wielkanoc_2027', emoji: '🐣', name: t('Easter 2027'), description: t('Collect 1,000 eggs in the Easter 2027 event.'), field: 'wielkanoc', year: 2027, startsAt: firstDay(2027, 3, 25), endsAt: dayAfter(2027, 3, 29) }),
  eventBadge({ id: 'dzien_dziecka_2027', emoji: '🎈', name: t("Children's Day 2027"), description: t("Collect 1,000 lollipops in the Children's Day 2027 event."), field: 'dzien_dziecka', year: 2027, startsAt: firstDay(2027, 5, 29), endsAt: dayAfter(2027, 6, 2) }),
  // The summer lasts two months, so its goal is higher.
  eventBadge({ id: 'wakacje_2027', emoji: '🏖️', name: t('Summer holidays 2027'), description: t('Collect 5,000 seashells in the summer holidays 2027 event.'), reward: 5000, field: 'wakacje', year: 2027, goal: 5000, startsAt: firstDay(2027, 6, 26), endsAt: dayAfter(2027, 8, 31) }),
  { id: 'event_podium', emoji: '🎪', name: t('Event podium'), description: t('Finish in the top 3 of a holiday event.'), reward: 10000, section: 'event', progress: counter('eventPodium', 1) },
  { id: YEAR_BADGE, emoji: '🎉', name: t('Year 2026'), description: t('Press the 2026 button under this list.'), reward: 2000, section: 'event', endsAt: dayAfter(2026, 12, 31), progress: counter('year2026', 1) },
  // Last on purpose: it counts the badges unlocked by the same action.
  { id: 'badge_hunter', emoji: '🏅', name: t('Badge hunter'), description: t('Get 25 badges.'), reward: 25000, progress: (u) => [Math.min(25, unlockedCount(u)), 25] },
];
const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENTS.map((achievement) => [achievement.id, achievement]));
export const getAchievement = (id) => ACHIEVEMENT_BY_ID.get(id) ?? null;

export const isUnlocked = (userData, id) => Boolean(userData?.achievements?.[id]);
export const unlockedCount = (userData) => ACHIEVEMENTS.filter((achievement) => isUnlocked(userData, achievement.id)).length;
export const isEventBadge = (achievement) => achievement.section === 'event';

/** False for a holiday badge the member did not earn, when its time has not come or is over. */
export function badgeVisible(achievement, userData, now = Date.now()) {
  if (isUnlocked(userData, achievement.id)) return true;
  return now >= (achievement.startsAt ?? 0) && now < (achievement.endsAt ?? Infinity);
}

/** The badges of one section ('main' or 'event') that a member sees. */
export const visibleBadges = (userData, section, now = Date.now()) => ACHIEVEMENTS
  .filter((achievement) => isEventBadge(achievement) === (section === 'event') && badgeVisible(achievement, userData, now));

/** { got, total } over every badge the member sees, for /profil. */
export function badgeCount(userData, now = Date.now()) {
  const visible = ACHIEVEMENTS.filter((achievement) => badgeVisible(achievement, userData, now));
  return { got: visible.filter((achievement) => isUnlocked(userData, achievement.id)).length, total: visible.length };
}

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

/** Open a free pack into the member's cards (no money). Returns { pack, drawn }. */
export function openBonusPack(userData, packId, random = Math.random) {
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
  if (events?.dailyStreak > 0) stats.dailyBestStreak = Math.max(Number(stats.dailyBestStreak) || 0, events.dailyStreak);
  if (events?.level > 0) stats.levelBest = Math.max(Number(stats.levelBest) || 0, events.level);
  if (events?.casinoPayout > 0) stats.casinoBiggestWin = Math.max(Number(stats.casinoBiggestWin) || 0, events.casinoPayout);
  // Casino games in a row. These two go back to 0; a blackjack draw counts for neither side.
  if (events?.casino > 0 && !events.casinoDraw) {
    const won = events.casinoWin > 0;
    stats.casinoStreak = won ? (Number(stats.casinoStreak) || 0) + 1 : 0;
    stats.casinoLossStreak = won ? 0 : (Number(stats.casinoLossStreak) || 0) + 1;
    stats.casinoBestStreak = Math.max(Number(stats.casinoBestStreak) || 0, stats.casinoStreak);
    stats.casinoBestLossStreak = Math.max(Number(stats.casinoBestLossStreak) || 0, stats.casinoLossStreak);
  }
  delete stats.wordleGuesses;
  delete stats.wordleStreak;
  delete stats.dailyStreak;
  delete stats.level;
  delete stats.casinoPayout;
  delete stats.casinoDraw;
  userData.stats = stats;

  ensureMissions(userData, now, random);
  for (const scope of missionsEnabled(settings) ? ['daily', 'weekly'] : []) {
    const state = userData.missions[scope];
    let changed = false;
    const list = state.list.map((mission) => {
      const def = missionDef(scope, mission.id);
      const amount = def ? Math.floor(Number(events?.[def.stat]) || 0) : 0;
      if (mission.done || amount <= 0) return mission;
      changed = true;
      const progress = Math.min(mission.goal, (mission.progress || 0) + amount);
      if (progress < mission.goal) return { ...mission, progress };
      const reward = missionReward(settings, mission);
      userData.wallet = (Number(userData.wallet) || 0) + reward;
      userData.stats.missions = (Number(userData.stats.missions) || 0) + 1;
      result.missions.push({ scope, mission: { ...mission, progress }, reward });
      return { ...mission, progress, done: true };
    });
    if (!changed) continue;
    const next = { ...state, list };
    if (!state.bonus && list.every((mission) => mission.done)) {
      next.bonus = true;
      if (scope === 'daily') userData.stats.dailySets = (Number(userData.stats.dailySets) || 0) + 1;
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
