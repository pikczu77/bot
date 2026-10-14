// /sklep — opens the shop. With `kup` it buys that item right away (the item comes from
// the autocomplete list). The inventory is /ekwipunek, the premium role is set in
// /economy rola-premium.

import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { getEconomySettings, getShopItems, money } from '../../services/economySettings.js';
import { discountedPrice } from '../../services/economyUpgrades.js';
import { buildShopView } from './modules/shop_browse.js';
import { findShopItem, fold, itemLabel, purchaseItem } from './modules/buy.js';
import { t } from '../../i18n/index.js';

export default {
    data: new SlashCommandBuilder()
        .setName('sklep')
        .setDescription('Open the shop - or buy an item right away')
        .addStringOption(option =>
            option
                .setName('kup')
                .setDescription('Item to buy - pick it from the list')
                .setRequired(false)
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

    async autocomplete(interaction, client) {
        const settings = await getEconomySettings(interaction.guildId);
        const userData = await getEconomyData(client ?? interaction.client, interaction.guildId, interaction.user.id);
        const wanted = fold(interaction.options.getFocused());
        const choices = getShopItems(settings, interaction.guild)
            .filter((item) => !wanted || fold(itemLabel(item)).includes(wanted) || item.id.includes(wanted))
            .slice(0, 25)
            .map((item) => ({
                name: `${itemLabel(item)} — ${money(interaction.guildId, discountedPrice(item.price, userData))}`.slice(0, 100),
                value: item.id,
            }));
        await interaction.respond(choices);
    },

    execute: withErrorHandling(async (interaction, config, client) => {
        const query = interaction.options.getString('kup');

        if (!query) {
            const deferred = await InteractionHelper.safeDefer(interaction);
            if (!deferred) return;
            const view = await buildShopView({ client, guild: interaction.guild, ownerId: interaction.user.id });
            await InteractionHelper.safeEditReply(interaction, view);
            return;
        }

        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        const quantity = interaction.options.getInteger('ilosc') || 1;
        const items = getShopItems(await getEconomySettings(interaction.guildId), interaction.guild);
        const item = findShopItem(items, query);

        if (!item) {
            throw createError(
                `Item ${query} not found`,
                ErrorTypes.VALIDATION,
                t`There is no **${query}** in the shop. Pick an item from the list or open \`/sklep\`.`,
                { query, expected: true }
            );
        }

        const embed = await purchaseItem({ client, guild: interaction.guild, member: interaction.member, itemId: item.id, quantity });
        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'sklep' })
};
