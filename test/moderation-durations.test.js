// Mutes and temporary bans for any time: "3 tygodnie", "2 dni", autocomplete, /ban with a duration, panel API.
import './helpers/env.js';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { Collection } from 'discord.js';
import { mockChannel, mockGuild, mockInteraction, mockMember, mockUser, replyText } from './helpers/mock.js';
import { initializeDatabase } from '../src/utils/database.js';
import { durationChoices, durationWords, parseDuration, requireDuration } from '../src/utils/featureKit.js';
import { runWithLocale } from '../src/i18n/index.js';
import { getTempbans, liftExpiredBans, scheduleUnban } from '../src/services/moderation/tempbanService.js';
import { ModerationService } from '../src/services/moderation/moderationService.js';
import ban from '../src/commands/Moderation/ban.js';
import mute from '../src/commands/Moderation/timeout.js';
import mod from '../src/commands/Moderation/mod.js';

const DAY = 86_400_000;
const WEEK = 7 * DAY;
const polish = (fn) => runWithLocale('pl', fn);
const KEY = 'test-panel-key-0123456789abcdef';
const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null, cache: new Collection() }, user: { id: '999999999999999999' } };
let guild;
let channel;
let moderator;
let server;
let base;

before(async () => {
  process.env.PANEL_API_KEY = KEY;
  const { db } = await initializeDatabase();
  client.db = db;
  guild = mockGuild(client, 'Czasy kar');
  channel = mockChannel(guild, 'ogolny');
  moderator = mockMember(guild, mockUser('Moderator'), { permissions: ['Administrator', 'ModerateMembers', 'BanMembers'] });
  client.guilds.cache.set(guild.id, guild);
  // Role order is tested elsewhere; here only the times matter.
  ModerationService.assertModerationHierarchy = () => {};
  const { createPanelRouter } = await import('../src/api/panelApi.js');
  const app = express();
  app.use(express.json());
  app.use('/api/v1', createPanelRouter(client));
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});

after(() => server?.close());

async function call(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, json: await response.json() };
}

test('durations are read in Polish and English, with or without spaces', () => {
  const cases = {
    '3 tygodnie': 3 * WEEK, '2 dni': 2 * DAY, '1 dzień': DAY, '1 tydzień': WEEK, tydzień: WEEK, '5 TYGODNI': 5 * WEEK,
    '3tyg': 3 * WEEK, '2tydz': 2 * WEEK, '12 godzin': 12 * 3_600_000, '1 godzina': 3_600_000, '30 minut': 1_800_000, '45min': 2_700_000,
    '1 miesiąc': 30 * DAY, '2 miesiące': 60 * DAY, '6 miesięcy': 180 * DAY, rok: 365 * DAY, '1y': 365 * DAY,
    '1 dzień i 12 godzin': DAY + 12 * 3_600_000, '1 tydzień, 2 dni': WEEK + 2 * DAY, 'na 3 dni': 3 * DAY,
    '3 weeks': 3 * WEEK, '2 days': 2 * DAY, '1 month': 30 * DAY, '2w': 2 * WEEK, '1d12h': DAY + 12 * 3_600_000,
  };
  for (const [text, ms] of Object.entries(cases)) assert.equal(parseDuration(text), ms, text);
  for (const text of ['spam', '10', '', 'm', 'h', '3 kilo', '0 dni', '5 dni wczoraj', `${'9'.repeat(400)}d`]) {
    assert.equal(parseDuration(text), null, text);
  }
});

test('a long nonsense text is refused quickly', () => {
  const started = Date.now();
  assert.equal(parseDuration(`${'a'.repeat(6000)}!`), null);
  assert.ok(Date.now() - started < 200);
});

test('durations are written as words with the right Polish forms', () => {
  const words = (ms) => polish(() => durationWords(ms));
  assert.equal(words(3 * WEEK), '3 tygodnie');
  assert.equal(words(WEEK), '1 tydzień');
  assert.equal(words(5 * WEEK), '5 tygodni');
  assert.equal(words(2 * DAY), '2 dni');
  assert.equal(words(DAY), '1 dzień');
  assert.equal(words(30 * DAY), '30 dni');
  assert.equal(words(3_600_000), '1 godzinę');
  assert.equal(words(DAY + 12 * 3_600_000), '1 dzień 12 godzin');
  assert.equal(words(90 * 60_000), '1 godzinę 30 minut');
  assert.equal(words(45_000), '45 sekund');
  assert.equal(runWithLocale('en', () => durationWords(3 * WEEK)), '3 weeks');
});

test('autocomplete suggests what the moderator is typing', () => {
  const choices = (typed, max = 28 * DAY) => polish(() => durationChoices(typed, { max, presets: ['10m', '1h', '1d', '2d', '1w', '3w', '4w'] }));
  const names = (typed, max) => choices(typed, max).map((choice) => choice.name);

  assert.deepEqual(names(''), ['10 minut', '1 godzinę', '1 dzień', '2 dni', '1 tydzień', '3 tygodnie', '4 tygodnie']);
  assert.ok(names('3').includes('3 tygodnie'));
  assert.ok(names('3').includes('3 dni'));
  assert.ok(names('3').includes('3 godziny'));
  assert.equal(names('3 ty')[0], '3 tygodnie');
  assert.equal(names('3 tygodnie')[0], '3 tygodnie');
  assert.equal(names('2 dn')[0], '2 dni');
  assert.deepEqual(names('tydz'), ['1 tydzień']);
  // Over the limit nothing fits, so the normal list stays.
  assert.equal(names('5 tygodni').length, 7);
  assert.ok(names('5 tygodni', 365 * DAY).includes('5 tygodni'));
  // Every value is something the command can read back, and Discord takes at most 25 choices.
  for (const choice of choices('')) assert.ok(parseDuration(choice.value) > 0);
  assert.ok(choices('1').length <= 25);
});

test('/mute takes 3 weeks and refuses more than Discord allows', async () => {
  const target = mockMember(guild, mockUser('Kuba'));
  let muted = null;
  target.moderatable = true;
  target.timeout = async (ms) => { muted = ms; };
  const interaction = mockInteraction({ client, guild, channel, member: moderator, commandName: 'mute', options: { target: target.user, duration: '3 tygodnie' } });
  interaction.options.getMember = () => target;
  await polish(() => mute.execute(interaction, {}, client));
  assert.equal(muted, 3 * WEEK);
  assert.match(replyText(interaction), /3 tygodnie/);

  const tooLong = mockInteraction({ client, guild, channel, member: moderator, commandName: 'mute', options: { target: target.user, duration: '5 tygodni' } });
  tooLong.options.getMember = () => target;
  await assert.rejects(polish(() => mute.execute(tooLong, {}, client)), (error) => /najwyżej na 28 dni/.test(error.userMessage));

  // Exactly 28 days stays a moment under Discord's limit.
  const longest = mockInteraction({ client, guild, channel, member: moderator, commandName: 'mute', options: { target: target.user, duration: '4w' } });
  longest.options.getMember = () => target;
  await mute.execute(longest, {}, client);
  assert.ok(muted < 28 * DAY && muted > 28 * DAY - 120_000);
});

test('/mute: a lone number is refused in the slash command, and means minutes after the prefix', async () => {
  const target = mockMember(guild, mockUser('Ola'));
  let muted = null;
  target.moderatable = true;
  target.timeout = async (ms) => { muted = ms; };
  const slash = mockInteraction({ client, guild, channel, member: moderator, commandName: 'mute', options: { target: target.user, duration: '3' } });
  slash.options.getMember = () => target;
  await assert.rejects(mute.execute(slash, {}, client));
  assert.equal(muted, null);

  const prefix = mockInteraction({ client, guild, channel, member: moderator, commandName: 'mute', options: { target: target.user, duration: '60' } });
  prefix.options.getMember = () => target;
  prefix._isPrefixCommand = true;
  prefix.deferred = true;
  await mute.execute(prefix, {}, client);
  assert.equal(muted, 3_600_000);
});

test('/ban with a duration lifts itself, /ban without one stays and cancels an older end', async () => {
  const user = mockUser('Banowany');
  guild.members.ban = async () => {};
  const timed = mockInteraction({ client, guild, channel, member: moderator, commandName: 'ban', options: { target: user, duration: '2 dni', reason: 'spam' } });
  await polish(() => ban.execute(timed, {}, client));
  const entry = (await getTempbans(guild.id)).find((item) => item.userId === user.id);
  assert.ok(entry.until > Date.now() + 2 * DAY - 60_000 && entry.until <= Date.now() + 2 * DAY);
  assert.match(replyText(timed), /2 dni/);

  const forever = mockInteraction({ client, guild, channel, member: moderator, commandName: 'ban', options: { target: user, reason: 'wrocil' } });
  await ban.execute(forever, {}, client);
  assert.equal((await getTempbans(guild.id)).some((item) => item.userId === user.id), false);
});

test('!ban keeps treating a second word as a reason, not as a duration', async () => {
  const user = mockUser('Prefiks');
  const interaction = mockInteraction({ client, guild, channel, member: moderator, commandName: 'ban', options: { target: user, reason: 'spam', duration: 'mocno' } });
  interaction._isPrefixCommand = true;
  await ban.execute(interaction, {}, client);
  assert.equal((await getTempbans(guild.id)).some((item) => item.userId === user.id), false);
});

test('/unban cancels the scheduled unban, so a later permanent ban is not lifted', async () => {
  const user = mockUser('Odbanowany');
  await scheduleUnban(guild.id, { userId: user.id, until: Date.now() + DAY, moderatorId: moderator.id, reason: 'x' });
  guild.bans = { fetch: async () => new Collection([[user.id, { user }]]) };
  guild.members.unban = async () => {};
  await ModerationService.unbanUser({ guild, user, moderator, reason: 'y' });
  assert.equal((await getTempbans(guild.id)).some((item) => item.userId === user.id), false);
});

test('the duration options are built for autocomplete and /mod tempban answers it', async () => {
  const optionOf = (command) => command.data.toJSON().options.find((option) => option.name === 'duration');
  assert.equal(optionOf(mute).type, 3);
  assert.equal(optionOf(mute).autocomplete, true);
  assert.equal(optionOf(ban).autocomplete, true);
  assert.equal(optionOf(ban).required, false);
  // Discord refuses required options after optional ones.
  assert.deepEqual(ban.data.toJSON().options.map((option) => option.name), ['target', 'reason', 'duration']);

  let answer = null;
  await mod.autocomplete({
    options: { getSubcommandGroup: () => null, getSubcommand: () => 'tempban', getFocused: () => '3 m' },
    respond: async (choices) => { answer = choices; },
  });
  assert.ok(answer.some((choice) => parseDuration(choice.value) === 90 * DAY));
});

test('panel API registers, lists and cancels the end of a temporary ban', async () => {
  const userId = '123456789012345678';
  const saved = await call('PUT', `/guilds/${guild.id}/tempbans/${userId}`, { minutes: 3 * 7 * 24 * 60, reason: 'spam' });
  assert.equal(saved.status, 200);
  assert.ok(saved.json.until > Date.now() + 3 * WEEK - 60_000);

  const listed = await call('GET', `/guilds/${guild.id}/tempbans`);
  assert.deepEqual(listed.json.tempbans.find((entry) => entry.userId === userId), { userId, until: saved.json.until });

  assert.equal((await call('PUT', `/guilds/${guild.id}/tempbans/${userId}`, { minutes: 0 })).status, 400);
  assert.equal((await call('PUT', `/guilds/${guild.id}/tempbans/${userId}`, { minutes: 365 * 24 * 60 + 1 })).status, 400);
  assert.equal((await call('PUT', `/guilds/${guild.id}/tempbans/abc`, { minutes: 10 })).status, 400);

  assert.equal((await call('DELETE', `/guilds/${guild.id}/tempbans/${userId}`)).status, 200);
  assert.equal((await getTempbans(guild.id)).some((entry) => entry.userId === userId), false);
});

test('a ban from the panel is lifted by the same job as the others', async () => {
  const userId = '123456789012345679';
  await scheduleUnban(guild.id, { userId, until: Date.now() - 1000, moderatorId: null, reason: '' });
  const lifted = [];
  guild.members.unban = async (id) => { lifted.push(id); };
  await liftExpiredBans(client);
  assert.deepEqual(lifted, [userId]);
});
