// /sklep — the shop as one message: a category menu, an item menu that buys the picked
// item, and buttons to the permanent upgrades and the inventory. The menus are handled by
// src/interactions/selectMenus/economy/shop.js, so they keep working after a restart.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from 'discord.js';
import { createEmbed } from '../../../utils/embeds.js';
import { getEconomyData } from '../../../utils/economy.js';
import { getEconomySettings, getShopItems, money } from '../../../services/economySettings.js';
import { discountPercent, discountedPrice } from '../../../services/economyUpgrades.js';
import { handleInteractionError } from '../../../utils/errorHandler.js';
import { bestInChain, missingRequirement, purchaseRoom } from '../../../config/shop/items.js';
import { itemLabel } from './buy.js';
import { t, tr } from '../../../i18n/index.js';

// Category ids are the item types; "tool" is shown as "Items" (the user's "Przedmioty").
export const SHOP_CATEGORIES = [
    { id: 'tool', emoji: '🎒', name: t('Items'), description: t('Kept forever. Each has 2 upgrades: +50%, then +100%.') },
    { id: 'consumable', emoji: '🧪', name: t('Consumables'), description: t('Used up by the command they help. They can earn or lose money.') },
    { id: 'role', emoji: '🎭', name: t('Roles'), description: t('Discord roles for sale.') },
];

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** "✅ owned", "🔒 needs X" … after an item's name in the shop list. */
function itemStatus(item, userData) {
    const owned = userData.inventory?.[item.id] || 0;
    if (item.type === 'tool' && item.chain) {
        const best = bestInChain(userData, item.chain);
        if (best?.id === item.id) return t(' · ✅ in use');
        if (purchaseRoom(item, userData) === 0) return t(' · ✅ have a better one');
        const needed = missingRequirement(item, userData);
        return needed ? t` · 🔒 first: ${itemLabel(needed)}` : '';
    }
    if (item.type === 'tool' && !item.stackable && owned > 0) return t(' · ✅ owned');
    const count = owned > 0 ? t` · 🎒 ${owned}x` : '';
    const limit = item.type === 'consumable' && purchaseRoom(item, userData) === 0 ? t(' · limit reached') : '';
    return count + limit;
}

/** The whole shop message for `ownerId`, showing `categoryId`. */
export async function buildShopView({ client, guild, ownerId, categoryId = null }) {
    const guildId = guild.id;
    const settings = await getEconomySettings(guildId);
    const items = getShopItems(settings, guild);
    const userData = await getEconomyData(client, guildId, ownerId);
    const categories = SHOP_CATEGORIES.filter((category) => items.some((item) => item.type === category.id));
    const category = categories.find((entry) => entry.id === categoryId) ?? categories[0] ?? SHOP_CATEGORIES[0];
    const shown = items.filter((item) => item.type === category.id).slice(0, 25);
    const price = (item) => money(guildId, discountedPrice(item.price, userData));

    const lines = shown.map((item) => `**${itemLabel(item)}** — ${price(item)}${itemStatus(item, userData)}\n${tr(item.description)}`);
    const discount = discountPercent(userData);

    const embed = createEmbed({
        title: t`🛒 Shop · ${category.emoji} ${category.name}`,
        description: [
            `-# ${tr(category.description)}`,
            lines.join('\n\n') || t('Nothing for sale here yet.'),
        ].join('\n\n'),
        fields: [
            { name: t('💵 Cash'), value: money(guildId, userData.wallet || 0), inline: true },
            { name: t('🏦 Bank'), value: money(guildId, userData.bank || 0), inline: true },
        ],
        footer: {
            text: discount > 0
                ? t`Pick an item in the menu to buy it. Cash is used first, then the bank. 🏷️ Your discount: ${discount}%.`
                : t('Pick an item in the menu to buy it. Cash is used first, then the bank.'),
        },
    });

    const components = [];
    if (categories.length > 1) {
        components.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`sklep:kat:${ownerId}`)
                .setPlaceholder(t('Category'))
                .addOptions(categories.map((entry) => ({
                    label: tr(entry.name),
                    value: entry.id,
                    emoji: entry.emoji,
                    description: clip(tr(entry.description), 100),
                    default: entry.id === category.id,
                }))),
        ));
    }
    if (shown.length > 0) {
        components.push(new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`sklep:kup:${ownerId}:${category.id}`)
                .setPlaceholder(t('Buy an item…'))
                .addOptions(shown.map((item) => ({
                    label: clip(itemLabel(item), 100),
                    value: item.id,
                    description: clip(`${price(item)} · ${tr(item.description)}`, 100),
                }))),
        ));
    }
    components.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`ulepszenia:pokaz:${ownerId}`)
            .setLabel(t('Permanent upgrades'))
            .setEmoji('⚡')
            .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
            .setCustomId(`ulepszenia:pokaz:${ownerId}:items`)
            .setLabel(t('Item upgrades'))
            .setEmoji('🎒')
            .setStyle(ButtonStyle.Secondary),
    ));

    return { embeds: [embed], components };
}

export default {
    async execute(interaction, config, client) {
        try {
            const view = await buildShopView({ client, guild: interaction.guild, ownerId: interaction.user.id });
            await interaction.reply(view);
        } catch (error) {
            await handleInteractionError(interaction, error, { command: 'shop_browse' });
        }
    },
};
