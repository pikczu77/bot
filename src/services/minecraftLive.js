// minecraftLive.js — who is on the Minecraft server right now, for the public page pikczu.pl/smp (2026-10-26).
//
// Owner: "smp spoko, niech pokazuje mape, graczy online", then "to jest prywatne smp youtuberow, nie pokazuj whitelisty,
// wersji, adresu serwera, limitu graczy, czatu z gry" and "tworcy na serwerze beda wszyscy w jednej sekcji, a ci co sa
// aktywni niech po prostu beda pierwsi".
//
// A job (every minute) looks at each guild whose whitelist has a connected panel (src/services/minecraftWhitelist.js):
//   - panel state and uptime: Pterodactyl GET /resources
//   - player names: the server list ping through mcsrvstat.us (minecraftService.fetchMinecraftStatus), at the address
//     of a server tracked with /minecraft track on that guild, else the panel's default allocation (GET '', cached)
//   - every whitelisted nick: the server's whitelist.json through the panel file API (at most every few minutes; kept in
//     the store, so a restart or a panel hiccup does not empty the list). Owner (2026-10-30): "na stronie sa tylko tworcy,
//     ktorzy wpisali sie przez bota, niech beda wszyscy z whitelisty". Only the names leave this file, never the UUIDs.
// It keeps since when each player is online (memory; a join line from the chat bridge gives the exact minute) and when
// each player was last seen (store, survives restarts).
// liveView() is what the panel API hands to the website: state, start time, players online with "since" and every
// whitelisted nick (whitelist.json and the nicks signed up through the bot, once each) with "last seen". Never the
// address, version, player limit, Discord names or chat text.

import { guildStore } from '../utils/featureKit.js';
import { logger } from '../utils/logger.js';
import { fetchMinecraftStatus, getMinecraftServers } from './minecraftService.js';
import { chatHistory } from './minecraftChat.js';
import { getWhitelistConfig, panelOf, panelRequest, readWhitelist } from './minecraftWhitelist.js';

/** Timers; tests change them. */
export const liveTiming = { addressMs: 60 * 60_000, whitelistMs: 5 * 60_000 };

// seen: { lower nick: { name, at } }; whitelist: the nicks of the server's whitelist.json, as the server spells them.
const store = guildStore('minecraft-live', { seen: {}, whitelist: [] });
const live = new Map(); // guildId -> { checkedAt, state, startedAt, count, online: Map(lower -> { name, since }), complete }
const addresses = new Map(); // guildId -> { address, at, key }
const whitelistReads = new Map(); // guildId -> { at, key } of the last read of whitelist.json
const busy = new Set();
// A whitelist.json name the website may show (the website checks the same shape again).
const LISTED_NICK_RE = /^[A-Za-z0-9_]{1,16}$/;

export const isConnected = (config) => Boolean(config?.apiKey && config?.serverId && config?.panelUrl);

/** Forget everything in memory (tests). */
export function resetLive() {
  live.clear();
  addresses.clear();
  whitelistReads.clear();
  busy.clear();
}

// "1.2.3.4:25565" from the panel's default allocation; null when the panel only knows 0.0.0.0.
function allocationAddress(details) {
  const list = details?.attributes?.relationships?.allocations?.data ?? [];
  const main = list.map((item) => item?.attributes ?? {}).find((item) => item.is_default) ?? list[0]?.attributes;
  if (!main) return null;
  const host = String(main.ip_alias || main.ip || '').trim();
  const port = Number(main.port) || 25565;
  if (!host || host === '0.0.0.0') return null;
  return `${host}:${port}`;
}

async function serverAddress(guildId, panel, now) {
  const tracked = (await getMinecraftServers(guildId)).find((server) => !server.bedrock);
  if (tracked) return tracked.address;
  const key = `${panel.panelUrl}|${panel.serverId}`;
  const cached = addresses.get(guildId);
  if (cached && cached.key === key && now - cached.at < liveTiming.addressMs) return cached.address;
  const details = await (await panelRequest(panel, 'GET', '')).json();
  const address = allocationAddress(details);
  addresses.set(guildId, { address, at: now, key });
  return address;
}

// Read the server's whitelist.json again when the last read is older than liveTiming.whitelistMs, and keep its nicks
// in the store when they changed. A failed read keeps the nicks read before.
async function refreshWhitelist(guildId, panel, now) {
  const key = `${panel.panelUrl}|${panel.serverId}`;
  const last = whitelistReads.get(guildId);
  if (last && last.key === key && now - last.at < liveTiming.whitelistMs) return;
  whitelistReads.set(guildId, { at: now, key });
  let names;
  try {
    names = (await readWhitelist(panel)).map((entry) => entry.name.trim()).filter((name) => LISTED_NICK_RE.test(name));
  } catch (error) {
    logger.debug(`Minecraft whitelist read failed for ${guildId}: ${error.message}`);
    return;
  }
  const { whitelist = [] } = await store.get(guildId);
  if (whitelist.length === names.length && whitelist.every((name, index) => name === names[index])) return;
  await store.update(guildId, (data) => {
    data.whitelist = names;
  });
}

// The last join line of the chat bridge for this player, when it is newer than their last leave.
function joinedAt(guildId, lower) {
  let at = null;
  for (const item of chatHistory(guildId)) {
    if (String(item.name ?? '').toLowerCase() !== lower) continue;
    if (item.type === 'join') at = item.at;
    else if (item.type === 'leave') at = null;
  }
  return at;
}

/** Look at one guild now. Returns the new state, or null when its panel is not connected. */
export async function pollGuildLive(guildId, now = Date.now()) {
  const config = await getWhitelistConfig(guildId);
  if (!isConnected(config)) {
    live.delete(guildId);
    return null;
  }
  const panel = panelOf(config);
  const before = live.get(guildId) ?? { online: new Map(), complete: false };

  const resources = await (await panelRequest(panel, 'GET', '/resources')).json();
  await refreshWhitelist(guildId, panel, now);
  const attributes = resources?.attributes ?? {};
  const state = attributes.current_state ?? 'offline';
  const uptimeMs = Number(attributes.resources?.uptime) || 0;

  let names = [];
  let count = 0;
  let complete = true;
  if (state === 'running') {
    const address = await serverAddress(guildId, panel, now);
    if (!address) throw new Error('no game address on the panel');
    const status = await fetchMinecraftStatus(address);
    names = status.online ? status.players.names : [];
    count = status.online ? status.players.online : 0;
    // A big server sends only a sample of names; then nobody is marked as gone.
    complete = names.length === count;
  }

  const online = new Map();
  for (const name of names) {
    const lower = name.toLowerCase();
    const known = before.online.get(lower);
    online.set(lower, { name, since: known?.since ?? joinedAt(guildId, lower) ?? now });
  }

  // Last seen: everyone online now, and whoever was online before and is gone now.
  const left = complete && before.complete ? [...before.online.keys()].filter((lower) => !online.has(lower)) : [];
  if (online.size > 0 || left.length > 0) {
    await store.update(guildId, (data) => {
      data.seen = data.seen && typeof data.seen === 'object' ? data.seen : {};
      for (const [lower, player] of online) data.seen[lower] = { name: player.name, at: now };
      for (const lower of left) data.seen[lower] = { name: before.online.get(lower).name, at: now };
    });
  }

  const next = { checkedAt: now, state, startedAt: state === 'running' && uptimeMs > 0 ? now - uptimeMs : null, count, online, complete };
  live.set(guildId, next);
  return next;
}

/** Scheduled job: every guild with a connected panel. One failing guild does not stop the others. */
export async function pollMinecraftLive(client) {
  for (const guild of client.guilds.cache.values()) {
    if (busy.has(guild.id)) continue;
    busy.add(guild.id);
    try {
      await pollGuildLive(guild.id);
    } catch (error) {
      logger.debug(`Minecraft live status failed for ${guild.id}: ${error.message}`);
    } finally {
      busy.delete(guild.id);
    }
  }
}

/**
 * What the website may show: { guildId, checkedAt, state, startedAt, count, players: [...] }.
 * players: online first (longest playing first) as { name, online: true, since }, then the rest of the
 * whitelist (whitelist.json first, then the nicks signed up through the bot; each nick once) as
 * { name, online: false, lastSeen } (most recently seen first, never seen last).
 */
export async function liveView(guildId) {
  const config = await getWhitelistConfig(guildId);
  const now = live.get(guildId) ?? null;
  const { seen = {}, whitelist = [] } = await store.get(guildId);
  const online = [...(now?.online.values() ?? [])].sort((a, b) => a.since - b.since || a.name.localeCompare(b.name));
  const onlineSet = new Set(online.map((player) => player.name.toLowerCase()));

  const rest = new Map();
  const listed = [...(Array.isArray(whitelist) ? whitelist : []), ...Object.values(config.members ?? {}).map((entry) => entry?.name)];
  for (const item of listed) {
    const name = String(item ?? '');
    const lower = name.toLowerCase();
    if (!name || onlineSet.has(lower) || rest.has(lower)) continue;
    rest.set(lower, { name, online: false, lastSeen: seen[lower]?.at ?? null });
  }
  const offline = [...rest.values()].sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0) || a.name.localeCompare(b.name));

  return {
    guildId,
    checkedAt: now?.checkedAt ?? null,
    state: now?.state ?? null,
    startedAt: now?.startedAt ?? null,
    count: now?.count ?? 0,
    players: [
      ...online.map((player) => ({ name: player.name, online: true, since: player.since })),
      ...offline,
    ],
  };
}

/** Every guild with a connected panel (the website shows the first). */
export async function liveServers(client) {
  const servers = [];
  for (const guild of client.guilds.cache.values()) {
    if (isConnected(await getWhitelistConfig(guild.id))) servers.push(await liveView(guild.id));
  }
  return { servers };
}
