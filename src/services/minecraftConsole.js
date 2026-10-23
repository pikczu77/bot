// minecraftConsole.js — a Discord channel that works as the Minecraft server console.
//
// Admins type a command there (with or without "/", one per line) and the bot sends it
// through the same panel connection as the whitelist (src/services/minecraftWhitelist.js).
// The answer shows the console lines printed in the next seconds, read from the panel's
// websocket. Without the websocket the command still runs; the message only gets ✅.
//
// Only Administrators, the server owner and bot owners can run commands: the console can
// op players, stop the server and change the world. Everyone else gets ❌.

import { PermissionFlagsBits } from 'discord.js';
import WebSocket from 'ws';
import { createEmbed } from '../utils/embeds.js';
import { userError } from '../utils/featureKit.js';
import { isBotOwner } from '../config/bot.js';
import { logger } from '../utils/logger.js';
import { t } from '../i18n/index.js';
import { PanelError, getWhitelistConfig, panelErrorText, panelOf, panelRequest, sendCommand, updateWhitelistSettings } from './minecraftWhitelist.js';

const MAX_COMMANDS = 5;
const MAX_COMMAND_LENGTH = 400;
const OUTPUT_LIMIT = 1800;
const ANSWER_LIFETIME_MS = 20_000;
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

/** How long to wait for the socket and for output; tests set them to 0. */
export const consoleTiming = { connectMs: 5000, outputMs: 2500 };
/** Websocket factory; tests replace it with a fake. */
export const consoleSocket = { create: (url, options) => new WebSocket(url, options) };

export const getConsoleChannelId = async (guildId) => (await getWhitelistConfig(guildId)).consoleChannelId;

export function setConsoleChannel(guildId, channelId) {
  return updateWhitelistSettings(guildId, (data) => {
    data.consoleChannelId = channelId;
  });
}

export function canUseConsole(member) {
  if (!member) return false;
  if (isBotOwner(member.id) || member.guild?.ownerId === member.id) return true;
  return Boolean(member.permissions?.has?.(PermissionFlagsBits.Administrator));
}

/** Message text -> commands: one per line, a leading "/" removed. */
export function parseConsoleCommands(content) {
  return String(content ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\/+/, '').trim())
    .filter(Boolean);
}

export const cleanConsoleLine = (line) => String(line ?? '').replace(ANSI_RE, '').replace(/\r/g, '').trimEnd();

/** Last console lines that fit one code block. */
export function formatConsoleOutput(lines) {
  const kept = [];
  let size = 0;
  for (const line of [...lines].reverse()) {
    const safe = line.replace(/```/g, 'ˋˋˋ').slice(0, 300);
    if (size + safe.length + 1 > OUTPUT_LIMIT) break;
    kept.unshift(safe);
    size += safe.length + 1;
  }
  return `\`\`\`\n${kept.join('\n')}\n\`\`\``;
}

const readEvent = (raw) => {
  try {
    return JSON.parse(String(raw));
  } catch {
    return {};
  }
};

/** Panel websocket after authentication, or a rejection. */
async function openConsoleSocket(panel) {
  const data = (await (await panelRequest(panel, 'GET', '/websocket')).json())?.data;
  if (!data?.socket || !data?.token) throw new Error('the panel gave no websocket');
  return new Promise((resolve, reject) => {
    const socket = consoleSocket.create(data.socket, { origin: panel.panelUrl, handshakeTimeout: consoleTiming.connectMs || 1 });
    const timer = setTimeout(() => {
      socket.terminate?.();
      reject(new Error('websocket timeout'));
    }, consoleTiming.connectMs);
    const onAuth = (raw) => {
      if (readEvent(raw).event !== 'auth success') return;
      clearTimeout(timer);
      socket.off('message', onAuth);
      resolve(socket);
    };
    socket.on('open', () => socket.send(JSON.stringify({ event: 'auth', args: [data.token] })));
    socket.on('message', onAuth);
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on('close', () => {
      clearTimeout(timer);
      reject(new Error('websocket closed'));
    });
  });
}

/**
 * Run the commands and collect the console output printed meanwhile.
 * Returns the lines, or null when the websocket was not available (the commands still ran).
 */
export async function runConsoleCommands(panel, commands) {
  const socket = await openConsoleSocket(panel).catch((error) => {
    logger.debug(`Minecraft console: no websocket (${error.message}), sending without output`);
    return null;
  });
  const lines = [];
  socket?.on('message', (raw) => {
    const { event, args } = readEvent(raw);
    if (event === 'console output') lines.push(cleanConsoleLine(args?.[0]));
  });
  try {
    for (const command of commands) await sendCommand(panel, command);
    if (!socket) return null;
    if (consoleTiming.outputMs > 0) await new Promise((resolve) => setTimeout(resolve, consoleTiming.outputMs));
    return lines.filter(Boolean);
  } finally {
    socket?.close();
  }
}

export function consoleGuideEmbed() {
  return createEmbed({
    title: t('🖥️ Minecraft console'),
    description: [
      t('Admins type server commands here, for example `list`, `say Hi` or `whitelist add Nick`. A leading `/` is optional, one command per line.'),
      t('The bot answers with what the console printed. Messages from people without Administrator are refused.'),
    ].join('\n\n'),
    footer: false,
  });
}

function refuse(message, text) {
  message.react('❌').catch(() => {});
  return message.reply({ embeds: [createEmbed({ description: `❌ ${text}`, color: 'error', footer: false })], allowedMentions: { repliedUser: false } })
    .then((reply) => {
      const timer = setTimeout(() => reply.delete().catch(() => {}), ANSWER_LIFETIME_MS);
      timer.unref?.();
    })
    .catch(() => {});
}

/** messageCreate: true when the message was in the console channel (it is handled here). */
export async function handleConsoleMessage(message) {
  const config = await getWhitelistConfig(message.guild.id);
  if (!config.apiKey || !config.consoleChannelId || message.channelId !== config.consoleChannelId) return false;

  const member = message.member ?? await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!canUseConsole(member)) {
    await refuse(message, t('Only administrators can use the server console.'));
    return true;
  }
  const commands = parseConsoleCommands(message.content);
  if (commands.length === 0) return true;
  if (commands.length > MAX_COMMANDS) {
    await refuse(message, t`At most ${MAX_COMMANDS} commands in one message.`);
    return true;
  }
  if (commands.some((command) => command.length > MAX_COMMAND_LENGTH)) {
    await refuse(message, t`A command can have at most ${MAX_COMMAND_LENGTH} characters.`);
    return true;
  }

  await message.channel.sendTyping?.().catch(() => {});
  try {
    const lines = await runConsoleCommands(panelOf(config), commands);
    logger.info(`Minecraft console in ${message.guild.id}: ${message.author.tag ?? message.author.id} ran ${JSON.stringify(commands)}`);
    message.react('✅').catch(() => {});
    if (lines?.length) {
      await message.reply({ content: formatConsoleOutput(lines), allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
    }
  } catch (error) {
    if (!(error instanceof PanelError) && !error?.context?.expected) logger.error('Minecraft console failed:', error);
    await refuse(message, error instanceof PanelError ? panelErrorText(error) : (error?.userMessage ?? t('Something went wrong. Try again in a moment.')));
  }
  return true;
}

/** Checks for `/minecraft konsola`; throws a user error when the channel cannot be used. */
export async function assertConsoleChannelAllowed(guild, channel) {
  const config = await getWhitelistConfig(guild.id);
  if (!config.apiKey) throw userError(t('Connect the server panel first with `/minecraft whitelista ustaw`.'));
  if (config.channelId === channel.id && config.enabled) {
    throw userError(t('This is the whitelist channel. Pick another channel for the console.'));
  }
}
