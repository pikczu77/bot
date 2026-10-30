// Panel API modules added on 2026-10-26: birthdays, giveaways, counting, server stats and modmail.
import './helpers/env.js';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { ChannelType, Collection } from 'discord.js';
import { mockChannel, mockGuild, mockMember, mockRole, mockUser } from './helpers/mock.js';
import { initializeDatabase } from '../src/utils/database.js';
import { setBirthday } from '../src/services/birthdayService.js';
import { getGuildGiveaways, saveGiveaway } from '../src/utils/giveaways.js';
import { getCountingGameConfig, recordCorrectCount } from '../src/services/countingGameService.js';
import { getServerCounters } from '../src/services/serverstatsService.js';
import { getModmailConfig } from '../src/services/modmailService.js';
import { getGuildConfig } from '../src/services/config/guildConfig.js';

const KEY = 'test-panel-key-0123456789abcdef';
const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null, cache: new Collection() }, user: { id: '999999999999999999' } };
let server;
let base;
let guild;
let channel;

async function call(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, text, json: JSON.parse(text) };
}
const patch = (module, body) => call('PATCH', `/guilds/${guild.id}/${module}`, body);

before(async () => {
  process.env.PANEL_API_KEY = KEY;
  const { db } = await initializeDatabase();
  client.db = db;
  guild = mockGuild(client, 'Panel moduły');
  channel = mockChannel(guild, 'ogolny');
  const created = [];
  guild.channels.create = async (options) => {
    const made = mockChannel(guild, options.name, { type: options.type, parentId: options.parent ?? null, setName: async (name) => { made.name = name; return made; } });
    created.push(made);
    return made;
  };
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

test('the guild overview has the five new modules', async () => {
  const modules = (await call('GET', `/guilds/${guild.id}`)).json.modules;
  for (const name of ['birthdays', 'giveaways', 'counting', 'serverstats', 'modmail']) assert.ok(modules[name], name);
  assert.equal(modules.counting.enabled, false);
  assert.ok(modules.counting.systems.some((system) => system.id === 'decimal'));
  assert.equal(modules.serverstats.types.length, 3);
  assert.equal(modules.modmail.enabled, false);
});

test('birthdays: channel and role, the list, removing an entry', async () => {
  const member = mockMember(guild, mockUser('Solenizant'));
  await setBirthday(client, guild.id, member.id, 5, 17);
  const role = mockRole(guild, 'Urodziny');
  const saved = await patch('birthdays', { channelId: channel.id, roleId: role.id });
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.json.channelId, channel.id);
  assert.equal(saved.json.roleId, role.id);
  assert.deepEqual(saved.json.list.map((entry) => [entry.userId, entry.month, entry.day]), [[member.id, 5, 17]]);
  assert.equal((await getGuildConfig(client, guild.id)).birthdayChannelId, channel.id);
  const removed = await patch('birthdays', { remove: member.id });
  assert.equal(removed.json.list.length, 0);
  assert.equal((await patch('birthdays', { channelId: '123' })).status, 400);
});

test('giveaways: start one on a channel, end it now (the job finishes it)', async () => {
  const started = await patch('giveaways', { start: { channelId: channel.id, prize: 'Nitro', minutes: 60, winners: 2 } });
  assert.equal(started.status, 200, started.text);
  assert.equal(started.json.list.length, 1);
  const [giveaway] = started.json.list;
  assert.equal(giveaway.prize, 'Nitro');
  assert.equal(giveaway.winners, 2);
  assert.equal(giveaway.ended, false);
  assert.match(channel.sent.at(-1).content, /GIVEAWAY/);
  const ended = await patch('giveaways', { end: giveaway.id });
  assert.equal(ended.status, 200, ended.text);
  const stored = (await getGuildGiveaways(client, guild.id)).find((entry) => String(entry.messageId) === giveaway.id);
  assert.ok(stored.endsAt <= Date.now(), 'due now, so the giveaway job ends it');
  assert.equal((await patch('giveaways', { end: 'nope' })).status, 404);
  assert.equal((await patch('giveaways', { start: { channelId: channel.id, prize: '', minutes: 5, winners: 1 } })).status, 400);
  assert.equal((await patch('giveaways', { start: { channelId: channel.id, prize: 'x', minutes: 0, winners: 1 } })).status, 400);
});

test('giveaways: entry requirements and bonus entries, new winners, delete', async () => {
  const vip = mockRole(guild, 'VIP');
  const booster = mockRole(guild, 'Booster');
  const started = await patch('giveaways', { start: {
    channelId: channel.id, prize: 'Skin', minutes: 60, winners: 1,
    requirements: { roleId: vip.id, minLevel: 5, minInvites: 2, minAccountAgeDays: 30, minMemberDays: 7 },
    bonus: { roleId: booster.id, entries: 3 },
  } });
  assert.equal(started.status, 200, started.text);
  assert.deepEqual(started.json.features, ['requirements', 'reroll', 'remove']);
  const shown = started.json.list.find((entry) => entry.prize === 'Skin');
  assert.deepEqual(shown.requirements, { roleId: vip.id, minLevel: 5, minInvites: 2, minAccountAgeDays: 30, minMemberDays: 7 });
  assert.deepEqual(shown.bonusEntries, [{ roleId: booster.id, entries: 3 }]);
  assert.match(JSON.stringify(channel.sent.at(-1).embeds[0].toJSON()), new RegExp(vip.id), 'the giveaway message names the rules');
  const stored = (await getGuildGiveaways(client, guild.id)).find((entry) => String(entry.messageId) === shown.id);

  const refuse = (start) => patch('giveaways', { start: { channelId: channel.id, prize: 'x', minutes: 5, winners: 1, ...start } });
  assert.equal((await refuse({ requirements: { minLevel: 0 } })).status, 400);
  assert.equal((await refuse({ requirements: { roleId: '123' } })).status, 400);
  assert.equal((await refuse({ bonus: { roleId: booster.id, entries: 21 } })).status, 400);
  const plain = await refuse({ requirements: {}, bonus: {} });
  assert.equal(plain.status, 200, 'nothing filled in: everyone may enter');
  const everyone = plain.json.list.find((entry) => entry.prize === 'x');
  assert.equal(everyone.requirements.roleId, null);
  assert.deepEqual(everyone.bonusEntries, []);

  assert.match((await patch('giveaways', { reroll: shown.id })).json.error, /still running/);
  const a = mockMember(guild, mockUser('Ania'));
  await saveGiveaway(client, guild.id, { ...stored, ended: true, isEnded: true, participants: [], winnerIds: [] });
  assert.match((await patch('giveaways', { reroll: shown.id })).json.error, /not enough entries/);
  await saveGiveaway(client, guild.id, { ...stored, ended: true, isEnded: true, participants: [a.id], winnerIds: [] });
  const sentBefore = channel.sent.length;
  const rerolled = await patch('giveaways', { reroll: shown.id });
  assert.equal(rerolled.status, 200, rerolled.text);
  assert.equal(channel.sent.length, sentBefore + 1);
  assert.match(channel.sent.at(-1).content, new RegExp(a.id));
  assert.deepEqual((await getGuildGiveaways(client, guild.id)).find((entry) => String(entry.messageId) === shown.id).winnerIds, [a.id]);

  assert.equal((await patch('giveaways', { reroll: 'nope' })).status, 404);
  const removed = await patch('giveaways', { remove: shown.id });
  assert.equal(removed.status, 200, removed.text);
  assert.ok(!removed.json.list.some((entry) => entry.id === shown.id));
  assert.equal((await patch('giveaways', { remove: shown.id })).status, 404);
});

test('economy: the badge of the year on the New Year\'s Eve tab', async () => {
  const view = (economy) => economy.seasonal.find((event) => event.id === 'sylwester').yearClaim;
  const overview = (await call('GET', `/guilds/${guild.id}`)).json.modules.economy;
  const start = view(overview);
  assert.equal(start.enabled, false, 'off until the owner sets it');
  assert.equal(start.badgeName, 'Rok 2026');
  assert.deepEqual(start.ranks, ['Halloween 2026', 'Święta 2026', 'Sylwester 2026']);
  assert.equal(overview.seasonal.find((event) => event.id === 'swieta').yearClaim, undefined);

  const part = (yearClaim) => patch('economy', { seasonal: { sylwester: { yearClaim } } });
  const saved = await part({ enabled: true, day: '2026-12-31', hour: 20, hours: 48 });
  assert.equal(saved.status, 200, saved.text);
  const shown = view(saved.json);
  assert.deepEqual([shown.enabled, shown.day, shown.hour, shown.hours], [true, '2026-12-31', 20, 48]);
  assert.equal((await part({ enabled: true, day: '2026-06-01', hour: 20, hours: 48 })).status, 400);
  assert.equal((await part({ enabled: true, day: '2026-12-31', hour: 24, hours: 48 })).status, 400);
  assert.equal((await part({ enabled: true, day: '2026-12-31', hour: 20, hours: 0 })).status, 400);
  assert.equal((await patch('economy', { seasonal: { swieta: { yearClaim: { enabled: true, day: '2026-12-20', hour: 1, hours: 1 } } } })).status, 400);
  const moved = await patch('economy', { seasonal: { sylwester: { year: 2027 } } });
  assert.equal(view(moved.json), null, 'no badge for that year yet');
  await patch('economy', { seasonal: { sylwester: { year: 2026 } } });
});

test('counting: a channel turns it on, the system and the start number change, null turns it off', async () => {
  const counting = mockChannel(guild, 'liczenie');
  const on = await patch('counting', { channelId: counting.id, system: 'roman' });
  assert.equal(on.status, 200, on.text);
  assert.equal(on.json.enabled, true);
  assert.equal(on.json.system, 'roman');
  assert.equal(on.json.next, 'I');
  const member = mockMember(guild, mockUser('Liczący'));
  await recordCorrectCount(client, guild.id, member.id);
  assert.equal((await call('GET', `/guilds/${guild.id}`)).json.modules.counting.top[0].count, 1);
  const reset = await patch('counting', { reset: 10, system: 'decimal' });
  assert.equal(reset.json.next, '10');
  const off = await patch('counting', { channelId: null });
  assert.equal(off.json.enabled, false);
  assert.equal((await getCountingGameConfig(client, guild.id)).enabled, false);
  assert.equal((await patch('counting', { system: 'klingon' })).status, 400);
});

test('server stats: add a counter channel, rename it, one per type, remove it', async () => {
  const category = mockChannel(guild, 'Statystyki', { type: ChannelType.GuildCategory });
  const added = await patch('serverstats', { add: { type: 'members', categoryId: category.id, voice: true, name: 'Ludzie: {count}' } });
  assert.equal(added.status, 200, added.text);
  assert.equal(added.json.counters.length, 1);
  const [counter] = added.json.counters;
  assert.equal(counter.type, 'members');
  assert.equal(counter.name, 'Ludzie: {count}');
  assert.equal((await patch('serverstats', { add: { type: 'members', categoryId: category.id } })).status, 400);
  const renamed = await patch('serverstats', { rename: { id: counter.id, name: null } });
  assert.equal(renamed.json.counters[0].name, null);
  const removed = await patch('serverstats', { remove: counter.id });
  assert.equal(removed.json.counters.length, 0);
  assert.equal((await getServerCounters(client, guild.id)).length, 0);
});

test('modmail: needs a category before it can be on', async () => {
  assert.match((await patch('modmail', { enabled: true })).json.error, /^categoryId/);
  const category = mockChannel(guild, 'Modmail', { type: ChannelType.GuildCategory });
  const staff = mockRole(guild, 'Ekipa');
  const saved = await patch('modmail', { enabled: true, categoryId: category.id, staffRoleId: staff.id, logChannelId: channel.id, greeting: 'Cześć!', anonymous: true });
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(
    { ...saved.json, blocked: undefined },
    { enabled: true, categoryId: category.id, staffRoleId: staff.id, logChannelId: channel.id, greeting: 'Cześć!', anonymous: true, blocked: undefined },
  );
  assert.equal((await getModmailConfig(guild.id)).greeting, 'Cześć!');
  assert.equal((await patch('modmail', { categoryId: channel.id })).status, 400);
});

test('economy events from the panel: settings, start one (announced), stop it (announcement deleted)', async () => {
  const news = mockChannel(guild, 'eventy');
  const deleted = [];
  news.messages.delete = async (id) => { deleted.push(id); };
  const view = (await call('GET', `/guilds/${guild.id}`)).json.modules.economy;
  assert.ok(view.eventTypes.some((type) => type.id === 'kasa'));
  assert.equal(view.events.auto, false);
  const saved = await call('PATCH', `/guilds/${guild.id}/economy`, { events: { channelId: news.id, auto: true, everyHours: 6, durationMinutes: 30 } });
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.json.events.channelId, news.id);
  assert.equal(saved.json.events.auto, true);
  assert.ok(saved.json.events.nextAutoAt > Date.now(), 'the first automatic event is planned');
  const started = await call('PATCH', `/guilds/${guild.id}/economy`, { eventStart: { type: 'ryby', minutes: 45 } });
  assert.equal(started.status, 200, started.text);
  assert.equal(started.json.events.active.type, 'ryby');
  assert.equal(news.sent.length, 1);
  const stopped = await call('PATCH', `/guilds/${guild.id}/economy`, { eventStop: true });
  assert.equal(stopped.json.events.active, null);
  assert.deepEqual(deleted, [news.sent[0].id]);
  assert.equal((await call('PATCH', `/guilds/${guild.id}/economy`, { eventStart: { type: 'nope', minutes: 45 } })).status, 400);
  assert.equal((await call('PATCH', `/guilds/${guild.id}/economy`, { events: { everyHours: 0 } })).status, 400);
});

test('lottery settings in the economy module: price, limit, bonus, channel and the running pot', async () => {
  const view = (await call('GET', `/guilds/${guild.id}`)).json.modules.economy.lottery;
  assert.equal(view.ticketPrice, 500);
  const saved = await call('PATCH', `/guilds/${guild.id}/economy`, { lottery: { channelId: channel.id, ticketPrice: 250, maxTickets: 20, bonus: 0 } });
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(
    { channelId: saved.json.lottery.channelId, ticketPrice: saved.json.lottery.ticketPrice, maxTickets: saved.json.lottery.maxTickets, bonus: saved.json.lottery.bonus, pot: saved.json.lottery.pot },
    { channelId: channel.id, ticketPrice: 250, maxTickets: 20, bonus: 0, pot: 0 },
  );
  assert.equal((await call('PATCH', `/guilds/${guild.id}/economy`, { lottery: { maxTickets: 0 } })).status, 400);
});
