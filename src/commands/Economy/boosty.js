import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { userError } from '../../utils/featureKit.js';
import { getEconomyData } from '../../utils/economy.js';
import { getEconomySettings, money } from '../../services/economySettings.js';
import { BOOST_FACTOR, BOOST_HOURS, BOOST_TYPES, MAX_BOOST_HOURS, boostPrice, boostUntil, buyBoost } from '../../services/boosts.js';
import { t } from '../../i18n/index.js';

// /boosty lista | kup — x2 money or x2 XP for a few hours (2026-10-29). Rules: services/boosts.js.

async function boostsEmbed(client, guildId, user, notice = '') {
    const settings = await getEconomySettings(guildId);
    const userData = await getEconomyData(client, guildId, user.id);
    const fields = BOOST_TYPES.map((type) => {
        const until = boostUntil(userData, type.id);
        return {
            name: `${type.emoji} ${type.name} x${BOOST_FACTOR}`,
            value: [
                until ? t`✅ **on** until <t:${Math.floor(until / 1000)}:t> (<t:${Math.floor(until / 1000)}:R>)` : t('not running'),
                BOOST_HOURS.map((hours) => `${hours} h: **${money(guildId, boostPrice(settings, type.id, hours))}**`).join(' · '),
            ].join('\n'),
            inline: false,
        };
    });
    return createEmbed({
        title: t('⚡ Boosts'),
        description: [
            notice,
            t`💰 doubles the money from jobs, /daily, chat money and every other payout. ⭐ doubles the XP for messages.`,
            t`-# Buying more adds time, at most ${MAX_BOOST_HOURS} h ahead. Boosts also come from event shops (\`/event sklep\`).`,
        ].filter(Boolean).join('\n'),
        color: '#FFD60A',
        fields,
        footer: false,
    });
}

export default {
    data: new SlashCommandBuilder()
        .setName('boosty')
        .setDescription('Double money or double XP for a few hours')
        .addSubcommand((sub) => sub
            .setName('lista')
            .setDescription('Your running boosts and the prices'))
        .addSubcommand((sub) => sub
            .setName('kup')
            .setDescription('Buy a boost (cash first, then bank)')
            .addStringOption((option) => option.setName('boost').setDescription('Which boost').setRequired(true)
                .addChoices(...BOOST_TYPES.map((type) => ({ name: `${type.emoji} ${type.name} x${BOOST_FACTOR}`, value: type.id }))))
            .addIntegerOption((option) => option.setName('godziny').setDescription('For how long').setRequired(true)
                .addChoices(...BOOST_HOURS.map((hours) => ({ name: `${hours} h`, value: hours }))))),

    execute: withErrorHandling(async (interaction, config, client) => {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        if (sub === 'kup') {
            const { type, hours, price, until } = await buyBoost({
                client, guildId, userId: interaction.user.id, typeId: interaction.options.getString('boost'),
                hours: interaction.options.getInteger('godziny'), userError,
            });
            const notice = t`✅ ${type.emoji} **${type.name}** for ${hours} h (${money(guildId, price)}), until <t:${Math.floor(until / 1000)}:t>.`;
            return InteractionHelper.safeEditReply(interaction, { embeds: [await boostsEmbed(client, guildId, interaction.user, notice)] });
        }
        return InteractionHelper.safeEditReply(interaction, { embeds: [await boostsEmbed(client, guildId, interaction.user)] });
    }, { command: 'boosty' })
};
