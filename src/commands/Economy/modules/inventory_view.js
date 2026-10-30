// inventory_view.js — /ekwipunek and /eq (2026-10-30, owner: "zrob /ekwipunek i /eq i tam daj te wszystkie boosty, potki, rangi etc,
// niech mozna sobie wybierac jaka range sie chce miec ... daj tam eventowe i tam niech beda role do wyboru, mozna miec tylko jedna naraz").
//
// Three tabs (buttons ekwipunek:tab:<ownerId>:<tab>):
//   przedmioty — tools and other lasting items, upgrades, the job
//   boosty     — running boosts (/boosty, event shops) and one-use items ("potki": energy drink, clovers, ...)
//   eventowe   — event currencies and the event ranks; menu ekwipunek:ranga:<ownerId> wears one of them (one at a time)
// Someone pressing another member's buttons gets their own inventory as a private reply.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { createEmbed } from '../../../utils/embeds.js';
import { bestInChain, getItemById, shopItems, tierEffect } from '../../../config/shop/items.js';
import { JOB_SHIFTS, activeJob } from '../../../services/economyJobs.js';
import { UPGRADES, getUpgradeLevel } from '../../../services/economyUpgrades.js';
import { BOOST_FACTOR } from '../../../services/economySettings.js';
import { BOOST_TYPES, boostUntil } from '../../../services/boosts.js';
import { SEASONAL_EVENTS, amountOf, eventOf, getSeason, seasonActive, syncRanks } from '../../../services/seasonalEvents.js';
import { itemLabel } from './buy.js';
import { t, tr } from '../../../i18n/index.js';

export const INVENTORY_TABS = Object.freeze([
  { id: 'przedmioty', emoji: '🎒', label: t('Items') },
  { id: 'boosty', emoji: '⚡', label: t('Boosts and potions') },
  { id: 'eventowe', emoji: '🎃', label: t('Event') },
]);
const TAB_IDS = INVENTORY_TABS.map((tab) => tab.id);
export const inventoryTab = (id) => (TAB_IDS.includes(id) ? id : 'przedmioty');

const ts = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;

/**
 * Everything the view needs that is read from storage: the member data (old event ranks recorded), the ranks and the event
 * currencies [{ event, amount, running }] the member has or can collect now.
 */
export async function loadInventory({ client, guild, member }) {
  const { userData, ranks } = await syncRanks({ client, guild, member });
  const currencies = [];
  for (const base of SEASONAL_EVENTS) {
    const settings = await getSeason(base, guild.id);
    const event = eventOf(base, settings);
    const running = seasonActive(settings);
    const { amount } = amountOf(event, userData);
    if (amount > 0 || running) currencies.push({ event, amount, running });
  }
  return { userData, ranks, currencies };
}

function itemsTab(userData) {
  const inventory = userData.inventory || {};
  // Of each tier line only the best owned item is shown - it is the one that works.
  // Retired items (pickaxes, laptop, ...) stay and say which new item they count as.
  const countsAs = (item) => (item.retired && getItemById(item.sameAs) ? t` → works as ${itemLabel(getItemById(item.sameAs))}` : '');
  const items = shopItems
    .filter((item) => item.type !== 'consumable' && (inventory[item.id] || 0) > 0)
    .filter((item) => !item.chain || bestInChain(userData, item.chain)?.id === item.id)
    .map((item) => (item.type === 'tool' && !item.stackable
      ? `**${itemLabel(item)}**${tierEffect(item).replace(/^ \((.*)\)$/, ' · $1')}${countsAs(item)}`
      : `**${itemLabel(item)}:** ${inventory[item.id]}x${countsAs(item)}`));
  const upgrades = UPGRADES
    .filter((upgrade) => getUpgradeLevel(userData, upgrade.id) > 0)
    .map((upgrade) => `${upgrade.emoji} ${tr(upgrade.name)} **${getUpgradeLevel(userData, upgrade.id)}/${upgrade.maxLevel}**`);
  const job = activeJob(userData);
  return {
    description: items.join('\n') || t('No items yet - see `/sklep`.'),
    fields: [
      { name: t('⚡ Upgrades'), value: upgrades.join('\n') || t('None yet - see `/ulepszenia`.') },
      { name: t('💼 Job'), value: job ? t`${job.emoji} ${tr(job.name)} · ${userData.job.shiftsLeft}/${JOB_SHIFTS} shifts left` : t('None - `/work` shows job offers.') },
    ],
  };
}

function boostsTab(userData, now) {
  const inventory = userData.inventory || {};
  const boosts = BOOST_TYPES
    .map((type) => ({ type, until: boostUntil(userData, type.id, now) }))
    .filter(({ until }) => until > 0)
    .map(({ type, until }) => t`${type.emoji} **${tr(type.name)} x${BOOST_FACTOR}** · ends ${ts(until)}`);
  const potions = shopItems
    .filter((item) => item.type === 'consumable' && (inventory[item.id] || 0) > 0)
    .map((item) => `**${itemLabel(item)}:** ${inventory[item.id]}x`);
  return {
    description: boosts.join('\n') || t('No boost is running - buy one with `/boosty` or in `/event sklep`.'),
    fields: [{ name: t('🧪 One-use items'), value: potions.join('\n') || t('None - see `/sklep`.') }],
  };
}

function eventTab(ranks, currencies) {
  const worn = ranks.filter((rank) => rank.worn);
  const rankLines = ranks.map((rank) => (rank.role
    ? `${rank.worn ? '✅' : '▫️'} ${rank.event.emoji} <@&${rank.role.id}>`
    : t`▫️ ${rank.event.emoji} ${rank.event.roleName} (the role was deleted)`));
  const money = currencies.map(({ event, amount, running }) => t`${event.emoji} **${event.texts.name()}:** ${amount} ${event.currency}${running ? ' · 🟢' : ''}`);
  return {
    description: [
      worn.length ? t`**You wear:** ${worn.map((rank) => `<@&${rank.role.id}>`).join(', ')}` : t('**You wear:** no event rank'),
      t('-# Pick the rank below. You can wear one at a time; the others stay yours.'),
    ].join('\n'),
    fields: [
      { name: t('👑 Event ranks'), value: rankLines.join('\n') || t('None yet - the most expensive thing in `/event sklep`.') },
      { name: t('🍬 Event currencies'), value: money.join('\n') || t('None - they come during events (`/event lista`).') },
    ],
  };
}

function tabRow(ownerId, tab) {
  return new ActionRowBuilder().addComponents(INVENTORY_TABS.map((entry) => new ButtonBuilder()
    .setCustomId(`ekwipunek:tab:${ownerId}:${entry.id}`)
    .setLabel(tr(entry.label))
    .setEmoji(entry.emoji)
    .setStyle(entry.id === tab ? ButtonStyle.Primary : ButtonStyle.Secondary)));
}

function rankMenu(ownerId, ranks) {
  const usable = ranks.filter((rank) => rank.role).slice(0, 24);
  if (!usable.length) return null;
  const anyWorn = usable.some((rank) => rank.worn);
  return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
    .setCustomId(`ekwipunek:ranga:${ownerId}`)
    .setPlaceholder(t('Pick the rank to wear'))
    .addOptions(
      ...usable.map((rank) => ({
        label: rank.role.name.slice(0, 100),
        value: rank.key,
        emoji: rank.event.emoji,
        default: rank.worn && usable.filter((entry) => entry.worn).length === 1,
      })),
      { label: t('No event rank'), value: 'none', emoji: '➖', default: !anyWorn },
    ));
}

/**
 * The /ekwipunek message. `ownerId` = who may press the buttons (null = no buttons, e.g. a private copy for someone else is
 * built with their own id). `data` = loadInventory().
 */
export function buildInventoryView({ user, ownerId, tab = 'przedmioty', data, notice = '', now = Date.now() }) {
  const current = inventoryTab(tab);
  const { userData, ranks, currencies } = data;
  const part = current === 'boosty' ? boostsTab(userData, now) : current === 'eventowe' ? eventTab(ranks, currencies) : itemsTab(userData);
  const embed = createEmbed({
    title: t`🎒 ${user.displayName ?? user.username}'s Inventory`,
    description: [notice, part.description].filter(Boolean).join('\n\n'),
    fields: part.fields,
  });
  if (user.displayAvatarURL) embed.setThumbnail(user.displayAvatarURL());
  const components = [];
  if (ownerId) {
    components.push(tabRow(ownerId, current));
    const menu = current === 'eventowe' ? rankMenu(ownerId, ranks) : null;
    if (menu) components.push(menu);
  }
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}
