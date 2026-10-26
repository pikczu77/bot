// /minecraft czat [kanal] [wydarzenia] — links a Discord channel with the Minecraft chat
// (src/services/minecraftChat.js). Without a channel it turns the link off.

import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { createEmbed, successEmbed } from '../../../utils/embeds.js';
import { requireBotPermission, requirePermission, respond, userError } from '../../../utils/featureKit.js';
import { getWhitelistConfig } from '../../../services/minecraftWhitelist.js';
import { setChatChannel, syncChatBridge } from '../../../services/minecraftChat.js';
import { t } from '../../../i18n/index.js';

const CHANNEL_PERMISSIONS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory];

export function chatSubcommand(sub) {
    return sub
        .setName('czat')
        .setDescription('Link a channel with the Minecraft chat, both ways (Manage Server)')
        .addChannelOption((option) =>
            option.setName('kanal').setDescription('Chat channel; leave empty to turn the link off').addChannelTypes(ChannelType.GuildText),
        )
        .addBooleanOption((option) =>
            option.setName('wydarzenia').setDescription('Also post joins, leaves, deaths and advancements (default: yes)'),
        );
}

/** Throws when `channel` cannot be the chat channel. */
export async function assertChatChannelAllowed(guild, channelId) {
    const config = await getWhitelistConfig(guild.id);
    if (!config.apiKey) throw userError(t('Connect the server panel first with `/minecraft whitelista ustaw`.'));
    if (config.enabled && config.channelId === channelId) throw userError(t('This is the whitelist channel. Pick another channel for the chat.'));
    if (config.consoleChannelId === channelId) throw userError(t('This is the console channel. Pick another channel for the chat.'));
}

export async function runChat(interaction) {
    requirePermission(interaction, PermissionFlagsBits.ManageGuild);
    const guild = interaction.guild;
    const channel = interaction.options.getChannel('kanal');
    const events = interaction.options.getBoolean('wydarzenia');

    if (!channel) {
        await setChatChannel(guild.id, null, events);
        await syncChatBridge(guild);
        return respond(interaction, successEmbed(t('Minecraft chat link is off'), t('The channel and the game chat are no longer linked.')), { ephemeral: true });
    }

    requireBotPermission(guild, CHANNEL_PERMISSIONS, channel);
    await assertChatChannelAllowed(guild, channel.id);
    const saved = await setChatChannel(guild.id, channel.id, events);
    await syncChatBridge(guild);
    const me = guild.members.me;
    const webhooks = me ? channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageWebhooks) : true;
    return respond(interaction, createEmbed({
        title: t('✅ Minecraft chat is linked'),
        description: [
            t`Messages in ${channel} go to the game, and the game chat comes here.`,
            saved.chatEvents !== false ? t('Joins, leaves, deaths and advancements are posted too.') : t('Only chat messages are posted (no joins, leaves or deaths).'),
            webhooks ? null : t('⚠️ Give the bot **Manage Webhooks** on this channel to show players with their own name and head.'),
        ].filter(Boolean).join('\n\n'),
        color: 'success',
        footer: false,
    }), { ephemeral: true });
}
