import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { userError } from '../../utils/featureKit.js';
import { getEconomyData } from '../../utils/economy.js';
import { MAX_MONEY, getEconomySettings, money } from '../../services/economySettings.js';
import {
    COMPANIES, buyShares, getMarket, holdingOf, newsText, nextPriceChange, portfolio, priceChanges, sellShares,
} from '../../services/stockMarket.js';
import { progressEmbeds } from '../../services/progress.js';
import { t } from '../../i18n/index.js';

// /gielda ceny | kup | sprzedaj | portfel — the pretend stock market (2026-10-27). Rules: services/stockMarket.js.

const SPARK = '▁▂▃▄▅▆▇█';
const companyChoices = COMPANIES.map((company) => ({ name: `${company.emoji} ${company.name} (${company.id})`, value: company.id }));

function sparkline(values) {
    const list = values.slice(-12);
    if (list.length < 2) return '';
    const low = Math.min(...list);
    const high = Math.max(...list);
    return list.map((value) => SPARK[high === low ? 3 : Math.round((value - low) / (high - low) * (SPARK.length - 1))]).join('');
}

const signed = (fraction) => `${fraction >= 0 ? '+' : ''}${(fraction * 100).toFixed(1)}%`;
const arrow = (fraction) => (fraction > 0.0005 ? '🟢' : fraction < -0.0005 ? '🔴' : '⚪');
const signedMoney = (guildId, amount) => `${amount >= 0 ? '+' : '-'}${money(guildId, Math.abs(amount))}`;

async function pricesEmbed(guildId, userData = null, notice = '') {
    const market = await getMarket(guildId);
    const settings = await getEconomySettings(guildId);
    const fields = COMPANIES.map((company) => {
        const price = market.prices[company.id];
        const change = priceChanges(market, company.id);
        const held = userData ? holdingOf(userData, company.id).shares : 0;
        return {
            name: `${company.emoji} ${company.name} · ${company.id}`,
            value: [
                `**${money(guildId, price)}** ${arrow(change.hour)} ${signed(change.hour)}`,
                t`24 h: ${signed(change.day)}`,
                sparkline(market.history[company.id] ?? []) ? `\`${sparkline(market.history[company.id])}\`` : null,
                held > 0 ? t`-# you hold ${held}` : null,
            ].filter(Boolean).join('\n'),
            inline: true,
        };
    });
    const news = (market.news ?? []).slice(0, 3)
        .map((item) => `<t:${Math.floor(item.at / 1000)}:t> ${newsText(item)} **${signed(item.change)}**`);
    if (news.length) fields.push({ name: t('📰 News'), value: news.join('\n'), inline: false });
    return createEmbed({
        title: t('📈 Stock market'),
        description: [
            notice,
            t`Prices change every hour, next change <t:${Math.floor(nextPriceChange() / 1000)}:R>. Fee on every trade: **${settings.commands.stocks.feePercent}%**.`,
            t('-# `/gielda kup` · `/gielda sprzedaj` · `/gielda portfel`'),
        ].filter(Boolean).join('\n'),
        color: '#30D158',
        fields,
        footer: false,
    });
}

async function portfolioEmbed(client, guildId, user) {
    const market = await getMarket(guildId);
    const userData = await getEconomyData(client, guildId, user.id);
    const view = portfolio(userData, market);
    return createEmbed({
        title: t`💼 Portfolio of ${user.username}`,
        description: view.rows.length
            ? [
                ...view.rows.map((row) => t`${row.company.emoji} **${row.company.name}**: ${row.shares} {2|share|shares} · ${money(guildId, row.value)} (${signedMoney(guildId, row.profit)})`),
                '',
                t`**Worth now:** ${money(guildId, view.value)}`,
                t`**Profit:** ${signedMoney(guildId, view.profit)} (paid ${money(guildId, view.cost)} with fees)`,
            ].join('\n')
            : t('No shares yet. Buy some with `/gielda kup`.'),
        color: view.profit >= 0 ? '#30D158' : '#FF453A',
        footer: false,
    });
}

export default {
    data: new SlashCommandBuilder()
        .setName('gielda')
        .setDescription('Stock market: buy shares cheap, sell them dear')
        .addSubcommand((sub) => sub
            .setName('ceny')
            .setDescription('Prices, changes and news'))
        .addSubcommand((sub) => sub
            .setName('kup')
            .setDescription('Buy shares (cash first, then bank)')
            .addStringOption((option) => option.setName('firma').setDescription('Company').setRequired(true).addChoices(...companyChoices))
            .addIntegerOption((option) => option.setName('ilosc').setDescription('How many shares').setMinValue(1).setMaxValue(1_000_000))
            .addIntegerOption((option) => option.setName('za_kwote').setDescription('Or: spend at most this much').setMinValue(1).setMaxValue(MAX_MONEY)))
        .addSubcommand((sub) => sub
            .setName('sprzedaj')
            .setDescription('Sell shares (the money goes to cash)')
            .addStringOption((option) => option.setName('firma').setDescription('Company').setRequired(true).addChoices(...companyChoices))
            .addIntegerOption((option) => option.setName('ilosc').setDescription('How many shares (default: all)').setMinValue(1).setMaxValue(1_000_000)))
        .addSubcommand((sub) => sub
            .setName('portfel')
            .setDescription('Your shares, their worth and your profit')
            .addUserOption((option) => option.setName('osoba').setDescription('Whose portfolio'))),

    execute: withErrorHandling(async (interaction, config, client) => {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        if (sub === 'kup') {
            const result = await buyShares({
                client, guildId, userId: interaction.user.id, companyId: interaction.options.getString('firma'),
                shares: interaction.options.getInteger('ilosc'), budget: interaction.options.getInteger('za_kwote'), userError,
            });
            const notice = t`✅ You bought **${result.count}** {0|share|shares} of ${result.company.emoji} **${result.company.name}** at ${money(guildId, result.price)} for ${money(guildId, result.paid)} (fee ${money(guildId, result.fee)}).`;
            const userData = await getEconomyData(client, guildId, interaction.user.id);
            return InteractionHelper.safeEditReply(interaction, { embeds: [await pricesEmbed(guildId, userData, notice), ...progressEmbeds(result.progress, guildId)] });
        }
        if (sub === 'sprzedaj') {
            const result = await sellShares({
                client, guildId, userId: interaction.user.id, companyId: interaction.options.getString('firma'),
                shares: interaction.options.getInteger('ilosc'), userError,
            });
            const notice = t`✅ You sold **${result.count}** {0|share|shares} of ${result.company.emoji} **${result.company.name}** at ${money(guildId, result.price)}: **${money(guildId, result.received)}** to cash (fee ${money(guildId, result.fee)}). Profit: **${signedMoney(guildId, result.profit)}**.`;
            const userData = await getEconomyData(client, guildId, interaction.user.id);
            return InteractionHelper.safeEditReply(interaction, { embeds: [await pricesEmbed(guildId, userData, notice), ...progressEmbeds(result.progress, guildId)] });
        }
        if (sub === 'portfel') {
            const user = interaction.options.getUser('osoba') ?? interaction.user;
            return InteractionHelper.safeEditReply(interaction, { embeds: [await portfolioEmbed(client, guildId, user)] });
        }
        const userData = await getEconomyData(client, guildId, interaction.user.id);
        return InteractionHelper.safeEditReply(interaction, { embeds: [await pricesEmbed(guildId, userData)] });
    }, { command: 'gielda' })
};
