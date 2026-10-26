import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { showWordle } from './modules/wordle_game.js';

// /wordle — one Polish five-letter word a day, six guesses, money for solving it (2026-10-26).
// Rules: services/wordle.js; board, button and form: modules/wordle_game.js.

export default {
    data: new SlashCommandBuilder()
        .setName('wordle')
        .setDescription('Guess the Polish word of the day in six tries and win money (once a day)'),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;
        await InteractionHelper.safeEditReply(interaction, await showWordle({ client, guildId: interaction.guildId, user: interaction.user }));
    }, { command: 'wordle' })
};
