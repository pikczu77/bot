import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import economyDashboard from './modules/economy_dashboard.js';
import shopConfigSetrole from './modules/shop_config_setrole.js';
import economyGuide from './modules/economy_guide.js';
import { buildAdminView } from './modules/economy_admin.js';
import { warningEmbed } from '../../utils/embeds.js';
import { t } from '../../i18n/index.js';

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
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('gracz')
                .setDescription("One member's economy: reset money, free from jail, remove upgrades")
                .addUserOption(option =>
                    option
                        .setName('osoba')
                        .setDescription('The member')
                        .setRequired(true),
                ),
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('poradnik')
                .setDescription('Post the economy guide (every command and how it works) in a channel')
                .addChannelOption(option =>
                    option
                        .setName('kanal')
                        .setDescription('Channel for the guide (default: this channel)')
                        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                        .setRequired(false),
                ),
        ),
    category: 'Economy',

    async execute(interaction, config, client) {
        const subcommand = interaction.options.getSubcommand();

        // Answers on its own (a private reply).
        if (subcommand === 'rola-premium') {
            return shopConfigSetrole.execute(interaction, config, client);
        }
        if (subcommand === 'poradnik') {
            return economyGuide.execute(interaction, config, client);
        }

        const deferred = await InteractionHelper.safeDefer(interaction, {
            flags: MessageFlags.Ephemeral,
        });
        if (!deferred) return;

        if (subcommand === 'dashboard') {
            await economyDashboard.execute(interaction, config, client);
        }
        if (subcommand === 'gracz') {
            const user = interaction.options.getUser('osoba');
            const view = user.bot
                ? { embeds: [warningEmbed(t('Economy'), t("Bots don't have an economy balance."))] }
                : await buildAdminView({ client, guildId: interaction.guildId, user });
            await InteractionHelper.safeEditReply(interaction, view);
        }
    }
};
