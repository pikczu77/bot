// helpCategories.js — names and icons of the command categories shown in /help.
// A category is a folder in src/commands; the folder name is the English name.

import { t } from '../../i18n/index.js';

const CATEGORIES = {
    Core: { icon: 'ℹ️', label: t('Core') },
    Moderation: { icon: '🛡️', label: t('Moderation') },
    Automod: { icon: '🤖', label: t('Automod') },
    Modmail: { icon: '📬', label: t('Modmail') },
    Ticket: { icon: '🎫', label: t('Tickets') },
    Logging: { icon: '📝', label: t('Logging') },
    Welcome: { icon: '👋', label: t('Welcome') },
    Verification: { icon: '✅', label: t('Verification') },
    Reaction_roles: { icon: '🎭', label: t('Reaction Roles') },
    Invites: { icon: '📨', label: t('Invites') },
    Notifications: { icon: '🔔', label: t('Notifications') },
    Minecraft: { icon: '⛏️', label: t('Minecraft') },
    Giveaway: { icon: '🎉', label: t('Giveaways') },
    Leveling: { icon: '📊', label: t('Leveling') },
    Economy: { icon: '💰', label: t('Economy') },
    Music: { icon: '🎵', label: t('Music') },
    Fun: { icon: '🎮', label: t('Fun') },
    Tags: { icon: '🏷️', label: t('Tags') },
    Community: { icon: '👥', label: t('Applications') },
    Birthday: { icon: '🎂', label: t('Birthdays') },
    JoinToCreate: { icon: '🔊', label: t('Voice Rooms') },
    ServerStats: { icon: '🔢', label: t('Server Stats') },
    Tools: { icon: '🛠️', label: t('Tools') },
    Utility: { icon: '🔧', label: t('Utility') },
};

function fallbackName(rawCategory) {
    return String(rawCategory)
        .replace(/_/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function categoryIcon(rawCategory) {
    return CATEGORIES[rawCategory]?.icon ?? '📁';
}

/** Category name in the current language. */
export function formatCategoryName(rawCategory) {
    const known = CATEGORIES[rawCategory];
    return known ? t(known.label) : fallbackName(rawCategory);
}
