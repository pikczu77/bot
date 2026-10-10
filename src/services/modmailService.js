// modmailService.js — private conversations between a member and the staff team.
//
// A member DMs the bot; the bot opens a staff-only channel for that conversation.
// Whatever staff write in the channel is sent to the member, and the member's DMs
// are posted back. Lines starting with "//" stay internal notes.

import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
} from 'discord.js';
import { createEmbed } from '../utils/embeds.js';
import { guildStore, userError, truncate } from '../utils/featureKit.js';
import { getFromDb, setInDb, deleteFromDb } from '../utils/database/wrapper.js';
import { logger } from '../utils/logger.js';
import { t, runWithLocale } from '../i18n/index.js';
import { getGuildLocale } from './languageService.js';

export const NOTE_PREFIX = '//';
const MAX_SNIPPETS = 50;

const configStore = guildStore('modmail:config', {
  enabled: false,
  categoryId: null,
  staffRoleId: null,
  logChannelId: null,
  greeting: null,
  anonymous: false,
  blocked: [],
  snippets: {},
});
const threadStore = guildStore('modmail:threads', {}); // { [channelId]: { userId, openedAt, openedBy } }

const userKey = (userId) => `modmail:user:${userId}`;

export const getModmailConfig = (guildId) => configStore.get(guildId);
export const updateModmailConfig = (guildId, mutate) => configStore.update(guildId, mutate);

export async function getThreadByChannel(guildId, channelId) {
  const threads = await threadStore.get(guildId);
  return threads[channelId] ? { ...threads[channelId], channelId, guildId } : null;
}

export async function getThreadByUser(userId) {
  const link = await getFromDb(userKey(userId), null);
  if (!link?.guildId || !link?.channelId) return null;
  return getThreadByChannel(link.guildId, link.channelId);
}

/** Guilds where this user can open modmail (member of the guild, modmail on, not blocked). */
export async function findModmailGuilds(client, userId) {
  const guilds = [];
  for (const guild of client.guilds.cache.values()) {
    const config = await configStore.get(guild.id);
    if (!config.enabled || !config.categoryId || config.blocked.includes(userId)) continue;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) guilds.push(guild);
  }
  return guilds;
}

function attachmentLines(attachments) {
  const list = [...(attachments?.values?.() ?? [])];
  return list.map((file) => `📎 [${truncate(file.name ?? 'file', 60)}](${file.url})`);
}

function firstImage(attachments) {
  return [...(attachments?.values?.() ?? [])].find((file) => file.contentType?.startsWith('image/'))?.url ?? null;
}

export function closeButtonRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('modmail_close').setLabel(t('Close')).setEmoji('🔒').setStyle(ButtonStyle.Danger),
  );
}

/** Open a conversation channel for a user. Returns the thread record. */
export async function openThread(client, guild, user, { openedBy = null } = {}) {
  const config = await configStore.get(guild.id);
  if (!config.enabled || !config.categoryId) {
    throw userError(t('Modmail is not set up on this server. An admin can enable it with `/modmail setup`.'));
  }
  if (config.blocked.includes(user.id)) {
    throw userError(t('This user is blocked from modmail.'));
  }
  const existing = await getThreadByUser(user.id);
  if (existing) {
    throw userError(t`There is already an open conversation: <#${existing.channelId}>.`);
  }

  const category = guild.channels.cache.get(config.categoryId);
  if (!category || category.type !== ChannelType.GuildCategory) {
    throw userError(t('The modmail category no longer exists. Run `/modmail setup` again.'));
  }

  const member = await guild.members.fetch(user.id).catch(() => null);
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: guild.members.me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.AddReactions,
      ],
    },
  ];
  if (config.staffRoleId && guild.roles.cache.has(config.staffRoleId)) {
    overwrites.push({
      id: config.staffRoleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles],
    });
  }

  const channel = await guild.channels.create({
    name: `mail-${user.username}`.toLowerCase().replace(/[^a-z0-9-_]/g, '').slice(0, 90) || `mail-${user.id}`,
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `Modmail · ${user.tag} · ${user.id}`,
    permissionOverwrites: overwrites,
    reason: `Modmail conversation with ${user.tag}`,
  });

  const thread = { userId: user.id, openedAt: Date.now(), openedBy: openedBy?.id ?? null };
  await threadStore.update(guild.id, (threads) => { threads[channel.id] = thread; });
  await setInDb(userKey(user.id), { guildId: guild.id, channelId: channel.id });

  const roles = member
    ? member.roles.cache.filter((role) => role.id !== guild.id).sort((a, b) => b.position - a.position).first(8).map((role) => role.toString()).join(' ') || t('none')
    : t('not on the server');

  await channel.send({
    content: config.staffRoleId ? `<@&${config.staffRoleId}>` : undefined,
    embeds: [createEmbed({
      title: t('📬 New modmail conversation'),
      description: [
        t`**User:** ${user} (\`${user.tag}\`)`,
        t`**ID:** \`${user.id}\``,
        t`**Account created:** <t:${Math.floor(user.createdTimestamp / 1000)}:R>`,
        member?.joinedTimestamp ? t`**Joined the server:** <t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : null,
        t`**Roles:** ${roles}`,
        openedBy ? t`**Opened by:** ${openedBy}` : null,
        '',
        t`Write here to answer — every message goes to the user. Start a line with \`${NOTE_PREFIX}\` to leave an internal note.`,
      ].filter((line) => line !== null).join('\n'),
      thumbnail: user.displayAvatarURL({ size: 256 }),
      color: 'info',
      footer: false,
    })],
    components: [closeButtonRow()],
    allowedMentions: { roles: config.staffRoleId ? [config.staffRoleId] : [] },
  });

  return { ...thread, channelId: channel.id, guildId: guild.id, channel };
}

/** Post a member's DM into their conversation channel. */
export async function relayToStaff(client, thread, message) {
  const guild = client.guilds.cache.get(thread.guildId);
  const channel = guild?.channels.cache.get(thread.channelId);
  if (!channel) {
    await forgetThread(thread);
    return false;
  }

  const locale = await getGuildLocale(client, guild.id);
  await runWithLocale(locale, () => channel.send({
    embeds: [createEmbed({
      author: { name: message.author.tag, iconURL: message.author.displayAvatarURL() },
      description: [truncate(message.content, 3800), ...attachmentLines(message.attachments)].filter(Boolean).join('\n') || t('*(no text)*'),
      image: firstImage(message.attachments),
      color: 'warning',
      footer: t('User'),
      timestamp: true,
    })],
    allowedMentions: { parse: [] },
  }));
  return true;
}

/** Send a staff reply to the member. Returns false when the member cannot be reached. */
export async function relayToUser(client, thread, staff, content, attachments, { anonymous = false } = {}) {
  const guild = client.guilds.cache.get(thread.guildId);
  const user = await client.users.fetch(thread.userId).catch(() => null);
  if (!user || !guild) return false;

  const hideName = anonymous;
  const embed = createEmbed({
    author: hideName
      ? { name: t`${guild.name} — Staff`, iconURL: guild.iconURL() ?? undefined }
      : { name: staff.displayName ?? staff.user?.username ?? 'Staff', iconURL: staff.displayAvatarURL?.() },
    description: [truncate(content, 3800), ...attachmentLines(attachments)].filter(Boolean).join('\n') || t('*(no text)*'),
    image: firstImage(attachments),
    color: 'success',
    footer: guild.name,
    timestamp: true,
  });

  try {
    await user.send({ embeds: [embed] });
    return true;
  } catch (error) {
    logger.debug(`Modmail DM to ${user.id} failed: ${error.message}`);
    return false;
  }
}

async function forgetThread(thread) {
  await threadStore.update(thread.guildId, (threads) => { delete threads[thread.channelId]; });
  const link = await getFromDb(userKey(thread.userId), null);
  if (link?.channelId === thread.channelId) await deleteFromDb(userKey(thread.userId));
}

async function buildTranscript(channel) {
  const lines = [];
  let before;
  for (let page = 0; page < 10; page += 1) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch?.size) break;
    for (const message of batch.values()) {
      const embed = message.embeds[0];
      const who = message.author.bot ? (embed?.author?.name ?? message.author.username) : message.author.tag;
      const text = message.author.bot ? (embed?.description ?? embed?.title ?? '') : message.content;
      lines.push(`[${message.createdAt.toISOString().replace('T', ' ').slice(0, 19)}] ${who}: ${text}`);
    }
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  return lines.reverse().join('\n');
}

/** Close a conversation: save a transcript, tell the member, delete the channel. */
export async function closeThread(client, guild, channelId, closer, reason = null) {
  const thread = await getThreadByChannel(guild.id, channelId);
  if (!thread) throw userError(t('This is not a modmail conversation channel.'));

  const config = await configStore.get(guild.id);
  const channel = guild.channels.cache.get(channelId);
  const user = await client.users.fetch(thread.userId).catch(() => null);

  if (channel && config.logChannelId) {
    const logChannel = guild.channels.cache.get(config.logChannelId);
    if (logChannel?.isTextBased?.()) {
      const transcript = await buildTranscript(channel).catch(() => '');
      await logChannel.send({
        embeds: [createEmbed({
          title: t('📪 Modmail conversation closed'),
          description: [
            t`**User:** ${user ?? `<@${thread.userId}>`} (\`${thread.userId}\`)`,
            t`**Closed by:** ${closer}`,
            t`**Reason:** ${reason || t('No reason provided')}`,
            t`**Opened:** <t:${Math.floor(thread.openedAt / 1000)}:f>`,
          ].join('\n'),
          color: 'error',
          footer: false,
          timestamp: true,
        })],
        files: transcript ? [new AttachmentBuilder(Buffer.from(transcript, 'utf8'), { name: `modmail-${thread.userId}.txt` })] : [],
        allowedMentions: { parse: [] },
      }).catch((error) => logger.debug(`Modmail log failed: ${error.message}`));
    }
  }

  await forgetThread(thread);

  if (user) {
    await user.send({
      embeds: [createEmbed({
        title: t('📪 Conversation closed'),
        description: [
          t`Your conversation with the staff of **${guild.name}** has been closed.`,
          reason ? t`**Reason:** ${reason}` : null,
          t('Write to me again whenever you need help.'),
        ].filter(Boolean).join('\n'),
        color: 'secondary',
        footer: false,
      })],
    }).catch(() => {});
  }

  if (channel) {
    setTimeout(() => channel.delete(`Modmail closed by ${closer.user?.tag ?? closer.tag ?? 'staff'}`).catch(() => {}), 4000).unref?.();
  }
  return thread;
}

export async function setSnippet(guildId, name, text) {
  const key = name.toLowerCase().trim();
  await configStore.update(guildId, (config) => {
    if (!config.snippets[key] && Object.keys(config.snippets).length >= MAX_SNIPPETS) {
      throw userError(t`You can save up to ${MAX_SNIPPETS} snippets.`);
    }
    config.snippets[key] = text;
  });
  return key;
}

export async function removeSnippet(guildId, name) {
  const key = name.toLowerCase().trim();
  let removed = false;
  await configStore.update(guildId, (config) => {
    removed = key in config.snippets;
    delete config.snippets[key];
  });
  return removed;
}

/** Whether this member may answer modmail. */
export function isModmailStaff(member, config) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  return Boolean(config.staffRoleId && member.roles.cache.has(config.staffRoleId));
}
