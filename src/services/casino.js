// casino.js — what /gamble, /ruletka, /slots and /blackjack share: the bet checks (one
// common break and highest bet from the server's gamble settings), luck, and the line
// that tells the player their exact win chance.
//
// Luck adds percentage points to a game's win chance: 40% with luck +3 is 43%. Sources: the Luck upgrade (+1 a level, 15 levels), the best clover item
// (golden +4, diamond +6) and one consumable per game (Lucky Clover +4, Lucky Charm +2),
// together at most MAX_LUCK = 25. Bets that pay more than x2 get fewer points,
// (2 / payout)^2 of them, so a roulette number (x36) is not a sure profit. A win chance
// never goes above MAX_WIN_CHANCE.
//
// Even-money bets (roulette colour, even/odd, halves; a won blackjack hand) pay
// EVEN_MONEY_PAYOUT times the stake: x1.7 since 2026-10-26 (owner), so luck alone is
// not a sure profit. /gamble takes its payout from the server settings (default x1.7).

import { getEconomyData, setEconomyData } from '../utils/economy.js';
import { createError, ErrorTypes } from '../utils/errorHandler.js';
import { cooldownMs, getEconomySettings, money } from './economySettings.js';
import { LUCK_PER_LEVEL, getUpgradeLevel, staminaCooldown, withEconomyLock } from './economyUpgrades.js';
import { assertNotJailed } from './economyJail.js';
import { bestInChain, getItemById } from '../config/shop/items.js';
import { t, tr } from '../i18n/index.js';
import { recordProgress } from './progress.js';
import { eventLuck } from './economyEvents.js';

export const MAX_WIN_CHANCE = 0.95;
export const MAX_LUCK = 25;
export const EVEN_MONEY_PAYOUT = 1.7;

const LUCK_ITEMS = ['lucky_clover', 'lucky_charm'];

/** Permanent luck of a member, by source. */
export function permanentLuck(userData) {
  const upgrade = getUpgradeLevel(userData, 'luck') * LUCK_PER_LEVEL;
  const clover = bestInChain(userData, 'luck');
  return { upgrade, clover, total: Math.min(MAX_LUCK, upgrade + (clover?.bonusPercent ?? 0)) };
}

/** Use one luck consumable (Lucky Clover first). Mutates `userData`. Returns the item or null. */
export function useLuckItem(userData) {
  for (const id of LUCK_ITEMS) {
    if ((userData.inventory?.[id] || 0) > 0) {
      userData.inventory = { ...userData.inventory, [id]: userData.inventory[id] - 1 };
      return getItemById(id);
    }
  }
  return null;
}

/**
 * Luck for one game: permanent luck plus one consumable, which is used up here, plus the luck
 * of a running "szczescie" event (`eventBonus`, it goes above the cap).
 */
export function takeLuck(userData, eventBonus = 0) {
  const permanent = permanentLuck(userData);
  const item = useLuckItem(userData);
  const total = Math.min(MAX_LUCK, permanent.total + (item?.luckPercent ?? 0)) + eventBonus;
  return { ...permanent, item, event: eventBonus, total };
}

/** Points of luck a bet paying `payout` times the stake gets: all of them up to x2, fewer above. */
export const luckPoints = (luckPercent, payout = 2) => (luckPercent || 0) * Math.min(1, (2 / payout) ** 2);

/** Win chance (0-1) after luck, for a bet that pays `payout` times the stake. */
export const applyLuck = (chance, luckPercent, payout = 2) =>
  Math.max(chance, Math.min(MAX_WIN_CHANCE, chance + luckPoints(luckPercent, payout) / 100));

const percent = (chance) => {
  const value = chance * 100;
  return value >= 10 || Number.isInteger(value) ? String(Math.round(value)) : value.toFixed(1);
};
export { percent as formatChance };

/** "🎯 Your win chance: 55% · base 50% · luck +5%" for the footer of every game. */
export function chanceLine(base, final, luck) {
  let text = t`🎯 Your win chance: ${percent(final)}%`;
  // A roulette number gets almost no luck; "+0.0%" would only confuse.
  if (luck?.total > 0 && final - base >= 0.001) text += t` · base ${percent(base)}% · luck +${percent(final - base)}%`;
  return text;
}

/** Lines about the luck that played in this game, '' without any. */
export function luckLines(luck) {
  const lines = [];
  if (luck.upgrade > 0) lines.push(t`🍀 Luck upgrade: +${luck.upgrade}%`);
  if (luck.clover) lines.push(`${luck.clover.emoji} ${tr(luck.clover.name)}: +${luck.clover.bonusPercent}%`);
  if (luck.item) lines.push(t`${luck.item.emoji} ${tr(luck.item.name)} used: +${luck.item.luckPercent}%`);
  if (luck.event > 0) lines.push(t`🎉 Event: +${luck.event}%`);
  return lines.length ? `\n-# ${lines.join(' · ')}` : '';
}

/** Throw a user error when `bet` is not allowed right now. */
export function checkBet({ settings, userData, bet, guildId, now = Date.now() }) {
  const { gamble } = settings.commands;
  assertNotJailed(userData, now, { settings, guildId });
  if (gamble.maxBet > 0 && bet > gamble.maxBet) {
    throw createError("Bet above the limit", ErrorTypes.VALIDATION,
      t`The highest bet on this server is ${money(guildId, gamble.maxBet)}.`, { bet, maxBet: gamble.maxBet, expected: true });
  }
  const cooldown = staminaCooldown(userData, cooldownMs(gamble.cooldownMinutes));
  const remaining = (userData.lastGamble || 0) + cooldown - now;
  if (remaining > 0) {
    const minutes = Math.floor(remaining / 60_000);
    const seconds = Math.floor((remaining % 60_000) / 1000);
    throw createError("Gamble cooldown active", ErrorTypes.RATE_LIMIT,
      t`You need to cool down before gambling again. Wait **${minutes}m ${seconds}s**.`, { remaining, cooldownType: 'gamble', expected: true });
  }
  if ((userData.wallet || 0) < bet) {
    throw createError("Insufficient cash for gamble", ErrorTypes.VALIDATION,
      t`You only have ${money(guildId, userData.wallet || 0)} cash, but you are trying to bet ${money(guildId, bet)}.`,
      { required: bet, current: userData.wallet || 0, expected: true });
  }
  return cooldown;
}

/**
 * One round of a single-step game. `resolve({ settings, userData, luck })` decides the game,
 * changes `userData.wallet` and returns what the command shows; the data is saved here.
 */
export function playRound({ client, guildId, userId, bet }, resolve) {
  return withEconomyLock(guildId, userId, async () => {
    const settings = await getEconomySettings(guildId);
    const userData = await getEconomyData(client, guildId, userId);
    const now = Date.now();
    const cooldown = checkBet({ settings, userData, bet, guildId, now });
    const luck = takeLuck(userData, eventLuck(settings, now));
    const result = await resolve({ settings, userData, luck });
    userData.lastGamble = now;
    // `events` from the game (wins, jackpots) for missions and badges (services/progress.js).
    const progress = recordProgress(userData, { casino: 1, ...(result.events ?? {}) }, { settings, now });
    await setEconomyData(client, guildId, userId, userData);
    return { ...result, settings, userData, luck, cooldown, progress };
  });
}

// ---- Roulette (European wheel, 0-36) ----

export const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

export const ROULETTE_BETS = Object.freeze({
  czerwone: { name: t('🔴 Red'), payout: EVEN_MONEY_PAYOUT, wins: (n) => RED_NUMBERS.has(n) },
  czarne: { name: t('⚫ Black'), payout: EVEN_MONEY_PAYOUT, wins: (n) => n > 0 && !RED_NUMBERS.has(n) },
  parzyste: { name: t('Even'), payout: EVEN_MONEY_PAYOUT, wins: (n) => n > 0 && n % 2 === 0 },
  nieparzyste: { name: t('Odd'), payout: EVEN_MONEY_PAYOUT, wins: (n) => n % 2 === 1 },
  niskie: { name: '1-18', payout: EVEN_MONEY_PAYOUT, wins: (n) => n >= 1 && n <= 18 },
  wysokie: { name: '19-36', payout: EVEN_MONEY_PAYOUT, wins: (n) => n >= 19 },
  tuzin1: { name: '1-12', payout: 3, wins: (n) => n >= 1 && n <= 12 },
  tuzin2: { name: '13-24', payout: 3, wins: (n) => n >= 13 && n <= 24 },
  tuzin3: { name: '25-36', payout: 3, wins: (n) => n >= 25 },
  zielone: { name: t('🟢 Zero'), payout: 36, wins: (n) => n === 0 },
  liczba: { name: t('Number'), payout: 36, wins: (n, number) => n === number },
});

export const rouletteColor = (n) => (n === 0 ? '🟢' : RED_NUMBERS.has(n) ? '🔴' : '⚫');

/** Spin for `betId`. The result number is drawn after the win is decided, so luck keeps the chance exact. */
export function spinRoulette(betId, number, luckPercent, random = Math.random) {
  const bet = ROULETTE_BETS[betId];
  const numbers = Array.from({ length: 37 }, (_, n) => n);
  const winning = numbers.filter((n) => bet.wins(n, number));
  const losing = numbers.filter((n) => !bet.wins(n, number));
  const base = winning.length / 37;
  const chance = applyLuck(base, luckPercent, bet.payout);
  const win = random() < chance;
  const pool = win ? winning : losing;
  return { bet, base, chance, win, result: pool[Math.floor(random() * pool.length)] };
}

// ---- Slots ----

export const SLOT_SYMBOLS = ['🍒', '🍋', '🍇', '🔔', '7️⃣', '💎'];
const FRUITS = ['🍒', '🍋', '🍇'];

// Chance of each winning line before luck, and what it pays (times the bet).
// Win chance 29%, the machine keeps 12.5% on average.
export const SLOT_OUTCOMES = Object.freeze([
  { id: 'jackpot', name: t('JACKPOT'), symbols: ['💎'], chance: 0.005, payout: 25 },
  { id: 'sevens', name: t('Three sevens'), symbols: ['7️⃣'], chance: 0.015, payout: 10 },
  { id: 'bells', name: t('Three bells'), symbols: ['🔔'], chance: 0.03, payout: 5 },
  { id: 'fruit', name: t('Three fruits'), symbols: FRUITS, chance: 0.06, payout: 3 },
  { id: 'pair', name: t('A pair'), symbols: SLOT_SYMBOLS, chance: 0.18, payout: 1.5 },
]);

export const SLOT_BASE_CHANCE = SLOT_OUTCOMES.reduce((sum, outcome) => sum + outcome.chance, 0);
// What a win pays on average (about x3), so slots get the luck of an x3 bet.
export const SLOT_AVERAGE_PAYOUT = SLOT_OUTCOMES.reduce((sum, outcome) => sum + outcome.chance * outcome.payout, 0) / SLOT_BASE_CHANCE;

const pick = (list, random) => list[Math.floor(random() * list.length)];

/** Spin the reels. Returns the 3 symbols, the winning line (or null) and the win chance. */
export function spinSlots(luckPercent, random = Math.random) {
  const chance = applyLuck(SLOT_BASE_CHANCE, luckPercent, SLOT_AVERAGE_PAYOUT);
  const scale = chance / SLOT_BASE_CHANCE;
  let roll = random();
  let outcome = null;
  for (const entry of SLOT_OUTCOMES) {
    roll -= entry.chance * scale;
    if (roll < 0) { outcome = entry; break; }
  }

  let reels;
  if (!outcome) {
    const pool = [...SLOT_SYMBOLS];
    reels = [0, 1, 2].map(() => pool.splice(Math.floor(random() * pool.length), 1)[0]);
  } else if (outcome.id === 'pair') {
    const same = pick(SLOT_SYMBOLS, random);
    const other = pick(SLOT_SYMBOLS.filter((symbol) => symbol !== same), random);
    reels = [same, same, same];
    reels[Math.floor(random() * 3)] = other;
  } else {
    const symbol = pick(outcome.symbols, random);
    reels = [symbol, symbol, symbol];
  }
  return { reels, outcome, base: SLOT_BASE_CHANCE, chance };
}
