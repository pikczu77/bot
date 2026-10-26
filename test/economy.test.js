// Economy rework of 2026-10-14: jobs in /work, item tiers, discount, the earnings
// multiplier, the casino games and their win chances.
import './helpers/env.js';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { mockChannel, mockGuild, mockInteraction, mockMember, mockUser, replyText, snowflake } from './helpers/mock.js';
import { runWithLocale } from '../src/i18n/index.js';
import { initializeDatabase } from '../src/utils/database.js';
import { loadCommands } from '../src/handlers/loaders/commandLoader.js';
import { getUserLevelKey } from '../src/utils/database/keys.js';
import { getEconomyData, setEconomyData } from '../src/utils/economy.js';
import { getEconomySettings, getShopCatalog, nicePrice, updateEconomySettings } from '../src/services/economySettings.js';
import { buyUpgrade, getUpgrade, upgradeCost, upgradePrice } from '../src/services/economyUpgrades.js';
import { JOBS, JOB_SHIFTS, pickOffers } from '../src/services/economyJobs.js';
import { SLOT_AVERAGE_PAYOUT, SLOT_BASE_CHANCE, applyLuck, luckPoints, spinRoulette, spinSlots, takeLuck } from '../src/services/casino.js';
import { dealerOdds, handValue, settle, standOdds, bustChance } from '../src/services/blackjack.js';
import { purchaseRoom, missingRequirement, getItemById, bestInChain } from '../src/config/shop/items.js';

const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null } };
let guild;
let channel;

before(async () => {
  const { db } = await initializeDatabase();
  client.db = db;
  await loadCommands(client);
  guild = mockGuild(client, 'Kasyno');
  channel = mockChannel(guild, 'stol');
  await updateEconomySettings(guild.id, (settings) => {
    settings.currency = { symbol: '$', position: 'left', separator: ',' };
  });
});

const newMember = (name) => mockMember(guild, mockUser(name));
const data = (member) => getEconomyData(client, guild.id, member.id);
const save = async (member, patch) => setEconomyData(client, guild.id, member.id, { ...(await data(member)), ...patch });

async function run(commandName, member, options = {}) {
  const interaction = mockInteraction({ client, guild, channel, member, commandName, options });
  await runWithLocale('en', () => client.commands.get(commandName).execute(interaction, {}, client));
  return interaction;
}

/** A button press on a message; records what the handler answered. */
function press(member, customId) {
  const calls = { reply: [], update: [], followUp: [] };
  return {
    calls, id: snowflake(), client, guild, guildId: guild.id, channel, channelId: channel.id, member, user: member.user, customId,
    reply: async (payload) => { calls.reply.push(payload); },
    update: async (payload) => { calls.update.push(payload); },
    followUp: async (payload) => { calls.followUp.push(payload); },
  };
}
const text = (payload) => replyText({ replies: [payload] });

test('prices: earnings multiplier, payout-based consumables, old price overrides dropped once', async () => {
  const other = mockGuild(client, 'Stare ceny');
  await client.db.set(`guild:${other.id}:economy-settings`, {
    shop: { items: { pc: { price: 45000 }, pen: { enabled: false, price: 20000 } } },
    commands: { mine: { min: 300, max: 800 }, fish: { min: 200, max: 400 } },
  });
  const settings = await getEconomySettings(other.id);
  const catalog = new Map(getShopCatalog(settings).map((item) => [item.id, item]));
  assert.equal(catalog.get('pc').price, 2500, 'the 45,000 override is gone');
  assert.equal(catalog.get('pen').enabled, false, 'switched-off items stay off');
  assert.ok(!catalog.has('pickaxe') && !catalog.has('laptop') && !catalog.has('dynamite'), 'retired items are not sold');
  // The user's example: /mine (now /nagraj) 300-800 -> Energy Drink 500.
  assert.equal(catalog.get('energy_drink').price, 500);
  assert.equal(catalog.get('clickbait').price, 550);
  assert.equal(catalog.get('fishing_net').price, 300);

  const saved = await updateEconomySettings(other.id, (data) => { data.earningsPercent = 200; data.shop.items.pc = { price: 9999 }; });
  assert.equal(saved.balanceVersion, 3);
  const after = new Map(getShopCatalog(await getEconomySettings(other.id)).map((item) => [item.id, item]));
  assert.equal(after.get('pc').price, 9999, 'overrides set after the update stay');
  assert.equal(after.get('energy_drink').price, 1000, 'x2 earnings doubles payout-based prices');
  assert.deepEqual([40, 449, 1234, 12_300].map(nicePrice), [50, 450, 1200, 12_500]);
});

test('gamble x2 stored before 2026-10-26 becomes x1.7 once; prices set after the 2026-10-14 balance stay', async () => {
  const old = mockGuild(client, 'Stare kasyno');
  await client.db.set(`guild:${old.id}:economy-settings`, {
    balanceVersion: 2,
    shop: { items: { pc: { price: 7777 } } },
    commands: { gamble: { cooldownMinutes: 5, winPercent: 50, payoutPercent: 200, maxBet: 0 } },
  });
  const settings = await getEconomySettings(old.id);
  assert.equal(settings.commands.gamble.payoutPercent, 170);
  assert.equal(settings.commands.gamble.winPercent, 50);
  assert.equal(settings.shop.items.pc.price, 7777);
  // Chosen again in the panel after the change: x2 stays.
  const saved = await updateEconomySettings(old.id, (data) => { data.commands.gamble.payoutPercent = 200; });
  assert.equal(saved.commands.gamble.payoutPercent, 200);
  assert.equal((await getEconomySettings(old.id)).commands.gamble.payoutPercent, 200);
  assert.equal((await getEconomySettings(mockGuild(client, 'Nowe kasyno').id)).commands.gamble.payoutPercent, 170);
});

test('/work: 3 offers for the server level, a job lasts 5 shifts, Overtime allows shifts in a row', async () => {
  const worker = newMember('Pracus');
  assert.deepEqual(pickOffers(0, () => 0).map((job) => job.level), [0, 0, 0]);
  const top = pickOffers(100);
  assert.equal(top.length, 3);
  assert.ok(top.every((job) => job.level >= 60), JSON.stringify(top));
  assert.deepEqual([JOBS.at(-1).min, JOBS.at(-1).max, JOBS.at(-1).level], [100, 300, 100]);

  await client.db.set(getUserLevelKey(guild.id, worker.id), { level: 100, xp: 0, totalXp: 0 });
  await updateEconomySettings(guild.id, (settings) => { settings.commands.work.cooldownMinutes = 60; settings.earningsPercent = 100; });

  const offers = await run('work', worker);
  assert.match(replyText(offers), /Job offers · level 100/);
  assert.match(replyText(offers), /Your server level: \*\*100\*\*/);
  assert.match(replyText(offers), /You can get the best jobs/);
  const buttons = offers.replies.at(-1).components[0].toJSON().components;
  assert.equal(buttons.length, 3);
  // The same offers come back until one is taken.
  const again = await run('work', worker);
  assert.deepEqual(again.replies.at(-1).components[0].toJSON().components.map((b) => b.custom_id), buttons.map((b) => b.custom_id));

  const jobButtons = (await import('../src/interactions/buttons/economy/jobs.js')).default;
  const stranger = press(newMember('Obcy'), buttons[0].custom_id);
  await runWithLocale('en', () => jobButtons.execute(stranger, client, buttons[0].custom_id.split(':').slice(1)));
  assert.match(text(stranger.calls.reply[0]), /for someone else/);

  const click = press(worker, buttons[2].custom_id);
  await runWithLocale('en', () => jobButtons.execute(click, client, buttons[2].custom_id.split(':').slice(1)));
  const [, , , jobId] = buttons[2].custom_id.split(':');
  const job = JOBS.find((entry) => entry.id === jobId);
  assert.match(text(click.calls.update[0]), /You took the job/);
  let account = await data(worker);
  assert.ok(account.wallet >= job.min && account.wallet <= job.max, `${account.wallet} in ${job.min}-${job.max}`);
  assert.deepEqual(account.job, { id: jobId, shiftsLeft: JOB_SHIFTS - 1 });

  // On a break: no second shift without Overtime.
  await assert.rejects(run('work', worker), /cooldown/i);
  // Overtime 1 = 2 shifts in a row.
  await save(worker, { upgrades: { overtime: 1 }, lastWork: 0, workStreak: 0 });
  await run('work', worker);
  const second = await run('work', worker);
  assert.doesNotMatch(replyText(second), /more in a row/);
  await assert.rejects(run('work', worker), /cooldown/i);

  // Finish the contract: the last shift says so and the next /work offers new jobs.
  await save(worker, { job: { id: jobId, shiftsLeft: 1 }, lastWork: 0, workStreak: 0 });
  const last = await run('work', worker);
  assert.match(replyText(last), /Contract finished/);
  account = await data(worker);
  assert.equal(account.job, null);
  assert.match(replyText(await run('work', worker)), /Job offers/);
});

test('items: tiers need the one before, the best one counts, the Discount upgrade lowers every price', async () => {
  const buyer = newMember('Kupiec');
  await save(buyer, { wallet: 100_000, bank: 0 });
  await assert.rejects(run('sklep', buyer, { kup: 'golden_rod' }), (error) => /Buy \*\*.*Carbon Rod/.test(error.userMessage));
  await run('sklep', buyer, { kup: 'fishing_rod' });
  await run('sklep', buyer, { kup: 'carbon_rod' });
  let account = await data(buyer);
  assert.equal(account.wallet, 100_000 - 1500 - 12_000);
  assert.equal(bestInChain(account, 'fish').id, 'carbon_rod');
  assert.equal(purchaseRoom(getItemById('fishing_rod'), account), 0, 'a worse rod is pointless');
  assert.equal(missingRequirement(getItemById('golden_rod'), account), null);
  // An old Golden Rod owner without the middle tier counts as having all below it.
  assert.equal(missingRequirement(getItemById('golden_rod'), { inventory: { golden_rod: 1 } }), null);
  assert.equal(purchaseRoom(getItemById('carbon_rod'), { inventory: { golden_rod: 1 } }), 0);

  // Discount 2 = -10%, also on upgrades, but not on itself.
  assert.equal((await buyUpgrade(client, guild.id, buyer.id, 'discount')).price, upgradePrice(getUpgrade('discount'), 0));
  assert.equal((await buyUpgrade(client, guild.id, buyer.id, 'discount')).price, upgradePrice(getUpgrade('discount'), 1));
  account = await data(buyer);
  assert.equal(upgradeCost(getUpgrade('work'), 0, account), 1800);
  const before = account.wallet;
  await run('sklep', buyer, { kup: 'pen' });
  assert.equal((await data(buyer)).wallet, before - 7200);

  // Lucky Charm: one purchase = 3 uses.
  await run('sklep', buyer, { kup: 'lucky_charm' });
  assert.equal((await data(buyer)).inventory.lucky_charm, 3);
});

test('casino: luck adds points, fewer on big payouts, at most +20; the shown chance is exact', async () => {
  // Points: 40% with luck +25 is 65%; never above 95%.
  assert.ok(Math.abs(applyLuck(0.4, 25) - 0.65) < 1e-12);
  assert.ok(Math.abs(applyLuck(0.4, 3) - 0.43) < 1e-12);
  assert.equal(applyLuck(0.9, 25), 0.95);
  // Bets above x2 get (2/payout)^2 of the points, so a roulette number stays a long shot.
  assert.equal(luckPoints(25, 2), 25);
  assert.ok(Math.abs(luckPoints(9, 3) - 4) < 1e-12);
  assert.ok(luckPoints(25, 36) < 0.1);
  const red = spinRoulette('czerwone', null, 0, () => 0);
  assert.equal(red.base, 18 / 37);
  assert.equal(red.bet.payout, 1.7, "even-money bets pay x1.7 since 2026-10-26");
  assert.equal(red.win, true);
  assert.ok([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].includes(red.result));
  const lost = spinRoulette('liczba', 7, 0, () => 0.99);
  assert.equal(lost.win, false);
  assert.notEqual(lost.result, 7);
  assert.ok(Math.abs(spinRoulette('czerwone', null, 10, () => 0.5).chance - (18 / 37 + 0.1)) < 1e-12);
  assert.ok(Math.abs(spinRoulette('tuzin1', null, 9, () => 0.5).chance - (12 / 37 + 0.04)) < 1e-12);
  assert.ok(spinRoulette('liczba', 7, 25, () => 0.5).chance < 1 / 37 + 0.001);

  const jackpot = spinSlots(0, () => 0);
  assert.deepEqual(jackpot.reels, ['💎', '💎', '💎']);
  const miss = spinSlots(0, () => 0.999);
  assert.equal(miss.outcome, null);
  assert.equal(new Set(miss.reels).size, 3);
  assert.ok(Math.abs(spinSlots(10).chance - (SLOT_BASE_CHANCE + luckPoints(10, SLOT_AVERAGE_PAYOUT) / 100)) < 1e-12);

  // Luck 5 (+5) and the Diamond Clover (+5 since 2026-10-15, not stacked with gold); a Lucky Clover adds +4 once.
  const luck = takeLuck({ upgrades: { luck: 5 }, inventory: { golden_clover: 1, diamond_clover: 1, lucky_clover: 2 } });
  assert.equal(luck.total, 14);
  assert.equal(luck.item.id, 'lucky_clover');
  // Everything at its best: 15 + 5 + 4 = 24, cut to the cap of 20 (owner, 2026-10-26).
  assert.equal(takeLuck({ upgrades: { luck: 15 }, inventory: { golden_clover: 1, diamond_clover: 1, lucky_clover: 1 } }).total, 20);
  assert.equal(takeLuck({ upgrades: { luck: 99 }, inventory: { diamond_clover: 1, lucky_clover: 1, lucky_charm: 3 } }).total, 20);

  const gambler = newMember('Hazardzista');
  await updateEconomySettings(guild.id, (settings) => { settings.commands.gamble = { cooldownMinutes: 0, winPercent: 40, payoutPercent: 200, maxBet: 0 }; });
  await save(gambler, { wallet: 1000, upgrades: { luck: 10 }, inventory: { golden_clover: 1 } });
  const played = await run('gamble', gambler, { amount: 100 });
  assert.match(replyText(played), /Your win chance: 54% · base 40% · luck \+14%/);
  const wallet = (await data(gambler)).wallet;
  assert.ok(wallet === 900 || wallet === 1100, String(wallet));

  const roulette = await run('ruletka', gambler, { stawka: 50, zaklad: 'zielone' });
  assert.match(replyText(roulette), /The ball lands on/);
  assert.match(replyText(roulette), /Your win chance: 2.7%/);
  assert.doesNotMatch(replyText(roulette), /luck \+0/);
  await assert.rejects(run('ruletka', gambler, { stawka: 50, zaklad: 'liczba' }), /number missing/);
  assert.match(replyText(await run('slots', gambler, { stawka: 10 })), /🎰/);
  await assert.rejects(run('slots', gambler, { stawka: 10_000_000 }), /Insufficient cash/);
});

test('blackjack: odds, payouts and a full hand through the buttons', async () => {
  assert.deepEqual(handValue(['A♠', '6♥']), { total: 17, soft: true });
  assert.deepEqual(handValue(['A♠', '6♥', '10♦']), { total: 17, soft: false });
  const odds = dealerOdds('6♣');
  assert.ok(Math.abs(Object.values(odds).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(odds.bust > 0.4 && odds.bust < 0.43, String(odds.bust));
  assert.ok(standOdds(['10♠', 'K♥'], '6♣').win > 0.75);
  assert.equal(standOdds(['10♠', 'K♥', '5♦'], '6♣').win, 0);
  assert.equal(bustChance(['10♠', '2♥']), 4 / 13);
  assert.ok(bustChance(['10♠', '2♥'], 50) < 4 / 13);
  assert.deepEqual(settle({ bet: 100, player: ['A♠', 'K♥'], dealer: ['9♠', '9♥'] }), { outcome: 'blackjack', payout: 250, player: 21, dealer: 18 });
  assert.equal(settle({ bet: 100, player: ['10♠', '9♥'], dealer: ['10♠', '9♦'] }).outcome, 'push');
  // A normal win pays x1.7 since 2026-10-26 (owner: the casino pays x1.7), a blackjack still 3:2.
  assert.equal(settle({ bet: 100, player: ['10♠', '9♥'], dealer: ['10♠', '7♦'] }).payout, 170);

  const player = newMember('Karciarz');
  await save(player, { wallet: 1000, lastGamble: 0 });
  const start = await run('blackjack', player, { stawka: 200 });
  const buttons = (await import('../src/interactions/buttons/economy/blackjack.js')).default;
  let account = await data(player);
  if (account.blackjack) {
    assert.equal(account.wallet, 800, 'the bet is taken at the start');
    assert.match(replyText(start), /If you stand now: \d+(\.\d)?% win/);
    const stand = press(player, `bj:stoj:${player.id}`);
    await runWithLocale('en', () => buttons.execute(stand, client, ['stoj', player.id]));
    assert.match(text(stand.calls.update[0]), /Your win chance when you stood/);
  }
  account = await data(player);
  assert.equal(account.blackjack, null);
  assert.ok([800, 1000, 1140, 1300].includes(account.wallet), String(account.wallet));

  const gone = press(player, `bj:dobierz:${player.id}`);
  await runWithLocale('en', () => buttons.execute(gone, client, ['dobierz', player.id]));
  assert.match(text(gone.calls.followUp[0]), /game is over/);
});

test('/hajs and /balans answer the same', async () => {
  const rich = newMember('Bogacz');
  await save(rich, { wallet: 1234, bank: 50 });
  const a = replyText(await run('hajs', rich));
  const b = replyText(await run('balans', rich));
  assert.equal(a.replace(/Requested by .*/, ''), b.replace(/Requested by .*/, ''));
  assert.match(a, /\$1,234/);
  assert.ok(!client.commands.has('balance'));
  assert.equal(client.commands.get('sklep').data.toJSON().options.some((option) => option.type === 1), false, '/sklep has no subcommands');
});
