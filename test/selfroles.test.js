// Role buttons (like the ProBot role message): panel API, the posted message and the button clicks.
import './helpers/env.js';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { Collection, PermissionsBitField } from 'discord.js';
import { mockChannel, mockGuild, mockMember, mockRole, mockUser, replyText } from './helpers/mock.js';
import { initializeDatabase } from '../src/utils/database.js';
import { forgetSelfRoleMessage, getSelfRolePanels, handleSelfRoleButton, isSelfRoleEmoji } from '../src/services/selfRoleService.js';

const KEY = 'test-panel-key-0123456789abcdef';
const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null } };
let server;
let base;
let guild;
let roles;
let channel;
let other;

async function call(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, json: await response.json() };
}

// A text channel that keeps its messages: fetch by ID, edit and delete work like on Discord.
function channelWithMessages(name) {
  const messages = new Map();
  const target = mockChannel(guild, name, { rawPosition: 2 });
  target.deleted = [];
  target.send = async (payload) => {
    const message = {
      id: String(BigInt(Date.now()) * 1000n + BigInt(messages.size + target.deleted.length)),
      channelId: target.id,
      ...payload,
      edits: 0,
      edit: async (next) => { Object.assign(message, next); message.edits += 1; return message; },
      delete: async () => { messages.delete(message.id); target.deleted.push(message.id); },
    };
    messages.set(message.id, message);
    return message;
  };
  target.messages = { fetch: async (id) => messages.get(id) ?? Promise.reject(new Error('Unknown Message')) };
  target.posted = () => [...messages.values()];
  return target;
}

const proBot = () => ({
  channelId: channel.id,
  title: 'Zareaguj, aby wybrać swoje Role',
  description: '➡️ Nowy Film – Otrzymasz powiadomienie za każdym razem, gdy Pikczu opublikuje nowy film na YouTube.',
  color: '#5865f2',
  buttons: [
    { roleId: roles.film.id, label: 'Nowy Film', emoji: '▶️', style: 'primary' },
    { roleId: roles.tablica.id, label: 'Tablica', emoji: '💼', style: 'primary' },
    { roleId: roles.ping.id, label: 'Dod. Ping', emoji: '🔔', style: 'primary' },
    { roleId: roles.dead.id, label: 'Dead Chat', emoji: '💬', style: 'primary' },
  ],
});

before(async () => {
  process.env.PANEL_API_KEY = KEY;
  const { db } = await initializeDatabase();
  client.db = db;
  guild = mockGuild(client);
  roles = {
    film: mockRole(guild, 'Nowy Film'),
    tablica: mockRole(guild, 'Tablica'),
    ping: mockRole(guild, 'Dodatkowy Ping'),
    dead: mockRole(guild, 'Dead Chat'),
    high: mockRole(guild, 'admin', { editable: false }),
    mod: mockRole(guild, 'moderator', { permissions: new PermissionsBitField(['BanMembers']) }),
    bot: mockRole(guild, 'ProBot', { managed: true }),
  };
  channel = channelWithMessages('role');
  other = channelWithMessages('ogloszenia');

  const { createPanelRouter } = await import('../src/api/panelApi.js');
  const app = express();
  app.use('/api/v1', createPanelRouter(client));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});

after(() => new Promise((resolve) => server.close(resolve)));

test('role buttons: emoji check', () => {
  for (const ok of ['🎬', '▶️', '💼', '🔔', '💬', '👍🏽', '🇵🇱', '1️⃣', '<:pikczu:123456789012345678>', '<a:taniec:123456789012345678>']) assert.ok(isSelfRoleEmoji(ok), ok);
  for (const bad of ['', 'a', 'ab', '🎬🎬', '<:x:1>', '<script>', ':pikczu:']) assert.ok(!isSelfRoleEmoji(bad), bad);
});

test('role buttons: the panel posts the ProBot-like message and keeps it in sync', async () => {
  const empty = await call('GET', `/guilds/${guild.id}`);
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.json.modules.selfroles.panels, []);
  assert.equal(empty.json.modules.selfroles.limits.buttons, 25);

  const saved = await call('PATCH', `/guilds/${guild.id}/selfroles`, { panels: [proBot()] });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  const [panel] = saved.json.panels;
  assert.match(panel.id, /^[0-9a-f]{12}$/);
  assert.equal(panel.posted, true);
  assert.equal(panel.buttons.length, 4);

  const [message] = channel.posted();
  assert.equal(message.embeds[0].toJSON().title, 'Zareaguj, aby wybrać swoje Role');
  assert.equal(message.embeds[0].toJSON().color, 0x5865f2);
  const row = message.components[0].toJSON().components;
  assert.deepEqual(row.map((button) => button.label), ['Nowy Film', 'Tablica', 'Dod. Ping', 'Dead Chat']);
  assert.deepEqual(row.map((button) => button.custom_id), [roles.film, roles.tablica, roles.ping, roles.dead].map((role) => `selfrole:${role.id}`));
  assert.equal(row[1].emoji.name, '💼');

  // Same look: nothing is sent or edited. New text: the same message is edited.
  await call('PATCH', `/guilds/${guild.id}/selfroles`, { panels: [{ ...proBot(), id: panel.id }] });
  assert.equal(channel.posted().length, 1);
  assert.equal(message.edits, 0);
  await call('PATCH', `/guilds/${guild.id}/selfroles`, { panels: [{ ...proBot(), id: panel.id, title: 'Wybierz role' }] });
  assert.equal(channel.posted().length, 1);
  assert.equal(message.edits, 1);
  assert.equal(message.embeds[0].toJSON().title, 'Wybierz role');

  // Another channel: a new message there, the old one is removed after the save.
  const moved = await call('PATCH', `/guilds/${guild.id}/selfroles`, { panels: [{ ...proBot(), id: panel.id, channelId: other.id }] });
  assert.equal(moved.status, 200);
  assert.equal(channel.posted().length, 0);
  assert.equal(other.posted().length, 1);
  assert.equal((await getSelfRolePanels(guild.id))[0].messageId, other.posted()[0].id);

  // Repost: a fresh message, the old one goes.
  const before = other.posted()[0].id;
  await call('PATCH', `/guilds/${guild.id}/selfroles`, { panels: [{ ...proBot(), id: panel.id, channelId: other.id, repost: true }] });
  assert.equal(other.posted().length, 1);
  assert.notEqual(other.posted()[0].id, before);

  // Deleted on Discord: the panel stays, marked as not posted; the next save posts it again.
  const gone = other.posted()[0];
  await gone.delete();
  assert.equal(await forgetSelfRoleMessage(guild.id, gone.id), true);
  assert.equal((await call('GET', `/guilds/${guild.id}`)).json.modules.selfroles.panels[0].posted, false);
  await call('PATCH', `/guilds/${guild.id}/selfroles`, { panels: [{ ...proBot(), id: panel.id, channelId: other.id }] });
  assert.equal((await getSelfRolePanels(guild.id))[0].messageId !== null, true);

  // Removed from the list: its message is deleted too.
  const removed = await call('PATCH', `/guilds/${guild.id}/selfroles`, { panels: [] });
  assert.deepEqual(removed.json.panels, []);
  assert.equal(other.posted().length, 0);
});

test('role buttons: wrong settings are refused before anything is sent', async () => {
  const bad = async (panel, pattern) => {
    const sentBefore = channel.posted().length;
    const response = await call('PATCH', `/guilds/${guild.id}/selfroles`, { panels: [{ ...proBot(), ...panel }] });
    assert.equal(response.status, 400, JSON.stringify(response.json));
    assert.match(response.json.error, pattern);
    assert.equal(channel.posted().length, sentBefore);
  };
  await bad({ buttons: [] }, /buttons: 1-25/);
  await bad({ buttons: [{ roleId: roles.high.id, label: 'Admin' }] }, /bot's role must be above/);
  await bad({ buttons: [{ roleId: roles.mod.id, label: 'Mod' }] }, /moderator permissions/);
  await bad({ buttons: [{ roleId: roles.bot.id, label: 'Bot' }] }, /not an assignable role/);
  await bad({ buttons: [{ roleId: roles.film.id, label: 'A' }, { roleId: roles.film.id, label: 'B' }] }, /only once/);
  await bad({ buttons: [{ roleId: roles.film.id }] }, /label or an emoji/);
  await bad({ buttons: [{ roleId: roles.film.id, label: 'x', emoji: 'nie emoji' }] }, /one emoji/);
  await bad({ buttons: [{ roleId: roles.film.id, label: 'x', style: 'link' }] }, /style/);
  await bad({ title: '', description: '' }, /title or a text/);
  await bad({ color: 'zielony' }, /colour/);
  await bad({ channelId: '123' }, /not a text channel/);
  await bad({ id: 'abcdefabcdef' }, /unknown role message/);
  const many = await call('PATCH', `/guilds/${guild.id}/selfroles`, { panels: Array.from({ length: 6 }, proBot) });
  assert.equal(many.status, 400);

  // Without a channel the panel is kept as a draft (not posted).
  const draft = await call('PATCH', `/guilds/${guild.id}/selfroles`, { panels: [{ ...proBot(), channelId: null }] });
  assert.equal(draft.status, 200);
  assert.equal(draft.json.panels[0].posted, false);
  assert.equal(draft.json.panels[0].channelId, null);
  await call('PATCH', `/guilds/${guild.id}/selfroles`, { panels: [] });
});

test('role buttons: a click gives the role, a second click takes it back; "one role" mode swaps', async () => {
  const saved = await call('PATCH', `/guilds/${guild.id}/selfroles`, { panels: [proBot()] });
  const message = channel.posted()[0];
  const member = mockMember(guild, mockUser('Ola'));
  const click = async (role, msg = message) => {
    const replies = [];
    const interaction = {
      guild, member, user: member.user, message: msg,
      inGuild: () => true,
      deferReply: async () => {},
      editReply: async (payload) => { replies.push(payload); },
      replies,
    };
    await handleSelfRoleButton(interaction, client, [role.id]);
    return replyText(interaction);
  };

  assert.match(await click(roles.film), /now have the role/);
  assert.ok(member.roles.cache.has(roles.film.id));
  await click(roles.tablica);
  assert.ok(member.roles.cache.has(roles.film.id) && member.roles.cache.has(roles.tablica.id));
  assert.match(await click(roles.film), /no longer have the role/);
  assert.ok(!member.roles.cache.has(roles.film.id));

  // A button of a message the bot does not know (old panel) does nothing.
  assert.match(await click(roles.film, { id: '1' }), /no longer active/);
  assert.ok(!member.roles.cache.has(roles.film.id));

  // The role moved above the bot after the panel was saved: a clear answer, no change.
  roles.ping.editable = false;
  assert.match(await click(roles.ping), /move my role above/);
  assert.ok(!member.roles.cache.has(roles.ping.id));
  roles.ping.editable = true;

  // One role at a time: the other roles of this message go away.
  await call('PATCH', `/guilds/${guild.id}/selfroles`, { panels: [{ ...proBot(), id: saved.json.panels[0].id, exclusive: true }] });
  assert.match(await click(roles.dead), /Removed/);
  assert.ok(member.roles.cache.has(roles.dead.id) && !member.roles.cache.has(roles.tablica.id));
  await call('PATCH', `/guilds/${guild.id}/selfroles`, { panels: [] });
});
