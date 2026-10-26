// collection_view.js — Club'o'mony packs (/paczka) and the collection book (/index).
// Data and odds: services/collections.js. Buttons: interactions/buttons/economy/collection.js
// (custom ids paczka:*, index:*), sell menu: interactions/selectMenus/economy/index.js.
//
// Custom ids cannot hold ":" inside an argument, so a card version is written as
// "<cardId>" / "<cardId>_g" (golden) / "<cardId>_d" (diamond) there.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { createEmbed } from '../../../utils/embeds.js';
import { createError, ErrorTypes } from '../../../utils/errorHandler.js';
import { getEconomyData, setEconomyData } from '../../../utils/economy.js';
import { cachedEconomySettings, getEconomySettings, money } from '../../../services/economySettings.js';
import { spendMoney, withEconomyLock } from '../../../services/economyUpgrades.js';
import { assertNotJailed } from '../../../services/economyJail.js';
import {
  CARDS, FISH, FULL_CARDS_BONUS_PERCENT, FULL_FISH_BONUS_PERCENT, PACKS, RARITIES, addTo, cardValue, getCard, getPack,
  hasAllCards, hasAny, indexKey, packExpectedValue, packLegendaryChance, parseIndexKey, rarityOf, rollCard, variantOf, versionsOf,
} from '../../../services/collections.js';
import { t, tr } from '../../../i18n/index.js';
import { progressEmbeds, recordProgress } from '../../../services/progress.js';
import { eventLine, eventPackPrice } from '../../../services/economyEvents.js';

const SHORT = { normal: '', golden: '_g', diamond: '_d' };
const encodeKey = (key) => { const { id, variant } = parseIndexKey(key); return `${id}${SHORT[variant.id]}`; };
export function decodeKey(code) {
  const match = /^([a-z0-9]+?)(?:_([gd]))?$/.exec(String(code));
  if (!match || !getCard(match[1])) return null;
  return indexKey(match[1], variantOf({ g: 'golden', d: 'diamond' }[match[2]] ?? 'normal'));
}

const versionText = (variant) => (variant.label ? ` ${variant.emoji} *${tr(variant.label)}*` : '');
const percent = (value) => `${Number((value * 100).toFixed(value < 0.01 ? 2 : 1))}%`;

/** What a pack costs on this server right now (half during the "paczki" event). */
export const packPrice = (guildId, pack) => eventPackPrice(cachedEconomySettings(guildId), pack.price);

/** "📦 Starter Pack" */
export const packLabel = (pack) => `${pack.emoji} ${tr(pack.name)}`;

// ---------------------------------------------------------------- actions

/**
 * Buy and open a pack. Pays from cash first, then the bank. Blocked in jail.
 * @returns {Promise<{ pack, drawn: Array<{ card, variant, value, key, isNew }>, userData }>}
 */
export function openPack({ client, guildId, userId, packId, random = Math.random }) {
  const pack = getPack(packId);
  if (!pack) throw createError('Unknown pack', ErrorTypes.VALIDATION, t('This pack does not exist.'), { packId, expected: true });

  return withEconomyLock(guildId, userId, async () => {
    const settings = await getEconomySettings(guildId);
    const userData = await getEconomyData(client, guildId, userId);
    assertNotJailed(userData, Date.now(), { settings, guildId });
    const price = eventPackPrice(settings, pack.price);
    if (!spendMoney(userData, price)) {
      throw createError('Not enough money for a pack', ErrorTypes.VALIDATION,
        t`❌ **${packLabel(pack)}** costs **${money(guildId, price)}** - you do not have that much (cash and bank).`,
        { packId, expected: true });
    }

    const drawn = [];
    for (let index = 0; index < pack.cards; index += 1) {
      const roll = rollCard(pack, random);
      const isNew = !hasAny(userData.cards, roll.card.id);
      const key = indexKey(roll.card.id, roll.variant);
      userData.cards = addTo(userData.cards, key);
      drawn.push({ ...roll, key, isNew });
    }
    const progress = recordProgress(userData, { packs: 1 }, { settings });
    await setEconomyData(client, guildId, userId, userData);
    return { pack, drawn, userData, progress };
  });
}

/**
 * Sell one copy of each of `keys` the member still has (a key may repeat).
 * @returns {Promise<{ total: number, count: number, userData }>}
 */
export function sellCards({ client, guildId, userId, keys }) {
  return withEconomyLock(guildId, userId, async () => {
    await getEconomySettings(guildId);
    const userData = await getEconomyData(client, guildId, userId);
    let total = 0;
    let count = 0;
    for (const key of keys) {
      const { id, variant } = parseIndexKey(key);
      const card = getCard(id);
      if (!card || !((userData.cards || {})[key] > 0)) continue;
      userData.cards = addTo(userData.cards, key, -1);
      total += cardValue(card, variant);
      count += 1;
    }
    if (count > 0) {
      userData.wallet = (userData.wallet || 0) + total;
      await setEconomyData(client, guildId, userId, userData);
    }
    return { total, count, userData };
  });
}

/** Every extra copy: keeps one of each card version. */
export function duplicateKeys(cards) {
  return Object.entries(cards || {}).flatMap(([key, count]) => (getCard(parseIndexKey(key).id) && count > 1 ? Array(count - 1).fill(key) : []));
}

const keyValue = (key) => { const { id, variant } = parseIndexKey(key); const card = getCard(id); return card ? cardValue(card, variant) : 0; };

// ---------------------------------------------------------------- pack views

function packButtons(ownerId, guildId, { sellKeys = [], soldTotal = null } = {}) {
  const row = new ActionRowBuilder();
  if (sellKeys.length || soldTotal !== null) {
    const total = sellKeys.reduce((sum, key) => sum + keyValue(key), 0);
    row.addComponents(new ButtonBuilder()
      .setCustomId(`paczka:sprzedaj:${ownerId}:${sellKeys.map(encodeKey).join('.') || 'x'}`)
      .setLabel(soldTotal !== null ? t`Sold for ${money(guildId, soldTotal)}` : t`Sell these cards (${money(guildId, total)})`)
      .setEmoji(soldTotal !== null ? '✅' : '💰')
      .setStyle(ButtonStyle.Success)
      .setDisabled(soldTotal !== null));
  }
  row.addComponents(new ButtonBuilder()
    .setCustomId(`index:pokaz:${ownerId}:${ownerId}:karty`)
    .setLabel(t('Your index'))
    .setEmoji('📖')
    .setStyle(ButtonStyle.Secondary));
  const packs = new ActionRowBuilder().addComponents(PACKS.map((pack) => new ButtonBuilder()
    .setCustomId(`paczka:otworz:${ownerId}:${pack.id}`)
    .setLabel(`${tr(pack.name)} · ${money(guildId, packPrice(guildId, pack))}`)
    .setEmoji(pack.emoji)
    .setStyle(ButtonStyle.Primary)));
  return [row, packs];
}

/** /paczka without a choice: the three packs with their odds. */
export function buildPackShop({ guildId, ownerId, userData, notice = '' }) {
  const fields = PACKS.map((pack) => ({
    name: `${packLabel(pack)} · ${money(guildId, packPrice(guildId, pack))}`,
    value: t`**${pack.cards}** {0|card|cards}\nlegendary: **${percent(packLegendaryChance(pack))}** a pack\nreturn on average: **${Math.round(packExpectedValue(pack) / pack.price * 100)}%**`,
    inline: true,
  }));
  const embed = createEmbed({
    title: t("🎴 Club'o'mony packs"),
    description: (notice ? `${notice}\n\n` : '') + t`Open a pack, collect the cards in \`/index\` and sell them when you want.\nA common card is worth **${money(guildId, 2)}**, a legendary one **${money(guildId, 15_000)} - ${money(guildId, 30_000)}**.\n-# 🟨 golden version x1.2 · 💎 diamond version x1.6\n💵 **${money(guildId, userData.wallet || 0)}** · 🏦 **${money(guildId, userData.bank || 0)}**`,
    fields,
    color: '#F1C40F',
  });
  return { embeds: [embed], components: ownerId ? packButtons(ownerId, guildId).slice(1) : [] };
}

/** What came out of a pack. */
export function buildPackView({ guildId, ownerId, pack, drawn, userData, soldTotal = null, progress = null }) {
  const best = drawn.reduce((top, entry) => (RARITIES.findIndex((r) => r.id === entry.card.rarity) > RARITIES.findIndex((r) => r.id === top.card.rarity) ? entry : top), drawn[0]);
  const lines = drawn.map(({ card, variant, value, isNew }) => {
    const rarity = rarityOf(card.rarity);
    return `${rarity.emoji} ${card.emoji} **${card.name}**${versionText(variant)} · **${money(guildId, value)}**${isNew ? t(' · ✨ NEW') : ''}\n-# ${tr(rarity.label)}`;
  });
  const total = drawn.reduce((sum, entry) => sum + entry.value, 0);
  const embed = createEmbed({
    title: t`🎴 ${packLabel(pack)} opened!`,
    description: `${lines.join('\n')}\n\n${t`Cards worth **${money(guildId, total)}** (the pack cost ${money(guildId, packPrice(guildId, pack))}).`}${eventLine(cachedEconomySettings(guildId), 'pack')}\n💵 **${money(guildId, userData.wallet || 0)}** · 🏦 **${money(guildId, userData.bank || 0)}**`,
    color: rarityOf(best.card.rarity).color,
  });
  return { embeds: [embed, ...progressEmbeds(progress, guildId)], components: packButtons(ownerId, guildId, { sellKeys: soldTotal === null ? drawn.map((entry) => entry.key) : [], soldTotal }) };
}

// ---------------------------------------------------------------- /index

function cardLine(guildId, cards, card) {
  const versions = versionsOf(cards, card.id);
  if (!versions.length) return `❔ ???`;
  const counts = versions.map(({ variant, count }) => `${variant.emoji || ''}×${count}`).join(' ');
  return `${card.emoji} **${card.name}** ${counts} · ${money(guildId, card.value)}`;
}

function fishLine(fishIndex, fish) {
  const versions = versionsOf(fishIndex, fish.id);
  if (!versions.length) return `❔ ???`;
  return `${fish.emoji} **${tr(fish.name)}** ${versions.map(({ variant, count }) => `${variant.emoji || ''}×${count}`).join(' ')}`;
}

const collectionValue = (cards) => Object.entries(cards || {}).reduce((sum, [key, count]) => sum + keyValue(key) * count, 0);

/**
 * The collection book of `user`. `viewerId` is who looks at it; only the owner gets the
 * sell menu and the pack buttons. `tab` = "karty" or "ryby".
 */
export function buildIndexView({ guildId, user, viewerId, userData, tab = 'karty', notice = '' }) {
  const own = viewerId === user.id;
  const cards = userData.cards || {};
  const fishIndex = userData.fishIndex || {};
  let embed;

  if (tab === 'ryby') {
    const caught = FISH.filter((fish) => hasAny(fishIndex, fish.id)).length;
    embed = createEmbed({
      title: t`📖 Index · ${user.username ?? user.tag}`,
      description: (notice ? `${notice}\n\n` : '') + t`🎣 Fish: **${caught}/${FISH.length}** species caught with \`/fish\`.\n-# 🟨 golden fish pays x1.2 · 💎 diamond fish x1.6` +
        (caught === FISH.length
          ? t`\n✅ Full deck: **+${FULL_FISH_BONUS_PERCENT}%** from \`/fish\``
          : t`\n🔒 Full deck (all ${FISH.length}) = **+${FULL_FISH_BONUS_PERCENT}%** from \`/fish\``),
      fields: RARITIES.map((rarity) => ({
        name: `${rarity.emoji} ${tr(rarity.label)}`,
        value: FISH.filter((fish) => fish.rarity === rarity.id).map((fish) => fishLine(fishIndex, fish)).join('\n'),
        inline: true,
      })),
      color: '#3498DB',
    });
  } else {
    const collected = CARDS.filter((card) => hasAny(cards, card.id)).length;
    embed = createEmbed({
      title: t`📖 Index · ${user.username ?? user.tag}`,
      description: (notice ? `${notice}\n\n` : '') + t`🎴 Club'o'mony: **${collected}/${CARDS.length}** cards · worth **${money(guildId, collectionValue(cards))}**\n-# 🟨 golden version x1.2 · 💎 diamond version x1.6 · new cards: \`/paczka\`` +
        (collected === CARDS.length
          ? t`\n✅ All cards: **+${FULL_CARDS_BONUS_PERCENT}%** from every job`
          : t`\n🔒 All ${CARDS.length} cards = **+${FULL_CARDS_BONUS_PERCENT}%** from every job (keep one of each)`),
      fields: RARITIES.map((rarity) => ({
        name: `${rarity.emoji} ${tr(rarity.label)}`,
        value: CARDS.filter((card) => card.rarity === rarity.id).map((card) => cardLine(guildId, cards, card)).join('\n'),
        inline: true,
      })),
      color: '#F1C40F',
    });
  }

  const tabs = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`index:pokaz:${viewerId}:${user.id}:karty`).setLabel(t("Club'o'mony")).setEmoji('🎴')
      .setStyle(tab === 'karty' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(tab === 'karty'),
    new ButtonBuilder().setCustomId(`index:pokaz:${viewerId}:${user.id}:ryby`).setLabel(t('Fish')).setEmoji('🎣')
      .setStyle(tab === 'ryby' ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(tab === 'ryby'),
  );
  const components = [tabs];

  if (own && tab === 'karty') {
    const complete = hasAllCards(userData);
    const owned = Object.entries(cards)
      .filter(([key, count]) => count > 0 && getCard(parseIndexKey(key).id))
      .sort(([a], [b]) => keyValue(b) - keyValue(a))
      .slice(0, 25);
    if (owned.length) {
      components.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
        .setCustomId(`index:sprzedaj:${user.id}`)
        .setPlaceholder(t('💰 Sell one card…'))
        .addOptions(owned.map(([key, count]) => {
          const { id, variant } = parseIndexKey(key);
          const card = getCard(id);
          return {
            label: `${card.name}${variant.label ? ` (${tr(variant.label)})` : ''} ×${count}`.slice(0, 100),
            description: (complete && versionsOf(cards, id).reduce((sum, entry) => sum + entry.count, 0) === 1
              ? t`sell 1 for ${money(guildId, cardValue(card, variant))} · ⚠️ ends the +${FULL_CARDS_BONUS_PERCENT}% bonus`
              : t`sell 1 for ${money(guildId, cardValue(card, variant))}`).slice(0, 100),
            value: encodeKey(key),
            emoji: variant.emoji || card.emoji,
          };
        }))));
    }
    const duplicates = duplicateKeys(cards);
    const duplicatesTotal = duplicates.reduce((sum, key) => sum + keyValue(key), 0);
    components.push(new ActionRowBuilder().addComponents(new ButtonBuilder()
      .setCustomId(`index:duplikaty:${user.id}`)
      .setLabel(duplicates.length ? t`Sell duplicates (${duplicates.length} · ${money(guildId, duplicatesTotal)})` : t('No duplicates'))
      .setEmoji('♻️')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!duplicates.length)));
    components.push(packButtons(user.id, guildId)[1]);
  }

  return { embeds: [embed], components };
}

