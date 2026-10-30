import { SlashCommandBuilder } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { userError } from '../../utils/featureKit.js';
import { money } from '../../services/economySettings.js';
import { buyTickets, lotteryState } from '../../services/lottery.js';
import { progressEmbeds } from '../../services/progress.js';
import { t } from '../../i18n/index.js';

// /loteria kup | info — weekly lottery with a draw on Sunday at 20:00 (2026-10-26). Rules: services/lottery.js, settings in the web panel.

const percent = (chance) => `${Number((chance * 100).toFixed(chance < 0.1 ? 1 : 0))}%`;

async function infoEmbed(guildId, userId, notice = '') {
    const { lottery, round, total, mine, pot, chance } = await lotteryState(guildId, userId);
    const last = lottery.last;
    return createEmbed({
        title: t('🎟️ Weekly lottery'),
        description: [
            notice,
            t`**Pot:** ${money(guildId, pot)}`,
            t`**Draw:** <t:${Math.floor(round.drawAt / 1000)}:F> (<t:${Math.floor(round.drawAt / 1000)}:R>)`,
            t`**Tickets sold:** ${total}`,
            t`**Your tickets:** ${mine}/${lottery.maxTickets} · chance **${percent(chance)}**`,
            t`One ticket costs ${money(guildId, lottery.ticketPrice)}. The winner takes the whole pot.`,
            last?.winnerId ? t`\nLast draw: <@${last.winnerId}> won **${money(guildId, last.pot)}** (${last.tickets} {2|ticket|tickets}).` : null,
        ].filter(Boolean).join('\n'),
        color: '#F1C40F',
        footer: false,
    });
}

export default {
    data: new SlashCommandBuilder()
        .setName('loteria')
        .setDescription('Weekly lottery: buy tickets, the draw is on Sunday at 20:00')
        .addSubcommand((sub) => sub
            .setName('kup')
            .setDescription('Buy lottery tickets')
            .addIntegerOption((option) => option.setName('ilosc').setDescription('How many tickets (default 1)').setMinValue(1).setMaxValue(1000)))
        .addSubcommand((sub) => sub
            .setName('info')
            .setDescription('Pot, draw time and your chance')),

    execute: withErrorHandling(async (interaction, config, client) => {
        const sub = interaction.options.getSubcommand();
        const guildId = interaction.guildId;
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        if (sub === 'kup') {
            const result = await buyTickets({
                client, guildId, userId: interaction.user.id, count: interaction.options.getInteger('ilosc') ?? 1,
                channelId: interaction.channelId, userError,
            });
            const notice = t`✅ You bought **${result.bought}** {0|ticket|tickets} for ${money(guildId, result.cost)}.`;
            return InteractionHelper.safeEditReply(interaction, { embeds: [await infoEmbed(guildId, interaction.user.id, notice), ...progressEmbeds(result.progress, guildId)] });
        }
        return InteractionHelper.safeEditReply(interaction, { embeds: [await infoEmbed(guildId, interaction.user.id)] });
    }, { command: 'loteria' })
};
