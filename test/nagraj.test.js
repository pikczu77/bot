// /nagraj (2026-10-15): the YouTuber job that replaced /mine. Videos get a rarity like the
// fish of /fish; the rarity sets the views and the pay. Old pickaxes, the laptop, the gaming
// computer and dynamite stay with their owners and count as the new items.
import './helpers/env.js';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { mockChannel, mockGuild, mockInteraction, mockMember, mockUser, replyText } from './helpers/mock.js';
import { runWithLocale } from '../src/i18n/index.js';
import { initializeDatabase } from '../src/utils/database.js';
import { loadCommands } from '../src/handlers/loaders/commandLoader.js';
import { getEconomyData, setEconomyData } from '../src/utils/economy.js';
import { getEconomySettings, getShopCatalog, updateEconomySettings } from '../src/services/economySettings.js';
import { VIDEO_RARITIES, rollVideo } from '../src/commands/Economy/mine.js';
import { purchaseItem } from '../src/commands/Economy/modules/buy.js';
import { bestInChain, nextInChain, purchaseRoom, getItemById } from '../src/config/shop/items.js';

const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null } };
let guild;
let channel;

before(async () => {
  const { db } = await initializeDatabase();
  client.db = db;
  await loadCommands(client);
  guild = mockGuild(client, 'Studio');
  channel = mockChannel(guild, 'nagrania');
  await updateEconomySettings(guild.id, (settings) => {
    settings.currency = { symbol: '$', position: 'left', separator: ',' };
    settings.earningsPercent = 100;
    settings.commands.mine = { min: 100, max: 100, cooldownMinutes: 60 };
  });
});

const newMember = (name) => mockMember(guild, mockUser(name));
const data = (member) => getEconomyData(client, guild.id, member.id);
const save = async (member, patch) => setEconomyData(client, guild.id, member.id, { ...(await data(member)), ...patch });

/** Run /nagraj with Math.random returning `values` in turn (the last one repeats). */
async function record(member, values, locale = 'en') {
  const interaction = mockInteraction({ client, guild, channel, member, commandName: 'nagraj' });
  const random = Math.random;
  let index = 0;
  Math.random = () => values[Math.min(index++, values.length - 1)];
  try {
    await runWithLocale(locale, () => client.commands.get('nagraj').execute(interaction, {}, client));
  } finally {
    Math.random = random;
  }
  return interaction;
}

test('rarities: common pays little, legendary a lot, more views pay more, about the base pay on average', () => {
  assert.equal(VIDEO_RARITIES.reduce((sum, rarity) => sum + rarity.chance, 0).toFixed(6), '1.000000');
  const average = VIDEO_RARITIES.reduce((sum, rarity) => sum + rarity.chance * rarity.multiplier, 0);
  assert.ok(average > 0.95 && average < 1.1, `average x${average}`);

  const range = { min: 400, max: 1200 };
  const common = rollVideo(range, (() => { const seq = [0.1, 0, 0]; return () => seq.shift() ?? 0; })());
  assert.equal(common.rarity.id, 'common');
  assert.equal(common.views, 50);
  assert.equal(common.pay, 160);
  const legendary = rollVideo(range, (() => { const seq = [0.999, 0.999, 0]; return () => seq.shift() ?? 0; })());
  assert.equal(legendary.rarity.id, 'legendary');
  assert.ok(legendary.views > 9_000_000, `${legendary.views} views`);
  assert.equal(legendary.pay, 9600);

  const low = rollVideo(range, (() => { const seq = [0.6, 0.1, 0]; return () => seq.shift() ?? 0; })());
  const high = rollVideo(range, (() => { const seq = [0.6, 0.9, 0]; return () => seq.shift() ?? 0; })());
  assert.equal(low.rarity.id, 'uncommon');
  assert.ok(high.views > low.views && high.pay > low.pay, 'within a rarity more views pay more');
});

test('/nagraj needs a computer; the message shows the views and the rarity', async () => {
  const fresh = newMember('Nowy');
  await save(fresh, { wallet: 0, inventory: {} });
  await assert.rejects(record(fresh, [0.5]), /Missing tool for mine/);

  const creator = newMember('Tworca');
  await save(creator, { wallet: 0, inventory: { pc: 1 } });
  const legendary = await record(creator, [0.999, 0.999, 0]);
  assert.match(replyText(legendary), /Video published[\s\S]*#1 on Trending[\s\S]*got \*\*\d{1,2} \d{3} \d{3}\*\* views[\s\S]*Legendary/);
  assert.equal((await data(creator)).wallet, 800);

  await save(creator, { lastMine: 0 });
  const pl = await record(creator, [0.1, 0, 0], 'pl');
  assert.match(replyText(pl), /Film opublikowany[\s\S]*Vlog z pokoju[\s\S]*\*\*50\*\* wyświetleń[\s\S]*Zwykły/);
  assert.equal((await data(creator)).wallet, 840);
});

test('old items count as the new ones and stay in the inventory', async () => {
  const veteran = newMember('Weteran');
  await save(veteran, { wallet: 100_000, inventory: { pickaxe: 1, steel_pickaxe: 1, laptop: 1, computer: 1, dynamite: 1 } });
  let account = await data(veteran);

  // Steel pickaxe = Internet (+50%), gaming computer = suit (+100% on /work).
  assert.equal(bestInChain(account, 'mine').id, 'internet');
  assert.equal(bestInChain(account, 'work').id, 'suit');
  assert.equal(purchaseRoom(getItemById('internet'), account), 0, 'Internet is already covered');
  assert.equal(nextInChain(account, 'mine').id, 'fiber_internet');
  assert.equal(nextInChain(account, 'work'), null);

  // Old dynamite works as a clickbait thumbnail: double views and pay. 100 x0.4 x1.5 x2 = 120.
  const video = await record(veteran, [0.1, 0, 0]);
  assert.match(replyText(video), /Internet: \*\*\+50%\*\*[\s\S]*Dynamite\*\* used - double views and pay/);
  assert.match(replyText(video), /\*\*100\*\* views/);
  account = await data(veteran);
  assert.equal(account.wallet, 100_120);
  assert.equal(account.inventory.dynamite, 0);
  assert.equal(account.inventory.pickaxe, 1, 'old items are not taken away');

  // Better Internet can be bought on top; the shop does not sell the old items.
  await purchaseItem({ client, guild, member: veteran, itemId: 'fiber_internet' });
  assert.equal(bestInChain(await data(veteran), 'mine').id, 'fiber_internet');
  const catalog = getShopCatalog(await getEconomySettings(guild.id), guild).map((item) => item.id);
  for (const id of ['pc', 'internet', 'fiber_internet', 'pen', 'suit', 'clickbait']) assert.ok(catalog.includes(id), id);
  for (const id of ['pickaxe', 'steel_pickaxe', 'diamond_pickaxe', 'laptop', 'computer', 'dynamite']) assert.ok(!catalog.includes(id), id);

  const inventory = mockInteraction({ client, guild, channel, member: veteran, commandName: 'ekwipunek' });
  await runWithLocale('pl', () => client.commands.get('ekwipunek').execute(inventory, {}, client));
  const text = replyText(inventory);
  assert.match(text, /Kilof\*\* → działa jak 🖥️ Komputer/);
  assert.match(text, /Komputer gamingowy\*\* → działa jak 🤵 Garnitur/);
  assert.match(text, /Lepszy internet/);
});

test('/work: pen +50%, suit +100%; an old laptop counts as the pen', async () => {
  assert.equal(getItemById('pen').bonusPercent, 50);
  assert.equal(getItemById('suit').bonusPercent, 100);
  assert.equal(getItemById('suit').requires, 'pen');
  assert.equal(bestInChain({ inventory: { laptop: 1 } }, 'work').id, 'pen');
  assert.equal(bestInChain({ inventory: { suit: 1, pen: 1 } }, 'work').id, 'suit');
});
