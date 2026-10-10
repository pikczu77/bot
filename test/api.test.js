// Panel API: authentication and validated settings changes over real HTTP.
import './helpers/env.js';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { Collection } from 'discord.js';
import { mockChannel, mockGuild, mockRole } from './helpers/mock.js';
import { initializeDatabase } from '../src/utils/database.js';
import { getAutomodConfig } from '../src/services/automodService.js';
import { getGuildLocale } from '../src/services/languageService.js';

const KEY = 'test-panel-key-0123456789abcdef';
const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null } };
let server;
let base;
let guild;
let channel;

async function call(method, path, { body, key = KEY } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, json: await response.json() };
}

before(async () => {
  process.env.PANEL_API_KEY = KEY;
  const { db } = await initializeDatabase();
  client.db = db;
  guild = mockGuild(client);
  channel = mockChannel(guild, 'powitania', { rawPosition: 1 });
  mockRole(guild, 'Nowy Film');

  const { createPanelRouter } = await import('../src/api/panelApi.js');
  const app = express();
  app.use('/api/v1', createPanelRouter(client));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});

after(() => new Promise((resolve) => server.close(resolve)));

test('requests without the right key are refused', async () => {
  assert.equal((await call('GET', '/guilds', { key: null })).status, 401);
  assert.equal((await call('GET', '/guilds', { key: 'wrong-key-wrong-key-wrong-key' })).status, 401);
  assert.equal((await call('PATCH', `/guilds/${guild.id}/language`, { key: null, body: { language: 'en' } })).status, 401);
});

test('the API stays off without a strong key', async () => {
  const { createPanelRouter } = await import('../src/api/panelApi.js');
  process.env.PANEL_API_KEY = '';
  assert.equal(createPanelRouter(client), null);
  process.env.PANEL_API_KEY = 'short';
  assert.equal(createPanelRouter(client), null);
  process.env.PANEL_API_KEY = KEY;
});

test('guild overview lists channels, roles and module settings', async () => {
  const list = await call('GET', '/guilds');
  assert.equal(list.status, 200);
  assert.equal(list.json.guilds[0].id, guild.id);

  const overview = await call('GET', `/guilds/${guild.id}`);
  assert.equal(overview.status, 200);
  assert.ok(overview.json.channels.some((entry) => entry.id === channel.id));
  assert.ok(overview.json.roles.some((role) => role.name === 'Nowy Film'));
  assert.equal(overview.json.modules.automod.enabled, false);
  assert.deepEqual(overview.json.modules.youtube, []);

  assert.equal((await call('GET', '/guilds/123456789012345678')).status, 404);
});

test('language and automod changes are validated and saved', async () => {
  const language = await call('PATCH', `/guilds/${guild.id}/language`, { body: { language: 'en' } });
  assert.deepEqual(language.json, { language: 'en' });
  assert.equal(await getGuildLocale(client, guild.id), 'en');
  assert.equal((await call('PATCH', `/guilds/${guild.id}/language`, { body: { language: 'de' } })).status, 400);

  const automod = await call('PATCH', `/guilds/${guild.id}/automod`, {
    body: { enabled: true, logChannelId: channel.id, rules: { spam: { enabled: true, limit: 5, seconds: 4 }, words: { enabled: true, list: ['Brzydkie', 'brzydkie', 'spam*'] } } },
  });
  assert.equal(automod.status, 200);
  assert.deepEqual(automod.json.rules.words.list, ['brzydkie', 'spam*']);
  const saved = await getAutomodConfig(guild.id, { fresh: true });
  assert.equal(saved.enabled, true);
  assert.equal(saved.rules.spam.limit, 5);
  assert.equal(saved.logChannelId, channel.id);

  for (const body of [
    { rules: { nope: { enabled: true } } },
    { rules: { spam: { action: 'ban' } } },
    { rules: { spam: { limit: 1000 } } },
    { logChannelId: '123456789012345678' },
    { enabled: 'yes' },
  ]) {
    assert.equal((await call('PATCH', `/guilds/${guild.id}/automod`, { body })).status, 400, JSON.stringify(body));
  }
});

test('welcome settings need a real channel before they can be enabled', async () => {
  assert.equal((await call('PATCH', `/guilds/${guild.id}/welcome`, { body: { enabled: true } })).status, 400);
  const saved = await call('PATCH', `/guilds/${guild.id}/welcome`, { body: { enabled: true, channelId: channel.id, message: 'Siema {user}!', ping: true } });
  assert.equal(saved.status, 200);
  assert.deepEqual(
    { enabled: saved.json.enabled, channelId: saved.json.channelId, message: saved.json.message, ping: saved.json.ping },
    { enabled: true, channelId: channel.id, message: 'Siema {user}!', ping: true },
  );
  assert.equal((await call('PATCH', `/guilds/${guild.id}/welcome`, { body: { image: 'http://insecure.example/a.png' } })).status, 400);
});

test('a followed YouTube channel can be edited and paused from the panel', async () => {
  const { addFeed, getFeeds } = await import('../src/services/notifications/youtube.js');
  const feedId = 'UC' + 'a'.repeat(22);
  await addFeed(guild.id, { id: feedId, name: 'Pikczu', channelId: channel.id, roleId: null, includeShorts: true, message: null, seen: ['old-video'] });

  const listed = await call('GET', `/guilds/${guild.id}`);
  assert.equal(listed.json.modules.youtube[0].paused, false);

  const edited = await call('PATCH', `/guilds/${guild.id}/youtube/${feedId}`, { body: { paused: true, includeShorts: false, message: '{channel}: {title} {url}' } });
  assert.equal(edited.status, 200);
  assert.deepEqual(
    { paused: edited.json.paused, includeShorts: edited.json.includeShorts, message: edited.json.message, channelId: edited.json.channelId },
    { paused: true, includeShorts: false, message: '{channel}: {title} {url}', channelId: channel.id },
  );
  const [stored] = await getFeeds(guild.id);
  assert.equal(stored.paused, true);
  assert.deepEqual(stored.seen, ['old-video']);

  assert.equal((await call('PATCH', `/guilds/${guild.id}/youtube/${feedId}`, { body: { channelId: '123' } })).status, 400);
  assert.equal((await call('PATCH', `/guilds/${guild.id}/youtube/${feedId}`, { body: { roleId: '999999999999999999' } })).status, 400);
  assert.equal((await call('PATCH', `/guilds/${guild.id}/youtube/${feedId}`, { body: { paused: 'yes' } })).status, 400);
  assert.equal((await getFeeds(guild.id))[0].channelId, channel.id);

  const unknown = 'UC' + 'b'.repeat(22);
  assert.equal((await call('PATCH', `/guilds/${guild.id}/youtube/${unknown}`, { body: { paused: true } })).status, 404);
  assert.equal((await call('POST', `/guilds/${guild.id}/youtube/${unknown}/test`)).status, 404);
  assert.equal((await call('POST', `/guilds/${guild.id}/youtube/${feedId}/test`, { key: null })).status, 401);
});
