// Minecraft chat link (2026-10-26) against a fake Pterodactyl panel and a fake panel websocket:
// game chat to Discord (webhook with the player's name), Discord to the game (tellraw), events.
import './helpers/env.js';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Collection } from 'discord.js';
import { mockChannel, mockGuild, mockMember, mockUser } from './helpers/mock.js';
import { initializeDatabase } from '../src/utils/database.js';
import { loadCommands } from '../src/handlers/loaders/commandLoader.js';
import { getWhitelistConfig, updateWhitelistConfig } from '../src/services/minecraftWhitelist.js';
import { consoleSocket } from '../src/services/minecraftConsole.js';
import {
  chatBridgeOf, chatTiming, handleChatBridgeMessage, parseChatLine, setChatChannel, syncChatBridge, tellrawCommand,
} from '../src/services/minecraftChat.js';

const PANEL = 'https://ptero.mathost.eu';
const SERVER_ID = 'abc12345';
const KEY = 'ptlc_TestKeyForTheFakePanel0123456789';
const fake = { commands: [], sockets: [] };
const realFetch = globalThis.fetch;
const realCreate = consoleSocket.create;

class FakeSocket extends EventEmitter {
  constructor(url, options) {
    super();
    this.url = url;
    this.options = options;
    this.closed = false;
    this.sent = [];
    fake.sockets.push(this);
    queueMicrotask(() => this.emit('open'));
  }

  send(raw) {
    this.sent.push(JSON.parse(raw));
    const { event, args } = JSON.parse(raw);
    if (event === 'auth' && args[0] === 'jwt-token') queueMicrotask(() => this.emit('message', JSON.stringify({ event: 'auth success' })));
  }

  close() {
    this.closed = true;
    this.emit('close');
  }

  console(line) { this.emit('message', JSON.stringify({ event: 'console output', args: [line] })); }
}

const reply = (status, body = null) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function fakeFetch(url, options = {}) {
  const address = new URL(url);
  const base = `/api/client/servers/${SERVER_ID}`;
  if (address.origin !== PANEL || !address.pathname.startsWith(base)) return reply(404, { errors: [] });
  if (options.headers?.Authorization !== `Bearer ${KEY}`) return reply(401, { errors: [] });
  const path = address.pathname.slice(base.length);
  if (path === '/websocket') return reply(200, { data: { token: 'jwt-token', socket: 'wss://node1.mathost.eu:8080/api/servers/abc/ws' } });
  if (path === '/command') {
    fake.commands.push(JSON.parse(options.body).command);
    return reply(204);
  }
  return reply(404, { errors: [] });
}

const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null }, user: { id: '999999999999999999' } };
let guild;
let chat;
const webhookPosts = [];

before(async () => {
  const { db } = await initializeDatabase();
  client.db = db;
  await loadCommands(client);
  globalThis.fetch = fakeFetch;
  consoleSocket.create = (url, options) => new FakeSocket(url, options);
  chatTiming.flushMs = 0;
  guild = mockGuild(client, 'Serwer MC');
  chat = mockChannel(guild, 'czat-mc', {
    fetchWebhooks: async () => new Collection(),
    createWebhook: async ({ name }) => ({ name, owner: { id: client.user.id }, send: async (payload) => { webhookPosts.push(payload); } }),
  });
  await updateWhitelistConfig(guild.id, (data) => Object.assign(data, { panelUrl: PANEL, serverId: SERVER_ID, apiKey: KEY }));
});

after(() => {
  globalThis.fetch = realFetch;
  consoleSocket.create = realCreate;
  chatTiming.flushMs = 1000;
});

const flushed = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await chatBridgeOf(guild.id)?.flushing;
};

test('console lines: chat, joins, leaves, advancements, deaths, start and stop; everything else is ignored', () => {
  assert.deepEqual(parseChatLine('[12:00:00 INFO]: <Pikczu> siema'), { type: 'chat', name: 'Pikczu', text: 'siema' });
  assert.deepEqual(parseChatLine('[12:00:00] [Server thread/INFO]: [Not Secure] <Steve> hej <3'), { type: 'chat', name: 'Steve', text: 'hej <3' });
  assert.deepEqual(parseChatLine('[12:00:00 INFO]: Steve joined the game'), { type: 'join', name: 'Steve' });
  assert.deepEqual(parseChatLine('\u001b[33m[12:00:00 INFO]: Steve left the game\u001b[0m'), { type: 'leave', name: 'Steve' });
  assert.deepEqual(parseChatLine('[12:00:00 INFO]: Steve has made the advancement [Diamonds!]'), { type: 'advancement', name: 'Steve', text: 'Diamonds!' });
  assert.equal(parseChatLine('[12:00:00 INFO]: Steve was slain by Zombie').type, 'death');
  assert.equal(parseChatLine('[12:00:00 INFO]: Steve fell from a high place').type, 'death');
  assert.equal(parseChatLine('[12:00:00 INFO]: Done (3.512s)! For help, type "help"').type, 'start');
  assert.equal(parseChatLine('[12:00:00 INFO]: Stopping server').type, 'stop');
  assert.equal(parseChatLine('[12:00:00 INFO]: Steve issued server command: /home'), null);
  assert.equal(parseChatLine('[12:00:00 INFO]: Steve lost connection: Disconnected'), null);
  assert.equal(parseChatLine('[12:00:00 INFO]: There are 2 of a max of 20 players online'), null);
  assert.equal(parseChatLine('random text <Steve> hi'), null);
});

test('tellraw: one line, at most 200 characters, quotes and backslashes escaped', () => {
  const command = tellrawCommand('Ania "Kot"', 'cześć\n"wszystkim" \\ :)');
  assert.ok(command.startsWith('tellraw @a ['));
  const json = JSON.parse(command.slice('tellraw @a '.length));
  assert.equal(json[1].text, '[Discord] ');
  assert.equal(json[2].text, 'Ania "Kot"');
  assert.equal(json[3].text, ': cześć "wszystkim" \\ :)');
  assert.equal(tellrawCommand('A', '   '), null);
  assert.equal(JSON.parse(tellrawCommand('A', 'x'.repeat(500)).slice(11))[3].text.length, 202);
});

test('a linked channel (set in the panel): game chat comes through a webhook, events as lines', async () => {
  await setChatChannel(guild.id, chat.id);
  await syncChatBridge(guild);
  assert.equal((await getWhitelistConfig(guild.id)).chatChannelId, chat.id);
  await new Promise((resolve) => setImmediate(resolve));
  const socket = fake.sockets.at(-1);
  assert.ok(socket, 'a websocket is open');
  assert.equal(socket.options.origin, PANEL);
  assert.deepEqual(socket.sent[0], { event: 'auth', args: ['jwt-token'] });

  socket.console('[12:00:00 INFO]: <Pikczu> siema @everyone');
  await flushed();
  assert.equal(webhookPosts.length, 1);
  assert.equal(webhookPosts[0].username, 'Pikczu');
  assert.equal(webhookPosts[0].content, 'siema @everyone');
  assert.deepEqual(webhookPosts[0].allowedMentions, { parse: [] });
  assert.match(webhookPosts[0].avatarURL, /mc-heads\.net\/avatar\/Pikczu/);

  socket.console('[12:00:01 INFO]: Steve joined the game');
  await flushed();
  assert.match(chat.sent.at(-1).content, /📥 \*\*Steve\*\*/);

  // Token refresh keeps the same socket.
  socket.emit('message', JSON.stringify({ event: 'token expiring' }));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(socket.sent.filter((item) => item.event === 'auth').length, 2);
});

test('Discord messages on the chat channel go to the game; other channels do not', async () => {
  const member = mockMember(guild, mockUser('Ola'));
  const reactions = [];
  const message = (channel, content) => ({
    guild, member, author: member.user, channel, channelId: channel.id, content, cleanContent: content,
    attachments: new Collection(), react: async (emoji) => { reactions.push(emoji); },
  });
  fake.commands.length = 0;
  assert.equal(await handleChatBridgeMessage(message(chat, 'hej z discorda')), true);
  assert.equal(fake.commands.length, 1);
  assert.match(fake.commands[0], /^tellraw @a /);
  assert.match(fake.commands[0], /hej z discorda/);
  const other = mockChannel(guild, 'inny');
  assert.equal(await handleChatBridgeMessage(message(other, 'nie')), false);
  assert.equal(fake.commands.length, 1);
});

test('turning it off closes the connection', async () => {
  const socket = fake.sockets.at(-1);
  await setChatChannel(guild.id, null);
  await syncChatBridge(guild);
  assert.equal(socket.closed, true);
  assert.equal(chatBridgeOf(guild.id), null);
  assert.equal(await syncChatBridge(guild), null);
});
