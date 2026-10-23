// /minecraft konsola [kanal] — picks the channel that works as the server console
// (src/services/minecraftConsole.js). Without a channel it turns the console off.

import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { createEmbed, successEmbed } from '../../../utils/embeds.js';
import { requireBotPermission, requirePermission, respond } from '../../../utils/featureKit.js';
import { assertConsoleChannelAllowed, consoleGuideEmbed, setConsoleChannel } from '../../../services/minecraftConsole.js';
import { t } from '../../../i18n/index.js';

const CHANNEL_PERMISSIONS = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.ReadMessageHistory,
];

export function consoleSubcommand(sub) {
    return sub
        .setName('konsola')
        .setDescription('Channel where admins type Minecraft server console commands (Administrator)')
        .addChannelOption((option) =>
            option.setName('kanal').setDescription('Console channel; leave empty to turn the console off').addChannelTypes(ChannelType.GuildText),
        );
}

export async function runConsole(interaction) {
    // The console can op players and stop the server, so Manage Server is not enough.
    requirePermission(interaction, PermissionFlagsBits.Administrator);
    const guild = interaction.guild;
    const channel = interaction.options.getChannel('kanal');

    if (!channel) {
        await setConsoleChannel(guild.id, null);
        return respond(interaction, successEmbed(t('Minecraft console is off'), t('Messages in the old console channel are no longer sent to the server.')), { ephemeral: true });
    }

    requireBotPermission(guild, CHANNEL_PERMISSIONS, channel);
    await assertConsoleChannelAllowed(guild, channel);
    await setConsoleChannel(guild.id, channel.id);
    await channel.send({ embeds: [consoleGuideEmbed()] }).catch(() => {});

    const everyone = guild.roles.everyone ?? guild.roles.cache.get(guild.id);
    const isPublic = everyone ? channel.permissionsFor(everyone)?.has(PermissionFlagsBits.ViewChannel) : false;
    return respond(interaction, createEmbed({
        title: t('✅ Minecraft console is on'),
        description: [
            t`Administrators can type server commands in ${channel}.`,
            isPublic ? t('⚠️ Everyone can see this channel, so everyone sees the console output. Make it private (only admins).') : null,
        ].filter(Boolean).join('\n\n'),
        color: 'success',
        footer: false,
    }), { ephemeral: true });
}
