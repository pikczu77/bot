// /wymiana (2026-10-26): cards and money between two members, accepted by the partner only,
// checked again at the moment of the swap.
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
import { cardChoices } from '../src/commands/Economy/modules/trade.js';
import tradeButtons from '../src/interactions/buttons/economy/trade.js';

const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null } };
let guild;
let channel;

before(async () => {
  const { db } = await initializeDatabase();
  client.db = db;
  await loadCommands(client);
  guild = mockGuild(client, 'Wymiany');
  channel = mockChannel(guild, 'handel');
  await updateEconomySettings(guild.id, (settings) => {
    settings.currency = { symbol: '$', position: 'left', separator: ',' };
  });
});

const newMember = (name) => mockMember(guild, mockUser(name));
const data = (member) => getEconomyData(client, guild.id, member.id);
const save = async (member, patch) => setEconomyData(client, guild.id, member.id, { ...(await data(member)), ...patch });

async function run(member, options) {
  const interaction = mockInteraction({ client, guild, channel, member, commandName: 'wymiana', options });
  await runWithLocale('en', () => client.commands.get('wymiana').execute(interaction, {}, client));
  return interaction.replies.at(-1);
}

function press(member, customId) {
  const calls = { reply: [], update: [], followUp: [] };
  const interaction = {
    calls, id: snowflake(), client, guild, guildId: guild.id, channel, channelId: channel.id, member, user: member.user,
    customId, replied: false, deferred: false,
    reply: async (payload) => { calls.reply.push(payload); },
    update: async (payload) => { calls.update.push(payload); },
    followUp: async (payload) => { calls.followUp.push(payload); },
  };
  return interaction;
}
const click = async (member, customId) => {
  const interaction = press(member, customId);
  await runWithLocale('en', () => tradeButtons.execute(interaction, client, customId.split(':').slice(1)));
  return interaction.calls;
};
const says = (pattern) => (error) => pattern.test(error.userMessage ?? error.message);
const offerId = (payload) => payload.components[0].toJSON().components[0].custom_id.split(':')[2];

test('a card for a card plus money: only the partner accepts, everything moves at once', async () => {
  const anna = newMember('Anna');
  const bartek = newMember('Bartek');
  await save(anna, { wallet: 1000, bank: 500, cards: { iwi: 1, bulwazaur: 3 } });
  await save(bartek, { wallet: 0, cards: { 'czaryzard:golden': 1 } });

  // Autocomplete: own cards for "daje", the partner's for "chce".
  assert.deepEqual(cardChoices(await data(anna)).map((choice) => choice.value), ['iwi', 'bulwazaur']);
  assert.match(cardChoices(await data(bartek))[0].name, /Czaryzard \(.+\) ×1/);

  const offer = await run(anna, { osoba: bartek.user, daje: 'iwi', chce: 'czaryzard:golden', doplacam: 1200 });
  const text = replyText({ replies: [offer] });
  assert.match(text, /Trade offer/);
  assert.match(text, /Iwi/);
  assert.match(text, /\$1,200/);
  assert.match(text, /last copy/);
  assert.equal(offer.content, `<@${bartek.id}>`);
  const id = offerId(offer);

  const stranger = newMember('Obcy');
  assert.match(replyText({ replies: (await click(stranger, `wymiana:ok:${id}`)).reply }), /not for you/);
  assert.match(replyText({ replies: (await click(anna, `wymiana:ok:${id}`)).reply }), /not for you/);

  const done = await click(bartek, `wymiana:ok:${id}`);
  assert.match(replyText({ replies: done.update }), /Trade done/);
  const a = await data(anna);
  const b = await data(bartek);
  assert.equal(a.cards.iwi, 0);
  assert.equal(a.cards['czaryzard:golden'], 1);
  assert.equal(b.cards.iwi, 1);
  assert.equal(b.cards['czaryzard:golden'], 0);
  assert.equal(a.wallet + a.bank, 300, 'cash first, then the bank');
  assert.equal(a.wallet, 0);
  assert.equal(b.wallet, 1200);
  assert.equal(a.stats?.trades ?? 0, 0, 'progress is off in the test run');

  // The same offer cannot be accepted twice.
  const again = await click(bartek, `wymiana:ok:${id}`);
  assert.match(replyText({ replies: again.followUp }), /expired/);
});

test('offers are checked twice: when made and when accepted', async () => {
  const celina = newMember('Celina');
  const darek = newMember('Darek');
  await save(celina, { wallet: 100, cards: { miau: 1 } });
  await save(darek, { wallet: 5000, cards: {} });

  await assert.rejects(run(celina, { osoba: darek.user, chce: 'miau' }), says(/no longer has/));
  await assert.rejects(run(celina, { osoba: darek.user, doplacam: 500 }), says(/does not have/));
  await assert.rejects(run(celina, { osoba: celina.user, daje: 'miau' }), says(/another member/));
  await assert.rejects(run(celina, { osoba: darek.user }), says(/Add a card or money/));
  await assert.rejects(run(celina, { osoba: darek.user, doplacam: 10, chce_kasy: 10 }), says(/only one way/));
  await assert.rejects(run(celina, { osoba: darek.user, daje: 'nieistnieje' }), says(/from the list/));

  const offer = await run(celina, { osoba: darek.user, daje: 'miau', chce_kasy: 4000 });
  const id = offerId(offer);
  await save(celina, { cards: {} }); // sold the card in the meantime
  const failed = await click(darek, `wymiana:ok:${id}`);
  assert.match(replyText({ replies: failed.update }), /Trade failed/);
  assert.equal((await data(darek)).wallet, 5000, 'nothing moved');

  const second = offerId(await run(darek, { osoba: celina.user, doplacam: 100 }));
  assert.match(replyText({ replies: (await click(celina, `wymiana:anuluj:${second}`)).reply }), /Only the author/);
  assert.match(replyText({ replies: (await click(darek, `wymiana:anuluj:${second}`)).update }), /withdrawn/);
  const third = offerId(await run(darek, { osoba: celina.user, doplacam: 100 }));
  assert.match(replyText({ replies: (await click(celina, `wymiana:nie:${third}`)).update }), /declined/);
  assert.equal((await data(celina)).wallet, 100);
});
