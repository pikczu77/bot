// Hooks and cameras (2026-10-16): /fish and /nagraj several times in a row before the break,
// like /work with Overtime, and a "do it again" button under /work, /fish and /nagraj while
// uses are left (or an Energy Drink / Extra Work Shift could skip the break).
import './helpers/env.js';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { Collection, MessageFlags } from 'discord.js';
import { mockChannel, mockGuild, mockInteraction, mockMember, mockUser, replyText, snowflake } from './helpers/mock.js';
import { runWithLocale } from '../src/i18n/index.js';
import { initializeDatabase } from '../src/utils/database.js';
import { loadCommands } from '../src/handlers/loaders/commandLoader.js';
import { getEconomyData, setEconomyData } from '../src/utils/economy.js';
import { updateEconomySettings } from '../src/services/economySettings.js';
import { takeUseInARow } from '../src/services/economyUpgrades.js';
import { ITEM_CHAINS, bestInChain, getItemById, nextInChain, tierEffect, usesInARow } from '../src/config/shop/items.js';
import againButton from '../src/interactions/buttons/economy/again.js';

const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null } };
let guild;
let channel;

before(async () => {
  const { db } = await initializeDatabase();
  client.db = db;
  await loadCommands(client);
  guild = mockGuild(client, 'Haczyki');
  channel = mockChannel(guild, 'ryby');
  await updateEconomySettings(guild.id, (settings) => {
    settings.currency = { symbol: '$', position: 'left', separator: ',' };
    settings.earningsPercent = 100;
    settings.commands.fish = { min: 100, max: 100, cooldownMinutes: 60 };
    settings.commands.mine = { min: 100, max: 100, cooldownMinutes: 60 };
  });
});

const newMember = (name) => mockMember(guild, mockUser(name));
const data = (member) => getEconomyData(client, guild.id, member.id);
const save = async (member, patch) => setEconomyData(client, guild.id, member.id, { ...(await data(member)), ...patch });
const text = (payload) => replyText({ replies: [payload] });
const buttons = (payload) => (payload.components ?? []).flatMap((row) => (row.toJSON ? row.toJSON() : row).components);

async function run(commandName, member) {
  const interaction = mockInteraction({ client, guild, channel, member, commandName });
  await runWithLocale('en', () => client.commands.get(commandName).execute(interaction, {}, client));
  return interaction.replies.at(-1);
}

function press(member, customId) {
  const calls = { reply: [], update: [] };
  const interaction = {
    calls, id: snowflake(), client, guild, guildId: guild.id, channel, channelId: channel.id, member, user: member.user,
    customId, createdTimestamp: Date.now(), replied: false, deferred: false,
    reply: async (payload) => { interaction.replied = true; calls.reply.push(payload); },
    followUp: async (payload) => { calls.reply.push(payload); },
    editReply: async (payload) => { calls.reply.push(payload); },
    update: async (payload) => { calls.update.push(payload); },
  };
  return interaction;
}
const click = (interaction) => runWithLocale('en', () => againButton.execute(interaction, client, interaction.customId.split(':').slice(1)));

test('items: hooks and cameras are two new 3-tier chains, sold in order', () => {
  const hooks = ITEM_CHAINS.find((chain) => chain.id === 'hooks');
  const cameras = ITEM_CHAINS.find((chain) => chain.id === 'cameras');
  assert.deepEqual(hooks.items.map((item) => [item.id, item.inARow]), [['spare_hook', 2], ['hook_set', 3], ['tackle_box', 4]]);
  assert.deepEqual(cameras.items.map((item) => [item.id, item.inARow]), [['second_camera', 2], ['camera_kit', 3], ['studio', 4]]);

  assert.equal(usesInARow({ inventory: {} }, 'hooks'), 1);
  assert.equal(usesInARow({ inventory: { spare_hook: 1, hook_set: 1 } }, 'hooks'), 3);
  assert.equal(nextInChain({ inventory: { spare_hook: 1 } }, 'hooks').id, 'hook_set');
  assert.equal(bestInChain({ inventory: { studio: 1 } }, 'cameras').id, 'studio');
  assert.equal(runWithLocale('en', () => tierEffect(getItemById('tackle_box'))), ' (4× in a row)');
  assert.equal(runWithLocale('pl', () => tierEffect(getItemById('tackle_box'))), ' (4× pod rząd)');
  assert.equal(tierEffect(getItemById('internet')), ' (+50%)');
});

test('takeUseInARow: allowed uses, then the break, an Energy Drink skips it, the break resets the row', () => {
  const cooldown = 60 * 60_000;
  const start = 1_000_000_000;
  const user = { inventory: { energy_drink: 1 } };
  const take = (now) => takeUseInARow(user, { lastKey: 'lastFish', streakKey: 'fishStreak', cooldown, allowed: 3, skipItem: 'energy_drink', now });

  assert.deepEqual(take(start), { blocked: false, usedItem: false, inARowLeft: 2, nextAt: null });
  assert.equal(take(start + 1000).inARowLeft, 1);
  assert.deepEqual(take(start + 2000), { blocked: false, usedItem: false, inARowLeft: 0, nextAt: start + 2000 + cooldown });
  const drink = take(start + 3000);
  assert.equal(drink.usedItem, true);
  assert.equal(user.inventory.energy_drink, 0);
  const blocked = take(start + 4000);
  assert.equal(blocked.blocked, true);
  assert.equal(blocked.remaining, cooldown - 1000);
  assert.equal(user.lastFish, start + 3000, 'a blocked use changes nothing');

  assert.equal(take(start + 3000 + cooldown).inARowLeft, 2, 'a full break starts a new row');

  // Someone who fished before rows existed (no streak stored) counts as one use.
  const old = { lastFish: start, inventory: {} };
  assert.equal(takeUseInARow(old, { lastKey: 'lastFish', streakKey: 'fishStreak', cooldown, allowed: 1, skipItem: 'energy_drink', now: start + 1000 }).blocked, true);
  assert.equal(takeUseInARow(old, { lastKey: 'lastFish', streakKey: 'fishStreak', cooldown, allowed: 2, skipItem: 'energy_drink', now: start + 1000 }).inARowLeft, 0);
});

test('/fish: without hooks one catch and no button; a Hook Set gives 3 in a row with a "Fish again" button', async () => {
  const plain = newMember('BezHaczyka');
  await save(plain, { inventory: { fishing_rod: 1 } });
  const single = await run('fish', plain);
  assert.match(text(single), /Next fishing trip available in/);
  assert.deepEqual(buttons(single), []);
  await assert.rejects(run('fish', plain), /cooldown/i);

  const angler = newMember('Wedkarz');
  await save(angler, { inventory: { fishing_rod: 1, spare_hook: 1, hook_set: 1 } });
  const first = await run('fish', angler);
  assert.match(text(first), /2 more in a row now, then a break of 1h./);
  assert.deepEqual(buttons(first).map((b) => [b.custom_id, b.label]), [[`ponownie:fish:${angler.id}`, 'Fish again (2)']]);

  // The button runs the next catch and replaces the message.
  const second = press(angler, `ponownie:fish:${angler.id}`);
  await click(second);
  assert.match(text(second.calls.update[0]), /1 more in a row now/);
  const third = press(angler, `ponownie:fish:${angler.id}`);
  await click(third);
  assert.match(text(third.calls.update[0]), /Next fishing trip available in/);
  assert.deepEqual(buttons(third.calls.update[0]), [], 'no button once the row is used up');
  assert.equal((await data(angler)).fishStreak, 3);
  await assert.rejects(run('fish', angler), /cooldown/i);

  // With an Energy Drink the button stays and shows how many drinks are left.
  await save(angler, { inventory: { ...(await data(angler)).inventory, energy_drink: 2 } });
  const drink = await run('fish', angler);
  assert.match(text(drink), /Energy Drink\*\* used/);
  assert.equal(buttons(drink)[0].label, 'Fish again (🥤 1)');
});

test('/nagraj with a Recording Studio: 4 videos in a row, Polish button label', async () => {
  const youtuber = newMember('Jutuber');
  await save(youtuber, { inventory: { pc: 1, second_camera: 1, camera_kit: 1, studio: 1 } });
  const interaction = mockInteraction({ client, guild, channel, member: youtuber, commandName: 'nagraj' });
  await runWithLocale('pl', () => client.commands.get('nagraj').execute(interaction, {}, client));
  const reply = interaction.replies.at(-1);
  assert.match(text(reply), /Jeszcze 3 pod rząd, potem przerwa/);
  assert.equal(buttons(reply)[0].label, 'Nagrywaj ponownie (3)');
  for (let i = 0; i < 3; i += 1) await run('nagraj', youtuber);
  await assert.rejects(run('nagraj', youtuber), /cooldown/i);
});

test('"again" button: only the owner can press it; a break answers privately', async () => {
  const owner = newMember('Wlasciciel');
  const other = newMember('Ktos');
  await save(owner, { inventory: { fishing_rod: 1, spare_hook: 1 } });
  await save(other, { inventory: { fishing_rod: 1 } });

  const foreign = press(other, `ponownie:fish:${owner.id}`);
  await click(foreign);
  assert.match(text(foreign.calls.reply[0]), /This button is for someone else/);
  assert.equal(foreign.calls.reply[0].flags, MessageFlags.Ephemeral);
  assert.equal(foreign.calls.update.length, 0);
  assert.equal((await data(other)).lastFish ?? 0, 0, 'nothing happened for the other member');

  await run('fish', owner);
  await run('fish', owner);
  const tired = press(owner, `ponownie:fish:${owner.id}`);
  await click(tired);
  assert.equal(tired.calls.update.length, 0, 'the message stays');
  assert.match(text(tired.calls.reply[0]), /tired to fish/);
});
