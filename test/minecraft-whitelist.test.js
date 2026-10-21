// Minecraft whitelist channel against a fake Pterodactyl panel (MatHost) and a fake Mojang API.
import './helpers/env.js';
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Collection, PermissionFlagsBits } from 'discord.js';
import { mockChannel, mockGuild, mockInteraction, mockMember, mockUser, replyText } from './helpers/mock.js';
import { runWithLocale } from '../src/i18n/index.js';
import { initializeDatabase } from '../src/utils/database.js';
import { loadCommands } from '../src/handlers/loaders/commandLoader.js';
import {
  getWhitelistConfig,
  handleWhitelistMessage,
  normalizePanelUrl,
  normalizeServerId,
  offlineUuid,
  parseNick,
  releaseMemberOnLeave,
  updateWhitelistConfig,
  whitelistTiming,
} from '../src/services/minecraftWhitelist.js';
import { submitWhitelistSetup } from '../src/commands/Minecraft/modules/whitelist.js';

const PANEL = 'https://ptero.mathost.eu';
const SERVER_ID = 'abc12345';
const KEY = 'ptlc_TestKeyForTheFakePanel0123456789';
const PREMIUM = { pikczu: { id: '0f2c4e1a9b8d4c7e8f6a5b4c3d2e1f00', name: 'Pikczu' }, notch: { id: '069a79f444e94726a5befca90e38aaf5', name: 'Notch' } };

const fake = { state: 'running', files: {}, commands: [], requests: [] };
const realFetch = globalThis.fetch;

function reply(status, body = null, type = 'application/json') {
  return new Response(status === 204 ? null : (typeof body === 'string' ? body : JSON.stringify(body)), { status, headers: { 'Content-Type': type } });
}

const whitelist = () => JSON.parse(fake.files['/whitelist.json'] ?? '[]');

async function fakeFetch(url, options = {}) {
  const address = new URL(url);
  fake.requests.push({ url: String(url), auth: options.headers?.Authorization });
  if (address.hostname === 'api.mojang.com') {
    const profile = PREMIUM[decodeURIComponent(address.pathname.split('/').pop()).toLowerCase()];
    return profile ? reply(200, profile) : reply(404, { errorMessage: 'not found' });
  }
  const base = `/api/client/servers/${SERVER_ID}`;
  if (address.origin !== PANEL || !address.pathname.startsWith(base)) return reply(404, { errors: [{ detail: 'not found' }] });
  if (options.headers?.Authorization !== `Bearer ${KEY}`) return reply(401, { errors: [{ detail: 'Unauthenticated.' }] });
  const path = address.pathname.slice(base.length);
  const file = address.searchParams.get('file');

  if (path === '') return reply(200, { attributes: { name: 'Klubik SMP', identifier: SERVER_ID } });
  if (path === '/resources') return reply(200, { attributes: { current_state: fake.state } });
  if (path === '/files/contents') return file in fake.files ? reply(200, fake.files[file], 'text/plain') : reply(404, { errors: [{ detail: 'missing' }] });
  if (path === '/files/write') {
    fake.files[file] = options.body;
    return reply(204);
  }
  if (path === '/command') {
    if (fake.state !== 'running') return reply(502, { errors: [{ detail: 'Server must be online in order to send commands.' }] });
    const { command } = JSON.parse(options.body);
    fake.commands.push(command);
    const [, action, nick] = command.split(' ');
    const list = whitelist();
    const online = !/online-mode=false/.test(fake.files['/server.properties'] ?? '');
    const profile = PREMIUM[nick.toLowerCase()];
    if (action === 'add' && (profile || !online)) list.push({ uuid: profile ? profile.id : offlineUuid(nick), name: profile?.name ?? nick });
    const next = action === 'remove' ? list.filter((entry) => entry.name.toLowerCase() !== nick.toLowerCase()) : list;
    fake.files['/whitelist.json'] = JSON.stringify(next);
    return reply(204);
  }
  return reply(404, { errors: [{ detail: 'route' }] });
}

const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null } };
let guild;
let channel;
let admin;

function mockMessage(member, content, inChannel = channel) {
  const message = {
    guild,
    member,
    author: member.user,
    channel: inChannel,
    channelId: inChannel.id,
    content,
    reactions: [],
    answers: [],
    react: async (emoji) => { message.reactions.push(emoji); },
    reply: async (payload) => { message.answers.push(payload); return { delete: async () => {} }; },
  };
  return message;
}

const answerText = (message) => replyText({ replies: message.answers });

async function say(member, content, locale = 'en') {
  const message = mockMessage(member, content);
  const handled = await runWithLocale(locale, () => handleWhitelistMessage(message));
  return { handled, message, ok: message.reactions.at(-1) === '✅', text: answerText(message) };
}

async function setUp() {
  await updateWhitelistConfig(guild.id, (data) => {
    Object.assign(data, { enabled: true, channelId: channel.id, roleId: null, removeOnLeave: true, panelUrl: PANEL, serverId: SERVER_ID, apiKey: KEY, members: {} });
  });
}

before(async () => {
  const { db } = await initializeDatabase();
  client.db = db;
  await loadCommands(client);
  guild = mockGuild(client);
  channel = mockChannel(guild, 'whitelista');
  admin = mockMember(guild, mockUser('Pikczu'), { permissions: [PermissionFlagsBits.Administrator] });
  globalThis.fetch = fakeFetch;
  Object.assign(whitelistTiming, { confirmDelayMs: 0, confirmAttempts: 2, memberCooldownMs: 0 });
});

after(() => {
  globalThis.fetch = realFetch;
});

beforeEach(async () => {
  fake.state = 'running';
  fake.files = { '/whitelist.json': '[]', '/server.properties': 'online-mode=true\nwhite-list=true\n' };
  fake.commands = [];
  fake.requests = [];
  await setUp();
});

test('nick, panel address and server ID checks', () => {
  assert.equal(parseNick('Pikczu_77'), 'Pikczu_77');
  assert.equal(parseNick('  `Notch`  '), 'Notch');
  assert.equal(parseNick('mój nick to Pikczu'), null);
  assert.equal(parseNick('ab'), null);
  assert.equal(parseNick('x'.repeat(17)), null);
  assert.equal(parseNick('Pikczu\nop Pikczu'), null);

  assert.equal(normalizePanelUrl('ptero.mathost.eu'), PANEL);
  assert.equal(normalizePanelUrl('https://ptero.mathost.eu/server/abc12345'), PANEL);
  for (const bad of ['http://ptero.mathost.eu', 'https://127.0.0.1', 'https://localhost', 'https://[::1]', 'nie-adres']) {
    assert.throws(() => normalizePanelUrl(bad), bad);
  }
  assert.equal(normalizeServerId('https://ptero.mathost.eu/server/ABC12345/console'), 'abc12345');
  assert.equal(normalizeServerId('abc12345'), 'abc12345');
  assert.throws(() => normalizeServerId('abc 123'));

  // Same as Java's UUID.nameUUIDFromBytes("OfflinePlayer:Notch").
  assert.equal(offlineUuid('Notch'), 'b50ad385-829d-3141-a216-7e7d7539ba7f');
});

test('a nick written in the channel goes on the whitelist through the panel console', async () => {
  const member = mockMember(guild, mockUser('Gracz1'));
  const result = await say(member, 'pikczu', 'pl');
  assert.equal(result.handled, true);
  assert.equal(result.ok, true, result.text);
  assert.deepEqual(fake.commands, ['whitelist add pikczu']);
  assert.match(result.text, /Dodano `Pikczu` do whitelisty/);
  assert.equal((await getWhitelistConfig(guild.id)).members[member.id].name, 'Pikczu');
  assert.ok(fake.requests.every((request) => !request.url.includes(KEY)), 'the key never goes into a URL');

  const again = await say(member, 'Pikczu');
  assert.equal(again.ok, true);
  assert.match(again.text, /is on the whitelist/);
  assert.equal(fake.commands.length, 1, 'no second console command');
});

test('a new nick replaces the old one; someone else cannot take a held nick', async () => {
  const member = mockMember(guild, mockUser('Gracz2'));
  await say(member, 'Pikczu');
  const swap = await say(member, 'Notch');
  assert.equal(swap.ok, true, swap.text);
  assert.deepEqual(fake.commands, ['whitelist add Pikczu', 'whitelist add Notch', 'whitelist remove Pikczu']);
  assert.match(swap.text, /`Pikczu` was taken off/);
  assert.deepEqual(whitelist().map((entry) => entry.name), ['Notch']);

  const other = mockMember(guild, mockUser('Gracz3'));
  const stolen = await say(other, 'notch');
  assert.equal(stolen.ok, false);
  assert.match(stolen.text, /already belongs to someone else/);
});

test('wrong text, unknown premium nick and other channels', async () => {
  const member = mockMember(guild, mockUser('Gracz4'));
  const chatter = await say(member, 'siema, mój nick to Pikczu', 'pl');
  assert.equal(chatter.ok, false);
  assert.match(chatter.text, /Napisz sam nick/);

  const unknown = await say(member, 'BrakKonta123');
  assert.equal(unknown.ok, false);
  assert.match(unknown.text, /did not add `BrakKonta123`/);
  assert.equal((await getWhitelistConfig(guild.id)).members[member.id], undefined);

  const elsewhere = mockMessage(member, 'Pikczu', mockChannel(guild, 'ogolny'));
  assert.equal(await handleWhitelistMessage(elsewhere), false);
  assert.deepEqual(elsewhere.reactions, []);
});

test('a stopped server gets whitelist.json edited: Mojang UUID or the offline UUID', async () => {
  fake.state = 'offline';
  const member = mockMember(guild, mockUser('Gracz5'));
  const premium = await say(member, 'notch');
  assert.equal(premium.ok, true, premium.text);
  assert.deepEqual(fake.commands, []);
  assert.deepEqual(whitelist(), [{ uuid: '069a79f4-44e9-4726-a5be-fca90e38aaf5', name: 'Notch' }]);

  const missing = await say(mockMember(guild, mockUser('Gracz6')), 'BrakKonta123');
  assert.match(missing.text, /No Minecraft account is called/);

  fake.files['/server.properties'] = 'online-mode=false\n';
  const cracked = await say(mockMember(guild, mockUser('Gracz7')), 'Steve_PL');
  assert.equal(cracked.ok, true, cracked.text);
  assert.deepEqual(whitelist().at(-1), { uuid: offlineUuid('Steve_PL'), name: 'Steve_PL' });

  fake.state = 'starting';
  const busy = await say(mockMember(guild, mockUser('Gracz8')), 'Alex');
  assert.match(busy.text, /starting or stopping/);
});

test('a member who leaves Discord loses their place; a refused key is explained', async () => {
  const member = mockMember(guild, mockUser('Gracz9'));
  await say(member, 'Pikczu');
  assert.equal(await releaseMemberOnLeave(guild, member.id), true);
  assert.deepEqual(whitelist(), []);
  assert.equal((await getWhitelistConfig(guild.id)).members[member.id], undefined);

  await updateWhitelistConfig(guild.id, (data) => { data.apiKey = 'ptlc_WrongKeyWrongKeyWrongKey'; });
  const refused = await say(mockMember(guild, mockUser('Gracz10')), 'Notch', 'pl');
  assert.equal(refused.ok, false);
  assert.match(refused.text, /Panel odrzucił klucz API/);
});

function setupInteraction(fields, args) {
  const interaction = mockInteraction({ client, guild, channel, member: admin, commandName: 'minecraft' });
  interaction.fields = { getTextInputValue: (name) => fields[name] ?? '' };
  return { interaction, args };
}

test('setup form checks the panel, saves the key and never shows it', async () => {
  await updateWhitelistConfig(guild.id, (data) => { Object.assign(data, { enabled: false, apiKey: null }); });
  const before = channel.sent.length;
  const { interaction, args } = setupInteraction(
    { panel: 'ptero.mathost.eu', server: `${PANEL}/server/${SERVER_ID}`, key: KEY },
    ['ustaw', channel.id, '-', '1'],
  );
  await runWithLocale('pl', () => submitWhitelistSetup(interaction, args));
  const text = replyText(interaction);
  assert.match(text, /Whitelista Minecraft włączona/);
  assert.match(text, /Klubik SMP/);
  assert.ok(!text.includes(KEY));
  assert.equal(channel.sent.length, before + 1, 'the guide is posted in the channel');
  const saved = await getWhitelistConfig(guild.id);
  assert.equal(saved.enabled, true);
  assert.equal(saved.apiKey, KEY);

  // An empty key keeps the saved one, but not for a different panel.
  const keep = setupInteraction({ panel: PANEL, server: SERVER_ID, key: '' }, ['ustaw', channel.id, '-', '0']);
  await submitWhitelistSetup(keep.interaction, keep.args);
  assert.equal((await getWhitelistConfig(guild.id)).removeOnLeave, false);
  const moved = setupInteraction({ panel: 'panel.inny-host.pl', server: SERVER_ID, key: '' }, ['ustaw', channel.id, '-', '1']);
  await assert.rejects(submitWhitelistSetup(moved.interaction, moved.args), /type the API key again/i);

  fake.files['/server.properties'] = 'online-mode=true\nwhite-list=false\n';
  const warned = setupInteraction({ panel: PANEL, server: SERVER_ID, key: KEY }, ['ustaw', channel.id, '-', '1']);
  await submitWhitelistSetup(warned.interaction, warned.args);
  assert.match(replyText(warned.interaction), /white-list=false/);
});

test('/minecraft whitelista: admin add, remove, list and off', async () => {
  const command = client.commands.get('minecraft');
  const run = async (subcommand, options = {}, member = admin) => {
    const interaction = mockInteraction({ client, guild, channel, member, commandName: 'minecraft', group: 'whitelista', subcommand, options });
    interaction.options.getSubcommandGroup = () => 'whitelista';
    await runWithLocale('en', () => command.execute(interaction, {}, client));
    return interaction;
  };

  await assert.rejects(run('lista', {}, mockMember(guild, mockUser('Zwykly'))));

  const owner = mockMember(guild, mockUser('Gracz11'));
  assert.match(replyText(await run('dodaj', { nick: 'Pikczu', osoba: owner.user })), /belongs to/);
  assert.match(replyText(await run('dodaj', { nick: 'Notch' })), /Added `Notch`/);
  const list = replyText(await run('lista'));
  assert.match(list, new RegExp(`<@${owner.id}> — \`Pikczu\``));
  assert.match(list, /On the server whitelist\n2/);

  assert.match(replyText(await run('usun', { nick: 'pikczu' })), /Took `pikczu` off/);
  assert.equal((await getWhitelistConfig(guild.id)).members[owner.id], undefined);
  await assert.rejects(run('dodaj', { nick: 'zły nick' }));

  await run('wylacz');
  const off = await getWhitelistConfig(guild.id);
  assert.equal(off.enabled, false);
  assert.equal(off.apiKey, null);
  assert.equal(await handleWhitelistMessage(mockMessage(owner, 'Pikczu')), false);
});

test('/minecraft whitelista ustaw opens the private form (Polish labels fit Discord limits)', async () => {
  const command = client.commands.get('minecraft');
  const interaction = mockInteraction({
    client, guild, channel, member: admin, commandName: 'minecraft', group: 'whitelista', subcommand: 'ustaw',
    options: { kanal: channel, usun_po_wyjsciu: false },
  });
  interaction.options.getSubcommandGroup = () => 'whitelista';
  let modal = null;
  interaction.showModal = async (built) => { modal = built.toJSON(); };
  await runWithLocale('pl', () => command.execute(interaction, {}, client));
  assert.equal(modal.custom_id, `whitelista:ustaw:${channel.id}:-:0`);
  assert.equal(modal.title, 'Panel serwera Minecraft');
  const inputs = modal.components.map((row) => row.components[0]);
  assert.deepEqual(inputs.map((input) => input.custom_id), ['panel', 'server', 'key']);
  assert.ok(inputs.every((input) => input.label.length <= 45));
  assert.equal(inputs[0].value, PANEL);
  assert.equal(inputs[2].required, false, 'a saved key may stay');
  assert.ok(!JSON.stringify(modal).includes(KEY), 'the saved key is never sent back to Discord');
});
