// Weekly lottery, /pojedynek and the /daily streak chest (2026-10-26).
import './helpers/env.js';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { mockChannel, mockGuild, mockInteraction, mockMember, mockUser, replyText, snowflake } from './helpers/mock.js';
import { runWithLocale } from '../src/i18n/index.js';
import { initializeDatabase } from '../src/utils/database.js';
import { loadCommands } from '../src/handlers/loaders/commandLoader.js';
import { getEconomyData, setEconomyData } from '../src/utils/economy.js';
import { updateEconomySettings } from '../src/services/economySettings.js';
import { drawLottery, getLottery, nextDrawTime, pickWinner, updateLottery } from '../src/services/lottery.js';
import { daysToChest, nextStreak, openStreakChest } from '../src/services/dailyStreak.js';
import { winnerOf } from '../src/commands/Economy/modules/duel.js';
import duelButtons from '../src/interactions/buttons/economy/duel.js';

const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null } };
let guild;
let channel;
let settings;

before(async () => {
  const { db } = await initializeDatabase();
  client.db = db;
  await loadCommands(client);
  guild = mockGuild(client, 'Gry');
  channel = mockChannel(guild, 'gry');
  settings = await updateEconomySettings(guild.id, (data) => {
    data.currency = { symbol: '$', position: 'left', separator: ',' };
    data.commands.daily = { amount: 100, cooldownMinutes: 1440 };
  });
});

const newMember = (name) => mockMember(guild, mockUser(name));
const data = (member) => getEconomyData(client, guild.id, member.id);
const save = async (member, patch) => setEconomyData(client, guild.id, member.id, { ...(await data(member)), ...patch });
async function run(commandName, member, options = {}, subcommand = null) {
  const interaction = mockInteraction({ client, guild, channel, member, commandName, options, subcommand });
  await runWithLocale('en', () => client.commands.get(commandName).execute(interaction, {}, client));
  return interaction.replies.at(-1);
}
const says = (pattern) => (error) => pattern.test(error.userMessage ?? error.message);

test('lottery draw: Sunday 20:00 Polish time, winter and summer', () => {
  assert.equal(new Date(nextDrawTime(Date.UTC(2026, 9, 26, 10))).toISOString(), '2026-11-01T19:00:00.000Z');
  assert.equal(new Date(nextDrawTime(Date.UTC(2026, 10, 1, 19, 1))).toISOString(), '2026-11-08T19:00:00.000Z');
  assert.equal(new Date(nextDrawTime(Date.UTC(2026, 6, 5, 17))).toISOString(), '2026-07-05T18:00:00.000Z');
  assert.equal(pickWinner({ a: 1, b: 3 }, () => 0), 'a');
  assert.equal(pickWinner({ a: 1, b: 3 }, () => 0.5), 'b');
});

test('/loteria: buy tickets, a limit per week, the draw pays the whole pot and starts a new round', async () => {
  await updateLottery(guild.id, (lottery) => Object.assign(lottery, { ticketPrice: 100, maxTickets: 5, bonus: 1000, channelId: channel.id, round: null }));
  const ola = newMember('Ola');
  const kuba = newMember('Kuba');
  await save(ola, { wallet: 1000, bank: 0 });
  await save(kuba, { wallet: 50, bank: 500 });
  const reply = await run('loteria', ola, { ilosc: 3 }, 'kup');
  assert.match(replyText({ replies: [reply] }), /You bought \*\*3\*\* tickets/);
  assert.match(replyText({ replies: [reply] }), /Pot:\*\* \$1,300/);
  assert.equal((await data(ola)).wallet, 700);
  await run('loteria', ola, { ilosc: 10 }, 'kup');
  assert.equal((await getLottery(guild.id)).round.tickets[ola.id], 5, 'only up to the weekly limit');
  await assert.rejects(run('loteria', ola, { ilosc: 1 }, 'kup'), says(/most tickets/));
  await run('loteria', kuba, { ilosc: 1 }, 'kup');
  assert.equal((await data(kuba)).bank, 450, 'cash first, then the bank');
  assert.match(replyText({ replies: [await run('loteria', kuba, {}, 'info')] }), /Your tickets:\*\* 1\/5 · chance \*\*17%\*\*/);

  const drawAt = (await getLottery(guild.id)).round.drawAt;
  assert.equal(await drawLottery(client, guild, drawAt - 1000), null, 'not before Sunday 20:00');
  const before = channel.sent.length;
  const result = await runWithLocale('en', () => drawLottery(client, guild, drawAt + 1000, () => 0.9));
  assert.equal(result.winnerId, kuba.id, 'the last ticket');
  assert.equal(result.pot, 1600);
  assert.equal((await data(kuba)).wallet, 1600);
  assert.equal(channel.sent.length, before + 1);
  assert.match(channel.sent.at(-1).embeds[0].toJSON().description, /wins \*\*\$1,600\*\*/);
  const next = await getLottery(guild.id);
  assert.deepEqual(next.round.tickets, {});
  assert.ok(next.round.drawAt > drawAt);
  assert.equal(next.last.winnerId, kuba.id);
});

test('duel rules: rock beats scissors, scissors paper, paper rock', () => {
  assert.equal(winnerOf('r', 's'), 'a');
  assert.equal(winnerOf('s', 'r'), 'b');
  assert.equal(winnerOf('p', 'r'), 'a');
  assert.equal(winnerOf('s', 'p'), 'a');
  assert.equal(winnerOf('r', 'r'), null);
});

function press(member, customId) {
  const calls = { reply: [], update: [], edit: [] };
  const interaction = {
    calls, id: snowflake(), client, guild, guildId: guild.id, channel, channelId: channel.id, member, user: member.user, customId,
    message: { edit: async (payload) => { calls.edit.push(payload); } },
    reply: async (payload) => { calls.reply.push(payload); },
    update: async (payload) => { calls.update.push(payload); },
    followUp: async (payload) => { calls.reply.push(payload); },
  };
  return interaction;
}
const click = async (member, customId) => {
  const interaction = press(member, customId);
  await runWithLocale('en', () => duelButtons.execute(interaction, client, customId.split(':').slice(1)));
  return interaction.calls;
};

test('/pojedynek: only the challenged accepts, picks stay hidden, a tie replays, the loser pays', async () => {
  const ania = newMember('Ania');
  const bartek = newMember('Bartek');
  await save(ania, { wallet: 1000, bank: 0 });
  await save(bartek, { wallet: 300, bank: 200 });
  await assert.rejects(run('pojedynek', ania, { osoba: bartek.user, kwota: 600 }), says(/does not have/));
  const challenge = await run('pojedynek', ania, { osoba: bartek.user, kwota: 400 });
  assert.equal(challenge.content, `<@${bartek.id}>`);
  const id = challenge.components[0].toJSON().components[0].custom_id.split(':')[2];

  assert.match(replyText({ replies: (await click(ania, `pojedynek:ok:${id}`)).reply }), /Only the challenged/);
  const accepted = await click(bartek, `pojedynek:ok:${id}`);
  assert.match(replyText({ replies: accepted.update }), /Pick a move/);

  const first = await click(ania, `pojedynek:pick:${id}:r`);
  assert.match(replyText({ replies: first.reply }), /You picked ✊/);
  assert.ok(!/✊/.test(replyText({ replies: first.edit })), 'the channel does not see the move');
  const tie = await click(bartek, `pojedynek:pick:${id}:r`);
  assert.match(replyText({ replies: tie.update }), /tie! Another round/);

  await click(ania, `pojedynek:pick:${id}:p`);
  const done = await click(bartek, `pojedynek:pick:${id}:r`);
  assert.match(replyText({ replies: done.update }), /Ania\*\* wins \*\*\$400\*\*/);
  assert.equal((await data(ania)).wallet, 1400);
  const loser = await data(bartek);
  assert.equal(loser.wallet + loser.bank, 100, 'cash first, then the bank');
  assert.match(replyText({ replies: (await click(bartek, `pojedynek:pick:${id}:s`)).reply }), /over/);
});

test('/pojedynek: declining, withdrawing, a stranger cannot press', async () => {
  const c = newMember('Celina');
  const d = newMember('Darek');
  const e = newMember('Ewa');
  await save(c, { wallet: 500 });
  await save(d, { wallet: 500 });
  let id = (await run('pojedynek', c, { osoba: d.user, kwota: 100 })).components[0].toJSON().components[0].custom_id.split(':')[2];
  assert.match(replyText({ replies: (await click(e, `pojedynek:nie:${id}`)).reply }), /not for you/);
  assert.match(replyText({ replies: (await click(d, `pojedynek:nie:${id}`)).update }), /declined/);
  id = (await run('pojedynek', c, { osoba: d.user, kwota: 100 })).components[0].toJSON().components[0].custom_id.split(':')[2];
  assert.match(replyText({ replies: (await click(c, `pojedynek:nie:${id}`)).update }), /withdrawn/);
  await assert.rejects(run('pojedynek', c, { osoba: c.user, kwota: 100 }), says(/another member/));
});

test('/daily streak: days in a row, a missed day starts again, a chest every 7th day', async () => {
  const DAY = 86_400_000;
  assert.equal(nextStreak(0, 0, DAY * 10, DAY), 1);
  assert.equal(nextStreak(3, DAY * 10, DAY * 11.5, DAY), 4);
  assert.equal(nextStreak(3, DAY * 10, DAY * 12.1, DAY), 1, 'more than two days: from 1');
  assert.equal(daysToChest(5), 2);
  assert.equal(daysToChest(7), 7);

  const member = { wallet: 0, inventory: {} };
  const chest = openStreakChest(member, settings, 100, () => 0.8);
  assert.equal(chest.money, 300);
  assert.equal(chest.item, 'lucky_clover');
  assert.equal(member.inventory.lucky_clover, 2);
  const packChest = openStreakChest({ wallet: 0 }, settings, 100, () => 0);
  assert.equal(packChest.pack.id, 'startowa');

  const player = newMember('Codzienny');
  await save(player, { wallet: 0, dailyStreak: 6, lastDaily: Date.now() - 25 * 3_600_000 });
  const reply = await run('daily', player);
  const text = replyText({ replies: [reply] });
  assert.match(text, /7 days in a row/);
  assert.match(text, /Chest for 7 days in a row/);
  const after = await data(player);
  assert.equal(after.dailyStreak, 7);
  assert.ok(after.wallet >= 400, 'daily 100 + chest 300');
});
