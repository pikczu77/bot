// What each number of warnings does (2026-10-26, softer 2026-11-01): the ladder, the 14-day window, the DM, /warn and
// automod through warnMember, the one-time reset of every warning and the panel module.
import './helpers/env.js';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { Collection } from 'discord.js';
import { mockChannel, mockGuild, mockInteraction, mockMember, mockUser, replyText } from './helpers/mock.js';
import { runWithLocale } from '../src/i18n/index.js';
import { initializeDatabase, setInDb } from '../src/utils/database.js';
import { loadCommands } from '../src/handlers/loaders/commandLoader.js';
import { WarningService } from '../src/services/moderation/warningService.js';
import { getTempbans } from '../src/services/moderation/tempbanService.js';
import {
  DEFAULT_STEPS, describeStep, getPunishmentSettings, resetAllWarningsOnce, stepFor, updatePunishmentSettings, warnMember,
} from '../src/services/moderation/warningPunishments.js';

const KEY = 'test-panel-key-0123456789abcdef';
const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null, cache: new Collection() } };
let guild;
let channel;
let server;
let base;

function trackedMember(name) {
  const member = mockMember(guild, mockUser(name));
  member.actions = [];
  member.dms = [];
  member.user.send = async (payload) => { member.dms.push(payload); };
  member.timeout = async (ms, reason) => { member.actions.push(['timeout', Math.round(ms / 60_000), reason]); member.communicationDisabledUntilTimestamp = Date.now() + ms; };
  member.kick = async (reason) => { member.actions.push(['kick', reason]); };
  return member;
}

before(async () => {
  process.env.PANEL_API_KEY = KEY;
  const { db } = await initializeDatabase();
  client.db = db;
  await loadCommands(client);
  guild = mockGuild(client, 'Ostrzeżenia');
  channel = mockChannel(guild, 'ogolny');
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

test('the ladder: a step for every count, the last one above it', () => {
  const settings = { steps: DEFAULT_STEPS };
  assert.equal(stepFor(settings, 0), null);
  assert.deepEqual([1, 2].map((count) => stepFor(settings, count).action), ['none', 'none']);
  assert.deepEqual([3, 4, 5, 6, 7, 8, 9].map((count) => stepFor(settings, count).minutes), [10, 30, 60, 180, 720, 1440, 1440]);
  assert.deepEqual([10, 11].map((count) => stepFor(settings, count).action), ['kick', 'kick']);
  assert.equal(stepFor(settings, 12).minutes, 7 * 1440);
  assert.equal(stepFor(settings, 20).minutes, 7 * 1440, 'the last step is the highest punishment');
  runWithLocale('en', () => {
    assert.equal(describeStep(stepFor(settings, 5)), 'timeout 1 h');
    assert.equal(describeStep(stepFor(settings, 12)), 'ban for 7 days');
    assert.equal(describeStep({ action: 'ban', minutes: 0 }), 'permanent ban');
  });
});

test('warnings climb the ladder: DM, timeouts, kick, temporary ban that lifts itself', async () => {
  const member = trackedMember('Łobuz');
  const warn = () => runWithLocale('en', () => warnMember({ client, guild, member, userId: member.id, moderatorId: '1', reason: 'spam' }));
  const first = await warn();
  assert.equal(first.count, 1);
  assert.equal(first.applied, false);
  assert.equal(member.dms.length, 1);
  assert.match(member.dms[0].embeds[0].toJSON().description, /Next warning:\*\* only a warning/);
  const second = await warn();
  assert.equal(second.applied, false);
  assert.match(member.dms[1].embeds[0].toJSON().description, /Next warning:\*\* timeout 10 min/);
  await warn();
  assert.deepEqual(member.actions.at(-1).slice(0, 2), ['timeout', 10]);
  for (let index = 4; index <= 9; index += 1) await warn();
  assert.deepEqual(member.actions.filter((action) => action[0] === 'timeout').map((action) => action[1]).slice(0, 6), [10, 30, 60, 180, 720, 1440]);
  const kick = await warn();
  assert.equal(kick.count, 10);
  assert.equal(member.actions.at(-1)[0], 'kick');
  await warn();
  const banned = [];
  guild.members.ban = async (userId, options) => { banned.push([userId, options.reason]); };
  const ban = await warn();
  assert.equal(ban.count, 12);
  assert.equal(banned.length, 1);
  const tempban = (await getTempbans(guild.id)).find((entry) => entry.userId === member.id);
  assert.ok(tempban.until > Date.now() + 6 * 86_400_000);
  assert.ok(tempban.until < Date.now() + 8 * 86_400_000);
});

test('a stored ladder of 2026-10-26 reads as the softer one; a ladder of the server and later saves stay', async () => {
  const OLD = [
    { count: 1, action: 'none', minutes: 0 }, { count: 2, action: 'timeout', minutes: 10 }, { count: 3, action: 'timeout', minutes: 60 },
    { count: 4, action: 'timeout', minutes: 360 }, { count: 5, action: 'timeout', minutes: 1440 }, { count: 6, action: 'timeout', minutes: 4320 },
    { count: 7, action: 'kick', minutes: 0 }, { count: 8, action: 'ban', minutes: 10080 }, { count: 9, action: 'ban', minutes: 43200 },
  ];
  const saved = mockGuild(client, 'Stara drabinka');
  await setInDb(`guild:${saved.id}:warning-punishments`, { enabled: true, expireDays: 30, steps: OLD });
  let settings = await getPunishmentSettings(saved.id);
  assert.deepEqual(settings.steps, DEFAULT_STEPS);
  assert.equal(settings.expireDays, 14);

  await updatePunishmentSettings(saved.id, (data) => { data.enabled = false; });
  settings = await getPunishmentSettings(saved.id);
  assert.equal(settings.enabled, false);
  assert.deepEqual(settings.steps, DEFAULT_STEPS, 'another save does not bring the old ladder back');

  await updatePunishmentSettings(saved.id, (data) => { data.steps = OLD; data.expireDays = 30; });
  settings = await getPunishmentSettings(saved.id);
  assert.equal(settings.steps.length, OLD.length, 'typed in again by hand: the server wants it');
  assert.equal(settings.expireDays, 30);

  const own = mockGuild(client, 'Swoja drabinka');
  const steps = [{ count: 2, action: 'kick', minutes: 0 }];
  await setInDb(`guild:${own.id}:warning-punishments`, { enabled: true, expireDays: 30, steps });
  settings = await getPunishmentSettings(own.id);
  assert.deepEqual(settings.steps, steps);
  assert.equal(settings.expireDays, 30);
});

test('only warnings from the last 14 days count; a longer timeout is not shortened; the ladder can be off', async () => {
  const member = trackedMember('Stary');
  const old = Date.now() - 20 * 86_400_000;
  for (let index = 0; index < 4; index += 1) {
    await WarningService.addWarning({ guildId: guild.id, userId: member.id, moderatorId: '1', reason: 'dawno', timestamp: old });
  }
  const result = await warnMember({ client, guild, member, userId: member.id, moderatorId: '1', reason: 'teraz' });
  assert.equal(result.count, 1, 'the four old ones expired');

  member.communicationDisabledUntilTimestamp = Date.now() + 86_400_000;
  await warnMember({ client, guild, member, userId: member.id, moderatorId: '1', reason: 'znowu' });
  const third = await warnMember({ client, guild, member, userId: member.id, moderatorId: '1', reason: 'i znowu' });
  assert.equal(third.count, 3);
  assert.equal(third.applied, false, 'a 24 h timeout already runs, no 10 min one');

  await updatePunishmentSettings(guild.id, (data) => { data.enabled = false; });
  const off = await warnMember({ client, guild, member, userId: member.id, moderatorId: '1', reason: 'bez kar' });
  assert.equal(off.step, null);
  await updatePunishmentSettings(guild.id, (data) => { data.enabled = true; });
});

test('/warn shows the count, the punishment and the next step', async () => {
  const moderator = mockMember(guild, mockUser('Moderator'), { permissions: ['Administrator', 'ModerateMembers'] });
  const member = trackedMember('Gracz');
  guild.members.me.roles.highest = { position: 50, comparePositionTo: () => 1 };
  moderator.roles.highest = { position: 40, comparePositionTo: () => 1 };
  const interaction = mockInteraction({ client, guild, channel, member: moderator, commandName: 'warn', options: { target: member.user, reason: 'Obrażanie' } });
  await runWithLocale('en', () => client.commands.get('warn').execute(interaction, {}, client));
  const text = replyText(interaction);
  assert.match(text, /Total Warns:\*\* 1/);
  assert.match(text, /Punishment:\*\* only a warning/);
  assert.match(text, /Next warning:\*\* only a warning/);
});

test('every warning is reset once after the start, never again', async () => {
  const member = trackedMember('Reset');
  await warnMember({ client, guild, member, userId: member.id, moderatorId: '1', reason: 'x' });
  const done = await resetAllWarningsOnce(client);
  assert.ok(done[guild.id] >= 1);
  assert.equal((await WarningService.getWarnings(guild.id, member.id)).length, 0);
  await warnMember({ client, guild, member, userId: member.id, moderatorId: '1', reason: 'po resecie' });
  assert.equal(await resetAllWarningsOnce(client), null, 'the second start does nothing');
  assert.equal((await WarningService.getWarnings(guild.id, member.id)).length, 1);
});

test('panel: the ladder, who has warnings, reset all', async () => {
  const call = async (method, path, body) => {
    const response = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    return { status: response.status, text, json: JSON.parse(text) };
  };
  const member = trackedMember('Panelowy');
  await warnMember({ client, guild, member, userId: member.id, moderatorId: '1', reason: 'panel' });
  const view = (await call('GET', `/guilds/${guild.id}`)).json.modules.warnings;
  assert.equal(view.enabled, true);
  assert.equal(view.expireDays, 14);
  assert.equal(view.steps.length, DEFAULT_STEPS.length);
  assert.ok(view.members.length >= 1, JSON.stringify(view.members));
  const saved = await call('PATCH', `/guilds/${guild.id}/warnings`, { expireDays: 21, steps: [{ count: 3, action: 'timeout', minutes: 30 }, { count: 1, action: 'none' }, { count: 5, action: 'ban', minutes: 0 }] });
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(saved.json.steps.map((step) => step.count), [1, 3, 5]);
  assert.equal((await getPunishmentSettings(guild.id)).expireDays, 21);
  assert.equal((await call('PATCH', `/guilds/${guild.id}/warnings`, { steps: [{ count: 2, action: 'timeout', minutes: 50000 }] })).status, 400);
  assert.equal((await call('PATCH', `/guilds/${guild.id}/warnings`, { steps: [{ count: 2, action: 'kick' }, { count: 2, action: 'none' }] })).status, 400);
  const reset = await call('POST', `/guilds/${guild.id}/warnings/reset`);
  assert.equal(reset.status, 200, reset.text);
  assert.ok(reset.json.reset >= 1, 'how many members had warnings');
  assert.equal((await call('GET', `/guilds/${guild.id}`)).json.modules.warnings.members.length, 0);
});
