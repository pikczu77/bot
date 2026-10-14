// tempVoiceInterface.js — the control message of temporary voice channels ("join to create").
//
// One message with buttons, posted on a text channel. A member who sits in a temporary
// channel uses it to rename the channel, limit it, lock or hide it, block, invite or
// kick people, claim the channel of an absent owner or delete it.
// Every custom ID starts with "tempvoice:", so the buttons keep working after a restart.

import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    MessageFlags,
    ModalBuilder,
    OverwriteType,
    PermissionFlagsBits,
    StringSelectMenuBuilder,
    TextInputBuilder,
    TextInputStyle,
    UserSelectMenuBuilder,
} from 'discord.js';
import { getColor } from '../config/bot.js';
import { getJoinToCreateConfig, saveJoinToCreateConfig, unregisterTemporaryChannel } from '../utils/database.js';
import { infoEmbed, successEmbed, warningEmbed } from '../utils/embeds.js';
import { checkRateLimit } from '../utils/rateLimiter.js';
import { logger } from '../utils/logger.js';
import { t } from '../i18n/index.js';

const BUTTONS_PER_ROW = 5;
const CHANNEL_NAME_MAX_LENGTH = 100;
const MAX_USER_LIMIT = 99;
const MAX_MENU_OPTIONS = 25;
const MAX_PICKED_MEMBERS = 10;
const MAX_INVITED_MEMBERS = 3;
const INVITES_PER_WINDOW = 3;
const INVITE_WINDOW_MS = 5 * 60_000;
// Discord accepts two name changes of a channel per ten minutes; a third one would wait in a queue.
const RENAMES_PER_WINDOW = 2;
const RENAME_WINDOW_MS = 10 * 60_000;
const MISSING_ACCESS_CODES = new Set([50001, 50013]);
const MEMBER = { type: OverwriteType.Member };
const ROLE = { type: OverwriteType.Role };
const OWNER_ACCESS = { ViewChannel: true, Connect: true, Speak: true, PrioritySpeaker: true, MoveMembers: true };

const renameTimes = new Map();

const mentions = (ids) => ids.map((id) => `<@${id}>`).join(', ');
const fromHiddenMessage = (interaction) => Boolean(interaction.message?.flags?.has(MessageFlags.Ephemeral));

function interfaceButtons() {
    return [
        ['name', '✏️', t('Name')],
        ['limit', '👥', t('Limit')],
        ['privacy', '🛡️', t('Privacy')],
        ['invite', '📨', t('Invite')],
        ['kick', '👢', t('Kick')],
        ['block', '🚫', t('Block')],
        ['unblock', '🔓', t('Unblock')],
        ['claim', '👑', t('Claim')],
        ['delete', '🗑️', t('Delete')],
    ];
}

export function buildInterfaceMessage(config = {}) {
    const triggerChannelId = config.triggerChannels?.[0] ?? null;
    const embed = new EmbedBuilder()
        .setTitle(t('Voice Room Controls'))
        .setDescription(triggerChannelId
            ? t`Use the buttons below to manage your temporary voice channel.\nJoin <#${triggerChannelId}> to create one.`
            : t('Use the buttons below to manage your temporary voice channel.'))
        .setColor(getColor('primary'));

    const buttons = interfaceButtons().map(([action, emoji, label]) => new ButtonBuilder()
        .setCustomId(`tempvoice:${action}`)
        .setEmoji(emoji)
        .setLabel(label)
        .setStyle(action === 'delete' ? ButtonStyle.Danger : ButtonStyle.Secondary));

    const components = [];
    for (let index = 0; index < buttons.length; index += BUTTONS_PER_ROW) {
        components.push(new ActionRowBuilder().addComponents(buttons.slice(index, index + BUTTONS_PER_ROW)));
    }

    return { embeds: [embed], components };
}

// Posts the interface on `channel`, or edits the message that is already there; without a channel
// the old message is removed. Returns the ID of the interface message (null when removed).
export async function syncInterfaceMessage(guild, config, channel, { repost = false } = {}) {
    const oldChannel = config.interfaceChannelId ? guild.channels.cache.get(config.interfaceChannelId) : null;
    const oldMessage = oldChannel && config.interfaceMessageId
        ? await oldChannel.messages.fetch(config.interfaceMessageId).catch(() => null)
        : null;

    if (!channel) {
        await oldMessage?.delete().catch(() => {});
        return null;
    }

    const payload = buildInterfaceMessage(config);
    if (oldMessage && oldChannel.id === channel.id && !repost) {
        await oldMessage.edit(payload);
        return oldMessage.id;
    }

    const sent = await channel.send(payload);
    await oldMessage?.delete().catch(() => {});
    return sent.id;
}

// Sends a fresh interface to `channel` and remembers where it is.
export async function postInterface(client, guild, channel) {
    const config = await getJoinToCreateConfig(client, guild.id);
    config.interfaceMessageId = await syncInterfaceMessage(guild, config, channel, { repost: true });
    config.interfaceChannelId = channel.id;
    await saveJoinToCreateConfig(client, guild.id, config);
    return config.interfaceMessageId;
}

// Buttons and forms answer with a hidden message; a choice made in a hidden menu replaces that menu.
function answer(interaction, embed, components = []) {
    const payload = { embeds: [embed], components };
    return fromHiddenMessage(interaction)
        ? interaction.update(payload)
        : interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

const done = (interaction, text) => answer(interaction, infoEmbed(text));
const refuse = (interaction, text) => answer(interaction, warningEmbed(text));

// The temporary channel the member sits in, with its stored record. Answers and returns null
// when there is none, or when the action is for the owner only and the member is someone else.
async function resolveRoom(interaction, client, { ownerOnly = true } = {}) {
    const channel = interaction.member?.voice?.channel ?? null;
    const config = await getJoinToCreateConfig(client, interaction.guildId);
    const info = channel ? config.temporaryChannels?.[channel.id] : null;

    if (!info) {
        await refuse(interaction, t('Join your temporary voice channel first.'));
        return null;
    }
    if (ownerOnly && info.ownerId !== interaction.user.id) {
        await refuse(interaction, t`Only the owner of this channel can do that. The owner is <@${info.ownerId}>. When the owner is away, use **Claim**.`);
        return null;
    }

    return { channel, config, info };
}

// Changes the stored record of a temporary channel, read fresh so parallel changes are kept.
async function updateRoom(client, guildId, channelId, change) {
    const config = await getJoinToCreateConfig(client, guildId);
    const info = config.temporaryChannels?.[channelId];
    if (!info) return null;
    change(info);
    await saveJoinToCreateConfig(client, guildId, config);
    return info;
}

// A locked or hidden channel stays open to its owner and to the bot (which could not manage or delete it otherwise).
async function keepAccess(channel, ownerId) {
    const access = { ViewChannel: true, Connect: true };
    await channel.permissionOverwrites.edit(channel.guild.members.me.id, access, MEMBER);
    await channel.permissionOverwrites.edit(ownerId, access, MEMBER);
}

function memberOverwrites(channel, predicate) {
    return [...channel.permissionOverwrites.cache.values()]
        .filter((overwrite) => overwrite.type === OverwriteType.Member && predicate(overwrite));
}

function memberMenu(action, placeholder, max) {
    return new ActionRowBuilder().addComponents(new UserSelectMenuBuilder()
        .setCustomId(`tempvoice:${action}`)
        .setPlaceholder(placeholder)
        .setMinValues(1)
        .setMaxValues(max));
}

// `entries` is a list of [value, label]; `max` is how many of them can be picked at once.
function listMenu(action, placeholder, entries, max = 1) {
    const options = entries.slice(0, MAX_MENU_OPTIONS).map(([value, label]) => ({ value, label: String(label).slice(0, 100) }));
    return new ActionRowBuilder().addComponents(new StringSelectMenuBuilder()
        .setCustomId(`tempvoice:${action}`)
        .setPlaceholder(placeholder)
        .setMinValues(1)
        .setMaxValues(Math.min(max, options.length))
        .addOptions(options));
}

function textModal(action, title, label, value, maxLength) {
    return new ModalBuilder()
        .setCustomId(`tempvoice:${action}`)
        .setTitle(title)
        .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder()
            .setCustomId('value')
            .setLabel(label)
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(maxLength)
            .setValue(String(value).slice(0, maxLength))));
}

const memberEntries = (guild, ids) => ids.map((id) => [id, guild.members.cache.get(id)?.displayName ?? id]);

async function setOwner(client, channel, info, newOwnerId) {
    const previousOwnerId = info.ownerId;
    await channel.permissionOverwrites.edit(newOwnerId, OWNER_ACCESS, MEMBER);
    await channel.permissionOverwrites.edit(previousOwnerId, { PrioritySpeaker: null, MoveMembers: null }, MEMBER).catch(() => {});

    await updateRoom(client, channel.guild.id, channel.id, (record) => { record.ownerId = newOwnerId; });
    logger.info(`Temporary channel ${channel.id} now belongs to ${newOwnerId} (was ${previousOwnerId})`);
}

// Removes a temporary channel together with its stored record, and its waiting room when one
// is left from the time the interface had a "Waiting Room" button.
export async function deleteRoom(client, channel, reason = 'Temporary voice channel removed') {
    const config = await getJoinToCreateConfig(client, channel.guild.id);
    const waitingRoomId = config.temporaryChannels?.[channel.id]?.waitingRoomId ?? null;

    await unregisterTemporaryChannel(client, channel.guild.id, channel.id);
    renameTimes.delete(channel.id);
    if (waitingRoomId) {
        await channel.guild.channels.cache.get(waitingRoomId)?.delete(reason).catch(() => {});
    }
    await channel.delete(reason);
}

async function claimRoom(interaction, client) {
    const room = await resolveRoom(interaction, client, { ownerOnly: false });
    if (!room) return null;
    const { channel, info } = room;

    if (info.ownerId === interaction.user.id) return refuse(interaction, t('This channel is already yours.'));
    if (channel.members.has(info.ownerId)) return refuse(interaction, t`The owner <@${info.ownerId}> is still in the channel.`);

    await setOwner(client, channel, info, interaction.user.id);
    return done(interaction, t('The channel is yours now.'));
}

async function handleButton(interaction, client, action) {
    if (action === 'claim') return claimRoom(interaction, client);

    const room = await resolveRoom(interaction, client);
    if (!room) return null;
    const { channel, info } = room;
    const guild = channel.guild;
    const others = [...channel.members.values()].filter((member) => member.id !== info.ownerId);

    switch (action) {
        case 'name':
            return interaction.showModal(textModal('name', t('Channel Name'), t('New name'), channel.name, CHANNEL_NAME_MAX_LENGTH));
        case 'limit':
            return interaction.showModal(textModal('limit', t('User Limit'), t('Limit (0 = no limit, up to 99)'), channel.userLimit ?? 0, 2));
        case 'privacy':
            return answer(interaction, infoEmbed(t('Choose who can join or see your channel.')), [listMenu('privacy', t('Choose an option'), [
                ['lock', t('🔒 Lock - only invited people can join')],
                ['unlock', t('🔓 Unlock - everyone can join')],
                ['hide', t('🙈 Hide - only invited people see the channel')],
                ['show', t('👁️ Show - everyone sees the channel')],
            ])]);
        case 'block':
            return answer(interaction, infoEmbed(t('Blocked people cannot see or join your channel.')), [memberMenu('block', t('Choose people to block'), MAX_PICKED_MEMBERS)]);
        case 'invite':
            return answer(interaction, infoEmbed(t('The bot sends a private message with a link to your channel.')), [memberMenu('invite', t('Choose people to invite'), MAX_INVITED_MEMBERS)]);
        case 'unblock': {
            const blocked = memberOverwrites(channel, (overwrite) => overwrite.deny.has(PermissionFlagsBits.Connect));
            if (!blocked.length) return refuse(interaction, t('Nobody is blocked in this channel.'));
            return answer(interaction, infoEmbed(t('Choose who can come back.')), [listMenu('unblock', t('Choose people'), memberEntries(guild, blocked.map((overwrite) => overwrite.id)), MAX_MENU_OPTIONS)]);
        }
        case 'kick':
            if (!others.length) return refuse(interaction, t('Nobody else is in your channel.'));
            return answer(interaction, infoEmbed(t('Choose who leaves the channel.')), [listMenu('kick', t('Choose people'), others.map((member) => [member.id, member.displayName]), MAX_MENU_OPTIONS)]);
        case 'delete':
            return answer(interaction, warningEmbed(t('Delete your channel? Everyone in it is disconnected.')), [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('tempvoice:delete_confirm').setLabel(t('Yes, delete')).setStyle(ButtonStyle.Danger),
            )]);
        case 'delete_confirm':
            await deleteRoom(client, channel, 'Temporary channel: deleted by its owner');
            return done(interaction, t('Your channel is deleted.'));
        default:
            return refuse(interaction, t('This button is not available.'));
    }
}

async function handleSelect(interaction, client, action) {
    const room = await resolveRoom(interaction, client);
    if (!room) return null;
    const { channel, info } = room;
    const guild = channel.guild;
    const everyone = guild.id;
    const picked = interaction.values.filter((id) => id !== info.ownerId && id !== guild.members.me.id);

    switch (action) {
        case 'privacy': {
            const [mode] = interaction.values;
            const changes = { lock: { Connect: false }, unlock: { Connect: true }, hide: { ViewChannel: false }, show: { ViewChannel: null } };
            if (!changes[mode]) return refuse(interaction, t('This option is not available.'));
            if (mode === 'lock' || mode === 'hide') await keepAccess(channel, info.ownerId);
            await channel.permissionOverwrites.edit(everyone, changes[mode], ROLE);
            return done(interaction, {
                lock: t('Your channel is locked. Only invited people can join.'),
                unlock: t('Your channel is unlocked. Everyone can join.'),
                hide: t('Your channel is hidden. Only invited people see it.'),
                show: t('Your channel is visible to everyone.'),
            }[mode]);
        }
        case 'block':
            for (const id of picked) {
                await channel.permissionOverwrites.edit(id, { ViewChannel: false, Connect: false }, MEMBER);
                await channel.members.get(id)?.voice.disconnect('Temporary channel: blocked by the owner').catch(() => {});
            }
            return picked.length ? done(interaction, t`Blocked: ${mentions(picked)}.`) : refuse(interaction, t('Nobody was chosen.'));
        case 'unblock':
            for (const id of picked) await channel.permissionOverwrites.delete(id, 'Temporary channel: block removed');
            return picked.length ? done(interaction, t`Unblocked: ${mentions(picked)}.`) : refuse(interaction, t('Nobody was chosen.'));
        case 'kick': {
            const kicked = picked.filter((id) => channel.members.has(id));
            for (const id of kicked) await channel.members.get(id).voice.disconnect('Temporary channel: kicked by the owner');
            return kicked.length ? done(interaction, t`Kicked: ${mentions(kicked)}.`) : refuse(interaction, t('Those people already left the channel.'));
        }
        case 'invite': {
            if (!(await checkRateLimit(`${interaction.user.id}:tempvoice_invite`, INVITES_PER_WINDOW, INVITE_WINDOW_MS))) {
                return refuse(interaction, t('You are sending invitations too quickly. Try again in a few minutes.'));
            }
            const link = `https://discord.com/channels/${guild.id}/${channel.id}`;
            const delivered = [];
            const undelivered = [];
            for (const id of picked) {
                const member = guild.members.cache.get(id) ?? await guild.members.fetch(id).catch(() => null);
                if (!member || member.user.bot) continue;
                await channel.permissionOverwrites.edit(id, { ViewChannel: true, Connect: true }, MEMBER);
                const sent = await member.send({
                    content: t`**${interaction.member.displayName}** invites you to the voice channel **${channel.name}** on **${guild.name}**: ${link}`,
                    allowedMentions: { parse: [] },
                }).then(() => true, () => false);
                (sent ? delivered : undelivered).push(id);
            }
            if (!delivered.length && !undelivered.length) return refuse(interaction, t('Nobody was chosen.'));
            return done(interaction, [
                delivered.length ? t`Invited: ${mentions(delivered)}.` : null,
                undelivered.length ? t`${mentions(undelivered)} can join, but the private message did not arrive (closed messages).` : null,
            ].filter(Boolean).join('\n'));
        }
        default:
            return refuse(interaction, t('This option is not available.'));
    }
}

async function handleModal(interaction, client, action) {
    const room = await resolveRoom(interaction, client);
    if (!room) return null;
    const { channel } = room;
    const value = interaction.fields.getTextInputValue('value');

    if (action === 'name') {
        const name = value.replace(/\s+/g, ' ').trim().slice(0, CHANNEL_NAME_MAX_LENGTH);
        if (!name) return refuse(interaction, t('Enter a name for the channel.'));

        const now = Date.now();
        for (const [channelId, times] of renameTimes) {
            if (times.every((time) => now - time >= RENAME_WINDOW_MS)) renameTimes.delete(channelId);
        }
        const recent = (renameTimes.get(channel.id) ?? []).filter((time) => now - time < RENAME_WINDOW_MS);
        if (recent.length >= RENAMES_PER_WINDOW) {
            const nextAt = Math.ceil((recent[0] + RENAME_WINDOW_MS) / 1000);
            return refuse(interaction, t`Discord allows ${RENAMES_PER_WINDOW} name changes per 10 minutes. Try again <t:${nextAt}:R>.`);
        }

        renameTimes.set(channel.id, [...recent, now]);
        await channel.setName(name, 'Temporary channel: renamed by its owner');
        return done(interaction, t`Your channel is now called **${name}**.`);
    }

    if (action === 'limit') {
        const limit = /^\d{1,2}$/.test(value.trim()) ? Number(value.trim()) : NaN;
        if (!Number.isInteger(limit) || limit > MAX_USER_LIMIT) return refuse(interaction, t('User limit must be between 0 (no limit) and 99.'));
        await channel.setUserLimit(limit, 'Temporary channel: limit changed by its owner');
        return done(interaction, limit === 0 ? t('Your channel has no user limit.') : t`The user limit of your channel is ${limit}.`);
    }

    return refuse(interaction, t('This form is not available.'));
}

// Entry point of every "tempvoice:<action>" button, menu and form.
export async function handleInterfaceInteraction(interaction, client, [action] = []) {
    try {
        if (!interaction.inGuild()) return null;
        if (interaction.isModalSubmit()) return await handleModal(interaction, client, action);
        if (interaction.isAnySelectMenu()) return await handleSelect(interaction, client, action);
        return await handleButton(interaction, client, action);
    } catch (error) {
        if (!MISSING_ACCESS_CODES.has(error?.code)) throw error;
        logger.warn(`Temporary channel action "${action}" failed in guild ${interaction.guildId}: ${error.message}`);
        const payload = {
            embeds: [warningEmbed(t('I am missing permissions for that. I need **Manage Channels**, **Manage Roles** and **Move Members**.'))],
            flags: MessageFlags.Ephemeral,
        };
        return interaction.replied || interaction.deferred ? interaction.followUp(payload) : interaction.reply(payload);
    }
}
