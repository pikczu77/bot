// Timed economy events (2026-10-26): announced on their own channel, the announcement deleted at
// the end, effects on payouts, luck and pack prices, automatic events.
import './helpers/env.js';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { mockChannel, mockGuild, mockInteraction, mockMember, mockRole, mockUser, replyText } from './helpers/mock.js';
import { runWithLocale } from '../src/i18n/index.js';
import { initializeDatabase } from '../src/utils/database.js';
import { loadCommands } from '../src/handlers/loaders/commandLoader.js';
import { getEconomyData, setEconomyData } from '../src/utils/economy.js';
import { getEconomySettings, scaleEarnings, updateEconomySettings } from '../src/services/economySettings.js';
import { EVENT_LUCK, endEvent, eventPackPrice, eventPayFactor, startEvent, tickEconomyEvents } from '../src/services/economyEvents.js';
import { takeLuck } from '../src/services/casino.js';
import { rollFish } from '../src/services/collections.js';

const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null } };
let guild;
let channel;
let news;

before(async () => {
  const { db } = await initializeDatabase();
  client.db = db;
  await loadCommands(client);
  guild = mockGuild(client, 'Eventy');
  channel = mockChannel(guild, 'ekonomia');
  news = mockChannel(guild, 'eventy');
  await updateEconomySettings(guild.id, (settings) => {
    settings.currency = { symbol: '$', position: 'left', separator: ',' };
    settings.commands.fish = { min: 100, max: 100, cooldownMinutes: 60 };
  });
});

const admin = () => mockMember(guild, mockUser('Szef'), { permissions: ['Administrator', 'ManageGuild'] });

async function economy(member, group, sub, options = {}) {
  const interaction = mockInteraction({ client, guild, channel, member, commandName: 'economy', options, subcommand: sub, group });
  await runWithLocale('en', () => client.commands.get('economy').execute(interaction, {}, client));
  return interaction.replies.at(-1);
}

test('/economy event ustaw + start: the announcement goes to its channel with a ping, stop deletes it', async () => {
  const role = mockRole(guild, 'Eventy');
  const boss = admin();
  const saved = await economy(boss, 'event', 'ustaw', { kanal: news, rola: role });
  assert.match(replyText({ replies: [saved] }), /Saved/);
  assert.match(replyText({ replies: [saved] }), /No event is running/);

  const started = await economy(boss, 'event', 'start', { typ: 'kasa', minuty: 30 });
  assert.match(replyText({ replies: [started] }), /Running: \*\*💸 Double money\*\*/);
  assert.equal(news.sent.length, 1);
  assert.equal(news.sent[0].content, `<@&${role.id}>`);
  assert.match(news.sent[0].embeds[0].toJSON().title, /EVENT: Double money/);
  const active = (await getEconomySettings(guild.id)).events.active;
  assert.equal(active.type, 'kasa');
  assert.equal(active.messageId, news.sent[0].id);

  const deleted = [];
  news.messages.delete = async (id) => { deleted.push(id); };
  const stopped = await economy(boss, 'event', 'stop');
  assert.match(replyText({ replies: [stopped] }), /ended/);
  assert.deepEqual(deleted, [active.messageId]);
  assert.equal((await getEconomySettings(guild.id)).events.active, null);
});

test('effects: double money for payouts only, fish, videos, luck above the cap, half-price packs', async () => {
  const now = Date.now();
  await startEvent(guild, 'kasa', 60, { now });
  let settings = await getEconomySettings(guild.id);
  assert.equal(scaleEarnings(settings, 100, { wallet: 0 }), 200, 'a payout to a member doubles');
  assert.equal(scaleEarnings(settings, 100), 100, 'prices and rewards do not');

  await startEvent(guild, 'ryby', 60, { now });
  settings = await getEconomySettings(guild.id);
  assert.equal(scaleEarnings(settings, 100, { wallet: 0 }), 100, 'only one event at a time');
  assert.equal(eventPayFactor(settings, 'fish', now), 2);
  assert.equal(eventPayFactor(settings, 'mine', now), 1);
  // A roll that is normally "normal" (0.94 + 0.03) becomes golden with the 3x boost.
  const rolls = [0, 0, 0.955];
  assert.equal(rollFish(() => rolls.shift() ?? 0, 3).variant.id, 'golden');

  await startEvent(guild, 'szczescie', 60, { now });
  settings = await getEconomySettings(guild.id);
  const luck = takeLuck({ upgrades: { luck: 15 }, inventory: { diamond_clover: 1, lucky_clover: 1 } }, EVENT_LUCK);
  assert.equal(luck.total, 20 + EVENT_LUCK, 'the event goes above the cap of 20');

  await startEvent(guild, 'paczki', 60, { now });
  settings = await getEconomySettings(guild.id);
  assert.equal(eventPackPrice(settings, 1500, now), 750);
  const buyer = mockMember(guild, mockUser('Kolekcjoner'));
  await setEconomyData(client, guild.id, buyer.id, { ...(await getEconomyData(client, guild.id, buyer.id)), wallet: 750 });
  const interaction = mockInteraction({ client, guild, channel, member: buyer, commandName: 'paczka', options: { rodzaj: 'startowa' } });
  await runWithLocale('en', () => client.commands.get('paczka').execute(interaction, {}, client));
  assert.match(replyText(interaction), /Event: Pack sale/);
  assert.equal((await getEconomyData(client, guild.id, buyer.id)).wallet, 0, 'paid half');
  await endEvent(guild);
});

test('/fish during "ryby" pays double and says so', async () => {
  await startEvent(guild, 'ryby', 60);
  const angler = mockMember(guild, mockUser('Rybak'));
  await setEconomyData(client, guild.id, angler.id, { ...(await getEconomyData(client, guild.id, angler.id)), wallet: 0, inventory: { fishing_rod: 1 } });
  const interaction = mockInteraction({ client, guild, channel, member: angler, commandName: 'fish' });
  await runWithLocale('en', () => client.commands.get('fish').execute(interaction, {}, client));
  assert.match(replyText(interaction), /Event: Fishing frenzy/);
  await endEvent(guild);
});

test('every minute: an event that is over ends; automatic events start on time', async () => {
  const now = Date.UTC(2026, 9, 26, 12, 0);
  const deleted = [];
  news.messages.delete = async (id) => { deleted.push(id); };
  await startEvent(guild, 'youtube', 10, { now });
  await tickEconomyEvents(guild, now + 9 * 60_000);
  assert.equal((await getEconomySettings(guild.id)).events.active.type, 'youtube');
  await tickEconomyEvents(guild, now + 10 * 60_000);
  assert.equal((await getEconomySettings(guild.id)).events.active, null);
  assert.equal(deleted.length, 1, 'the announcement is deleted at the end');

  await updateEconomySettings(guild.id, (settings) => {
    Object.assign(settings.events, { auto: true, everyHours: 2, durationMinutes: 15, nextAutoAt: now + 60 * 60_000 });
  });
  await tickEconomyEvents(guild, now + 30 * 60_000, () => 0);
  assert.equal((await getEconomySettings(guild.id)).events.active, null, 'not yet');
  const before = news.sent.length;
  await tickEconomyEvents(guild, now + 61 * 60_000, () => 0);
  const settings = await getEconomySettings(guild.id);
  assert.equal(settings.events.active.type, 'kasa', 'random() = 0 picks the first type');
  assert.equal(settings.events.active.endsAt, now + 76 * 60_000);
  assert.equal(news.sent.length, before + 1);
  assert.ok(settings.events.nextAutoAt >= now + 61 * 60_000 + 1.5 * 3_600_000, 'next one about 2 h later');
  await tickEconomyEvents(guild, now + 76 * 60_000);
  assert.equal((await getEconomySettings(guild.id)).events.active, null);
});
