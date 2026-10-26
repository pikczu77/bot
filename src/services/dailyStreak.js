// dailyStreak.js — /daily days in a row and the chest on every 7th one (2026-10-26, owner: "8 fajne").
//
// A claim continues the streak when it comes before the next break plus one more day has passed
// (with the default 24 h break: within 48 h of the last claim); otherwise the streak starts at 1.
// Stored in the member's economy data as `dailyStreak` (the field existed and was always 0).
// Chest: 3x the server's /daily amount (multiplier, Fortune, "kasa" event) plus one extra: a Starter pack 50%,
// a Collector pack 25%, two Lucky Clovers 15%, a Legend pack 10%.

import { scaleEarnings } from './economySettings.js';
import { openBonusPack } from './progress.js';

export const CHEST_EVERY = 7;
const DAY_MS = 86_400_000;
const CHEST_EXTRAS = [
  { chance: 0.5, pack: 'startowa' },
  { chance: 0.25, pack: 'kolekcjonera' },
  { chance: 0.15, item: 'lucky_clover', count: 2 },
  { chance: 0.1, pack: 'legend' },
];

/** The streak after a claim at `now` (the claim before was `lastDaily`). */
export function nextStreak(previous, lastDaily, now, cooldownMs) {
  const grace = Math.max(cooldownMs, DAY_MS);
  const continues = lastDaily > 0 && now - lastDaily < cooldownMs + grace;
  return continues ? Math.max(0, Number(previous) || 0) + 1 : 1;
}

export const daysToChest = (streak) => CHEST_EVERY - (streak % CHEST_EVERY);

/** Open the chest into `userData`. Returns { money, pack?, drawn?, item?, count? }. */
export function openStreakChest(userData, settings, dailyAmount, random = Math.random) {
  const money = scaleEarnings(settings, dailyAmount * 3, userData);
  userData.wallet = (Number(userData.wallet) || 0) + money;
  let roll = random();
  const extra = CHEST_EXTRAS.find((entry) => (roll -= entry.chance) < 0) ?? CHEST_EXTRAS[0];
  if (extra.pack) return { money, ...openBonusPack(userData, extra.pack, random) };
  userData.inventory = { ...(userData.inventory ?? {}), [extra.item]: (Number(userData.inventory?.[extra.item]) || 0) + extra.count };
  return { money, item: extra.item, count: extra.count };
}
