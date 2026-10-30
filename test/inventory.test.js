// /ekwipunek and /eq (2026-10-30, owner: "daj te wszystkie boosty, potki, rangi etc, niech mozna sobie wybierac jaka range sie chce
// miec ... daj tam eventowe i tam niech beda role do wyboru, mozna miec tylko jedna naraz").
import './helpers/env.js';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { mockChannel, mockGuild, mockInteraction, mockMember, mockRole, mockUser } from './helpers/mock.js';
import { runWithLocale } from '../src/i18n/index.js';
import { initializeDatabase } from '../src/utils/database.js';
import { loadCommands } from '../src/handlers/loaders/commandLoader.js';
import { getEconomyData, setEconomyData } from '../src/utils/economy.js';
import { updateEconomySettings } from '../src/services/economySettings.js';
import { addBoost } from '../src/services/boosts.js';
import { buySeasonItem, getSeasonEvent, ownedRanks } from '../src/services/seasonalEvents.js';
import { userError } from '../src/utils/featureKit.js';
import inventoryButtons from '../src/interactions/buttons/economy/inventory.js';
import inventoryMenu from '../src/interactions/selectMenus/economy/inventory.js';

const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null } };
let guild;
let channel;
const HALLOWEEN = getSeasonEvent('halloween');
const CHRISTMAS = getSeasonEvent('swieta');
const CHRISTMAS_EVE = Date.UTC(2026, 11, 24, 18);

before(async () => {
  const { db } = await initializeDatabase();
  client.db = db;
  await loadCommands(client);
  guild = mockGuild(client, 'Ekwipunek');
  guild.roles.create = async ({ name }) => mockRole(guild, name);
  channel = mockChannel(guild, 'ekonomia');
  await updateEconomySettings(guild.id, (settings) => { settings.currency = { symbol: '$', position: 'left', separator: ',' }; });
});

const data = (member) => getEconomyData(client, guild.id, member.id);
const save = async (member, patch) => setEconomyData(client, guild.id, member.id, { ...(await data(member)), ...patch });

async function run(member, commandName) {
  const interaction = mockInteraction({ client, guild, channel, member, commandName });
  await runWithLocale('en', () => client.commands.get(commandName).execute(interaction, {}, client));
  return interaction.replies.at(-1);
}

/** A click on a button or a menu option. Returns what the handler answered: { update, reply }. */
async function click(handler, member, customId, values = []) {
  const calls = { update: [], reply: [] };
  const interaction = {
    id: '1', client, guild, guildId: guild.id, channel, channelId: channel.id, member, user: member.user, customId, values,
    replied: false, deferred: false,
    reply: async (payload) => { calls.reply.push(payload); interaction.replied = true; },
    update: async (payload) => { calls.update.push(payload); },
    followUp: async () => {},
  };
  await runWithLocale('en', () => handler.execute(interaction, client, customId.split(':').slice(1)));
  return calls;
}

const ids = (payload) => payload.components.flatMap((row) => row.toJSON().components.map((component) => component.custom_id));
const text = (payload) => { const embed = payload.embeds[0].toJSON(); return [embed.description, ...(embed.fields ?? []).map((field) => `${field.name}\n${field.value}`)].join('\n'); };

test('/ekwipunek and /eq: three tabs; boosts and one-use items in their own tab', async () => {
  assert.ok(client.commands.get('eq'));
  const player = mockMember(guild, mockUser('Gracz'));
  const userData = await data(player);
  addBoost(userData, 'money', 60);
  await setEconomyData(client, guild.id, player.id, { ...userData, inventory: { pen: 1, energy_drink: 3 } });

  for (const name of ['ekwipunek', 'eq']) {
    const reply = await run(player, name);
    assert.deepEqual(ids(reply), ['przedmioty', 'boosty', 'eventowe'].map((tab) => `ekwipunek:tab:${player.id}:${tab}`));
    assert.match(text(reply), /Pen/);
    assert.doesNotMatch(text(reply), /Energy Drink/, 'potions are in the boosts tab');
  }
  const boosts = (await click(inventoryButtons, player, `ekwipunek:tab:${player.id}:boosty`)).update[0];
  assert.match(text(boosts), /Double money x2\*\* · ends <t:\d+:R>/);
  assert.match(text(boosts), /Energy Drink.*3x/);

  const stranger = mockMember(guild, mockUser('Obcy'));
  const other = await click(inventoryButtons, stranger, `ekwipunek:tab:${player.id}:boosty`);
  assert.equal(other.update.length, 0);
  assert.ok(ids(other.reply[0]).includes(`ekwipunek:tab:${stranger.id}:boosty`), 'their own inventory, privately');
});

test('event ranks: an old purchase is found, a new rank is worn alone, the menu switches between them', async () => {
  const fan = mockMember(guild, mockUser('Fan'));
  const oldRank = mockRole(guild, 'Halloween 2026');
  await fan.roles.add(oldRank);
  await save(fan, { swieta: { year: 2026, candies: 3_500, earned: 3_500 } });

  const bought = await buySeasonItem({ event: CHRISTMAS, client, guild, member: fan, itemId: 'rank', userError, now: CHRISTMAS_EVE });
  const christmasRole = [...guild.roles.cache.values()].find((role) => role.name === 'Święta 2026');
  assert.ok(fan.roles.cache.has(christmasRole.id));
  assert.ok(!fan.roles.cache.has(oldRank.id), 'one event rank at a time');
  assert.match(bought.note, /other event ranks wait/);
  assert.deepEqual(Object.keys((await data(fan)).eventRanks).sort(), ['halloween:2026', 'swieta:2026']);
  await assert.rejects(buySeasonItem({ event: CHRISTMAS, client, guild, member: fan, itemId: 'rank', userError, now: CHRISTMAS_EVE }), /already have the rank/);

  const tab = (await click(inventoryButtons, fan, `ekwipunek:tab:${fan.id}:eventowe`)).update[0];
  assert.match(text(tab), new RegExp(`You wear:\\*\\* <@&${christmasRole.id}>`));
  const menu = tab.components[1].toJSON().components[0];
  assert.equal(menu.custom_id, `ekwipunek:ranga:${fan.id}`);
  assert.deepEqual(menu.options.map((option) => [option.value, Boolean(option.default)]), [['halloween:2026', false], ['swieta:2026', true], ['none', false]]);

  const back = (await click(inventoryMenu, fan, `ekwipunek:ranga:${fan.id}`, ['halloween:2026'])).update[0];
  assert.match(text(back), /You wear <@&/);
  assert.ok(fan.roles.cache.has(oldRank.id));
  assert.ok(!fan.roles.cache.has(christmasRole.id));
  await click(inventoryMenu, fan, `ekwipunek:ranga:${fan.id}`, ['none']);
  assert.ok(!fan.roles.cache.has(oldRank.id) && !fan.roles.cache.has(christmasRole.id));
  assert.equal((await ownedRanks(guild, fan, await data(fan))).ranks.length, 2, 'both stay owned');

  const thief = mockMember(guild, mockUser('Zlodziej'));
  const denied = await click(inventoryMenu, thief, `ekwipunek:ranga:${fan.id}`, ['halloween:2026']);
  assert.equal(denied.update.length, 0);
  assert.ok(!thief.roles.cache.has(oldRank.id), 'a rank of someone else cannot be taken');
  assert.match(text((await click(inventoryMenu, fan, `ekwipunek:ranga:${fan.id}`, ['wakacje:2027'])).update[0]), /do not have this rank/);
});

test('a role that is an event\'s rank role counts as owned; a member without ranks sees how to get one', async () => {
  const lone = mockMember(guild, mockUser('Nowy'));
  const tab = (await click(inventoryButtons, lone, `ekwipunek:tab:${lone.id}:eventowe`)).update[0];
  assert.match(text(tab), /no event rank/);
  assert.match(text(tab), /\/event sklep/);
  assert.equal(tab.components.length, 1, 'no menu without ranks');

  // The Christmas rank role bought above is the event's roleId: holding it is enough, whatever its name.
  const christmasRole = [...guild.roles.cache.values()].find((role) => role.name === 'Święta 2026');
  christmasRole.name = 'Świąteczny elf';
  const holder = mockMember(guild, mockUser('Elf'), { roles: [christmasRole] });
  const { ranks } = await ownedRanks(guild, holder, await data(holder));
  assert.deepEqual(ranks.map((rank) => [rank.key, rank.worn]), [['swieta:2026', true]]);
  assert.equal(HALLOWEEN.roleName, 'Halloween 2026', 'a rank is named "<roleBase> <year>"');
});
