// selfRoleService.js — messages with buttons that members click to give themselves a role
// (a second click takes the role off again). The panels are set up in the web panel: title,
// text, colour of the side bar and every button (emoji, label, role, colour).
// Every custom ID starts with "selfrole:", so the buttons keep working after a restart.

import crypto from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import { getColor } from '../config/bot.js';
import { guildStore } from '../utils/featureKit.js';
import { successEmbed, infoEmbed, warningEmbed } from '../utils/embeds.js';
import { logger } from '../utils/logger.js';
import { hasDangerousPermissions } from './reactionRoleService.js';
import { t } from '../i18n/index.js';

export const MAX_SELF_ROLE_PANELS = 5;
export const MAX_SELF_ROLE_BUTTONS = 25;
export const SELF_ROLE_TITLE_MAX = 256;
export const SELF_ROLE_TEXT_MAX = 4000;
export const SELF_ROLE_LABEL_MAX = 80;
export const SELF_ROLE_DEFAULT_COLOR = '#5865f2';
const BUTTONS_PER_ROW = 5;
const BUTTON_STYLES = {
    primary: ButtonStyle.Primary,
    secondary: ButtonStyle.Secondary,
    success: ButtonStyle.Success,
    danger: ButtonStyle.Danger,
};
export const SELF_ROLE_BUTTON_STYLES = Object.keys(BUTTON_STYLES);

// A custom server emoji as Discord writes it, or one emoji character (with its modifiers).
const CUSTOM_EMOJI_RE = /^<a?:\w{2,32}:\d{17,20}>$/;
const UNICODE_EMOJI_RE = /^(?:\p{Regional_Indicator}{2}|[0-9#*]️?⃣|\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier}|‍\p{Extended_Pictographic})*)$/u;

const store = guildStore('self-roles', { panels: [] });

export const isSelfRoleEmoji = (value) => typeof value === 'string' && (CUSTOM_EMOJI_RE.test(value) || UNICODE_EMOJI_RE.test(value));
export const newSelfRolePanelId = () => crypto.randomBytes(6).toString('hex');

export async function getSelfRolePanels(guildId) {
    const { panels } = await store.get(guildId);
    return Array.isArray(panels) ? panels : [];
}

export async function saveSelfRolePanels(guildId, panels) {
    return store.set(guildId, { panels });
}

// What members see: an embed with the title and the text, and the buttons five in a row.
export function buildSelfRoleMessage(panel) {
    const embed = new EmbedBuilder().setColor(getColor(panel.color || SELF_ROLE_DEFAULT_COLOR));
    if (panel.title) embed.setTitle(panel.title);
    if (panel.description) embed.setDescription(panel.description);

    const buttons = panel.buttons.map((entry) => {
        const button = new ButtonBuilder()
            .setCustomId(`selfrole:${entry.roleId}`)
            .setStyle(BUTTON_STYLES[entry.style] ?? ButtonStyle.Primary);
        if (entry.label) button.setLabel(entry.label);
        if (entry.emoji) button.setEmoji(entry.emoji);
        return button;
    });

    const components = [];
    for (let index = 0; index < buttons.length; index += BUTTONS_PER_ROW) {
        components.push(new ActionRowBuilder().addComponents(buttons.slice(index, index + BUTTONS_PER_ROW)));
    }

    return { embeds: [embed], components };
}

async function fetchPanelMessage(guild, panel) {
    const channel = panel?.channelId ? guild.channels.cache.get(panel.channelId) : null;
    return channel && panel.messageId ? channel.messages.fetch(panel.messageId).catch(() => null) : null;
}

// Posts the panel, or edits the message that is already there. A new channel or `repost`
// sends a fresh message; the old one comes back as `stale` and is deleted by the caller
// after the new ID is saved (the delete event would otherwise mark the panel as not posted).
export async function syncSelfRoleMessage(guild, previous, next, { repost = false } = {}) {
    const oldMessage = await fetchPanelMessage(guild, previous);
    const payload = buildSelfRoleMessage(next);

    if (oldMessage && previous.channelId === next.channelId && !repost) {
        await oldMessage.edit(payload);
        return { messageId: oldMessage.id, stale: null };
    }

    const sent = await guild.channels.cache.get(next.channelId).send(payload);
    return { messageId: sent.id, stale: oldMessage };
}

export async function removeSelfRoleMessage(guild, panel) {
    const message = await fetchPanelMessage(guild, panel);
    await message?.delete().catch(() => {});
}

/** The panel message was deleted on Discord: the panel stays, marked as not posted. */
export async function forgetSelfRoleMessage(guildId, messageId) {
    const panels = await getSelfRolePanels(guildId);
    const panel = panels.find((entry) => entry.messageId === messageId);
    if (!panel) return false;
    panel.messageId = null;
    await saveSelfRolePanels(guildId, panels);
    return true;
}

const canGive = (role) => Boolean(role) && role.editable && !role.managed && !hasDangerousPermissions(role);

/** A click on a role button: gives the role, or takes it off when the member already has it. */
export async function handleSelfRoleButton(interaction, client, [roleId] = []) {
    if (!interaction.inGuild() || !interaction.guild || !interaction.member) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const { guild, member } = interaction;
    const panel = (await getSelfRolePanels(guild.id)).find((entry) => entry.messageId === interaction.message?.id);
    if (!panel?.buttons.some((entry) => entry.roleId === roleId)) {
        return interaction.editReply({ embeds: [warningEmbed(t('This role button is no longer active.'))] });
    }

    const role = guild.roles.cache.get(roleId);
    if (!canGive(role)) {
        return interaction.editReply({ embeds: [warningEmbed(t('I cannot give this role. Ask the server staff to move my role above it.'))] });
    }

    try {
        if (member.roles.cache.has(role.id)) {
            await member.roles.remove(role, 'Self-role button');
            return interaction.editReply({ embeds: [infoEmbed(t`You no longer have the role ${role}.`)] });
        }

        // "One role at a time": the other roles of this panel go away first.
        const replaced = panel.exclusive
            ? panel.buttons.map((entry) => guild.roles.cache.get(entry.roleId)).filter((other) => other && other.id !== role.id && member.roles.cache.has(other.id) && canGive(other))
            : [];
        for (const other of replaced) await member.roles.remove(other, 'Self-role button');
        await member.roles.add(role, 'Self-role button');

        return interaction.editReply({
            embeds: [successEmbed(replaced.length
                ? t`You now have the role ${role}. Removed: ${replaced.join(', ')}.`
                : t`You now have the role ${role}.`)],
        });
    } catch (error) {
        logger.warn(`Self-role button: could not change role ${roleId} of ${member.id} in guild ${guild.id}:`, error);
        return interaction.editReply({ embeds: [warningEmbed(t('I cannot give this role. Ask the server staff to move my role above it.'))] });
    }
}
