// 2026-10-15: Club'o'mony card packs (/paczka), the collection book (/index), more fish with
// golden (x1.2) and diamond (x1.6) versions, and /pozwij (sue for any amount).
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
import { CARDS, FISH, PACKS, packExpectedValue, packLegendaryChance } from '../src/services/collections.js';
import { sueChance } from '../src/commands/Economy/modules/lawsuit.js';
import { GUIDE_TOPICS } from '../src/commands/Economy/modules/economy_guide.js';

const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null } };
let guild;
let channel;
let buttons;
let menus;

before(async () => {
  const { db } = await initializeDatabase();
  client.db = db;
  await loadCommands(client);
  guild = mockGuild(client, 'Kolekcja');
  channel = mockChannel(guild, 'karty');
  client.users.fetch = async (id) => guild.members.cache.get(id)?.user ?? null;
  await updateEconomySettings(guild.id, (settings) => {
    settings.currency = { symbol: '$', position: 'left', separator: ',' };
    settings.earningsPercent = 100;
    settings.commands.fish = { min: 100, max: 100, cooldownMinutes: 45 };
  });
  buttons = new Map((await import('../src/interactions/buttons/economy/collection.js')).default.map((button) => [button.name, button]));
  buttons.set('pozew', (await import('../src/interactions/buttons/economy/lawsuit.js')).default);
  menus = (await import('../src/interactions/selectMenus/economy/index.js')).default;
});

const newMember = (name) => mockMember(guild, mockUser(name));
const data = (member) => getEconomyData(client, guild.id, member.id);
const save = async (member, patch) => setEconomyData(client, guild.id, member.id, { ...(await data(member)), ...patch });
const text = (payload) => replyText({ replies: [payload] });
const ids = (payload) => (payload.components ?? []).flatMap((row) => (row.toJSON ? row.toJSON() : row).components.map((part) => part.custom_id));

/** Run `fn` with Math.random returning `value`. */
async function withRandom(value, fn) {
  const random = Math.random;
  Math.random = () => value;
  try { return await fn(); } finally { Math.random = random; }
}

async function run(commandName, member, options = {}, locale = 'en') {
  const interaction = mockInteraction({ client, guild, channel, member, commandName, options });
  await runWithLocale(locale, () => client.commands.get(commandName).execute(interaction, {}, client));
  return interaction;
}

function press(member, customId, { values = null, message = null } = {}) {
  const calls = { reply: [], update: [], followUp: [] };
  return {
    calls, id: snowflake(), client, guild, guildId: guild.id, channel, channelId: channel.id, member, user: member.user, customId, values, message,
    createdTimestamp: Date.now(),
    reply: async (payload) => { calls.reply.push(payload); },
    update: async (payload) => { calls.update.push(payload); },
    followUp: async (payload) => { calls.followUp.push(payload); },
  };
}
async function click(member, customId, options) {
  const interaction = press(member, customId, options);
  const [name, ...args] = customId.split(':');
  await runWithLocale('en', () => buttons.get(name).execute(interaction, client, args));
  return interaction;
}

test('packs: 1/2/3 cards for 1,500 / 5,000 / 10,000, below their price on average, legendary more likely in better packs', () => {
  assert.deepEqual(PACKS.map((pack) => [pack.price, pack.cards]), [[1_500, 1], [5_000, 2], [10_000, 3]]);
  for (const pack of PACKS) {
    assert.equal(Object.values(pack.odds).reduce((sum, odds) => sum + odds, 0), 100, pack.id);
    const ratio = packExpectedValue(pack) / pack.price;
    assert.ok(ratio > 0.8 && ratio < 0.95, `${pack.id}: ${ratio}`);
  }
  const legendary = PACKS.map(packLegendaryChance);
  assert.ok(legendary[0] > 0 && legendary[0] < 0.01, 'starter: almost none, but some');
  assert.ok(legendary[0] < legendary[1] && legendary[1] < legendary[2]);
  for (const card of CARDS.filter((entry) => entry.rarity === 'legendary')) assert.ok(card.value >= 15_000 && card.value <= 30_000);
  for (const card of CARDS.filter((entry) => entry.rarity === 'common')) assert.ok(card.value <= 5);
  assert.equal(FISH.length, 20);
  assert.ok(GUIDE_TOPICS.some((topic) => topic.id === 'kolekcja'));
});

test('/paczka: pays, adds the cards to /index, sells them back; no money or jail = no pack', async () => {
  const collector = newMember('Kolekcjoner');
  await save(collector, { wallet: 5_000, bank: 6_000 });

  // 0.99 on every roll: legendary, the last card (Król Pikczu), diamond version.
  const opened = await withRandom(0.99, () => run('paczka', collector, { rodzaj: 'legend' }));
  assert.match(replyText(opened), /Legend Pack opened[\s\S]*Król Pikczu[\s\S]*diamond version[\s\S]*\$48,000[\s\S]*NEW/);
  let account = await data(collector);
  assert.equal(account.wallet, 0, 'cash first');
  assert.equal(account.bank, 1_000, 'then the bank');
  assert.equal(account.cards['krolpikczu:diamond'], 3);

  const sell = ids(opened.replies.at(-1)).find((id) => id.startsWith('paczka:sprzedaj:'));
  assert.equal(sell, `paczka:sprzedaj:${collector.id}:krolpikczu_d.krolpikczu_d.krolpikczu_d`);
  // Someone else pressing it gets the pack list privately; nothing is sold.
  const stranger = newMember('Obcy');
  const other = await click(stranger, sell);
  assert.equal(other.calls.reply[0].flags, MessageFlags.Ephemeral);
  assert.equal((await data(collector)).cards['krolpikczu:diamond'], 3);

  const sold = await click(collector, sell);
  assert.match(text(sold.calls.update[0]), /Sold \*\*3\*\* cards for \*\*\$144,000\*\*/);
  account = await data(collector);
  assert.equal(account.wallet, 144_000);
  assert.equal(account.cards['krolpikczu:diamond'], 0);
  const again = await click(collector, sell);
  assert.match(text(again.calls.update[0]), /not in your index any more/);
  assert.equal((await data(collector)).wallet, 144_000);

  // Not enough money.
  const poor = newMember('Biedny');
  await save(poor, { wallet: 1_000, bank: 0 });
  await assert.rejects(run('paczka', poor, { rodzaj: 'startowa' }), /Not enough money for a pack/);
  assert.equal((await data(poor)).wallet, 1_000);
  // Jail.
  await save(poor, { wallet: 10_000, jailedUntil: Date.now() + 60_000 });
  await assert.rejects(run('paczka', poor, { rodzaj: 'startowa' }), /jail/i);

  // Without a choice: the three packs with their odds and buttons.
  const shop = await run('paczka', collector, {}, 'pl');
  assert.match(replyText(shop), /Paczka Startowa[\s\S]*Paczka Kolekcjonera[\s\S]*Paczka Legend/);
  assert.deepEqual(ids(shop.replies.at(-1)), PACKS.map((pack) => `paczka:otworz:${collector.id}:${pack.id}`));
});

test('/index: cards and fish, sell one card or every duplicate, others only look', async () => {
  const owner = newMember('Wlasciciel');
  await save(owner, { wallet: 0, cards: { bulwazaur: 4, 'iwi:golden': 2, miau: 1 }, fishIndex: { kraken: 1, 'bass:diamond': 2 } });

  const index = await run('index', owner, {}, 'pl');
  const view = replyText(index);
  assert.match(view, /Club'o'mony: \*\*3\/21\*\* kart · warte \*\*\$27,208\*\*/);
  assert.match(view, /🥔 \*\*Bulwazaur\*\* ×4/);
  assert.match(view, /🦊 \*\*Iwi\*\* 🟨×2/);
  assert.match(view, /❔ \?\?\?/);
  const components = ids(index.replies.at(-1));
  assert.ok(components.includes(`index:sprzedaj:${owner.id}`));
  assert.ok(components.includes(`index:duplikaty:${owner.id}`));

  // Duplicates: 3 Bulwazaur ($2) + 1 golden Iwi ($3,600); one of each stays.
  const duplicates = await click(owner, `index:duplikaty:${owner.id}`);
  assert.match(text(duplicates.calls.update[0]), /Sold \*\*4\*\* duplicates for \*\*\$3,606\*\*/);
  let account = await data(owner);
  assert.deepEqual([account.cards.bulwazaur, account.cards['iwi:golden'], account.cards.miau], [1, 1, 1]);
  assert.equal(account.wallet, 3_606);

  // Sell one card from the menu.
  const menu = press(owner, `index:sprzedaj:${owner.id}`, { values: ['miau'] });
  await runWithLocale('en', () => menus.execute(menu, client, ['sprzedaj', owner.id]));
  assert.match(text(menu.calls.update[0]), /Sold for \*\*\$20,000\*\*/);
  account = await data(owner);
  assert.equal(account.cards.miau, 0);
  assert.equal(account.wallet, 23_606);

  // The fish tab.
  const fish = await click(owner, `index:pokaz:${owner.id}:${owner.id}:ryby`);
  assert.match(text(fish.calls.update[0]), /Fish: \*\*2\/20\*\* species[\s\S]*Bass\*\* 💎×2[\s\S]*Kraken\*\* ×1/);

  // Someone else's index: no selling, and their own clicks open their own view privately.
  const visitor = newMember('Gosc');
  const visit = await run('index', visitor, { osoba: owner.user });
  assert.deepEqual(ids(visit.replies.at(-1)), [`index:pokaz:${visitor.id}:${owner.id}:karty`, `index:pokaz:${visitor.id}:${owner.id}:ryby`]);
  const theirSell = press(visitor, `index:sprzedaj:${owner.id}`, { values: ['bulwazaur'] });
  await runWithLocale('en', () => menus.execute(theirSell, client, ['sprzedaj', owner.id]));
  assert.equal(theirSell.calls.reply[0].flags, MessageFlags.Ephemeral);
  assert.equal((await data(owner)).cards.bulwazaur, 1);
});

test('/fish: 20 species, the rarity sets the pay, golden x1.2, diamond x1.6, every catch goes to /index', async () => {
  const angler = newMember('Wedkarz');
  await save(angler, { wallet: 0, inventory: { fishing_rod: 1 } });
  // 0.99: legendary, Kraken, diamond. 100 base x8 x1.6 = 1,280.
  const legendary = await withRandom(0.99, () => run('fish', angler));
  assert.match(replyText(legendary), /Kraken[\s\S]*\$1,280[\s\S]*diamond version\*\*: x1.6[\s\S]*New in your `\/index`/);
  let account = await data(angler);
  assert.equal(account.wallet, 1_280);
  assert.equal(account.fishIndex['kraken:diamond'], 1);

  // 0: common, Bass, normal. 100 x0.4 = 40.
  await save(angler, { lastFish: 0 });
  const common = await withRandom(0, () => run('fish', angler, {}, 'pl'));
  assert.match(replyText(common), /Okoń[\s\S]*\$40[\s\S]*Zwykły/);
  account = await data(angler);
  assert.equal(account.wallet, 1_320);
  assert.equal(account.fishIndex.bass, 1);
});

test('/pozwij: the chance falls with the amount, buttons change it, won = paid, lost = court costs', async () => {
  assert.equal(sueChance(0, 1000), 0);
  assert.ok(Math.abs(sueChance(100, 1000) - 0.6 * 0.81) < 1e-12);
  assert.ok(sueChance(5_000, 10_000) < sueChance(1_000, 10_000));
  assert.equal(sueChance(9_999, 10_000), 0.01);
  assert.equal(sueChance(10_001, 10_000), 0);

  const plaintiff = newMember('Powod');
  const defendant = newMember('Pozwany');
  await save(plaintiff, { wallet: 10_000, upgrades: { crime: 2 } });
  await save(defendant, { wallet: 5_000, bank: 5_000 });
  await assert.rejects(run('pozwij', plaintiff, { osoba: plaintiff.user, kwota: 100 }), /Cannot sue yourself/);

  const preview = await run('pozwij', plaintiff, { osoba: defendant.user, kwota: 1_000 });
  assert.match(replyText(preview), /sue \*\*Pozwany\*\* for \*\*\$1,000\*\*[\s\S]*Chance to win: \*\*49%\*\*[\s\S]*you get \*\*\$1,200\*\*[\s\S]*you pay \*\*\$200\*\* court costs/);
  const base = `${plaintiff.id}:${defendant.id}:1000`;
  assert.deepEqual(ids(preview.replies.at(-1)), [`pozew:zmien:${base}:d50`, `pozew:zmien:${base}:d10`, `pozew:zmien:${base}:u10`, `pozew:zmien:${base}:u50`, `pozew:start:${base}`, `pozew:anuluj:${plaintiff.id}`]);

  // +50%: 1,500 and a smaller chance. Only the plaintiff can press.
  const bystander = await click(newMember('Widz'), `pozew:zmien:${base}:u50`);
  assert.equal(bystander.calls.reply[0].flags, MessageFlags.Ephemeral);
  const raised = await click(plaintiff, `pozew:zmien:${base}:u50`);
  assert.match(text(raised.calls.update[0]), /for \*\*\$1,500\*\*[\s\S]*Chance to win: \*\*43%\*\*/);

  // Won: the defendant pays 1,500 (cash first), the plaintiff gets +20% Street smarts.
  const won = await withRandom(0, () => click(plaintiff, `pozew:start:${plaintiff.id}:${defendant.id}:1500`));
  assert.match(text(won.calls.followUp[0]), /Case won[\s\S]*pays \*\*\$1,500\*\*[\s\S]*gets \*\*\$1,800\*\*/);
  assert.equal((await data(defendant)).wallet, 3_500);
  assert.equal((await data(plaintiff)).wallet, 11_800);

  // The break: a second case right away is refused.
  await assert.rejects(run('pozwij', plaintiff, { osoba: defendant.user, kwota: 100 }), /Lawsuit cooldown/);

  // Lost: 20% court costs go to the defendant; Insurance pays them once instead.
  await save(plaintiff, { cooldowns: {}, inventory: { insurance: 1 } });
  const insured = await withRandom(0.99, () => click(plaintiff, `pozew:start:${plaintiff.id}:${defendant.id}:5000`));
  assert.match(text(insured.calls.followUp[0]), /Case lost[\s\S]*Insurance\*\* paid the court costs: \*\*\$1,000\*\*/);
  assert.equal((await data(plaintiff)).wallet, 11_800);
  assert.equal((await data(defendant)).wallet, 4_500);
  await save(plaintiff, { cooldowns: {} });
  await withRandom(0.99, () => click(plaintiff, `pozew:start:${plaintiff.id}:${defendant.id}:5000`));
  assert.equal((await data(plaintiff)).wallet, 10_800);
  assert.equal((await data(defendant)).wallet, 5_500);

  // More than the defendant has: the case is not run, the preview comes back with the amount lowered.
  await save(plaintiff, { cooldowns: {} });
  const tooMuch = await click(plaintiff, `pozew:start:${plaintiff.id}:${defendant.id}:999999`);
  assert.match(text(tooMuch.calls.update[0]), /has less money now[\s\S]*for \*\*\$10,500\*\*/);
  assert.equal(tooMuch.calls.followUp.length, 0);
});
