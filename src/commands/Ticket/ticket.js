import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { handleTicketMemberCommand } from './modules/ticket_members.js';

// Only what happens inside a ticket. The ticket system itself is set up in the web panel (owner, 2026-10-30).
export default {
    data: new SlashCommandBuilder()
        .setName("ticket")
        .setDescription("Manages the server's ticket system.")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addSubcommand((subcommand) =>
            subcommand
                .setName("dodaj")
                .setDescription("Adds a member to the current ticket.")
                .addUserOption((option) =>
                    option.setName("user").setDescription("The member to add.").setRequired(true),
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("usun")
                .setDescription("Removes a member from the current ticket.")
                .addUserOption((option) =>
                    option.setName("user").setDescription("The member to remove.").setRequired(true),
                ),
        )
        .addSubcommand((subcommand) =>
            subcommand
                .setName("rename")
                .setDescription("Renames the current ticket channel.")
                .addStringOption((option) =>
                    option.setName("name").setDescription("The new channel name.").setRequired(true).setMaxLength(90),
                ),
        ),
    category: "ticket",

    async execute(interaction, config, client) {
        const deferred = await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        if (!deferred) {
            return;
        }

        // Ticket staff manage members of a ticket without needing Manage Channels.
        return handleTicketMemberCommand(interaction, client, interaction.options.getSubcommand());
    }
};
