import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { userError } from '../../utils/featureKit.js';
import { getEconomyData } from '../../utils/economy.js';
import { getEconomySettings, money } from '../../services/economySettings.js';
import { MAX_MERGES, MERGE_COUNT, mergeCards, mergeableCards, nextRarity } from '../../services/cardMerge.js';
import { progressEmbeds } from '../../services/progress.js';
import { cardLabel } from './modules/trade.js';
import { fold } from './modules/buy.js';
import { t, tr } from '../../i18n/index.js';

// /polacz karta [ile] — five copies of one card become one card of the next rarity (2026-10-29). Rules: services/cardMerge.js.

export default {
    data: new SlashCommandBuilder()
        .setName('polacz')
        .setDescription("Merge 5 copies of a Club'o'mony card into a rarer card")
        .addStringOption((option) => option.setName('karta').setDescription('Your card with 5+ copies').setRequired(true).setAutocomplete(true))
        .addIntegerOption((option) => option.setName('ile').setDescription('How many merges at once (default 1)').setMinValue(1).setMaxValue(MAX_MERGES)),

    async autocomplete(interaction, client) {
        const focused = interaction.options.getFocused(true);
        const userData = await getEconomyData(client ?? interaction.client, interaction.guildId, interaction.user.id, { joint: false });
        const wanted = fold(focused.value);
        await interaction.respond(mergeableCards(userData)
            .map((entry) => ({ ...entry, label: cardLabel(entry.key) }))
            .filter((entry) => !wanted || fold(entry.label).includes(wanted))
            .slice(0, 25)
            .map((entry) => ({
                name: `${entry.label} ×${entry.count} → ${tr(nextRarity(entry.card.rarity).label)} (${Math.floor(entry.count / MERGE_COUNT)}x)`.slice(0, 100),
                value: entry.key,
            })));
    },

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;
        const guildId = interaction.guildId;
        await getEconomySettings(guildId);
        const { card, used, results, rarity, progress } = await mergeCards({
            client, guildId, userId: interaction.user.id, cardKey: interaction.options.getString('karta'),
            times: interaction.options.getInteger('ile') ?? 1, userError,
        });
        const embed = createEmbed({
            title: t('🔨 Cards merged'),
            description: [
                t`${used}× ${card.emoji} ${card.name} → ${results.length}× ${rarity.emoji} **${tr(rarity.label)}**`,
                '',
                ...results.map(({ card: result, variant, value, isNew }) => `${variant.emoji || result.emoji} **${result.name}**${variant.label ? ` (${tr(variant.label)})` : ''} · ${money(guildId, value)}${isNew ? ' 🆕' : ''}`),
                '',
                t('-# See them in `/index`.'),
            ].join('\n'),
            color: rarity.color,
            footer: false,
        });
        return InteractionHelper.safeEditReply(interaction, { embeds: [embed, ...progressEmbeds(progress, guildId)] });
    }, { command: 'polacz' })
};
