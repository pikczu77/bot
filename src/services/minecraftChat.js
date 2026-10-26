// minecraftChat.js — Minecraft chat <-> Discord channel (2026-10-26, owner picked idea 14).
//
// Uses the panel connection of the whitelist (src/services/minecraftWhitelist.js, Pterodactyl):
//   game -> Discord  a long-lived panel websocket reads the console; chat lines are posted through a
//                    "Minecraft" webhook with the player's name and head (plain bot messages when the
//                    bot cannot make webhooks); joins, leaves, advancements, deaths and server start/stop
//                    as short lines when `chatEvents` is on
//   Discord -> game  a message on the channel becomes `tellraw @a` ("[Discord] Name: text")
// Settings in the whitelist store: chatChannelId, chatEvents. `syncChatBridges` (job every minute)
// opens and closes the connections; a dropped connection is retried after a pause.
// Chat lines are read in the vanilla / Paper console format; chat plugins that change it are not read.

import { PermissionFlagsBits } from 'discord.js';
import { logger } from '../utils/logger.js';
import { enterLocale, t } from '../i18n/index.js';
import { getGuildLocale } from './languageService.js';
import { cleanConsoleLine, consoleSocket } from './minecraftConsole.js';
import { getWhitelistConfig, panelOf, panelRequest, sendCommand, updateWhitelistSettings } from './minecraftWhitelist.js';

const MAX_TO_GAME = 200;
const FLUSH_MS = 1000;
const RETRY_MS = [30_000, 60_000, 120_000, 300_000];
const WEBHOOK_NAME = 'Minecraft';

/** Timers; tests set flushMs to 0 and send at once. */
export const chatTiming = { flushMs: FLUSH_MS };

const bridges = new Map(); // guildId -> bridge
// Last chat lines both ways for the web panel (pikczu.pl/bot, Minecraft module); memory only, a restart clears it.
export const HISTORY_SIZE = 30;
const history = new Map(); // guildId -> [{ at, type, name, text }]

function remember(guildId, item) {
  const list = history.get(guildId) ?? [];
  list.push({ at: Date.now(), ...item });
  if (list.length > HISTORY_SIZE) list.splice(0, list.length - HISTORY_SIZE);
  history.set(guildId, list);
}

/** Newest last: chat from the game (`chat`), from Discord (`discord`) and events (join, leave, death...). */
export const chatHistory = (guildId) => (history.get(guildId) ?? []).map((item) => ({ ...item }));

const NICK = '[A-Za-z0-9_]{1,16}';
const CHAT_RE = new RegExp(`^(?:\\[Not Secure\\] )?<(${NICK})> (.+)$`);
const JOIN_RE = new RegExp(`^(${NICK}) joined the game$`);
const LEAVE_RE = new RegExp(`^(${NICK}) left the game$`);
const ADVANCEMENT_RE = new RegExp(`^(${NICK}) has (?:made the advancement|completed the challenge|reached the goal) \\[(.+)\\]$`);
const DEATH_WORDS = [
  'was slain by', 'was shot by', 'was killed', 'was blown up by', 'blew up', 'drowned', 'fell from', 'fell off',
  'fell out of the world', 'hit the ground too hard', 'burned to death', 'went up in flames', 'walked into fire',
  'tried to swim in lava', 'discovered the floor was lava', 'starved to death', 'suffocated', 'froze to death',
  'was pricked to death', 'was poked to death', 'was stung to death', 'withered away', 'experienced kinetic energy',
  'was squashed', 'was squished', 'was impaled', 'was skewered', 'was struck by lightning', 'was fireballed',
  'was obliterated', 'was pummeled', 'was frozen to death', 'died', "didn't want to live", 'left the confines of this world',
  'was doomed to fall', 'was roasted', 'was burnt to a crisp', 'was killed by magic',
];

/** The text after the console prefix: "[12:00:00] [Server thread/INFO]: x" / "[12:00:00 INFO]: x" -> "x". */
export const stripPrefix = (line) => cleanConsoleLine(line).replace(/^(?:\[[^\]]*\]\s*)+:\s*/, '');

/**
 * What a console line means for the chat: { type, name, text } or null.
 * type: chat | join | leave | advancement | death | start | stop.
 */
export function parseChatLine(line) {
  const raw = cleanConsoleLine(line);
  if (/\bDone \([\d.,]+s\)!/.test(raw)) return { type: 'start' };
  if (/\bStopping (?:the )?server\b/.test(raw)) return { type: 'stop' };
  const body = stripPrefix(raw);
  if (body === raw && !/^\[/.test(raw)) return null; // not a console log line
  let match = CHAT_RE.exec(body);
  if (match) return { type: 'chat', name: match[1], text: match[2] };
  if ((match = JOIN_RE.exec(body))) return { type: 'join', name: match[1] };
  if ((match = LEAVE_RE.exec(body))) return { type: 'leave', name: match[1] };
  if ((match = ADVANCEMENT_RE.exec(body))) return { type: 'advancement', name: match[1], text: match[2] };
  match = new RegExp(`^(${NICK}) (.+)$`).exec(body);
  if (match && DEATH_WORDS.some((words) => match[2].startsWith(words))) return { type: 'death', name: match[1], text: body };
  return null;
}

/** "[Discord] Name: text" as a tellraw command; null when there is nothing to send. */
export function tellrawCommand(author, text) {
  const clean = String(text ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TO_GAME);
  if (!clean) return null;
  const name = String(author ?? '?').replace(/[\r\n]+/g, ' ').slice(0, 32);
  return `tellraw @a ${JSON.stringify(['', { text: '[Discord] ', color: 'blue' }, { text: name, color: 'aqua' }, { text: `: ${clean}`, color: 'white' }])}`;
}

const escapeMarkdown = (text) => String(text).replace(/([\\*_~`|>])/g, '\\$1');

function eventLine(event) {
  const name = `**${escapeMarkdown(event.name ?? '')}**`;
  switch (event.type) {
    case 'join': return t`📥 ${name} joined the game`;
    case 'leave': return t`📤 ${name} left the game`;
    case 'advancement': return t`🏆 ${name} got the advancement **${escapeMarkdown(event.text)}**`;
    case 'death': return `💀 ${escapeMarkdown(event.text)}`;
    case 'start': return t('🟢 The server is on');
    case 'stop': return t('🔴 The server is shutting down');
    default: return null;
  }
}

async function findWebhook(channel, botId) {
  const me = channel.guild?.members?.me;
  if (me && !channel.permissionsFor?.(me)?.has(PermissionFlagsBits.ManageWebhooks)) return null;
  try {
    const hooks = await channel.fetchWebhooks();
    const own = hooks.find((hook) => hook.owner?.id === botId && hook.name === WEBHOOK_NAME);
    return own ?? await channel.createWebhook({ name: WEBHOOK_NAME, reason: 'Minecraft chat bridge' });
  } catch (error) {
    logger.debug(`Minecraft chat: no webhook (${error.message}), plain messages instead`);
    return null;
  }
}

/** Send what came from the game: consecutive chat lines of one player go in one message. */
async function flush(bridge) {
  bridge.flushTimer = null;
  const items = bridge.queue.splice(0);
  if (!items.length) return;
  const channel = bridge.guild.channels.cache.get(bridge.channelId);
  if (!channel?.send) return;
  enterLocale(await getGuildLocale(bridge.guild.id));
  if (bridge.webhook === undefined) bridge.webhook = await findWebhook(channel, bridge.guild.client?.user?.id);

  const groups = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && item.type === 'chat' && last.type === 'chat' && last.name === item.name) last.lines.push(item.text);
    else if (last && item.type !== 'chat' && last.type === 'event') last.lines.push(item.line);
    else groups.push(item.type === 'chat' ? { type: 'chat', name: item.name, lines: [item.text] } : { type: 'event', lines: [item.line] });
  }
  for (const group of groups) {
    const content = group.lines.join('\n').slice(0, 1900);
    try {
      if (group.type === 'chat' && bridge.webhook) {
        await bridge.webhook.send({ content, username: group.name, avatarURL: `https://mc-heads.net/avatar/${encodeURIComponent(group.name)}/64`, allowedMentions: { parse: [] } });
      } else if (group.type === 'chat') {
        await channel.send({ content: group.lines.map((line) => `**${escapeMarkdown(group.name)}**: ${line}`).join('\n').slice(0, 1900), allowedMentions: { parse: [] } });
      } else {
        await channel.send({ content, allowedMentions: { parse: [] } });
      }
    } catch (error) {
      if (group.type === 'chat' && bridge.webhook) bridge.webhook = undefined; // deleted webhook: look again next time
      logger.warn(`Minecraft chat: message not posted in guild ${bridge.guild.id}: ${error.message}`);
    }
  }
}

/** One console line from the panel websocket. */
export function handleConsoleLine(bridge, line) {
  const event = parseChatLine(line);
  if (!event) return;
  if (event.type === 'chat' || bridge.events) {
    remember(bridge.guild.id, { type: event.type, name: event.name ?? null, text: event.text ?? null });
  }
  if (event.type === 'chat') bridge.queue.push(event);
  else if (bridge.events) bridge.queue.push({ type: event.type, line: eventLine(event) });
  else return;
  if (chatTiming.flushMs <= 0) {
    bridge.flushing = flush(bridge);
    return;
  }
  if (!bridge.flushTimer) {
    bridge.flushTimer = setTimeout(() => { flush(bridge).catch((error) => logger.warn(`Minecraft chat flush failed: ${error.message}`)); }, chatTiming.flushMs);
    bridge.flushTimer.unref?.();
  }
}

const readEvent = (raw) => {
  try {
    return JSON.parse(String(raw));
  } catch {
    return {};
  }
};

async function websocketDetails(panel) {
  const data = (await (await panelRequest(panel, 'GET', '/websocket')).json())?.data;
  if (!data?.socket || !data?.token) throw new Error('the panel gave no websocket');
  return data;
}

function closeBridge(guildId) {
  const bridge = bridges.get(guildId);
  if (!bridge) return;
  bridges.delete(guildId);
  bridge.closed = true;
  clearTimeout(bridge.flushTimer);
  try { bridge.socket?.close(); } catch { /* already closed */ }
}

async function connect(bridge) {
  const panel = bridge.panel;
  bridge.connecting = true;
  try {
    const data = await websocketDetails(panel);
    const socket = consoleSocket.create(data.socket, { origin: panel.panelUrl });
    bridge.socket = socket;
    socket.on('open', () => socket.send(JSON.stringify({ event: 'auth', args: [data.token] })));
    socket.on('message', (raw) => {
      const { event, args } = readEvent(raw);
      if (event === 'auth success') {
        bridge.failures = 0;
      } else if (event === 'console output') {
        handleConsoleLine(bridge, args?.[0]);
      } else if (event === 'token expiring') {
        websocketDetails(panel)
          .then((fresh) => socket.send(JSON.stringify({ event: 'auth', args: [fresh.token] })))
          .catch((error) => logger.debug(`Minecraft chat: token refresh failed (${error.message})`));
      } else if (event === 'token expired' || event === 'jwt error') {
        socket.close();
      }
    });
    socket.on('error', (error) => logger.debug(`Minecraft chat socket error in guild ${bridge.guild.id}: ${error.message}`));
    socket.on('close', () => {
      if (bridge.socket === socket) bridge.socket = null;
      bridge.retryAt = Date.now() + RETRY_MS[Math.min(bridge.failures, RETRY_MS.length - 1)];
      bridge.failures += 1;
    });
  } catch (error) {
    bridge.socket = null;
    bridge.retryAt = Date.now() + RETRY_MS[Math.min(bridge.failures, RETRY_MS.length - 1)];
    bridge.failures += 1;
    logger.debug(`Minecraft chat: no connection in guild ${bridge.guild.id} (${error.message})`);
  } finally {
    bridge.connecting = false;
  }
}

/** Open, keep or close the bridge of one server to match its settings. */
export async function syncChatBridge(guild, now = Date.now()) {
  const config = await getWhitelistConfig(guild.id);
  const wanted = Boolean(config.apiKey && config.chatChannelId && config.serverId);
  const key = wanted ? `${config.panelUrl}|${config.serverId}|${config.apiKey}|${config.chatChannelId}` : null;
  const current = bridges.get(guild.id);
  if (!wanted || (current && current.key !== key)) closeBridge(guild.id);
  if (!wanted) return null;
  let bridge = bridges.get(guild.id);
  if (!bridge) {
    bridge = { guild, key, panel: panelOf(config), channelId: config.chatChannelId, events: config.chatEvents !== false, queue: [], socket: null, failures: 0, retryAt: 0 };
    bridges.set(guild.id, bridge);
  }
  bridge.events = config.chatEvents !== false;
  if (!bridge.socket && !bridge.connecting && now >= bridge.retryAt) await connect(bridge);
  return bridge;
}

export async function syncChatBridges(client) {
  for (const guild of client.guilds.cache.values()) {
    await syncChatBridge(guild).catch((error) => logger.warn(`Minecraft chat sync failed in guild ${guild.id}: ${error.message}`));
  }
}

export const chatBridgeOf = (guildId) => bridges.get(guildId) ?? null;

export function setChatChannel(guildId, channelId, events) {
  return updateWhitelistSettings(guildId, (data) => {
    data.chatChannelId = channelId;
    if (events !== null && events !== undefined) data.chatEvents = Boolean(events);
  });
}

/** messageCreate: true when the message was on the chat channel (sent to the game here). */
export async function handleChatBridgeMessage(message) {
  const config = await getWhitelistConfig(message.guild.id);
  if (!config.apiKey || !config.chatChannelId || message.channelId !== config.chatChannelId) return false;
  const attachments = message.attachments?.size ? ` ${t('[attachment]')}` : '';
  const author = message.member?.displayName ?? message.author.username;
  const text = `${message.cleanContent ?? message.content ?? ''}${attachments}`;
  const command = tellrawCommand(author, text);
  if (!command) return true;
  try {
    await sendCommand(panelOf(config), command);
    remember(message.guild.id, { type: 'discord', name: String(author).slice(0, 32), text: text.replace(/\s+/g, ' ').trim().slice(0, 200) });
  } catch (error) {
    logger.debug(`Minecraft chat: message not sent to the game (${error.message})`);
    message.react('❌').catch(() => {});
  }
  return true;
}
