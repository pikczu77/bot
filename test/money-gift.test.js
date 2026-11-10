// One-time gifts at start (src/services/moneyGift.js).
import './helpers/env.js';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { mockGuild, mockMember, mockUser } from './helpers/mock.js';
import { initializeDatabase } from '../src/utils/database.js';
import { getEconomyData, setEconomyData } from '../src/utils/economy.js';
import { GIFTS, payGiftsOnce } from '../src/services/moneyGift.js';

const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null } };

before(async () => {
  const { db } = await initializeDatabase();
  client.db = db;
});

test('every human member gets the gift once, on every server', async () => {
  const gift = GIFTS.find((entry) => entry.id === '2026-11-10-300k');
  assert.equal(gift.amount, 300_000);
  const first = mockGuild(client, 'One');
  const second = mockGuild(client, 'Two');
  const rich = mockMember(first, mockUser('rich'));
  const fresh = mockMember(first, mockUser('fresh'));
  const other = mockMember(second, mockUser('other'));
  const before = await getEconomyData(client, first.id, rich.id, { joint: false });
  before.wallet = 1_000;
  await setEconomyData(client, first.id, rich.id, before);
  const startFresh = (await getEconomyData(client, first.id, fresh.id, { joint: false })).wallet;

  await payGiftsOnce(client);
  assert.equal((await getEconomyData(client, first.id, rich.id, { joint: false })).wallet, 301_000);
  assert.equal((await getEconomyData(client, first.id, fresh.id, { joint: false })).wallet, startFresh + 300_000);
  assert.equal((await getEconomyData(client, second.id, other.id, { joint: false })).wallet - 300_000 >= 0, true);
  const bot = first.members.me;
  assert.equal((await getEconomyData(client, first.id, bot.id, { joint: false })).wallet < 300_000, true, 'bots get nothing');

  await payGiftsOnce(client);
  assert.equal((await getEconomyData(client, first.id, rich.id, { joint: false })).wallet, 301_000, 'a restart pays nothing more');
});
