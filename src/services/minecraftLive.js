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
// It keeps since when each player is online (memory; a join line from the chat bridge gives the exact minute) and when
// each player was last seen (store, survives restarts).
// liveView() is what the panel API hands to the website: state, start time, players online with "since" and every
// whitelisted nick with "last seen". Never the address, version, player limit, Discord names or chat text.

import { guildStore } from '../utils/featureKit.js';
import { logger } from '../utils/logger.js';
import { fetchMinecraftStatus, getMinecraftServers } from './minecraftService.js';
import { chatHistory } from './minecraftChat.js';
import { getWhitelistConfig, panelOf, panelRequest } from './minecraftWhitelist.js';

/** Timers; tests change them. */
export const liveTiming = { addressMs: 60 * 60_000 };

const store = guildStore('minecraft-live', { seen: {} }); // seen: { lower nick: { name, at } }
const live = new Map(); // guildId -> { checkedAt, state, startedAt, count, online: Map(lower -> { name, since }), complete }
const addresses = new Map(); // guildId -> { address, at, key }
const busy = new Set();

export const isConnected = (config) => Boolean(config?.apiKey && config?.serverId && config?.panelUrl);

/** Forget everything in memory (tests). */
export function resetLive() {
  live.clear();
  addresses.clear();
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
 * whitelist as { name, online: false, lastSeen } (most recently seen first, never seen last).
 */
export async function liveView(guildId) {
  const config = await getWhitelistConfig(guildId);
  const now = live.get(guildId) ?? null;
  const { seen = {} } = await store.get(guildId);
  const online = [...(now?.online.values() ?? [])].sort((a, b) => a.since - b.since || a.name.localeCompare(b.name));
  const onlineSet = new Set(online.map((player) => player.name.toLowerCase()));

  const rest = new Map();
  for (const entry of Object.values(config.members ?? {})) {
    const name = String(entry?.name ?? '');
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
