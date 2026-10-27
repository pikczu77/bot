// wordle.js — the daily /wordle (2026-10-26, owner: "zrobmy wordle za kase, ze mozna raz dziennie zrobic").
//
// One Polish five-letter word a day per server (new at Warsaw midnight), six guesses, one game a
// day per member. A solved word pays `commands.wordle.reward` (economy settings) scaled by how
// many guesses it took (REWARD_FACTORS), then by the server multiplier, Fortune and a "kasa" event.
// Member data: wordle = { day, guesses: [...], done, solved, streak, lastSolvedDay }.

import { WORDLE_WORDS } from '../config/wordleWords.js';
import { dayKey, daysBetween } from '../utils/warsawTime.js';
import { scaleEarnings } from './economySettings.js';

export const WORD_LENGTH = 5;
export const MAX_GUESSES = 6;
// Share of the reward by the number of guesses (1st guess = everything).
export const REWARD_FACTORS = [1, 0.85, 0.7, 0.55, 0.4, 0.25];
export const GUESS_RE = /^[a-ząćęłńóśźż]{5}$/u;

const EPOCH = '2026-10-26';
const gcd = (a, b) => (b ? gcd(b, a % b) : a);
// A step that shares no factor with the list length walks through every word before one repeats.
const stepFor = (size) => [97, 89, 83, 79, 73, 71, 67].find((prime) => gcd(prime, size) === 1) ?? 1;
// How many words of the list each day may use: the list grew on 2026-10-28, earlier days keep the first 243,
// so the word of a day never changes when the bot restarts in the middle of it.
export const LIST_SIZES = Object.freeze([
  { from: EPOCH, size: 243 },
  { from: '2026-10-28', size: WORDLE_WORDS.length },
]);
const listSizeOn = (day) => LIST_SIZES.filter((entry) => entry.from <= day).at(-1)?.size ?? WORDLE_WORDS.length;

function guildSalt(guildId) {
  let hash = 0;
  for (const char of String(guildId)) hash = (hash * 31 + char.charCodeAt(0)) % 1_000_003;
  return hash;
}

/** Number of the puzzle (#1 on 2026-10-26) and the word of `day` for a server. */
export function puzzleNumber(day) {
  return daysBetween(EPOCH, day) + 1;
}
export function wordOfDay(guildId, day) {
  const size = listSizeOn(day);
  const index = ((daysBetween(EPOCH, day) * stepFor(size) + guildSalt(guildId)) % size + size) % size;
  return WORDLE_WORDS[index];
}

export const normalizeGuess = (text) => String(text ?? '').trim().toLocaleLowerCase('pl');

/**
 * Colours of a guess: 'hit' (right place), 'near' (in the word, elsewhere), 'miss'.
 * Repeated letters count only as often as they are in the answer.
 */
export function scoreGuess(guess, answer) {
  const g = [...guess];
  const a = [...answer];
  const result = Array(g.length).fill('miss');
  const left = new Map();
  g.forEach((letter, index) => {
    if (letter === a[index]) result[index] = 'hit';
    else left.set(a[index], (left.get(a[index]) || 0) + 1);
  });
  g.forEach((letter, index) => {
    if (result[index] === 'hit') return;
    const count = left.get(letter) || 0;
    if (count > 0) {
      result[index] = 'near';
      left.set(letter, count - 1);
    }
  });
  return result;
}

const SQUARES = { hit: '🟩', near: '🟨', miss: '⬛' };
export const squares = (score) => score.map((mark) => SQUARES[mark]).join('');

/** Today's game of a member, started fresh on a new day (not saved here). */
export function todaysGame(userData, now = Date.now()) {
  const day = dayKey(now);
  const game = userData.wordle;
  if (game?.day === day) return game;
  return { day, guesses: [], done: false, solved: false, streak: Number(game?.streak) || 0, lastSolvedDay: game?.lastSolvedDay ?? null };
}

/**
 * Play one guess. Mutates `userData` (game, cash). Returns
 * { game, answer, score, finished, solved, reward } or { error: 'format' | 'done' }.
 */
export function playGuess({ userData, guildId, settings, text, now = Date.now() }) {
  const game = todaysGame(userData, now);
  if (game.done) return { error: 'done', game };
  const guess = normalizeGuess(text);
  if (!GUESS_RE.test(guess)) return { error: 'format', game };

  const answer = wordOfDay(guildId, game.day);
  const score = scoreGuess(guess, answer);
  const guesses = [...game.guesses, guess];
  const solved = guess === answer;
  const finished = solved || guesses.length >= MAX_GUESSES;
  let reward = 0;
  let { streak, lastSolvedDay } = game;
  if (solved) {
    streak = lastSolvedDay && daysBetween(lastSolvedDay, game.day) === 1 ? streak + 1 : 1;
    lastSolvedDay = game.day;
    const base = Math.round((Number(settings.commands.wordle?.reward) || 0) * REWARD_FACTORS[guesses.length - 1]);
    reward = scaleEarnings(settings, base, userData);
    userData.wallet = (Number(userData.wallet) || 0) + reward;
  } else if (finished) {
    streak = 0;
  }
  userData.wordle = { day: game.day, guesses, done: finished, solved, streak, lastSolvedDay };
  return { game: userData.wordle, answer, score, finished, solved, reward };
}
