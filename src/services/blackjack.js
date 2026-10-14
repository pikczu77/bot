// blackjack.js — rules and odds of /blackjack. Pure functions; the command and its buttons
// keep the hand in the member's economy data (`blackjack`), so a game survives a restart.
//
// Rules: endless deck, the dealer draws to 17 and stands on every 17, a blackjack (21 with
// two cards) pays 3:2, double down on the first move. Luck: when a card you draw would bust
// you, there is a luck% chance it is swapped once for another card.

const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];
export const GAME_TIMEOUT_MS = 10 * 60_000;

export const drawCard = (random = Math.random) =>
  `${RANKS[Math.floor(random() * RANKS.length)]}${SUITS[Math.floor(random() * SUITS.length)]}`;

const rankOf = (card) => card.slice(0, -1);
const cardValue = (card) => {
  const rank = rankOf(card);
  if (rank === 'A') return 1;
  return ['J', 'Q', 'K'].includes(rank) ? 10 : Number(rank);
};

/** Best total of a hand; `soft` when an ace still counts as 11. */
export function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    const value = cardValue(card);
    total += value;
    if (value === 1) aces += 1;
  }
  const soft = aces > 0 && total + 10 <= 21;
  return { total: soft ? total + 10 : total, soft };
}

export const isBlackjack = (cards) => cards.length === 2 && handValue(cards).total === 21;

// Endless deck: ace..9 once each, ten-valued cards (10, J, Q, K) four times.
const DRAWS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((value) => [value, value === 10 ? 4 / 13 : 1 / 13]);

const memo = new Map();
// Final totals of a dealer holding `total` (aces counted as 1) with `hasAce`.
function dealerFrom(total, hasAce) {
  const best = hasAce && total + 10 <= 21 ? total + 10 : total;
  if (best > 21) return { bust: 1 };
  if (best >= 17) return { [best]: 1 };
  const key = `${total}:${hasAce}`;
  if (memo.has(key)) return memo.get(key);
  const result = {};
  for (const [value, chance] of DRAWS) {
    for (const [end, p] of Object.entries(dealerFrom(total + value, hasAce || value === 1))) {
      result[end] = (result[end] ?? 0) + chance * p;
    }
  }
  memo.set(key, result);
  return result;
}

/** Chances of the dealer's final totals ("17".."21", "bust") when the up card is `upCard`. */
export function dealerOdds(upCard) {
  const value = cardValue(upCard);
  return dealerFrom(value, value === 1);
}

/** Win / draw / loss chances when the player stands on `cards` against `upCard`. */
export function standOdds(cards, upCard) {
  const { total } = handValue(cards);
  if (total > 21) return { win: 0, push: 0, lose: 1 };
  const odds = dealerOdds(upCard);
  let win = odds.bust ?? 0;
  for (let end = 17; end < total; end += 1) win += odds[end] ?? 0;
  const push = odds[total] ?? 0;
  return { win, push, lose: Math.max(0, 1 - win - push) };
}

/** Chance that one more card busts the hand, after luck has had its go. */
export function bustChance(cards, luckPercent = 0) {
  const { total, soft } = handValue(cards);
  if (soft) return 0;
  const raw = DRAWS.filter(([value]) => total + value > 21).reduce((sum, [, chance]) => sum + chance, 0);
  const save = Math.min(1, luckPercent / 100);
  return raw * (1 - save * (1 - raw));
}

/** A new hand: two cards each. */
export function deal(bet, random = Math.random) {
  return { bet, player: [drawCard(random), drawCard(random)], dealer: [drawCard(random), drawCard(random)], saves: 0, doubled: false };
}

/** Draw one card for the player; luck may swap a busting card once. Mutates `game`. */
export function hit(game, luckPercent, random = Math.random) {
  let card = drawCard(random);
  if (handValue([...game.player, card]).total > 21 && random() < luckPercent / 100) {
    card = drawCard(random);
    game.saves += 1;
  }
  game.player.push(card);
  return card;
}

/** The dealer draws to 17. Mutates `game`. */
export function dealerPlay(game, random = Math.random) {
  while (handValue(game.dealer).total < 17) game.dealer.push(drawCard(random));
}

/**
 * Result of a finished hand: 'blackjack' | 'win' | 'push' | 'lose', and what goes back to
 * the wallet (the bet was taken when the game started).
 */
export function settle(game) {
  const player = handValue(game.player).total;
  const dealer = handValue(game.dealer).total;
  const playerNatural = isBlackjack(game.player) && !game.doubled;
  const dealerNatural = isBlackjack(game.dealer);
  let outcome;
  if (player > 21) outcome = 'lose';
  else if (playerNatural && !dealerNatural) outcome = 'blackjack';
  else if (dealer > 21 || player > dealer) outcome = 'win';
  else if (player === dealer) outcome = 'push';
  else outcome = 'lose';
  const payout = { blackjack: Math.floor(game.bet * 2.5), win: game.bet * 2, push: game.bet, lose: 0 }[outcome];
  return { outcome, payout, player, dealer };
}
