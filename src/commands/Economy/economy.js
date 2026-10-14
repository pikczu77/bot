import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import economyDashboard from './modules/economy_dashboard.js';
import shopConfigSetrole from './modules/shop_config_setrole.js';

export default {
    slashOnly: true,
    data: new SlashCommandBuilder()
        .setName('economy')
        .setDescription('Economy management commands')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addSubcommand(subcommand =>
            subcommand
                .setName('dashboard')
                .setDescription('Open the economy management dashboard')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('rola-premium')
                .setDescription('Set the Discord role granted when the Premium Role shop item is purchased.')
                .addRoleOption(option =>
                    option
                        .setName('rola')
                        .setDescription('The role to grant for Premium Role purchases.')
                        .setRequired(true),
                ),
        ),
    category: 'Economy',

    async execute(interaction, config, client) {
        const subcommand = interaction.options.getSubcommand();

        // Answers on its own (a private reply).
        if (subcommand === 'rola-premium') {
            return shopConfigSetrole.execute(interaction, config, client);
        }

        const deferred = await InteractionHelper.safeDefer(interaction, {
            flags: MessageFlags.Ephemeral,
        });
        if (!deferred) return;

        if (subcommand === 'dashboard') {
            await economyDashboard.execute(interaction, config, client);
        }
    }
};
