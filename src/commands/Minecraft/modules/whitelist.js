// /minecraft whitelista — admin side of the channel whitelist (src/services/minecraftWhitelist.js).
// `ustaw` opens a private form for the panel address, server ID and API key, so the key is
// never typed into a channel. The form's answer is handled by submitWhitelistSetup.

import { ActionRowBuilder, ChannelType, MessageFlags, ModalBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle } from 'discord.js';
import { createEmbed, successEmbed } from '../../../utils/embeds.js';
import { requireBotPermission, requirePermission, respond, truncate, userError } from '../../../utils/featureKit.js';
import { InteractionHelper } from '../../../utils/interactionHelper.js';
import {
    DEFAULT_PANEL_URL,
    PanelError,
    addNick,
    channelGuideEmbed,
    checkPanel,
    claimNick,
    countWhitelist,
    getWhitelistConfig,
    normalizePanelUrl,
    normalizeServerId,
    panelErrorText,
    parseNick,
    releaseNick,
    updateWhitelistConfig,
} from '../../../services/minecraftWhitelist.js';
import { t } from '../../../i18n/index.js';

export const WHITELIST_MODAL = 'whitelista';
const CHANNEL_PERMISSIONS = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.ReadMessageHistory,
];
const LIST_LIMIT = 40;

export function addWhitelistGroup(builder) {
    return builder.addSubcommandGroup((group) =>
        group
            .setName('whitelista')
            .setDescription('Whitelist Minecraft nicks that members write in a channel (admin)')
            .addSubcommand((sub) =>
                sub
                    .setName('ustaw')
                    .setDescription('Connect the server panel and pick the channel for nicks')
                    .addChannelOption((option) =>
                        option.setName('kanal').setDescription('Channel where members write their nick').addChannelTypes(ChannelType.GuildText).setRequired(true),
                    )
                    .addRoleOption((option) => option.setName('rola').setDescription('Role given to members on the whitelist'))
                    .addBooleanOption((option) => option.setName('usun_po_wyjsciu').setDescription('Take the nick off when the member leaves Discord (default: yes)')),
            )
            .addSubcommand((sub) =>
                sub
                    .setName('dodaj')
                    .setDescription('Add a nick to the whitelist')
                    .addStringOption((option) => option.setName('nick').setDescription('Minecraft nick').setRequired(true).setMinLength(3).setMaxLength(16))
                    .addUserOption((option) => option.setName('osoba').setDescription('Member this nick belongs to (replaces their old nick)')),
            )
            .addSubcommand((sub) =>
                sub
                    .setName('usun')
                    .setDescription('Take a nick off the whitelist')
                    .addStringOption((option) => option.setName('nick').setDescription('Minecraft nick').setRequired(true).setMaxLength(16).setAutocomplete(true)),
            )
            .addSubcommand((sub) => sub.setName('lista').setDescription('Show the settings and who has which nick'))
            .addSubcommand((sub) => sub.setName('wylacz').setDescription('Turn the nick channel off and forget the panel key')),
    );
}

export async function autocompleteWhitelist(interaction) {
    const config = await getWhitelistConfig(interaction.guildId);
    const typed = String(interaction.options.getFocused() ?? '').toLowerCase();
    await interaction.respond(
        Object.values(config.members)
            .map((entry) => entry.name)
            .filter((name) => name.toLowerCase().includes(typed))
            .slice(0, 25)
            .map((name) => ({ name, value: name })),
    );
}

/** Run a panel call; panel failures become a message for the admin. */
async function panelCall(task) {
    try {
        return await task();
    } catch (error) {
        if (error instanceof PanelError) throw userError(panelErrorText(error));
        throw error;
    }
}

function requireNick(value) {
    const nick = parseNick(value);
    if (!nick) throw userError(t('A Minecraft nick has 3-16 characters: letters, digits and `_`.'));
    return nick;
}

function checkRole(guild, role) {
    if (role.id === guild.id || role.managed) throw userError(t`${role} cannot be given by a bot.`);
    requireBotPermission(guild, [PermissionFlagsBits.ManageRoles]);
    const highest = guild.members.me?.roles?.highest?.position;
    if (typeof highest === 'number' && role.position >= highest) {
        throw userError(t`${role} is above my highest role. Move my role higher in the server settings.`);
    }
}

function setupModal(config, { channelId, roleId, removeOnLeave }) {
    const server = new TextInputBuilder()
        .setCustomId('server')
        .setLabel(t('Server ID (from the link /server/...)'))
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('https://ptero.mathost.eu/server/1a2b3c4d')
        .setMaxLength(200)
        .setRequired(true);
    if (config.serverId) server.setValue(config.serverId);

    const key = new TextInputBuilder()
        .setCustomId('key')
        .setLabel(t('Client API key from the panel'))
        .setStyle(TextInputStyle.Short)
        .setMaxLength(200)
        .setRequired(!config.apiKey);
    if (config.apiKey) key.setPlaceholder(t('Leave empty to keep the saved key'));

    return new ModalBuilder()
        .setCustomId(`${WHITELIST_MODAL}:ustaw:${channelId}:${roleId ?? '-'}:${removeOnLeave ? 1 : 0}`)
        .setTitle(t('Minecraft server panel'))
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('panel')
                    .setLabel(t('Panel address'))
                    .setStyle(TextInputStyle.Short)
                    .setValue(config.panelUrl || DEFAULT_PANEL_URL)
                    .setMaxLength(200)
                    .setRequired(true),
            ),
            new ActionRowBuilder().addComponents(server),
            new ActionRowBuilder().addComponents(key),
        );
}

const stateText = (state) => ({
    running: `🟢 ${t('Running')}`,
    offline: `🔴 ${t('Stopped')}`,
    starting: `🟡 ${t('Starting')}`,
    stopping: `🟡 ${t('Stopping')}`,
}[state] ?? state ?? '—');

const yesNo = (value) => (value ? t('yes') : t('no'));

/** Answer of the `ustaw` form. args: ['ustaw', channelId, roleId | '-', '1' | '0']. */
export async function submitWhitelistSetup(interaction, args) {
    const [action, channelId, roleId, leave] = args;
    if (action !== 'ustaw') throw userError(t('This form is not available.'));
    requirePermission(interaction, PermissionFlagsBits.ManageGuild);
    const guild = interaction.guild;
    const channel = guild?.channels.cache.get(channelId);
    if (!channel) throw userError(t('That channel no longer exists.'));

    const current = await getWhitelistConfig(guild.id);
    const panelUrl = normalizePanelUrl(interaction.fields.getTextInputValue('panel'));
    const serverId = normalizeServerId(interaction.fields.getTextInputValue('server'));
    const typedKey = interaction.fields.getTextInputValue('key')?.trim() ?? '';
    // The saved key only ever goes back to the panel it was typed for.
    if (!typedKey && current.apiKey && panelUrl !== current.panelUrl) {
        throw userError(t('The panel address changed, so type the API key again.'));
    }
    const apiKey = typedKey || current.apiKey;
    if (!apiKey) throw userError(t('Type the API key from the panel.'));
    if (/\s/.test(apiKey) || apiKey.length < 20) throw userError(t('That does not look like a panel API key.'));

    await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
    const panel = { panelUrl, serverId, apiKey };
    const facts = await panelCall(() => checkPanel(panel));

    await updateWhitelistConfig(guild.id, (data) => {
        Object.assign(data, panel, {
            enabled: true,
            channelId: channel.id,
            roleId: roleId === '-' ? null : roleId,
            removeOnLeave: leave === '1',
        });
    });
    await channel.send({ embeds: [channelGuideEmbed()] }).catch(() => {});

    const notes = [];
    if (facts.whitelistOn === false) {
        notes.push(t('⚠️ The whitelist is off on the server (`white-list=false`), so anyone can join. Type `whitelist on` in the server console.'));
    }
    if (facts.onlineMode === false) {
        notes.push(t('The server is in offline mode (non-premium): nicks are not checked against Minecraft accounts.'));
    }
    return respond(interaction, createEmbed({
        title: t('✅ Minecraft whitelist is on'),
        description: [t`Members write their nick in ${channel}.`, ...notes].join('\n\n'),
        color: 'success',
        fields: [
            { name: t('Server'), value: truncate(facts.name || serverId, 100), inline: true },
            { name: t('State'), value: stateText(facts.state), inline: true },
            { name: t('Role'), value: roleId === '-' ? '—' : `<@&${roleId}>`, inline: true },
            { name: t('Remove when they leave'), value: yesNo(leave === '1'), inline: true },
        ],
        footer: false,
    }), { ephemeral: true });
}

export async function runWhitelist(interaction) {
    requirePermission(interaction, PermissionFlagsBits.ManageGuild);
    const guild = interaction.guild;
    const subcommand = interaction.options.getSubcommand();
    const config = await getWhitelistConfig(guild.id);

    if (subcommand === 'ustaw') {
        const channel = interaction.options.getChannel('kanal');
        requireBotPermission(guild, CHANNEL_PERMISSIONS, channel);
        const role = interaction.options.getRole('rola');
        if (role) checkRole(guild, role);
        return interaction.showModal(setupModal(config, {
            channelId: channel.id,
            roleId: role?.id ?? null,
            removeOnLeave: interaction.options.getBoolean('usun_po_wyjsciu') ?? true,
        }));
    }

    if (subcommand === 'wylacz') {
        await updateWhitelistConfig(guild.id, (data) => {
            data.enabled = false;
            data.apiKey = null;
        });
        return respond(interaction, successEmbed(
            t('Minecraft whitelist is off'),
            t('The bot no longer reads the nick channel and forgot the panel key. Nicks already on the whitelist stay there.'),
        ), { ephemeral: true });
    }

    if (subcommand === 'lista') {
        const members = Object.entries(config.members);
        await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
        const total = config.apiKey
            ? await countWhitelist({ panelUrl: config.panelUrl, serverId: config.serverId, apiKey: config.apiKey }).catch(() => null)
            : null;
        const lines = members
            .sort(([, a], [, b]) => a.name.localeCompare(b.name))
            .slice(0, LIST_LIMIT)
            .map(([userId, entry]) => `<@${userId}> — \`${entry.name}\``);
        if (members.length > LIST_LIMIT) lines.push(t`…and ${members.length - LIST_LIMIT} more`);
        return respond(interaction, createEmbed({
            title: t('⛏️ Minecraft whitelist'),
            description: lines.join('\n') || t('Nobody has written a nick yet.'),
            fields: [
                { name: t('State'), value: config.enabled && config.apiKey ? t('on') : t('off'), inline: true },
                { name: t('Channel'), value: config.channelId ? `<#${config.channelId}>` : '—', inline: true },
                { name: t('On the server whitelist'), value: total === null ? '—' : String(total), inline: true },
            ],
            footer: false,
        }), { ephemeral: true });
    }

    const nick = requireNick(interaction.options.getString('nick'));
    await InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });

    if (subcommand === 'dodaj') {
        const user = interaction.options.getUser('osoba');
        if (user) {
            const member = await guild.members.fetch(user.id).catch(() => null);
            if (!member) throw userError(t('That member is not on this server.'));
            const result = await panelCall(() => claimNick(guild, member, nick));
            const text = [t`\`${result.name}\` belongs to ${member} now.`];
            if (result.previous) text.push(t`\`${result.previous}\` was taken off.`);
            return respond(interaction, successEmbed(t('Added to the whitelist'), text.join('\n')), { ephemeral: true });
        }
        const result = await panelCall(() => addNick(guild, nick));
        return respond(interaction, successEmbed(
            result.already ? t`\`${result.name}\` is on the whitelist.` : t`Added \`${result.name}\` to the whitelist.`,
        ), { ephemeral: true });
    }

    if (subcommand === 'usun') {
        const { removed, ownerId } = await panelCall(() => releaseNick(guild, nick));
        const text = removed ? t`Took \`${nick}\` off the whitelist.` : t`\`${nick}\` was not on the whitelist.`;
        return respond(interaction, successEmbed(ownerId ? `${text}\n${t`It belonged to <@${ownerId}>.`}` : text), { ephemeral: true });
    }

    throw userError(t('This subcommand is not recognised.'));
}
