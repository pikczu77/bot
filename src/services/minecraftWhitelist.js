// minecraftWhitelist.js — members write their Minecraft nick in one channel and the bot
// puts it on the server whitelist through the hosting panel's client API (Pterodactyl,
// e.g. MatHost at https://ptero.mathost.eu). No plugin and no RCON port are needed.
//
// Server running: console command `whitelist add <nick>`, then whitelist.json is read back
// to confirm (an online-mode server refuses nicks without a Minecraft account).
// Server stopped: whitelist.json is edited directly (UUID from Mojang on online-mode
// servers, the offline-mode UUID otherwise).
//
// One nick per member: a new nick replaces the old one. The panel API key is stored with
// the guild settings, is only typed into a private form, and is never shown again.

import { createHash } from 'node:crypto';
import { createEmbed, successEmbed } from '../utils/embeds.js';
import { guildStore, httpGet, userError } from '../utils/featureKit.js';
import { Mutex } from '../utils/mutex.js';
import { logger } from '../utils/logger.js';
import { t } from '../i18n/index.js';

export const DEFAULT_PANEL_URL = 'https://ptero.mathost.eu';
export const NICK_RE = /^[A-Za-z0-9_]{3,16}$/;
const WHITELIST_FILE = '/whitelist.json';
const PROPERTIES_FILE = '/server.properties';
const ANSWER_LIFETIME_MS = 20_000;

/** Waits and the per-member pause between nicks; tests set them to 0. */
export const whitelistTiming = { confirmDelayMs: 1500, confirmAttempts: 4, memberCooldownMs: 10_000 };

const store = guildStore('minecraft-whitelist', {
  enabled: false,
  channelId: null,
  roleId: null,
  removeOnLeave: true,
  panelUrl: DEFAULT_PANEL_URL,
  serverId: null,
  apiKey: null,
  members: {},
});

const lastTry = new Map();

export const getWhitelistConfig = (guildId) => store.get(guildId);
export const updateWhitelistConfig = (guildId, mutate) => store.update(guildId, mutate);

const panelOf = (config) => ({ panelUrl: config.panelUrl, serverId: config.serverId, apiKey: config.apiKey });

// --- input checks -------------------------------------------------------------------

/** "ptero.mathost.eu" or "https://ptero.mathost.eu/server/abc" -> "https://ptero.mathost.eu". */
export function normalizePanelUrl(input) {
  let url;
  try {
    const text = String(input ?? '').trim();
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    url = null;
  }
  const host = url?.hostname.toLowerCase() ?? '';
  const ipLiteral = /^[\d.]+$/.test(host) || host.includes(':') || host.startsWith('[');
  if (!url || url.protocol !== 'https:' || !host.includes('.') || ipLiteral || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw userError(t('The panel address must be an https address with a domain name, for example `https://ptero.mathost.eu`.'));
  }
  return url.origin;
}

/** Server ID from the panel link (`.../server/1a2b3c4d`) or typed on its own. */
export function normalizeServerId(input) {
  const text = String(input ?? '').trim();
  const id = (text.match(/\/server\/([a-z0-9-]+)/i)?.[1] ?? text).toLowerCase();
  if (!/^[a-z0-9-]{6,36}$/.test(id)) {
    throw userError(t('That is not a server ID. Copy it from the panel link: the part after `/server/`.'));
  }
  return id;
}

/** The nick a member typed, or null. Accepts the nick on its own, optionally in `backticks`. */
export function parseNick(content) {
  const text = String(content ?? '').trim().replace(/^`+|`+$/g, '').trim();
  return NICK_RE.test(text) ? text : null;
}

// --- Pterodactyl client API ----------------------------------------------------------

export class PanelError extends Error {
  constructor(status, detail) {
    super(`panel answered ${status || 'nothing'}: ${String(detail).slice(0, 200)}`);
    this.name = 'PanelError';
    this.status = status;
  }
}

/** What the member or admin sees for a panel failure. */
export function panelErrorText(error) {
  switch (error?.status) {
    case 401:
    case 403:
      return t('The panel refused the API key. Create a new client key in the panel (Account > API Credentials) and run `/minecraft whitelista ustaw` again.');
    case 404:
      return t('The panel does not know this server. Check the server ID in `/minecraft whitelista ustaw`.');
    case 409:
    case 502:
      return t('The Minecraft server is not running. Try again when it is online.');
    case 429:
      return t('The panel is getting too many requests. Try again in a minute.');
    default:
      return t('The server panel did not answer. Try again in a moment.');
  }
}

async function panelRequest(panel, method, path, { json, text, timeoutMs = 10_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { Accept: 'application/json', Authorization: `Bearer ${panel.apiKey}` };
    if (json !== undefined) headers['Content-Type'] = 'application/json';
    if (text !== undefined) headers['Content-Type'] = 'text/plain';
    const response = await fetch(`${panel.panelUrl}/api/client/servers/${encodeURIComponent(panel.serverId)}${path}`, {
      method,
      headers,
      body: json !== undefined ? JSON.stringify(json) : text,
      signal: controller.signal,
      redirect: 'error',
    });
    if (!response.ok) throw new PanelError(response.status, await response.text().catch(() => ''));
    return response;
  } catch (error) {
    if (error instanceof PanelError) throw error;
    throw new PanelError(0, error?.name === 'AbortError' ? 'timeout' : error?.message);
  } finally {
    clearTimeout(timer);
  }
}

export async function getServerName(panel) {
  const data = await (await panelRequest(panel, 'GET', '')).json();
  return data?.attributes?.name ?? null;
}

/** "running", "offline", "starting" or "stopping". */
export async function getServerState(panel) {
  const data = await (await panelRequest(panel, 'GET', '/resources')).json();
  return data?.attributes?.current_state ?? 'offline';
}

async function readFile(panel, file) {
  try {
    return await (await panelRequest(panel, 'GET', `/files/contents?file=${encodeURIComponent(file)}`)).text();
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

const writeFile = (panel, file, content) => panelRequest(panel, 'POST', `/files/write?file=${encodeURIComponent(file)}`, { text: content });
const sendCommand = (panel, command) => panelRequest(panel, 'POST', '/command', { json: { command } });

// --- whitelist.json and server.properties -------------------------------------------

export function parseWhitelist(text) {
  if (text == null || !text.trim()) return [];
  let list;
  try {
    list = JSON.parse(text);
  } catch {
    list = null;
  }
  if (!Array.isArray(list)) throw userError(t('The whitelist.json file on the server is damaged. Fix it in the panel first.'));
  return list.filter((entry) => entry && typeof entry.name === 'string');
}

export function parseProperties(text) {
  const properties = {};
  for (const line of String(text ?? '').split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=\s][^=]*?)\s*=\s*(.*?)\s*$/);
    if (match) properties[match[1]] = match[2];
  }
  return properties;
}

const findEntry = (list, nick) => list.find((entry) => entry.name.toLowerCase() === nick.toLowerCase()) ?? null;
const readWhitelist = async (panel) => parseWhitelist(await readFile(panel, WHITELIST_FILE));
const dashed = (hex) => hex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
const pause = (ms) => (ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve());

/** UUID an offline-mode server gives a nick (Java's UUID.nameUUIDFromBytes). */
export function offlineUuid(nick) {
  const bytes = createHash('md5').update(`OfflinePlayer:${nick}`).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x30;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return dashed(bytes.toString('hex'));
}

/** { uuid, name } of a Minecraft account, or null when no account has that nick. */
export async function mojangProfile(nick) {
  const response = await httpGet(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(nick)}`, { timeoutMs: 8000 });
  if (response.status === 204 || response.status === 404) return null;
  if (!response.ok) throw new PanelError(response.status, 'mojang');
  const data = await response.json();
  return data?.id ? { uuid: dashed(data.id), name: data.name } : null;
}

/** Server facts shown after setup: { name, state, onlineMode, whitelistOn } (null = unknown). */
export async function checkPanel(panel) {
  const name = await getServerName(panel);
  const state = await getServerState(panel);
  const properties = await readFile(panel, PROPERTIES_FILE).then(parseProperties).catch(() => null);
  return {
    name,
    state,
    onlineMode: properties ? properties['online-mode'] !== 'false' : null,
    whitelistOn: properties && 'white-list' in properties ? properties['white-list'] === 'true' : null,
  };
}

const busyError = () => userError(t('The Minecraft server is starting or stopping. Try again in a minute.'));

/** Put a nick on the whitelist. Returns { name, already } with the nick as the server spells it. */
export async function addToWhitelist(panel, nick) {
  const state = await getServerState(panel);
  const existing = findEntry(await readWhitelist(panel), nick);
  if (existing) return { name: existing.name, already: true };

  if (state === 'running') {
    await sendCommand(panel, `whitelist add ${nick}`);
    for (let attempt = 0; attempt < whitelistTiming.confirmAttempts; attempt += 1) {
      await pause(whitelistTiming.confirmDelayMs);
      const added = findEntry(await readWhitelist(panel), nick);
      if (added) return { name: added.name, already: false };
    }
    throw userError(t`The server did not add \`${nick}\`. Check the spelling: this server needs the nick of a Minecraft account.`);
  }
  if (state !== 'offline') throw busyError();

  const properties = parseProperties(await readFile(panel, PROPERTIES_FILE));
  let entry = { uuid: offlineUuid(nick), name: nick };
  if (properties['online-mode'] !== 'false') {
    entry = await mojangProfile(nick);
    if (!entry) throw userError(t`No Minecraft account is called \`${nick}\`. Check the spelling.`);
  }
  // Read again right before writing, in case the server started in the meantime.
  const list = await readWhitelist(panel);
  const raced = findEntry(list, entry.name);
  if (raced) return { name: raced.name, already: true };
  await writeFile(panel, WHITELIST_FILE, `${JSON.stringify([...list, entry], null, 2)}\n`);
  return { name: entry.name, already: false };
}

/** Take a nick off the whitelist. Returns false when it was not there. */
export async function removeFromWhitelist(panel, nick) {
  const state = await getServerState(panel);
  const list = await readWhitelist(panel);
  const entry = findEntry(list, nick);
  if (!entry) return false;

  if (state === 'running') {
    // Names come from the server's file; never pass an unusual one to the console.
    if (!NICK_RE.test(entry.name)) throw userError(t('Remove this nick in the server console.'));
    await sendCommand(panel, `whitelist remove ${entry.name}`);
    return true;
  }
  if (state !== 'offline') throw busyError();
  await writeFile(panel, WHITELIST_FILE, `${JSON.stringify(list.filter((item) => item !== entry), null, 2)}\n`);
  return true;
}

export async function countWhitelist(panel) {
  return (await readWhitelist(panel)).length;
}

// --- members -------------------------------------------------------------------------

const lockKey = (guildId) => `minecraft-whitelist:${guildId}`;

/** Discord user id that holds a nick on this server, or null. */
export function nickOwner(config, nick) {
  const lower = nick.toLowerCase();
  return Object.entries(config.members).find(([, entry]) => entry.name.toLowerCase() === lower)?.[0] ?? null;
}

/**
 * Give a member a nick on the whitelist; their previous nick is taken off.
 * Returns { name, already, previous }.
 */
export function claimNick(guild, member, nick) {
  return Mutex.runExclusive(lockKey(guild.id), async () => {
    const config = await store.get(guild.id);
    if (!config.enabled || !config.apiKey) throw userError(t('The Minecraft whitelist is not set up. An admin can do it with `/minecraft whitelista ustaw`.'));
    const owner = nickOwner(config, nick);
    if (owner && owner !== member.id) throw userError(t`\`${nick}\` already belongs to someone else on this server.`);

    const panel = panelOf(config);
    const result = await addToWhitelist(panel, nick);
    const previous = config.members[member.id]?.name ?? null;
    const replaced = previous && previous.toLowerCase() !== result.name.toLowerCase() ? previous : null;
    if (replaced) {
      await removeFromWhitelist(panel, replaced).catch((error) => logger.warn(`Minecraft whitelist: could not remove ${replaced}: ${error.message}`));
    }
    await store.update(guild.id, (data) => {
      data.members[member.id] = { name: result.name, at: Date.now() };
    });
    if (config.roleId && member.roles?.add && !member.roles.cache?.has(config.roleId)) {
      await member.roles.add(config.roleId, t('Minecraft whitelist')).catch(() => {});
    }
    return { ...result, previous: replaced };
  });
}

/** Admin addition without a member: the nick is not tied to anyone. */
export function addNick(guild, nick) {
  return Mutex.runExclusive(lockKey(guild.id), async () => {
    const config = await store.get(guild.id);
    if (!config.apiKey) throw userError(t('The Minecraft whitelist is not set up. An admin can do it with `/minecraft whitelista ustaw`.'));
    return addToWhitelist(panelOf(config), nick);
  });
}

/** Admin removal: takes the nick off the server and from whoever held it. */
export function releaseNick(guild, nick) {
  return Mutex.runExclusive(lockKey(guild.id), async () => {
    const config = await store.get(guild.id);
    if (!config.apiKey) throw userError(t('The Minecraft whitelist is not set up. An admin can do it with `/minecraft whitelista ustaw`.'));
    const removed = await removeFromWhitelist(panelOf(config), nick);
    const owner = nickOwner(config, nick);
    if (owner) await store.update(guild.id, (data) => { delete data.members[owner]; });
    return { removed, ownerId: owner };
  });
}

/** guildMemberRemove: a member who left loses their whitelist place (when the setting is on). */
export async function releaseMemberOnLeave(guild, userId) {
  const config = await store.get(guild.id);
  const entry = config.members[userId];
  if (!config.enabled || !config.removeOnLeave || !config.apiKey || !entry) return false;
  try {
    await Mutex.runExclusive(lockKey(guild.id), async () => {
      await removeFromWhitelist(panelOf(config), entry.name);
      await store.update(guild.id, (data) => { delete data.members[userId]; });
    });
    return true;
  } catch (error) {
    logger.warn(`Minecraft whitelist: could not remove ${entry.name} after they left ${guild.id}: ${error.message}`);
    return false;
  }
}

// --- the channel ---------------------------------------------------------------------

export function channelGuideEmbed() {
  return createEmbed({
    title: t('⛏️ Minecraft whitelist'),
    description: [
      t('Write your Minecraft nick (Java) in this channel and the bot adds you to the server whitelist.'),
      t('Only the nick, nothing else. One nick per person: writing a new one replaces your old one.'),
    ].join('\n\n'),
    footer: false,
  });
}

function answer(message, ok, text) {
  message.react(ok ? '✅' : '❌').catch(() => {});
  return message.reply({ embeds: [ok ? successEmbed(text) : createEmbed({ description: `❌ ${text}`, color: 'error', footer: false })], allowedMentions: { repliedUser: false } })
    .then((reply) => {
      const timer = setTimeout(() => reply.delete().catch(() => {}), ANSWER_LIFETIME_MS);
      timer.unref?.();
      return reply;
    })
    .catch(() => null);
}

/** messageCreate: true when the message was in the whitelist channel (it is handled here). */
export async function handleWhitelistMessage(message) {
  const config = await store.get(message.guild.id);
  if (!config.enabled || !config.apiKey || message.channelId !== config.channelId) return false;

  const nick = parseNick(message.content);
  if (!nick) {
    await answer(message, false, t('Write only your Minecraft nick: 3-16 characters, letters, digits and `_`.'));
    return true;
  }

  const key = `${message.guild.id}:${message.author.id}`;
  const wait = (lastTry.get(key) ?? 0) + whitelistTiming.memberCooldownMs - Date.now();
  if (wait > 0) {
    await answer(message, false, t`Wait ${Math.ceil(wait / 1000)} s before the next nick.`);
    return true;
  }
  lastTry.set(key, Date.now());

  await message.channel.sendTyping?.().catch(() => {});
  try {
    const member = message.member ?? await message.guild.members.fetch(message.author.id);
    const result = await claimNick(message.guild, member, nick);
    let text = result.already ? t`\`${result.name}\` is on the whitelist.` : t`Added \`${result.name}\` to the whitelist.`;
    if (result.previous) text += `\n${t`\`${result.previous}\` was taken off.`}`;
    await answer(message, true, text);
  } catch (error) {
    if (!(error instanceof PanelError) && !error?.context?.expected) {
      logger.error('Minecraft whitelist failed:', error);
    }
    await answer(message, false, error instanceof PanelError ? panelErrorText(error) : (error?.userMessage ?? t('Something went wrong. Try again in a moment.')));
  }
  return true;
}
