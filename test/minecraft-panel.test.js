// Web panel (pikczu.pl/bot) view of the Minecraft whitelist: settings over real HTTP, a fake
// Pterodactyl panel behind globalThis.fetch, and the rule that the panel API key never leaves the bot.
import './helpers/env.js';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { Collection } from 'discord.js';
import { mockChannel, mockGuild, mockMember, mockRole, mockUser } from './helpers/mock.js';
import { initializeDatabase } from '../src/utils/database.js';
import { getWhitelistConfig, updateWhitelistConfig } from '../src/services/minecraftWhitelist.js';

const KEY = 'test-panel-key-0123456789abcdef';
const PANEL = 'https://ptero.mathost.eu';
const SERVER_ID = 'abc12345';
const MC_KEY = 'ptlc_TestKeyForTheFakePanel0123456789';
const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null } };
const realFetch = globalThis.fetch;
const panelRequests = [];
let server;
let base;
let guild;
let channel;

// The fake hosting panel knows one server; requests to the local panel API go through untouched.
async function fakeFetch(url, options = {}) {
  const address = new URL(url);
  if (address.hostname === '127.0.0.1') return realFetch(url, options);
  panelRequests.push({ url: String(url), auth: options.headers?.Authorization });
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const known = `/api/client/servers/${SERVER_ID}`;
  if (address.origin !== PANEL || !address.pathname.startsWith(known)) return json(404, { errors: [{ detail: 'not found' }] });
  if (options.headers?.Authorization !== `Bearer ${MC_KEY}`) return json(401, { errors: [{ detail: 'Unauthenticated.' }] });
  const path = address.pathname.slice(known.length);
  if (path === '') return json(200, { attributes: { name: 'Klubik SMP' } });
  if (path === '/resources') return json(200, { attributes: { current_state: 'running' } });
  if (path === '/files/contents') return new Response('white-list=true\n', { status: 200 });
  return json(404, { errors: [{ detail: 'route' }] });
}

async function call(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, text, json: JSON.parse(text) };
}

const patch = (body) => call('PATCH', `/guilds/${guild.id}/minecraft`, body);

before(async () => {
  process.env.PANEL_API_KEY = KEY;
  const { db } = await initializeDatabase();
  client.db = db;
  guild = mockGuild(client, 'Minecraft · MatHost');
  channel = mockChannel(guild, 'whitelista');
  globalThis.fetch = fakeFetch;

  const { createPanelRouter } = await import('../src/api/panelApi.js');
  const app = express();
  app.use('/api/v1', createPanelRouter(client));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});

after(async () => {
  globalThis.fetch = realFetch;
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(async () => {
  panelRequests.length = 0;
  channel.sent.length = 0;
  await updateWhitelistConfig(guild.id, (data) => {
    Object.assign(data, { enabled: true, channelId: channel.id, roleId: null, removeOnLeave: true, panelUrl: PANEL, serverId: SERVER_ID, apiKey: MC_KEY, members: {} });
  });
});

test('the panel sees the settings and the members, never the API key', async () => {
  const player = mockMember(guild, mockUser('Gracz1'));
  await updateWhitelistConfig(guild.id, (data) => { data.members[player.id] = { name: 'Pikczu', at: 1760000000000 }; });

  const view = await call('GET', `/guilds/${guild.id}/minecraft`);
  assert.equal(view.status, 200);
  assert.deepEqual(view.json, {
    enabled: true,
    channelId: channel.id,
    roleId: null,
    removeOnLeave: true,
    panelUrl: PANEL,
    serverId: SERVER_ID,
    hasKey: true,
    members: { [player.id]: { name: 'Pikczu', at: 1760000000000, user: 'Gracz1' } },
    consoleChannelId: null,
    consolePublic: false,
    chatChannelId: null,
    chatEvents: true,
    chatRecent: [],
    backupEveryHours: 0,
    lastBackup: null,
  });
  assert.ok(!view.text.includes(MC_KEY));

  const overview = await call('GET', `/guilds/${guild.id}`);
  assert.deepEqual(overview.json.modules.minecraft, view.json);
  assert.ok(!overview.text.includes(MC_KEY), 'the key is not in the guild overview either');
  assert.deepEqual(panelRequests, [], 'reading the settings does not call the hosting panel');
});

test('settings are saved; a new channel gets the guide message', async () => {
  const nicks = mockChannel(guild, 'nicki');
  const role = mockRole(guild, 'Whitelista');
  const saved = await patch({ channelId: nicks.id, roleId: role.id, removeOnLeave: false });
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(
    { channel: saved.json.channelId, role: saved.json.roleId, leave: saved.json.removeOnLeave, posted: saved.json.guidePosted, key: saved.json.hasKey },
    { channel: nicks.id, role: role.id, leave: false, posted: true, key: true },
  );
  assert.ok(!saved.text.includes(MC_KEY));
  assert.equal(nicks.sent.length, 1);
  assert.match(nicks.sent[0].embeds[0].toJSON().title, /Minecraft/);
  const stored = await getWhitelistConfig(guild.id);
  assert.equal(stored.apiKey, MC_KEY, 'the saved key stays');
  assert.equal(stored.channelId, nicks.id);

  // Same channel again: no second guide unless asked for.
  const same = await patch({ channelId: nicks.id });
  assert.equal(same.json.guidePosted, undefined);
  assert.equal(nicks.sent.length, 1);
  const again = await patch({ postGuide: true });
  assert.equal(again.json.guidePosted, true);
  assert.equal(nicks.sent.length, 2);

  // Off: the bot stops reading the channel; the key and the members stay.
  const off = await patch({ enabled: false, roleId: null });
  assert.deepEqual([off.json.enabled, off.json.roleId, off.json.hasKey], [false, null, true]);
  assert.deepEqual(panelRequests, []);
});

test('the API key can never be set or changed from the panel', async () => {
  for (const apiKey of ['ptlc_SomeOtherKeySomeOtherKey', null, '']) {
    const refused = await patch({ apiKey, enabled: true });
    assert.equal(refused.status, 400);
    assert.match(refused.json.error, /^apiKey:/);
  }
  assert.equal((await getWhitelistConfig(guild.id)).apiKey, MC_KEY);
});

test('a saved key is never sent to a different panel address', async () => {
  const moved = await patch({ panelUrl: 'panel.inny-host.pl' });
  assert.equal(moved.status, 400);
  assert.match(moved.json.error, /never sent to another panel/);
  assert.equal((await getWhitelistConfig(guild.id)).panelUrl, PANEL);
  assert.deepEqual(panelRequests, []);

  // The same address written differently is not a change.
  assert.equal((await patch({ panelUrl: 'https://ptero.mathost.eu/server/abc12345' })).status, 200);

  for (const panelUrl of ['http://ptero.mathost.eu', 'https://127.0.0.1', 'nie-adres']) {
    assert.equal((await patch({ panelUrl })).status, 400, panelUrl);
  }

  // Without a saved key the address can change freely (nothing secret goes anywhere).
  await updateWhitelistConfig(guild.id, (data) => { Object.assign(data, { apiKey: null, enabled: false }); });
  const free = await patch({ panelUrl: 'panel.inny-host.pl' });
  assert.equal(free.status, 200, free.text);
  assert.equal(free.json.panelUrl, 'https://panel.inny-host.pl');
  assert.equal(free.json.hasKey, false);
});

test('another server ID is checked with the saved key on the same panel only', async () => {
  const unknown = await patch({ serverId: 'zzz99999' });
  assert.equal(unknown.status, 400);
  assert.match(unknown.json.error, /^serverId: (The panel does not know this server|Panel nie zna tego serwera)/);
  assert.equal((await getWhitelistConfig(guild.id)).serverId, SERVER_ID);
  assert.ok(panelRequests.length > 0);
  assert.ok(panelRequests.every((request) => request.url.startsWith(`${PANEL}/`) && !request.url.includes(MC_KEY)));

  assert.equal((await patch({ serverId: 'abc 123' })).status, 400);
  const link = await patch({ serverId: `${PANEL}/server/ABC12345/console` });
  assert.equal(link.status, 200, link.text);
  assert.equal(link.json.serverId, SERVER_ID);
});

test('the whitelist cannot be turned on without a key, a channel or a role the bot can give', async () => {
  await updateWhitelistConfig(guild.id, (data) => { Object.assign(data, { apiKey: null, enabled: false }); });
  const noKey = await patch({ enabled: true });
  assert.equal(noKey.status, 400);
  assert.match(noKey.json.error, /minecraft whitelista ustaw/);

  await updateWhitelistConfig(guild.id, (data) => { data.apiKey = MC_KEY; });
  assert.match((await patch({ enabled: true, channelId: null })).json.error, /^channelId:/);
  assert.equal((await patch({ channelId: '123456789012345678' })).status, 400);
  assert.equal((await patch({ removeOnLeave: 'tak' })).status, 400);

  const managed = mockRole(guild, 'Bot role', { managed: true });
  assert.equal((await patch({ roleId: managed.id })).status, 400);
  const high = mockRole(guild, 'Szef', { position: 50 });
  assert.match((await patch({ roleId: high.id })).json.error, /above the bot/);

  const blind = mockChannel(guild, 'tajny', { permissionsFor: () => null });
  assert.match((await patch({ channelId: blind.id })).json.error, /the bot needs to see the channel/);
  assert.equal((await getWhitelistConfig(guild.id)).channelId, channel.id);
});

test('console channel from the panel: needs a key, never the nick channel, posts the guide, null turns it off', async () => {
  const consoleChannel = mockChannel(guild, 'konsola');
  const on = await patch({ consoleChannelId: consoleChannel.id });
  assert.equal(on.status, 200, on.text);
  assert.equal(on.json.consoleChannelId, consoleChannel.id);
  assert.equal(on.json.consolePublic, true, 'the mock channel is visible to @everyone');
  assert.equal(consoleChannel.sent.length, 1, 'the console guide is posted');
  assert.equal((await getWhitelistConfig(guild.id)).consoleChannelId, consoleChannel.id);

  // Saving the same channel again does not post the guide again.
  assert.equal((await patch({ consoleChannelId: consoleChannel.id })).status, 200);
  assert.equal(consoleChannel.sent.length, 1);

  assert.match((await patch({ consoleChannelId: channel.id })).json.error, /^consoleChannelId: this is the whitelist channel/);
  const off = await patch({ consoleChannelId: null });
  assert.equal(off.status, 200, off.text);
  assert.equal(off.json.consoleChannelId, null);

  await updateWhitelistConfig(guild.id, (data) => { Object.assign(data, { apiKey: null, enabled: false }); });
  assert.match((await patch({ consoleChannelId: consoleChannel.id })).json.error, /^consoleChannelId: connect the server panel/);
  assert.equal((await getWhitelistConfig(guild.id)).consoleChannelId, null);
});

test('chat channel from the panel: needs a key, not the nick or console channel; events switch', async () => {
  const chatChannel = mockChannel(guild, 'czat-mc');
  const on = await patch({ chatChannelId: chatChannel.id, chatEvents: false });
  assert.equal(on.status, 200, on.text);
  assert.equal(on.json.chatChannelId, chatChannel.id);
  assert.equal(on.json.chatEvents, false);
  assert.match((await patch({ chatChannelId: channel.id })).json.error, /^chatChannelId: pick a channel/);
  assert.equal((await patch({ chatEvents: 'tak' })).status, 400);
  const off = await patch({ chatChannelId: null });
  assert.equal(off.json.chatChannelId, null);
  await updateWhitelistConfig(guild.id, (data) => { Object.assign(data, { apiKey: null, enabled: false }); });
  assert.match((await patch({ chatChannelId: chatChannel.id })).json.error, /^chatChannelId: connect the server panel/);
});

test('backups from the panel: every N hours needs a key; the chat preview lists the latest lines', async () => {
  const { handleConsoleLine } = await import('../src/services/minecraftChat.js');
  const set = await patch({ backupEveryHours: 12 });
  assert.equal(set.status, 200, set.text);
  assert.equal(set.json.backupEveryHours, 12);
  assert.ok((await getWhitelistConfig(guild.id)).lastAutoBackupAt > 0);
  assert.equal((await patch({ backupEveryHours: 500 })).status, 400);
  assert.equal((await patch({ backupEveryHours: 0 })).json.backupEveryHours, 0);

  handleConsoleLine({ guild, events: true, queue: [], flushTimer: true }, '[12:00:00 INFO]: <Steve> siema');
  handleConsoleLine({ guild, events: false, queue: [], flushTimer: true }, '[12:00:01 INFO]: Steve joined the game');
  const view = await patch({});
  assert.deepEqual(view.json.chatRecent.map((item) => [item.type, item.name, item.text]), [['chat', 'Steve', 'siema']]);

  await updateWhitelistConfig(guild.id, (data) => { Object.assign(data, { apiKey: null, enabled: false }); });
  assert.match((await patch({ backupEveryHours: 6 })).json.error, /^backupEveryHours: connect the server panel/);
});
