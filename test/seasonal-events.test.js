// Holiday events, second round (2026-10-29): New Year's Eve, Valentine's Day, Children's Day, summer holidays, one /event
// command, and the owner's "czatowe gierki ... za cukierki, tam 50 cukierkow", "do kazdej pracy dolicz po 5-10".
import './helpers/env.js';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { mockChannel, mockGuild, mockInteraction, mockMember, mockRole, mockUser, replyText } from './helpers/mock.js';
import { runWithLocale } from '../src/i18n/index.js';
import { initializeDatabase } from '../src/utils/database.js';
import { loadCommands } from '../src/handlers/loaders/commandLoader.js';
import { getEconomyData, setEconomyData } from '../src/utils/economy.js';
import { updateEconomySettings } from '../src/services/economySettings.js';
import { guildStore } from '../src/utils/featureKit.js';
import { midnightOf } from '../src/utils/warsawTime.js';
import { marry } from '../src/services/marriageService.js';
import { getDatePlace } from '../src/services/marriageService.js';
import {
  QUESTION_FACTOR, SEASONAL_EVENTS, SEASON_REV, addSeasonReward, amountOf, buySeasonItem, claimSeasonDaily, easterSunday, eventOf, fillAnnouncement, getSeason,
  getSeasonEvent, nextSeason, noteSeasonGifts, openSeason, repostAnnouncement, seasonDefaults, seasonShop, tickSeason, updateSeason,
} from '../src/services/seasonalEvents.js';
import { runWork } from '../src/commands/Economy/modules/work_shift.js';
import { settleDate } from '../src/commands/Fun/modules/relationships.js';
import { userError } from '../src/utils/featureKit.js';

const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null } };
let guild;
let channel;
const HALLOWEEN = getSeasonEvent('halloween');
const VALENTINE = getSeasonEvent('walentynki');
const DURING = Date.UTC(2026, 9, 30, 12);
const VALENTINES_DAY = Date.UTC(2027, 1, 14, 12);

before(async () => {
  const { db } = await initializeDatabase();
  client.db = db;
  await loadCommands(client);
  guild = mockGuild(client, 'Eventy');
  guild.roles.create = async ({ name }) => mockRole(guild, name);
  channel = mockChannel(guild, 'chat');
  await updateEconomySettings(guild.id, (settings) => {
    settings.currency = { symbol: '$', position: 'left', separator: ',' };
  });
});

const newMember = (name) => mockMember(guild, mockUser(name));
const data = (member) => getEconomyData(client, guild.id, member.id);
const save = async (member, patch) => setEconomyData(client, guild.id, member.id, { ...(await data(member)), ...patch });

async function run(member, subcommand, options = {}) {
  const interaction = mockInteraction({ client, guild, channel, member, commandName: 'event', subcommand, options });
  try {
    await runWithLocale('en', () => client.commands.get('event').execute(interaction, {}, client));
  } catch (error) {
    if (!error.userMessage) throw error;
    return error.userMessage;
  }
  return replyText(interaction);
}

/** Halloween runs right now on the test server (jobs and commands read the real clock). */
const runHalloweenNow = () => updateSeason(HALLOWEEN, guild.id, (settings) => {
  settings.startsAt = Date.now() - 60_000;
  settings.endsAt = Date.now() + 86_400_000;
});

test('seven events in a row without overlapping days; each has its own rank, the summer rank costs more', () => {
  assert.deepEqual(SEASONAL_EVENTS.map((event) => event.id), ['halloween', 'swieta', 'sylwester', 'walentynki', 'wielkanoc', 'dzien_dziecka', 'wakacje']);
  const ranges = SEASONAL_EVENTS.map((event) => seasonDefaults(event)).sort((a, b) => a.startsAt - b.startsAt);
  for (let i = 1; i < ranges.length; i += 1) assert.ok(ranges[i].startsAt >= ranges[i - 1].endsAt, 'no two events at once');
  assert.equal(seasonShop(getSeasonEvent('wakacje')).at(-1).price, 10_000);
  assert.equal(seasonShop(HALLOWEEN).at(-1).price, 3_000);
  assert.equal(new Set(SEASONAL_EVENTS.map((event) => event.roleName)).size, SEASONAL_EVENTS.length);
  for (const event of SEASONAL_EVENTS) {
    const text = runWithLocale('en', () => event.texts.text());
    assert.ok(!text.includes('\n\n\n') && !text.includes('\n\n**\n'), event.id);
    assert.match(text, /\/event zbierz` = \*\*\+\{dziennie\} \S+\*\*.*\n💼 Every job/, `${event.id}: jobs right under the daily line`);
    assert.match(text, /\{praca\}/, `${event.id}: the jobs line`);
    assert.match(text, /\{gry\}/, `${event.id}: the chat games line`);
    assert.match(text, /\/event sklep/, event.id);
  }
});

test('jobs give 5-10, chat games 50, the question of the day twice that; nothing outside an event', async () => {
  const userData = {};
  const low = await addSeasonReward(guild.id, userData, 'job', { now: DURING, random: () => 0 });
  const high = await addSeasonReward(guild.id, userData, 'job', { now: DURING, random: () => 0.999 });
  assert.deepEqual([low[0].event.id, low[0].amount, high[0].amount], ['halloween', 5, 10]);
  assert.equal((await addSeasonReward(guild.id, userData, 'game', { now: DURING }))[0].amount, 50);
  assert.equal((await addSeasonReward(guild.id, userData, 'question', { now: DURING }))[0].amount, 50 * QUESTION_FACTOR);
  assert.deepEqual(amountOf(HALLOWEEN, userData), { amount: 165, earned: 165 });
  assert.deepEqual(await addSeasonReward(guild.id, userData, 'job', { now: Date.UTC(2027, 3, 20) }), [], 'no event in April');

  const member = newMember('Ranking');
  await noteSeasonGifts(guild.id, member.id, low);
  assert.equal((await getSeason(HALLOWEEN, guild.id)).totals[member.id], 5);
});

test('/work during Halloween: the shift shows the candies and they land in the member data', async () => {
  await runHalloweenNow();
  const worker = newMember('Robol');
  await save(worker, { job: { id: 'flyers', shiftsLeft: 5 }, lastWork: 0 });
  const view = await runWithLocale('en', () => runWork({ client, guildId: guild.id, user: worker.user }));
  const description = view.embeds[0].toJSON().description;
  const candies = amountOf(HALLOWEEN, await data(worker)).amount;
  assert.ok(candies >= 5 && candies <= 10, `got ${candies}`);
  assert.match(description, new RegExp(`🎃 \\*\\*\\+${candies} 🍬\\*\\*`));
  assert.equal((await getSeason(HALLOWEEN, guild.id)).totals[worker.id], candies);
});

test('/event: zbierz once a day, sklep shows how to collect, kup, ranking, lista', async () => {
  await runHalloweenNow();
  const fan = newMember('Fan');
  assert.match(await run(fan, 'zbierz'), /You collected \*\*\+50 🍬\*\*/);
  assert.match(await run(fan, 'zbierz'), /already collected today/);
  const shop = await run(fan, 'sklep');
  assert.match(shop, /Halloween shop/);
  assert.match(shop, /Every job .*\*\*5-10 🍬\*\*/);
  assert.match(shop, /quiz, Wordle: \*\*50 🍬\*\*/);
  assert.match(shop, /question of the day: \*\*100 🍬\*\*/);
  await save(fan, { halloween: { ...(await data(fan)).halloween, candies: 500 } });
  assert.match(await run(fan, 'kup', { przedmiot: 'xp1' }), /You bought ⭐ \*\*Double XP for 1 h\*\*/);
  assert.match(await run(fan, 'ranking'), /Candy ranking/);
  const list = await run(fan, 'lista');
  for (const event of SEASONAL_EVENTS) assert.ok(list.includes(`${event.emoji} **`), event.id);
  assert.match(list, /🟢 now/);
  assert.match(await run(fan, 'sklep', { event: 'wakacje' }), /Summer shop/);
});

test("Valentine's Day: an accepted date gives both 30 love letters, x2 married; married members get double from zbierz", async () => {
  const romeo = newMember('Romeo');
  const julia = newMember('Julia');
  const first = await settleDate(client, guild.id, romeo.id, julia.id, getDatePlace('spacer'), { now: VALENTINES_DAY, random: () => 0.5 });
  assert.equal(first.ok, true);
  assert.deepEqual(first.seasonal.map(({ event, amount }) => [event.id, amount]), [['walentynki', 30]]);
  assert.equal(amountOf(VALENTINE, await data(romeo)).amount, 30);
  assert.equal(amountOf(VALENTINE, await data(julia)).amount, 30);

  await marry(guild.id, romeo.id, julia.id, VALENTINES_DAY);
  const married = await settleDate(client, guild.id, romeo.id, julia.id, getDatePlace('spacer'), { now: VALENTINES_DAY + 3 * 3_600_000, random: () => 0.5 });
  assert.equal(married.seasonal[0].amount, 60);
  const daily = await claimSeasonDaily({ event: VALENTINE, client, guildId: guild.id, userId: romeo.id, userError, now: VALENTINES_DAY });
  assert.deepEqual([daily.amount, daily.married], [100, true]);
  const single = newMember('Samotny');
  assert.equal((await claimSeasonDaily({ event: VALENTINE, client, guildId: guild.id, userId: single.id, userError, now: VALENTINES_DAY })).amount, 50);
  assert.equal(fillAnnouncement(VALENTINE, '{randka} {praca} {gry}', await getSeason(VALENTINE, guild.id)), '30 5-10 50');
  // No date reward outside the event.
  const outside = await settleDate(client, guild.id, newMember('A').id, newMember('B').id, getDatePlace('spacer'), { now: DURING, random: () => 0.5 });
  assert.deepEqual(outside.seasonal, []);
});

test('the open event: a running one before the extra shop day of the one before; the next one', async () => {
  const room = mockGuild(client, 'Sylwester');
  const dec30 = Date.UTC(2026, 11, 30, 12);
  assert.equal((await openSeason(room.id, dec30)).event.id, 'sylwester', "Christmas' shop day is the first day of New Year's Eve");
  assert.equal((await openSeason(room.id, Date.UTC(2026, 11, 29, 12))).event.id, 'swieta');
  assert.equal((await nextSeason(room.id, Date.UTC(2027, 3, 1))).event.id, 'dzien_dziecka');
  const member = mockMember(room, mockUser('Kupiec'));
  await setEconomyData(client, room.id, member.id, { ...(await getEconomyData(client, room.id, member.id)), swieta: { year: 2026, candies: 500, earned: 500 } });
  const bought = await buySeasonItem({ event: getSeasonEvent('swieta'), client, guild: room, member, itemId: 'xp1', userError, now: dec30 });
  assert.equal(bought.amount, 400, 'the Christmas shop still sells on its extra day');
});

test('years: each event has days for any year (Easter by the computus), the panel moves an event to another year', async () => {
  assert.deepEqual(['2026', '2027', '2028', '2030'].map((year) => easterSunday(Number(year))), ['2026-04-05', '2027-03-28', '2028-04-16', '2030-04-21']);
  const easter2028 = eventOf(getSeasonEvent('wielkanoc'), { year: 2028 });
  assert.deepEqual([easter2028.firstDay, easter2028.lastDay, easter2028.roleName], ['2028-04-13', '2028-04-17', 'Wielkanoc 2028']);
  assert.equal(runWithLocale('en', () => easter2028.texts.name()), 'Easter 2028');
  assert.equal(eventOf(getSeasonEvent('wakacje'), { year: 2028 }).firstDay, '2028-06-24', 'schools close on Friday 23 June 2028');
  assert.equal(eventOf(getSeasonEvent('sylwester'), { year: 2027 }).lastDay, '2028-01-02');
  assert.equal(eventOf(HALLOWEEN, {}), HALLOWEEN, 'no year = the default one');

  process.env.PANEL_API_KEY = 'test-panel-key-0123456789abcdef';
  const express = (await import('express')).default;
  const { createPanelRouter } = await import('../src/api/panelApi.js');
  const app = express();
  app.use('/api/v1', createPanelRouter(client));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const room = mockGuild(client, 'Rok');
  client.guilds.cache.set(room.id, room);
  const news = mockChannel(room, 'eventy');
  const deleted = [];
  news.messages.delete = async (id) => { deleted.push(id); };
  const patch = async (body) => {
    const response = await fetch(`${base}/guilds/${room.id}/economy`, { method: 'PATCH', headers: { Authorization: `Bearer ${process.env.PANEL_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, text, json: JSON.parse(text) };
  };
  const halloween = (json) => json.seasonal.find((entry) => entry.id === 'halloween');
  try {
    const member = mockMember(room, mockUser('Zbieracz'));
    await setEconomyData(client, room.id, member.id, { ...(await getEconomyData(client, room.id, member.id)), halloween: { year: 2026, candies: 900, earned: 900 } });
    await updateSeason(HALLOWEEN, room.id, (settings) => { settings.totals = { [member.id]: 900 }; settings.announcement = { channelId: news.id, messageId: '555' }; });

    assert.equal((await patch({ seasonal: { halloween: { year: 2025 } } })).status, 400, 'not before the first year');
    assert.equal((await patch({ seasonal: { halloween: { year: 2027, lastDay: '2026-11-02' } } })).status, 400, 'days of the old year');
    const pingRole = mockRole(room, 'dodatkowy ping');
    assert.equal(halloween((await patch({ seasonal: { halloween: { pingRoleId: pingRole.id } } })).json).pingRoleId, pingRole.id);
    assert.equal((await patch({ seasonal: { halloween: { pingRoleId: room.id } } })).status, 400, 'not @everyone');
    const moved = await patch({ seasonal: { halloween: { year: 2027 } } });
    assert.equal(moved.status, 200, moved.text);
    const view = halloween(moved.json);
    assert.deepEqual([view.year, view.firstDay, view.lastDay, view.roleName, view.collected, view.posted], [2027, '2027-10-29', '2027-11-02', 'Halloween 2027', 0, false]);
    assert.deepEqual(view.years.slice(0, 2), [2026, 2027]);
    assert.deepEqual(deleted, ['555'], 'the announcement of 2026 is deleted');

    const settings = await getSeason(HALLOWEEN, room.id);
    const event = eventOf(HALLOWEEN, settings);
    assert.deepEqual(amountOf(event, await getEconomyData(client, room.id, member.id)), { amount: 0, earned: 0 }, 'a new year starts from zero');
    const gifts = await addSeasonReward(room.id, {}, 'game', { now: Date.UTC(2027, 9, 30, 12) });
    assert.equal(gifts[0].event.roleName, 'Halloween 2027');
    assert.deepEqual(await addSeasonReward(room.id, {}, 'game', { now: DURING }), [], 'October 2026 is not the event any more');

    const days = await patch({ seasonal: { halloween: { year: 2027, firstDay: '2027-10-25', lastDay: '2027-11-03' } } });
    assert.deepEqual([halloween(days.json).firstDay, halloween(days.json).lastDay], ['2027-10-25', '2027-11-03']);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('the announcement pings the picked role, only that role; without one it pings nobody', async () => {
  const room = mockGuild(client, 'Ping');
  const news = mockChannel(room, 'eventy');
  const role = mockRole(room, 'dodatkowy ping');
  await updateSeason(HALLOWEEN, room.id, (settings) => { settings.channelId = news.id; settings.pingRoleId = role.id; });
  await runWithLocale('en', () => tickSeason(HALLOWEEN, client, room, DURING));
  assert.equal(news.sent[0].content, `<@&${role.id}>`);
  assert.deepEqual(news.sent[0].allowedMentions, { parse: [], roles: [role.id] });
  assert.match(news.sent[0].embeds[0].toJSON().title, /Halloween 2026/);

  await updateSeason(HALLOWEEN, room.id, (settings) => { settings.pingRoleId = null; });
  await runWithLocale('en', () => repostAnnouncement(HALLOWEEN, room, { now: DURING }));
  assert.equal(news.sent[1].content, undefined);
  assert.deepEqual(news.sent[1].allowedMentions, { parse: [], roles: [] });
});

test('settings from before /event: drops 30 become 50, the old Christmas end moves; the posted announcement is edited once', async () => {
  const room = mockGuild(client, 'Stary');
  const news = mockChannel(room, 'ogloszenia');
  const edited = [];
  const posted = { id: '777', edit: async (payload) => { edited.push(payload); return posted; } };
  news.messages.fetch = async (id) => (id === posted.id ? posted : null);
  const raw = (event) => guildStore(event.store, {});
  const christmas = getSeasonEvent('swieta');
  await raw(christmas).set(room.id, { ...seasonDefaults(christmas), dropCandies: 30, endsAt: midnightOf('2027-01-02') });
  const migrated = await getSeason(christmas, room.id);
  assert.equal(migrated.dropCandies, 50);
  assert.equal(migrated.endsAt, midnightOf('2026-12-30'));
  await raw(HALLOWEEN).set(room.id, { ...seasonDefaults(HALLOWEEN), dropCandies: 40, announcement: { channelId: news.id, messageId: posted.id } });
  assert.equal((await getSeason(HALLOWEEN, room.id)).dropCandies, 40, 'an own value stays');

  await runWithLocale('en', () => tickSeason(HALLOWEEN, client, room, DURING));
  assert.equal(edited.length, 1);
  assert.match(edited[0].embeds[0].toJSON().description, /Every job .*\*\*\+5-10 🍬\*\*/);
  assert.match(edited[0].embeds[0].toJSON().description, /\/event zbierz/);
  assert.equal((await getSeason(HALLOWEEN, room.id)).announcement.rev, SEASON_REV);
  await runWithLocale('en', () => tickSeason(HALLOWEEN, client, room, DURING + 60_000));
  assert.equal(edited.length, 1, 'only once');
  assert.equal(news.sent.length, 0, 'not posted again');
});
