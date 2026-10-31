// 2026-11-01: modmail permissions, daily data copy, prefix in the panel, reminder DMs, economy statistics, /wisielec.
import './helpers/env.js';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import express from 'express';
import { Collection, PermissionFlagsBits } from 'discord.js';
import { mockChannel, mockGuild, mockInteraction, mockMember, mockUser, replyText } from './helpers/mock.js';
import { initializeDatabase } from '../src/utils/database.js';
import { getEconomyData, setEconomyData } from '../src/utils/economy.js';
import { runWithTraceContext } from '../src/utils/logger.js';
import { dayKey } from '../src/utils/warsawTime.js';
import { HANGMAN_WORDS } from '../src/config/hangmanWords.js';
import { runWithLocale } from '../src/i18n/index.js';
import { updateEconomySettings, getEconomySettings } from '../src/services/economySettings.js';
import { backupChannelProblem, buildBackup, getBackupSettings, sendBackup, tickBackup, updateBackupSettings, withoutSecrets, BACKUP_FORMAT } from '../src/services/dataBackup.js';
import { buildRemindersView, dueKinds, getReminders, inQuietHours, setReminderKinds, stopReminders, tickReminders } from '../src/services/reminders.js';
import { economySnapshot, economyStatsView, flushEconomyStats, moneySource, noteMoneyChange } from '../src/services/economyStats.js';
import {
  IDLE_MS, LETTERS, MAX_LIVES, clearGame, expireGame, guessLetter, guessPassword, isPasswordLetter, isSolved, maskedWord, pickWord, playLetter, playPassword, rewardFor, runningGame, startGame,
} from '../src/services/hangman.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY = 'test-panel-key-0123456789abcdef';
// 12:00 Warsaw on a winter day: outside the quiet hours.
const NOON = Date.UTC(2026, 10, 2, 11, 0, 0);
const HOUR = 3_600_000;

const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null, cache: new Collection() }, commands: new Collection() };
let server;
let base;

async function call(method, urlPath, body) {
  const response = await fetch(`${base}${urlPath}`, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, text, json: JSON.parse(text) };
}

function privateChannel(guild, name = 'kopie') {
  return mockChannel(guild, name, {
    permissionsFor: (who) => ({ has: () => who !== guild.roles.everyone }),
  });
}

before(async () => {
  process.env.PANEL_API_KEY = KEY;
  const { db } = await initializeDatabase();
  client.db = db;
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

// ---------- modmail ----------

test('modmail: blocking and snippets need Manage Server, plain staff cannot', async () => {
  const { default: modmail } = await import('../src/commands/Modmail/modmail.js');
  const guild = mockGuild(client, 'Modmail');
  const channel = mockChannel(guild, 'ogolny');
  const staff = mockMember(guild, mockUser('staff'), { permissions: [PermissionFlagsBits.ManageMessages] });
  const target = mockUser('target');
  const staffTry = mockInteraction({ client, guild, channel, member: staff, commandName: 'modmail', subcommand: 'zablokuj', options: { user: target } });
  await assert.rejects(() => modmail.execute(staffTry, {}, client));

  const admin = mockMember(guild, mockUser('admin'), { permissions: [PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageMessages] });
  const adminTry = mockInteraction({ client, guild, channel, member: admin, commandName: 'modmail', subcommand: 'zablokuj', options: { user: target } });
  await modmail.execute(adminTry, {}, client);
  assert.match(replyText(adminTry), new RegExp(target.id));
});

test('modmail: /modmail szablony answers with the list', async () => {
  const { default: modmail } = await import('../src/commands/Modmail/modmail.js');
  const guild = mockGuild(client, 'Modmail 2');
  const channel = mockChannel(guild, 'ogolny');
  const admin = mockMember(guild, mockUser('admin'), { permissions: [PermissionFlagsBits.Administrator] });
  const list = mockInteraction({ client, guild, channel, member: admin, commandName: 'modmail', subcommand: 'szablony' });
  await modmail.execute(list, {}, client);
  assert.doesNotMatch(replyText(list), /not recognised/);
  assert.match(replyText(list), /snippets/i);
});

// ---------- data copy ----------

test('data copy: only this server, no secrets, gz file on the private channel', async () => {
  const guild = mockGuild(client, 'Kopia');
  const other = mockGuild(client, 'Inny serwer');
  const channel = privateChannel(guild);
  await client.db.set(`guild:${guild.id}:minecraft-whitelist`, { enabled: true, apiKey: 'ptlc_sekret', members: { 1: { name: 'Pikczu' } } });
  await client.db.set(`guild:${guild.id}:economy:123456789012345678`, { wallet: 500, bank: 20 });
  await client.db.set(`guild:${other.id}:economy:123456789012345678`, { wallet: 999, bank: 0 });
  await updateBackupSettings(guild.id, (data) => { data.channelId = channel.id; });

  const result = await sendBackup(client, guild, { now: NOON });
  assert.equal(result.ok, true);
  assert.equal(channel.sent.length, 1);
  const file = channel.sent[0].files[0];
  assert.match(file.name, /\.json\.gz$/);
  const text = gunzipSync(file.attachment).toString('utf8');
  const backup = JSON.parse(text);
  assert.equal(backup.format, BACKUP_FORMAT);
  assert.equal(backup.entries[`guild:${guild.id}:economy:123456789012345678`].wallet, 500);
  assert.equal(backup.entries[`guild:${guild.id}:minecraft-whitelist`].members[1].name, 'Pikczu');
  assert.ok(!text.includes('ptlc_sekret'), 'the key never leaves');
  assert.ok(!text.includes(other.id), 'nothing of another server');
  const stored = await getBackupSettings(guild.id);
  assert.equal(stored.lastDay, dayKey(NOON));
  assert.ok(stored.lastEntries >= 3);
});

test('data copy: a channel everyone can see is refused, also at the time of sending', async () => {
  const guild = mockGuild(client, 'Publiczny');
  const open = mockChannel(guild, 'ogolny');
  assert.equal(backupChannelProblem(guild, open), 'public');
  assert.equal(backupChannelProblem(guild, null), 'missing');
  await updateBackupSettings(guild.id, (data) => { data.channelId = open.id; });
  const result = await sendBackup(client, guild, { now: NOON });
  assert.deepEqual(result, { ok: false, error: 'public' });
  assert.equal(open.sent.length, 0);
  assert.equal((await getBackupSettings(guild.id)).lastError, 'public');
});

test('data copy: once a day at the hour, a failed one waits 30 minutes', async () => {
  const guild = mockGuild(client, 'Godzina');
  const channel = privateChannel(guild);
  await updateBackupSettings(guild.id, (data) => { data.channelId = channel.id; data.hour = 4; });
  const at = (hour) => Date.UTC(2026, 10, 2, hour - 1, 0, 0); // winter: Warsaw = UTC + 1
  assert.equal(await tickBackup(client, guild, at(3)), false);
  assert.equal(await tickBackup(client, guild, at(4)), true);
  assert.equal(await tickBackup(client, guild, at(5)), false);
  assert.equal(channel.sent.length, 1);

  const realSend = channel.send;
  channel.permissionsFor = () => ({ has: () => false });
  assert.equal(await tickBackup(client, guild, at(4) + 24 * HOUR), false);
  channel.permissionsFor = (who) => ({ has: () => who !== guild.roles.everyone });
  channel.send = realSend;
  assert.equal(await tickBackup(client, guild, at(4) + 24 * HOUR + 60_000), false, 'too soon after the failed try');
  assert.equal(await tickBackup(client, guild, at(4) + 24 * HOUR + 31 * 60_000), true);
});

test('withoutSecrets removes secret fields at any depth and keeps the rest', () => {
  assert.deepEqual(withoutSecrets({ a: 1, apiKey: 'x', list: [{ token: 'y', ok: true }], inner: { password: 'z', name: 'n' } }), { a: 1, list: [{ ok: true }], inner: { name: 'n' } });
});

test('restore script: replaces one server in the file, keeps others and the saved key', async () => {
  const guild = mockGuild(client, 'Przywracanie');
  const accountKey = `guild:${guild.id}:economy:123456789012345678`;
  await client.db.set(accountKey, { wallet: 777, bank: 1 });

  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'kopia-'));
  const copy = path.join(folder, 'kopia.json.gz');
  const storage = path.join(folder, 'storage.json');
  fs.writeFileSync(storage, JSON.stringify({
    version: 1,
    data: {
      [`guild:${guild.id}:stare`]: 'do usuniecia',
      [accountKey]: { wallet: 1, bank: 0 },
      [`guild:${guild.id}:minecraft-whitelist`]: { apiKey: 'ptlc_zostaje' },
      'guild:999:economy:1': { wallet: 5 },
    },
    expires: { [`guild:${guild.id}:stare`]: Date.now() + 1000 },
  }));
  // A copy holding the whitelist entry, as it comes from a real server.
  await client.db.set(`guild:${guild.id}:minecraft-whitelist`, { enabled: true, apiKey: 'ptlc_sekret' });
  fs.writeFileSync(copy, (await buildBackup(client, guild, NOON)).buffer);

  const output = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'restore-backup.js'), copy, '--storage', storage], { encoding: 'utf8' });
  assert.match(output, /restored/);
  const after2 = JSON.parse(fs.readFileSync(storage, 'utf8'));
  assert.equal(after2.data[accountKey].wallet, 777);
  assert.equal(after2.data['guild:999:economy:1'].wallet, 5);
  assert.equal(after2.data[`guild:${guild.id}:stare`], undefined);
  assert.equal(after2.expires[`guild:${guild.id}:stare`], undefined);
  assert.equal(after2.data[`guild:${guild.id}:minecraft-whitelist`].apiKey, 'ptlc_zostaje');
  assert.ok(fs.readdirSync(folder).some((name) => name.includes('before-restore')));
  fs.rmSync(folder, { recursive: true, force: true });
});

test('panel: backup and prefix modules', async () => {
  const guild = mockGuild(client, 'Panel kopia');
  const open = mockChannel(guild, 'ogolny');
  const closed = privateChannel(guild);

  const overview = (await call('GET', `/guilds/${guild.id}`)).json.modules;
  assert.equal(overview.backup.channelId, null);
  assert.equal(overview.backup.hour, 4);
  assert.equal(overview.prefix.prefix, '!');

  const refused = await call('PATCH', `/guilds/${guild.id}/backup`, { channelId: open.id });
  assert.equal(refused.status, 400);
  assert.match(refused.json.error, /@everyone/);

  const saved = await call('PATCH', `/guilds/${guild.id}/backup`, { channelId: closed.id, hour: 6 });
  assert.equal(saved.json.channelId, closed.id);
  assert.equal(saved.json.hour, 6);

  const sent = await call('PATCH', `/guilds/${guild.id}/backup`, { sendNow: true });
  assert.equal(sent.status, 200);
  assert.equal(closed.sent.length, 1);
  assert.ok(sent.json.lastAt > 0);

  assert.equal((await call('PATCH', `/guilds/${guild.id}/prefix`, { prefix: 'a b' })).status, 400);
  assert.equal((await call('PATCH', `/guilds/${guild.id}/prefix`, { prefix: '/' })).status, 400);
  assert.equal((await call('PATCH', `/guilds/${guild.id}/prefix`, { prefix: 'x'.repeat(11) })).status, 400);
  const prefix = await call('PATCH', `/guilds/${guild.id}/prefix`, { prefix: '?' });
  assert.equal(prefix.json.prefix, '?');
  assert.equal((await call('GET', `/guilds/${guild.id}`)).json.modules.prefix.prefix, '?');
});

// ---------- reminders ----------

test('reminders: quiet hours are 22-8 Polish time', () => {
  assert.equal(inQuietHours(NOON), false);
  assert.equal(inQuietHours(Date.UTC(2026, 10, 2, 21, 0)), true); // 22:00
  assert.equal(inQuietHours(Date.UTC(2026, 10, 2, 6, 59)), true); // 7:59
  assert.equal(inQuietHours(Date.UTC(2026, 10, 2, 7, 0)), false); // 8:00
});

test('reminders: a DM once per use, nothing without asking, gaps and jail respected', async () => {
  const guild = mockGuild(client, 'Przypomnienia');
  const dms = [];
  const user = mockUser('gracz', { send: async (payload) => { dms.push(payload); return {}; } });
  mockMember(guild, user);
  const stranger = mockUser('obcy', { send: async () => { throw new Error('must not be called'); } });
  mockMember(guild, stranger);
  const settings = await getEconomySettings(guild.id);
  const workMs = settings.commands.work.cooldownMinutes * 60_000;

  const data = await getEconomyData(client, guild.id, user.id);
  data.lastWork = NOON - workMs - 60_000;
  await setEconomyData(client, guild.id, user.id, data);
  const strangerData = await getEconomyData(client, guild.id, stranger.id);
  strangerData.lastWork = NOON - workMs - 60_000;
  await setEconomyData(client, guild.id, stranger.id, strangerData);

  assert.equal(await tickReminders(client, guild, NOON), 0, 'nobody asked yet');

  const entry = await setReminderKinds({ guild, user, kinds: ['work', 'nieistnieje'], now: NOON - HOUR });
  assert.deepEqual(entry.kinds, ['work']);
  assert.equal(dms.length, 1, 'the first choice checks that DMs are open');

  assert.equal(await tickReminders(client, guild, NOON), 1);
  assert.equal(dms.length, 2);
  assert.match(JSON.stringify(dms[1].embeds[0]), /\/work/);
  assert.equal(await tickReminders(client, guild, NOON + HOUR), 0, 'reminded once for this use');

  // A new use re-arms it, after the break.
  const again = await getEconomyData(client, guild.id, user.id);
  again.lastWork = NOON + HOUR;
  await setEconomyData(client, guild.id, user.id, again);
  assert.equal(await tickReminders(client, guild, NOON + HOUR + 60_000), 0, 'the break is not over');
  assert.equal(await tickReminders(client, guild, NOON + HOUR + workMs + 60_000 > NOON + 8 * HOUR ? NOON + 8 * HOUR : NOON + HOUR + workMs + 60_000), 1);

  // Jail keeps the job reminder back.
  const jailed = await getEconomyData(client, guild.id, user.id);
  jailed.lastWork = NOON;
  jailed.jailedUntil = NOON + workMs + 5 * HOUR;
  const fresh = (await getReminders(guild.id)).members[user.id];
  assert.equal((await dueKinds({ ...fresh, sent: {} }, jailed, settings, guild.id, NOON + workMs + 60_000)).length, 0);
  assert.equal((await dueKinds({ ...fresh, sent: {} }, jailed, settings, guild.id, NOON + workMs + 5 * HOUR + 60_000)).length, 1);
});

test('reminders: closed DMs mark the member, stop clears, quiet hours and the server switch hold everything', async () => {
  const guild = mockGuild(client, 'Zamkniete DM');
  const closed = Object.assign(new Error('Cannot send messages to this user'), { code: 50007 });
  const user = mockUser('zamkniety', { send: async () => { throw closed; } });
  mockMember(guild, user);
  const entry = await setReminderKinds({ guild, user, kinds: ['daily'], now: NOON });
  assert.equal(entry.blocked, true);
  const view = buildRemindersView({ guildId: guild.id, ownerId: user.id, entry });
  assert.match(JSON.stringify(view.embeds[0]), /cannot write/);
  assert.equal(await tickReminders(client, guild, NOON + 8 * HOUR), 0);

  await stopReminders(guild.id, user.id);
  const stopped = (await getReminders(guild.id)).members[user.id];
  assert.deepEqual(stopped.kinds, []);
  assert.equal(stopped.blocked, false);

  const open = mockGuild(client, 'Otwarte DM');
  const dms = [];
  const member = mockUser('otwarty', { send: async (payload) => { dms.push(payload); return {}; } });
  mockMember(open, member);
  await setReminderKinds({ guild: open, user: member, kinds: ['daily'], now: NOON - HOUR });
  dms.length = 0;
  assert.equal(await tickReminders(client, open, Date.UTC(2026, 10, 2, 22, 0)), 0, 'night');
  await updateEconomySettings(open.id, (data) => { data.reminders.enabled = false; });
  assert.equal(await tickReminders(client, open, NOON), 0, 'server switch');
  await updateEconomySettings(open.id, (data) => { data.reminders.enabled = true; });
  assert.equal(await tickReminders(client, open, NOON), 1);
  assert.equal(dms.length, 1);
});

test('reminders: the view has one option per kind and the chosen ones are marked', () => {
  const view = buildRemindersView({ guildId: '1', ownerId: '2', entry: { kinds: ['rent'] } });
  const options = view.components[0].toJSON().components[0].options;
  assert.ok(options.length >= 10 && options.length <= 25);
  assert.deepEqual(options.filter((option) => option.default).map((option) => option.value), ['rent']);
  assert.match(view.components[1].toJSON().components[0].custom_id, /^przypomnienia:wylacz:1$/);
});

// ---------- economy statistics ----------

test('stats: every save is counted under what runs at that moment', async () => {
  const guild = mockGuild(client, 'Statystyki');
  const userId = '123456789012345679';
  const pay = async (command, amount) => runWithTraceContext({ traceId: 't', command }, async () => {
    const data = await getEconomyData(client, guild.id, userId);
    data.wallet = (data.wallet || 0) + amount;
    await setEconomyData(client, guild.id, userId, data);
  });
  await pay('work', 300);
  await pay('ponownie:fish:123', 100);
  await pay('bj:hit:1', -50);
  await pay('job:lottery', 1000);
  const chat = await getEconomyData(client, guild.id, userId);
  chat.bank = (chat.bank || 0) + 5;
  await setEconomyData(client, guild.id, userId, chat); // no trace: a chat message

  const view = await economyStatsView(client, guild.id);
  const source = (id) => view.sources7.find((entry) => entry.id === id);
  assert.equal(source('work').in, 300);
  assert.equal(source('fish').in, 100);
  assert.equal(source('blackjack').out, 50);
  assert.equal(source('job:lottery').in, 1000);
  assert.equal(source('chat').in, 5);
  const today = view.days.at(-1);
  assert.equal(today.in, 1405);
  assert.equal(today.out, 50);
  assert.equal(today.active, 1);
  assert.ok(today.money >= 1355);
  assert.equal(view.now.accounts, 1);
});

test('stats: a new account does not count its starting money as earnings', async () => {
  const guild = mockGuild(client, 'Start');
  await updateEconomySettings(guild.id, (data) => { data.startingWallet = 1000; });
  const userId = '123456789012345680';
  const data = await getEconomyData(client, guild.id, userId);
  assert.equal(data.wallet, 1000);
  data.wallet += 10;
  await runWithTraceContext({ traceId: 't', command: 'beg' }, () => setEconomyData(client, guild.id, userId, data));
  const view = await economyStatsView(client, guild.id);
  assert.equal(view.sources7.find((entry) => entry.id === 'beg').in, 10);
});

test('stats: median and the share of the richest tenth', async () => {
  const guild = mockGuild(client, 'Mediana');
  const amounts = [1000, 100, 100, 100, 100, 100, 100, 100, 100, 200];
  for (const [index, wallet] of amounts.entries()) {
    await client.db.set(`guild:${guild.id}:economy:12345678901234${5000 + index}`, { wallet, bank: 0 });
  }
  const snapshot = await economySnapshot(client, guild.id);
  assert.equal(snapshot.money, 2000);
  assert.equal(snapshot.accounts, 10);
  assert.equal(snapshot.median, 100);
  assert.equal(snapshot.top10Percent, 50);
});

test('stats: old days go, finished days keep only the number of active members', async () => {
  const guild = mockGuild(client, 'Sprzatanie');
  noteMoneyChange(guild.id, '1', 10, NOON);
  noteMoneyChange(guild.id, '2', -5, NOON);
  await flushEconomyStats(guild.id, NOON);
  noteMoneyChange(guild.id, '3', 7, NOON + 91 * 24 * HOUR);
  const data = await flushEconomyStats(guild.id, NOON + 91 * 24 * HOUR);
  assert.equal(data.days[dayKey(NOON)], undefined);
  await flushEconomyStats(guild.id, NOON + 92 * 24 * HOUR);
  const stored = await client.db.get(`guild:${guild.id}:economy-stats`);
  const day = stored.days[dayKey(NOON + 91 * 24 * HOUR)];
  assert.equal(day.active, 1);
  assert.equal(day.users, undefined);
  assert.equal(moneySource(), 'chat');
});

test('panel: GET economy/stats and the reminders switch', async () => {
  const guild = mockGuild(client, 'Panel staty');
  const stats = await call('GET', `/guilds/${guild.id}/economy/stats`);
  assert.equal(stats.status, 200);
  assert.ok(Array.isArray(stats.json.days));
  assert.equal(stats.json.now.money, 0);

  const economy = await call('PATCH', `/guilds/${guild.id}/economy`, { reminders: { enabled: false }, commands: { hangman: { reward: 500, cooldownMinutes: 10 } } });
  assert.equal(economy.status, 200);
  assert.equal(economy.json.reminders.enabled, false);
  assert.equal(economy.json.commands.hangman.reward, 500);
  assert.deepEqual(economy.json.limits.hangman.cooldownMinutes, [0, 43200]);
});

// ---------- /wisielec ----------

test('hangman: every password has only letters of the menus, no doubles', () => {
  assert.ok(HANGMAN_WORDS.length >= 150);
  for (const { word, category } of HANGMAN_WORDS) {
    assert.ok(category);
    for (const char of word) assert.ok(isPasswordLetter(char) || char === ' ' || char === '-', `"${word}" has "${char}"`);
  }
  assert.equal(new Set(HANGMAN_WORDS.map(({ word }) => word)).size, HANGMAN_WORDS.length);
  assert.equal(LETTERS.length, 32);
});

const newGame = (word) => ({ id: 'g', guildId: 'x', word, category: 'Test', guessed: new Set(), wrong: [], lives: MAX_LIVES, passwordTried: new Set() });

test('hangman: letters and lives', () => {
  const game = newGame('żółw');
  assert.equal(maskedWord(game.word, game.guessed), '_ _ _ _');
  assert.deepEqual(guessLetter(game, 'z'), { hit: false, solved: false, lost: false }, 'z is not ż');
  assert.equal(game.lives, MAX_LIVES - 1);
  assert.deepEqual(guessLetter(game, 'z'), { error: 'used' });
  assert.equal(game.lives, MAX_LIVES - 1);
  for (const letter of ['ż', 'ó', 'ł']) guessLetter(game, letter);
  assert.equal(isSolved(game), false);
  assert.deepEqual(guessLetter(game, 'w'), { hit: true, solved: true, lost: false });
  assert.equal(maskedWord('smok endu', new Set(['s']), false), 'S _ _ _   _ _ _ _');
  assert.equal(maskedWord('biało-czerwoni', new Set(), false).includes('-'), true);
  assert.equal(maskedWord('żółw', new Set(), true), 'Ż Ó Ł W');
});

test('hangman: the whole password, without Polish letters too; a wrong one costs a life once', () => {
  const game = newGame('złote jabłko');
  assert.deepEqual(guessPassword(game, 'a', 'zle haslo'), { hit: false, solved: false, lost: false });
  assert.equal(game.lives, MAX_LIVES - 1);
  assert.deepEqual(guessPassword(game, 'a', 'złote jabłko'), { error: 'tried' });
  assert.deepEqual(guessPassword(game, 'b', '  ZLOTE   JABLKO '), { hit: true, solved: true, lost: false });
  assert.equal(isSolved(game), true);
});

test('hangman: the prize falls with the lives, last life 40%', () => {
  assert.equal(rewardFor(1000, MAX_LIVES), 1000);
  assert.equal(rewardFor(1000, 1), 400);
  assert.equal(rewardFor(1000, 4), 700);
  assert.equal(pickWord(HANGMAN_WORDS.map((_, index) => index).filter((index) => index !== 5)), 5);
});

function hangmanSetup(name) {
  const guild = mockGuild(client, name);
  const channel = mockChannel(guild, 'gry');
  const user = mockUser('startuje');
  mockMember(guild, user);
  const other = mockUser('drugi');
  mockMember(guild, other);
  return { guild, channel, user, other };
}

test('hangman: a whole game on a channel, the winner is paid and the break holds', async () => {
  const { guild, channel, user, other } = hangmanSetup('Wisielec');
  const game = await startGame({ client, guild, channel, user, now: NOON, random: () => 0 });
  assert.equal(channel.sent.length, 1);
  assert.equal(channel.sent[0].components.length, 3, 'two letter menus and the password button');
  await assert.rejects(() => startGame({ client, guild, channel, user: other, now: NOON }), /running/);

  const before2 = await getEconomyData(client, guild.id, other.id);
  const wrongLetter = LETTERS.find((letter) => ![...game.word].includes(letter));
  const missed = await playLetter({ client, guild, user, gameId: game.id, letter: wrongLetter });
  assert.equal(game.lives, MAX_LIVES - 1);
  assert.ok(missed.update.components.length >= 2);
  assert.ok((await playLetter({ client, guild, user, gameId: game.id, letter: wrongLetter })).reply, 'a used letter is private');

  const won = await playPassword({ client, guild, user: other, gameId: game.id, text: game.word });
  assert.deepEqual(won.update.components, []);
  assert.equal(runningGame(guild.id), null);
  const paid = await getEconomyData(client, guild.id, other.id);
  const settings = await getEconomySettings(guild.id);
  assert.equal(paid.wallet - before2.wallet, rewardFor(settings.commands.hangman.reward, MAX_LIVES - 1));
  assert.equal(paid.stats?.hangman ?? 0, 0, 'progress stays off under NODE_ENV=test');

  assert.ok((await playLetter({ client, guild, user, gameId: game.id, letter: 'a' })).reply, 'menus of a finished game');
  await assert.rejects(() => startGame({ client, guild, channel, user, now: NOON + 60_000 }), /another game/);
  const next = await startGame({ client, guild, channel, user: other, now: NOON + 60_000, random: () => 0 });
  assert.notEqual(next.word, game.word, 'a password used lately is not picked');
  clearGame(guild.id);
  const third = await startGame({ client, guild, channel, user, now: NOON + 61 * 60_000 });
  clearGame(guild.id);
  assert.ok(third);
});

test('hangman: no lives left and no moves both end the game without a prize', async () => {
  const { guild, channel, user } = hangmanSetup('Wisielec 2');
  const game = await startGame({ client, guild, channel, user, now: NOON });
  const wallet = (await getEconomyData(client, guild.id, user.id)).wallet;
  const wrong = LETTERS.filter((letter) => ![...game.word].includes(letter));
  let last;
  for (const letter of wrong.slice(0, MAX_LIVES)) last = await playLetter({ client, guild, user, gameId: game.id, letter });
  assert.deepEqual(last.update.components, []);
  assert.equal(runningGame(guild.id), null);
  assert.equal((await getEconomyData(client, guild.id, user.id)).wallet, wallet);

  const later = await startGame({ client, guild, channel, user, now: NOON + 2 * HOUR });
  let edited = null;
  later.message.edit = async (payload) => { edited = payload; };
  assert.equal(await expireGame(guild.id, later.id), true);
  assert.deepEqual(edited.components, []);
  assert.equal(runningGame(guild.id), null);
  assert.ok(IDLE_MS >= 60_000);
});

test('reminders: the view speaks Polish on a Polish server', () => {
  runWithLocale('pl', () => {
    const view = buildRemindersView({ guildId: '1', ownerId: '2', entry: { kinds: [] } });
    assert.match(JSON.stringify(view.embeds[0]), /Przypomnienia/);
  });
});
