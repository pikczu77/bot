// /channel zdjecia — a channel for pictures (fan art): reactions under every picture, other messages
// disappear (src/services/mediaChannels.js).

import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { createEmbed, successEmbed } from '../../../utils/embeds.js';
import { requireBotPermission, requireGuild, requirePermission, respond, userError } from '../../../utils/featureKit.js';
import { MAX_MEDIA_CHANNELS, parseReactions, removeMediaChannel, setMediaChannel } from '../../../services/mediaChannels.js';
import { t } from '../../../i18n/index.js';

const NEEDED = [
    PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory,
];

export const mediaChannel = {
    data: new SlashCommandBuilder()
        .setName('media')
        .setDescription('Pictures-only channel (fan art): reactions under pictures, other messages disappear')
        .addChannelOption((option) => option.setName('kanal').setDescription('The channel (default: this one)').addChannelTypes(ChannelType.GuildText))
        .addStringOption((option) => option.setName('emotki').setDescription('Reactions under every picture, e.g. ❤️ 🔥 (default ❤️)').setMaxLength(200))
        .addBooleanOption((option) => option.setName('usuwaj').setDescription('Delete messages without a picture (default: yes)'))
        .addBooleanOption((option) => option.setName('watki').setDescription('A thread for comments under every picture (default: no)'))
        .addBooleanOption((option) => option.setName('wylacz').setDescription('Make it a normal channel again'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    category: 'moderation',

    async execute(interaction) {
        const guild = requireGuild(interaction);
        requirePermission(interaction, PermissionFlagsBits.ManageChannels);
        const channel = interaction.options.getChannel('kanal') ?? interaction.channel;
        if (interaction.options.getBoolean('wylacz')) {
            await removeMediaChannel(guild.id, channel.id);
            return respond(interaction, successEmbed(t`📸 ${channel} is a normal channel again.`), { ephemeral: true });
        }
        requireBotPermission(guild, NEEDED, channel);
        const text = interaction.options.getString('emotki');
        const reactions = text ? parseReactions(text) : null;
        if (text && !reactions.length) throw userError(t('Write the reactions as emoji, for example ❤️ 🔥.'));
        const thread = interaction.options.getBoolean('watki');
        if (thread) requireBotPermission(guild, [PermissionFlagsBits.CreatePublicThreads], channel);
        let list;
        try {
            list = await setMediaChannel(guild.id, channel.id, { reactions, deleteOther: interaction.options.getBoolean('usuwaj') ?? undefined, thread: thread ?? undefined });
        } catch {
            throw userError(t`A server can have at most ${MAX_MEDIA_CHANNELS} picture channels.`);
        }
        const entry = list.find((item) => item.channelId === channel.id);
        return respond(interaction, createEmbed({
            title: t('📸 Picture channel'),
            description: [
                t`Channel: ${channel}`,
                t`Under every picture: ${entry.reactions.join(' ')}`,
                entry.deleteOther ? t('Messages without a picture disappear (people with Manage Messages may write).') : t('Messages without a picture stay.'),
                entry.thread ? t('Every picture gets a thread for comments.') : null,
            ].filter(Boolean).join('\n'),
            color: 'success',
            footer: false,
        }), { ephemeral: true });
    },
};
