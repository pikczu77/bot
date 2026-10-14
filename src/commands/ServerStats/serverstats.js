import { getColor } from '../../config/bot.js';
import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } from 'discord.js';
import { createEmbed, successEmbed } from '../../utils/embeds.js';
import { logger } from '../../utils/logger.js';

import { handleCreate } from './modules/serverstats_create.js';
import { handleList } from './modules/serverstats_list.js';
import { handleUpdate } from './modules/serverstats_update.js';
import { handleDelete } from './modules/serverstats_delete.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
import { replyUserError, ErrorTypes } from '../../utils/errorHandler.js';
import { t } from '../../i18n/index.js';
export default {
    data: new SlashCommandBuilder()
        .setName("statystyki")
        .setDescription("Manage server statistics that track member counts and channel data")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .addSubcommand(subcommand =>
            subcommand
                .setName("create")
                .setDescription("Create a new statistics tracker channel in a category")
                .addStringOption(option =>
                    option
                        .setName("type")
                        .setDescription("The type of statistics to track")
                        .setRequired(true)
                        .addChoices(
                            { name: "members + bots", value: "members" },
                            { name: "members only", value: "members_only" },
                            { name: "bots only", value: "bots" }
                        )
                )
                .addStringOption(option =>
                    option
                        .setName("channel_type")
                        .setDescription("The channel type to create for this tracker")
                        .setRequired(true)
                        .addChoices(
                            { name: "voice channel (recommended)", value: "voice" },
                            { name: "text channel", value: "text" }
                        )
                )
                .addChannelOption(option =>
                    option
                        .setName("category")
                        .setDescription("The category where the statistics tracker channel will be created")
                        .setRequired(true)
                        .addChannelTypes(ChannelType.GuildCategory)
                )
                .addStringOption(option =>
                    option
                        .setName("nazwa")
                        .setDescription("Channel name, {count} = number, e.g. Ludzie: {count}")
                        .setRequired(false)
                        .setMaxLength(90)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName("list")
                .setDescription("List all statistics trackers for this server")
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName("update")
                .setDescription("Update an existing statistics tracker")
                .addStringOption(option =>
                    option
                        .setName("counter-id")
                        .setDescription("The ID of the tracker to update")
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName("type")
                        .setDescription("The new tracker type")
                        .setRequired(false)
                        .addChoices(
                            { name: "members + bots", value: "members" },
                            { name: "members only", value: "members_only" },
                            { name: "bots only", value: "bots" }
                        )
                )
                .addStringOption(option =>
                    option
                        .setName("nazwa")
                        .setDescription("New channel name, {count} = number, e.g. Ludzie: {count}")
                        .setRequired(false)
                        .setMaxLength(90)
                )
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName("usun")
                .setDescription("Delete an existing statistics tracker")
                .addStringOption(option =>
                    option
                        .setName("counter-id")
                        .setDescription("The ID of the tracker to delete")
                        .setRequired(true)
                )
        ),

    async execute(interaction, guildConfig, client) {
        const subcommand = interaction.options.getSubcommand();

        switch (subcommand) {
            case "create":
                await handleCreate(interaction, client);
                break;
            case "list":
                await handleList(interaction, client);
                break;
            case "update":
                await handleUpdate(interaction, client);
                break;
            case "usun":
                await handleDelete(interaction, client);
                break;
            default:
                await replyUserError(interaction, { type: ErrorTypes.VALIDATION, message: t('Unknown subcommand.') });
        }
    }
};