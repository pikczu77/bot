import { SlashCommandBuilder } from 'discord.js';
import { successEmbed, warningEmbed, formatDuration } from '../../utils/embeds.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { t, tr } from '../../i18n/index.js';
import { money } from '../../services/economySettings.js';
import { ROULETTE_BETS, chanceLine, luckLines, playRound, rouletteColor, spinRoulette } from '../../services/casino.js';

// European roulette: colours, even/odd, halves and dozens, zero or one number.
export default {
    data: new SlashCommandBuilder()
        .setName('ruletka')
        .setDescription('Roulette - bet on a colour, a range or a number')
        .addIntegerOption(option =>
            option
                .setName('stawka')
                .setDescription('Amount of cash to bet')
                .setRequired(true)
                .setMinValue(1)
        )
        .addStringOption(option =>
            option
                .setName('zaklad')
                .setDescription('What you bet on')
                .setRequired(true)
                .addChoices(
                    { name: 'Red (x1.7)', value: 'czerwone' },
                    { name: 'Black (x1.7)', value: 'czarne' },
                    { name: 'Even (x1.7)', value: 'parzyste' },
                    { name: 'Odd (x1.7)', value: 'nieparzyste' },
                    { name: '1-18 (x1.7)', value: 'niskie' },
                    { name: '19-36 (x1.7)', value: 'wysokie' },
                    { name: '1-12 (x3)', value: 'tuzin1' },
                    { name: '13-24 (x3)', value: 'tuzin2' },
                    { name: '25-36 (x3)', value: 'tuzin3' },
                    { name: 'Zero (x36)', value: 'zielone' },
                    { name: 'One number (x36) - type it in "liczba"', value: 'liczba' },
                )
        )
        .addIntegerOption(option =>
            option
                .setName('liczba')
                .setDescription('Your number for the "one number" bet (0-36)')
                .setRequired(false)
                .setMinValue(0)
                .setMaxValue(36)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const guildId = interaction.guildId;
        const bet = interaction.options.getInteger('stawka');
        const betId = interaction.options.getString('zaklad');
        const number = interaction.options.getInteger('liczba');

        if (!ROULETTE_BETS[betId]) {
            throw createError(`Unknown roulette bet ${betId}`, ErrorTypes.VALIDATION, t('Pick a bet from the list.'), { betId, expected: true });
        }
        if (betId === 'liczba' && number === null) {
            throw createError("Roulette number missing", ErrorTypes.VALIDATION,
                t('For the "one number" bet also fill in `liczba` (0-36).'), { expected: true });
        }

        const round = await playRound({ client, guildId, userId: interaction.user.id, bet }, ({ userData, luck }) => {
            const spin = spinRoulette(betId, number, luck.total);
            const payout = spin.win ? Math.floor(bet * spin.bet.payout) : 0;
            userData.wallet = (userData.wallet || 0) - bet + payout;
            return { ...spin, payout };
        });

        const target = betId === 'liczba' ? t`number ${number}` : tr(round.bet.name);
        const ball = t`🎡 The ball lands on **${round.result} ${rouletteColor(round.result)}**. Your bet: **${target}**.`;
        const embed = round.win
            ? successEmbed(t('🎉 Roulette - you won!'), `${ball}\n\n${t`You get **${money(guildId, round.payout)}** (x${round.bet.payout}).`}${luckLines(round.luck)}`)
            : warningEmbed(t('💔 Roulette - you lost'), `${ball}\n\n${t`Your **${money(guildId, bet)}** stays at the table.`}${luckLines(round.luck)}`);

        embed
            .addFields({ name: t("New Cash Balance"), value: money(guildId, round.userData.wallet), inline: true })
            .setFooter({ text: `${chanceLine(round.base, round.chance, round.luck)}\n${t`Next game in ${formatDuration(round.cooldown)}.`}` });

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'ruletka' })
};
