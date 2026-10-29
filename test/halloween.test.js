// Halloween 2026, boosts, prestige and card merging (2026-10-29, owner: "zrobmy event halloween ... boosty ... ranga
// Halloween 2026", then "4,3 - 10 prestizy").
import './helpers/env.js';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { mockChannel, mockGuild, mockInteraction, mockMember, mockRole, mockUser, replyText, snowflake } from './helpers/mock.js';
import { runWithLocale } from '../src/i18n/index.js';
import { initializeDatabase } from '../src/utils/database.js';
import { loadCommands } from '../src/handlers/loaders/commandLoader.js';
import { getEconomyData, setEconomyData } from '../src/utils/economy.js';
import { getEconomySettings, scaleEarnings, updateEconomySettings } from '../src/services/economySettings.js';
import { addBoost, xpBoostFactor } from '../src/services/boosts.js';
import {
  ROLE_NAME, buyHalloweenItem, candiesOf, getHalloween, handleHalloweenMessage, tickHalloween, updateHalloween,
} from '../src/services/halloween.js';
import { mergeCards } from '../src/services/cardMerge.js';
import { userError } from '../src/utils/featureKit.js';
import prestigeButtons from '../src/interactions/buttons/economy/prestige.js';

const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null } };
let guild;
let channel;
const DURING = Date.UTC(2026, 9, 30, 12);   // 30 Oct 2026, the event runs
const AFTER = Date.UTC(2026, 10, 3, 12);    // 3 Nov 2026, earning stopped, shop open one more day

before(async () => {
  const { db } = await initializeDatabase();
  client.db = db;
  await loadCommands(client);
  guild = mockGuild(client, 'Halloween');
  guild.roles.create = async ({ name }) => mockRole(guild, name);
  channel = mockChannel(guild, 'eventy');
  await updateEconomySettings(guild.id, (settings) => {
    settings.currency = { symbol: '$', position: 'left', separator: ',' };
    settings.events.channelId = channel.id;
  });
});

const newMember = (name) => mockMember(guild, mockUser(name));
const data = (member) => getEconomyData(client, guild.id, member.id);
const save = async (member, patch) => setEconomyData(client, guild.id, member.id, { ...(await data(member)), ...patch });

async function run(member, commandName, subcommand, options = {}) {
  const interaction = mockInteraction({ client, guild, channel, member, commandName, subcommand, options });
  try {
    await runWithLocale('en', () => client.commands.get(commandName).execute(interaction, {}, client));
  } catch (error) {
    if (!error.userMessage) throw error;
    return { text: error.userMessage, last: null };
  }
  return { text: replyText(interaction), last: interaction.replies.at(-1) };
}

async function press(member, customId) {
  const calls = { reply: [], update: [] };
  const interaction = {
    id: snowflake(), client, guild, guildId: guild.id, channel, channelId: channel.id, member, user: member.user, customId,
    replied: false, deferred: false,
    reply: async (payload) => { calls.reply.push(payload); interaction.replied = true; },
    update: async (payload) => { calls.update.push(payload); },
    followUp: async () => {},
  };
  await runWithLocale('en', () => prestigeButtons.execute(interaction, client, customId.split(':').slice(1)));
  return calls;
}

const message = (member, content, extra = {}) => ({ guild, client, member, author: member.user, channel, content, ...extra });

// ---------------------------------------------------------------- boosts

test('boosts: /boosty buys x2 money, scaleEarnings doubles payouts, more adds time up to 24 h', async () => {
  const anna = newMember('Anna');
  await save(anna, { wallet: 50_000, bank: 0 });
  const bought = await run(anna, 'boosty', 'kup', { boost: 'money', godziny: 3 });
  assert.match(bought.text, /Double money\*\* for 3 h \(\$30,000\)/);
  assert.equal((await data(anna)).wallet, 20_000);
  const settings = await getEconomySettings(guild.id);
  assert.equal(scaleEarnings(settings, 1000, await data(anna)), 2000);
  assert.equal(scaleEarnings(settings, 1000), 1000, 'prices and rewards without the member stay');
  assert.match((await run(anna, 'boosty', 'lista')).text, /on\*\* until/);

  const userData = await data(anna);
  const now = Date.now();
  assert.ok(addBoost(userData, 'xp', 60, now));
  assert.equal(addBoost(userData, 'xp', 24 * 60, now), null, 'not more than 24 h ahead');
  await setEconomyData(client, guild.id, anna.id, userData);
  assert.equal(await xpBoostFactor(client, guild.id, anna.id), 2);
  assert.match((await run(anna, 'boosty', 'kup', { boost: 'xp', godziny: 6 })).text, /does not have|do not have/);
});

// ---------------------------------------------------------------- Halloween

test('Halloween: candies for messages with a break, nothing outside the event', async () => {
  const writer = newMember('Pisarz');
  assert.equal(await handleHalloweenMessage(message(writer, 'hej wszystkim'), DURING), 5);
  assert.equal(await handleHalloweenMessage(message(writer, 'jeszcze raz'), DURING + 10_000), 0, 'within 20 s');
  assert.equal(await handleHalloweenMessage(message(writer, 'a teraz?'), DURING + 21_000), 5);
  assert.equal(await handleHalloweenMessage(message(newMember('Liczby'), '12345'), DURING), 0, 'two letters needed');
  assert.equal(await handleHalloweenMessage(message(newMember('Po'), 'za pozno'), AFTER), 0);
  assert.deepEqual(candiesOf(await data(writer)), { candies: 10, earned: 10 });
  assert.equal((await getHalloween(guild.id)).totals[writer.id], 10);
});

test('Halloween shop: boosts, pack, money and the rank, the role is created and given once', async () => {
  const buyer = newMember('Kupiec');
  await save(buyer, { wallet: 0, halloween: { year: 2026, candies: 4_000, earned: 4_000 } });
  const buy = (itemId, now = DURING) => buyHalloweenItem({ client, guild, member: buyer, itemId, userError, now });

  const boost = await buy('money1');
  assert.equal(boost.candies, 3_850);
  assert.ok((await data(buyer)).boosts.money > DURING);
  await buy('pack');
  assert.ok(Object.values((await data(buyer)).cards ?? {}).reduce((sum, count) => sum + count, 0) >= 2);
  await buy('cash');
  assert.equal((await data(buyer)).wallet, 10_000);

  const rank = await buy('rank', AFTER);
  assert.equal(rank.candies, 4_000 - 150 - 300 - 400 - 3_000);
  const role = [...guild.roles.cache.values()].find((entry) => entry.name === ROLE_NAME);
  assert.ok(role, 'the role was created');
  assert.ok(buyer.roles.cache.has(role.id));
  assert.equal((await getHalloween(guild.id)).roleId, role.id);
  await assert.rejects(buy('rank', AFTER), /already have the role/);
  await assert.rejects(buy('xp1', AFTER + 2 * 86_400_000), /closed/);
  await assert.rejects(buyHalloweenItem({ client, guild, member: newMember('Biedny'), itemId: 'xp1', userError, now: DURING }), /costs \*\*100/);
});

test('Halloween announcement: posted when the event runs, deleted at the end with the top three', async () => {
  const room = mockGuild(client, 'Eventowo');
  const news = mockChannel(room, 'ogloszenia');
  const deleted = [];
  news.messages.delete = async (id) => { deleted.push(id); };
  await updateHalloween(room.id, (settings) => { settings.channelId = news.id; settings.totals = { 1: 50, 2: 900, 3: 10, 4: 300 }; });
  await runWithLocale('en', () => tickHalloween(client, room, DURING));
  assert.match(news.sent[0].embeds[0].toJSON().title, /Halloween 2026 has started/);
  assert.match(news.sent[0].embeds[0].toJSON().description, /Every message = \*\*5 🍬\*\* \(once every 20 s\)/);
  await runWithLocale('en', () => tickHalloween(client, room, DURING + 60_000));
  assert.equal(news.sent.length, 1, 'once');
  await runWithLocale('en', () => tickHalloween(client, room, AFTER));
  assert.deepEqual(deleted, [news.sent[0].id]);
  assert.match(news.sent[1].embeds[0].toJSON().description, /🥇 <@2> · \*\*900 🍬\*\*\n🥈 <@4>/);
  await runWithLocale('en', () => tickHalloween(client, room, AFTER + 60_000));
  assert.equal(news.sent.length, 2, 'the results only once');
});

test('panel: Halloween settings in the economy module, last day moves the end', async () => {
  process.env.PANEL_API_KEY = 'test-panel-key-0123456789abcdef';
  const express = (await import('express')).default;
  const { createPanelRouter } = await import('../src/api/panelApi.js');
  const app = express();
  app.use('/api/v1', createPanelRouter(client));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const call = async (method, path, body) => {
    const response = await fetch(`${base}${path}`, { method, headers: { Authorization: 'Bearer test-panel-key-0123456789abcdef', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text();
    return { status: response.status, text, json: JSON.parse(text) };
  };
  try {
    const view = (await call('GET', `/guilds/${guild.id}`)).json.modules.economy;
    assert.equal(view.halloween.lastDay, '2026-11-02');
    assert.equal(view.halloween.roleName, ROLE_NAME);
    assert.equal(view.commands.boosts.moneyHourPrice, 10_000);
    const saved = await call('PATCH', `/guilds/${guild.id}/economy`, { halloween: { perMessage: 8, lastDay: '2026-11-05' }, commands: { boosts: { xpHourPrice: 3000 } } });
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.json.halloween.perMessage, 8);
    assert.equal(saved.json.halloween.lastDay, '2026-11-05');
    assert.equal(saved.json.commands.boosts.xpHourPrice, 3000);
    assert.equal((await call('PATCH', `/guilds/${guild.id}/economy`, { halloween: { lastDay: '2027-01-01' } })).status, 400);

    // The announcement (2026-10-29): own title and text with {variables}, "send now", '' = back to the built-in one.
    assert.match(view.halloween.defaultAnnouncement.text, /\{cukierki\}/);
    assert.equal(view.halloween.posted, false);
    await updateHalloween(guild.id, (settings) => { settings.startsAt = Date.now() - 60_000; settings.endsAt = Date.now() + 86_400_000; });
    const before = channel.sent.length;
    const sent = await call('PATCH', `/guilds/${guild.id}/economy`, { halloween: { title: '🎃 Strasznie!', text: 'Za wiadomość {cukierki} 🍬, ranga {ranga}', announceNow: true } });
    assert.equal(sent.status, 200, sent.text);
    assert.equal(sent.json.halloween.posted, true);
    assert.equal(channel.sent.length, before + 1);
    const embed = channel.sent.at(-1).embeds[0].toJSON();
    assert.equal(embed.title, '🎃 Strasznie!');
    assert.equal(embed.description, `Za wiadomość 8 🍬, ranga ${ROLE_NAME}`);
    const reset = await call('PATCH', `/guilds/${guild.id}/economy`, { halloween: { title: '', text: null } });
    assert.equal(reset.json.halloween.title, null);
    assert.equal(reset.json.halloween.text, null);
    assert.equal((await call('PATCH', `/guilds/${guild.id}/economy`, { halloween: { text: 'x'.repeat(4000) } })).status, 400);
    await updateHalloween(guild.id, (settings) => { settings.enabled = false; });
    assert.equal((await call('PATCH', `/guilds/${guild.id}/economy`, { halloween: { announceNow: true } })).status, 400, 'not while the event is off');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await updateHalloween(guild.id, (settings) => { Object.assign(settings, { perMessage: 5, enabled: true, announcement: null, title: null, text: null }); });
  }
});

// ---------------------------------------------------------------- prestige

test('prestige: not enough money, then a reset for +10% of every payout, kept items and cards', async () => {
  const rich = newMember('Bogacz');
  await save(rich, { wallet: 100_000, bank: 0, upgrades: { work: 3 }, cards: { iwi: 1 }, inventory: { pen: 1 } });
  let view = await run(rich, 'prestiz', null);
  assert.match(view.text, /Prestige 1:\*\* \$500,000/);
  assert.equal(view.last.components[0].toJSON().components[0].disabled, true, 'not enough money');

  await save(rich, { wallet: 400_000, bank: 150_000, stocks: { KEBS: { shares: 5, cost: 600 } }, properties: { namiot: { level: 0, collectedAt: 0, spent: 5000 } } });
  view = await run(rich, 'prestiz', null);
  const start = view.last.components[0].toJSON().components[0];
  assert.equal(start.custom_id, `prestiz:start:${rich.id}`);
  assert.match((await press(newMember('Obcy'), start.custom_id)).reply[0].embeds[0].toJSON().description, /not your prestige/);
  const confirm = await press(rich, start.custom_id);
  assert.match(confirm.update[0].embeds[0].toJSON().description, /You lose \*\*\$550,000\*\*/);
  const done = await press(rich, `prestiz:tak:${rich.id}`);
  assert.match(done.update[0].embeds[0].toJSON().description, /Prestige 1!/);

  const after = await data(rich);
  assert.equal(after.prestige, 1);
  assert.equal(after.wallet, 0);
  assert.equal(after.bank, 0);
  assert.deepEqual(after.upgrades, {});
  assert.deepEqual(after.stocks, {});
  assert.deepEqual(after.properties, {});
  assert.equal(after.cards.iwi, 1);
  assert.equal(after.inventory.pen, 1);
  assert.equal(scaleEarnings(await getEconomySettings(guild.id), 1000, after), 1100);
  assert.match((await run(rich, 'prestiz', null)).text, /Prestige 2:\*\* \$1,000,000/);
});

// ---------------------------------------------------------------- merging

test('/polacz: five copies make one card of the next rarity in the same version; legendary cannot', async () => {
  const smith = newMember('Kowal');
  await save(smith, { cards: { bulwazaur: 11, 'iwi:golden': 5, krolpikczu: 6 } });
  const two = await mergeCards({ client, guildId: guild.id, userId: smith.id, cardKey: 'bulwazaur', times: 2, userError, random: () => 0 });
  assert.equal(two.results.length, 2);
  assert.ok(two.results.every((result) => result.card.rarity === 'uncommon'));
  assert.equal((await data(smith)).cards.bulwazaur, 1);
  assert.equal((await data(smith)).cards.pufcia, 2);

  const golden = await mergeCards({ client, guildId: guild.id, userId: smith.id, cardKey: 'iwi:golden', userError, random: () => 0 });
  assert.equal(golden.results[0].card.rarity, 'epic');
  assert.equal((await data(smith)).cards['czaryzard:golden'], 1);
  await assert.rejects(mergeCards({ client, guildId: guild.id, userId: smith.id, cardKey: 'krolpikczu', userError }), /legendary/);
  await assert.rejects(mergeCards({ client, guildId: guild.id, userId: smith.id, cardKey: 'bulwazaur', userError }), /need 5 copies/);

  await save(smith, { cards: { skwirtel: 5 } });
  const command = await run(smith, 'polacz', null, { karta: 'skwirtel' });
  assert.match(command.text, /Cards merged/);
  assert.match(command.text, /5× 💧 Skwirtel → 1×/);
});
