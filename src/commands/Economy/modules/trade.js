// trade.js — /wymiana: two members swap Club'o'mony cards and money (2026-10-26).
// Fish are sold the moment they are caught, so only cards and money can change hands.
//
// The offer is posted in the channel with buttons (interactions/buttons/economy/trade.js):
//   wymiana:ok:<offerId>      the partner accepts: everything is checked again and swapped at once
//   wymiana:nie:<offerId>     the partner declines
//   wymiana:anuluj:<offerId>  the author withdraws it
// Offers live in memory for OFFER_TTL_MS; after a restart the buttons say the offer is gone.
// Both accounts are read without the joint bank of a marriage (own cash and own bank only).
//
// Open offers (2026-10-27, owner picked "card auctions" but "jako trade zwykłe"): /wymiana without a person
// is offered to everyone in the channel for OPEN_OFFER_TTL_MS; the first member who accepts and has the
// wanted part gets the trade (sell a card for money, buy one, or swap). No Decline button on those.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createEmbed } from '../../../utils/embeds.js';
import { createError, ErrorTypes } from '../../../utils/errorHandler.js';
import { getEconomyData, setEconomyData } from '../../../utils/economy.js';
import { getEconomySettings, money } from '../../../services/economySettings.js';
import { spendMoney, withEconomyLock } from '../../../services/economyUpgrades.js';
import { CARDS, VARIANTS, addTo, cardValue, getCard, indexKey, parseIndexKey } from '../../../services/collections.js';
import { progressEmbeds, recordProgress } from '../../../services/progress.js';
import { fold } from './buy.js';
import { t, tr } from '../../../i18n/index.js';

export const OFFER_TTL_MS = 15 * 60 * 1000;
export const OPEN_OFFER_TTL_MS = 60 * 60 * 1000;
const offers = new Map(); // offerId -> offer
let lastId = 0;

const wealth = (userData) => Math.max(0, Math.floor(userData.wallet || 0)) + Math.max(0, Math.floor(userData.bank || 0));

/** "🟨 Iwi (golden version)" */
export function cardLabel(key) {
  const { id, variant } = parseIndexKey(key);
  const card = getCard(id);
  if (!card) return key;
  return `${variant.emoji || card.emoji} ${card.name}${variant.label ? ` (${tr(variant.label)})` : ''}`;
}

const isCardKey = (key) => Boolean(key && getCard(parseIndexKey(key).id));

/** Cards of a member for the autocomplete: `[{ name, value }]`, at most 25, filtered by `query`. */
export function cardChoices(userData, query = '') {
  const wanted = fold(query);
  return Object.entries(userData?.cards ?? {})
    .filter(([key, count]) => count > 0 && isCardKey(key))
    .map(([key, count]) => ({ key, count, label: cardLabel(key), value: cardValue(getCard(parseIndexKey(key).id), parseIndexKey(key).variant) }))
    .filter((entry) => !wanted || fold(entry.label).includes(wanted))
    .sort((a, b) => b.value - a.value)
    .slice(0, 25)
    .map((entry) => ({ name: `${entry.label} ×${entry.count}`.slice(0, 100), value: entry.key }));
}

/** Every card in every version, for the wanted card of an open offer: `[{ name, value }]`, at most 25. */
export function catalogChoices(query = '') {
  const wanted = fold(query);
  return CARDS.flatMap((card) => VARIANTS.map((variant) => ({ key: indexKey(card.id, variant), value: cardValue(card, variant) })))
    .map((entry) => ({ ...entry, label: cardLabel(entry.key) }))
    .filter((entry) => !wanted || fold(entry.label).includes(wanted))
    .sort((a, b) => b.value - a.value)
    .slice(0, 25)
    .map((entry) => ({ name: entry.label.slice(0, 100), value: entry.key }));
}

function sideText(guildId, side) {
  const parts = [];
  if (side.card) parts.push(`🃏 ${cardLabel(side.card)}`);
  if (side.money > 0) parts.push(`💵 ${money(guildId, side.money)}`);
  return parts.length ? parts.join('\n') : t('nothing');
}

/** Why one side cannot give its part, or null. */
function missingPart(guildId, userData, side, name) {
  if (side.card && !((userData.cards ?? {})[side.card] > 0)) return t`${name} no longer has ${cardLabel(side.card)}.`;
  if (side.money > 0 && wealth(userData) < side.money) return t`${name} does not have ${money(guildId, side.money)} (cash and bank).`;
  return null;
}

function offerButtons(offerId, { disabled = false, open = false } = {}) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`wymiana:ok:${offerId}`).setLabel(t('Accept')).setEmoji('🤝').setStyle(ButtonStyle.Success).setDisabled(disabled),
    ...(open ? [] : [new ButtonBuilder().setCustomId(`wymiana:nie:${offerId}`).setLabel(t('Decline')).setStyle(ButtonStyle.Danger).setDisabled(disabled)]),
    new ButtonBuilder().setCustomId(`wymiana:anuluj:${offerId}`).setLabel(t('Withdraw')).setStyle(ButtonStyle.Secondary).setDisabled(disabled),
  )];
}

function offerEmbed(guildId, offer, { title, note = '', color = '#5865F2' }) {
  return createEmbed({
    title,
    description: note,
    color,
    footer: false,
  }).addFields(
    { name: t`${offer.fromName} gives`, value: sideText(guildId, offer.give), inline: true },
    { name: offer.toName ? t`${offer.toName} gives` : t('Whoever accepts gives'), value: sideText(guildId, offer.want), inline: true },
  );
}

/**
 * /wymiana: check the offer and post it. `give` / `want` = { card: indexKey | null, money: number }.
 * `to` null = an open offer for everyone. Returns the public message payload.
 */
export async function createOffer({ client, guildId, from, to = null, give, want, now = Date.now() }) {
  if (to && (to.bot || to.id === from.id)) {
    throw createError('Bad trade partner', ErrorTypes.VALIDATION, t('Pick another member to trade with.'), { expected: true });
  }
  if (!give.card && !want.card && !(give.money > 0) && !(want.money > 0)) {
    throw createError('Empty trade', ErrorTypes.VALIDATION, t('Add a card or money to the offer.'), { expected: true });
  }
  if (give.money > 0 && want.money > 0) {
    throw createError('Money both ways', ErrorTypes.VALIDATION, t('Money can go only one way in a trade.'), { expected: true });
  }
  for (const key of [give.card, want.card]) {
    if (key && !isCardKey(key)) throw createError('Unknown card', ErrorTypes.VALIDATION, t('Pick a card from the list.'), { key, expected: true });
  }
  await getEconomySettings(guildId);
  const fromData = await getEconomyData(client, guildId, from.id, { joint: false });
  const toData = to ? await getEconomyData(client, guildId, to.id, { joint: false }) : null;
  const problem = missingPart(guildId, fromData, give, from.username) ?? (to ? missingPart(guildId, toData, want, to.username) : null);
  if (problem) throw createError('Trade not possible', ErrorTypes.VALIDATION, problem, { expected: true });

  for (const [id, offer] of offers) if (now > offer.expiresAt) offers.delete(id);
  lastId = (lastId + 1) % 1_000_000;
  const offerId = `${now.toString(36)}${lastId.toString(36)}`;
  const open = !to;
  const expiresAt = now + (open ? OPEN_OFFER_TTL_MS : OFFER_TTL_MS);
  const offer = {
    id: offerId, guildId, fromId: from.id, toId: to?.id ?? null, fromName: from.username, toName: to?.username ?? null,
    give, want, open, createdAt: now, expiresAt,
  };
  offers.set(offerId, offer);

  const lastCopy = give.card && (fromData.cards?.[give.card] ?? 0) === 1 ? t('\n-# This is your last copy of the card.') : '';
  const until = Math.floor(expiresAt / 1000);
  if (open) {
    return {
      content: '',
      embeds: [offerEmbed(guildId, offer, {
        title: t('🤝 Trade offer for everyone'),
        note: t`**${from.username}** offers a trade to everyone here. The first to accept gets it, until <t:${until}:t>.` + lastCopy,
      })],
      components: offerButtons(offerId, { open: true }),
      allowedMentions: { parse: [] },
    };
  }
  return {
    content: `<@${to.id}>`,
    embeds: [offerEmbed(guildId, offer, {
      title: t('🤝 Trade offer'),
      note: t`**${from.username}** offers **${to.username}** a trade. Only ${to.username} can accept, until <t:${until}:t>.` + lastCopy,
    })],
    components: offerButtons(offerId),
    allowedMentions: { users: [to.id] },
  };
}

export const getOffer = (offerId, now = Date.now()) => {
  const offer = offers.get(offerId);
  if (!offer || now > offer.expiresAt) return null;
  return offer;
};

/** Close the offer without a trade. Returns the message payload. */
export function closeOffer(offer, reason) {
  offers.delete(offer.id);
  const title = reason === 'declined' ? t('🤝 Trade declined') : t('🤝 Trade withdrawn');
  return { content: '', embeds: [offerEmbed(offer.guildId, offer, { title, color: '#8E8E93' })], components: offerButtons(offer.id, { disabled: true, open: offer.open }) };
}

function withBothLocks(guildId, firstId, secondId, task) {
  const [a, b] = [firstId, secondId].sort();
  return withEconomyLock(guildId, a, () => withEconomyLock(guildId, b, task));
}

/**
 * The partner (or, for an open offer, `taker` = { id, username }) accepted: check both sides again and swap.
 * Returns the message payload, `{ notice }` when the taker of an open offer lacks their part, or null when the
 * offer is already gone.
 */
export function acceptOffer({ client, offer, taker = null, now = Date.now() }) {
  const { guildId } = offer;
  const toId = offer.open ? taker.id : offer.toId;
  const toName = offer.open ? taker.username : offer.toName;
  return withBothLocks(guildId, offer.fromId, toId, async () => {
    if (!offers.has(offer.id)) return null;
    const settings = await getEconomySettings(guildId);
    const fromData = await getEconomyData(client, guildId, offer.fromId, { joint: false });
    const toData = await getEconomyData(client, guildId, toId, { joint: false });
    const authorProblem = missingPart(guildId, fromData, offer.give, offer.fromName);
    const takerProblem = missingPart(guildId, toData, offer.want, toName);
    if (offer.open && !authorProblem && takerProblem) return { notice: takerProblem };
    if (offer.open) Object.assign(offer, { toId, toName });
    const problem = authorProblem ?? takerProblem;
    if (problem) {
      offers.delete(offer.id);
      return { content: '', embeds: [offerEmbed(guildId, offer, { title: t('🤝 Trade failed'), note: `❌ ${problem}`, color: '#FF453A' })], components: offerButtons(offer.id, { disabled: true, open: offer.open }) };
    }

    const move = (side, giver, taker) => {
      if (side.card) {
        giver.cards = addTo(giver.cards, side.card, -1);
        taker.cards = addTo(taker.cards, side.card, 1);
      }
      if (side.money > 0) {
        spendMoney(giver, side.money);
        taker.wallet = (taker.wallet || 0) + side.money;
      }
    };
    move(offer.give, fromData, toData);
    move(offer.want, toData, fromData);
    const fromProgress = recordProgress(fromData, { trades: 1 }, { settings, now });
    const toProgress = recordProgress(toData, { trades: 1 }, { settings, now });
    await setEconomyData(client, guildId, offer.fromId, fromData);
    await setEconomyData(client, guildId, toId, toData);
    offers.delete(offer.id);

    return {
      content: offer.open ? `<@${offer.fromId}>` : '',
      allowedMentions: { users: offer.open ? [offer.fromId] : [] },
      embeds: [
        offerEmbed(guildId, offer, { title: t('✅ Trade done'), color: '#30D158' }),
        ...progressEmbeds(fromProgress, guildId),
        ...progressEmbeds(toProgress, guildId),
      ],
      components: [],
    };
  });
}
