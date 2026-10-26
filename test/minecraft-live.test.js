// Public Minecraft status for pikczu.pl/smp (src/services/minecraftLive.js): a fake Pterodactyl panel and a fake
// mcsrvstat.us behind globalThis.fetch, the panel API route over real HTTP, and the rule that the address,
// version, player limit, Discord names and chat never reach the website.
import './helpers/env.js';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { Collection } from 'discord.js';
import { mockGuild, mockUser } from './helpers/mock.js';
import { initializeDatabase } from '../src/utils/database.js';
import { updateWhitelistConfig } from '../src/services/minecraftWhitelist.js';
import { liveServers, liveView, pollGuildLive, pollMinecraftLive, resetLive } from '../src/services/minecraftLive.js';

const KEY = 'test-panel-key-0123456789abcdef';
const PANEL = 'https://ptero.mathost.eu';
const SERVER_ID = 'abc12345';
const MC_KEY = 'ptlc_TestKeyForTheFakePanel0123456789';
const ADDRESS = '203.0.113.7:25577';
const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null } };
const realFetch = globalThis.fetch;
const fake = { state: 'running', uptime: 7_200_000, names: [], count: null, ip: '203.0.113.7', alias: null, pings: [], pingFails: false };
let server;
let base;
let guild;
let other;

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function fakeFetch(url, options = {}) {
  const address = new URL(url);
  if (address.hostname === '127.0.0.1') return realFetch(url, options);
  if (address.hostname === 'api.mcsrvstat.us') {
    fake.pings.push(decodeURIComponent(address.pathname.split('/').pop()));
    if (fake.pingFails) return json(500, {});
    const online = fake.names.length > 0 || fake.count > 0;
    return json(200, {
      online: true, ip: '203.0.113.7', port: 25577, hostname: 'secret.example.net', version: 'Paper 1.21.11',
      motd: { clean: ['Club SMP'] },
      players: { online: fake.count ?? fake.names.length, max: 40, list: online ? fake.names.map((name) => ({ name, uuid: `uuid-${name}` })) : [] },
    });
  }
  const known = `/api/client/servers/${SERVER_ID}`;
  if (address.origin !== PANEL || !address.pathname.startsWith(known)) return json(404, { errors: [] });
  if (options.headers?.Authorization !== `Bearer ${MC_KEY}`) return json(401, { errors: [] });
  const path = address.pathname.slice(known.length);
  if (path === '') {
    return json(200, { attributes: { name: 'Club SMP', relationships: { allocations: { data: [
      { object: 'allocation', attributes: { ip: '10.0.0.5', ip_alias: null, port: 25599, is_default: false } },
      { object: 'allocation', attributes: { ip: fake.ip, ip_alias: fake.alias, port: 25577, is_default: true } },
    ] } } } });
  }
  if (path === '/resources') return json(200, { attributes: { current_state: fake.state, resources: { uptime: fake.state === 'running' ? fake.uptime : 0 } } });
  return json(404, { errors: [] });
}

async function call(path, key = KEY) {
  const response = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${key}` } });
  const text = await response.text();
  return { status: response.status, text, json: JSON.parse(text) };
}

before(async () => {
  process.env.PANEL_API_KEY = KEY;
  const { db } = await initializeDatabase();
  client.db = db;
  guild = mockGuild(client, 'Minecraft · MatHost');
  other = mockGuild(client, 'Klubik Pikcza');
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
  resetLive();
  Object.assign(fake, { state: 'running', uptime: 7_200_000, names: [], count: null, ip: '203.0.113.7', alias: null, pings: [], pingFails: false });
  const members = {};
  ['Pikczu', 'NocnyMarek', 'Budowniczy7', 'Steve_PL'].forEach((name, index) => {
    members[mockUser(`Discordowy${index}`).id] = { name, at: 1760000000000 + index };
  });
  await updateWhitelistConfig(guild.id, (data) => Object.assign(data, { enabled: true, panelUrl: PANEL, serverId: SERVER_ID, apiKey: MC_KEY, members }));
  await client.db.set(`guild:${guild.id}:minecraft-live`, { seen: {} });
});

test('a guild without a connected panel is skipped', async () => {
  assert.equal(await pollGuildLive(other.id), null);
  const { servers } = await liveServers(client);
  assert.deepEqual(servers.map((item) => item.guildId), [guild.id]);
});

test('players online come first, longest playing first; the rest of the whitelist after them', async () => {
  fake.names = ['NocnyMarek'];
  await pollGuildLive(guild.id, 1_000_000);
  fake.names = ['NocnyMarek', 'Pikczu'];
  await pollGuildLive(guild.id, 1_060_000);
  const view = await liveView(guild.id);
  assert.equal(view.state, 'running');
  assert.equal(view.startedAt, 1_060_000 - 7_200_000);
  assert.equal(view.count, 2);
  assert.deepEqual(view.players, [
    { name: 'NocnyMarek', online: true, since: 1_000_000 },
    { name: 'Pikczu', online: true, since: 1_060_000 },
    { name: 'Budowniczy7', online: false, lastSeen: null },
    { name: 'Steve_PL', online: false, lastSeen: null },
  ]);
  // The game address comes from the panel's default allocation, not the other one.
  assert.deepEqual([...new Set(fake.pings)], [ADDRESS]);
});

test('a player who leaves gets "last seen"; the most recently seen comes first', async () => {
  fake.names = ['Steve_PL', 'Budowniczy7'];
  await pollGuildLive(guild.id, 2_000_000);
  fake.names = ['Budowniczy7'];
  await pollGuildLive(guild.id, 2_060_000);
  fake.names = [];
  await pollGuildLive(guild.id, 2_120_000);
  const view = await liveView(guild.id);
  assert.deepEqual(view.players.map((p) => [p.name, p.online, p.lastSeen]), [
    ['Budowniczy7', false, 2_120_000],
    ['Steve_PL', false, 2_060_000],
    ['NocnyMarek', false, null],
    ['Pikczu', false, null],
  ]);
});

test('"last seen" survives a restart (memory gone, store kept)', async () => {
  fake.names = ['Pikczu'];
  await pollGuildLive(guild.id, 3_000_000);
  fake.names = [];
  await pollGuildLive(guild.id, 3_060_000);
  resetLive();
  const view = await liveView(guild.id);
  assert.equal(view.state, null);
  assert.equal(view.players.find((p) => p.name === 'Pikczu').lastSeen, 3_060_000);
});

test('a sample of names (big server) never marks anyone as gone', async () => {
  fake.names = ['Pikczu', 'NocnyMarek'];
  await pollGuildLive(guild.id, 4_000_000);
  fake.names = ['Pikczu'];
  fake.count = 2;
  await pollGuildLive(guild.id, 4_060_000);
  const view = await liveView(guild.id);
  assert.equal(view.count, 2);
  assert.equal(view.players.find((p) => p.name === 'NocnyMarek').lastSeen, 4_000_000);
});

test('a stopped server: nobody online, everyone who was there is last seen now, no ping', async () => {
  fake.names = ['Pikczu'];
  await pollGuildLive(guild.id, 5_000_000);
  fake.state = 'offline';
  fake.pings = [];
  await pollGuildLive(guild.id, 5_060_000);
  const view = await liveView(guild.id);
  assert.equal(view.state, 'offline');
  assert.equal(view.startedAt, null);
  assert.equal(view.count, 0);
  assert.equal(view.players.every((p) => !p.online), true);
  assert.equal(view.players.find((p) => p.name === 'Pikczu').lastSeen, 5_060_000);
  assert.deepEqual(fake.pings, []);
});

test('a failed ping keeps the last known state; the job carries on with other guilds', async () => {
  fake.names = ['Pikczu'];
  await pollGuildLive(guild.id, 6_000_000);
  fake.pingFails = true;
  await pollMinecraftLive(client);
  const view = await liveView(guild.id);
  assert.equal(view.checkedAt, 6_000_000);
  assert.equal(view.players[0].online, true);
});

test('the panel only knows 0.0.0.0: no address, the poll fails without guessing', async () => {
  fake.ip = '0.0.0.0';
  await assert.rejects(pollGuildLive(guild.id, 7_000_000), /no game address/);
  assert.deepEqual(fake.pings, []);
});

test('a server tracked with /minecraft track wins over the panel allocation', async () => {
  await client.db.set(`guild:${guild.id}:minecraft`, { servers: [{ address: 'gra.example.pl', bedrock: false, channelId: null }] });
  fake.names = ['Pikczu'];
  await pollGuildLive(guild.id, 8_000_000);
  assert.deepEqual(fake.pings, ['gra.example.pl']);
  await client.db.set(`guild:${guild.id}:minecraft`, { servers: [] });
});

test('GET /minecraft/live: key required; no address, version, limit, Discord names or panel data', async () => {
  fake.names = ['Pikczu'];
  await pollGuildLive(guild.id, 9_000_000);
  assert.equal((await call('/minecraft/live', 'wrong-key')).status, 401);
  const { status, text, json: body } = await call('/minecraft/live');
  assert.equal(status, 200);
  assert.equal(body.servers.length, 1);
  assert.deepEqual(Object.keys(body.servers[0]).sort(), ['checkedAt', 'count', 'guildId', 'players', 'startedAt', 'state']);
  for (const secret of ['203.0.113.7', '25577', 'secret.example.net', 'Paper', '1.21', '"max"', 'Discordowy', 'ptlc_', 'mathost', 'Club SMP']) {
    assert.equal(text.includes(secret), false, `leaked: ${secret}`);
  }
});
