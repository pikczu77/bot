// seasonalEvents.js — holiday events with their own currency, shop and rank (2026-10-29).
// Halloween 2026 came first (owner: "zrobmy event halloween, ale ja chce z tego eventu duzo za pisanie ... boosty ...
// najdrozsza ranga Halloween 2026"), then "zrob odrazu swieta i wielkanoc": the same event for Christmas 2026 and Easter 2027.
// 2026-10-30 (owner picked "12,13" from my list): New Year's Eve, Valentine's Day (tied to /randka and /slub), Children's Day
// and the summer holidays; all events share one command, /event sklep|kup|zbierz|ranking|lista (commands/Economy/event.js).
// Same day (owner): "czatowe gierki byly za cukierki, tam 50 cukierkow itp", "do kazdej pracy dolicz po 5-10" (addSeasonReward).
//
// While an event runs every message on the server gives `perMessage` of its currency (at most once per `cooldownSeconds`,
// it needs two letters or a file) and a caught chat drop gives `dropCandies` more (services/chatEngagement.js). Every job
// gives `jobMin`..`jobMax`, a won quiz or Wordle `gameCandies`, the question of the day twice that. The
// currency buys boosts (services/boosts.js), a pack, money and, as the most expensive thing, the event's rank role (the
// picked one, else a role of that name, else the bot creates it). Earning stops at `endsAt`; the shop stays open
// SHOP_GRACE_MS longer. The announcement (picked channel, else the events channel, else the chat channel) is deleted at the
// end and the top three are posted. Each event is on by default and runs by itself in its days. Checked every minute.
//
// Store guild:{id}:<event.store> = { enabled, startsAt, endsAt, perMessage, cooldownSeconds, dropCandies, dailyAmount, jobMin, jobMax,
//   gameCandies, roleId, channelId, title, text, totals: { userId: earned }, announcement: { channelId, messageId, rev } | null,
//   finished, rev } (`rev` = SEASON_REV of the last save, see migrate).
// Member data: <event.dataKey> = { year, candies, earned } (the field is called candies for every event).

import { PermissionFlagsBits } from 'discord.js';
import { createEmbed } from '../utils/embeds.js';
import { guildStore } from '../utils/featureKit.js';
import { logger } from '../utils/logger.js';
import { getEconomyData, setEconomyData } from '../utils/economy.js';
import { enterLocale, t } from '../i18n/index.js';
import { dayKey, midnightOf } from '../utils/warsawTime.js';
import { getGuildLocale } from './languageService.js';
import { getEconomySettings, money, scaleEarnings } from './economySettings.js';
import { withEconomyLock } from './economyUpgrades.js';
import { addBoost, getBoostType, MAX_BOOST_HOURS } from './boosts.js';
import { openBonusPack, recordProgress } from './progress.js';
import { getSpouseId } from './marriageService.js';

export const SHOP_GRACE_MS = 24 * 60 * 60 * 1000;
export const TITLE_LIMIT = 256;
export const TEXT_LIMIT = 3500;
const nextDay = (day) => dayKey(midnightOf(day) + 36 * 3_600_000);

// texts are functions: they run in the server's language when used. `variable` is the {name} of the per-message amount.
// Optional: `rankPrice` (default 3,000), `dateReward` (an accepted /randka gives both people this much, x2 for a married couple)
// and `marriedDailyPercent` (married members get this much more from the daily collection).
export const SEASONAL_EVENTS = Object.freeze([
  {
    id: 'halloween', year: 2026, emoji: '🎃', currency: '🍬', variable: 'cukierki',
    roleName: 'Halloween 2026', color: '#FF7518',
    // Through 2 November (Zaduszki).
    firstDay: '2026-10-29', lastDay: '2026-11-02', dayRange: ['2026-10-29', '2026-11-15'],
    texts: {
      name: () => t('Halloween 2026'),
      shop: () => t('🎃 Halloween shop'),
      ranking: () => t('🎃 Candy ranking'),
      over: () => t('🎃 Halloween is over'),
      title: () => t('🎃 Halloween 2026 has started!'),
      text: () => t('Pumpkins are glowing, bats are flying and the server is full of **candies**! 🍬\n\n**How to collect them?**\n💬 Every message = **{cukierki} 🍬** (once every {co_ile} s)\n🎁 A caught chat drop = **+{drop} 🍬**\n📅 Every day `/event zbierz` = **+{dziennie} 🍬**\n💼 Every job (`/work`, `/fish`, `/nagraj` ...) = **+{praca} 🍬**\n🎮 A won chat game (question of the day, quiz, Wordle) = **+{gry} 🍬**\n\n**What to spend them on?** → `/event sklep`\n💰 Double money · ⭐ Double XP · 🎁 Packs · 💵 Bags of money\n⚡ Event upgrades in `/ulepszenia`: more for every message\n👑 And the best of all: the rank **{ranga}**, only for the most dedicated!\n\n🏆 Top collectors: `/event ranking`\n⏳ The event runs until {koniec}. The shop stays open one more day.\n\nChat, talk, collect: trick or treat! 👻'),
    },
  },
  {
    id: 'swieta', year: 2026, emoji: '🎄', currency: '🍪', variable: 'pierniczki',
    roleName: 'Święta 2026', color: '#C0392B',
    // From the last weekend before Christmas; New Year's Eve has its own event from 30 December.
    firstDay: '2026-12-19', lastDay: '2026-12-29', dayRange: ['2026-12-01', '2027-01-15'],
    texts: {
      name: () => t('Christmas 2026'),
      shop: () => t('🎄 Christmas shop'),
      ranking: () => t('🎄 Gingerbread ranking'),
      over: () => t('🎄 Christmas is over'),
      title: () => t('🎄 Christmas 2026 on the server!'),
      text: () => t('The tree is up, snow is falling and the server smells of **gingerbread**! 🍪\n\n**How to collect it?**\n💬 Every message = **{pierniczki} 🍪** (once every {co_ile} s)\n🎁 A caught chat drop = **+{drop} 🍪**\n📅 Every day `/event zbierz` = **+{dziennie} 🍪**\n💼 Every job (`/work`, `/fish`, `/nagraj` ...) = **+{praca} 🍪**\n🎮 A won chat game (question of the day, quiz, Wordle) = **+{gry} 🍪**\n\n**What to spend it on?** → `/event sklep`\n💰 Double money · ⭐ Double XP · 🎁 Packs · 💵 Bags of money\n⚡ Event upgrades in `/ulepszenia`: more for every message\n👑 And under the tree: the rank **{ranga}**, for the most dedicated elves!\n\n🏆 Ranking: `/event ranking`\n⏳ The event runs until {koniec}. The shop stays open one more day.\n\nMerry Christmas and lots of chatting! ⛄'),
    },
  },
  {
    id: 'sylwester', year: 2026, emoji: '🥂', currency: '🎆', variable: 'fajerwerki',
    roleName: 'Sylwester 2026', color: '#D4AF37',
    // 30 December through 2 January.
    firstDay: '2026-12-30', lastDay: '2027-01-02', dayRange: ['2026-12-26', '2027-01-10'],
    texts: {
      name: () => t("New Year's Eve 2026"),
      shop: () => t("🥂 New Year's Eve shop"),
      ranking: () => t('🎆 Fireworks ranking'),
      over: () => t("🥂 New Year's Eve is over"),
      title: () => t("🥂 New Year's Eve 2026 on the server!"),
      text: () => t('The countdown has started and the sky over the server is full of **fireworks**! 🎆\n\n**How to collect them?**\n💬 Every message = **{fajerwerki} 🎆** (once every {co_ile} s)\n🎁 A caught chat drop = **+{drop} 🎆**\n📅 Every day `/event zbierz` = **+{dziennie} 🎆**\n💼 Every job (`/work`, `/fish`, `/nagraj` ...) = **+{praca} 🎆**\n🎮 A won chat game (question of the day, quiz, Wordle) = **+{gry} 🎆**\n\n**What to spend them on?** → `/event sklep`\n💰 Double money · ⭐ Double XP · 🎁 Packs · 💵 Bags of money\n⚡ Event upgrades in `/ulepszenia`: more for every message\n👑 And at midnight: the rank **{ranga}**, for the best party people!\n\n🏆 Ranking: `/event ranking`\n⏳ The event runs until {koniec}. The shop stays open one more day.\n\n3, 2, 1... Happy New Year! 🥳'),
    },
  },
  {
    id: 'walentynki', year: 2027, emoji: '💘', currency: '💌', variable: 'lisciki',
    roleName: 'Walentynki 2027', color: '#E91E63', dateReward: 30, marriedDailyPercent: 100,
    // Valentine's Day 2027 is a Sunday: Friday to Tuesday.
    firstDay: '2027-02-12', lastDay: '2027-02-16', dayRange: ['2027-02-01', '2027-02-28'],
    texts: {
      name: () => t("Valentine's Day 2027"),
      shop: () => t("💘 Valentine's shop"),
      ranking: () => t('💌 Love letter ranking'),
      over: () => t("💘 Valentine's Day is over"),
      title: () => t("💘 Valentine's Day 2027 on the server!"),
      text: () => t('Love is in the air and the server is full of **love letters**! 💌\n\n**How to collect them?**\n💬 Every message = **{lisciki} 💌** (once every {co_ile} s)\n🎁 A caught chat drop = **+{drop} 💌**\n📅 Every day `/event zbierz` = **+{dziennie} 💌** (x2 for married people 💍)\n💼 Every job (`/work`, `/fish`, `/nagraj` ...) = **+{praca} 💌**\n🎮 A won chat game (question of the day, quiz, Wordle) = **+{gry} 💌**\n💞 Every accepted `/randka` = **+{randka} 💌** for both of you (x2 for a married couple)\n\n**What to spend them on?** → `/event sklep`\n💰 Double money · ⭐ Double XP · 🎁 Packs · 💵 Bags of money\n⚡ Event upgrades in `/ulepszenia`: more for every message\n👑 And for the biggest romantics: the rank **{ranga}**!\n\n🏆 Ranking: `/event ranking`\n⏳ The event runs until {koniec}. The shop stays open one more day.\n\nAsk someone out, chat, collect! 💕'),
    },
  },
  {
    id: 'wielkanoc', year: 2027, emoji: '🐣', currency: '🥚', variable: 'pisanki',
    roleName: 'Wielkanoc 2027', color: '#7DCEA0',
    // Easter Sunday 2027 is 28 March; through Easter Monday (śmigus-dyngus).
    firstDay: '2027-03-25', lastDay: '2027-03-29', dayRange: ['2027-03-15', '2027-04-15'],
    texts: {
      name: () => t('Easter 2027'),
      shop: () => t('🐣 Easter shop'),
      ranking: () => t('🐣 Egg ranking'),
      over: () => t('🐣 Easter is over'),
      title: () => t('🐣 Easter 2027 on the server!'),
      text: () => t('The bunny is hopping, the baskets are ready and **painted eggs** are hiding all over the server! 🥚\n\n**How to collect them?**\n💬 Every message = **{pisanki} 🥚** (once every {co_ile} s)\n🎁 A caught chat drop = **+{drop} 🥚**\n📅 Every day `/event zbierz` = **+{dziennie} 🥚**\n💼 Every job (`/work`, `/fish`, `/nagraj` ...) = **+{praca} 🥚**\n🎮 A won chat game (question of the day, quiz, Wordle) = **+{gry} 🥚**\n\n**What to spend them on?** → `/event sklep`\n💰 Double money · ⭐ Double XP · 🎁 Packs · 💵 Bags of money\n⚡ Event upgrades in `/ulepszenia`: more for every message\n👑 And in the basket: the rank **{ranga}**, for the best egg hunters!\n\n🏆 Ranking: `/event ranking`\n⏳ The event runs until {koniec}. The shop stays open one more day.\n\nHappy Easter and a wet śmigus-dyngus! 💦'),
    },
  },
  {
    id: 'dzien_dziecka', year: 2027, emoji: '🎈', currency: '🍭', variable: 'lizaki',
    roleName: 'Dzień Dziecka 2027', color: '#FFB300',
    // 1 June 2027 is a Tuesday: the weekend before through Wednesday.
    firstDay: '2027-05-29', lastDay: '2027-06-02', dayRange: ['2027-05-15', '2027-06-15'],
    texts: {
      name: () => t("Children's Day 2027"),
      shop: () => t("🎈 Children's Day shop"),
      ranking: () => t('🍭 Lollipop ranking'),
      over: () => t("🎈 Children's Day is over"),
      title: () => t("🎈 Children's Day 2027 on the server!"),
      text: () => t('Balloons are up, the music is playing and the server is full of **lollipops**! 🍭\n\n**How to collect them?**\n💬 Every message = **{lizaki} 🍭** (once every {co_ile} s)\n🎁 A caught chat drop = **+{drop} 🍭**\n📅 Every day `/event zbierz` = **+{dziennie} 🍭**\n💼 Every job (`/work`, `/fish`, `/nagraj` ...) = **+{praca} 🍭**\n🎮 A won chat game (question of the day, quiz, Wordle) = **+{gry} 🍭**\n\n**What to spend them on?** → `/event sklep`\n💰 Double money · ⭐ Double XP · 🎁 Packs · 💵 Bags of money\n⚡ Event upgrades in `/ulepszenia`: more for every message\n👑 And the best present: the rank **{ranga}**!\n\n🏆 Ranking: `/event ranking`\n⏳ The event runs until {koniec}. The shop stays open one more day.\n\nToday everyone is a kid: have fun! 🎉'),
    },
  },
  {
    id: 'wakacje', year: 2027, emoji: '🏖️', currency: '🐚', variable: 'muszelki',
    roleName: 'Wakacje 2027', color: '#00ACC1', rankPrice: 10_000,
    // The school year 2026/27 ends on Friday 25 June; the whole summer, so the rank costs more.
    firstDay: '2027-06-26', lastDay: '2027-08-31', dayRange: ['2027-06-15', '2027-09-15'],
    texts: {
      name: () => t('Summer holidays 2027'),
      shop: () => t('🏖️ Summer shop'),
      ranking: () => t('🐚 Seashell ranking'),
      over: () => t('🏖️ The summer holidays are over'),
      title: () => t('🏖️ Summer holidays 2027 have started!'),
      text: () => t('School is out, the sun is shining and the server beach is full of **seashells**! 🐚\n\n**How to collect them?**\n💬 Every message = **{muszelki} 🐚** (once every {co_ile} s)\n🎁 A caught chat drop = **+{drop} 🐚**\n📅 Every day `/event zbierz` = **+{dziennie} 🐚**\n💼 Every job (`/work`, `/fish`, `/nagraj` ...) = **+{praca} 🐚**\n🎮 A won chat game (question of the day, quiz, Wordle) = **+{gry} 🐚**\n\n**What to spend them on?** → `/event sklep`\n💰 Double money · ⭐ Double XP · 🎁 Packs · 💵 Bags of money\n⚡ Event upgrades in `/ulepszenia`: more for every message\n👑 And for the whole summer: the rank **{ranga}**!\n\n🏆 Ranking: `/event ranking`\n⏳ The event runs until {koniec}. The shop stays open one more day.\n\nHave a great summer and chat a lot! ☀️'),
    },
  },
].map((event) => ({
  ...event,
  store: event.id,
  dataKey: event.id,
  variables: [event.variable, 'co_ile', 'drop', 'koniec', 'ranga', 'dziennie', 'praca', 'gry', ...(event.dateReward ? ['randka'] : [])],
})));
export const getSeasonEvent = (id) => SEASONAL_EVENTS.find((event) => event.id === id) ?? null;

const SHOP = [
  { id: 'money1', emoji: '💰', name: t('Double money for 1 h'), price: 150, boost: { type: 'money', minutes: 60 } },
  { id: 'money3', emoji: '💰', name: t('Double money for 3 h'), price: 400, boost: { type: 'money', minutes: 180 } },
  { id: 'xp1', emoji: '⭐', name: t('Double XP for 1 h'), price: 100, boost: { type: 'xp', minutes: 60 } },
  { id: 'xp3', emoji: '⭐', name: t('Double XP for 3 h'), price: 250, boost: { type: 'xp', minutes: 180 } },
  { id: 'pack', emoji: '🎁', name: t('Collector Pack'), price: 300, pack: 'kolekcjonera' },
  { id: 'cash', emoji: '💵', name: t('Bag of money'), price: 400, cash: 10_000 },
];
/** The shop of an event: the common items and its rank as the most expensive one. */
export const seasonShop = (event) => [...SHOP, { id: 'rank', emoji: event.emoji, name: event.roleName, price: event.rankPrice ?? 3_000, role: true }];
export const getShopItem = (event, id) => seasonShop(event).find((item) => item.id === id) ?? null;

export const seasonDefaults = (event) => ({
  enabled: true,
  startsAt: midnightOf(event.firstDay),
  endsAt: midnightOf(nextDay(event.lastDay)),
  perMessage: 5,
  cooldownSeconds: 20,
  // Owner: "tam 50 cukierkow" for chat games; the drop is one of them (was 30).
  dropCandies: 50,
  // /event zbierz: once a day.
  dailyAmount: 50,
  // Every job; a won chat game (the question of the day gets QUESTION_FACTOR times this).
  jobMin: 5,
  jobMax: 10,
  gameCandies: 50,
  roleId: null,
  channelId: null,
});

const stores = new Map(SEASONAL_EVENTS.map((event) => [event.id,
  guildStore(event.store, { ...seasonDefaults(event), title: null, text: null, totals: {}, announcement: null, finished: false })]));
// Read only, for the channel fallback (chatEngagement.js imports this file, so no import back).
const chatStore = guildStore('chat-engagement', {});

// 2 (2026-10-29 evening): drops 30 -> 50, Christmas ends on 29 December (New Year's Eve has its own event), jobs and chat
// games give currency, /event replaced the event commands. Stored settings older than that are brought up to date when read,
// and a posted announcement older than that is edited once (tickSeason), so it names /event and the new ways to collect.
export const SEASON_REV = 2;
const OLD_CHRISTMAS_END = midnightOf('2027-01-02');

function migrate(event, settings) {
  if ((Number(settings.rev) || 1) >= SEASON_REV) return settings;
  if (settings.dropCandies === 30) settings.dropCandies = 50;
  if (event.id === 'swieta' && settings.endsAt === OLD_CHRISTMAS_END) settings.endsAt = seasonDefaults(event).endsAt;
  return settings;
}

export const getSeason = async (event, guildId) => migrate(event, await stores.get(event.id).get(guildId));
export const updateSeason = (event, guildId, mutate) => withEconomyLock(guildId, `#season-${event.id}`, () => stores.get(event.id).update(guildId, async (data) => {
  migrate(event, data);
  const next = (await mutate(data)) ?? data;
  next.rev = SEASON_REV;
  return next;
}));

export const seasonActive = (settings, now = Date.now()) => Boolean(settings?.enabled) && now >= settings.startsAt && now < settings.endsAt;
export const shopOpen = (settings, now = Date.now()) => Boolean(settings?.enabled) && now >= settings.startsAt && now < settings.endsAt + SHOP_GRACE_MS;

/** The member's currency of this event: { amount, earned }. */
export function amountOf(event, userData) {
  const data = userData?.[event.dataKey];
  return data?.year === event.year ? { amount: Math.max(0, Number(data.candies) || 0), earned: Math.max(0, Number(data.earned) || 0) } : { amount: 0, earned: 0 };
}

/** This event's part of the member data (empty when it is from another year). */
const seasonData = (event, userData) => (userData?.[event.dataKey]?.year === event.year ? userData[event.dataKey] : { year: event.year });

/** Add (or with a negative amount take) currency. Mutates `userData`; keeps upgrades and the daily day. */
export function addAmount(event, userData, amount) {
  const { amount: have, earned } = amountOf(event, userData);
  userData[event.dataKey] = { ...seasonData(event, userData), year: event.year, candies: have + amount, earned: earned + Math.max(0, amount) };
  return userData[event.dataKey];
}

// ---------------------------------------------------------------- daily collection and event upgrades
// Owner (2026-10-29): "komenda /cukierki itp pod to ze codziennie mozna zbierac x cukierkow, za to mozna ulepszac (/ulepszenia
// i do wyboru eventowe)". /cukierki, /pierniczki, /pisanki give `dailyAmount` once a Warsaw day while the event runs. The event
// upgrades are bought with the event currency in /ulepszenia (folder of the running event) and last for that event.

export const DAILY_PER_LEVEL = 20;
export const DROP_PERCENT_PER_LEVEL = 50;
export const LUCKY_PERCENT_PER_LEVEL = 5;
export const SEASON_UPGRADES = Object.freeze([
  { id: 'bag', emoji: '👜', name: t('Bigger bag'), prices: [100, 200, 350, 500, 750],
    effect: (level, event) => t`+${level} ${event.currency} for every message` },
  { id: 'daily', emoji: '🎁', name: t('Sweeter daily'), prices: [80, 160, 300, 450, 650],
    effect: (level, event) => t`+${level * DAILY_PER_LEVEL} ${event.currency} from the daily collection` },
  { id: 'drops', emoji: '🎯', name: t('Drop hunter'), prices: [100, 250, 450, 700],
    effect: (level, event) => t`+${level * DROP_PERCENT_PER_LEVEL}% ${event.currency} from chat drops` },
  { id: 'lucky', emoji: '🍀', name: t('Lucky find'), prices: [150, 300, 500, 800],
    effect: (level, event) => t`${level * LUCKY_PERCENT_PER_LEVEL}% chance of double ${event.currency} for a message` },
]);
export const getSeasonUpgrade = (id) => SEASON_UPGRADES.find((upgrade) => upgrade.id === id) ?? null;

/** Level of an event upgrade of a member (0 when not bought). */
export const seasonUpgradeLevel = (event, userData, id) => Math.max(0, Number(seasonData(event, userData).upgrades?.[id]) || 0);

/** How much a member really gets for `base`: messages add the bag (and maybe double), drops and the daily their upgrades. */
export function boostedAmount(event, userData, base, kind, random = Math.random) {
  const level = (id) => seasonUpgradeLevel(event, userData, id);
  if (kind === 'daily') return base + level('daily') * DAILY_PER_LEVEL;
  if (kind === 'drop') return Math.round(base * (100 + level('drops') * DROP_PERCENT_PER_LEVEL) / 100);
  const amount = base + level('bag');
  return random() * 100 < level('lucky') * LUCKY_PERCENT_PER_LEVEL ? amount * 2 : amount;
}

/**
 * The event whose shop is open now: { event, settings } or null. A running event comes before one in its extra shop day
 * (Christmas' shop day is the first day of New Year's Eve).
 */
export async function openSeason(guildId, now = Date.now()) {
  let grace = null;
  for (const event of SEASONAL_EVENTS) {
    const settings = await getSeason(event, guildId);
    if (seasonActive(settings, now)) return { event, settings };
    if (!grace && shopOpen(settings, now)) grace = { event, settings };
  }
  return grace;
}

/** The next event that is on and has not started yet: { event, settings } or null. */
export async function nextSeason(guildId, now = Date.now()) {
  let next = null;
  for (const event of SEASONAL_EVENTS) {
    const settings = await getSeason(event, guildId);
    if (settings.enabled && settings.startsAt > now && (!next || settings.startsAt < next.settings.startsAt)) next = { event, settings };
  }
  return next;
}

/** /event zbierz. Returns { amount, total, married, settings }. Throws `userError(text)` when not possible. */
export async function claimSeasonDaily({ event, client, guildId, userId, userError, now = Date.now() }) {
  const settings = await getSeason(event, guildId);
  if (!seasonActive(settings, now)) {
    throw userError(settings.enabled && now < settings.startsAt
      ? t`${event.emoji} ${event.texts.name()} starts <t:${Math.floor(settings.startsAt / 1000)}:f>. Come back then!`
      : t`${event.emoji} ${event.texts.name()} is not running now.`);
  }
  // Valentine's Day: married members get `marriedDailyPercent` more.
  const married = event.marriedDailyPercent ? Boolean(await getSpouseId(guildId, userId)) : false;
  const economy = await getEconomySettings(guildId);
  const result = await withEconomyLock(guildId, userId, async () => {
    const userData = await getEconomyData(client, guildId, userId, { joint: false });
    const today = dayKey(now);
    if (seasonData(event, userData).lastDaily === today) {
      throw userError(t`You already collected today's ${event.currency}. Next ones <t:${Math.floor(midnightOf(nextDay(today)) / 1000)}:R>.`);
    }
    const boosted = boostedAmount(event, userData, Math.max(0, Number(settings.dailyAmount) || 0), 'daily');
    const amount = married ? Math.round(boosted * (100 + event.marriedDailyPercent) / 100) : boosted;
    addAmount(event, userData, amount);
    userData[event.dataKey].lastDaily = today;
    recordProgress(userData, { seasonCurrency: amount }, { settings: economy, now });
    await setEconomyData(client, guildId, userId, userData);
    return { amount, total: amountOf(event, userData).amount };
  });
  await noteTotal(event, guildId, userId, result.amount);
  return { ...result, married, settings };
}

/** Buy the next level of an event upgrade with the event currency. Returns { upgrade, level, price }. */
export async function buySeasonUpgrade({ event, client, guildId, userId, upgradeId, userError, now = Date.now() }) {
  const upgrade = getSeasonUpgrade(upgradeId);
  if (!upgrade) throw userError(t('Pick an upgrade from the list.'));
  const settings = await getSeason(event, guildId);
  if (!shopOpen(settings, now)) throw userError(t('The event shop is closed.'));
  return withEconomyLock(guildId, userId, async () => {
    const userData = await getEconomyData(client, guildId, userId, { joint: false });
    const level = seasonUpgradeLevel(event, userData, upgrade.id);
    if (level >= upgrade.prices.length) throw userError(t`${upgrade.emoji} ${upgrade.name} is already at the top level.`);
    const price = upgrade.prices[level];
    const { amount } = amountOf(event, userData);
    if (amount < price) throw userError(t`${upgrade.emoji} ${upgrade.name} level ${level + 1} costs **${price} ${event.currency}** - you have ${amount} ${event.currency}.`);
    addAmount(event, userData, -price);
    const data = userData[event.dataKey];
    data.upgrades = { ...(data.upgrades ?? {}), [upgrade.id]: level + 1 };
    await setEconomyData(client, guildId, userId, userData);
    return { upgrade, level: level + 1, price };
  });
}

async function noteTotal(event, guildId, userId, amount) {
  if (amount <= 0) return;
  await updateSeason(event, guildId, (data) => {
    data.totals = { ...(data.totals ?? {}), [userId]: (Number(data.totals?.[userId]) || 0) + amount };
  });
}

// ---------------------------------------------------------------- earning

const lastAward = new Map(); // `${event}:${guildId}:${userId}` -> time of the last currency for a message
const TWO_LETTERS_RE = /\p{L}.*\p{L}/su;

/** featureMessages.js: a member wrote. Gives the currency of every running event; returns how much in total. */
export async function handleSeasonMessage(message, now = Date.now()) {
  if (!message.guild || message.author?.bot) return 0;
  if (!TWO_LETTERS_RE.test(message.content ?? '') && !(message.attachments?.size > 0)) return 0;
  let given = 0;
  for (const event of SEASONAL_EVENTS) {
    const settings = await getSeason(event, message.guild.id);
    if (!seasonActive(settings, now) || settings.perMessage <= 0) continue;
    const key = `${event.id}:${message.guild.id}:${message.author.id}`;
    if (now - (lastAward.get(key) ?? 0) < settings.cooldownSeconds * 1000) continue;
    if (lastAward.size > 50_000) lastAward.clear();
    lastAward.set(key, now);
    given += await giveSeasonCurrency(event, message.client, message.guild.id, message.author.id, settings.perMessage, { now, kind: 'message' });
  }
  return given;
}

/**
 * Give currency to a member: `base` plus the member's event upgrades for this `kind` ('message', 'drop', or 'exact').
 * Returns what was given.
 */
export async function giveSeasonCurrency(event, client, guildId, userId, base, { now = Date.now(), kind = 'exact', random = Math.random } = {}) {
  const economy = await getEconomySettings(guildId);
  const amount = await withEconomyLock(guildId, userId, async () => {
    const userData = await getEconomyData(client, guildId, userId, { joint: false });
    const given = kind === 'exact' ? base : boostedAmount(event, userData, base, kind, random);
    addAmount(event, userData, given);
    recordProgress(userData, { seasonCurrency: given }, { settings: economy, now });
    await setEconomyData(client, guildId, userId, userData);
    return given;
  });
  await noteTotal(event, guildId, userId, amount);
  return amount;
}

// Jobs and chat games (owner 2026-10-29: "czatowe gierki ... za cukierki, tam 50 cukierkow itp zeby te 3000 sie zbieralo latwiej",
// "do kazdej pracy dolicz po 5-10"). Jobs: /work, /fish, /nagraj, /beg, /slut and a successful /crime, each use. Games: a won
// /quiz question and a solved /wordle give `gameCandies`, the question of the day (once a day, the hardest) QUESTION_FACTOR
// times that; the chat drop has its own `dropCandies`. Event upgrades do not change these amounts (my decision).
export const QUESTION_FACTOR = 2;

function rewardAmount(settings, kind, random) {
  if (kind === 'job') {
    const min = Math.max(0, Number(settings.jobMin) || 0);
    const max = Math.max(min, Number(settings.jobMax) || 0);
    return min + Math.floor(random() * (max - min + 1));
  }
  const game = Math.max(0, Number(settings.gameCandies) || 0);
  return kind === 'question' ? game * QUESTION_FACTOR : game;
}

/**
 * Add the currency of every running event for a job (`kind` 'job') or a won chat game ('game', 'question') to `userData`.
 * The caller holds the member's economy lock and saves `userData`; then it passes the result to `noteSeasonGifts`.
 * Returns [{ event, amount }].
 */
export async function addSeasonReward(guildId, userData, kind, { now = Date.now(), random = Math.random } = {}) {
  const gifts = [];
  for (const event of SEASONAL_EVENTS) {
    const settings = await getSeason(event, guildId);
    if (!seasonActive(settings, now)) continue;
    const amount = rewardAmount(settings, kind, random);
    if (amount <= 0) continue;
    addAmount(event, userData, amount);
    gifts.push({ event, amount });
  }
  return gifts;
}

/** The ranking part of `addSeasonReward`, after the member data is saved. */
export async function noteSeasonGifts(guildId, userId, gifts) {
  for (const { event, amount } of gifts ?? []) await noteTotal(event, guildId, userId, amount);
}

/** "🎃 **+7 🍬**" for a reply ('' without gifts). */
export const seasonGiftText = (gifts) => (gifts ?? []).map(({ event, amount }) => `${event.emoji} **+${amount} ${event.currency}**`).join(' · ');

/** Valentine's Day: an accepted /randka gives both people `dateReward`, x2 for a married couple. Returns [{ event, amount }]. */
export async function seasonDateReward(client, guildId, userIds, married, now = Date.now()) {
  const gifts = [];
  for (const event of SEASONAL_EVENTS) {
    if (!event.dateReward) continue;
    const settings = await getSeason(event, guildId);
    if (!seasonActive(settings, now)) continue;
    const amount = event.dateReward * (married ? 2 : 1);
    for (const userId of userIds) await giveSeasonCurrency(event, client, guildId, userId, amount, { now });
    gifts.push({ event, amount });
  }
  return gifts;
}

/** What a caught chat drop gives on top now: [{ event, amount }] of the running events. */
export async function seasonDropBonus(guildId, now = Date.now()) {
  const bonus = [];
  for (const event of SEASONAL_EVENTS) {
    const settings = await getSeason(event, guildId);
    const amount = Math.max(0, Number(settings.dropCandies) || 0);
    if (seasonActive(settings, now) && amount > 0) bonus.push({ event, amount });
  }
  return bonus;
}

// ---------------------------------------------------------------- shop

async function rankRole(event, guild, settings, userError) {
  let role = settings.roleId ? guild.roles.cache.get(settings.roleId) : null;
  role ??= [...guild.roles.cache.values()].find((entry) => entry.name === event.roleName) ?? null;
  if (!role) {
    if (!guild.members.me?.permissions?.has?.(PermissionFlagsBits.ManageRoles)) {
      throw userError(t`The bot cannot create the role ${event.roleName} (it needs Manage Roles). Tell an admin.`);
    }
    role = await guild.roles.create({ name: event.roleName, color: Number.parseInt(event.color.slice(1), 16), hoist: true, reason: `${event.roleName} event (/event)` })
      .catch(() => null);
    if (!role) throw userError(t`The bot could not create the role ${event.roleName}. Tell an admin.`);
  }
  if (settings.roleId !== role.id) await updateSeason(event, guild.id, (data) => { data.roleId = role.id; });
  return role;
}

/**
 * Buy an item of an event shop with its currency. Returns { item, amount, note, progress }.
 * Throws `userError(text)` when not possible.
 */
export async function buySeasonItem({ event, client, guild, member, itemId, userError, now = Date.now() }) {
  const item = getShopItem(event, itemId);
  if (!item) throw userError(t('Pick an item from the list.'));
  const settings = await getSeason(event, guild.id);
  if (!shopOpen(settings, now)) throw userError(t('The event shop is closed.'));
  const role = item.role ? await rankRole(event, guild, settings, userError) : null;
  if (role && member.roles?.cache?.has?.(role.id)) throw userError(t`You already have the role ${event.roleName}.`);
  const economy = await getEconomySettings(guild.id);

  return withEconomyLock(guild.id, member.id, async () => {
    const userData = await getEconomyData(client, guild.id, member.id, { joint: false });
    const { amount } = amountOf(event, userData);
    if (amount < item.price) {
      throw userError(t`${item.emoji} ${item.name} costs **${item.price} ${event.currency}** - you have ${amount} ${event.currency}. Write on the server to get more.`);
    }
    let note = '';
    let progress = null;
    if (item.boost) {
      const until = addBoost(userData, item.boost.type, item.boost.minutes, now);
      if (!until) throw userError(t`A boost can run at most ${MAX_BOOST_HOURS} h ahead. Wait until it runs down a little.`);
      note = t`${getBoostType(item.boost.type).emoji} runs until <t:${Math.floor(until / 1000)}:t>.`;
    } else if (item.pack) {
      const { drawn } = openBonusPack(userData, item.pack);
      progress = recordProgress(userData, { packs: 1 }, { settings: economy, now });
      note = drawn.map(({ card, variant, isNew }) => `${variant.emoji || card.emoji} ${card.name}${isNew ? ' 🆕' : ''}`).join(', ');
    } else if (item.cash) {
      const cash = scaleEarnings(economy, item.cash);
      userData.wallet = (Number(userData.wallet) || 0) + cash;
      note = t`+${money(guild.id, cash)} in cash.`;
    } else if (role) {
      const added = await member.roles.add(role, `${event.roleName} shop`).then(() => true).catch(() => false);
      if (!added) throw userError(t`The bot could not give you the role ${event.roleName} (its own role must be higher). Your ${event.currency} stay.`);
      note = t`You have the role <@&${role.id}>. ${event.emoji}`;
    }
    addAmount(event, userData, -item.price);
    await setEconomyData(client, guild.id, member.id, userData);
    return { item, amount: amountOf(event, userData).amount, note, progress };
  });
}

/** The best collectors of an event: [{ userId, earned }]. */
export async function seasonRanking(event, guildId, limit = 10) {
  const settings = await getSeason(event, guildId);
  return Object.entries(settings.totals ?? {})
    .map(([userId, earned]) => ({ userId, earned: Number(earned) || 0 }))
    .sort((a, b) => b.earned - a.earned)
    .slice(0, limit);
}

// ---------------------------------------------------------------- announcement

async function announcementChannel(guild, settings) {
  const economy = await getEconomySettings(guild.id);
  const chat = await chatStore.get(guild.id);
  const id = settings.channelId || economy.events?.channelId || chat.channelId;
  return id ? guild.channels.cache.get(id) ?? null : null;
}

// The panel edits title and text (owner: "napisz ladne ogloszenie ... daj mi do edytowania na stronie"); the event's
// {variables} are filled in when it is posted.
export const defaultAnnouncement = (event) => ({ title: event.texts.title(), text: event.texts.text() });

/** Fill in the {variables} of an announcement text. */
export function fillAnnouncement(event, text, settings) {
  const values = {
    [event.variable]: settings.perMessage,
    co_ile: settings.cooldownSeconds,
    drop: settings.dropCandies,
    koniec: `<t:${Math.floor(settings.endsAt / 1000)}:f>`,
    ranga: event.roleName,
    dziennie: settings.dailyAmount,
    praca: settings.jobMin === settings.jobMax ? settings.jobMin : `${settings.jobMin}-${settings.jobMax}`,
    gry: settings.gameCandies,
    randka: event.dateReward ?? 0,
  };
  return String(text ?? '').replace(/\{([a-z_]+)\}/g, (match, name) => (name in values ? String(values[name]) : match));
}

export function announcementEmbed(event, settings) {
  const fallback = defaultAnnouncement(event);
  return createEmbed({
    title: fillAnnouncement(event, settings.title || fallback.title, settings).slice(0, TITLE_LIMIT),
    description: fillAnnouncement(event, settings.text || fallback.text, settings).slice(0, 4096),
    color: event.color,
    footer: false,
  });
}

/**
 * Panel: post the announcement again now (the old one is deleted), or only edit the posted one with `editOnly`.
 * Returns the message or null. Throws `userError(text)` when the event does not run.
 */
export async function repostAnnouncement(event, guild, { editOnly = false, userError = null, now = Date.now() } = {}) {
  const settings = await getSeason(event, guild.id);
  const old = settings.announcement;
  const oldChannel = old?.channelId ? guild.channels.cache.get(old.channelId) : null;
  if (editOnly) {
    if (!old?.messageId || !seasonActive(settings, now)) return null;
    const message = await oldChannel?.messages?.fetch?.(old.messageId).catch(() => null);
    return message?.edit?.({ embeds: [announcementEmbed(event, settings)] }).catch(() => null) ?? null;
  }
  if (!seasonActive(settings, now)) {
    if (userError) throw userError(t('This event is not running now (turned off or outside its days).'));
    return null;
  }
  const channel = await announcementChannel(guild, settings);
  if (!channel?.send) {
    if (userError) throw userError(t('Pick a channel for the announcement (or set the events or chat channel).'));
    return null;
  }
  const message = await channel.send({ embeds: [announcementEmbed(event, settings)] }).catch(() => null);
  if (!message) {
    if (userError) throw userError(t('The bot could not post on that channel (check its permissions).'));
    return null;
  }
  if (old?.messageId) await oldChannel?.messages?.delete?.(old.messageId).catch(() => {});
  await updateSeason(event, guild.id, (data) => { data.announcement = { channelId: channel.id, messageId: message.id, rev: SEASON_REV }; data.finished = false; });
  return message;
}

/** Post the announcement at the start (or edit one posted by an older version), delete it and post the top three at the end. */
export async function tickSeason(event, client, guild, now = Date.now()) {
  const settings = await getSeason(event, guild.id);
  if (seasonActive(settings, now) && !settings.announcement) {
    const channel = await announcementChannel(guild, settings);
    if (!channel?.send) return;
    const message = await channel.send({ embeds: [announcementEmbed(event, settings)] })
      .catch((error) => { logger.warn(`${event.id} announcement not posted in guild ${guild.id}: ${error.message}`); return null; });
    await updateSeason(event, guild.id, (data) => { data.announcement = { channelId: channel.id, messageId: message?.id ?? null, rev: SEASON_REV }; });
    return;
  }
  if (seasonActive(settings, now) && settings.announcement?.messageId && (Number(settings.announcement.rev) || 1) < SEASON_REV) {
    // Marked first: a deleted message is not tried again every minute.
    await updateSeason(event, guild.id, (data) => { if (data.announcement) data.announcement.rev = SEASON_REV; });
    await repostAnnouncement(event, guild, { editOnly: true, now });
    return;
  }
  const over = now >= settings.endsAt || !settings.enabled;
  if (!over || !settings.announcement) return;
  const { channelId, messageId } = settings.announcement;
  const channel = guild.channels.cache.get(channelId);
  if (messageId) await channel?.messages?.delete?.(messageId).catch(() => {});
  await updateSeason(event, guild.id, (data) => { data.announcement = null; data.finished = true; });
  const top = (await seasonRanking(event, guild.id, 3)).filter((row) => row.earned > 0);
  if (!settings.enabled || !top.length || !channel?.send) return;
  const medals = ['🥇', '🥈', '🥉'];
  await channel.send({
    embeds: [createEmbed({
      title: event.texts.over(),
      description: top.map((row, index) => `${medals[index]} <@${row.userId}> · **${row.earned} ${event.currency}**`).join('\n')
        + t('\n\nThanks for chatting! The shop is open one more day: `/event sklep`.'),
      color: event.color,
      footer: false,
    })],
    allowedMentions: { parse: [] },
  }).catch(() => {});
}

export async function runSeasonalEvents(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      enterLocale(await getGuildLocale(guild.id));
      for (const event of SEASONAL_EVENTS) await tickSeason(event, client, guild);
    } catch (error) {
      logger.warn(`Seasonal events failed in guild ${guild.id}: ${error.message}`);
    }
  }
}
