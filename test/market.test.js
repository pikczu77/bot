// Stock market, clubs, buildings and open trade offers (2026-10-27, owner picked ideas 8-11).
import './helpers/env.js';
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { mockChannel, mockGuild, mockInteraction, mockMember, mockUser, replyText, snowflake } from './helpers/mock.js';
import { runWithLocale } from '../src/i18n/index.js';
import { initializeDatabase } from '../src/utils/database.js';
import { loadCommands } from '../src/handlers/loaders/commandLoader.js';
import { getEconomyData, setEconomyData } from '../src/utils/economy.js';
import { updateEconomySettings } from '../src/services/economySettings.js';
import { earningMultiplier } from '../src/services/economyUpgrades.js';
import { progressOptions } from '../src/services/progress.js';
import {
  COMPANIES, HOUR_MS, PRICE_LIMITS, advanceMarket, getCompany, getMarket, stepPrice,
} from '../src/services/stockMarket.js';
import { clubCrewBonus, getClubs, settleClubWeek } from '../src/services/clubs.js';
import { PROPERTIES, dailyIncome } from '../src/services/properties.js';
import { weekKey } from '../src/utils/warsawTime.js';
import clubButtons from '../src/interactions/buttons/economy/club.js';
import tradeButtons from '../src/interactions/buttons/economy/trade.js';

const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null } };
let guild;
let channel;

before(async () => {
  const { db } = await initializeDatabase();
  client.db = db;
  await loadCommands(client);
  guild = mockGuild(client, 'Inwestycje');
  channel = mockChannel(guild, 'ekonomia');
  await updateEconomySettings(guild.id, (settings) => {
    settings.currency = { symbol: '$', position: 'left', separator: ',' };
  });
});
after(() => { progressOptions.enabled = false; });

const newMember = (name) => mockMember(guild, mockUser(name));
const data = (member) => getEconomyData(client, guild.id, member.id);
const save = async (member, patch) => setEconomyData(client, guild.id, member.id, { ...(await data(member)), ...patch });

// A refused command throws its user error here (the handler shows it on Discord): `text` is then that message.
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

function press(handler, member, customId) {
  const calls = { reply: [], update: [], followUp: [] };
  const interaction = {
    calls, id: snowflake(), client, guild, guildId: guild.id, channel, channelId: channel.id, member, user: member.user,
    customId, replied: false, deferred: false,
    reply: async (payload) => { calls.reply.push(payload); interaction.replied = true; },
    update: async (payload) => { calls.update.push(payload); },
    followUp: async (payload) => { calls.followUp.push(payload); },
  };
  return runWithLocale('en', () => handler.execute(interaction, client, customId.split(':').slice(1))).then(() => calls);
}
const callText = (payloads) => replyText({ replies: payloads });

// ---------------------------------------------------------------- stock market

test('prices move every hour, stay within 20%-500% of the base and keep 24 h of history', () => {
  const market = {};
  const start = 1_000 * HOUR_MS;
  assert.equal(advanceMarket(market, start, () => 0.5), 0, 'first use only sets the base prices');
  for (const company of COMPANIES) assert.equal(market.prices[company.id], company.base);
  assert.equal(advanceMarket(market, start + 30 * 60_000, Math.random), 0, 'same hour: nothing moves');

  let seed = 7;
  const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  advanceMarket(market, start + 40 * HOUR_MS, random);
  for (const company of COMPANIES) {
    assert.equal(market.history[company.id].length, 25);
    assert.ok(market.prices[company.id] >= Math.floor(company.base * PRICE_LIMITS[0]) && market.prices[company.id] <= company.base * PRICE_LIMITS[1]);
  }
  // A huge shock is cut at the limit; a price far above the base is pulled back down.
  const kebab = getCompany('kebs');
  assert.equal(stepPrice(kebab, kebab.base, () => 0, 10), kebab.base * PRICE_LIMITS[1]);
  assert.ok(stepPrice(kebab, kebab.base * 4, () => 0) < kebab.base * 4);
});

test('buying and selling shares: fee, budget, the per-company limit and the profit', async () => {
  const anna = newMember('Anna');
  await save(anna, { wallet: 10_000, bank: 0 });
  const market = await getMarket(guild.id);
  const price = market.prices.KEBS;

  const bought = await run(anna, 'gielda', 'kup', { firma: 'KEBS', ilosc: 10 });
  assert.match(bought.text, /You bought \*\*10\*\* shares/);
  const fee = Math.max(1, Math.ceil(price * 10 / 100));
  assert.equal((await data(anna)).wallet, 10_000 - price * 10 - fee);
  assert.deepEqual((await data(anna)).stocks.KEBS, { shares: 10, cost: price * 10 + fee });

  const budget = await run(anna, 'gielda', 'kup', { firma: 'ENDR', za_kwote: 2500 });
  const endr = (await data(anna)).stocks.ENDR.shares;
  assert.equal(endr, Math.floor(2500 / (market.prices.ENDR * 1.01)));
  assert.match(budget.text, /You bought/);

  await updateEconomySettings(guild.id, (settings) => { settings.commands.stocks.maxShares = 12; });
  await run(anna, 'gielda', 'kup', { firma: 'KEBS', ilosc: 5 });
  assert.equal((await data(anna)).stocks.KEBS.shares, 12, 'only up to the limit');
  const full = await run(anna, 'gielda', 'kup', { firma: 'KEBS', ilosc: 1 });
  assert.match(full.text, /most shares of one company \(12\)/);
  await updateEconomySettings(guild.id, (settings) => { settings.commands.stocks.maxShares = 10_000; });

  const before = (await data(anna)).wallet;
  const sold = await run(anna, 'gielda', 'sprzedaj', { firma: 'KEBS' });
  assert.match(sold.text, /You sold \*\*12\*\* shares/);
  const total = price * 12;
  assert.equal((await data(anna)).wallet, before + total - Math.ceil(total / 100));
  assert.equal((await data(anna)).stocks.KEBS, undefined);
  assert.match(sold.text, /Profit: \*\*-\$/, 'same price, so the fees are a loss');

  const none = await run(anna, 'gielda', 'sprzedaj', { firma: 'KEBS' });
  assert.match(none.text, /no shares of Kebab u Stefana/);
  const portfolio = await run(anna, 'gielda', 'portfel');
  assert.match(portfolio.text, /Ender Energia/);
  const prices = await run(anna, 'gielda', 'ceny');
  assert.match(prices.text, /Stock market/);
  assert.match(prices.text, /Creeper Corp/);
});

// ---------------------------------------------------------------- clubs

test('clubs: found, invite by button, treasury, upgrades give members their bonus, leaving', async () => {
  const owner = newMember('Szefowa');
  const friend = newMember('Kumpel');
  await save(owner, { wallet: 30_000 });
  await save(friend, { wallet: 1_000 });

  const poor = await run(friend, 'klub', 'zaloz', { nazwa: 'Biedni' });
  assert.match(poor.text, /A club costs \$25,000/);
  const founded = await run(owner, 'klub', 'zaloz', { nazwa: 'Lisy', emoji: '🦊' });
  assert.match(founded.text, /You founded 🦊 Lisy for \$25,000/);
  assert.equal((await data(owner)).wallet, 5_000);
  const clubId = (await data(owner)).club.id;
  assert.deepEqual((await data(owner)).club, { id: clubId, bonus: 0, crew: 0 });
  assert.match((await run(friend, 'klub', 'zaloz', { nazwa: 'lisy' })).text, /already a club called/);

  const invite = await run(owner, 'klub', 'zapros', { osoba: friend.user });
  const join = invite.last.components[0].toJSON().components[0].custom_id;
  assert.equal(join, `klub:tak:${clubId}:${friend.id}`);
  assert.match(callText((await press(clubButtons, newMember('Obcy'), join)).reply), /not for you/);
  const joined = await press(clubButtons, friend, join);
  assert.match(callText(joined.update), /Welcome to 🦊 Lisy/);
  assert.equal((await data(friend)).club.id, clubId);
  assert.match(callText((await press(clubButtons, friend, join)).reply), /no longer valid/);

  await run(owner, 'klub', 'wplac', { kwota: 5_000 });
  await save(friend, { wallet: 31_000 });
  await run(friend, 'klub', 'wplac', { kwota: 31_000 });
  assert.equal((await getClubs(guild.id)).clubs[clubId].treasury, 36_000);
  assert.match((await run(friend, 'klub', 'ulepsz', { co: 'bonus' })).text, /Only the owner/);

  const before = earningMultiplier(await data(friend), 'work');
  const upgraded = await run(owner, 'klub', 'ulepsz', { co: 'bonus' });
  assert.match(upgraded.text, /Club bonus\*\* is now level 1/);
  assert.equal((await data(friend)).club.bonus, 2);
  assert.ok(Math.abs(earningMultiplier(await data(friend), 'work') - before - 0.02) < 1e-9, '+2% job pay');
  assert.equal(earningMultiplier(await data(friend), 'daily'), 1, 'not on /daily');
  await run(owner, 'klub', 'ulepsz', { co: 'crew' });
  assert.equal(clubCrewBonus([await data(owner), await data(friend)]), 4, 'two members in one crew');
  assert.equal(clubCrewBonus([await data(owner), {}]), 0, 'one member is not enough');

  const paid = await run(owner, 'klub', 'wyplac', { kwota: 1_000, osoba: friend.user });
  assert.match(paid.text, /\$1,000\*\* from the treasury went to/);
  assert.equal((await data(friend)).wallet, 1_000);

  const info = await run(friend, 'klub', 'info');
  assert.match(info.text, /Members 2\/5/);
  assert.match(info.text, /Treasury:\*\* \$/);

  // The owner leaves: the friend takes over; then the friend closes the club and gets the treasury.
  assert.match((await run(owner, 'klub', 'wyjdz')).text, /new owner/);
  assert.equal((await data(owner)).club, undefined);
  const treasury = (await getClubs(guild.id)).clubs[clubId].treasury;
  const walletBefore = (await data(friend)).wallet;
  assert.match((await run(friend, 'klub', 'wyjdz')).text, /is closed/);
  assert.equal((await data(friend)).wallet, walletBefore + treasury);
  assert.equal((await getClubs(guild.id)).clubs[clubId], undefined);
});

test('club week: points are job money since Monday, the best club gets the prize', async () => {
  progressOptions.enabled = true;
  try {
    const a = newMember('Tygrys');
    const b = newMember('Wilk');
    await save(a, { wallet: 30_000, stats: { earned: 1_000 } });
    await save(b, { wallet: 30_000, stats: { earned: 500 } });
    await run(a, 'klub', 'zaloz', { nazwa: 'Tygrysy' });
    await run(b, 'klub', 'zaloz', { nazwa: 'Wilki' });
    // Job money after founding counts.
    await save(a, { stats: { ...(await data(a)).stats, earned: 4_000 } });
    await save(b, { stats: { ...(await data(b)).stats, earned: 1_500 } });

    const ranking = await run(a, 'klub', 'ranking');
    assert.match(ranking.text, /🥇 🛡️ Tygrysy · \$3,000/);

    const stored = await getClubs(guild.id);
    const nextWeek = Date.parse(`${stored.week}T12:00:00Z`) + 7 * 86_400_000;
    const result = await runWithLocale('en', () => settleClubWeek(client, guild, nextWeek));
    const tigers = result.find((row) => row.name === 'Tygrysy');
    assert.equal(tigers.points, 3_000);
    assert.equal(tigers.prize, 25_000);
    assert.equal(result.find((row) => row.name === 'Wilki').prize, 10_000);
    const after = await getClubs(guild.id);
    assert.equal(after.week, weekKey(nextWeek));
    assert.equal(Object.values(after.clubs).find((club) => club.name === 'Tygrysy').treasury, 25_000);
    assert.equal(await settleClubWeek(client, guild, nextWeek + 60_000), null, 'once a week');
    assert.match((await run(a, 'klub', 'info')).text, /This week:\*\* \$0 earned/);
  } finally {
    progressOptions.enabled = false;
  }
});

// ---------------------------------------------------------------- buildings

test('buildings: rent by the hour up to the cap, upgrades, selling', async () => {
  const owner = newMember('Kamienicznik');
  await save(owner, { wallet: 100_000, bank: 0 });
  const tent = PROPERTIES[0];
  const bought = await run(owner, 'nieruchomosci', 'kup', { budynek: tent.id });
  assert.match(bought.text, /You bought the ⛺ \*\*Tent\*\* for \$5,000/);
  assert.match((await run(owner, 'nieruchomosci', 'kup', { budynek: tent.id })).text, /already own/);
  assert.match((await run(owner, 'nieruchomosci', 'odbierz')).text, /No rent yet/);

  // 30 h later: 30 hours of rent; 100 h later: only the cap (48 h).
  const stored = await data(owner);
  await save(owner, { properties: { namiot: { ...stored.properties.namiot, collectedAt: Date.now() - 30 * HOUR_MS - 60_000 } } });
  const wallet = (await data(owner)).wallet;
  assert.match((await run(owner, 'nieruchomosci', 'odbierz')).text, /You collected \*\*\$312\*\*/);
  assert.equal((await data(owner)).wallet, wallet + Math.floor(250 * 30 / 24));

  await save(owner, { properties: { namiot: { ...(await data(owner)).properties.namiot, collectedAt: Date.now() - 100 * HOUR_MS } } });
  const list = await run(owner, 'nieruchomosci', 'lista');
  assert.match(list.text, /waiting: \*\*\$500\*\*/, '48 h of $250 a day');

  const upgraded = await run(owner, 'nieruchomosci', 'ulepsz', { budynek: tent.id });
  assert.match(upgraded.text, /now level 1 \(\$2,500\)/);
  assert.match(upgraded.text, /Rent collected first: \$500/);
  const settings = { earningsPercent: 100, commands: { property: { incomePercent: 100 } } };
  assert.equal(dailyIncome(settings, tent, 1), 325);

  const before = (await data(owner)).wallet;
  const sold = await run(owner, 'nieruchomosci', 'sprzedaj', { budynek: tent.id });
  assert.match(sold.text, /You sold the ⛺ \*\*Tent\*\* for \$4,500/, '60% of 5,000 + 2,500');
  assert.equal((await data(owner)).wallet, before + 4_500);
  assert.equal((await data(owner)).properties.namiot, undefined);
});

// ---------------------------------------------------------------- open trade offers

test('/wymiana without a person: the first member who has the wanted part gets the trade', async () => {
  const seller = newMember('Sprzedawca');
  const broke = newMember('Spłukany');
  const buyer = newMember('Kupiec');
  await save(seller, { wallet: 0, cards: { iwi: 2 } });
  await save(broke, { wallet: 10, bank: 0 });
  await save(buyer, { wallet: 600, bank: 0 });

  const offer = await run(seller, 'wymiana', null, { daje: 'iwi', chce_kasy: 500 });
  assert.match(offer.text, /Trade offer for everyone/);
  assert.equal(offer.last.content, '');
  const buttons = offer.last.components[0].toJSON().components.map((button) => button.custom_id);
  assert.equal(buttons.length, 2, 'no Decline on an open offer');
  const accept = buttons[0];

  assert.match(callText((await press(tradeButtons, seller, accept)).reply), /your own offer/);
  assert.match(callText((await press(tradeButtons, broke, accept)).reply), /does not have \$500/);
  const done = await press(tradeButtons, buyer, accept);
  assert.match(callText(done.update), /Trade done/);
  assert.equal((await data(buyer)).wallet, 100);
  assert.equal((await data(buyer)).cards.iwi, 1);
  assert.equal((await data(seller)).wallet, 500);
  assert.equal((await data(seller)).cards.iwi, 1);
  assert.match(callText((await press(tradeButtons, broke, accept)).followUp), /expired/);
});
