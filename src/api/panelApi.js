// panelApi.js — HTTP API for a web panel (pikczu.pl/bot) to read and change
// module settings: language, welcome, auto-role, automod, invites, YouTube.
//
// Disabled unless PANEL_API_KEY is set. Every request must send
//   Authorization: Bearer <PANEL_API_KEY>
// The key is a shared secret between the bot and the panel's server — it must
// never reach a browser.

import crypto from 'node:crypto';
import express from 'express';
import { ChannelType } from 'discord.js';
import { TitanBotError } from '../utils/errorHandler.js';
import { logger } from '../utils/logger.js';
import { LOCALE_INFO, SUPPORTED_LOCALES, normalizeLocale, runWithLocale } from '../i18n/index.js';
import { getGuildLocale, setGuildLocale } from '../services/languageService.js';
import { getWelcomeConfig, updateWelcomeConfig } from '../utils/database.js';
import { ACTIONS, RULES, getAutomodConfig, updateAutomodConfig } from '../services/automodService.js';
import { cacheGuildInvites, getInviteConfig, updateInviteConfig } from '../services/inviteService.js';
import { addFeed, fetchVideos, getFeeds, removeFeed, resolveChannel, sendTestNotification, updateFeed } from '../services/notifications/youtube.js';

const MIN_KEY_LENGTH = 24;
const SNOWFLAKE_RE = /^\d{17,20}$/;
const TEXT_CHANNEL_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

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

function requireRole(guild, roleId, field) {
  if (roleId === null) return null;
  const role = SNOWFLAKE_RE.test(String(roleId)) ? guild.roles.cache.get(String(roleId)) : null;
  if (!role || role.id === guild.id || role.managed) throw new ApiError(400, `${field}: not an assignable role of this server`);
  return role.id;
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

function welcomeView(config) {
  return {
    enabled: config.enabled,
    channelId: config.channelId ?? null,
    message: config.welcomeMessage ?? '',
    ping: config.welcomePing,
    image: config.welcomeImage ?? null,
    goodbyeEnabled: config.goodbyeEnabled,
    goodbyeChannelId: config.goodbyeChannelId ?? null,
    goodbyeMessage: config.leaveMessage ?? '',
    autoRoleId: config.roleIds?.[0] ?? null,
  };
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
  if ('enabled' in body) updates.enabled = boolean(body.enabled, 'enabled');
  if ('channelId' in body) updates.channelId = requireTextChannel(guild, body.channelId, 'channelId');
  if ('message' in body) updates.welcomeMessage = optionalString(body.message, 'message', 2000) ?? '';
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
  if (updates.enabled === true || updates.goodbyeEnabled === true) {
    const current = await getWelcomeConfig(client, guild.id);
    if (updates.enabled === true && !(updates.channelId ?? current.channelId)) throw new ApiError(400, 'channelId: choose a channel before enabling welcome messages');
    if (updates.goodbyeEnabled === true && !(updates.goodbyeChannelId ?? current.goodbyeChannelId)) throw new ApiError(400, 'goodbyeChannelId: choose a channel before enabling goodbye messages');
  }
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
    roles: [...guild.roles.cache.values()]
      .filter((role) => role.id !== guild.id)
      .sort((a, b) => b.position - a.position)
      .map((role) => ({ id: role.id, name: role.name, color: role.hexColor, managed: role.managed, assignable: role.editable && !role.managed })),
    modules: {
      welcome: welcomeView(await getWelcomeConfig(client, guild.id)),
      automod: automodView(await getAutomodConfig(guild.id, { fresh: true })),
      invites: await getInviteConfig(guild.id),
      youtube: (await getFeeds(guild.id)).map(feedView),
    },
  })));

  router.patch('/guilds/:guildId/language', route(async ({ guild, body }) => {
    const locale = normalizeLocale(body.language);
    if (!locale) throw new ApiError(400, `language: one of ${SUPPORTED_LOCALES.join(', ')}`);
    return { language: await setGuildLocale(client, guild.id, locale) };
  }));

  router.patch('/guilds/:guildId/welcome', route(({ guild, body }) => applyWelcome(client, guild, body)));

  router.patch('/guilds/:guildId/automod', route(({ guild, body }) => applyAutomod(guild, body)));

  router.patch('/guilds/:guildId/invites', route(async ({ guild, body }) => {
    const config = await updateInviteConfig(guild.id, (data) => {
      if ('enabled' in body) data.enabled = boolean(body.enabled, 'enabled');
      if ('logChannelId' in body) data.logChannelId = requireTextChannel(guild, body.logChannelId, 'logChannelId');
      if ('fakeDays' in body) data.fakeDays = integer(body.fakeDays, 'fakeDays', 0, 365);
    });
    if (config.enabled) await cacheGuildInvites(guild);
    return config;
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
