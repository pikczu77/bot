import { SlashCommandBuilder } from 'discord.js';
import { successEmbed, warningEmbed, formatDuration } from '../../utils/embeds.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { t } from '../../i18n/index.js';
import { money } from '../../services/economySettings.js';
import { applyLuck, chanceLine, luckLines, playRound } from '../../services/casino.js';

// Double or nothing with the server's win chance and payout. Shares the break, the highest
// bet and luck with /ruletka, /slots and /blackjack (src/services/casino.js).
export default {
    data: new SlashCommandBuilder()
        .setName('gamble')
        .setDescription('Gamble your money for a chance to win more')
        .addIntegerOption(option =>
            option
                .setName('amount')
                .setDescription('Amount of cash to gamble')
                .setRequired(true)
                .setMinValue(1)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const guildId = interaction.guildId;
        const betAmount = interaction.options.getInteger("amount");

        const round = await playRound({ client, guildId, userId: interaction.user.id, bet: betAmount }, ({ settings, userData, luck }) => {
            const { gamble } = settings.commands;
            const base = gamble.winPercent / 100;
            const chance = applyLuck(base, luck.total, gamble.payoutPercent / 100);
            const win = Math.random() < chance;
            const amountWon = Math.floor(betAmount * gamble.payoutPercent / 100);
            // The bet was at stake, not taken in advance: a win replaces it with the payout.
            userData.wallet = (userData.wallet || 0) + (win ? amountWon - betAmount : -betAmount);
            return { base, chance, win, amountWon };
        });

        const resultEmbed = round.win
            ? successEmbed(
                t("🎉 You Won!"),
                t`You successfully gambled and turned your **${money(guildId, betAmount)}** bet into **${money(guildId, round.amountWon)}**!` + luckLines(round.luck),
            )
            : warningEmbed(
                t("💔 You Lost..."),
                t`The dice rolled against you. You lost your **${money(guildId, betAmount)}** bet.` + luckLines(round.luck),
            );

        resultEmbed
            .addFields({ name: t("New Cash Balance"), value: money(guildId, round.userData.wallet), inline: true })
            .setFooter({ text: `${chanceLine(round.base, round.chance, round.luck)}\n${t`Next game in ${formatDuration(round.cooldown)}.`}` });

        await InteractionHelper.safeEditReply(interaction, { embeds: [resultEmbed] });
    }, { command: 'gamble' })
};
