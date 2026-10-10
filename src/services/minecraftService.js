// minecraftService.js — live Minecraft server status.
//
// A tracked server gets a status card that the bot keeps up to date, plus optional
// "server is online / offline" and "player joined / left" messages.
// Status comes from the public mcsrvstat.us API, so it works with any host.

import { createEmbed } from '../utils/embeds.js';
import { guildStore, httpJson, userError, truncate } from '../utils/featureKit.js';
import { logger } from '../utils/logger.js';
import { enterLocale, t } from '../i18n/index.js';
import { getGuildLocale } from './languageService.js';

const MAX_SERVERS = 3;
const ADDRESS_RE = /^[a-z0-9.-]{1,253}(:\d{1,5})?$/i;

const store = guildStore('minecraft', { servers: [] });

export const getMinecraftServers = async (guildId) => (await store.get(guildId)).servers;

export function normalizeAddress(input) {
  const address = String(input ?? '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '');
  if (!ADDRESS_RE.test(address)) {
    throw userError(t('That does not look like a server address. Use something like `play.example.com` or `1.2.3.4:25565`.'));
  }
  return address;
}

/** Normalised status: { online, version, motd, players: { online, max, names }, host } */
export async function fetchMinecraftStatus(address, { bedrock = false } = {}) {
  const data = await httpJson(`https://api.mcsrvstat.us/${bedrock ? 'bedrock/' : ''}3/${encodeURIComponent(address)}`, { timeoutMs: 12_000 });
  return {
    online: Boolean(data.online),
    version: data.version ?? null,
    software: data.software ?? null,
    motd: (data.motd?.clean ?? [])
      .map((line) => line.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim())
      .filter(Boolean)
      .join('\n'),
    host: data.hostname ?? data.ip ?? address,
    players: {
      online: data.players?.online ?? 0,
      max: data.players?.max ?? 0,
      names: (data.players?.list ?? []).map((player) => player.name).filter(Boolean),
    },
  };
}

export function skinHead(name) {
  return `https://mc-heads.net/avatar/${encodeURIComponent(name)}/64`;
}

export function buildStatusEmbed(server, status) {
  const title = `⛏️ ${server.name || server.address}`;
  if (!status?.online) {
    return createEmbed({
      title,
      description: [`🔴 **${t('Offline')}**`, `\`${server.address}\``].join('\n'),
      color: 'error',
      footer: t('Updated'),
      timestamp: true,
    });
  }

  const names = status.players.names;
  const fields = [
    { name: t('Players'), value: `**${status.players.online}** / ${status.players.max}`, inline: true },
    { name: t('Version'), value: truncate(status.version || '—', 100), inline: true },
  ];
  if (names.length > 0) {
    const shown = names.slice(0, 30).map((name) => `\`${name}\``).join(' ');
    fields.push({ name: t('Online now'), value: names.length > 30 ? `${shown} …` : shown, inline: false });
  }

  return createEmbed({
    title,
    description: [`🟢 **${t('Online')}**`, `\`${server.address}\``, status.motd ? `\n${truncate(status.motd, 300)}` : null].filter(Boolean).join('\n'),
    color: 'success',
    fields,
    thumbnail: `https://api.mcsrvstat.us/icon/${encodeURIComponent(server.address)}`,
    footer: t('Updated'),
    timestamp: true,
  });
}

export async function trackServer(guildId, server) {
  return store.update(guildId, (data) => {
    if (data.servers.some((entry) => entry.address === server.address)) {
      throw userError(t`\`${server.address}\` is already tracked.`);
    }
    if (data.servers.length >= MAX_SERVERS) {
      throw userError(t`You can track up to ${MAX_SERVERS} Minecraft servers.`);
    }
    data.servers.push(server);
  });
}

export async function untrackServer(guildId, address) {
  let removed = null;
  await store.update(guildId, (data) => {
    const index = data.servers.findIndex((entry) => entry.address === address);
    if (index !== -1) [removed] = data.servers.splice(index, 1);
  });
  return removed;
}

/** Diff two player lists. Pure: returns { joined, left }. */
export function diffPlayers(before = [], after = []) {
  const previous = new Set(before);
  const current = new Set(after);
  return {
    joined: [...current].filter((name) => !previous.has(name)),
    left: [...previous].filter((name) => !current.has(name)),
  };
}

async function announce(channel, { title, description, color, thumbnail = null, roleId = null }) {
  if (!channel?.isTextBased?.()) return;
  await channel.send({
    content: roleId ? `<@&${roleId}>` : undefined,
    embeds: [createEmbed({ title, description, color, thumbnail, footer: false, timestamp: true })],
    allowedMentions: { roles: roleId ? [roleId] : [] },
  }).catch((error) => logger.debug(`Minecraft announcement failed: ${error.message}`));
}

async function refreshServer(guild, server) {
  let status;
  try {
    status = await fetchMinecraftStatus(server.address, { bedrock: server.bedrock });
  } catch (error) {
    logger.debug(`Minecraft status failed for ${server.address}: ${error.message}`);
    return false;
  }

  const channel = guild.channels.cache.get(server.channelId);
  const last = server.last ?? null;
  const label = `**${server.name || server.address}**`;

  if (last && channel) {
    if (status.online && !last.online) {
      await announce(channel, { title: t('🟢 Server online'), description: t`${label} is up and ready to play.`, color: 'success', roleId: server.roleId });
    } else if (!status.online && last.online) {
      await announce(channel, { title: t('🔴 Server offline'), description: t`${label} is no longer reachable.`, color: 'error' });
    }

    // The player list is only a sample on big servers, so only trust it when it is complete.
    const listComplete = status.players.names.length === status.players.online && (last.names?.length ?? 0) === (last.count ?? 0);
    if (server.announcePlayers && status.online && last.online && listComplete) {
      const { joined, left } = diffPlayers(last.names, status.players.names);
      for (const name of joined.slice(0, 5)) {
        await announce(channel, { title: t('🟢 Player joined'), description: t`**${name}** joined ${label}.`, color: 'success', thumbnail: skinHead(name) });
      }
      for (const name of left.slice(0, 5)) {
        await announce(channel, { title: t('🔴 Player left'), description: t`**${name}** left ${label}.`, color: 'error', thumbnail: skinHead(name) });
      }
    }
  }

  server.last = { online: status.online, count: status.players.online, names: status.players.names };

  if (channel?.isTextBased?.()) {
    const payload = { embeds: [buildStatusEmbed(server, status)] };
    const existing = server.messageId ? await channel.messages.fetch(server.messageId).catch(() => null) : null;
    if (existing) {
      await existing.edit(payload).catch(() => {});
    } else {
      const sent = await channel.send(payload).catch(() => null);
      server.messageId = sent?.id ?? null;
    }
  }
  return true;
}

/** Scheduled job: refresh every tracked server. */
export async function refreshMinecraftServers(client) {
  for (const guild of client.guilds.cache.values()) {
    const data = await store.get(guild.id);
    if (data.servers.length === 0) continue;
    enterLocale(await getGuildLocale(client, guild.id));
    let changed = false;
    for (const server of data.servers) {
      changed = (await refreshServer(guild, server)) || changed;
    }
    if (changed) await store.set(guild.id, data);
  }
}

/** Refresh one guild right now (after /minecraft track). */
export async function refreshGuildMinecraft(guild) {
  const data = await store.get(guild.id);
  for (const server of data.servers) await refreshServer(guild, server);
  await store.set(guild.id, data);
}
