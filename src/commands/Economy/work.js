import { SlashCommandBuilder } from 'discord.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { runWork } from './modules/work_shift.js';

// The first /work offers 3 jobs for the member's server level; each job lasts 5 shifts.
// See src/services/economyJobs.js and modules/work_shift.js.
export default {
    data: new SlashCommandBuilder()
        .setName('work')
        .setDescription('Work to earn some money'),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const reply = await runWork({ client, guildId: interaction.guildId, user: interaction.user });
        await InteractionHelper.safeEditReply(interaction, reply);
    }, { command: 'work' })
};
