import { SlashCommandBuilder } from 'discord.js';
import { successEmbed, warningEmbed, formatDuration } from '../../utils/embeds.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { progressEmbeds } from '../../services/progress.js';
import { t, tr } from '../../i18n/index.js';
import { money } from '../../services/economySettings.js';
import { SLOT_OUTCOMES, chanceLine, luckLines, playRound, spinSlots } from '../../services/casino.js';

const PAYTABLE = SLOT_OUTCOMES.map((outcome) => `${outcome.id === 'pair' ? '🍒🍒' : outcome.symbols[0].repeat(3)} x${outcome.payout}`).join(' · ');

// A slot machine with 3 reels; the pay table is in src/services/casino.js.
export default {
    data: new SlashCommandBuilder()
        .setName('slots')
        .setDescription('Slot machine - three of a kind pays up to x25')
        .addIntegerOption(option =>
            option
                .setName('stawka')
                .setDescription('Amount of cash to bet')
                .setRequired(true)
                .setMinValue(1)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const guildId = interaction.guildId;
        const bet = interaction.options.getInteger('stawka');

        const round = await playRound({ client, guildId, userId: interaction.user.id, bet }, ({ userData, luck }) => {
            const spin = spinSlots(luck.total);
            const payout = spin.outcome ? Math.floor(bet * spin.outcome.payout) : 0;
            userData.wallet = (userData.wallet || 0) - bet + payout;
            return { ...spin, payout, events: { casinoWin: spin.outcome ? 1 : 0, jackpot: spin.outcome?.id === 'jackpot' ? 1 : 0 } };
        });

        const machine = `🎰 **|** ${round.reels.join(' **|** ')} **|**`;
        const embed = round.outcome
            ? successEmbed(t('🎰 Slots - you won!'), `${machine}\n\n${t`**${tr(round.outcome.name)}** - you get **${money(guildId, round.payout)}** (x${round.outcome.payout}).`}${luckLines(round.luck)}`)
            : warningEmbed(t('🎰 Slots - no luck'), `${machine}\n\n${t`You lost **${money(guildId, bet)}**.`}${luckLines(round.luck)}`);

        embed
            .addFields(
                { name: t("New Cash Balance"), value: money(guildId, round.userData.wallet), inline: true },
                { name: t('Pay table'), value: PAYTABLE, inline: false },
            )
            .setFooter({ text: `${chanceLine(round.base, round.chance, round.luck)}\n${t`Next game in ${formatDuration(round.cooldown)}.`}` });

        await InteractionHelper.safeEditReply(interaction, { embeds: [embed, ...progressEmbeds(round.progress, guildId)] });
    }, { command: 'slots' })
};
