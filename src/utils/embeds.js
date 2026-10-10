// embeds.js — the single place that decides how the bot's messages look.

import { EmbedBuilder } from 'discord.js';
import { getColor, botConfig } from '../config/bot.js';
import { t, sameText } from '../i18n/index.js';

const LIMITS = { title: 256, description: 4096, fieldName: 256, fieldValue: 1024, footer: 2048, author: 256 };
const LEADING_EMOJI_RE = /^\s*(?:<a?:\w+:\d+>|[\p{Extended_Pictographic}\p{Regional_Indicator}])/u;

/** Icons used across the bot so the same kind of message always looks the same. */
export const ICONS = {
  success: '✅',
  error: '❌',
  warning: '⚠️',
  info: 'ℹ️',
  primary: '🔹',
  loading: '⏳',
  lock: '🔒',
  settings: '⚙️',
  network: '🌐',
  database: '🗄️',
  on: '🟢',
  off: '🔴',
  idle: '🟡',
  arrow: '➜',
  dot: '•',
};

function clip(text, max) {
  if (typeof text !== 'string') return text;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function tidy(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function startsWithEmoji(text) {
  return typeof text === 'string' && LEADING_EMOJI_RE.test(text);
}

function withIcon(icon, text) {
  if (!text || !icon || startsWithEmoji(text)) return text;
  return `${icon} ${text}`;
}

// Embeds are built all over the codebase; guard the Discord length limits here so an
// over-long value never turns into a failed reply.
const originalSetTitle = EmbedBuilder.prototype.setTitle;
const originalSetDescription = EmbedBuilder.prototype.setDescription;
const originalAddFields = EmbedBuilder.prototype.addFields;
const originalSetFooter = EmbedBuilder.prototype.setFooter;

EmbedBuilder.prototype.setTitle = function setSafeTitle(title) {
  if (title === null || title === undefined || title === '') return originalSetTitle.call(this, null);
  return originalSetTitle.call(this, clip(tidy(String(title)), LIMITS.title));
};

EmbedBuilder.prototype.setDescription = function setSafeDescription(description) {
  if (description === null || description === undefined || description === '') {
    return originalSetDescription.call(this, null);
  }
  return originalSetDescription.call(this, clip(tidy(String(description)), LIMITS.description));
};

EmbedBuilder.prototype.addFields = function addSafeFields(...fields) {
  const normalized = fields
    .flatMap((field) => (Array.isArray(field) ? field : [field]))
    .filter((field) => field && typeof field === 'object')
    .map((field) => ({
      ...field,
      name: clip(tidy(String(field.name ?? '')), LIMITS.fieldName) || '​',
      value: clip(tidy(String(field.value ?? '')), LIMITS.fieldValue) || '​',
    }));
  return originalAddFields.call(this, normalized);
};

EmbedBuilder.prototype.setFooter = function setSafeFooter(footer) {
  if (!footer) return originalSetFooter.call(this, null);
  const options = typeof footer === 'string' ? { text: footer } : { ...footer };
  if (typeof options.text !== 'string' || !options.text.trim()) return this;
  options.text = clip(options.text.trim(), LIMITS.footer);
  return originalSetFooter.call(this, options);
};

function brandFooter() {
  const footer = botConfig.embeds?.footer;
  if (!footer?.text) return null;
  return {
    text: footer.text,
    ...(footer.icon ? { iconURL: footer.icon } : {}),
  };
}

/**
 * Build an embed.
 * @param {object} options
 * @param {string|object|false|null} [options.footer] Text/object, `false` for no footer, or
 *        omit to use the brand footer from config/bot.js.
 */
export function createEmbed({
  title = '',
  description = '',
  color = 'primary',
  fields = [],
  author = null,
  footer = null,
  thumbnail = null,
  image = null,
  timestamp = false,
  url = null
} = {}) {
  const embed = new EmbedBuilder();

  if (title && typeof title === 'string') {
    embed.setTitle(title);
  }

  if (description && typeof description === 'string') {
    embed.setDescription(description);
  }

  try {
    embed.setColor(getColor(color) || getColor('primary'));
  } catch (error) {
    embed.setColor(getColor('primary'));
  }

  if (Array.isArray(fields) && fields.length > 0) {
    const validFields = fields.filter(f => f && f.name && f.value);
    if (validFields.length > 0) {
      embed.addFields(validFields.slice(0, 25));
    }
  }

  if (author) {
    try {
      if (typeof author === 'string' && author.length > 0) {
        embed.setAuthor({ name: clip(author, LIMITS.author) });
      } else if (author && typeof author.name === 'string') {
        embed.setAuthor({ ...author, name: clip(author.name, LIMITS.author) });
      }
    } catch (error) {
      // An invalid author (bad icon URL) must not break the reply.
    }
  } else if (botConfig.embeds?.author?.name) {
    embed.setAuthor({
      name: botConfig.embeds.author.name,
      ...(botConfig.embeds.author.icon ? { iconURL: botConfig.embeds.author.icon } : {}),
      ...(botConfig.embeds.author.url ? { url: botConfig.embeds.author.url } : {}),
    });
  }

  if (footer) {
    try {
      embed.setFooter(footer);
    } catch (error) {
      // Same as author: never fail a reply over decoration.
    }
  } else if (footer !== false) {
    const defaultFooter = brandFooter();
    if (defaultFooter) embed.setFooter(defaultFooter);
  }

  const thumbnailUrl = typeof thumbnail === 'string' ? thumbnail : thumbnail?.url;
  if (thumbnailUrl) {
    try {
      embed.setThumbnail(thumbnailUrl);
    } catch (error) {
      // ignore invalid image URL
    }
  } else if (botConfig.embeds?.thumbnail) {
    embed.setThumbnail(botConfig.embeds.thumbnail);
  }

  const imageUrl = typeof image === 'string' ? image : image?.url;
  if (imageUrl) {
    try {
      embed.setImage(imageUrl);
    } catch (error) {
      // ignore invalid image URL
    }
  }

  if (timestamp === true) {
    embed.setTimestamp();
  } else if (timestamp instanceof Date) {
    embed.setTimestamp(timestamp);
  }

  if (url && typeof url === 'string') {
    try {
      embed.setURL(url);
    } catch (error) {
      // ignore invalid URL
    }
  }

  return embed;
}

const NOTIFICATION_DEFAULT_TITLES = {
  success: t('Success'),
  error: t('Error'),
  info: t('Information'),
  warning: t('Warning'),
  primary: t('Notice'),
};

const GENERIC_TITLE_KEYS = Object.values(NOTIFICATION_DEFAULT_TITLES);

// True for "Success" / "Sukces" style titles in any language.
function isGenericTitle(text) {
  return GENERIC_TITLE_KEYS.some((key) => sameText(text, key));
}

export const USER_ERROR_TITLES = {
  validation: t('Invalid Input'),
  permission: t('Permission Denied'),
  configuration: t('Configuration Error'),
  database: t('Database Error'),
  network: t('Network Error'),
  discord_api: t('Discord API Error'),
  user_input: t('Input Error'),
  rate_limit: t('Too Fast'),
  unknown: t('Something Went Wrong'),
};

const USER_ERROR_STYLE = {
  validation: { icon: ICONS.warning, color: 'warning' },
  user_input: { icon: ICONS.warning, color: 'warning' },
  permission: { icon: ICONS.lock, color: 'error' },
  configuration: { icon: ICONS.settings, color: 'warning' },
  database: { icon: ICONS.database, color: 'error' },
  network: { icon: ICONS.network, color: 'error' },
  discord_api: { icon: ICONS.error, color: 'error' },
  rate_limit: { icon: ICONS.loading, color: 'warning' },
  unknown: { icon: ICONS.error, color: 'error' },
};

/**
 * Build a consistent user-facing error embed.
 * @param {string} errorType - Error category key (e.g. validation, permission)
 * @param {string} [description] - Specific, actionable message for the user
 * @param {{ titleOverride?: string }} [options]
 */
export function buildUserErrorEmbed(errorType, description = '', options = {}) {
  const type = USER_ERROR_TITLES[errorType] ? errorType : 'unknown';
  const style = USER_ERROR_STYLE[type];
  const title = options.titleOverride || t(USER_ERROR_TITLES[type]);
  const body = description ? String(description).trim() : undefined;

  return createEmbed({
    title: withIcon(style.icon, title),
    description: body,
    color: style.color,
    footer: false,
  });
}

function containsDiscordRenderable(content = '') {
  return /<@!?&?\d+>|<#\d+>|\b\d{17,19}\b/.test(String(content));
}

// Notifications are compact: a coloured bar, an icon and the message. A generic title
// ("Success", "Information") adds nothing, so it is dropped and the icon moves into the text.
function buildNotificationEmbed(title, body = '', color = 'primary') {
  const icon = ICONS[color] || ICONS.primary;
  let titleText = String(title || '').trim();
  let bodyText = body ? String(body).trim() : '';

  // Mentions do not render in embed titles — move such a title into the body.
  if (titleText && containsDiscordRenderable(titleText)) {
    bodyText = bodyText ? `${withIcon(icon, titleText)}\n\n${bodyText}` : withIcon(icon, titleText);
    titleText = '';
  }

  if (!titleText || isGenericTitle(titleText)) {
    const fallback = t(NOTIFICATION_DEFAULT_TITLES[color] || NOTIFICATION_DEFAULT_TITLES.primary);
    return createEmbed({ description: withIcon(icon, bodyText || fallback), color, footer: false });
  }

  return createEmbed({
    title: withIcon(icon, titleText),
    description: bodyText || undefined,
    color,
    footer: false,
  });
}

/**
 * @deprecated Prefer buildUserErrorEmbed or replyUserError from errorHandler.js.
 */
export function errorEmbed(title, detail = null, options = {}) {
  const { showDetails = process.env.NODE_ENV !== 'production' } = options;
  let body = detail;

  if (detail && showDetails && typeof detail !== 'string') {
    const detailText = detail.message || String(detail);
    body = formatCodeBlock(detailText);
  }

  const description = body ? String(body).trim() : '';
  const titleOverride = title && !isGenericTitle(title) ? title : undefined;

  return buildUserErrorEmbed('unknown', description, { titleOverride });
}

/** @param {string} titleOrBody - With one arg: body text. With two args: title and body. */
export function successEmbed(title, body = '') {
  if (arguments.length === 1) {
    return buildNotificationEmbed('', title, 'success');
  }

  return buildNotificationEmbed(title, body, 'success');
}

/** @param {string} titleOrBody - With one arg: body text. With two args: title and body. */
export function infoEmbed(title, body = '') {
  if (arguments.length === 1) {
    return buildNotificationEmbed('', title, 'info');
  }

  return buildNotificationEmbed(title, body, 'info');
}

/** @param {string} titleOrBody - With one arg: body text. With two args: title and body. */
export function warningEmbed(title, body = '') {
  if (arguments.length === 1) {
    return buildNotificationEmbed('', title, 'warning');
  }

  return buildNotificationEmbed(title, body, 'warning');
}

export function formatUser(user) {
  return `${user} (${user.tag} | ${user.id})`;
}

export function formatDate(date) {
  return `<t:${Math.floor(date.getTime() / 1000)}:F>`;
}

export function formatRelativeTime(date) {
  return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}

export function formatCodeBlock(content, language = '') {
  return `\`\`\`${language}\n${content}\n\`\`\``;
}

export function formatInlineCode(content) {
  return `\`${content}\``;
}

export function formatBold(content) {
  return `**${content}**`;
}

export function formatItalic(content) {
  return `*${content}*`;
}

export function formatUnderline(content) {
  return `__${content}__`;
}

export function formatStrikethrough(content) {
  return `~~${content}~~`;
}

export function formatSpoiler(content) {
  return `||${content}||`;
}

export function formatQuote(content) {
  return `> ${content}`;
}

export function formatList(items, ordered = false) {
  return items
    .map((item, index) => `${ordered ? `${index + 1}.` : ICONS.dot} ${item}`)
    .join('\n');
}

export function formatDuration(ms) {
  if (ms < 0) return '0s';

  const seconds = Math.floor(ms / 1000) % 60;
  const minutes = Math.floor(ms / (1000 * 60)) % 60;
  const hours = Math.floor(ms / (1000 * 60 * 60)) % 24;
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(' ');
}

export function formatProgressBar(current, max, size = 10) {
  const progress = max > 0 ? Math.min(Math.max(0, current / max), 1) : 0;
  const filled = Math.round(size * progress);
  const empty = size - filled;
  return `${'▰'.repeat(filled)}${'▱'.repeat(empty)} ${Math.round(progress * 100)}%`;
}

/** `**Label:** value` line used in descriptions. */
export function kv(label, value) {
  return `**${label}:** ${value}`;
}
