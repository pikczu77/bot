// Minecraft server power and backups (2026-10-26) against a fake Pterodactyl panel:
// /minecraft serwer with its buttons (stop asks first), backups by hand and automatic ones with rotation.
import './helpers/env.js';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { mockChannel, mockGuild, mockInteraction, mockMember, mockUser, replyText, snowflake } from './helpers/mock.js';
import { runWithLocale } from '../src/i18n/index.js';
import { initializeDatabase } from '../src/utils/database.js';
import { loadCommands } from '../src/handlers/loaders/commandLoader.js';
import { getWhitelistConfig, updateWhitelistConfig } from '../src/services/minecraftWhitelist.js';
import { AUTO_PREFIX, createBackup, tickBackup } from '../src/services/minecraftServer.js';
import serverButtons from '../src/interactions/buttons/minecraft/server.js';

const PANEL = 'https://ptero.mathost.eu';
const SERVER_ID = 'abc12345';
const KEY = 'ptlc_TestKeyForTheFakePanel0123456789';
const realFetch = globalThis.fetch;
const fake = { state: 'running', power: [], backups: [], limit: 2, deleted: [] };

const reply = (status, body = null) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const backup = (name, minutesAgo, extra = {}) => ({
  uuid: `uuid-${name.replace(/\W/g, '')}-${minutesAgo}`, name, bytes: 52_428_800, is_successful: true, is_locked: false,
  created_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(), completed_at: new Date(Date.now() - minutesAgo * 60_000 + 30_000).toISOString(), ...extra,
});

async function fakeFetch(url, options = {}) {
  const address = new URL(url);
  const base = `/api/client/servers/${SERVER_ID}`;
  if (address.origin !== PANEL || !address.pathname.startsWith(base)) return reply(404, { errors: [] });
  if (options.headers?.Authorization !== `Bearer ${KEY}`) return reply(401, { errors: [] });
  const path = address.pathname.slice(base.length);
  const method = options.method ?? 'GET';
  if (path === '' && method === 'GET') {
    return reply(200, { attributes: { name: 'Bloom SMP', limits: { memory: 4096, disk: 10240, cpu: 200 }, feature_limits: { backups: fake.limit } } });
  }
  if (path === '/resources') {
    return reply(200, { attributes: { current_state: fake.state, is_suspended: false, resources: { memory_bytes: 1610612736, cpu_absolute: 37.4, disk_bytes: 2147483648, uptime: 3_780_000 } } });
  }
  if (path === '/power' && method === 'POST') {
    fake.power.push(JSON.parse(options.body).signal);
    return reply(204);
  }
  if (path === '/backups' && method === 'GET') return reply(200, { data: fake.backups.map((attributes) => ({ object: 'backup', attributes })) });
  if (path === '/backups' && method === 'POST') {
    const { name } = JSON.parse(options.body);
    const made = backup(name, 0, { completed_at: null });
    fake.backups.unshift(made);
    return reply(200, { object: 'backup', attributes: made });
  }
  if (path.startsWith('/backups/') && method === 'DELETE') {
    const uuid = decodeURIComponent(path.slice('/backups/'.length));
    fake.deleted.push(uuid);
    fake.backups = fake.backups.filter((item) => item.uuid !== uuid);
    return reply(204);
  }
  return reply(404, { errors: [] });
}

const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null }, user: { id: '999999999999999999' } };
let guild;
let channel;
let admin;

before(async () => {
  const { db } = await initializeDatabase();
  client.db = db;
  await loadCommands(client);
  globalThis.fetch = fakeFetch;
  guild = mockGuild(client, 'Serwer MC');
  channel = mockChannel(guild, 'admin');
  admin = mockMember(guild, mockUser('Admin'), { permissions: ['Administrator'] });
  await updateWhitelistConfig(guild.id, (data) => Object.assign(data, { panelUrl: PANEL, serverId: SERVER_ID, apiKey: KEY }));
});

after(() => { globalThis.fetch = realFetch; });

const run = async (subcommand, options = {}, member = admin) => {
  const interaction = mockInteraction({ client, guild, channel, member, commandName: 'minecraft', subcommand, options });
  await runWithLocale('en', () => client.commands.get('minecraft').execute(interaction, {}, client))
    .catch((error) => interaction.replies.push({ content: error.userMessage ?? error.message }));
  return interaction;
};

function press(member, customId) {
  const calls = { reply: [], update: [], edit: [] };
  const interaction = {
    calls, id: snowflake(), client, guild, guildId: guild.id, channel, channelId: channel.id, member, user: member.user, customId,
    reply: async (payload) => { calls.reply.push(payload); },
    update: async (payload) => { calls.update.push(payload); },
    deferUpdate: async () => {},
    editReply: async (payload) => { calls.edit.push(payload); },
  };
  return interaction;
}
const click = async (member, customId) => {
  const interaction = press(member, customId);
  await runWithLocale('en', () => serverButtons.execute(interaction, client, customId.split(':').slice(1)));
  return interaction.calls;
};
const text = (payload) => JSON.stringify(payload.embeds.map((embed) => (embed.toJSON ? embed.toJSON() : embed)));
const ids = (payload) => payload.components.flatMap((row) => row.toJSON().components).map((button) => `${button.custom_id}${button.disabled ? '(off)' : ''}`);

test('/minecraft serwer: status from the panel, buttons match the state, Administrator only', async () => {
  fake.backups = [backup('Discord (Ola) 2026-10-25 20:00', 600)];
  const interaction = await run('serwer');
  const view = interaction.replies.at(-1);
  assert.match(text(view), /Bloom SMP/);
  assert.match(text(view), /On/);
  assert.match(text(view), /37% \/ 200%/);
  assert.match(text(view), /1\.5 GB \/ 4 GB/);
  assert.match(text(view), /1 h 3 min/);
  assert.match(text(view), /1 \/ 2/);
  assert.deepEqual(ids(view), ['mcserwer:start(off)', 'mcserwer:restart', 'mcserwer:stop', 'mcserwer:kopia', 'mcserwer:odswiez']);

  const manager = mockMember(guild, mockUser('Mod'), { permissions: ['ManageGuild'] });
  assert.match(replyText(await run('serwer', {}, manager)), /permission/i);
  const refused = await click(manager, 'mcserwer:stop:tak');
  assert.equal(fake.power.length, 0);
  assert.match(text(refused.reply[0]), /Only administrators/);
});

test('stop asks once more; start and restart go straight to the panel', async () => {
  fake.power.length = 0;
  const ask = await click(admin, 'mcserwer:stop');
  assert.equal(fake.power.length, 0, 'nothing sent before the second click');
  assert.match(text(ask.update[0]), /Stop the server\?/);
  assert.deepEqual(ids(ask.update[0]), ['mcserwer:stop:tak', 'mcserwer:odswiez']);

  const done = await click(admin, 'mcserwer:stop:tak');
  assert.deepEqual(fake.power, ['stop']);
  assert.match(text(done.update[0]), /Stop sent/);

  fake.state = 'offline';
  const back = await click(admin, 'mcserwer:odswiez');
  assert.deepEqual(ids(back.update[0]).slice(0, 3), ['mcserwer:start', 'mcserwer:restart(off)', 'mcserwer:stop(off)']);
  await click(admin, 'mcserwer:start');
  assert.deepEqual(fake.power, ['stop', 'start']);
  fake.state = 'running';
});

test('backup by hand: started with the name of the admin; a full plan is explained, nothing is deleted', async () => {
  fake.backups = [backup('Discord (Ola) 2026-10-25 20:00', 600)];
  const made = await click(admin, 'mcserwer:kopia');
  assert.match(text(made.edit[0]), /Backup \*\*Discord \(Admin\) \d{4}-\d\d-\d\d \d\d:\d\d\*\* started/);
  assert.equal(fake.backups.length, 2);
  assert.equal((await getWhitelistConfig(guild.id)).lastBackup.ok, true);

  const full = await click(admin, 'mcserwer:kopia');
  assert.match(text(full.edit[0]), /All 2 backup slots are taken/);
  assert.equal(fake.deleted.length, 0);
});

test('automatic backups: every N hours, the oldest automatic one is replaced, locked and hand-made ones stay', async () => {
  const set = await run('kopie', { co_ile: 6 });
  assert.match(replyText(set), /every \*\*6 h\*\*/);
  const config = await getWhitelistConfig(guild.id);
  assert.equal(config.backupEveryHours, 6);

  fake.backups = [backup(`${AUTO_PREFIX} new`, 60), backup('Discord (Ola) old', 2000), backup(`${AUTO_PREFIX} old`, 1000)];
  fake.limit = 3;
  assert.equal(await tickBackup(guild, config.lastAutoBackupAt + 5 * 3_600_000), false, 'not due yet');
  const due = config.lastAutoBackupAt + 6 * 3_600_000;
  assert.equal(await tickBackup(guild, due), true);
  assert.ok(fake.deleted.at(-1).includes('Discordautoold'), 'the oldest automatic backup was deleted');
  assert.ok(fake.backups.some((item) => item.name === 'Discord (Ola) old'), 'the hand-made one stays');
  assert.equal((await getWhitelistConfig(guild.id)).lastBackup.replaced, `${AUTO_PREFIX} old`);

  // Only locked or hand-made backups left: nothing is deleted, the failure is saved and retried in 30 min.
  fake.backups = [backup(`${AUTO_PREFIX} locked`, 30, { is_locked: true }), backup('Discord (Ola) a', 40), backup('Discord (Ola) b', 50)];
  const deletedBefore = fake.deleted.length;
  assert.equal(await tickBackup(guild, due + 6 * 3_600_000), false);
  assert.equal(fake.deleted.length, deletedBefore);
  const after = await getWhitelistConfig(guild.id);
  assert.equal(after.lastBackup.ok, false);
  assert.match(after.lastBackup.error, /slots are taken/);
  assert.equal(after.lastAutoBackupAt, due + 6 * 3_600_000 - 6 * 3_600_000 + 30 * 60_000);

  fake.limit = 0;
  await assert.rejects(createBackup({ panelUrl: PANEL, serverId: SERVER_ID, apiKey: KEY }), (error) => error.reason === 'none');
  fake.limit = 2;
  const off = await run('kopie', { co_ile: 0 });
  assert.match(replyText(off), /Automatic backups are off/);
  assert.equal(await tickBackup(guild, due + 100 * 3_600_000), false);
});
