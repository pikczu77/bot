import { SlashCommandBuilder } from 'discord.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { createDuel } from './modules/duel.js';

// /pojedynek — rock, paper, scissors for money with another member (2026-10-26).
// Rules: modules/duel.js, buttons: interactions/buttons/economy/duel.js.

export default {
    data: new SlashCommandBuilder()
        .setName('pojedynek')
        .setDescription('Challenge someone to rock, paper, scissors for money')
        .addUserOption((option) => option.setName('osoba').setDescription('Who you challenge').setRequired(true))
        .addIntegerOption((option) => option.setName('kwota').setDescription('The stake: the loser pays it to the winner').setRequired(true).setMinValue(50)),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;
        await InteractionHelper.safeEditReply(interaction, await createDuel({
            client,
            guildId: interaction.guildId,
            challenger: interaction.user,
            opponent: interaction.options.getUser('osoba'),
            stake: interaction.options.getInteger('kwota'),
        }));
    }, { command: 'pojedynek' })
};
