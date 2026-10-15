import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { buildSuePreview } from './modules/lawsuit.js';

// /pozwij — sue a member for any amount (2026-10-15). The plaintiff first sees the chance
// privately and can change the amount; the result is posted in the channel. Rules: modules/lawsuit.js.

export default {
    data: new SlashCommandBuilder()
        .setName('pozwij')
        .setDescription('Sue a member for any amount - the higher it is, the lower the chance')
        .addUserOption(option =>
            option
                .setName('osoba')
                .setDescription('Who to sue')
                .setRequired(true)
        )
        .addIntegerOption(option =>
            option
                .setName('kwota')
                .setDescription('How much to sue for (you can change it before the case starts)')
                .setRequired(true)
                .setMinValue(1)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) return;

        const view = await buildSuePreview({
            client,
            guildId: interaction.guildId,
            plaintiff: interaction.user,
            defendant: interaction.options.getUser('osoba'),
            amount: interaction.options.getInteger('kwota'),
        });
        await InteractionHelper.safeEditReply(interaction, view);
    }, { command: 'pozwij' })
};
