import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { createEmbed, successEmbed, infoEmbed } from '../../utils/embeds.js';
import { respond, requireGuild, requireBotPermission, userError, truncate } from '../../utils/featureKit.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import {
    addFeed,
    buildNotification,
    fetchVideos,
    getChannelInfo,
    getFeeds,
    removeFeed,
    resolveChannel,
} from '../../services/notifications/youtube.js';
import { fmtNumber, t } from '../../i18n/index.js';

function findFeed(feeds, value) {
    const needle = String(value ?? '').trim().toLowerCase();
    return feeds.find((feed) => feed.id.toLowerCase() === needle || feed.name.toLowerCase() === needle) ?? null;
}

export default {
    data: new SlashCommandBuilder()
        .setName('notify')
        .setDescription('Post a message when a YouTube channel uploads a new video')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommandGroup((group) =>
            group
                .setName('youtube')
                .setDescription('New video notifications')
                .addSubcommand((sub) =>
                    sub
                        .setName('add')
                        .setDescription('Follow a YouTube channel')
                        .addStringOption((option) =>
                            option.setName('youtube').setDescription('Channel link, @handle or channel ID').setRequired(true),
                        )
                        .addChannelOption((option) =>
                            option
                                .setName('channel')
                                .setDescription('Where to post the notifications')
                                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
                                .setRequired(true),
                        )
                        .addRoleOption((option) =>
                            option.setName('role').setDescription('Role to ping with every new video'),
                        )
                        .addBooleanOption((option) =>
                            option.setName('shorts').setDescription('Also announce Shorts (default: yes)'),
                        )
                        .addStringOption((option) =>
                            option
                                .setName('message')
                                .setDescription('Custom text. Placeholders: {channel} {title} {url} {role}')
                                .setMaxLength(500),
                        ),
                )
                .addSubcommand((sub) =>
                    sub
                        .setName('remove')
                        .setDescription('Stop following a YouTube channel')
                        .addStringOption((option) =>
                            option.setName('youtube').setDescription('Followed channel').setRequired(true).setAutocomplete(true),
                        ),
                )
                .addSubcommand((sub) => sub.setName('list').setDescription('Show followed YouTube channels'))
                .addSubcommand((sub) =>
                    sub
                        .setName('test')
                        .setDescription('Send a sample notification using the latest video')
                        .addStringOption((option) =>
                            option.setName('youtube').setDescription('Followed channel').setRequired(true).setAutocomplete(true),
                        ),
                ),
        ),
    slashOnly: true,

    async autocomplete(interaction) {
        const feeds = await getFeeds(interaction.guildId);
        const typed = interaction.options.getFocused().toLowerCase();
        await interaction.respond(
            feeds
                .filter((feed) => feed.name.toLowerCase().includes(typed))
                .slice(0, 25)
                .map((feed) => ({ name: truncate(feed.name, 100), value: feed.id })),
        );
    },

    async execute(interaction) {
        const guild = requireGuild(interaction);
        const subcommand = interaction.options.getSubcommand();

        if (subcommand === 'list') {
            const feeds = await getFeeds(guild.id);
            if (feeds.length === 0) {
                return respond(interaction, infoEmbed(
                    t('No YouTube channels yet'),
                    t('Follow one with `/notify youtube add`.'),
                ), { ephemeral: true });
            }

            return respond(interaction, createEmbed({
                title: t('📺 YouTube notifications'),
                description: feeds.map((feed) => [
                    `**[${feed.name}](https://www.youtube.com/channel/${feed.id})** ➜ <#${feed.channelId}>`,
                    [
                        feed.roleId ? `<@&${feed.roleId}>` : t('no ping'),
                        feed.includeShorts === false ? t('without Shorts') : t('with Shorts'),
                    ].join(' · '),
                ].join('\n')).join('\n\n'),
                color: 'red',
                footer: t`${feeds.length} of 25 channels`,
            }), { ephemeral: true });
        }

        await InteractionHelper.safeDefer(interaction);

        if (subcommand === 'add') {
            const target = interaction.options.getChannel('channel');
            const role = interaction.options.getRole('role');
            requireBotPermission(guild, [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.EmbedLinks,
            ], target);

            const channel = await resolveChannel(interaction.options.getString('youtube'));
            // Everything already on the channel counts as seen — only future uploads are announced.
            const existing = await fetchVideos(channel.id).catch(() => []);

            await addFeed(guild.id, {
                id: channel.id,
                name: channel.name || channel.id,
                avatar: channel.avatar,
                channelId: target.id,
                roleId: role?.id ?? null,
                includeShorts: interaction.options.getBoolean('shorts') ?? true,
                message: interaction.options.getString('message') ?? null,
                seen: existing.map((video) => video.id),
                addedBy: interaction.user.id,
                addedAt: Date.now(),
            });

            const embed = successEmbed(
                t`Following ${channel.name || channel.id}`,
                [
                    t`New videos will be posted in ${target}.`,
                    role ? t`${role} will be pinged.` : null,
                    channel.subscribers ? t`Subscribers: **${fmtNumber(channel.subscribers)}**` : null,
                    t('Check the look with `/notify youtube test`.'),
                ].filter(Boolean).join('\n'),
            );
            if (channel.avatar) embed.setThumbnail(channel.avatar);
            return respond(interaction, embed);
        }

        const feeds = await getFeeds(guild.id);
        const feed = findFeed(feeds, interaction.options.getString('youtube'));
        if (!feed) {
            throw userError(t('That channel is not on the list. See `/notify youtube list`.'));
        }

        if (subcommand === 'remove') {
            await removeFeed(guild.id, feed.id);
            return respond(interaction, successEmbed(t`Stopped following **${feed.name}**.`));
        }

        if (subcommand === 'test') {
            const [video] = await fetchVideos(feed.id);
            if (!video) {
                throw userError(t('This channel has no public videos yet.'));
            }
            const target = guild.channels.cache.get(feed.channelId);
            if (!target?.isTextBased?.()) {
                throw userError(t('The notification channel no longer exists. Remove this entry and add it again.'));
            }
            const payload = await buildNotification(feed, video, await getChannelInfo(feed.id));
            // A test must not ping the whole role.
            await target.send({ ...payload, allowedMentions: { parse: [] } });
            return respond(interaction, successEmbed(t`Sample notification sent to ${target}.`));
        }

        throw userError(t('This subcommand is not recognised.'));
    },
};
