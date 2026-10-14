// panelApi.js — HTTP API for a web panel (pikczu.pl/bot) to read and change
// module settings: language, welcome, auto-roles, automod, server logs, invites, YouTube,
// economy (settings, shop, balances), leveling (settings, rewards, member levels),
// tickets (panel and its look, staff, categories) and temporary voice channels (join to create,
// message with the control buttons).
//
// Disabled unless PANEL_API_KEY is set. Every request must send
//   Authorization: Bearer <PANEL_API_KEY>
// The key is a shared secret between the bot and the panel's server — it must
// never reach a browser.

import crypto from 'node:crypto';
import express from 'express';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { TitanBotError } from '../utils/errorHandler.js';
import { logger } from '../utils/logger.js';
import { LOCALE_INFO, SUPPORTED_LOCALES, normalizeLocale, runWithLocale, tr, trAny } from '../i18n/index.js';
import { getGuildLocale, setGuildLocale } from '../services/languageService.js';
import { getGuildConfig, updateGuildConfig } from '../services/config/guildConfig.js';
import { getEconomyPrefix, getJoinToCreateConfig, getWelcomeConfig, saveJoinToCreateConfig, updateWelcomeConfig } from '../utils/database.js';
import { getGuildTicketStats } from '../utils/database/tickets.js';
import { TICKET_BUTTON_STYLES, buildPanelButtonRow, buildPanelEmbed } from '../commands/Ticket/modules/ticket_dashboard.js';
import { validateChannelNameTemplate } from '../services/joinToCreateService.js';
import { syncInterfaceMessage } from '../services/tempVoiceInterface.js';
import { getColor } from '../config/bot.js';
import { getAutoRoleSettings, getAutoRoleSyncStatus, startAutoRoleSync } from '../services/autoRoleService.js';
import {
  MAX_SELF_ROLE_BUTTONS,
  MAX_SELF_ROLE_PANELS,
  SELF_ROLE_BUTTON_STYLES,
  SELF_ROLE_DEFAULT_COLOR,
  SELF_ROLE_LABEL_MAX,
  SELF_ROLE_TEXT_MAX,
  SELF_ROLE_TITLE_MAX,
  getSelfRolePanels,
  isSelfRoleEmoji,
  newSelfRolePanelId,
  removeSelfRoleMessage,
  saveSelfRolePanels,
  syncSelfRoleMessage,
} from '../services/selfRoleService.js';
import { hasDangerousPermissions } from '../services/reactionRoleService.js';
import { GREETING_STYLES, getGreetingLayout } from '../utils/welcome.js';
import { getEconomyData, setEconomyData } from '../utils/economy.js';
import {
  COMMAND_LIMITS,
  CURRENCY_POSITIONS,
  CURRENCY_SEPARATORS,
  EARNINGS_PERCENT_LIMITS,
  LIST_MODES,
  MAX_MONEY,
  MAX_SHOP_ROLES,
  getEconomySettings,
  getShopCatalog,
  isValidCurrencySymbol,
  updateEconomySettings,
} from '../services/economySettings.js';
import {
  LONG_MESSAGE_LENGTH,
  MAX_LEVEL,
  calculateTotalXp,
  getLevelingConfig,
  getMessageXpRange,
  getUserLevelData,
  getXpForLevel,
  saveLevelingConfig,
  saveUserLevelData,
} from '../services/leveling/leveling.js';
import { getUserLevelPrefix } from '../utils/database/keys.js';
import { ACTIONS, RULES, getAutomodConfig, updateAutomodConfig } from '../services/automodService.js';
import { PRESET_LINKS, PRESET_WORDS } from '../config/automodPresets.js';
import { EVENT_TYPES, getIgnoreList } from '../services/loggingService.js';
import { cacheGuildInvites, getInviteConfig, updateInviteConfig } from '../services/inviteService.js';
import { addFeed, fetchVideos, getFeeds, removeFeed, resolveChannel, sendTestNotification, updateFeed } from '../services/notifications/youtube.js';

const MIN_KEY_LENGTH = 24;
const SNOWFLAKE_RE = /^\d{17,20}$/;
const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const TEXT_CHANNEL_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);
const MAX_AUTO_ROLES = 5;
const DEFAULT_MAX_TICKETS = 3;
const DEFAULT_VOICE_BITRATE = 64000;

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function keysMatch(given, expected) {
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

function requireTextChannel(guild, channelId, field) {
  if (channelId === null) return null;
  const channel = SNOWFLAKE_RE.test(String(channelId)) ? guild.channels.cache.get(String(channelId)) : null;
  if (!channel || !TEXT_CHANNEL_TYPES.has(channel.type)) throw new ApiError(400, `${field}: not a text channel of this server`);
  return channel.id;
}

// A channel of one exact type: a category or a voice channel (`label` names it in the error).
function requireChannelOfType(guild, channelId, field, type, label) {
  if (channelId === null) return null;
  const channel = SNOWFLAKE_RE.test(String(channelId)) ? guild.channels.cache.get(String(channelId)) : null;
  if (!channel || channel.type !== type) throw new ApiError(400, `${field}: not a ${label} of this server`);
  return channel.id;
}

function requireRole(guild, roleId, field) {
  if (roleId === null) return null;
  const role = SNOWFLAKE_RE.test(String(roleId)) ? guild.roles.cache.get(String(roleId)) : null;
  if (!role || role.id === guild.id || role.managed) throw new ApiError(400, `${field}: not an assignable role of this server`);
  return role.id;
}

// The bot must be able to post a message with an embed on a channel that holds one of its panels.
function requireEmbedAccess(guild, channel, field) {
  const permissions = guild.members.me ? channel.permissionsFor(guild.members.me) : null;
  if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
    throw new ApiError(400, `${field}: the bot cannot send messages with embeds on that channel`);
  }
}

function hexColorString(value, field) {
  if (typeof value !== 'string' || !HEX_COLOR_RE.test(value)) throw new ApiError(400, `${field}: colour like #30d158 expected`);
  return value.toLowerCase();
}

function optionalString(value, field, max) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > max) throw new ApiError(400, `${field}: text up to ${max} characters expected`);
  return value;
}

function integer(value, field, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) throw new ApiError(400, `${field}: whole number ${min}-${max} expected`);
  return value;
}

function boolean(value, field) {
  if (typeof value !== 'boolean') throw new ApiError(400, `${field}: true or false expected`);
  return value;
}

function stringList(value, field, { max, itemMax, pattern = null }) {
  if (!Array.isArray(value) || value.length > max) throw new ApiError(400, `${field}: list of up to ${max} items expected`);
  return [...new Set(value.map((item) => {
    if (typeof item !== 'string' || !item.trim() || item.length > itemMax || (pattern && !pattern.test(item.trim()))) {
      throw new ApiError(400, `${field}: invalid item`);
    }
    return item.trim().toLowerCase();
  }))];
}

function guildSummary(guild) {
  return { id: guild.id, name: guild.name, icon: guild.iconURL?.({ size: 128 }) ?? null, memberCount: guild.memberCount };
}

const hexColor = (color) => `#${color.toString(16).padStart(6, '0')}`;

function welcomeView(config) {
  const welcome = getGreetingLayout('welcome', config);
  const goodbye = getGreetingLayout('goodbye', config);
  return {
    enabled: config.enabled,
    channelId: config.channelId ?? null,
    message: config.welcomeMessage ?? '',
    style: welcome.style,
    embedTitle: welcome.title,
    embedColor: hexColor(welcome.color),
    embedExtras: welcome.extras,
    ping: config.welcomePing,
    image: config.welcomeImage ?? null,
    goodbyeEnabled: config.goodbyeEnabled,
    goodbyeChannelId: config.goodbyeChannelId ?? null,
    goodbyeMessage: config.leaveMessage ?? '',
    goodbyeStyle: goodbye.style,
    goodbyeEmbedTitle: goodbye.title,
    goodbyeEmbedColor: hexColor(goodbye.color),
    goodbyeEmbedExtras: goodbye.extras,
    autoRoleId: config.roleIds?.[0] ?? null,
  };
}

function greetingStyle(value, field) {
  if (!GREETING_STYLES.includes(value)) throw new ApiError(400, `${field}: one of ${GREETING_STYLES.join(', ')}`);
  return value;
}

// Title and colour of the welcome / goodbye embed, merged into what is stored; null when the body changes neither.
function greetingEmbed(body, titleField, colorField, current) {
  const embed = { ...current };
  if (titleField in body) embed.title = optionalString(body[titleField], titleField, 256) ?? '';
  if (colorField in body) {
    if (typeof body[colorField] !== 'string' || !HEX_COLOR_RE.test(body[colorField])) throw new ApiError(400, `${colorField}: colour like #30d158 expected`);
    embed.color = parseInt(body[colorField].slice(1), 16);
  }
  return titleField in body || colorField in body ? embed : null;
}

function automodView(config) {
  return {
    enabled: config.enabled,
    logChannelId: config.logChannelId,
    timeoutMinutes: config.timeoutMinutes,
    exemptRoles: config.exemptRoles,
    exemptChannels: config.exemptChannels,
    rules: config.rules,
    strikes: config.strikes,
    raid: config.raid,
    // Ready-made lists for the panel's "insert list" buttons; not part of the settings.
    presets: { words: PRESET_WORDS, links: PRESET_LINKS },
  };
}

const feedView = (feed) => ({
  id: feed.id,
  name: feed.name,
  avatar: feed.avatar ?? null,
  channelId: feed.channelId,
  roleId: feed.roleId ?? null,
  includeShorts: feed.includeShorts !== false,
  message: feed.message ?? null,
  paused: feed.paused === true,
});

async function applyWelcome(client, guild, body) {
  const updates = {};
  const current = await getWelcomeConfig(client, guild.id);
  if ('enabled' in body) updates.enabled = boolean(body.enabled, 'enabled');
  if ('channelId' in body) updates.channelId = requireTextChannel(guild, body.channelId, 'channelId');
  if ('message' in body) updates.welcomeMessage = optionalString(body.message, 'message', 2000) ?? '';
  if ('style' in body) updates.welcomeStyle = greetingStyle(body.style, 'style');
  if ('embedExtras' in body) updates.welcomeExtras = boolean(body.embedExtras, 'embedExtras');
  if ('goodbyeStyle' in body) updates.goodbyeStyle = greetingStyle(body.goodbyeStyle, 'goodbyeStyle');
  if ('goodbyeEmbedExtras' in body) updates.goodbyeExtras = boolean(body.goodbyeEmbedExtras, 'goodbyeEmbedExtras');
  const welcomeEmbed = greetingEmbed(body, 'embedTitle', 'embedColor', current.welcomeEmbed);
  if (welcomeEmbed) updates.welcomeEmbed = welcomeEmbed;
  const leaveEmbed = greetingEmbed(body, 'goodbyeEmbedTitle', 'goodbyeEmbedColor', current.leaveEmbed);
  if (leaveEmbed) updates.leaveEmbed = leaveEmbed;
  if ('ping' in body) updates.welcomePing = boolean(body.ping, 'ping');
  if ('image' in body) {
    const image = optionalString(body.image, 'image', 500);
    if (image && !/^https:\/\//i.test(image)) throw new ApiError(400, 'image: https:// address expected');
    updates.welcomeImage = image;
  }
  if ('goodbyeEnabled' in body) updates.goodbyeEnabled = boolean(body.goodbyeEnabled, 'goodbyeEnabled');
  if ('goodbyeChannelId' in body) updates.goodbyeChannelId = requireTextChannel(guild, body.goodbyeChannelId, 'goodbyeChannelId');
  if ('goodbyeMessage' in body) updates.leaveMessage = optionalString(body.goodbyeMessage, 'goodbyeMessage', 2000) ?? '';
  if ('autoRoleId' in body) {
    const roleId = requireRole(guild, body.autoRoleId, 'autoRoleId');
    updates.roleIds = roleId ? [roleId] : [];
  }
  if (updates.enabled === true && !(updates.channelId ?? current.channelId)) throw new ApiError(400, 'channelId: choose a channel before enabling welcome messages');
  if (updates.goodbyeEnabled === true && !(updates.goodbyeChannelId ?? current.goodbyeChannelId)) throw new ApiError(400, 'goodbyeChannelId: choose a channel before enabling goodbye messages');
  return welcomeView(await updateWelcomeConfig(client, guild.id, updates));
}

async function applyAutomod(guild, body) {
  const config = await updateAutomodConfig(guild.id, (data) => {
    if ('enabled' in body) data.enabled = boolean(body.enabled, 'enabled');
    if ('logChannelId' in body) data.logChannelId = requireTextChannel(guild, body.logChannelId, 'logChannelId');
    if ('timeoutMinutes' in body) data.timeoutMinutes = integer(body.timeoutMinutes, 'timeoutMinutes', 1, 40320);
    if ('exemptRoles' in body) data.exemptRoles = stringList(body.exemptRoles, 'exemptRoles', { max: 50, itemMax: 20, pattern: SNOWFLAKE_RE });
    if ('exemptChannels' in body) data.exemptChannels = stringList(body.exemptChannels, 'exemptChannels', { max: 100, itemMax: 20, pattern: SNOWFLAKE_RE });

    for (const [name, patch] of Object.entries(body.rules ?? {})) {
      if (!RULES.includes(name) || !patch || typeof patch !== 'object') throw new ApiError(400, `rules.${name}: unknown rule`);
      const rule = data.rules[name];
      if ('enabled' in patch) rule.enabled = boolean(patch.enabled, `rules.${name}.enabled`);
      if ('action' in patch) {
        if (!ACTIONS.includes(patch.action)) throw new ApiError(400, `rules.${name}.action: one of ${ACTIONS.join(', ')}`);
        rule.action = patch.action;
      }
      if ('limit' in patch && 'limit' in rule) rule.limit = integer(patch.limit, `rules.${name}.limit`, 2, 100);
      if ('seconds' in patch && name === 'spam') rule.seconds = integer(patch.seconds, 'rules.spam.seconds', 2, 60);
      if ('percent' in patch && name === 'caps') rule.percent = integer(patch.percent, 'rules.caps.percent', 30, 100);
      if ('list' in patch && name === 'words') rule.list = stringList(patch.list, 'rules.words.list', { max: 300, itemMax: 40 });
      if ('freeHours' in patch && name === 'words') rule.freeHours = boolean(patch.freeHours, 'rules.words.freeHours');
      if ('freeFrom' in patch && name === 'words') rule.freeFrom = integer(patch.freeFrom, 'rules.words.freeFrom', 0, 23);
      if ('freeTo' in patch && name === 'words') rule.freeTo = integer(patch.freeTo, 'rules.words.freeTo', 0, 23);
      if ('allow' in patch && name === 'links') rule.allow = stringList(patch.allow, 'rules.links.allow', { max: 100, itemMax: 100, pattern: /^[a-z0-9.-]+\.[a-z]{2,}$/i });
    }

    if (body.raid && typeof body.raid === 'object') {
      const { raid } = body;
      if ('enabled' in raid) data.raid.enabled = boolean(raid.enabled, 'raid.enabled');
      if ('joins' in raid) data.raid.joins = integer(raid.joins, 'raid.joins', 3, 100);
      if ('seconds' in raid) data.raid.seconds = integer(raid.seconds, 'raid.seconds', 3, 120);
      if ('action' in raid) {
        if (!['alert', 'kick'].includes(raid.action)) throw new ApiError(400, 'raid.action: alert or kick');
        data.raid.action = raid.action;
      }
      if ('minAccountAgeDays' in raid) data.raid.minAccountAgeDays = integer(raid.minAccountAgeDays, 'raid.minAccountAgeDays', 0, 365);
    }
  });
  return automodView(config);
}

// Server logs (the panel's "Logi" module): one channel (the audit destination of loggingService),
// event categories on/off and channels whose events are skipped. Applications and reports
// keep their own destinations and are not shown here.
export const LOG_CATEGORIES = ['moderation', 'message', 'member', 'role', 'leveling', 'giveaway', 'reactionrole', 'counter'];

function loggingView(config) {
  const logging = config.logging ?? {};
  const events = logging.enabledEvents ?? {};
  return {
    enabled: logging.enabled === true,
    channelId: logging.channels?.audit ?? null,
    categories: Object.fromEntries(LOG_CATEGORIES.map((category) => [category, events[`${category}.*`] !== false])),
    ignoreChannels: getIgnoreList(config).channels ?? [],
  };
}

async function applyLogging(client, guild, body) {
  const config = await getGuildConfig(client, guild.id);
  const logging = {
    ...config.logging,
    channels: { ...(config.logging?.channels ?? {}) },
    enabledEvents: { ...(config.logging?.enabledEvents ?? {}) },
    ignore: { ...getIgnoreList(config) },
  };
  if ('enabled' in body) logging.enabled = boolean(body.enabled, 'enabled');
  if ('channelId' in body) logging.channels.audit = requireTextChannel(guild, body.channelId, 'channelId');
  if ('categories' in body) {
    for (const [category, value] of Object.entries(plainObject(body.categories, 'categories'))) {
      if (!LOG_CATEGORIES.includes(category)) throw new ApiError(400, `categories.${category}: unknown category`);
      const enabled = boolean(value, `categories.${category}`);
      // Same shape as /logi toggle: the category switch plus every event in it.
      logging.enabledEvents[`${category}.*`] = enabled;
      for (const type of Object.values(EVENT_TYPES)) if (type.startsWith(`${category}.`)) logging.enabledEvents[type] = enabled;
    }
  }
  if ('ignoreChannels' in body) {
    const list = stringList(body.ignoreChannels, 'ignoreChannels', { max: 100, itemMax: 20, pattern: SNOWFLAKE_RE });
    if (list.some((id) => !guild.channels.cache.has(id))) throw new ApiError(400, 'ignoreChannels: not from this server');
    logging.ignore.channels = list;
  }
  if (logging.enabled && !logging.channels.audit) throw new ApiError(400, 'channelId: choose a channel before enabling logs');
  await updateGuildConfig(client, guild.id, { logging });
  return loggingView(await getGuildConfig(client, guild.id));
}

function oneOf(value, field, allowed) {
  if (!allowed.includes(value)) throw new ApiError(400, `${field}: one of ${allowed.map((item) => JSON.stringify(item)).join(', ')}`);
  return value;
}

function plainObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(400, `${field}: object expected`);
  return value;
}

// { mode: "block" | "allow", list: [ids] } — ids must exist in `known` (guild channels or roles).
function applyIdList(target, patch, field, known) {
  plainObject(patch, field);
  if ('mode' in patch) target.mode = oneOf(patch.mode, `${field}.mode`, LIST_MODES);
  if ('list' in patch) {
    const list = stringList(patch.list, `${field}.list`, { max: 100, itemMax: 20, pattern: SNOWFLAKE_RE });
    if (list.some((id) => !known.has(id))) throw new ApiError(400, `${field}.list: not from this server`);
    target.list = list;
  }
}

function economyView(settings, guild, premiumRoleId) {
  const { shop, balanceVersion, ...rest } = settings;
  return {
    ...rest,
    shop: {
      premiumRoleId: premiumRoleId ?? null,
      items: getShopCatalog(settings, guild).filter((item) => !item.custom).map((item) => ({
        id: item.id,
        name: tr(item.name),
        description: tr(item.description),
        type: item.type,
        price: item.price,
        defaultPrice: item.defaultPrice,
        enabled: item.enabled,
      })),
      roles: shop.roles,
    },
    limits: { ...COMMAND_LIMITS, earningsPercent: EARNINGS_PERCENT_LIMITS },
  };
}

async function applyEconomy(client, guild, body) {
  let premiumRoleId;
  const settings = await updateEconomySettings(guild.id, (data) => {
    if ('currency' in body) {
      const currency = plainObject(body.currency, 'currency');
      if ('symbol' in currency) {
        if (!isValidCurrencySymbol(currency.symbol)) throw new ApiError(400, 'currency.symbol: short text or one emoji expected (no @, no line breaks)');
        data.currency.symbol = currency.symbol.trim();
      }
      if ('position' in currency) data.currency.position = oneOf(currency.position, 'currency.position', CURRENCY_POSITIONS);
      if ('separator' in currency) data.currency.separator = oneOf(currency.separator, 'currency.separator', CURRENCY_SEPARATORS);
    }
    if ('startingWallet' in body) data.startingWallet = integer(body.startingWallet, 'startingWallet', 0, MAX_MONEY);
    if ('startingBank' in body) data.startingBank = integer(body.startingBank, 'startingBank', 0, MAX_MONEY);
    if ('clearOnLeave' in body) data.clearOnLeave = boolean(body.clearOnLeave, 'clearOnLeave');
    if ('payTaxPercent' in body) data.payTaxPercent = integer(body.payTaxPercent, 'payTaxPercent', 0, 90);
    if ('earningsPercent' in body) data.earningsPercent = integer(body.earningsPercent, 'earningsPercent', ...EARNINGS_PERCENT_LIMITS);

    if ('activity' in body) {
      const activity = plainObject(body.activity, 'activity');
      if ('enabled' in activity) data.activity.enabled = boolean(activity.enabled, 'activity.enabled');
      if ('amount' in activity) data.activity.amount = integer(activity.amount, 'activity.amount', 0, MAX_MONEY);
      if ('cooldownSeconds' in activity) data.activity.cooldownSeconds = integer(activity.cooldownSeconds, 'activity.cooldownSeconds', 5, 86400);
    }

    if ('channels' in body) applyIdList(data.channels, body.channels, 'channels', guild.channels.cache);
    if ('roles' in body) applyIdList(data.roles, body.roles, 'roles', guild.roles.cache);

    for (const [name, patch] of Object.entries('commands' in body ? plainObject(body.commands, 'commands') : {})) {
      const limits = COMMAND_LIMITS[name];
      if (!limits) throw new ApiError(400, `commands.${name}: unknown command`);
      for (const [key, value] of Object.entries(plainObject(patch, `commands.${name}`))) {
        if (!limits[key]) throw new ApiError(400, `commands.${name}.${key}: unknown setting`);
        data.commands[name][key] = integer(value, `commands.${name}.${key}`, ...limits[key]);
      }
      if ('min' in limits && data.commands[name].min > data.commands[name].max) {
        throw new ApiError(400, `commands.${name}: min cannot be higher than max`);
      }
    }

    if ('shop' in body) {
      const shop = plainObject(body.shop, 'shop');
      if ('premiumRoleId' in shop) premiumRoleId = requireRole(guild, shop.premiumRoleId, 'shop.premiumRoleId');

      // Default prices follow the payouts saved above; a price equal to the default is not
      // stored, so it keeps following them (the panel sends every item's price on each save).
      const defaults = new Map(getShopCatalog(data).filter((item) => !item.custom).map((item) => [item.id, item.defaultPrice]));
      for (const [itemId, patch] of Object.entries('items' in shop ? plainObject(shop.items, 'shop.items') : {})) {
        if (!defaults.has(itemId)) throw new ApiError(400, `shop.items.${itemId}: unknown item`);
        plainObject(patch, `shop.items.${itemId}`);
        const entry = { ...data.shop.items[itemId] };
        if ('enabled' in patch) entry.enabled = boolean(patch.enabled, `shop.items.${itemId}.enabled`);
        if ('price' in patch) {
          const price = patch.price === null ? null : integer(patch.price, `shop.items.${itemId}.price`, 0, MAX_MONEY);
          if (price === null || price === defaults.get(itemId)) delete entry.price;
          else entry.price = price;
        }
        data.shop.items[itemId] = entry;
      }

      if ('roles' in shop) {
        if (!Array.isArray(shop.roles) || shop.roles.length > MAX_SHOP_ROLES) throw new ApiError(400, `shop.roles: list of up to ${MAX_SHOP_ROLES} roles expected`);
        const roles = shop.roles.map((entry, index) => {
          plainObject(entry, `shop.roles.${index}`);
          const roleId = requireRole(guild, entry.roleId ?? null, `shop.roles.${index}.roleId`);
          if (!roleId) throw new ApiError(400, `shop.roles.${index}.roleId: required`);
          return {
            roleId,
            price: integer(entry.price, `shop.roles.${index}.price`, 1, MAX_MONEY),
            description: (optionalString(entry.description ?? null, `shop.roles.${index}.description`, 200) ?? '').trim(),
          };
        });
        if (new Set(roles.map((entry) => entry.roleId)).size !== roles.length) throw new ApiError(400, 'shop.roles: the same role is listed twice');
        data.shop.roles = roles;
      }
    }
  });

  if (premiumRoleId === undefined) return economyView(settings, guild, (await getGuildConfig(client, guild.id)).premiumRoleId);
  await updateGuildConfig(client, guild.id, { premiumRoleId });
  return economyView(settings, guild, premiumRoleId);
}

// List of role IDs, each at most once. `assignable` also refuses roles the bot can never give (managed ones).
function roleList(guild, value, field, max, { assignable = true } = {}) {
  if (!Array.isArray(value) || value.length > max) throw new ApiError(400, `${field}: list of up to ${max} roles expected`);
  return [...new Set(value.map((roleId, index) => {
    if (assignable) return requireRole(guild, roleId ?? '', `${field}.${index}`);
    const id = String(roleId ?? '');
    if (!SNOWFLAKE_RE.test(id) || id === guild.id || !guild.roles.cache.has(id)) throw new ApiError(400, `${field}.${index}: not a role of this server`);
    return id;
  }))];
}

// Auto-roles live inside the welcome config; the panel edits them as a module of their own.
async function applyAutoRole(client, guild, body) {
  const updates = {};
  if ('roleIds' in body) updates.roleIds = roleList(guild, body.roleIds, 'roleIds', MAX_AUTO_ROLES);
  if ('delaySeconds' in body) updates.autoRoleDelay = integer(body.delaySeconds, 'delaySeconds', 0, 600);

  if ('bots' in body) {
    const bots = plainObject(body.bots, 'bots');
    if ('enabled' in bots) updates.autoRoleBots = boolean(bots.enabled, 'bots.enabled');
    if ('delay' in bots) updates.autoRoleBotDelay = boolean(bots.delay, 'bots.delay');
    if ('different' in bots) updates.autoRoleBotsDifferent = boolean(bots.different, 'bots.different');
    if ('roleIds' in bots) updates.autoRoleBotRoleIds = roleList(guild, bots.roleIds, 'bots.roleIds', MAX_AUTO_ROLES);
  }

  if ('sync' in body) {
    const sync = plainObject(body.sync, 'sync');
    if ('excludeRoleIds' in sync) updates.autoRoleSyncExclude = roleList(guild, sync.excludeRoleIds, 'sync.excludeRoleIds', 25, { assignable: false });
    if ('daily' in sync) updates.autoRoleSyncDaily = boolean(sync.daily, 'sync.daily');
  }

  return getAutoRoleSettings(await updateWelcomeConfig(client, guild.id, updates));
}

async function ticketsView(client, guild) {
  const config = await getGuildConfig(client, guild.id);
  const stats = await getGuildTicketStats(guild.id);
  return {
    panelChannelId: config.ticketPanelChannelId ?? null,
    panelPosted: Boolean(config.ticketPanelChannelId && config.ticketPanelMessageId),
    panelTitle: config.ticketPanelTitle || tr('Support Tickets'),
    panelColor: HEX_COLOR_RE.test(config.ticketPanelColor ?? '') ? config.ticketPanelColor : hexColor(getColor('info')),
    buttonStyle: TICKET_BUTTON_STYLES.includes(config.ticketButtonStyle) ? config.ticketButtonStyle : TICKET_BUTTON_STYLES[0],
    panelMessage: config.ticketPanelMessage || tr('Click the button below to create a support ticket.'),
    buttonLabel: config.ticketButtonLabel || tr('Create Ticket'),
    categoryId: config.ticketCategoryId ?? null,
    closedCategoryId: config.ticketClosedCategoryId ?? null,
    staffRoleId: config.ticketStaffRoleId ?? null,
    logsChannelId: config.ticketLogsChannelId ?? null,
    transcriptChannelId: config.ticketTranscriptChannelId ?? null,
    maxTicketsPerUser: config.maxTicketsPerUser ?? DEFAULT_MAX_TICKETS,
    dmOnClose: config.dmOnClose !== false,
    open: stats.openCount,
    closed: stats.closedCount,
  };
}

// Posts the ticket panel, or edits the one already posted. Returns the ID of the panel
// message, null when the panel is switched off (the old message is removed then).
async function syncTicketPanel(guild, previous, next, repost) {
  const oldChannel = previous.ticketPanelChannelId ? guild.channels.cache.get(previous.ticketPanelChannelId) : null;
  const oldMessage = oldChannel && previous.ticketPanelMessageId
    ? await oldChannel.messages.fetch(previous.ticketPanelMessageId).catch(() => null)
    : null;
  const channel = next.ticketPanelChannelId ? guild.channels.cache.get(next.ticketPanelChannelId) : null;

  if (!channel) {
    await oldMessage?.delete().catch(() => {});
    return null;
  }

  requireEmbedAccess(guild, channel, 'panelChannelId');

  const payload = { embeds: [buildPanelEmbed(next)], components: [buildPanelButtonRow(next)] };
  if (oldMessage && oldChannel.id === channel.id && !repost) {
    await oldMessage.edit(payload);
    return oldMessage.id;
  }
  const sent = await channel.send(payload);
  await oldMessage?.delete().catch(() => {});
  return sent.id;
}

async function applyTickets(client, guild, body) {
  const current = await getGuildConfig(client, guild.id);
  const updates = {};
  const category = (field) => requireChannelOfType(guild, body[field], field, ChannelType.GuildCategory, 'category');

  if ('panelChannelId' in body) updates.ticketPanelChannelId = requireTextChannel(guild, body.panelChannelId, 'panelChannelId');
  if ('panelMessage' in body) updates.ticketPanelMessage = (optionalString(body.panelMessage, 'panelMessage', 2000) ?? '').trim() || null;
  if ('buttonLabel' in body) updates.ticketButtonLabel = (optionalString(body.buttonLabel, 'buttonLabel', 80) ?? '').trim() || null;
  if ('panelTitle' in body) updates.ticketPanelTitle = (optionalString(body.panelTitle, 'panelTitle', 256) ?? '').trim() || null;
  if ('panelColor' in body) updates.ticketPanelColor = body.panelColor === null ? null : hexColorString(body.panelColor, 'panelColor');
  if ('buttonStyle' in body) updates.ticketButtonStyle = oneOf(body.buttonStyle, 'buttonStyle', TICKET_BUTTON_STYLES);
  if ('categoryId' in body) updates.ticketCategoryId = category('categoryId');
  if ('closedCategoryId' in body) updates.ticketClosedCategoryId = category('closedCategoryId');
  if ('staffRoleId' in body) updates.ticketStaffRoleId = requireRole(guild, body.staffRoleId, 'staffRoleId');
  if ('logsChannelId' in body) updates.ticketLogsChannelId = requireTextChannel(guild, body.logsChannelId, 'logsChannelId');
  if ('transcriptChannelId' in body) updates.ticketTranscriptChannelId = requireTextChannel(guild, body.transcriptChannelId, 'transcriptChannelId');
  if ('maxTicketsPerUser' in body) updates.maxTicketsPerUser = integer(body.maxTicketsPerUser, 'maxTicketsPerUser', 1, 10);
  if ('dmOnClose' in body) updates.dmOnClose = boolean(body.dmOnClose, 'dmOnClose');

  // The panel message follows its settings: a new channel, text, title, colour or button is posted right away.
  const next = { ...current, ...updates };
  const repost = body.repost === true;
  const panelChanged = ['ticketPanelChannelId', 'ticketPanelMessage', 'ticketButtonLabel', 'ticketPanelTitle', 'ticketPanelColor', 'ticketButtonStyle']
    .some((key) => key in updates && updates[key] !== (current[key] ?? null));
  if (panelChanged || repost || (next.ticketPanelChannelId && !next.ticketPanelMessageId)) {
    updates.ticketPanelMessageId = await syncTicketPanel(guild, current, next, repost);
  }

  await updateGuildConfig(client, guild.id, updates);
  return ticketsView(client, guild);
}

const maxBitrateKbps = (guild) => Math.floor((guild.maximumBitrate ?? 96000) / 1000);

// The bot supports one "join to create" channel per server; settings of that channel are shown flat.
function tempVoiceView(config, guild) {
  const triggerChannelId = config.triggerChannels.find((id) => guild.channels.cache.has(id)) ?? null;
  const options = (triggerChannelId && config.channelOptions?.[triggerChannelId]) || {};
  const interfaceChannelId = config.interfaceChannelId && guild.channels.cache.has(config.interfaceChannelId) ? config.interfaceChannelId : null;
  return {
    enabled: Boolean(config.enabled && triggerChannelId),
    triggerChannelId,
    nameTemplate: trAny(options.nameTemplate || config.channelNameTemplate),
    userLimit: options.userLimit ?? config.userLimit ?? 0,
    bitrateKbps: Math.round((options.bitrate ?? config.bitrate ?? DEFAULT_VOICE_BITRATE) / 1000),
    maxBitrateKbps: maxBitrateKbps(guild),
    interfaceChannelId,
    interfacePosted: Boolean(interfaceChannelId && config.interfaceMessageId),
    active: Object.keys(config.temporaryChannels ?? {}).filter((id) => guild.channels.cache.has(id)).length,
  };
}

async function applyTempVoice(client, guild, body) {
  const config = await getJoinToCreateConfig(client, guild.id);
  let triggerChannelId = config.triggerChannels.find((id) => guild.channels.cache.has(id)) ?? null;
  const options = { ...(triggerChannelId ? config.channelOptions?.[triggerChannelId] : null) };

  if ('nameTemplate' in body) {
    const template = (optionalString(body.nameTemplate, 'nameTemplate', 100) ?? '').trim();
    try {
      validateChannelNameTemplate(template);
    } catch (error) {
      throw new ApiError(400, `nameTemplate: ${error.userMessage || error.message}`);
    }
    options.nameTemplate = template;
  }
  if ('userLimit' in body) options.userLimit = integer(body.userLimit, 'userLimit', 0, 99);
  if ('bitrateKbps' in body) options.bitrate = integer(body.bitrateKbps, 'bitrateKbps', 8, maxBitrateKbps(guild)) * 1000;

  // Channel of the message with the control buttons; checked before anything is created or sent.
  const repostInterface = body.repostInterface === true;
  const interfaceChannelId = 'interfaceChannelId' in body ? requireTextChannel(guild, body.interfaceChannelId, 'interfaceChannelId') : (config.interfaceChannelId ?? null);
  const interfaceChannel = interfaceChannelId ? guild.channels.cache.get(interfaceChannelId) ?? null : null;
  if (repostInterface && !interfaceChannel) throw new ApiError(400, 'interfaceChannelId: choose a channel for the control buttons first');
  const interfaceMoved = interfaceChannelId !== (config.interfaceChannelId ?? null);
  if (interfaceChannel && (interfaceMoved || repostInterface)) requireEmbedAccess(guild, interfaceChannel, 'interfaceChannelId');

  // "new" makes the bot create the channel people join; an ID picks an existing voice channel.
  if (body.triggerChannelId === 'new') {
    const parent = 'categoryId' in body ? requireChannelOfType(guild, body.categoryId, 'categoryId', ChannelType.GuildCategory, 'category') : null;
    const name = (optionalString(body.newChannelName ?? null, 'newChannelName', 100) ?? '').trim() || tr('Join to Create');
    const created = await guild.channels.create({ name, type: ChannelType.GuildVoice, parent: parent ?? undefined, reason: 'Panel: join to create channel' });
    triggerChannelId = created.id;
  } else if ('triggerChannelId' in body) {
    triggerChannelId = requireChannelOfType(guild, body.triggerChannelId, 'triggerChannelId', ChannelType.GuildVoice, 'voice channel');
  }

  const enabled = 'enabled' in body ? boolean(body.enabled, 'enabled') : (config.enabled || 'triggerChannelId' in body);
  if (enabled && !triggerChannelId && 'enabled' in body) throw new ApiError(400, 'triggerChannelId: choose a voice channel before enabling temporary channels');

  const triggerChanged = triggerChannelId !== (config.triggerChannels[0] ?? null);
  config.triggerChannels = triggerChannelId ? [triggerChannelId] : [];
  config.channelOptions = triggerChannelId ? { [triggerChannelId]: options } : {};
  config.enabled = Boolean(enabled && triggerChannelId);

  // The message with the control buttons follows its channel; it names the channel people join, so a new one edits it.
  if (interfaceMoved || repostInterface || (interfaceChannel && (triggerChanged || !config.interfaceMessageId))) {
    if (interfaceChannel) requireEmbedAccess(guild, interfaceChannel, 'interfaceChannelId');
    config.interfaceMessageId = await syncInterfaceMessage(guild, config, interfaceChannel, { repost: repostInterface });
    config.interfaceChannelId = interfaceChannel?.id ?? null;
  }
  // Kept at the top level too: rooms created under an earlier trigger channel fall back to these.
  if (options.nameTemplate) config.channelNameTemplate = options.nameTemplate;
  if (options.userLimit !== undefined) config.userLimit = options.userLimit;
  if (options.bitrate) config.bitrate = options.bitrate;

  if (!(await saveJoinToCreateConfig(client, guild.id, config))) throw new Error('Could not save the temporary channel settings');
  return tempVoiceView(config, guild);
}

function requireUserId(value) {
  if (!SNOWFLAKE_RE.test(String(value))) throw new ApiError(400, 'userId: Discord user ID expected');
  return String(value);
}

function userName(client, guild, userId) {
  const user = guild.members.cache.get(userId)?.user ?? client.users?.cache?.get(userId) ?? null;
  return user ? (user.globalName || user.displayName || user.username || null) : null;
}

async function listEconomyAccounts(client, guild) {
  const prefix = getEconomyPrefix(guild.id);
  const keys = await client.db.list(prefix);
  const accounts = [];
  for (const key of Array.isArray(keys) ? keys : []) {
    const data = await client.db.get(key);
    if (!data) continue;
    accounts.push({ key, userId: key.slice(prefix.length), wallet: Number(data.wallet) || 0, bank: Number(data.bank) || 0 });
  }
  return accounts;
}

const DEFAULT_LEVEL_UP_MESSAGE = '{user} has leveled up to level {level}!';

function levelingView(config) {
  const { min, max } = getMessageXpRange(config);
  return {
    enabled: config.enabled !== false,
    xpMin: min,
    xpMax: max,
    cooldownSeconds: config.xpCooldown ?? 60,
    multiplierPercent: Math.round((Number(config.xpMultiplier) > 0 ? Number(config.xpMultiplier) : 1) * 100),
    announce: config.announceLevelUp !== false,
    // "same" = the channel where the member wrote, null = the server's system channel.
    levelUpChannel: config.levelUpSameChannel ? 'same' : (config.levelUpChannel ?? null),
    levelUpMessage: trAny(config.levelUpMessage || DEFAULT_LEVEL_UP_MESSAGE),
    rewards: Object.entries(config.roleRewards ?? {})
      .map(([level, roleId]) => ({ level: Number(level), roleId }))
      .sort((a, b) => a.level - b.level),
    removePreviousRoles: config.removePreviousRoles === true,
    moneyPerLevel: config.moneyPerLevel,
    channels: { mode: config.channelMode, list: config.ignoredChannels ?? [] },
    roles: { mode: config.roleMode, list: config.ignoredRoles ?? [] },
    roleMultipliers: config.roleMultipliers,
    channelMultipliers: config.channelMultipliers,
    longMessageBonusPercent: config.longMessageBonusPercent,
    attachmentBonusPercent: config.attachmentBonusPercent,
    longMessageLength: LONG_MESSAGE_LENGTH,
    voice: { xpPerMinute: config.voiceXpPerMinute, countMuted: config.voiceCountMuted, countAlone: config.voiceCountAlone },
    clearOnLeave: config.clearOnLeave !== false,
    // Total XP needed to reach each of the first levels (the formula is fixed in the bot).
    thresholds: Array.from({ length: 15 }, (_, index) => ({ level: index + 1, xp: calculateTotalXp(index + 1) })),
  };
}

// [{ id, percent }] — ids must exist in `known` (guild roles or channels), each at most once.
function multiplierList(value, field, known) {
  if (!Array.isArray(value) || value.length > 25) throw new ApiError(400, `${field}: list of up to 25 items expected`);
  const list = value.map((entry, index) => {
    plainObject(entry, `${field}.${index}`);
    const id = String(entry.id ?? '');
    if (!SNOWFLAKE_RE.test(id) || !known.has(id)) throw new ApiError(400, `${field}.${index}.id: not from this server`);
    return { id, percent: integer(entry.percent, `${field}.${index}.percent`, 10, 1000) };
  });
  if (new Set(list.map((entry) => entry.id)).size !== list.length) throw new ApiError(400, `${field}: the same item is listed twice`);
  return list;
}

async function applyLeveling(client, guild, body) {
  const config = await getLevelingConfig(client, guild.id);

  if ('enabled' in body) config.enabled = boolean(body.enabled, 'enabled');
  if ('xpMin' in body || 'xpMax' in body) {
    const current = getMessageXpRange(config);
    const min = 'xpMin' in body ? integer(body.xpMin, 'xpMin', 1, 500) : current.min;
    const max = 'xpMax' in body ? integer(body.xpMax, 'xpMax', 1, 500) : current.max;
    if (min > max) throw new ApiError(400, 'xpMin: cannot be higher than xpMax');
    config.xpRange = { min, max };
    config.xpPerMessage = { min, max };
  }
  if ('cooldownSeconds' in body) config.xpCooldown = integer(body.cooldownSeconds, 'cooldownSeconds', 0, 3600);
  if ('multiplierPercent' in body) config.xpMultiplier = integer(body.multiplierPercent, 'multiplierPercent', 10, 1000) / 100;
  if ('announce' in body) config.announceLevelUp = boolean(body.announce, 'announce');
  if ('levelUpChannel' in body) {
    config.levelUpSameChannel = body.levelUpChannel === 'same';
    if (!config.levelUpSameChannel) config.levelUpChannel = requireTextChannel(guild, body.levelUpChannel, 'levelUpChannel');
  }
  if ('levelUpMessage' in body) config.levelUpMessage = (optionalString(body.levelUpMessage, 'levelUpMessage', 1000) ?? '').trim() || DEFAULT_LEVEL_UP_MESSAGE;

  if ('rewards' in body) {
    if (!Array.isArray(body.rewards) || body.rewards.length > 50) throw new ApiError(400, 'rewards: list of up to 50 rewards expected');
    const rewards = {};
    body.rewards.forEach((entry, index) => {
      plainObject(entry, `rewards.${index}`);
      const level = integer(entry.level, `rewards.${index}.level`, 1, MAX_LEVEL);
      if (rewards[level]) throw new ApiError(400, `rewards: level ${level} is listed twice`);
      const roleId = requireRole(guild, entry.roleId ?? null, `rewards.${index}.roleId`);
      if (!roleId) throw new ApiError(400, `rewards.${index}.roleId: required`);
      rewards[level] = roleId;
    });
    config.roleRewards = rewards;
  }
  if ('removePreviousRoles' in body) config.removePreviousRoles = boolean(body.removePreviousRoles, 'removePreviousRoles');
  if ('moneyPerLevel' in body) config.moneyPerLevel = integer(body.moneyPerLevel, 'moneyPerLevel', 0, MAX_MONEY);

  if ('channels' in body) {
    const target = { mode: config.channelMode, list: config.ignoredChannels ?? [] };
    applyIdList(target, body.channels, 'channels', guild.channels.cache);
    config.channelMode = target.mode;
    config.ignoredChannels = target.list;
  }
  if ('roles' in body) {
    const target = { mode: config.roleMode, list: config.ignoredRoles ?? [] };
    applyIdList(target, body.roles, 'roles', guild.roles.cache);
    config.roleMode = target.mode;
    config.ignoredRoles = target.list;
  }

  if ('roleMultipliers' in body) config.roleMultipliers = multiplierList(body.roleMultipliers, 'roleMultipliers', guild.roles.cache);
  if ('channelMultipliers' in body) config.channelMultipliers = multiplierList(body.channelMultipliers, 'channelMultipliers', guild.channels.cache);
  if ('longMessageBonusPercent' in body) config.longMessageBonusPercent = integer(body.longMessageBonusPercent, 'longMessageBonusPercent', 0, 500);
  if ('attachmentBonusPercent' in body) config.attachmentBonusPercent = integer(body.attachmentBonusPercent, 'attachmentBonusPercent', 0, 500);

  if ('voice' in body) {
    const voice = plainObject(body.voice, 'voice');
    if ('xpPerMinute' in voice) config.voiceXpPerMinute = integer(voice.xpPerMinute, 'voice.xpPerMinute', 0, 100);
    if ('countMuted' in voice) config.voiceCountMuted = boolean(voice.countMuted, 'voice.countMuted');
    if ('countAlone' in voice) config.voiceCountAlone = boolean(voice.countAlone, 'voice.countAlone');
  }
  if ('clearOnLeave' in body) config.clearOnLeave = boolean(body.clearOnLeave, 'clearOnLeave');

  // Marks the server as set up (older configs were created by a setup command).
  config.configured = true;
  await saveLevelingConfig(client, guild.id, config);
  return levelingView(config);
}

// Role buttons ("self roles"): messages with buttons that give a role on click and take it back on a
// second click — like the ProBot role message. The panel sends the whole list of messages every time;
// a panel without an ID is new, a missing one is removed (its message too).
function selfRolesView(panels, guild) {
  return {
    panels: panels.map((panel) => {
      const channelId = panel.channelId && guild.channels.cache.has(panel.channelId) ? panel.channelId : null;
      return {
        id: panel.id,
        channelId,
        posted: Boolean(channelId && panel.messageId),
        title: panel.title ?? '',
        description: panel.description ?? '',
        color: HEX_COLOR_RE.test(panel.color ?? '') ? panel.color : SELF_ROLE_DEFAULT_COLOR,
        exclusive: panel.exclusive === true,
        buttons: panel.buttons.map((entry) => ({ roleId: entry.roleId, label: entry.label ?? '', emoji: entry.emoji ?? '', style: entry.style })),
      };
    }),
    limits: { panels: MAX_SELF_ROLE_PANELS, buttons: MAX_SELF_ROLE_BUTTONS, title: SELF_ROLE_TITLE_MAX, text: SELF_ROLE_TEXT_MAX, label: SELF_ROLE_LABEL_MAX },
    styles: SELF_ROLE_BUTTON_STYLES,
  };
}

function selfRoleButton(guild, value, field) {
  const entry = plainObject(value, field);
  const role = SNOWFLAKE_RE.test(String(entry.roleId)) ? guild.roles.cache.get(String(entry.roleId)) : null;
  if (!role || role.id === guild.id || role.managed) throw new ApiError(400, `${field}.roleId: not an assignable role of this server`);
  if (!role.editable) throw new ApiError(400, `${field}.roleId: the bot's role must be above the role ${role.name}`);
  if (hasDangerousPermissions(role)) throw new ApiError(400, `${field}.roleId: the role ${role.name} has moderator permissions and cannot be given by a button`);
  const label = (optionalString(entry.label ?? null, `${field}.label`, SELF_ROLE_LABEL_MAX) ?? '').trim();
  const emoji = (optionalString(entry.emoji ?? null, `${field}.emoji`, 64) ?? '').trim();
  if (emoji && !isSelfRoleEmoji(emoji)) throw new ApiError(400, `${field}.emoji: one emoji expected (like 🎬 or <:name:id>)`);
  if (!label && !emoji) throw new ApiError(400, `${field}: a button needs a label or an emoji`);
  const style = entry.style === undefined ? 'primary' : oneOf(entry.style, `${field}.style`, SELF_ROLE_BUTTON_STYLES);
  return { roleId: role.id, label, emoji, style };
}

function selfRolePanel(guild, value, field, previous) {
  const panel = plainObject(value, field);
  const id = panel.id === undefined || panel.id === null ? null : String(panel.id);
  if (id !== null && !previous.some((entry) => entry.id === id)) throw new ApiError(400, `${field}.id: unknown role message`);
  const channelId = 'channelId' in panel ? requireTextChannel(guild, panel.channelId, `${field}.channelId`) : null;
  if (channelId) requireEmbedAccess(guild, guild.channels.cache.get(channelId), `${field}.channelId`);
  const title = (optionalString(panel.title ?? null, `${field}.title`, SELF_ROLE_TITLE_MAX) ?? '').trim();
  const description = (optionalString(panel.description ?? null, `${field}.description`, SELF_ROLE_TEXT_MAX) ?? '').trim();
  if (!title && !description) throw new ApiError(400, `${field}: a title or a text is needed`);
  const color = panel.color === undefined || panel.color === null ? SELF_ROLE_DEFAULT_COLOR : hexColorString(panel.color, `${field}.color`);
  const exclusive = panel.exclusive === undefined ? false : boolean(panel.exclusive, `${field}.exclusive`);
  if (!Array.isArray(panel.buttons) || panel.buttons.length < 1 || panel.buttons.length > MAX_SELF_ROLE_BUTTONS) {
    throw new ApiError(400, `${field}.buttons: 1-${MAX_SELF_ROLE_BUTTONS} buttons expected`);
  }
  const buttons = panel.buttons.map((entry, index) => selfRoleButton(guild, entry, `${field}.buttons[${index}]`));
  if (new Set(buttons.map((entry) => entry.roleId)).size !== buttons.length) throw new ApiError(400, `${field}.buttons: every role only once per message`);
  return { id, channelId, title, description, color, exclusive, buttons, repost: panel.repost === true };
}

async function applySelfRoles(guild, body) {
  if (!Array.isArray(body.panels) || body.panels.length > MAX_SELF_ROLE_PANELS) {
    throw new ApiError(400, `panels: up to ${MAX_SELF_ROLE_PANELS} role messages expected`);
  }
  const previous = await getSelfRolePanels(guild.id);
  const wanted = body.panels.map((panel, index) => selfRolePanel(guild, panel, `panels[${index}]`, previous));
  if (new Set(wanted.filter((panel) => panel.id).map((panel) => panel.id)).size !== wanted.filter((panel) => panel.id).length) {
    throw new ApiError(400, 'panels: the same role message twice');
  }

  // Everything is checked; now the messages follow the settings (posted, edited, moved or removed).
  const look = (panel) => JSON.stringify([panel.title, panel.description, panel.color, panel.buttons]);
  const next = [];
  const stale = [];
  for (const want of wanted) {
    const before = want.id ? previous.find((entry) => entry.id === want.id) : null;
    const { repost, ...panel } = { ...want, id: want.id ?? newSelfRolePanelId(), messageId: before?.messageId ?? null };
    if (!panel.channelId) {
      if (before?.messageId) stale.push(before);
      panel.messageId = null;
    } else if (repost || !before || !panel.messageId || before.channelId !== panel.channelId || look(before) !== look(panel)) {
      const result = await syncSelfRoleMessage(guild, before ?? {}, panel, { repost });
      panel.messageId = result.messageId;
      if (result.stale) stale.push({ channelId: result.stale.channelId, messageId: result.stale.id });
    }
    next.push(panel);
  }
  for (const gone of previous) if (!next.some((panel) => panel.id === gone.id) && gone.messageId) stale.push(gone);

  await saveSelfRolePanels(guild.id, next);
  for (const old of stale) await removeSelfRoleMessage(guild, old);
  return selfRolesView(next, guild);
}

async function listLevelAccounts(client, guild) {
  const prefix = getUserLevelPrefix(guild.id);
  const keys = await client.db.list(prefix);
  const accounts = [];
  for (const key of Array.isArray(keys) ? keys : []) {
    const data = await client.db.get(key);
    if (!data) continue;
    accounts.push({ key, userId: key.slice(prefix.length), level: Number(data.level) || 0, xp: Number(data.xp) || 0, totalXp: Number(data.totalXp) || 0 });
  }
  return accounts;
}

/**
 * Build the panel router, or null when the API is switched off.
 */
export function createPanelRouter(client) {
  const apiKey = (process.env.PANEL_API_KEY ?? '').trim();
  if (!apiKey) return null;
  if (apiKey.length < MIN_KEY_LENGTH) {
    logger.warn(`PANEL_API_KEY is shorter than ${MIN_KEY_LENGTH} characters — panel API stays disabled.`);
    return null;
  }

  const router = express.Router();
  router.use(express.json({ limit: '64kb' }));

  router.use((req, res, next) => {
    const header = req.headers.authorization ?? '';
    const given = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!given || !keysMatch(given, apiKey)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return next();
  });

  // Handlers run in the guild's language so validation messages from services match the server.
  const route = (handler) => async (req, res) => {
    try {
      const guild = req.params.guildId ? client.guilds.cache.get(req.params.guildId) : null;
      if (req.params.guildId && !guild) throw new ApiError(404, 'The bot is not on that server');
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
      const locale = guild ? await getGuildLocale(client, guild.id) : 'en';
      const result = await runWithLocale(locale, () => handler({ req, guild, body }));
      res.json(result ?? { ok: true });
    } catch (error) {
      if (error instanceof ApiError) return res.status(error.status).json({ error: error.message });
      if (error instanceof TitanBotError && error.context?.expected) return res.status(400).json({ error: error.userMessage || error.message });
      logger.error('Panel API error:', error);
      return res.status(500).json({ error: 'Internal error' });
    }
  };

  router.get('/guilds', route(() => ({
    guilds: [...client.guilds.cache.values()].map(guildSummary),
    languages: SUPPORTED_LOCALES.map((locale) => ({ id: locale, name: LOCALE_INFO[locale].name })),
  })));

  router.get('/guilds/:guildId', route(async ({ guild }) => ({
    ...guildSummary(guild),
    language: await getGuildLocale(client, guild.id),
    channels: [...guild.channels.cache.values()]
      .filter((channel) => TEXT_CHANNEL_TYPES.has(channel.type))
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .map((channel) => ({ id: channel.id, name: channel.name, parent: channel.parent?.name ?? null })),
    voiceChannels: [...guild.channels.cache.values()]
      .filter((channel) => channel.type === ChannelType.GuildVoice)
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .map((channel) => ({ id: channel.id, name: channel.name, parent: channel.parent?.name ?? null })),
    categories: [...guild.channels.cache.values()]
      .filter((channel) => channel.type === ChannelType.GuildCategory)
      .sort((a, b) => a.rawPosition - b.rawPosition)
      .map((channel) => ({ id: channel.id, name: channel.name })),
    roles: [...guild.roles.cache.values()]
      .filter((role) => role.id !== guild.id)
      .sort((a, b) => b.position - a.position)
      .map((role) => ({ id: role.id, name: role.name, color: role.hexColor, managed: role.managed, assignable: role.editable && !role.managed })),
    modules: {
      welcome: welcomeView(await getWelcomeConfig(client, guild.id)),
      automod: automodView(await getAutomodConfig(guild.id, { fresh: true })),
      invites: await getInviteConfig(guild.id),
      youtube: (await getFeeds(guild.id)).map(feedView),
      economy: economyView(await getEconomySettings(guild.id), guild, (await getGuildConfig(client, guild.id)).premiumRoleId),
      leveling: levelingView(await getLevelingConfig(client, guild.id)),
      autorole: getAutoRoleSettings(await getWelcomeConfig(client, guild.id)),
      tickets: await ticketsView(client, guild),
      tempvoice: tempVoiceView(await getJoinToCreateConfig(client, guild.id), guild),
      selfroles: selfRolesView(await getSelfRolePanels(guild.id), guild),
      logging: loggingView(await getGuildConfig(client, guild.id)),
    },
  })));

  router.patch('/guilds/:guildId/language', route(async ({ guild, body }) => {
    const locale = normalizeLocale(body.language);
    if (!locale) throw new ApiError(400, `language: one of ${SUPPORTED_LOCALES.join(', ')}`);
    return { language: await setGuildLocale(client, guild.id, locale) };
  }));

  router.patch('/guilds/:guildId/welcome', route(({ guild, body }) => applyWelcome(client, guild, body)));

  router.patch('/guilds/:guildId/autorole', route(({ guild, body }) => applyAutoRole(client, guild, body)));

  // How many members miss a join role, and the progress of a running sync.
  router.get('/guilds/:guildId/autorole/sync', route(({ guild }) => getAutoRoleSyncStatus(client, guild)));

  // Gives the join roles to every member who misses them; the work continues after the answer.
  router.post('/guilds/:guildId/autorole/sync', route(async ({ guild }) => {
    if (await startAutoRoleSync(client, guild)) logger.info(`Panel: auto-role sync started in guild ${guild.id}`);
    return getAutoRoleSyncStatus(client, guild);
  }));

  router.patch('/guilds/:guildId/tickets', route(({ guild, body }) => applyTickets(client, guild, body)));

  router.patch('/guilds/:guildId/tempvoice', route(({ guild, body }) => applyTempVoice(client, guild, body)));

  // Role buttons (like the ProBot role message): the whole list of messages, posted right away.
  router.patch('/guilds/:guildId/selfroles', route(({ guild, body }) => applySelfRoles(guild, body)));

  router.patch('/guilds/:guildId/automod', route(({ guild, body }) => applyAutomod(guild, body)));

  router.patch('/guilds/:guildId/logging', route(({ guild, body }) => applyLogging(client, guild, body)));

  router.patch('/guilds/:guildId/invites', route(async ({ guild, body }) => {
    const config = await updateInviteConfig(guild.id, (data) => {
      if ('enabled' in body) data.enabled = boolean(body.enabled, 'enabled');
      if ('logChannelId' in body) data.logChannelId = requireTextChannel(guild, body.logChannelId, 'logChannelId');
      if ('fakeDays' in body) data.fakeDays = integer(body.fakeDays, 'fakeDays', 0, 365);
    });
    if (config.enabled) await cacheGuildInvites(guild);
    return config;
  }));

  router.patch('/guilds/:guildId/economy', route(({ guild, body }) => applyEconomy(client, guild, body)));

  // Richest accounts plus the totals of the whole server.
  router.get('/guilds/:guildId/economy/top', route(async ({ guild }) => {
    const accounts = await listEconomyAccounts(client, guild);
    accounts.sort((a, b) => (b.wallet + b.bank) - (a.wallet + a.bank));
    return {
      accounts: accounts.length,
      total: accounts.reduce((sum, account) => sum + account.wallet + account.bank, 0),
      top: accounts.slice(0, 25).map(({ userId, wallet, bank }) => ({ userId, name: userName(client, guild, userId), wallet, bank })),
    };
  }));

  router.get('/guilds/:guildId/economy/users/:userId', route(async ({ guild, req }) => {
    const userId = requireUserId(req.params.userId);
    const data = await getEconomyData(client, guild.id, userId, { joint: false });
    return { userId, name: userName(client, guild, userId), wallet: data.wallet, bank: data.bank };
  }));

  // mode "set" writes the given amounts; "add" adds them (negative takes money away, never below 0).
  router.patch('/guilds/:guildId/economy/users/:userId', route(async ({ guild, body, req }) => {
    const userId = requireUserId(req.params.userId);
    const mode = oneOf(body.mode ?? 'set', 'mode', ['set', 'add']);
    const low = mode === 'add' ? -MAX_MONEY : 0;
    const changes = {};
    if ('wallet' in body) changes.wallet = integer(body.wallet, 'wallet', low, MAX_MONEY);
    if ('bank' in body) changes.bank = integer(body.bank, 'bank', low, MAX_MONEY);
    if (!Object.keys(changes).length) throw new ApiError(400, 'wallet or bank: amount expected');

    const data = await getEconomyData(client, guild.id, userId, { joint: false });
    for (const [field, amount] of Object.entries(changes)) {
      data[field] = Math.min(MAX_MONEY * 1000, Math.max(0, mode === 'add' ? (data[field] || 0) + amount : amount));
    }
    if (!(await setEconomyData(client, guild.id, userId, data))) throw new Error('Could not save the balance');
    logger.info(`Panel: balance of ${userId} in guild ${guild.id} changed (${mode})`, changes);
    return { userId, name: userName(client, guild, userId), wallet: data.wallet, bank: data.bank };
  }));

  // Deletes every balance and inventory of the server. Cannot be undone.
  router.post('/guilds/:guildId/economy/reset', route(async ({ guild, body }) => {
    if (body.confirm !== guild.id) throw new ApiError(400, 'confirm: the server ID is required to reset the economy');
    const accounts = await listEconomyAccounts(client, guild);
    for (const account of accounts) await client.db.delete(account.key);
    logger.warn(`Panel: economy of guild ${guild.id} was reset (${accounts.length} accounts removed)`);
    return { removed: accounts.length };
  }));

  router.patch('/guilds/:guildId/leveling', route(({ guild, body }) => applyLeveling(client, guild, body)));

  // Members with the most XP.
  router.get('/guilds/:guildId/leveling/top', route(async ({ guild }) => {
    const accounts = await listLevelAccounts(client, guild);
    accounts.sort((a, b) => b.totalXp - a.totalXp);
    return {
      members: accounts.length,
      top: accounts.slice(0, 25).map(({ userId, level, xp, totalXp }) => ({ userId, name: userName(client, guild, userId), level, xp, totalXp })),
    };
  }));

  router.get('/guilds/:guildId/leveling/users/:userId', route(async ({ guild, req }) => {
    const userId = requireUserId(req.params.userId);
    const data = await getUserLevelData(client, guild.id, userId);
    return { userId, name: userName(client, guild, userId), level: data.level, xp: data.xp, totalXp: data.totalXp, xpNeeded: getXpForLevel(data.level) };
  }));

  // Sets a member's level; XP inside the level starts from 0 unless `xp` is given.
  router.patch('/guilds/:guildId/leveling/users/:userId', route(async ({ guild, body, req }) => {
    const userId = requireUserId(req.params.userId);
    const level = integer(body.level, 'level', 0, MAX_LEVEL);
    const xp = 'xp' in body ? integer(body.xp, 'xp', 0, Math.max(0, getXpForLevel(level) - 1)) : 0;
    const data = await getUserLevelData(client, guild.id, userId);
    await saveUserLevelData(client, guild.id, userId, { ...data, level, xp, totalXp: calculateTotalXp(level, xp) });
    logger.info(`Panel: level of ${userId} in guild ${guild.id} set to ${level}`);
    return { userId, name: userName(client, guild, userId), level, xp, totalXp: calculateTotalXp(level, xp), xpNeeded: getXpForLevel(level) };
  }));

  // Deletes the level and XP of every member of the server. Cannot be undone.
  router.post('/guilds/:guildId/leveling/reset', route(async ({ guild, body }) => {
    if (body.confirm !== guild.id) throw new ApiError(400, 'confirm: the server ID is required to reset the levels');
    const accounts = await listLevelAccounts(client, guild);
    for (const account of accounts) await client.db.delete(account.key);
    logger.warn(`Panel: levels of guild ${guild.id} were reset (${accounts.length} members)`);
    return { removed: accounts.length };
  }));

  router.post('/guilds/:guildId/youtube', route(async ({ guild, body }) => {
    const input = optionalString(body.youtube ?? null, 'youtube', 200);
    if (!input) throw new ApiError(400, 'youtube: channel link, @handle or ID expected');
    const channelId = requireTextChannel(guild, body.channelId ?? null, 'channelId');
    if (!channelId) throw new ApiError(400, 'channelId: required');
    const mentionRole = 'roleId' in body && body.roleId !== null ? String(body.roleId) : null;
    if (mentionRole && !guild.roles.cache.has(mentionRole)) throw new ApiError(400, 'roleId: not a role of this server');

    const channel = await resolveChannel(input);
    const existing = await fetchVideos(channel.id).catch(() => []);
    const feed = {
      id: channel.id,
      name: channel.name || channel.id,
      avatar: channel.avatar,
      channelId,
      roleId: mentionRole,
      includeShorts: 'includeShorts' in body ? boolean(body.includeShorts, 'includeShorts') : true,
      message: optionalString(body.message ?? null, 'message', 500),
      seen: existing.map((video) => video.id),
      addedBy: 'panel',
      addedAt: Date.now(),
    };
    await addFeed(guild.id, feed);
    return feedView(feed);
  }));

  router.patch('/guilds/:guildId/youtube/:feedId', route(async ({ guild, body, req }) => {
    const changes = {};
    if ('channelId' in body) {
      changes.channelId = requireTextChannel(guild, body.channelId, 'channelId');
      if (!changes.channelId) throw new ApiError(400, 'channelId: required');
    }
    if ('roleId' in body) {
      const mentionRole = body.roleId === null ? null : String(body.roleId);
      if (mentionRole && !guild.roles.cache.has(mentionRole)) throw new ApiError(400, 'roleId: not a role of this server');
      changes.roleId = mentionRole;
    }
    if ('includeShorts' in body) changes.includeShorts = boolean(body.includeShorts, 'includeShorts');
    if ('message' in body) changes.message = optionalString(body.message, 'message', 500);
    if ('paused' in body) changes.paused = boolean(body.paused, 'paused');
    const feed = await updateFeed(guild.id, req.params.feedId, changes);
    if (!feed) throw new ApiError(404, 'That YouTube channel is not followed');
    return feedView(feed);
  }));

  // Sample notification with the newest upload; nobody is pinged.
  router.post('/guilds/:guildId/youtube/:feedId/test', route(async ({ guild, req }) => {
    const video = await sendTestNotification(guild, req.params.feedId);
    if (!video) throw new ApiError(404, 'That YouTube channel is not followed');
    return { sent: true, video: { id: video.id, title: video.title, url: video.url } };
  }));

  router.delete('/guilds/:guildId/youtube/:feedId', route(async ({ guild, req }) => {
    const removed = await removeFeed(guild.id, req.params.feedId);
    if (!removed) throw new ApiError(404, 'That YouTube channel is not followed');
    return { removed: feedView(removed) };
  }));

  router.use((req, res) => res.status(404).json({ error: 'Not found' }));
  return router;
}
