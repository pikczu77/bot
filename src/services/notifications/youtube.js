// youtube.js — "new video" notifications.
//
// New uploads come from YouTube's public RSS feed (no API key, no quota). Channel
// details (avatar, subscriber count) come from the YouTube Data API when
// YOUTUBE_API_KEY is set, otherwise from the public channel page.

import { EmbedBuilder } from 'discord.js';
import { guildStore, httpGet, httpJson, httpText, userError } from '../../utils/featureKit.js';
import { logger } from '../../utils/logger.js';
import { fmtNumber, t, trAny, enterLocale, N_ } from '../../i18n/index.js';
import { getGuildLocale } from '../languageService.js';

export const YOUTUBE_RED = 0xff0000;
const YOUTUBE_ICON = 'https://www.gstatic.com/youtube/img/branding/favicon/favicon_144x144.png';
const CHANNEL_ID_RE = /UC[\w-]{22}/;
const MAX_FEEDS_PER_GUILD = 25;
const SEEN_LIMIT = 40;
const CHANNEL_CACHE_MS = 6 * 60 * 60 * 1000;
// Skips the EU cookie-consent interstitial so the channel page HTML is returned.
const CONSENT_COOKIE = 'CONSENT=YES+cb.20210328-17-p0.en+FX+667; SOCS=CAI';

export const DEFAULT_MESSAGE = N_('🔔 **{channel}** uploaded a new video! {role} {url}');

const store = guildStore('notify:youtube', { feeds: [] });
const channelCache = new Map();

function decodeXml(text = '') {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

/** Parse YouTube's Atom feed into [{ id, title, url, published, author }] (newest first). */
export function parseFeed(xml) {
  const entries = [];
  for (const [, body] of String(xml).matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const id = body.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
    if (!id) continue;
    entries.push({
      id,
      title: decodeXml(body.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''),
      url: `https://www.youtube.com/watch?v=${id}`,
      published: body.match(/<published>([^<]+)<\/published>/)?.[1] ?? null,
      author: decodeXml(body.match(/<author>\s*<name>([\s\S]*?)<\/name>/)?.[1] ?? ''),
    });
  }
  return entries;
}

/** "5.86M subscribers" -> 5860000, "12,345" -> 12345. Returns null when unknown. */
export function parseSubscriberText(text) {
  const match = String(text ?? '').replace(/ /g, ' ').match(/([\d.,]+)\s*([KMB])?/i);
  if (!match) return null;
  const hasSuffix = Boolean(match[2]);
  const number = Number(hasSuffix ? match[1].replace(',', '.') : match[1].replace(/[.,]/g, ''));
  if (!Number.isFinite(number)) return null;
  const multiplier = { K: 1e3, M: 1e6, B: 1e9 }[match[2]?.toUpperCase()] ?? 1;
  return Math.round(number * multiplier);
}

/** Pull channel details out of a channel page's HTML. */
export function parseChannelPage(html) {
  const page = String(html);
  const id = page.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/)?.[1]
    ?? page.match(/"externalId":"(UC[\w-]{22})"/)?.[1]
    ?? page.match(/"channelId":"(UC[\w-]{22})"/)?.[1]
    ?? null;
  const name = decodeXml(page.match(/<meta property="og:title" content="([^"]*)"/)?.[1] ?? '');
  const avatar = page.match(/<meta property="og:image" content="([^"]*)"/)?.[1] ?? null;
  const subscriberText = page.match(/"subscriberCountText":\{.{0,300}?"simpleText":"([^"]+)"/)?.[1]
    ?? page.match(/"content":"([\d.,]+[KMB]?) subscribers?"/)?.[1]
    ?? null;
  return { id, name, avatar: avatar ? decodeXml(avatar) : null, subscribers: parseSubscriberText(subscriberText) };
}

function channelPageUrl(input) {
  const value = input.trim();
  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value);
    if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(url.hostname)) {
      throw userError(t('That is not a YouTube link. Paste a channel link, an @handle or a channel ID.'));
    }
    return url.toString();
  }
  const id = value.match(CHANNEL_ID_RE)?.[0];
  if (id && id === value) return `https://www.youtube.com/channel/${id}`;
  return `https://www.youtube.com/@${encodeURIComponent(value.replace(/^@/, ''))}`;
}

async function fetchChannelFromApi(channelId) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return null;
  const data = await httpJson(
    `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelId}&key=${encodeURIComponent(key)}`,
  );
  const item = data.items?.[0];
  if (!item) return null;
  const thumbs = item.snippet?.thumbnails ?? {};
  return {
    id: channelId,
    name: item.snippet?.title ?? '',
    avatar: thumbs.high?.url ?? thumbs.medium?.url ?? thumbs.default?.url ?? null,
    subscribers: item.statistics?.hiddenSubscriberCount ? null : Number(item.statistics?.subscriberCount) || null,
  };
}

/** Channel details by ID, cached for a few hours. Never throws — returns what it could find. */
export async function getChannelInfo(channelId, { fresh = false } = {}) {
  const cached = channelCache.get(channelId);
  if (!fresh && cached && Date.now() - cached.at < CHANNEL_CACHE_MS) return cached.info;

  let info = null;
  try {
    info = await fetchChannelFromApi(channelId);
  } catch (error) {
    logger.debug(`YouTube API lookup failed for ${channelId}: ${error.message}`);
  }

  if (!info) {
    try {
      const html = await httpText(`https://www.youtube.com/channel/${channelId}?hl=en`, { headers: { Cookie: CONSENT_COOKIE } });
      info = { ...parseChannelPage(html), id: channelId };
    } catch (error) {
      logger.debug(`YouTube page lookup failed for ${channelId}: ${error.message}`);
    }
  }

  info ??= cached?.info ?? { id: channelId, name: '', avatar: null, subscribers: null };
  channelCache.set(channelId, { at: Date.now(), info });
  return info;
}

/** Turn whatever the admin typed (link, @handle, ID) into channel details. */
export async function resolveChannel(input) {
  const url = channelPageUrl(input);
  let parsed;
  try {
    const separator = url.includes('?') ? '&' : '?';
    parsed = parseChannelPage(await httpText(`${url}${separator}hl=en`, { headers: { Cookie: CONSENT_COOKIE } }));
  } catch (error) {
    throw userError(t('I could not open that YouTube channel. Check the link or @handle and try again.'));
  }
  if (!parsed.id) {
    throw userError(t('I could not find a YouTube channel there. Paste a channel link, an @handle or a channel ID.'));
  }
  const info = (await getChannelInfo(parsed.id, { fresh: true })) ?? parsed;
  return {
    id: parsed.id,
    name: info.name || parsed.name,
    avatar: info.avatar || parsed.avatar,
    subscribers: info.subscribers ?? parsed.subscribers,
  };
}

export async function fetchVideos(channelId) {
  const xml = await httpText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  return parseFeed(xml);
}

/** Shorts answer 200 on /shorts/<id>; regular videos redirect to /watch. */
async function isShort(videoId) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(`https://www.youtube.com/shorts/${videoId}`, {
      method: 'HEAD',
      redirect: 'manual',
      signal: controller.signal,
      headers: { Cookie: CONSENT_COOKIE },
    });
    clearTimeout(timer);
    return response.status === 200;
  } catch {
    return false;
  }
}

async function bestThumbnail(videoId) {
  const maxres = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
  try {
    const response = await httpGet(maxres, { timeoutMs: 6000 });
    if (response.ok) return maxres;
  } catch {
    // fall through to the always-available size
  }
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

/**
 * Build the notification message: a ping line plus a red card with the channel,
 * the video title, the subscriber count and the big thumbnail.
 */
export async function buildNotification(feed, video, channel = {}) {
  const name = channel.name || feed.name || video.author || 'YouTube';
  const avatar = channel.avatar || feed.avatar || null;
  const channelUrl = `https://www.youtube.com/channel/${feed.id}`;
  const template = feed.message?.trim() ? feed.message : trAny(DEFAULT_MESSAGE);

  const content = template
    .replace(/\{channel\}/g, name)
    .replace(/\{title\}/g, video.title)
    // <...> stops Discord adding its own preview next to our card.
    .replace(/\{url\}/g, `<${video.url}>`)
    .replace(/\{role\}/g, feed.roleId ? `<@&${feed.roleId}>` : '')
    .replace(/ {2,}/g, ' ')
    .trim();

  const embed = new EmbedBuilder()
    .setColor(YOUTUBE_RED)
    .setAuthor({ name, url: channelUrl, ...(avatar ? { iconURL: avatar } : {}) })
    .setTitle(video.title || t('New video'))
    .setURL(video.url)
    .setImage(await bestThumbnail(video.id))
    .setFooter({ text: t('Published'), iconURL: YOUTUBE_ICON });

  if (avatar) embed.setThumbnail(avatar);
  if (channel.subscribers) {
    embed.addFields({ name: t('Subscribers'), value: fmtNumber(channel.subscribers) });
  }
  const published = video.published ? new Date(video.published) : null;
  if (published && !Number.isNaN(published.getTime())) embed.setTimestamp(published);

  return {
    content: content.slice(0, 2000),
    embeds: [embed],
    allowedMentions: { roles: feed.roleId ? [feed.roleId] : [], parse: [] },
  };
}

export async function getFeeds(guildId) {
  return (await store.get(guildId)).feeds;
}

export async function addFeed(guildId, feed) {
  return store.update(guildId, (data) => {
    if (data.feeds.some((entry) => entry.id === feed.id)) {
      throw userError(t`**${feed.name}** is already on the list. Remove it first to change its settings.`);
    }
    if (data.feeds.length >= MAX_FEEDS_PER_GUILD) {
      throw userError(t`You can follow up to ${MAX_FEEDS_PER_GUILD} YouTube channels per server.`);
    }
    data.feeds.push(feed);
  });
}

export async function removeFeed(guildId, channelId) {
  let removed = null;
  await store.update(guildId, (data) => {
    const index = data.feeds.findIndex((entry) => entry.id === channelId);
    if (index !== -1) [removed] = data.feeds.splice(index, 1);
  });
  return removed;
}

/**
 * Change a followed channel's settings (notification channel, role, message, pause).
 * Resuming a paused feed marks the current uploads as seen: videos published
 * during the pause are not news any more.
 */
export async function updateFeed(guildId, channelId, changes) {
  const current = (await getFeeds(guildId)).find((entry) => entry.id === channelId);
  if (!current) return null;
  const missed = current.paused === true && changes.paused === false
    ? (await fetchVideos(channelId).catch(() => [])).map((video) => video.id)
    : [];

  let updated = null;
  await store.update(guildId, (data) => {
    const feed = data.feeds.find((entry) => entry.id === channelId);
    if (!feed) return;
    Object.assign(feed, changes);
    if (feed.paused !== true) delete feed.paused;
    if (missed.length > 0) feed.seen = [...new Set([...(feed.seen ?? []), ...missed])].slice(-SEEN_LIMIT);
    updated = feed;
  });
  return updated;
}

/** Send the newest upload of a followed channel as a sample notification (nobody is pinged). */
export async function sendTestNotification(guild, channelId) {
  const feed = (await getFeeds(guild.id)).find((entry) => entry.id === channelId);
  if (!feed) return null;
  const channel = guild.channels.cache.get(feed.channelId);
  if (!channel?.isTextBased?.()) throw userError(t`The notification channel no longer exists.`);
  const [video] = await fetchVideos(feed.id);
  if (!video) throw userError(t`**${feed.name}** has no videos to show yet.`);
  const payload = await buildNotification(feed, video, await getChannelInfo(feed.id));
  await channel.send({ ...payload, allowedMentions: { parse: [] } });
  return video;
}

async function checkGuildFeeds(client, guild, videoCache) {
  const data = await store.get(guild.id);
  if (data.feeds.length === 0) return;
  let changed = false;

  for (const feed of data.feeds) {
    if (feed.paused) continue;
    try {
      if (!videoCache.has(feed.id)) videoCache.set(feed.id, await fetchVideos(feed.id));
      const videos = videoCache.get(feed.id);
      feed.seen ??= [];
      const fresh = videos.filter((video) => !feed.seen.includes(video.id)).reverse();
      if (fresh.length === 0) continue;

      const channel = guild.channels.cache.get(feed.channelId);
      for (const video of fresh) {
        feed.seen.push(video.id);
        changed = true;
        if (!channel?.isTextBased?.()) continue;
        // Uploads older than a day are backlog (e.g. after downtime), not news.
        if (video.published && Date.now() - new Date(video.published).getTime() > 24 * 60 * 60 * 1000) continue;
        if (feed.includeShorts === false && await isShort(video.id)) continue;

        const payload = await buildNotification(feed, video, await getChannelInfo(feed.id));
        await channel.send(payload).catch((error) => {
          logger.warn(`YouTube notification for ${feed.id} could not be sent in guild ${guild.id}: ${error.message}`);
        });
      }
      feed.seen = feed.seen.slice(-SEEN_LIMIT);
    } catch (error) {
      logger.debug(`YouTube check failed for ${feed.id} in guild ${guild.id}: ${error.message}`);
    }
  }

  if (changed) await store.set(guild.id, data);
}

/** Scheduled job: look for new uploads in every guild. */
export async function checkYoutubeFeeds(client) {
  const videoCache = new Map();
  for (const guild of client.guilds.cache.values()) {
    enterLocale(await getGuildLocale(client, guild.id));
    await checkGuildFeeds(client, guild, videoCache);
  }
}
