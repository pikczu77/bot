// Picture channels (fan art, 2026-10-26): hearts under pictures, other messages deleted, optional thread,
// /channel zdjecia and the panel module.
import './helpers/env.js';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { Collection } from 'discord.js';
import { mockChannel, mockGuild, mockInteraction, mockMember, mockUser, replyText } from './helpers/mock.js';
import { runWithLocale } from '../src/i18n/index.js';
import { initializeDatabase } from '../src/utils/database.js';
import { loadCommands } from '../src/handlers/loaders/commandLoader.js';
import { handleMediaMessage, hasMedia, parseReactions, setMediaChannel } from '../src/services/mediaChannels.js';

const KEY = 'test-panel-key-0123456789abcdef';
const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null } };
let guild;
let fanart;
let server;
let base;

before(async () => {
  process.env.PANEL_API_KEY = KEY;
  const { db } = await initializeDatabase();
  client.db = db;
  await loadCommands(client);
  guild = mockGuild(client, 'Fanarty');
  fanart = mockChannel(guild, 'fanarty');
  const { createPanelRouter } = await import('../src/api/panelApi.js');
  const app = express();
  app.use('/api/v1', createPanelRouter(client));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function post(member, { content = '', files = [], channel = fanart } = {}) {
  const message = {
    guild, member, author: member.user, channel, channelId: channel.id, content,
    attachments: new Collection(files.map((file, index) => [String(index), file])),
    embeds: [], stickers: new Collection(), reactions: [], deleted: false, threads: [],
    react: async (emoji) => { message.reactions.push(emoji); },
    delete: async () => { message.deleted = true; },
    startThread: async (options) => { message.threads.push(options); },
  };
  return message;
}

test('what counts as a picture: image or video files, image links, art sites', () => {
  const member = mockMember(guild, mockUser('Artysta'));
  assert.equal(hasMedia(post(member, { files: [{ contentType: 'image/png', url: 'https://cdn/x.png' }] })), true);
  assert.equal(hasMedia(post(member, { files: [{ contentType: 'video/mp4', url: 'https://cdn/x.mp4' }] })), true);
  assert.equal(hasMedia(post(member, { files: [{ contentType: 'application/pdf', url: 'https://cdn/x.pdf' }] })), false);
  assert.equal(hasMedia(post(member, { content: 'patrzcie https://i.imgur.com/abc.jpg' })), true);
  assert.equal(hasMedia(post(member, { content: 'https://www.deviantart.com/someone/art/1' })), true);
  assert.equal(hasMedia(post(member, { content: 'ładne!' })), false);
  assert.deepEqual(parseReactions('❤️ 🔥 ❤️ <:pikczu:123456789012345678> tekst'), ['<:pikczu:123456789012345678>', '❤️', '🔥']);
});

test('a picture gets hearts (and a thread when on); text disappears with a short notice; moderators may write', async () => {
  await setMediaChannel(guild.id, fanart.id, {});
  const artist = mockMember(guild, mockUser('Rysownik'));
  const picture = post(artist, { files: [{ contentType: 'image/jpeg', url: 'https://cdn/a.jpg' }] });
  assert.equal(await handleMediaMessage(picture), false);
  assert.deepEqual(picture.reactions, ['❤️']);
  assert.equal(picture.threads.length, 0);

  const text = post(artist, { content: 'ale fajne' });
  assert.equal(await runWithLocale('en', () => handleMediaMessage(text)), true);
  assert.equal(text.deleted, true);
  assert.match(fanart.sent.at(-1).embeds[0].toJSON().description, /pictures only/);

  const mod = mockMember(guild, mockUser('Moderator'), { permissions: ['ManageMessages'] });
  const rules = post(mod, { content: 'Zasady kanału: tylko własne prace' });
  assert.equal(await handleMediaMessage(rules), false);
  assert.equal(rules.deleted, false);

  await setMediaChannel(guild.id, fanart.id, { reactions: ['❤️', '🔥'], thread: true });
  const second = post(artist, { files: [{ contentType: 'image/webp', url: 'https://cdn/b.webp' }] });
  await runWithLocale('en', () => handleMediaMessage(second));
  assert.deepEqual(second.reactions, ['❤️', '🔥']);
  assert.match(second.threads[0].name, /Comments: Rysownik/);

  const other = mockChannel(guild, 'ogolny');
  const elsewhere = post(artist, { content: 'hej', channel: other });
  assert.equal(await handleMediaMessage(elsewhere), false);
  assert.equal(elsewhere.deleted, false);
});

test('panel: the list of picture channels is saved as a whole', async () => {
  const call = async (method, path, body) => {
    const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    return { status: response.status, text, json: JSON.parse(text) };
  };
  const view = (await call('GET', `/guilds/${guild.id}`)).json.modules.mediachannels;
  assert.ok(view.channels.some((entry) => entry.channelId === fanart.id));
  const saved = await call('PATCH', `/guilds/${guild.id}/mediachannels`, { channels: [{ channelId: fanart.id, reactions: ['❤️', '😍'], deleteOther: true, thread: false }] });
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(saved.json.channels, [{ channelId: fanart.id, reactions: ['❤️', '😍'], deleteOther: true, thread: false }]);
  assert.equal((await call('PATCH', `/guilds/${guild.id}/mediachannels`, { channels: [{ channelId: fanart.id }, { channelId: fanart.id }] })).status, 400);
  assert.equal((await call('PATCH', `/guilds/${guild.id}/mediachannels`, { channels: [{ channelId: '123' }] })).status, 400);
  const empty = await call('PATCH', `/guilds/${guild.id}/mediachannels`, { channels: [] });
  assert.deepEqual(empty.json.channels, []);
});
