import { SlashCommandBuilder } from 'discord.js';
import { withErrorHandling } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { HEIST_TARGETS, openLobby } from './modules/heist.js';

// /napad — a team heist with a lobby, invites and one shared roll (2026-10-26).
// Code: modules/heist.js; buttons interactions/buttons/economy/heist.js; invite picker selectMenus/economy/heist.js.

export default {
    data: new SlashCommandBuilder()
        .setName('napad')
        .setDescription('Gather a crew and pull off a heist together')
        .addStringOption(option =>
            option
                .setName('cel')
                .setDescription('What you rob: bigger targets need a bigger crew')
                .setRequired(true)
                .addChoices(...HEIST_TARGETS.map((target) => ({ name: `${target.emoji} ${target.name} (${target.minCrew}+)`, value: target.id })))
        )
        .addBooleanOption(option =>
            option
                .setName('tylko_zaproszeni')
                .setDescription('Only members you invite can join (default: everyone)')
                .setRequired(false)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;

        const { lobby, payload } = await openLobby({
            client,
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            leader: interaction.user,
            leaderName: interaction.member?.displayName ?? interaction.user.username,
            targetId: interaction.options.getString('cel'),
            inviteOnly: interaction.options.getBoolean('tylko_zaproszeni') ?? false,
        });
        await InteractionHelper.safeEditReply(interaction, payload);
        // The lobby message is edited later (invites from the private picker, closing when nobody started).
        lobby.message = await interaction.fetchReply?.().catch(() => null) ?? null;
    }, { command: 'napad' })
};
