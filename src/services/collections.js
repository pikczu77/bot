// collections.js — the two things members collect, both shown in /index (2026-10-15):
//   Club'o'mony cards: bought in packs with /paczka, kept, sold back at their value.
//   Fish: every /fish catch is recorded (the fish itself is sold at once).
// Both come in three versions: normal, golden (x1.2 value) and diamond (x1.6 value).
//
// Stored in a member's economy data:
//   cards:     { "<cardId>" | "<cardId>:golden" | "<cardId>:diamond": count }
//   fishIndex: { "<fishId>" | "<fishId>:golden" | "<fishId>:diamond": times caught }
//
// Packs are a money sink with a chance to get rich: the average value of a pack's cards is
// below its price (about 84% / 88% / 92%), while a legendary card is worth 10-20 starter packs.
// Card values are fixed: no server multiplier, no Fortune, no Discount.

import { t } from '../i18n/index.js';

export const RARITIES = [
  { id: 'common', emoji: '⚪', label: t('Common'), color: '#95A5A6' },
  { id: 'uncommon', emoji: '🟢', label: t('Uncommon'), color: '#2ECC71' },
  { id: 'rare', emoji: '🔵', label: t('Rare'), color: '#3498DB' },
  { id: 'epic', emoji: '🟣', label: t('Epic'), color: '#9B59B6' },
  { id: 'legendary', emoji: '🟡', label: t('Legendary'), color: '#F1C40F' },
];
export const rarityOf = (id) => RARITIES.find((rarity) => rarity.id === id) ?? RARITIES[0];

export const VARIANTS = [
  { id: 'normal', chance: 0.94, multiplier: 1, emoji: '', label: null },
  { id: 'golden', chance: 0.05, multiplier: 1.2, emoji: '🟨', label: t('golden version') },
  { id: 'diamond', chance: 0.01, multiplier: 1.6, emoji: '💎', label: t('diamond version') },
];
export const variantOf = (id) => VARIANTS.find((variant) => variant.id === id) ?? VARIANTS[0];

// ---------------------------------------------------------------- fish

/** Chance of each fish rarity and what it does to the /fish pay (average ≈ x1). */
export const FISH_RARITY_CHANCES = { common: 0.5, uncommon: 0.25, rare: 0.15, epic: 0.08, legendary: 0.02 };
export const FISH_PAY_MULTIPLIERS = { common: 0.4, uncommon: 0.8, rare: 1.5, epic: 3, legendary: 8 };

export const FISH = [
  { id: 'bass', emoji: '🐟', name: t('Bass'), rarity: 'common' },
  { id: 'salmon', emoji: '🐟', name: t('Salmon'), rarity: 'common' },
  { id: 'trout', emoji: '🐟', name: t('Trout'), rarity: 'common' },
  { id: 'carp', emoji: '🐟', name: t('Carp'), rarity: 'common' },
  { id: 'herring', emoji: '🐟', name: t('Herring'), rarity: 'common' },
  { id: 'roach', emoji: '🐟', name: t('Roach'), rarity: 'common' },
  { id: 'tuna', emoji: '🐠', name: t('Tuna'), rarity: 'uncommon' },
  { id: 'swordfish', emoji: '🐠', name: t('Swordfish'), rarity: 'uncommon' },
  { id: 'pike', emoji: '🐠', name: t('Pike'), rarity: 'uncommon' },
  { id: 'catfish', emoji: '🐠', name: t('Catfish'), rarity: 'uncommon' },
  { id: 'octopus', emoji: '🐙', name: t('Octopus'), rarity: 'rare' },
  { id: 'lobster', emoji: '🦞', name: t('Lobster'), rarity: 'rare' },
  { id: 'pufferfish', emoji: '🐡', name: t('Pufferfish'), rarity: 'rare' },
  { id: 'crab', emoji: '🦀', name: t('Crab'), rarity: 'rare' },
  { id: 'shark', emoji: '🦈', name: t('Shark'), rarity: 'epic' },
  { id: 'manta', emoji: '🌊', name: t('Manta Ray'), rarity: 'epic' },
  { id: 'squid', emoji: '🦑', name: t('Giant Squid'), rarity: 'epic' },
  { id: 'whale', emoji: '🐋', name: t('Whale'), rarity: 'legendary' },
  { id: 'megalodon', emoji: '🦈', name: t('Megalodon'), rarity: 'legendary' },
  { id: 'kraken', emoji: '🐙', name: t('Kraken'), rarity: 'legendary' },
];

// ---------------------------------------------------------------- Club'o'mony cards

// value = what the card sells for; weight = how often it comes within its rarity.
// Names are proper names, the same in every language.
export const CARDS = [
  { id: 'bulwazaur', emoji: '🥔', name: 'Bulwazaur', rarity: 'common', value: 2, weight: 3 },
  { id: 'skwirtel', emoji: '💧', name: 'Skwirtel', rarity: 'common', value: 2, weight: 3 },
  { id: 'gasienik', emoji: '🐛', name: 'Gąsienik', rarity: 'common', value: 2, weight: 3 },
  { id: 'zapalnik', emoji: '🔥', name: 'Zapalniczek', rarity: 'common', value: 3, weight: 3 },
  { id: 'szczurata', emoji: '🐀', name: 'Szczurata', rarity: 'common', value: 3, weight: 2 },
  { id: 'golabek', emoji: '🐦', name: 'Gołąbek', rarity: 'common', value: 4, weight: 2 },
  { id: 'karpik', emoji: '🐟', name: 'Karpik Wigilijny', rarity: 'common', value: 5, weight: 1 },
  { id: 'pufcia', emoji: '🎤', name: 'Pufcia', rarity: 'uncommon', value: 800, weight: 3 },
  { id: 'kaczka', emoji: '🦆', name: 'Kaczka Dziwaczka', rarity: 'uncommon', value: 900, weight: 3 },
  { id: 'mialczur', emoji: '🐱', name: 'Miałczur', rarity: 'uncommon', value: 1_000, weight: 2 },
  { id: 'spioch', emoji: '😴', name: 'Śpioch', rarity: 'uncommon', value: 1_200, weight: 2 },
  { id: 'gengarek', emoji: '👻', name: 'Gengarek', rarity: 'rare', value: 2_500, weight: 3 },
  { id: 'iwi', emoji: '🦊', name: 'Iwi', rarity: 'rare', value: 3_000, weight: 3 },
  { id: 'lapras', emoji: '🐢', name: 'Łapras', rarity: 'rare', value: 3_500, weight: 2 },
  { id: 'smokokarp', emoji: '🐉', name: 'Smokokarp', rarity: 'rare', value: 4_000, weight: 2 },
  { id: 'czaryzard', emoji: '🐲', name: 'Czaryzard', rarity: 'epic', value: 6_000, weight: 3 },
  { id: 'hokus', emoji: '🥄', name: 'Hokuspokus', rarity: 'epic', value: 8_000, weight: 2 },
  { id: 'smoczus', emoji: '🦖', name: 'Smoczuś', rarity: 'epic', value: 10_000, weight: 1 },
  { id: 'miaudwa', emoji: '🧬', name: 'Miau-Dwa', rarity: 'legendary', value: 15_000, weight: 3 },
  { id: 'miau', emoji: '💗', name: 'Miau', rarity: 'legendary', value: 20_000, weight: 2 },
  { id: 'krolpikczu', emoji: '👑', name: 'Król Pikczu', rarity: 'legendary', value: 30_000, weight: 1 },
];
export const getCard = (id) => CARDS.find((card) => card.id === id) ?? null;

// Chance of each rarity for every card in the pack, in percent (each row sums to 100).
export const PACKS = [
  { id: 'startowa', emoji: '📦', name: t('Starter Pack'), price: 1_500, cards: 1,
    odds: { common: 46, uncommon: 34, rare: 15, epic: 4.4, legendary: 0.6 } },
  { id: 'kolekcjonera', emoji: '🎁', name: t('Collector Pack'), price: 5_000, cards: 2,
    odds: { common: 30, uncommon: 33, rare: 25.5, epic: 9.8, legendary: 1.7 } },
  { id: 'legend', emoji: '👑', name: t('Legend Pack'), price: 10_000, cards: 3,
    odds: { common: 21, uncommon: 31, rare: 30, epic: 14.2, legendary: 3.8 } },
];
export const getPack = (id) => PACKS.find((pack) => pack.id === id) ?? null;

// ---------------------------------------------------------------- rolls

/** Pick from `{ id: chance }` (any scale). */
export function rollFrom(chances, random = Math.random) {
  const entries = Object.entries(chances);
  const total = entries.reduce((sum, [, chance]) => sum + chance, 0);
  let roll = random() * total;
  for (const [id, chance] of entries) {
    roll -= chance;
    if (roll < 0) return id;
  }
  return entries[entries.length - 1][0];
}

export const rollVariant = (random = Math.random) =>
  variantOf(rollFrom(Object.fromEntries(VARIANTS.map((variant) => [variant.id, variant.chance])), random));

function pickWeighted(list, random) {
  const total = list.reduce((sum, entry) => sum + (entry.weight ?? 1), 0);
  let roll = random() * total;
  for (const entry of list) {
    roll -= entry.weight ?? 1;
    if (roll < 0) return entry;
  }
  return list[list.length - 1];
}

/** One fish: `{ fish, variant }`. */
export function rollFish(random = Math.random) {
  const rarity = rollFrom(FISH_RARITY_CHANCES, random);
  const fish = pickWeighted(FISH.filter((entry) => entry.rarity === rarity), random);
  return { fish, variant: rollVariant(random) };
}

export const cardValue = (card, variant = VARIANTS[0]) => Math.round(card.value * variant.multiplier);

/** One card of `pack`: `{ card, variant, value }`. */
export function rollCard(pack, random = Math.random) {
  const rarity = rollFrom(pack.odds, random);
  const card = pickWeighted(CARDS.filter((entry) => entry.rarity === rarity), random);
  const variant = rollVariant(random);
  return { card, variant, value: cardValue(card, variant) };
}

/** Average value of the cards in one pack (for the guide and the balance test). */
export function packExpectedValue(pack) {
  const variantFactor = VARIANTS.reduce((sum, variant) => sum + variant.chance * variant.multiplier, 0);
  const perCard = RARITIES.reduce((sum, rarity) => {
    const cards = CARDS.filter((card) => card.rarity === rarity.id);
    const weights = cards.reduce((total, card) => total + card.weight, 0);
    const average = cards.reduce((total, card) => total + card.value * card.weight, 0) / weights;
    return sum + (pack.odds[rarity.id] ?? 0) / 100 * average;
  }, 0);
  return perCard * variantFactor * pack.cards;
}

/** Chance that a pack holds at least one legendary card. */
export const packLegendaryChance = (pack) => 1 - (1 - (pack.odds.legendary ?? 0) / 100) ** pack.cards;

// ---------------------------------------------------------------- stored index

export const indexKey = (id, variant = VARIANTS[0]) => (variant.id === 'normal' ? id : `${id}:${variant.id}`);

export function parseIndexKey(key) {
  const [id, variantId = 'normal'] = String(key).split(':');
  return { id, variant: variantOf(variantId) };
}

/** Add `count` to `map[key]` (a fresh object; the input is not changed). */
export const addTo = (map, key, count = 1) => ({ ...(map || {}), [key]: Math.max(0, ((map || {})[key] || 0) + count) });

/** Every version of `id` the member has: `[{ variant, count }]`, normal first. */
export const versionsOf = (map, id) => VARIANTS
  .map((variant) => ({ variant, count: (map || {})[indexKey(id, variant)] || 0 }))
  .filter((entry) => entry.count > 0);

/** True when the member has `id` in any version. */
export const hasAny = (map, id) => versionsOf(map, id).length > 0;
