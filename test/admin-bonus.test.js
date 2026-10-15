// 2026-10-15 (owner, Discord messages): admin tools for one member (/economy gracz: reset money,
// free from jail, remove upgrades one by one or all), Diamond Clover +5%, and the collection
// bonuses shown in /ulepszenia: every fish +50% on /fish, every card +20% on every job.
import './helpers/env.js';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { Collection, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { mockChannel, mockGuild, mockInteraction, mockMember, mockUser, replyText, snowflake } from './helpers/mock.js';
import { runWithLocale } from '../src/i18n/index.js';
import { initializeDatabase } from '../src/utils/database.js';
import { loadCommands } from '../src/handlers/loaders/commandLoader.js';
import { getEconomyData, setEconomyData } from '../src/utils/economy.js';
import { updateEconomySettings } from '../src/services/economySettings.js';
import { earningMultiplier } from '../src/services/economyUpgrades.js';
import { CARDS, FISH } from '../src/services/collections.js';
import { getItemById } from '../src/config/shop/items.js';
import { buildUpgradesView } from '../src/commands/Economy/modules/upgrades_view.js';

const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null } };
let guild;
let channel;
let adminButtons;
let adminMenu;

before(async () => {
  const { db } = await initializeDatabase();
  client.db = db;
  await loadCommands(client);
  guild = mockGuild(client, 'Admin');
  channel = mockChannel(guild, 'ekonomia');
  client.users.fetch = async (id) => guild.members.cache.get(id)?.user ?? null;
  await updateEconomySettings(guild.id, (settings) => {
    settings.currency = { symbol: '$', position: 'left', separator: ',' };
    settings.earningsPercent = 100;
    settings.startingWallet = 100;
    settings.startingBank = 0;
  });
  adminButtons = (await import('../src/interactions/buttons/economy/admin.js')).default;
  adminMenu = (await import('../src/interactions/selectMenus/economy/admin.js')).default;
});

const data = (member) => getEconomyData(client, guild.id, member.id);
const save = async (member, patch) => setEconomyData(client, guild.id, member.id, { ...(await data(member)), ...patch });
const text = (payload) => replyText({ replies: [payload] });
const ids = (payload) => (payload.components ?? []).flatMap((row) => (row.toJSON ? row.toJSON() : row).components.map((part) => part.custom_id));
const allFish = Object.fromEntries(FISH.map((fish) => [fish.id, 1]));
const allCards = Object.fromEntries(CARDS.map((card) => [card.id, 1]));

function press(member, customId, values = null) {
  const calls = { reply: [], update: [] };
  return {
    calls, id: snowflake(), client, guild, guildId: guild.id, channel, member, user: member.user, customId, values,
    memberPermissions: member.permissions, createdTimestamp: Date.now(),
    reply: async (payload) => { calls.reply.push(payload); },
    update: async (payload) => { calls.update.push(payload); },
  };
}
async function click(member, customId) {
  const interaction = press(member, customId);
  await runWithLocale('en', () => adminButtons.execute(interaction, client, customId.split(':').slice(1)));
  return interaction;
}

test('Diamond Clover gives +5%', () => {
  assert.equal(getItemById('diamond_clover').bonusPercent, 5);
});

test('collections: every fish +50% on /fish, every card +20% on every job but /daily, shown in /ulepszenia', async () => {
  const none = { upgrades: {} };
  assert.equal(earningMultiplier(none, 'fish'), 1);
  assert.equal(earningMultiplier({ fishIndex: allFish }, 'fish'), 1.5);
  assert.equal(earningMultiplier({ fishIndex: allFish }, 'work'), 1, 'the fish bonus is only for /fish');
  for (const kind of ['work', 'mine', 'fish', 'crime', 'beg']) assert.equal(earningMultiplier({ cards: allCards }, kind), 1.2, kind);
  assert.equal(earningMultiplier({ cards: allCards }, 'daily'), 1);
  assert.equal(earningMultiplier({ cards: allCards, fishIndex: allFish, upgrades: { fish: 10 } }, 'fish'), 2.7, 'added together');
  const missingOne = { cards: { ...allCards, krolpikczu: 0 } };
  assert.equal(earningMultiplier(missingOne, 'work'), 1, 'the last copy sold = no bonus');

  // /fish with the full deck: 100 base x0.4 (common) x1.5 = 60, and the line says why.
  const angler = mockMember(guild, mockUser('Rybak'));
  await updateEconomySettings(guild.id, (settings) => { settings.commands.fish = { min: 100, max: 100, cooldownMinutes: 45 }; });
  await save(angler, { wallet: 0, inventory: { fishing_rod: 1 }, fishIndex: allFish });
  const interaction = mockInteraction({ client, guild, channel, member: angler, commandName: 'fish' });
  const random = Math.random;
  Math.random = () => 0;
  try { await runWithLocale('en', () => client.commands.get('fish').execute(interaction, {}, client)); } finally { Math.random = random; }
  assert.match(replyText(interaction), /Full fish deck:\*\* \+50%/);
  assert.equal((await data(angler)).wallet, 60);

  const view = await runWithLocale('pl', () => buildUpgradesView({ guildId: guild.id, userData: { cards: allCards, fishIndex: { bass: 1 } }, user: angler.user, ownerId: angler.id, prices: new Map() }));
  const shown = text(view);
  assert.match(shown, /Kolekcje[\s\S]*🔒 🎣 Cały deck ryb \*\*1\/20\*\*: \*\*\+50%\*\* hajsu z `\/fish`/);
  assert.match(shown, /✅ 🎴 Wszystkie karty Club'o'mony \*\*21\/21\*\*: \*\*\+20%\*\* ze wszystkich prac/);
});

test('/economy gracz: reset money, free from jail, remove one upgrade or all; only for admins', async () => {
  const admin = mockMember(guild, mockUser('Szef'), { permissions: [PermissionFlagsBits.ManageGuild] });
  const regular = mockMember(guild, mockUser('Zwykly'));
  const player = mockMember(guild, mockUser('Gracz'));
  await save(player, { wallet: 50_000, bank: 20_000, inventory: { pc: 1 }, upgrades: { luck: 4, stamina: 2, work: 3 }, jailedUntil: Date.now() + 3_600_000 });

  const opened = mockInteraction({ client, guild, channel, member: admin, commandName: 'economy', subcommand: 'gracz', options: { osoba: player.user } });
  await runWithLocale('en', () => client.commands.get('economy').execute(opened, {}, client));
  assert.match(replyText(opened), /Economy admin · Gracz[\s\S]*Cash: \*\*\$50,000\*\*[\s\S]*In jail for[\s\S]*Luck 4\/15/);
  assert.deepEqual(ids(opened.replies.at(-1)), [`ekoadmin:reset:${player.id}`, `ekoadmin:wypusc:${player.id}`, `ekoadmin:ulepszenia:${player.id}`, `ekoadmin:ulepszenie:${player.id}`]);

  // Not an admin: refused, nothing changes.
  const refused = await click(regular, `ekoadmin:reset-tak:${player.id}`);
  assert.equal(refused.calls.reply[0].flags, MessageFlags.Ephemeral);
  assert.equal((await data(player)).wallet, 50_000);

  // Reset asks first; "yes" sets the server's starting amounts, items and upgrades stay.
  const ask = await click(admin, `ekoadmin:reset:${player.id}`);
  assert.match(text(ask.calls.update[0]), /Reset the money of \*\*Gracz\*\*/);
  assert.deepEqual(ids(ask.calls.update[0]), [`ekoadmin:reset-tak:${player.id}`, `ekoadmin:pokaz:${player.id}`]);
  const reset = await click(admin, `ekoadmin:reset-tak:${player.id}`);
  assert.match(text(reset.calls.update[0]), /Money reset: cash \*\*\$100\*\*, bank \*\*\$0\*\*/);
  let account = await data(player);
  assert.deepEqual([account.wallet, account.bank, account.inventory.pc, account.upgrades.luck], [100, 0, 1, 4]);

  // Out of jail.
  await click(admin, `ekoadmin:wypusc:${player.id}`);
  assert.equal((await data(player)).jailedUntil, 0);

  // One upgrade from the menu, then all of them.
  const menu = press(admin, `ekoadmin:ulepszenie:${player.id}`, ['luck']);
  await runWithLocale('en', () => adminMenu.execute(menu, client, ['ulepszenie', player.id]));
  assert.match(text(menu.calls.update[0]), /Removed \*\*🍀 Luck\*\* \(was level 4\)/);
  assert.deepEqual((await data(player)).upgrades, { stamina: 2, work: 3 });
  await click(admin, `ekoadmin:ulepszenia-tak:${player.id}`);
  assert.deepEqual((await data(player)).upgrades, {});
});
