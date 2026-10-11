// welcome.js

import { EmbedBuilder } from 'discord.js';
import { botConfig, getColor } from '../config/bot.js';
import { logger } from './logger.js';
import { t, trAny } from '../i18n/index.js';

// Layouts of the welcome / goodbye message: the text alone, or the text inside an embed.
export const GREETING_STYLES = ['text', 'embed'];

const DEFAULT_TEMPLATES = {
    welcome: t('Welcome {user} to {server}!'),
    goodbye: t('{user.tag} has left the server.')
};

function replaceAll(message, token, value) {
    if (value === undefined || value === null) {
        return message;
    }
    return message.split(token).join(String(value));
}

export function truncateForEmbedField(value, maxLength = 1024) {
    const text = String(value ?? '').trim();
    if (!text) {
        return '—';
    }
    return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`;
}

export function formatWelcomeMessage(message, data) {
    
    if (typeof message !== 'string') return '';
    if (!message) return '';
    // Built-in default templates follow the server language; custom text is left alone.
    message = trAny(message);
    if (!data || typeof data !== 'object') return message;

    const user = data?.user;
    const guild = data?.guild;

    if (!user || typeof user !== 'object') {
        logger.warn('Invalid user object passed to formatWelcomeMessage');
    }
    if (!guild || typeof guild !== 'object') {
        logger.warn('Invalid guild object passed to formatWelcomeMessage');
    }

    const tokens = {
        '{user}': user?.toString?.() || t('User'),
        '{user.mention}': user?.toString?.() || t('User'),
        '{user.tag}': user?.tag || 'Unknown#0000',
        '{user.username}': user?.username || t('Unknown'),
        '{username}': user?.username || t('Unknown'),
        '{user.discriminator}': user?.discriminator || '0000',
        '{user.id}': user?.id || 'unknown',
        '{server}': guild?.name || t('Server'),
        '{server.name}': guild?.name || t('Server'),
        '{guild.name}': guild?.name || t('Server'),
        '{guild.id}': guild?.id || 'unknown',
        '{guild.memberCount}': guild?.memberCount?.toString?.() || '0',
        '{memberCount}': guild?.memberCount?.toString?.() || '0',
        '{membercount}': guild?.memberCount?.toString?.() || '0',
        // Invite tracker (empty when the inviter is unknown)
        '{inviter}': data?.invite?.inviter?.toString?.() || t('someone'),
        '{inviter.tag}': data?.invite?.inviter?.tag || t('someone'),
        '{invites}': String(data?.invite?.stats?.total ?? 0),
        '{invite.code}': data?.invite?.code || '—'
    };

    let result = message;
    for (const [token, value] of Object.entries(tokens)) {
        if (value === undefined || value === null) continue;
        result = replaceAll(result, token, String(value));
    }

    return result;
}

/**
 * How the welcome ('welcome') or goodbye ('goodbye') message of a server is laid out, with
 * the defaults filled in. `extras` are the embed's avatar, the user / member count / inviter
 * fields and the footer with the date; an empty title means an embed without a title.
 */
export function getGreetingLayout(kind, config) {
    const welcome = kind === 'welcome';
    const embed = (welcome ? config?.welcomeEmbed : config?.leaveEmbed) ?? {};
    const color = ['number', 'string'].includes(typeof embed.color) ? getColor(embed.color) : null;

    return {
        style: (welcome ? config?.welcomeStyle : config?.goodbyeStyle) === 'text' ? 'text' : 'embed',
        title: typeof embed.title === 'string' ? embed.title : (welcome ? t('🎉 Welcome!') : t('👋 Goodbye')),
        color: Number.isInteger(color) ? color : getColor(welcome ? 'success' : 'error'),
        extras: (welcome ? config?.welcomeExtras : config?.goodbyeExtras) !== false
    };
}

/**
 * The channel.send() payload of a welcome or goodbye message, in the layout the server
 * picked. Without the Embed Links permission the embed layout falls back to plain text.
 */
export function buildGreetingMessage(kind, config, { user, guild, member, invite = null, canEmbed = true }) {
    const welcome = kind === 'welcome';
    const data = { user, guild, member, invite };
    const embedConfig = (welcome ? config.welcomeEmbed : config.leaveEmbed) ?? {};
    const layout = getGreetingLayout(kind, config);

    const text = formatWelcomeMessage(
        (welcome ? config.welcomeMessage : config.leaveMessage)
            || embedConfig.description
            || (welcome ? botConfig.welcome?.defaultWelcomeMessage : botConfig.welcome?.defaultGoodbyeMessage)
            || (welcome ? t('Welcome {user} to {server}!') : t('{user} has left the server.')),
        data
    );
    const ping = Boolean(welcome ? config.welcomePing : config.goodbyePing);
    // Only the person the message is about can be notified; roles and @everyone in the text never ping.
    const allowedMentions = { parse: [], users: ping ? [user.id] : [] };
    const image = welcome
        ? config.welcomeImage || embedConfig.image?.url
        : (typeof embedConfig.image === 'string' ? embedConfig.image : embedConfig.image?.url);

    if (layout.style === 'text' || !canEmbed) {
        const payload = { content: text.slice(0, 2000), allowedMentions };
        if (image && canEmbed) {
            payload.embeds = [new EmbedBuilder().setImage(image)];
        }
        return payload;
    }

    const embed = new EmbedBuilder()
        .setColor(layout.color)
        .setDescription(text.slice(0, 4096));

    const title = formatWelcomeMessage(layout.title, data);
    if (title) {
        embed.setTitle(title.slice(0, 256));
    }

    if (layout.extras) {
        const footer = embedConfig.footer
            ? formatWelcomeMessage(embedConfig.footer, data)
            : (welcome ? t`Welcome to ${guild.name}!` : t`Goodbye from ${guild.name}!`);

        embed
            .setThumbnail(user.displayAvatarURL())
            .addFields(
                { name: t('User'), value: `${user.tag} (${user.id})`, inline: true },
                { name: t('Member Count'), value: guild.memberCount.toString(), inline: true }
            )
            .setTimestamp()
            .setFooter({ text: footer });

        if (welcome && invite?.inviter) {
            embed.addFields({
                name: t('Invited by'),
                value: t`${invite.inviter} · **${invite.stats?.total ?? 0}** {1|invite|invites}`,
                inline: true,
            });
        }
    }

    if (image) {
        embed.setImage(image);
    }

    return { content: ping ? user.toString() : undefined, embeds: [embed], allowedMentions };
}

export function getDefaultWelcomeMessage() {
    return DEFAULT_TEMPLATES.welcome;
}

export function getDefaultGoodbyeMessage() {
    return DEFAULT_TEMPLATES.goodbye;
}