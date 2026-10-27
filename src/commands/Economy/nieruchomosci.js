import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { userError } from '../../utils/featureKit.js';
import { getEconomyData } from '../../utils/economy.js';
import { getEconomySettings, money } from '../../services/economySettings.js';
import {
    LEVEL_INCOME_PERCENT, MAX_PROPERTY_LEVEL, PROPERTIES, buyProperty, collectRent, dailyIncome, ownedProperty,
    propertyOverview, propertyUpgradePrice, sellProperty, upgradeProperty,
} from '../../services/properties.js';
import { progressEmbeds } from '../../services/progress.js';
import { t } from '../../i18n/index.js';

// /nieruchomosci lista | kup | odbierz | ulepsz | sprzedaj — buildings that pay rent (2026-10-27). Rules: services/properties.js.

const COLOR = '#FF9F0A';
const propertyChoices = PROPERTIES.map((property) => ({ name: `${property.emoji} ${property.name}`, value: property.id }));
const stars = (level) => '⭐'.repeat(level) + '·'.repeat(MAX_PROPERTY_LEVEL - level);

async function listEmbed(client, guildId, user, notice = '') {
    const settings = await getEconomySettings(guildId);
    const userData = await getEconomyData(client, guildId, user.id);
    const overview = propertyOverview(settings, userData);
    const maxHours = settings.commands.property.maxHours;
    const fields = PROPERTIES.map((property) => {
        const owned = ownedProperty(userData, property.id);
        const row = overview.rows.find((entry) => entry.property.id === property.id);
        if (!owned) {
            return {
                name: `${property.emoji} ${property.name}`,
                value: t`💵 ${money(guildId, property.price)}\n📈 ${money(guildId, dailyIncome(settings, property))} a day`,
                inline: true,
            };
        }
        const next = owned.level < MAX_PROPERTY_LEVEL ? t`\n-# upgrade: ${money(guildId, propertyUpgradePrice(property, owned.level + 1))}` : '';
        return {
            name: `${property.emoji} ${property.name} ✅`,
            value: t`${stars(owned.level)}\n📈 ${money(guildId, row.daily)} a day\n📦 waiting: **${money(guildId, row.waiting.amount)}**${row.waiting.full ? ' ⚠️' : ''}` + next,
            inline: true,
        };
    });
    return createEmbed({
        title: t`🏘️ Buildings of ${user.username}`,
        description: [
            notice,
            overview.rows.length
                ? t`**Rent a day:** ${money(guildId, overview.daily)} · **waiting:** ${money(guildId, overview.waiting)}`
                : t('Buy a building and it pays rent every hour, even when you are offline.'),
            t`-# Rent waits in the building, at most ${maxHours} h of it (⚠️ = full): collect it with \`/nieruchomosci odbierz\`. Each upgrade +${LEVEL_INCOME_PERCENT}% rent.`,
        ].filter(Boolean).join('\n'),
        color: COLOR,
        fields,
        footer: false,
    });
}

export default {
    data: new SlashCommandBuilder()
        .setName('nieruchomosci')
        .setDescription('Buildings that pay you rent every hour')
        .addSubcommand((sub) => sub
            .setName('lista')
            .setDescription('Buildings, prices and your rent')
            .addUserOption((option) => option.setName('osoba').setDescription('Whose buildings')))
        .addSubcommand((sub) => sub
            .setName('kup')
            .setDescription('Buy a building (cash first, then bank)')
            .addStringOption((option) => option.setName('budynek').setDescription('Building').setRequired(true).addChoices(...propertyChoices)))
        .addSubcommand((sub) => sub
            .setName('odbierz')
            .setDescription('Collect the rent of all your buildings'))
        .addSubcommand((sub) => sub
            .setName('ulepsz')
            .setDescription('Upgrade a building: more rent')
            .addStringOption((option) => option.setName('budynek').setDescription('Building').setRequired(true).addChoices(...propertyChoices)))
        .addSubcommand((sub) => sub
            .setName('sprzedaj')
            .setDescription('Sell a building for a part of what it cost')
            .addStringOption((option) => option.setName('budynek').setDescription('Building').setRequired(true).addChoices(...propertyChoices))),

    execute: withErrorHandling(async (interaction, config, client) => {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;
        const user = interaction.user;
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;
        const reply = async (notice, extra = []) => InteractionHelper.safeEditReply(interaction, { embeds: [await listEmbed(client, guildId, user, notice), ...extra] });
        const propertyId = interaction.options.getString('budynek');

        if (sub === 'kup') {
            const { property, price, progress } = await buyProperty({ client, guildId, userId: user.id, propertyId, userError });
            return reply(t`✅ You bought the ${property.emoji} **${property.name}** for ${money(guildId, price)}. It pays rent from now on.`, progressEmbeds(progress, guildId));
        }
        if (sub === 'odbierz') {
            const { total, progress } = await collectRent({ client, guildId, userId: user.id, userError });
            return reply(t`✅ You collected **${money(guildId, total)}** of rent.`, progressEmbeds(progress, guildId));
        }
        if (sub === 'ulepsz') {
            const { property, level, price, rent } = await upgradeProperty({ client, guildId, userId: user.id, propertyId, userError });
            return reply(t`✅ The ${property.emoji} **${property.name}** is now level ${level} (${money(guildId, price)}).` + (rent > 0 ? t` Rent collected first: ${money(guildId, rent)}.` : ''));
        }
        if (sub === 'sprzedaj') {
            const { property, price, rent } = await sellProperty({ client, guildId, userId: user.id, propertyId, userError });
            return reply(t`✅ You sold the ${property.emoji} **${property.name}** for ${money(guildId, price)}.` + (rent > 0 ? t` Rent collected: ${money(guildId, rent)}.` : ''));
        }
        const other = interaction.options.getUser('osoba') ?? user;
        return InteractionHelper.safeEditReply(interaction, { embeds: [await listEmbed(client, guildId, other)] });
    }, { command: 'nieruchomosci' })
};
