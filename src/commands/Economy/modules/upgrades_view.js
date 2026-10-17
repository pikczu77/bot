// The /ulepszenia message, in two folders:
//   skills — every permanent upgrade with its level, effect and the price of the next level
//   items  — the item tiers (rod, pickaxe, computer, clover): what you have and the next one
// One button per upgrade or item line, plus the folder switch. The buttons are handled by
// src/interactions/buttons/economy/upgrades.js.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createEmbed } from '../../../utils/embeds.js';
import { getEconomySettings, getShopItems, money } from '../../../services/economySettings.js';
import { UPGRADES, describeUpgradeEffect, discountPercent, discountedPrice, getUpgradeLevel, upgradeCost } from '../../../services/economyUpgrades.js';
import { ITEM_CHAINS, bestInChain, nextInChain, tierEffect } from '../../../config/shop/items.js';
import { CARDS, FISH, FULL_CARDS_BONUS_PERCENT, FULL_FISH_BONUS_PERCENT, cardsCollected, fishCollected } from '../../../services/collections.js';
import { itemLabel } from './buy.js';
import { t, tr } from '../../../i18n/index.js';

const BUTTONS_PER_ROW = 5;
export const FOLDERS = ['skills', 'items'];

/** Prices of the items for sale on this server (item id -> price). */
export async function shopPrices(guild) {
  const items = getShopItems(await getEconomySettings(guild.id), guild);
  return new Map(items.map((item) => [item.id, item.price]));
}

function folderRow(ownerId, folder) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`ulepszenia:folder:${ownerId}:skills`)
      .setLabel(t('Skills'))
      .setEmoji('⚡')
      .setStyle(folder === 'skills' ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(folder === 'skills'),
    new ButtonBuilder()
      .setCustomId(`ulepszenia:folder:${ownerId}:items`)
      .setLabel(t('Items'))
      .setEmoji('🎒')
      .setStyle(folder === 'items' ? ButtonStyle.Primary : ButtonStyle.Secondary)
      .setDisabled(folder === 'items'),
  );
}

function rows(buttons) {
  const result = [];
  for (let i = 0; i < buttons.length; i += BUTTONS_PER_ROW) {
    result.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + BUTTONS_PER_ROW)));
  }
  return result;
}

function skillsFolder({ guildId, userData, ownerId, funds }) {
  const fields = UPGRADES.map((upgrade) => {
    const level = getUpgradeLevel(userData, upgrade.id);
    const price = upgradeCost(upgrade, level, userData);
    return {
      name: `${upgrade.emoji} ${tr(upgrade.name)} · ${level}/${upgrade.maxLevel}`,
      value: [
        `-# ${tr(upgrade.description)}`,
        level > 0 ? t`Now: **${describeUpgradeEffect(upgrade, level, guildId)}**` : t('Now: not bought'),
        price === null
          ? t('✅ Highest level')
          : t`Next: ${describeUpgradeEffect(upgrade, level + 1, guildId)} · **${money(guildId, price)}**`,
      ].join('\n'),
      inline: true,
    };
  });

  const buttons = !ownerId ? [] : UPGRADES.map((upgrade) => {
    const price = upgradeCost(upgrade, getUpgradeLevel(userData, upgrade.id), userData);
    const label = price === null ? t`${tr(upgrade.name)} · MAX` : t`${tr(upgrade.name)} · ${money(guildId, price)}`;
    return new ButtonBuilder()
      .setCustomId(`ulepszenia:kup:${ownerId}:${upgrade.id}`)
      .setLabel(label.slice(0, 80))
      .setEmoji(upgrade.emoji)
      .setStyle(price !== null && funds >= price ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(price === null || funds < price);
  });

  fields.push({ name: t('📖 Collections'), value: collectionLines(userData), inline: false });

  return { fields, buttons, intro: t('Permanent upgrades: bought once, they stay forever. You pay with cash first, then from the bank.') };
}

/** The two collection bonuses with progress (services/collections.js). */
export function collectionLines(userData) {
  const fish = fishCollected(userData);
  const cards = cardsCollected(userData);
  return [
    t`${fish === FISH.length ? '✅' : '🔒'} 🎣 Full fish deck **${fish}/${FISH.length}**: **+${FULL_FISH_BONUS_PERCENT}%** from \`/fish\``,
    t`${cards === CARDS.length ? '✅' : '🔒'} 🎴 All Club'o'mony cards **${cards}/${CARDS.length}**: **+${FULL_CARDS_BONUS_PERCENT}%** from every job (not \`/daily\`)`,
    t('-# Progress in `/index`. Selling the last copy of a card ends the card bonus.'),
  ].join('\n');
}

function itemsFolder({ guildId, userData, ownerId, funds, prices }) {
  const fields = ITEM_CHAINS.map((chain) => {
    const best = bestInChain(userData, chain.id);
    const steps = chain.items.map((item) => {
      const mark = best && chain.items.indexOf(item) <= chain.items.indexOf(best) ? '✅' : item === nextInChain(userData, chain.id) ? '➡️' : '🔒';
      const effect = tierEffect(item);
      const cost = mark === '✅' ? '' : ` · ${money(guildId, discountedPrice(prices.get(item.id) ?? item.price, userData))}`;
      return `${mark} ${itemLabel(item)}${effect}${cost}`;
    });
    const level = best ? chain.items.indexOf(best) + 1 : 0;
    return { name: `${chain.emoji} ${tr(chain.name)} · ${level}/${chain.items.length}`, value: steps.join('\n'), inline: true };
  });

  const buttons = !ownerId ? [] : ITEM_CHAINS.map((chain) => {
    const next = nextInChain(userData, chain.id);
    const forSale = next && prices.has(next.id);
    const price = forSale ? discountedPrice(prices.get(next.id), userData) : null;
    const label = !next ? t`${tr(chain.name)} · MAX` : forSale ? `${itemLabel(next)} · ${money(guildId, price)}` : t`${itemLabel(next)} · not for sale`;
    return new ButtonBuilder()
      .setCustomId(`ulepszenia:przedmiot:${ownerId}:${chain.id}`)
      .setLabel(label.slice(0, 80))
      .setEmoji(chain.emoji)
      .setStyle(forSale && funds >= price ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!forSale || funds < price);
  });

  return { fields, buttons, intro: t('Items: every tool has 2 upgrades - the first gives +50%, the second +100%. The rod and the computer are needed for `/fish` and `/nagraj`; hooks and cameras let you use them 2-4 times in a row.') };
}

/**
 * @param {object} options
 * @param {string} options.guildId
 * @param {object} options.userData  economy data of the member shown
 * @param {object} options.user      Discord user shown
 * @param {string|null} options.ownerId  who may press the buttons; null = view only
 * @param {string} [options.folder]  'skills' or 'items'
 * @param {Map<string, number>} [options.prices]  item id -> shop price on this server (items for sale only)
 * @param {string} [options.notice]  line shown above the list (result of the last click)
 */
export function buildUpgradesView({ guildId, userData, user, ownerId = null, folder = 'skills', prices = new Map(), notice = '' }) {
  const funds = (userData.wallet || 0) + (userData.bank || 0);
  const shown = folder === 'items'
    ? itemsFolder({ guildId, userData, ownerId, funds, prices })
    : skillsFolder({ guildId, userData, ownerId, funds });
  const discount = discountPercent(userData);

  const embed = createEmbed({
    title: folder === 'items'
      ? t`🎒 Item upgrades · ${user.displayName ?? user.username}`
      : t`⚡ Upgrades · ${user.displayName ?? user.username}`,
    description: [
      notice,
      shown.intro,
      t`💵 **${money(guildId, userData.wallet || 0)}** · 🏦 **${money(guildId, userData.bank || 0)}**` + (discount > 0 ? t` · 🏷️ discount ${discount}%` : ''),
    ].filter(Boolean).join('\n\n'),
    fields: shown.fields,
    thumbnail: user.displayAvatarURL?.() ?? null,
  });

  if (!ownerId) return { embeds: [embed], components: [] };
  return { embeds: [embed], components: [...rows(shown.buttons), folderRow(ownerId, folder)] };
}
