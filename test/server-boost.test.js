// 2026-11-01: rewards for members who boost the server (services/serverBoost.js, /booster, panel module "Boost serwera").
import './helpers/env.js';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { Collection, MessageType, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { mockChannel, mockGuild, mockInteraction, mockMember, mockRole, mockUser, replyText } from './helpers/mock.js';
import { initializeDatabase } from '../src/utils/database.js';
import { getEconomyData, setEconomyData } from '../src/utils/economy.js';
import { runWithLocale, t } from '../src/i18n/index.js';
import { activeEventType, earningsLine, getEconomySettings, scaleEarnings, serverBoostPercent, updateEconomySettings } from '../src/services/economySettings.js';
import { xpBoostFactor } from '../src/services/boosts.js';
import { economyStatsView, flushEconomyStats } from '../src/services/economyStats.js';
import { progressOptions } from '../src/services/progress.js';
import {
  BOOST_MESSAGE_TYPES, EVENT_GAP_MS, REWARD_EVERY_MS, ROLE_CHANGE_GAP_MS, THANKS_GAP_MS,
  getBoostData, handleBoostMessage, noteBoostChange, processBooster, removeBoosterRole, roleProblem, setBoosterRole, tickServerBoost,
} from '../src/services/serverBoost.js';

const KEY = 'test-panel-key-0123456789abcdef';
const NOW = Date.UTC(2026, 10, 2, 11, 0, 0);
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

/** A server with a thanks channel and an events channel. `sent` and `eventsSent` collect what the bot posted. */
async function setup(name, patch = {}) {
  const guild = mockGuild(client, name);
  guild.premiumSubscriptionCount = 3;
  guild.premiumTier = 1;
  const channel = mockChannel(guild, 'boosty');
  const sent = [];
  channel.send = async (message) => { sent.push(message); return { id: '1' }; };
  const eventsChannel = mockChannel(guild, 'eventy');
  const eventsSent = [];
  eventsChannel.send = async (message) => { eventsSent.push(message); return { id: '2' }; };
  eventsChannel.messages = { delete: async () => {} };
  await updateEconomySettings(guild.id, (data) => {
    Object.assign(data.serverBoost, { channelId: channel.id, ...patch });
    data.events.channelId = eventsChannel.id;
  });
  return { guild, channel, sent, eventsSent };
}

const booster = (guild, name = 'pat', since = NOW) => {
  const member = mockMember(guild, mockUser(name));
  member.client = client;
  member.premiumSinceTimestamp = since;
  return member;
};
const description = (message) => message.embeds[0].data.description;
const walletOf = async (guild, member) => (await getEconomyData(client, guild.id, member.id)).wallet;

function withRoles(guild, { anchorPosition = 5, botPosition = 20 } = {}) {
  const anchor = mockRole(guild, 'Server Booster', { position: anchorPosition, tags: { premiumSubscriberRole: true } });
  guild.roles.premiumSubscriberRole = anchor;
  guild.members.me.roles.highest = { position: botPosition };
  const created = [];
  guild.roles.create = async (options) => {
    const role = mockRole(guild, options.name, {
      options,
      setPosition: async (position) => { role.position = position; return role; },
      edit: async (data) => { Object.assign(role, data); return role; },
      delete: async () => { guild.roles.cache.delete(role.id); role.deleted = true; },
    });
    created.push(role);
    return role;
  };
  return { anchor, created };
}

// ---------- a new boost ----------

test('a new boost: money, a pack, the bonus flag, thanks and the event, once', async () => {
  const { guild, sent, eventsSent } = await setup('Nowy boost');
  const member = booster(guild);
  const before = await walletOf(guild, member);

  const first = await processBooster(guild, member, { boosted: true, now: NOW });
  assert.ok(first.reward && first.thanks && first.party);
  assert.equal(await walletOf(guild, member), before + 50_000);
  const userData = await getEconomyData(client, guild.id, member.id);
  assert.equal(userData.serverBooster, true);
  assert.equal(Object.values(userData.cards).reduce((sum, count) => sum + count, 0), 3, 'a Legend pack has 3 cards');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].content, member.toString());
  assert.deepEqual(sent[0].allowedMentions, { parse: [], users: [member.id] });
  assert.match(description(sent[0]), /\$50,000/);
  assert.match(description(sent[0]), /30 min/);
  assert.equal(eventsSent.length, 1);
  assert.equal(activeEventType(await getEconomySettings(guild.id), NOW + 60_000), 'kasa');

  // The system message and the member update come for the same boost: nothing happens twice.
  const second = await processBooster(guild, member, { boosted: true, now: NOW + 1000 });
  assert.ok(!second.reward && !second.thanks && !second.party);
  assert.equal(await walletOf(guild, member), before + 50_000);
  assert.equal(sent.length, 1);
  assert.equal(eventsSent.length, 1);
});

test('events and messages both end in the same place', async () => {
  const { guild, sent } = await setup('Zdarzenia');
  const member = booster(guild, 'kim', Date.now());
  await noteBoostChange(member);
  assert.equal(sent.length, 1);

  const message = { guild, member, author: member.user, type: MessageType.GuildBoost };
  assert.ok(BOOST_MESSAGE_TYPES.has(message.type));
  await handleBoostMessage(message);
  assert.equal(sent.length, 1, 'the same boost is not thanked twice');
});

test('the thanks text comes from the panel and cannot ping anyone else', async () => {
  const { guild, sent } = await setup('Tekst', { message: '{user} @everyone na {server}: {boosts}' });
  const member = booster(guild, 'ola');
  await processBooster(guild, member, { boosted: true, now: NOW });
  assert.match(description(sent[0]), new RegExp(`<@${member.id}> @everyone na Tekst: 3`));
  assert.deepEqual(sent[0].allowedMentions.parse, []);
});

test('an event that is already running stays', async () => {
  const { guild, eventsSent } = await setup('Trwa event');
  await updateEconomySettings(guild.id, (data) => { data.events.active = { type: 'ryby', startedAt: NOW, endsAt: NOW + 3_600_000 }; });
  const result = await processBooster(guild, booster(guild), { boosted: true, now: NOW });
  assert.equal(result.party, false);
  assert.equal(eventsSent.length, 0);
  assert.equal((await getEconomySettings(guild.id)).events.active.type, 'ryby');
});

test('eventMinutes 0 and no channel: the rest still works', async () => {
  const { guild, sent, eventsSent } = await setup('Bez kanalu', { channelId: null, eventMinutes: 0 });
  const member = booster(guild);
  const result = await processBooster(guild, member, { boosted: true, now: NOW });
  assert.ok(result.reward);
  assert.equal(result.party, false);
  assert.equal(sent.length + eventsSent.length, 0);
});

// ---------- what a booster gets while boosting ----------

test('the bonus: money through scaleEarnings, XP through xpBoostFactor, nothing when turned off', async () => {
  const { guild } = await setup('Bonus');
  const settings = await getEconomySettings(guild.id);
  assert.equal(scaleEarnings(settings, 1000, {}), 1000);
  assert.equal(scaleEarnings(settings, 1000, { serverBooster: true }), 1250);
  assert.equal(scaleEarnings(settings, 1000), 1000, 'prices have no member and no bonus');
  assert.match(earningsLine(settings, { serverBooster: true }), /\+25%/);
  assert.equal(earningsLine(settings, {}), '');

  const member = booster(guild);
  assert.equal(await xpBoostFactor(client, guild.id, member.id, NOW), 1);
  await processBooster(guild, member, { now: NOW });
  assert.equal(await xpBoostFactor(client, guild.id, member.id, NOW), 1.25);

  await updateEconomySettings(guild.id, (data) => { data.serverBoost.enabled = false; });
  const off = await getEconomySettings(guild.id);
  assert.equal(serverBoostPercent(off, { serverBooster: true }, 'moneyPercent'), 0);
  assert.equal(await xpBoostFactor(client, guild.id, member.id, NOW), 1);
});

test('turned off: no reward and no thanks, they come when it is turned on again', async () => {
  const { guild, sent } = await setup('Wylaczone', { enabled: false });
  const member = booster(guild);
  const result = await processBooster(guild, member, { boosted: true, now: NOW });
  assert.equal(result.reward, null);
  assert.equal(sent.length, 0);
  await updateEconomySettings(guild.id, (data) => { data.serverBoost.enabled = true; });
  assert.ok((await processBooster(guild, member, { now: NOW + 1000 })).reward);
});

test('the reward comes every 30 days and taking the boost off and on pays nothing extra', async () => {
  const { guild, sent } = await setup('Co 30 dni');
  const member = booster(guild);
  const start = await walletOf(guild, member);
  await processBooster(guild, member, { boosted: true, now: NOW });

  member.premiumSinceTimestamp = null;
  await noteBoostChange(member);
  assert.equal((await getEconomyData(client, guild.id, member.id)).serverBooster, false);
  assert.equal((await getBoostData(guild.id)).members[member.id].active, false);

  member.premiumSinceTimestamp = NOW + 3_600_000;
  const again = await processBooster(guild, member, { boosted: true, now: NOW + 3_600_000 });
  assert.equal(again.reward, null);
  assert.equal(again.thanks, false, 'one thanks a day');
  assert.equal(await walletOf(guild, member), start + 50_000);
  assert.equal((await getEconomyData(client, guild.id, member.id)).serverBooster, true);

  await tickServerBoost(guild, NOW + REWARD_EVERY_MS - 1000);
  assert.equal(await walletOf(guild, member), start + 50_000);
  await tickServerBoost(guild, NOW + REWARD_EVERY_MS + 1000);
  assert.equal(await walletOf(guild, member), start + 100_000);
  assert.equal(sent.length, 2);
  assert.match(description(sent[1]), /reward number 2/);
});

test('a second boost by the same member: thanks and event again after their breaks, no extra money', async () => {
  const { guild, sent } = await setup('Drugi boost', { eventMinutes: 10 });
  const member = booster(guild);
  await processBooster(guild, member, { boosted: true, now: NOW });
  const wallet = await walletOf(guild, member);

  const soon = await processBooster(guild, member, { boosted: true, now: NOW + THANKS_GAP_MS - 1000 });
  assert.equal(soon.thanks, false);
  const nextDay = await processBooster(guild, member, { boosted: true, now: NOW + THANKS_GAP_MS + 1000 });
  assert.equal(nextDay.thanks, true);
  assert.equal(nextDay.party, false, 'one event a week per member');
  const nextWeek = await processBooster(guild, member, { boosted: true, now: NOW + EVENT_GAP_MS + 1000 });
  assert.equal(nextWeek.party, true);
  assert.equal(await walletOf(guild, member), wallet);
  assert.equal(sent.length, 3);
});

test('the job: an old booster gets the reward in silence, no party; a member who left loses the record', async () => {
  const { guild, sent, eventsSent } = await setup('Stary booster');
  const old = booster(guild, 'stary', NOW - 200 * 86_400_000);
  const fresh = booster(guild, 'nowy', NOW - 60_000);
  await tickServerBoost(guild, NOW);
  const { members } = await getBoostData(guild.id);
  assert.equal(members[old.id].rewards, 1);
  assert.equal(members[old.id].lastThanksAt, undefined);
  assert.ok(members[fresh.id].lastThanksAt, 'a boost from a minute ago is thanked');
  assert.equal(eventsSent.length, 1);
  assert.equal(sent.length, 2);
  assert.doesNotMatch(description(sent.find((message) => message.content === old.toString())), /boosted/);

  guild.members.cache.delete(old.id);
  const gone = new Error('Unknown Member');
  gone.code = 10007;
  guild.members.fetch = async (id) => { if (id) throw gone; return guild.members.cache; };
  await tickServerBoost(guild, NOW + 3_600_000 * 2);
  assert.equal((await getBoostData(guild.id)).members[old.id].active, false);
  assert.equal((await getEconomyData(client, guild.id, old.id)).serverBooster, false);
});

test('a failed member lookup does not end a boost', async () => {
  const { guild } = await setup('Awaria');
  const member = booster(guild);
  await processBooster(guild, member, { now: NOW });
  guild.members.cache.delete(member.id);
  guild.members.fetch = async (id) => { if (id) throw new Error('Gateway timeout'); return guild.members.cache; };
  await tickServerBoost(guild, NOW + 3_600_000);
  assert.equal((await getBoostData(guild.id)).members[member.id].active, true);
});

test('the badges and the statistics see the reward', async () => {
  const { guild } = await setup('Odznaki');
  const member = booster(guild);
  progressOptions.enabled = true;
  try {
    await processBooster(guild, member, { boosted: true, now: NOW });
    const userData = await getEconomyData(client, guild.id, member.id);
    assert.equal(userData.stats.boostRewards, 1);
    assert.ok(userData.achievements.server_booster);
    assert.ok(!userData.achievements.loyal_booster);
  } finally {
    progressOptions.enabled = false;
  }
  await flushEconomyStats(guild.id, NOW);
  const stats = await economyStatsView(client, guild.id, NOW);
  assert.ok(stats.sources7.some((source) => source.id === 'job:server_boost' && source.in >= 50_000), 'source of the money in the statistics');
});

// ---------- own role ----------

test('own role: made right above the booster role, with no permissions; changed, not made again', async () => {
  const { guild } = await setup('Rola');
  const { anchor, created } = withRoles(guild);
  const member = booster(guild);

  const role = await setBoosterRole({ guild, member, name: '  Król   Klubu ', color: 'ff66cc', now: NOW });
  assert.equal(role.name, 'Król Klubu');
  assert.equal(role.position, anchor.position + 1);
  assert.deepEqual(role.options.permissions, []);
  assert.equal(role.options.mentionable, false);
  assert.equal(role.options.hoist, false);
  assert.equal(role.options.colors.primaryColor, 0xff66cc);
  assert.ok(member.roles.cache.has(role.id));

  await assert.rejects(() => setBoosterRole({ guild, member, name: 'Inna', color: '#000000', now: NOW + 1000 }), /again/);
  const edited = await setBoosterRole({ guild, member, name: 'Inna', color: '#000000', now: NOW + ROLE_CHANGE_GAP_MS + 1 });
  assert.equal(edited.id, role.id);
  assert.equal(edited.name, 'Inna');
  assert.equal(edited.colors.primaryColor, 1, 'colour 0 would mean no colour');
  assert.equal(created.length, 1);

  assert.equal(await removeBoosterRole(guild, member.id), true);
  assert.equal(role.deleted, true);
  assert.equal(await removeBoosterRole(guild, member.id), false);
});

test('own role: bad requests are refused', async () => {
  const { guild } = await setup('Zle role');
  const { created } = withRoles(guild);
  mockRole(guild, 'Zajeta');
  const member = booster(guild);
  await updateAutomodWords(guild.id, ['brzydkie']);

  for (const name of ['x', 'y'.repeat(33), 'Administrator', 'Moderacja', 'Mod', 'Właściciel', '@everyone', 'https://x.pl', 'zajeta', 'brzydkie słowo', 'n1gger']) {
    await assert.rejects(() => setBoosterRole({ guild, member, name, color: '#ff66cc', now: NOW }), { message: /./ }, name);
  }
  await assert.rejects(() => setBoosterRole({ guild, member, name: 'Dobra', color: 'czerwony', now: NOW }), /hex/);
  assert.equal(created.length, 0);

  const notBoosting = mockMember(guild, mockUser('nie'));
  await assert.rejects(() => setBoosterRole({ guild, member: notBoosting, name: 'Dobra', color: '#ff66cc', now: NOW }), /boost/);

  await updateEconomySettings(guild.id, (data) => { data.serverBoost.customRole = false; });
  await assert.rejects(() => setBoosterRole({ guild, member, name: 'Dobra', color: '#ff66cc', now: NOW }), /turned off/);
});

async function updateAutomodWords(guildId, list) {
  const { updateAutomodConfig } = await import('../src/services/automodService.js');
  await updateAutomodConfig(guildId, (config) => { config.rules.words.list = list; });
}

test('own role: a bot below the booster role cannot make one, a failed move leaves no role behind', async () => {
  const { guild } = await setup('Pozycja');
  const { created } = withRoles(guild, { anchorPosition: 25, botPosition: 20 });
  const member = booster(guild);
  assert.match(roleProblem(guild), /Server Booster/);
  await assert.rejects(() => setBoosterRole({ guild, member, name: 'Dobra', color: '#ff66cc', now: NOW }), /above/);
  assert.equal(created.length, 0);

  guild.members.me.roles.highest = { position: 30 };
  assert.equal(roleProblem(guild), null);
  const create = guild.roles.create;
  let orphan;
  guild.roles.create = async (options) => {
    orphan = await create(options);
    orphan.setPosition = async () => { throw new Error('Missing Permissions'); };
    return orphan;
  };
  await assert.rejects(() => setBoosterRole({ guild, member, name: 'Dobra', color: '#ff66cc', now: NOW }), /above/);
  assert.equal(orphan.deleted, true);
  assert.equal((await getBoostData(guild.id)).members[member.id].roleId, undefined);

  guild.members.me.permissions = new PermissionsBitField([PermissionFlagsBits.ViewChannel]);
  assert.match(roleProblem(guild), /Manage Roles/);
});

test('the end of a boost removes the own role', async () => {
  const { guild } = await setup('Koniec');
  withRoles(guild);
  const member = booster(guild);
  const role = await setBoosterRole({ guild, member, name: 'Moja', color: '#ff66cc', now: NOW });
  member.premiumSinceTimestamp = null;
  await processBooster(guild, member, { now: NOW + 1000 });
  assert.equal(role.deleted, true);
  assert.equal((await getBoostData(guild.id)).members[member.id].roleId, null);
});

// ---------- /booster ----------

test('/booster info shows the perks to someone who does not boost, and the status to a booster', async () => {
  const { default: command } = await import('../src/commands/Economy/booster.js');
  const { guild, channel } = await setup('Komenda');
  const plain = mockMember(guild, mockUser('zwykly'));
  const asked = mockInteraction({ client, guild, channel, member: plain, commandName: 'booster', subcommand: 'info' });
  await command.execute(asked, {}, client);
  const text = replyText(asked);
  assert.match(text, /do not boost/);
  assert.match(text, /\$50,000/);
  assert.match(text, /\+25%/);
  assert.match(text, /\/booster rola/);

  const member = booster(guild, 'fan', Date.now());
  await processBooster(guild, member, {});
  const askedBooster = mockInteraction({ client, guild, channel, member, commandName: 'booster', subcommand: 'info' });
  await command.execute(askedBooster, {}, client);
  assert.match(replyText(askedBooster), /You boost this server since/);
  assert.match(replyText(askedBooster), /Next reward/);
});

test('/booster rola and usun-role answer the member', async () => {
  const { default: command } = await import('../src/commands/Economy/booster.js');
  const { guild, channel } = await setup('Komenda rola');
  withRoles(guild);
  const member = booster(guild, 'mala', Date.now());
  const made = mockInteraction({ client, guild, channel, member, commandName: 'booster', subcommand: 'rola', options: { nazwa: 'Mała', kolor: '#123456' } });
  await command.execute(made, {}, client);
  assert.match(replyText(made), /ready/);
  const removed = mockInteraction({ client, guild, channel, member, commandName: 'booster', subcommand: 'usun-role' });
  await command.execute(removed, {}, client);
  assert.match(replyText(removed), /gone/);
  const again = mockInteraction({ client, guild, channel, member, commandName: 'booster', subcommand: 'usun-role' });
  await assert.rejects(() => command.execute(again, {}, client));
});

test('Polish texts are there', () => runWithLocale('pl', () => {
  assert.equal(t('💎 {user} boosted {server}! Thank you!'), '💎 {user} boostuje {server}! Dzięki!');
  const count = 5;
  assert.equal(t`-# The server has ${count} {0|boost|boosts}, level ${1}.`, '-# Serwer ma 5 boostów, poziom 1.');
  assert.match(earningsLine({ serverBoost: { moneyPercent: 25 }, earningsPercent: 100 }, { serverBooster: true }), /Booster serwera/);
}));

// ---------- panel ----------

test('panel: the module shows the settings and the boosters, saves, refuses bad values, takes a role away', async () => {
  const { guild, channel } = await setup('Panel');
  withRoles(guild);
  const member = booster(guild, 'zosia', NOW);
  await setBoosterRole({ guild, member, name: 'Zosia', color: '#ff66cc', now: NOW });

  const read = await call('GET', `/guilds/${guild.id}`);
  assert.equal(read.status, 200);
  const view = read.json.modules.serverboost;
  assert.equal(view.enabled, true);
  assert.equal(view.channelId, channel.id);
  assert.equal(view.cashReward, 50_000);
  assert.equal(view.pack, 'legend');
  assert.equal(view.packs.length, 3);
  assert.equal(view.count, 3);
  assert.equal(view.roleProblem, null);
  assert.equal(view.boosters.length, 1);
  assert.equal(view.boosters[0].userId, member.id);
  assert.equal(view.boosters[0].roleName, 'Zosia');

  const patched = await call('PATCH', `/guilds/${guild.id}/serverboost`, {
    enabled: false, channelId: null, message: 'Dzięki {user}', cashReward: 100, pack: null, moneyPercent: 10, xpPercent: 0, eventMinutes: 0, customRole: false,
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.enabled, false);
  assert.equal(patched.json.channelId, null);
  assert.equal(patched.json.message, 'Dzięki {user}');
  assert.equal(patched.json.pack, null);
  assert.equal(patched.json.customRole, false);
  assert.equal((await getEconomySettings(guild.id)).serverBoost.cashReward, 100);

  for (const body of [{ cashReward: -1 }, { pack: 'zla' }, { moneyPercent: 201 }, { eventMinutes: 3 }, { message: 'x'.repeat(501) }, { channelId: '1' }, { enabled: 'tak' }, { removeRole: 'x' }]) {
    assert.equal((await call('PATCH', `/guilds/${guild.id}/serverboost`, body)).status, 400, JSON.stringify(body));
  }

  const withoutRole = await call('PATCH', `/guilds/${guild.id}/serverboost`, { removeRole: member.id });
  assert.equal(withoutRole.status, 200);
  assert.equal(withoutRole.json.boosters[0].roleName, null);
});

test('saved money data keeps the flag', async () => {
  const { guild } = await setup('Flaga');
  const member = booster(guild);
  await processBooster(guild, member, { now: NOW });
  const userData = await getEconomyData(client, guild.id, member.id);
  await setEconomyData(client, guild.id, member.id, userData);
  assert.equal((await getEconomyData(client, guild.id, member.id)).serverBooster, true);
});

// ---------- the info message for the boosts channel ----------

/** A channel that records edits and deletions of its messages; `gone` makes every edit fail like a deleted message. */
function infoChannel(guild, name) {
  const channel = mockChannel(guild, name);
  channel.edits = [];
  channel.deleted = [];
  channel.messages = {
    edit: async (id, payload) => {
      if (channel.gone) throw Object.assign(new Error('Unknown Message'), { code: 10008 });
      channel.edits.push({ id, payload });
      return { id };
    },
    delete: async (id) => { channel.deleted.push(id); },
  };
  return channel;
}

test('panel: the info message is posted, kept up to date, moved and forgotten when deleted', async () => {
  // The panel answers in the server's language (Polish by default).
  const { guild } = await setup('Opis');
  const first = infoChannel(guild, 'boosty-info');
  const second = infoChannel(guild, 'inne');

  for (const body of [{ postInfo: null }, { postInfo: '1' }, { postInfo: 'abc' }]) {
    assert.equal((await call('PATCH', `/guilds/${guild.id}/serverboost`, body)).status, 400, JSON.stringify(body));
  }
  assert.equal(first.sent.length, 0);

  const posted = await call('PATCH', `/guilds/${guild.id}/serverboost`, { postInfo: first.id });
  assert.equal(posted.status, 200);
  assert.equal(posted.json.infoChannelId, first.id);
  assert.equal(first.sent.length, 1);
  const message = first.sent[0];
  assert.equal(message.embeds[0].data.title, '💎 Co daje boost serwera?');
  assert.match(description(message), /Zboostuj \*\*Opis\*\*, a dostaniesz/);
  assert.match(description(message), /\$50,000/);
  assert.match(description(message), /\+25%/);
  assert.match(description(message), /Jak zboostować/);
  assert.equal(message.components[0].components[0].data.custom_id, 'booster:status');
  assert.deepEqual(message.allowedMentions, { parse: [] });

  // A save edits the posted message with the new numbers, no new message.
  await call('PATCH', `/guilds/${guild.id}/serverboost`, { cashReward: 1000 });
  assert.equal(first.sent.length, 1);
  assert.equal(first.edits.length, 1);
  assert.equal(first.edits[0].id, message.id);
  assert.match(description(first.edits[0].payload), /1,000.* od razu/);

  // Sending again to the same channel edits too; to another channel the old message goes.
  await call('PATCH', `/guilds/${guild.id}/serverboost`, { postInfo: first.id });
  assert.equal(first.sent.length, 1);
  assert.equal(first.edits.length, 2);
  const moved = await call('PATCH', `/guilds/${guild.id}/serverboost`, { postInfo: second.id });
  assert.equal(moved.json.infoChannelId, second.id);
  assert.deepEqual(first.deleted, [message.id]);
  assert.equal(second.sent.length, 1);

  // Rewards off: the message says so.
  await call('PATCH', `/guilds/${guild.id}/serverboost`, { enabled: false });
  assert.match(description(second.edits.at(-1).payload), /wyłączone/);

  // Someone deleted the message: the save works and the panel shows it is gone.
  second.gone = true;
  const afterDelete = await call('PATCH', `/guilds/${guild.id}/serverboost`, { enabled: true });
  assert.equal(afterDelete.status, 200);
  assert.equal(afterDelete.json.infoChannelId, null);
  assert.equal((await getBoostData(guild.id)).info, null);

  // A channel the bot cannot write on is refused with a reason.
  const closed = infoChannel(guild, 'zamkniety');
  closed.send = async () => { throw new Error('Missing Permissions'); };
  const refused = await call('PATCH', `/guilds/${guild.id}/serverboost`, { postInfo: closed.id });
  assert.equal(refused.status, 400);
  assert.match(refused.json.error, /nie może pisać na #zamkniety/);
});

test('the "My boost" button answers privately with the member\'s status', async () => {
  const { default: button } = await import('../src/interactions/buttons/economy/booster.js');
  const { guild, channel } = await setup('Przycisk');
  const plain = mockMember(guild, mockUser('ciekawski'));
  const pressed = mockInteraction({ client, guild, channel, member: plain, customId: 'booster:status' });
  await button.execute(pressed, client, ['status']);
  assert.match(replyText(pressed), /do not boost/);
  assert.match(replyText(pressed), /\$50,000/);
});

test('the info message in Polish', () => runWithLocale('pl', async () => {
  const { boostInfoMessage } = await import('../src/services/serverBoost.js');
  const { guild } = await setup('Po polsku');
  const message = boostInfoMessage(guild, await getEconomySettings(guild.id));
  assert.equal(message.embeds[0].data.title, '💎 Co daje boost serwera?');
  assert.match(description(message), /Zboostuj \*\*Po polsku\*\*, a dostaniesz:/);
  assert.match(description(message), /Jak zboostować/);
  assert.equal(message.components[0].components[0].data.label, 'Mój boost');
}));
