// Panel API: authentication and validated settings changes over real HTTP.
import './helpers/env.js';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { Collection } from 'discord.js';
import { mockChannel, mockGuild, mockMember, mockRole, mockUser } from './helpers/mock.js';
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

test('welcome and goodbye messages can be switched between plain text and an embed', async () => {
  const before = (await call('GET', `/guilds/${guild.id}`)).json.modules.welcome;
  assert.deepEqual(
    { style: before.style, embedColor: before.embedColor, embedExtras: before.embedExtras, goodbyeStyle: before.goodbyeStyle, goodbyeEmbedColor: before.goodbyeEmbedColor },
    { style: 'embed', embedColor: '#30d158', embedExtras: true, goodbyeStyle: 'embed', goodbyeEmbedColor: '#ff453a' },
  );
  assert.ok(before.embedTitle && before.goodbyeEmbedTitle);

  const saved = await call('PATCH', `/guilds/${guild.id}/welcome`, {
    body: { style: 'text', embedTitle: '', embedColor: '#FF9F0A', embedExtras: false, goodbyeStyle: 'text', goodbyeEmbedTitle: 'Pa {username}' },
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(
    {
      style: saved.json.style, embedTitle: saved.json.embedTitle, embedColor: saved.json.embedColor, embedExtras: saved.json.embedExtras,
      goodbyeStyle: saved.json.goodbyeStyle, goodbyeEmbedTitle: saved.json.goodbyeEmbedTitle, goodbyeEmbedColor: saved.json.goodbyeEmbedColor, goodbyeEmbedExtras: saved.json.goodbyeEmbedExtras,
    },
    { style: 'text', embedTitle: '', embedColor: '#ff9f0a', embedExtras: false, goodbyeStyle: 'text', goodbyeEmbedTitle: 'Pa {username}', goodbyeEmbedColor: '#ff453a', goodbyeEmbedExtras: true },
  );
  // The message and channel saved earlier are untouched by a layout change.
  assert.deepEqual({ message: saved.json.message, channelId: saved.json.channelId }, { message: 'Siema {user}!', channelId: channel.id });

  for (const body of [{ style: 'fancy' }, { goodbyeStyle: 1 }, { embedColor: 'red' }, { embedTitle: 'x'.repeat(257) }, { embedExtras: 'no' }, { goodbyeEmbedColor: '#12345' }]) {
    assert.equal((await call('PATCH', `/guilds/${guild.id}/welcome`, { body })).status, 400, JSON.stringify(body));
  }
  assert.equal((await call('GET', `/guilds/${guild.id}`)).json.modules.welcome.style, 'text');
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

test('economy settings, shop and balances are changed from the panel', async () => {
  const { formatMoney, getEconomySettings, getShopItems, money } = await import('../src/services/economySettings.js');
  const { getEconomyData } = await import('../src/utils/economy.js');
  const role = mockRole(guild, 'VIP');
  const path = `/guilds/${guild.id}/economy`;

  const overview = await call('GET', `/guilds/${guild.id}`);
  assert.equal(overview.json.modules.economy.currency.symbol, '$');
  assert.equal(overview.json.modules.economy.commands.work.max, 100);
  assert.ok(overview.json.modules.economy.shop.items.some((item) => item.id === 'laptop' && item.price === item.defaultPrice && item.enabled));

  const saved = await call('PATCH', path, {
    body: {
      currency: { symbol: '<:zielony:1489590956075389089>', position: 'right', separator: ' ' },
      startingWallet: 250,
      payTaxPercent: 10,
      clearOnLeave: true,
      activity: { enabled: true, amount: 3, cooldownSeconds: 30 },
      channels: { mode: 'allow', list: [channel.id] },
      commands: { work: { min: 50, max: 80, cooldownMinutes: 15 }, gamble: { maxBet: 5000 } },
      shop: { premiumRoleId: role.id, items: { laptop: { price: 999 }, lucky_clover: { enabled: false } }, roles: [{ roleId: role.id, price: 4000, description: 'Kolorowy nick' }] },
    },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.shop.premiumRoleId, role.id);
  assert.equal(saved.json.shop.items.find((item) => item.id === 'laptop').price, 999);
  assert.deepEqual(saved.json.shop.roles, [{ roleId: role.id, price: 4000, description: 'Kolorowy nick' }]);

  const settings = await getEconomySettings(guild.id);
  assert.deepEqual(settings.commands.work, { min: 50, max: 80, cooldownMinutes: 15 });
  assert.equal(settings.commands.gamble.winPercent, 40);
  assert.equal(money(guild.id, 1234567), '1 234 567 <:zielony:1489590956075389089>');
  assert.equal(formatMoney({ currency: { symbol: '$', position: 'left', separator: ',' } }, 10000), '$10,000');
  assert.equal(formatMoney({ currency: { symbol: 'zł', position: 'right', separator: '.' } }, 10000), '10.000 zł');

  const items = getShopItems(settings, guild);
  assert.equal(items.some((item) => item.id === 'lucky_clover'), false);
  assert.equal(items.find((item) => item.id === `role_${role.id}`).price, 4000);

  for (const body of [
    { currency: { symbol: '@everyone' } },
    { currency: { position: 'top' } },
    { commands: { work: { min: 500, max: 5 } } },
    { commands: { work: { speed: 1 } } },
    { commands: { dance: { min: 1 } } },
    { channels: { mode: 'allow', list: ['123456789012345678'] } },
    { shop: { items: { rocket: { price: 1 } } } },
    { shop: { roles: [{ roleId: role.id, price: 0 }] } },
    { shop: { roles: [{ roleId: role.id, price: 5 }, { roleId: role.id, price: 6 }] } },
    { payTaxPercent: 150 },
  ]) {
    assert.equal((await call('PATCH', path, { body })).status, 400, JSON.stringify(body));
  }
  assert.deepEqual((await getEconomySettings(guild.id)).commands.work, { min: 50, max: 80, cooldownMinutes: 15 });

  const userId = '222222222222222222';
  assert.equal((await call('GET', `${path}/users/${userId}`)).json.wallet, 250);
  const set = await call('PATCH', `${path}/users/${userId}`, { body: { wallet: 1000, bank: 40 } });
  assert.deepEqual({ wallet: set.json.wallet, bank: set.json.bank }, { wallet: 1000, bank: 40 });
  const taken = await call('PATCH', `${path}/users/${userId}`, { body: { mode: 'add', wallet: -5000, bank: 10 } });
  assert.deepEqual({ wallet: taken.json.wallet, bank: taken.json.bank }, { wallet: 0, bank: 50 });
  assert.equal((await call('PATCH', `${path}/users/${userId}`, { body: { wallet: -1 } })).status, 400);
  assert.equal((await call('PATCH', `${path}/users/abc`, { body: { wallet: 1 } })).status, 400);

  const top = await call('GET', `${path}/top`);
  assert.deepEqual({ accounts: top.json.accounts, total: top.json.total, first: top.json.top[0].userId }, { accounts: 1, total: 50, first: userId });

  assert.equal((await call('POST', `${path}/reset`, { body: {} })).status, 400);
  assert.deepEqual((await call('POST', `${path}/reset`, { body: { confirm: guild.id } })).json, { removed: 1 });
  assert.equal((await getEconomyData(client, guild.id, userId)).bank, 0);
});

test('leveling settings and member levels are changed from the panel', async () => {
  const { calculateTotalXp, getLevelingConfig, getUserLevelData } = await import('../src/services/leveling/leveling.js');
  const role = mockRole(guild, 'Poziom 5');
  const path = `/guilds/${guild.id}/leveling`;
  // Kept from the time guild config was read only from PostgreSQL; any storage is read now (see storage.test.js).
  const memoryDb = client.db;
  client.db = Object.assign(Object.create(memoryDb), { isAvailable: () => true });

  try {
    const overview = (await call('GET', `/guilds/${guild.id}`)).json.modules.leveling;
    assert.deepEqual(
      { xpMin: overview.xpMin, xpMax: overview.xpMax, channel: overview.levelUpChannel, voice: overview.voice.xpPerMinute, clear: overview.clearOnLeave, first: overview.thresholds[0] },
      { xpMin: 15, xpMax: 25, channel: null, voice: 0, clear: true, first: { level: 1, xp: 50 } },
    );

    const saved = await call('PATCH', path, {
      body: {
        xpMin: 3, xpMax: 6, cooldownSeconds: 0, multiplierPercent: 150, levelUpChannel: 'same', levelUpMessage: ' GG {user}, poziom {level}! {money} ',
        rewards: [{ level: 5, roleId: role.id }], removePreviousRoles: true, moneyPerLevel: 200,
        channels: { mode: 'allow', list: [channel.id] }, roleMultipliers: [{ id: role.id, percent: 200 }], channelMultipliers: [{ id: channel.id, percent: 50 }],
        longMessageBonusPercent: 100, voice: { xpPerMinute: 3, countMuted: true }, clearOnLeave: false,
      },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.json));
    assert.deepEqual(saved.json.rewards, [{ level: 5, roleId: role.id }]);
    assert.equal(saved.json.levelUpChannel, 'same');
    assert.equal(saved.json.levelUpMessage, 'GG {user}, poziom {level}! {money}');

    const config = await getLevelingConfig(client, guild.id);
    assert.deepEqual(
      { range: config.xpRange, cooldown: config.xpCooldown, multiplier: config.xpMultiplier, same: config.levelUpSameChannel, rewards: config.roleRewards, money: config.moneyPerLevel,
        mode: config.channelMode, ignored: config.ignoredChannels, voice: config.voiceXpPerMinute, muted: config.voiceCountMuted, alone: config.voiceCountAlone, clear: config.clearOnLeave, configured: config.configured },
      { range: { min: 3, max: 6 }, cooldown: 0, multiplier: 1.5, same: true, rewards: { 5: role.id }, money: 200,
        mode: 'allow', ignored: [channel.id], voice: 3, muted: true, alone: false, clear: false, configured: true },
    );

    const back = await call('PATCH', path, { body: { levelUpChannel: channel.id, levelUpMessage: '' } });
    assert.equal(back.json.levelUpChannel, channel.id);
    assert.ok(back.json.levelUpMessage.includes('{level}'));

    for (const body of [
      { xpMin: 50, xpMax: 5 },
      { xpMax: 5000 },
      { levelUpChannel: '123456789012345678' },
      { rewards: [{ level: 5, roleId: role.id }, { level: 5, roleId: role.id }] },
      { rewards: [{ level: 0, roleId: role.id }] },
      { rewards: [{ level: 3, roleId: '123456789012345678' }] },
      { roleMultipliers: [{ id: role.id, percent: 5 }] },
      { channelMultipliers: [{ id: '123456789012345678', percent: 200 }] },
      { voice: { xpPerMinute: 1000 } },
      { roles: { mode: 'sometimes' } },
    ]) {
      assert.equal((await call('PATCH', path, { body })).status, 400, JSON.stringify(body));
    }
    assert.deepEqual((await getLevelingConfig(client, guild.id)).xpRange, { min: 3, max: 6 });

    const userId = '333333333333333333';
    const set = await call('PATCH', `${path}/users/${userId}`, { body: { level: 7 } });
    assert.deepEqual({ level: set.json.level, xp: set.json.xp, totalXp: set.json.totalXp }, { level: 7, xp: 0, totalXp: calculateTotalXp(7) });
    assert.equal((await getUserLevelData(client, guild.id, userId)).level, 7);
    assert.equal((await call('GET', `${path}/users/${userId}`)).json.level, 7);
    assert.equal((await call('PATCH', `${path}/users/${userId}`, { body: { level: 5000 } })).status, 400);
    assert.equal((await call('PATCH', `${path}/users/${userId}`, { body: {} })).status, 400);

    const top = await call('GET', `${path}/top`);
    assert.deepEqual({ members: top.json.members, first: top.json.top[0].userId, level: top.json.top[0].level }, { members: 1, first: userId, level: 7 });

    assert.equal((await call('POST', `${path}/reset`, { body: { confirm: 'yes' } })).status, 400);
    assert.deepEqual((await call('POST', `${path}/reset`, { body: { confirm: guild.id } })).json, { removed: 1 });
    assert.equal((await getUserLevelData(client, guild.id, userId)).level, 0);
  } finally {
    client.db = memoryDb;
  }
});

test('auto-roles for members and bots are saved, given on join and synced', async () => {
  const { default: memberAdd } = await import('../src/events/guildMemberAdd.js');
  const human = mockRole(guild, 'Człowiek');
  const robot = mockRole(guild, 'Robot');
  const booster = mockRole(guild, 'Booster', { managed: true });
  const path = `/guilds/${guild.id}/autorole`;
  const join = (name, extra = {}) => Object.assign(mockMember(guild, mockUser(name, extra.user), extra), { client });

  const saved = await call('PATCH', path, {
    body: { roleIds: [human.id], delaySeconds: 0, bots: { enabled: true, delay: false, different: true, roleIds: [robot.id] }, sync: { excludeRoleIds: [booster.id], daily: true } },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.deepEqual(saved.json, {
    roleIds: [human.id],
    delaySeconds: 0,
    bots: { enabled: true, delay: false, different: true, roleIds: [robot.id] },
    sync: { excludeRoleIds: [booster.id], daily: true, lastSyncAt: null },
  });
  const overview = (await call('GET', `/guilds/${guild.id}`)).json.modules;
  assert.deepEqual(overview.autorole.roleIds, [human.id]);
  assert.equal(overview.welcome.autoRoleId, human.id);

  // On join: a person gets the join role, a bot gets the bot role.
  const person = join('zosia');
  const bot = join('dyno', { user: { bot: true } });
  await memberAdd.execute(person);
  await memberAdd.execute(bot);
  assert.deepEqual([...person.roles.cache.keys()], [human.id]);
  assert.deepEqual([...bot.roles.cache.keys()], [robot.id]);

  await call('PATCH', path, { body: { bots: { enabled: false } } });
  const quiet = join('mee6', { user: { bot: true } });
  await memberAdd.execute(quiet);
  assert.equal(quiet.roles.cache.size, 0);
  await call('PATCH', path, { body: { bots: { enabled: true } } });

  // Sync: everyone already on the server who misses a role, except members with an excluded role.
  const late = join('kuba');
  const skipped = join('wspierajacy', { roles: [booster] });
  const before = (await call('GET', `${path}/sync`)).json;
  assert.equal(before.running, false);
  assert.ok(before.missing >= 2, JSON.stringify(before));

  const started = await call('POST', `${path}/sync`);
  assert.equal(started.status, 200, JSON.stringify(started.json));
  assert.equal(started.json.total, before.missing);
  let status = started.json;
  for (let attempt = 0; status.running && attempt < 100; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    status = (await call('GET', `${path}/sync`)).json;
  }
  assert.deepEqual({ running: status.running, done: status.done, failed: status.failed, missing: status.missing }, { running: false, done: before.missing, failed: 0, missing: 0 });
  assert.ok(status.lastSyncAt > 0);
  assert.ok(late.roles.cache.has(human.id) && quiet.roles.cache.has(robot.id));
  assert.ok(!skipped.roles.cache.has(human.id));
  assert.ok(!guild.members.me.roles.cache.has(robot.id));

  for (const body of [
    { roleIds: [booster.id] },
    { roleIds: ['123456789012345678'] },
    { roleIds: [human.id, null] },
    { roleIds: Array(6).fill(human.id) },
    { delaySeconds: 601 },
    { bots: { enabled: 'yes' } },
    { sync: { excludeRoleIds: [guild.id] } },
  ]) {
    assert.equal((await call('PATCH', path, { body })).status, 400, JSON.stringify(body));
  }
  assert.equal((await call('PATCH', path, { body: { roleIds: [] } })).json.roleIds.length, 0);
});

test('ticket settings are saved and the panel message follows them', async () => {
  const { getGuildConfig } = await import('../src/services/config/guildConfig.js');
  const panel = mockChannel(guild, 'pomoc');
  const category = mockChannel(guild, 'TICKETY', { type: 4 });
  const staff = mockRole(guild, 'Obsługa');
  const path = `/guilds/${guild.id}/tickets`;

  const overview = (await call('GET', `/guilds/${guild.id}`)).json;
  assert.equal(overview.modules.tickets.panelChannelId, null);
  assert.equal(overview.modules.tickets.maxTicketsPerUser, 3);
  assert.ok(overview.categories.some((entry) => entry.id === category.id));
  assert.ok(!overview.channels.some((entry) => entry.id === category.id));

  const saved = await call('PATCH', path, {
    body: { panelChannelId: panel.id, panelMessage: ' Napisz do obsługi. ', buttonLabel: 'Otwórz zgłoszenie', categoryId: category.id, staffRoleId: staff.id, maxTicketsPerUser: 2, dmOnClose: false },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(panel.sent.length, 1);
  assert.equal(panel.sent[0].embeds[0].toJSON().description, 'Napisz do obsługi.');
  const button = panel.sent[0].components[0].toJSON().components[0];
  assert.deepEqual({ id: button.custom_id, label: button.label }, { id: 'create_ticket', label: 'Otwórz zgłoszenie' });
  assert.deepEqual(
    { posted: saved.json.panelPosted, max: saved.json.maxTicketsPerUser, dm: saved.json.dmOnClose, staff: saved.json.staffRoleId, category: saved.json.categoryId },
    { posted: true, max: 2, dm: false, staff: staff.id, category: category.id },
  );
  const config = await getGuildConfig(client, guild.id);
  assert.deepEqual(
    { message: config.ticketPanelMessageId, category: config.ticketCategoryId, staff: config.ticketStaffRoleId, max: config.maxTicketsPerUser },
    { message: panel.sent[0].id, category: category.id, staff: staff.id, max: 2 },
  );

  // Settings that are not part of the panel message leave it alone.
  await call('PATCH', path, { body: { maxTicketsPerUser: 3, panelMessage: 'Napisz do obsługi.' } });
  assert.equal(panel.sent.length, 1);

  // A new text edits the message that is already posted.
  let edited = null;
  panel.messages.fetch = async (id) => panel.sent.find((message) => message.id === id) ?? null;
  panel.sent[0].edit = async (payload) => { edited = payload; };
  await call('PATCH', path, { body: { panelMessage: 'Nowa treść' } });
  assert.equal(panel.sent.length, 1);
  assert.equal(edited.embeds[0].toJSON().description, 'Nowa treść');

  // Switching the panel off removes the message; the other settings stay.
  let deleted = false;
  panel.sent[0].delete = async () => { deleted = true; };
  const off = await call('PATCH', path, { body: { panelChannelId: null } });
  assert.deepEqual({ channel: off.json.panelChannelId, posted: off.json.panelPosted, staff: off.json.staffRoleId }, { channel: null, posted: false, staff: staff.id });
  assert.ok(deleted);

  for (const body of [
    { panelChannelId: category.id },
    { categoryId: panel.id },
    { maxTicketsPerUser: 11 },
    { buttonLabel: 'x'.repeat(81) },
    { staffRoleId: '123456789012345678' },
    { dmOnClose: 'no' },
  ]) {
    assert.equal((await call('PATCH', path, { body })).status, 400, JSON.stringify(body));
  }
});

test('temporary voice channels are set up from the panel', async () => {
  const { formatChannelName, getJoinToCreateConfig } = await import('../src/utils/database.js');
  const voice = mockChannel(guild, 'Stwórz kanał', { type: 2 });
  const path = `/guilds/${guild.id}/tempvoice`;
  const pick = ({ enabled, triggerChannelId, nameTemplate, userLimit, bitrateKbps }) => ({ enabled, triggerChannelId, nameTemplate, userLimit, bitrateKbps });

  const overview = (await call('GET', `/guilds/${guild.id}`)).json;
  assert.deepEqual({ enabled: overview.modules.tempvoice.enabled, trigger: overview.modules.tempvoice.triggerChannelId }, { enabled: false, trigger: null });
  assert.ok(overview.voiceChannels.some((entry) => entry.id === voice.id));
  assert.equal((await call('PATCH', path, { body: { enabled: true } })).status, 400);

  const saved = await call('PATCH', path, { body: { enabled: true, triggerChannelId: voice.id, nameTemplate: 'Pokój {displayName} 🎮', userLimit: 5, bitrateKbps: 96 } });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.deepEqual(pick(saved.json), { enabled: true, triggerChannelId: voice.id, nameTemplate: 'Pokój {displayName} 🎮', userLimit: 5, bitrateKbps: 96 });

  const config = await getJoinToCreateConfig(client, guild.id);
  assert.deepEqual(
    { enabled: config.enabled, triggers: config.triggerChannels, options: config.channelOptions[voice.id] },
    { enabled: true, triggers: [voice.id], options: { nameTemplate: 'Pokój {displayName} 🎮', userLimit: 5, bitrate: 96000 } },
  );
  // The room name keeps Polish letters and emoji.
  assert.equal(formatChannelName(config.channelOptions[voice.id].nameTemplate, { displayName: 'Zośka' }), 'Pokój Zośka 🎮');

  // "new": the bot creates the channel people join; the room settings carry over.
  const created = await call('PATCH', path, { body: { triggerChannelId: 'new', newChannelName: '➕ Stwórz kanał' } });
  assert.equal(created.status, 200, JSON.stringify(created.json));
  const trigger = guild.channels.cache.get(created.json.triggerChannelId);
  assert.notEqual(trigger.id, voice.id);
  assert.deepEqual({ name: trigger.name, type: trigger.type }, { name: '➕ Stwórz kanał', type: 2 });
  assert.deepEqual(pick(created.json), { enabled: true, triggerChannelId: trigger.id, nameTemplate: 'Pokój {displayName} 🎮', userLimit: 5, bitrateKbps: 96 });

  assert.equal((await call('PATCH', path, { body: { enabled: false } })).json.enabled, false);
  const removed = await call('PATCH', path, { body: { triggerChannelId: null } });
  assert.deepEqual({ enabled: removed.json.enabled, trigger: removed.json.triggerChannelId }, { enabled: false, trigger: null });

  for (const body of [
    { triggerChannelId: channel.id },
    { userLimit: 100 },
    { bitrateKbps: 500 },
    { nameTemplate: '#{username}' },
    { nameTemplate: '{nick}' },
    { nameTemplate: '' },
  ]) {
    assert.equal((await call('PATCH', path, { body })).status, 400, JSON.stringify(body));
  }
});
