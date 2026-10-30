import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { createEmbed, successEmbed, infoEmbed } from '../../utils/embeds.js';
import { respond, requireGuild, requirePermission, requireBotPermission, userError, truncate } from '../../utils/featureKit.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import {
    buildStatusEmbed,
    fetchMinecraftStatus,
    getMinecraftServers,
    normalizeAddress,
    refreshGuildMinecraft,
    trackServer,
    untrackServer,
} from '../../services/minecraftService.js';
import { addWhitelistGroup, autocompleteWhitelist, runWhitelist } from './modules/whitelist.js';
import { runServer, serverSubcommand } from './modules/server.js';
import { t } from '../../i18n/index.js';

export default {
    data: addWhitelistGroup(new SlashCommandBuilder()
        .setName('minecraft')
        .setDescription('Minecraft server status and live status card')
        .addSubcommand((sub) =>
            sub
                .setName('status')
                .setDescription('Check a Minecraft server right now')
                .addStringOption((option) => option.setName('address').setDescription('Server address, e.g. play.example.com').setAutocomplete(true))
                .addBooleanOption((option) => option.setName('bedrock').setDescription('Bedrock Edition server (default: Java)')),
        )
        .addSubcommand((sub) =>
            sub
                .setName('track')
                .setDescription('Post a live status card that updates itself (admin)')
                .addStringOption((option) => option.setName('address').setDescription('Server address').setRequired(true))
                .addChannelOption((option) =>
                    option.setName('channel').setDescription('Channel for the card and announcements').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true),
                )
                .addStringOption((option) => option.setName('name').setDescription('Display name').setMaxLength(60))
                .addBooleanOption((option) => option.setName('players').setDescription('Announce players joining and leaving (default: no)'))
                .addRoleOption((option) => option.setName('role').setDescription('Role to ping when the server comes online'))
                .addBooleanOption((option) => option.setName('bedrock').setDescription('Bedrock Edition server (default: Java)')),
        )
        .addSubcommand((sub) =>
            sub
                .setName('untrack')
                .setDescription('Stop tracking a server (admin)')
                .addStringOption((option) => option.setName('address').setDescription('Tracked server').setRequired(true).setAutocomplete(true)),
        )
        .addSubcommand((sub) => sub.setName('list').setDescription('Show tracked servers'))
        .addSubcommand(serverSubcommand)),
    slashOnly: true,

    async autocomplete(interaction) {
        if (interaction.options.getSubcommandGroup(false) === 'whitelista') return autocompleteWhitelist(interaction);
        const servers = await getMinecraftServers(interaction.guildId);
        const typed = interaction.options.getFocused().toLowerCase();
        await interaction.respond(
            servers
                .filter((server) => server.address.includes(typed) || (server.name ?? '').toLowerCase().includes(typed))
                .slice(0, 25)
                .map((server) => ({ name: truncate(server.name ? `${server.name} (${server.address})` : server.address, 100), value: server.address })),
        );
    },

    async execute(interaction) {
        const guild = requireGuild(interaction);
        if (interaction.options.getSubcommandGroup(false) === 'whitelista') return runWhitelist(interaction);
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'serwer') return runServer(interaction);
        const servers = await getMinecraftServers(guild.id);

        if (subcommand === 'list') {
            if (servers.length === 0) {
                return respond(interaction, infoEmbed(t('No Minecraft servers are tracked. Add one with `/minecraft track`.')), { ephemeral: true });
            }
            return respond(interaction, createEmbed({
                title: t('⛏️ Tracked Minecraft servers'),
                description: servers.map((server) => [
                    `**${server.name || server.address}** — \`${server.address}\``,
                    `<#${server.channelId}> · ${server.last?.online ? `🟢 ${server.last.count}` : '🔴'}${server.announcePlayers ? ` · ${t('player messages on')}` : ''}`,
                ].join('\n')).join('\n\n'),
                footer: false,
            }), { ephemeral: true });
        }

        if (subcommand === 'status') {
            const typed = interaction.options.getString('address');
            const tracked = servers.find((server) => server.address === typed) ?? (typed ? null : servers[0]);
            if (!typed && !tracked) {
                throw userError(t('Give a server address, or track a server first with `/minecraft track`.'));
            }
            const address = tracked?.address ?? normalizeAddress(typed);
            const bedrock = interaction.options.getBoolean('bedrock') ?? tracked?.bedrock ?? false;
            await InteractionHelper.safeDefer(interaction);
            const status = await fetchMinecraftStatus(address, { bedrock }).catch(() => {
                throw userError(t('The status service did not answer. Try again in a moment.'));
            });
            return respond(interaction, buildStatusEmbed({ address, name: tracked?.name ?? null }, status));
        }

        requirePermission(interaction, PermissionFlagsBits.ManageGuild);

        if (subcommand === 'track') {
            const address = normalizeAddress(interaction.options.getString('address'));
            const channel = interaction.options.getChannel('channel');
            requireBotPermission(guild, [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks], channel);
            await InteractionHelper.safeDefer(interaction);
            await trackServer(guild.id, {
                address,
                name: interaction.options.getString('name') ?? null,
                bedrock: interaction.options.getBoolean('bedrock') ?? false,
                channelId: channel.id,
                announcePlayers: interaction.options.getBoolean('players') ?? false,
                roleId: interaction.options.getRole('role')?.id ?? null,
                messageId: null,
                last: null,
            });
            await refreshGuildMinecraft(guild);
            return respond(interaction, successEmbed(
                t`Tracking \`${address}\``,
                t`The status card is in ${channel} and updates every 2 minutes.`,
            ));
        }

        if (subcommand === 'untrack') {
            const address = interaction.options.getString('address').trim().toLowerCase();
            const removed = await untrackServer(guild.id, address);
            if (!removed) throw userError(t`\`${address}\` is not tracked.`);
            const channel = guild.channels.cache.get(removed.channelId);
            if (removed.messageId && channel?.isTextBased?.()) {
                await channel.messages.delete(removed.messageId).catch(() => {});
            }
            return respond(interaction, successEmbed(t`Stopped tracking \`${address}\`.`));
        }

        throw userError(t('This subcommand is not recognised.'));
    },
};
