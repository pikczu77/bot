// Minecraft console channel against a fake Pterodactyl panel and a fake panel websocket.
import './helpers/env.js';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Collection, PermissionFlagsBits } from 'discord.js';
import { mockChannel, mockGuild, mockMember, mockUser, replyText } from './helpers/mock.js';
import { runWithLocale } from '../src/i18n/index.js';
import { initializeDatabase } from '../src/utils/database.js';
import { loadCommands } from '../src/handlers/loaders/commandLoader.js';
import { getWhitelistConfig, updateWhitelistConfig } from '../src/services/minecraftWhitelist.js';
import {
  cleanConsoleLine,
  consoleSocket,
  consoleTiming,
  formatConsoleOutput,
  handleConsoleMessage,
  parseConsoleCommands,
} from '../src/services/minecraftConsole.js';

const PANEL = 'https://ptero.mathost.eu';
const SERVER_ID = 'abc12345';
const KEY = 'ptlc_TestKeyForTheFakePanel0123456789';
const fake = { state: 'running', commands: [], sockets: [], websocket: true };
const realFetch = globalThis.fetch;
const realCreate = consoleSocket.create;

class FakeSocket extends EventEmitter {
  constructor(url, options) {
    super();
    this.url = url;
    this.options = options;
    this.closed = false;
    fake.sockets.push(this);
    queueMicrotask(() => this.emit('open'));
  }

  send(raw) {
    const { event, args } = JSON.parse(raw);
    if (event === 'auth' && args[0] === 'jwt-token') queueMicrotask(() => this.emit('message', JSON.stringify({ event: 'auth success' })));
  }

  close() { this.closed = true; }

  terminate() { this.closed = true; }
}

const reply = (status, body = null) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function fakeFetch(url, options = {}) {
  const address = new URL(url);
  const base = `/api/client/servers/${SERVER_ID}`;
  if (address.origin !== PANEL || !address.pathname.startsWith(base)) return reply(404, { errors: [] });
  if (options.headers?.Authorization !== `Bearer ${KEY}`) return reply(401, { errors: [] });
  const path = address.pathname.slice(base.length);
  if (path === '/websocket') {
    return fake.websocket ? reply(200, { data: { token: 'jwt-token', socket: 'wss://node1.mathost.eu:8080/api/servers/abc/ws' } }) : reply(500, { errors: [] });
  }
  if (path === '/command') {
    if (fake.state !== 'running') return reply(502, { errors: [{ detail: 'Server must be online in order to send commands.' }] });
    const { command } = JSON.parse(options.body);
    fake.commands.push(command);
    const line = command === 'list'
      ? '\u001b[33m[12:00:00 INFO]: There are 2 of a max of 20 players online: Pikczu, Notch\u001b[0m'
      : `[12:00:01 INFO]: ran ${command}`;
    for (const socket of fake.sockets.filter((item) => !item.closed)) {
      socket.emit('message', JSON.stringify({ event: 'console output', args: [line] }));
    }
    return reply(204);
  }
  return reply(404, { errors: [] });
}

const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null } };
let guild;
let consoleChannel;
let admin;
let manager;

function mockMessage(member, content, channel = consoleChannel) {
  const message = {
    guild,
    member,
    author: member.user,
    channel,
    channelId: channel.id,
    content,
    reactions: [],
    answers: [],
    react: async (emoji) => { message.reactions.push(emoji); },
    reply: async (payload) => { message.answers.push(payload); return { delete: async () => {} }; },
  };
  return message;
}

async function type(member, content, locale = 'en') {
  const message = mockMessage(member, content);
  const handled = await runWithLocale(locale, () => handleConsoleMessage(message));
  return { handled, message, ok: message.reactions.at(-1) === '✅', text: replyText({ replies: message.answers }) };
}

before(async () => {
  const { db } = await initializeDatabase();
  client.db = db;
  await loadCommands(client);
  guild = mockGuild(client);
  consoleChannel = mockChannel(guild, 'konsola');
  admin = mockMember(guild, mockUser('Pikczu'), { permissions: [PermissionFlagsBits.Administrator] });
  manager = mockMember(guild, mockUser('Moderator'), { permissions: [PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageMessages] });
  globalThis.fetch = fakeFetch;
  consoleSocket.create = (url, options) => new FakeSocket(url, options);
  Object.assign(consoleTiming, { connectMs: 1000, outputMs: 0 });
});

after(() => {
  globalThis.fetch = realFetch;
  consoleSocket.create = realCreate;
});

beforeEach(async () => {
  Object.assign(fake, { state: 'running', commands: [], sockets: [], websocket: true });
  await updateWhitelistConfig(guild.id, (data) => {
    Object.assign(data, { enabled: false, channelId: null, panelUrl: PANEL, serverId: SERVER_ID, apiKey: KEY, consoleChannelId: consoleChannel.id });
  });
});

test('console text helpers', () => {
  assert.deepEqual(parseConsoleCommands('/list\n\n  say Cześć  \n//time set day'), ['list', 'say Cześć', 'time set day']);
  assert.equal(cleanConsoleLine('\u001b[33m[INFO]: Done\u001b[0m\r'), '[INFO]: Done');
  const output = formatConsoleOutput(['a ``` b', ...Array.from({ length: 200 }, (_, i) => `line ${i} ${'x'.repeat(20)}`)]);
  assert.ok(output.length <= 1900, String(output.length));
  assert.match(output, /line 199/, 'the newest lines are kept');
  assert.ok(!output.slice(3, -3).includes('```'), 'output cannot close the code block');
});

test('an administrator runs a command and sees the console output', async () => {
  const result = await type(admin, '/list');
  assert.equal(result.handled, true);
  assert.equal(result.ok, true, result.text);
  assert.deepEqual(fake.commands, ['list']);
  assert.match(result.text, /There are 2 of a max of 20 players online: Pikczu, Notch/);
  assert.ok(!result.text.includes('\u001b'), 'colour codes are removed');
  assert.equal(fake.sockets[0].options.origin, PANEL, 'Wings checks the Origin header');
  assert.ok(fake.sockets.every((socket) => socket.closed), 'the socket is closed afterwards');
  assert.deepEqual(result.message.answers[0].allowedMentions.parse, [], 'console output never pings anyone');

  const two = await type(admin, 'say Hej\ntime set day');
  assert.deepEqual(fake.commands.slice(1), ['say Hej', 'time set day']);
  assert.match(two.text, /ran say Hej[\s\S]*ran time set day/);
});

test('only administrators: Manage Server is not enough', async () => {
  const result = await type(manager, 'op Moderator', 'pl');
  assert.equal(result.handled, true);
  assert.equal(result.ok, false);
  assert.match(result.text, /Tylko administratorzy/);
  assert.deepEqual(fake.commands, []);
});

test('without the websocket the command still runs; errors and limits are explained', async () => {
  fake.websocket = false;
  const quiet = await type(admin, 'save-all');
  assert.equal(quiet.ok, true);
  assert.deepEqual(fake.commands, ['save-all']);
  assert.equal(quiet.message.answers.length, 0);

  fake.state = 'offline';
  const stopped = await type(admin, 'list');
  assert.equal(stopped.ok, false);
  assert.match(stopped.text, /not running/);

  const many = await type(admin, 'a\nb\nc\nd\ne\nf');
  assert.match(many.text, /At most 5 commands/);
  assert.equal(fake.commands.length, 1);

  const other = mockMessage(admin, 'list', mockChannel(guild, 'ogolny'));
  assert.equal(await handleConsoleMessage(other), false);
});
