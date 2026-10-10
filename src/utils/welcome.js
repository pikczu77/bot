// welcome.js

import { logger } from './logger.js';
import { t, trAny } from '../i18n/index.js';

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

export function getDefaultWelcomeMessage() {
    return DEFAULT_TEMPLATES.welcome;
}

export function getDefaultGoodbyeMessage() {
    return DEFAULT_TEMPLATES.goodbye;
}