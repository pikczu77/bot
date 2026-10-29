// cardMerge.js — /polacz (2026-10-29, owner picked idea 4): five copies of one card (the same version) become one
// random card of the next rarity, in the same version (golden stays golden). Legendary cards cannot be merged.
// Five commons (about $10) give an uncommon (about $1,000); higher up a merge is worth less than the five cards,
// so it is a way to use duplicates and fill /index, not a money machine.

import { getEconomyData, setEconomyData } from '../utils/economy.js';
import { t } from '../i18n/index.js';
import { CARDS, RARITIES, addTo, cardValue, getCard, indexKey, parseIndexKey, rarityOf, rollFrom } from './collections.js';
import { withEconomyLock } from './economyUpgrades.js';
import { recordProgress } from './progress.js';
import { getEconomySettings } from './economySettings.js';

export const MERGE_COUNT = 5;
export const MAX_MERGES = 20;

/** The rarity a card merges into, or null for legendary. */
export function nextRarity(rarityId) {
  const index = RARITIES.findIndex((rarity) => rarity.id === rarityId);
  return index >= 0 && index < RARITIES.length - 1 ? RARITIES[index + 1] : null;
}

/** Cards a member can merge now, for the autocomplete: [{ key, card, variant, count }]. */
export function mergeableCards(userData) {
  return Object.entries(userData?.cards ?? {})
    .map(([key, count]) => ({ key, count: Number(count) || 0, ...parseIndexKey(key) }))
    .map((entry) => ({ ...entry, card: getCard(entry.id) }))
    .filter((entry) => entry.card && entry.count >= MERGE_COUNT && nextRarity(entry.card.rarity));
}

/**
 * Merge `times` x MERGE_COUNT copies of `cardKey`. Returns { card, variant, used, results: [{ card, variant, value, isNew }],
 * rarity, progress }. Throws `userError(text)` when not possible.
 */
export async function mergeCards({ client, guildId, userId, cardKey, times = 1, userError, random = Math.random, now = Date.now() }) {
  const { id, variant } = parseIndexKey(cardKey ?? '');
  const card = getCard(id);
  if (!card) throw userError(t('Pick a card from the list.'));
  const rarity = nextRarity(card.rarity);
  if (!rarity) throw userError(t`${card.emoji} ${card.name} is legendary: it cannot be merged any higher.`);
  const count = Math.max(1, Math.min(MAX_MERGES, Math.floor(Number(times) || 1)));
  return withEconomyLock(guildId, userId, async () => {
    const settings = await getEconomySettings(guildId);
    const userData = await getEconomyData(client, guildId, userId, { joint: false });
    const held = Number(userData.cards?.[cardKey]) || 0;
    const need = count * MERGE_COUNT;
    if (held < need) throw userError(t`You need ${need} copies of ${card.emoji} ${card.name} - you have ${held}.`);
    userData.cards = addTo(userData.cards, cardKey, -need);
    const pool = Object.fromEntries(CARDS.filter((entry) => entry.rarity === rarity.id).map((entry) => [entry.id, entry.weight]));
    const results = [];
    for (let step = 0; step < count; step += 1) {
      const result = getCard(rollFrom(pool, random));
      const key = indexKey(result.id, variant);
      const isNew = !(Number(userData.cards?.[key]) > 0);
      userData.cards = addTo(userData.cards, key, 1);
      results.push({ card: result, variant, value: cardValue(result, variant), isNew });
    }
    const progress = recordProgress(userData, { merges: count }, { settings, now });
    await setEconomyData(client, guildId, userId, userData);
    return { card, variant, used: need, results, rarity: rarityOf(rarity.id), progress };
  });
}
