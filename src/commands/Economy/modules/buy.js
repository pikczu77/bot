import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { successEmbed } from '../../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../../utils/economy.js';
import { getGuildConfig } from '../../../services/config/guildConfig.js';
import { withErrorHandling, createError, ErrorTypes } from '../../../utils/errorHandler.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import { t, tr } from '../../../i18n/index.js';
import { getEconomySettings, getShopItems, money } from '../../../services/economySettings.js';
import { spendMoney, withEconomyLock } from '../../../services/economyUpgrades.js';
import { purchaseRoom } from '../../../config/shop/items.js';

/** "💻 Laptop" — the item's emoji in front unless its name already starts with an emoji. */
export function itemLabel(item) {
    const name = tr(item.name);
    return item.emoji && /^[\p{L}\p{N}]/u.test(name) ? `${item.emoji} ${name}` : name;
}

const fold = (text) => String(text ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');

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
        const totalCost = item.price * quantity;

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
            userData.inventory = { ...(userData.inventory || {}), [item.id]: (userData.inventory?.[item.id] || 0) + quantity };
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

export default {
    data: new SlashCommandBuilder()
        .setName('kup')
        .setDescription('Buy an item from the shop')
        .addStringOption(option =>
            option
                .setName('przedmiot')
                .setDescription('Item to buy - pick it from the list')
                .setRequired(true)
                .setAutocomplete(true)
        )
        .addIntegerOption(option =>
            option
                .setName('ilosc')
                .setDescription('Quantity to buy (default: 1)')
                .setRequired(false)
                .setMinValue(1)
                .setMaxValue(10)
        ),

    async autocomplete(interaction) {
        const settings = await getEconomySettings(interaction.guildId);
        const wanted = fold(interaction.options.getFocused());
        const choices = getShopItems(settings, interaction.guild)
            .filter((item) => !wanted || fold(itemLabel(item)).includes(wanted) || item.id.includes(wanted))
            .slice(0, 25)
            .map((item) => ({
                name: `${itemLabel(item)} — ${money(interaction.guildId, item.price)}`.slice(0, 100),
                value: item.id,
            }));
        await interaction.respond(choices);
    },

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        const query = interaction.options.getString('przedmiot');
        const quantity = interaction.options.getInteger('ilosc') || 1;
        const items = getShopItems(await getEconomySettings(interaction.guildId), interaction.guild);
        const item = findShopItem(items, query);

        if (!item) {
            throw createError(
                `Item ${query} not found`,
                ErrorTypes.VALIDATION,
                t`There is no **${query}** in the shop. Pick an item from the list or open \`/sklep przegladaj\`.`,
                { query, expected: true }
            );
        }

        const embed = await purchaseItem({ client, guild: interaction.guild, member: interaction.member, itemId: item.id, quantity });
        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'buy' })
};
