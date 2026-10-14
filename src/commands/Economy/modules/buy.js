// Buying from the shop: used by /sklep (option `kup`), the shop menus and the item tiers
// of /ulepszenia.

import { successEmbed } from '../../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../../utils/economy.js';
import { getGuildConfig } from '../../../services/config/guildConfig.js';
import { createError, ErrorTypes } from '../../../utils/errorHandler.js';
import { t, tr } from '../../../i18n/index.js';
import { getEconomySettings, getShopItems, money } from '../../../services/economySettings.js';
import { discountPercent, discountedPrice, spendMoney, withEconomyLock } from '../../../services/economyUpgrades.js';
import { missingRequirement, purchaseRoom } from '../../../config/shop/items.js';

/** "💻 Laptop" — the item's emoji in front unless its name already starts with an emoji. */
export function itemLabel(item) {
    const name = tr(item.name);
    return item.emoji && /^[\p{L}\p{N}]/u.test(name) ? `${item.emoji} ${name}` : name;
}

export const fold = (text) => String(text ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');

/** Find a shop item by id or by its (translated or English) name. */
export function findShopItem(items, query) {
    const wanted = fold(query).trim();
    if (!wanted) return null;
    return items.find((item) => item.id === wanted)
        ?? items.find((item) => fold(itemLabel(item)) === wanted || fold(item.name) === wanted)
        ?? items.find((item) => fold(itemLabel(item)).includes(wanted))
        ?? null;
}

/**
 * Stop a gathering command (/fish, /mine) when the member owns none of `toolIds`.
 * When the server took every one of those tools out of the shop, the command works without one.
 */
export async function requireTool({ guild, userData, toolIds, action }) {
    if (toolIds.some((id) => (userData.inventory?.[id] || 0) > 0)) return;
    const items = getShopItems(await getEconomySettings(guild.id), guild);
    const forSale = items.filter((item) => toolIds.includes(item.id));
    if (forSale.length === 0) return;

    const cheapest = forSale.reduce((best, item) => (item.price < best.price ? item : best));
    throw createError(
        `Missing tool for ${action}`,
        ErrorTypes.VALIDATION,
        t`You need **${itemLabel(cheapest)}** for this. Buy it in \`/sklep\` for **${money(guild.id, cheapest.price)}**.`,
        { action, toolIds, expected: true }
    );
}

/**
 * Buy `quantity` of `itemId` for `member`. Pays from cash first, then from the bank.
 * Throws a user error when the purchase is not possible. Returns the success embed.
 */
export async function purchaseItem({ client, guild, member, itemId, quantity = 1 }) {
    const guildId = guild.id;
    const userId = member.id;
    const settings = await getEconomySettings(guildId);
    const item = getShopItems(settings, guild).find((entry) => entry.id === itemId);

    if (!item) {
        throw createError(
            `Item ${itemId} not found`,
            ErrorTypes.VALIDATION,
            t`The item \`${itemId}\` does not exist in the shop.`,
            { itemId, expected: true }
        );
    }

    const premiumRoleId = item.type === 'role' && !item.roleId ? (await getGuildConfig(client, guildId)).premiumRoleId : null;
    const roleId = item.type === 'role' ? (item.roleId || premiumRoleId) : null;

    return withEconomyLock(guildId, userId, async () => {
        const userData = await getEconomyData(client, guildId, userId);
        const room = purchaseRoom(item, userData);
        const totalCost = discountedPrice(item.price, userData) * quantity;
        const needed = missingRequirement(item, userData);
        if (needed) {
            throw createError(
                "Previous tier missing",
                ErrorTypes.VALIDATION,
                t`Buy **${itemLabel(needed)}** first - **${itemLabel(item)}** is its upgrade.`,
                { itemId, needed: needed.id, expected: true }
            );
        }

        if (item.type === 'role') {
            if (!roleId) {
                throw createError(
                    "Premium role not configured",
                    ErrorTypes.CONFIGURATION,
                    t("The **Premium Shop Role** has not been configured by a server administrator yet."),
                    { itemId, expected: true }
                );
            }
            if (member.roles.cache.has(roleId)) {
                throw createError(
                    "Role already owned",
                    ErrorTypes.VALIDATION,
                    t`You already have the **${itemLabel(item)}** role.`,
                    { itemId, roleId, expected: true }
                );
            }
        }

        if (quantity > room) {
            throw createError(
                "Item limit reached",
                ErrorTypes.VALIDATION,
                room <= 0
                    ? t`You already have as many **${itemLabel(item)}** as you can.`
                    : t`You can buy at most **${room}** more **${itemLabel(item)}**.`,
                { itemId, quantity, room, expected: true }
            );
        }

        const wallet = userData.wallet || 0;
        const bank = userData.bank || 0;
        if (!spendMoney(userData, totalCost)) {
            throw createError(
                "Insufficient funds",
                ErrorTypes.VALIDATION,
                t`You need **${money(guildId, totalCost)}** for ${quantity}x **${itemLabel(item)}**, but you have **${money(guildId, wallet + bank)}** (cash and bank).`,
                { required: totalCost, current: wallet + bank, itemId, quantity, expected: true }
            );
        }

        let description = t`You bought ${quantity}x **${itemLabel(item)}** for **${money(guildId, totalCost)}**!`;
        if (discountPercent(userData) > 0) description += t`\n-# 🏷️ Discount ${discountPercent(userData)}% included.`;
        if (bank !== userData.bank) {
            description += t`\n-# ${money(guildId, bank - userData.bank)} was taken from your bank.`;
        }

        if (item.type === 'role') {
            const role = guild.roles.cache.get(roleId);
            if (!role) {
                throw createError(
                    "Role not found",
                    ErrorTypes.CONFIGURATION,
                    t("The configured premium role no longer exists in this guild."),
                    { roleId, expected: true }
                );
            }
            try {
                await member.roles.add(role, t`Purchased role: ${itemLabel(item)}`);
            } catch (roleError) {
                throw createError(
                    "Role assignment failed",
                    ErrorTypes.DISCORD_API,
                    t("I could not give you the role, so nothing was charged."),
                    { roleId, originalError: roleError.message }
                );
            }
            description += t`\n\n**👑 The role ${role.toString()} has been granted to you!**`;
        } else {
            const added = quantity * (item.uses || 1);
            userData.inventory = { ...(userData.inventory || {}), [item.id]: (userData.inventory?.[item.id] || 0) + added };
            description += item.type === 'tool'
                ? t`\n\n**🛠️ ${itemLabel(item)} added to your inventory!**`
                : t`\n\n🎒 You now have **${userData.inventory[item.id]}x** ${itemLabel(item)}.`;
        }

        await setEconomyData(client, guildId, userId, userData);

        return successEmbed(t("💰 Purchase Successful"), description).addFields(
            { name: t("💵 Cash"), value: money(guildId, userData.wallet), inline: true },
            { name: t("🏦 Bank"), value: money(guildId, userData.bank), inline: true },
        );
    });
}

