import { SlashCommandBuilder } from 'discord.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { startBlackjack } from './modules/blackjack_game.js';

// Blackjack against the dealer, played with buttons (src/interactions/buttons/economy/blackjack.js).
export default {
    data: new SlashCommandBuilder()
        .setName('blackjack')
        .setDescription('Blackjack against the dealer - get closer to 21')
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

        const view = await startBlackjack({
            client,
            guildId: interaction.guildId,
            user: interaction.user,
            bet: interaction.options.getInteger('stawka'),
        });
        await InteractionHelper.safeEditReply(interaction, view);
    }, { command: 'blackjack' })
};
