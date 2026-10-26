// /napad (2026-10-26): a lobby with invites, a crew big enough for the target, one shared roll,
// gear paid at the start, loot per person or jail for everyone.
import './helpers/env.js';
import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { mockChannel, mockGuild, mockInteraction, mockMember, mockUser, replyText, snowflake } from './helpers/mock.js';
import { runWithLocale } from '../src/i18n/index.js';
import { initializeDatabase } from '../src/utils/database.js';
import { loadCommands } from '../src/handlers/loaders/commandLoader.js';
import { getEconomyData, setEconomyData } from '../src/utils/economy.js';
import { updateEconomySettings } from '../src/services/economySettings.js';
import {
  CREW_BONUS, getLobby, heistChance, heistTiming, getTarget, resetHeists, startHeist,
} from '../src/commands/Economy/modules/heist.js';
import heistButtons from '../src/interactions/buttons/economy/heist.js';
import heistMenu from '../src/interactions/selectMenus/economy/heist.js';

const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null } };
let guild;
let channel;

before(async () => {
  const { db } = await initializeDatabase();
  client.db = db;
  await loadCommands(client);
  heistTiming.suspenseMs = 0;
  guild = mockGuild(client, 'Napady');
  channel = mockChannel(guild, 'ekonomia');
  await updateEconomySettings(guild.id, (settings) => {
    settings.currency = { symbol: '$', position: 'left', separator: ',' };
    settings.commands.crime.jailMinutes = 120;
  });
});

beforeEach(() => resetHeists());

const newMember = (name) => mockMember(guild, mockUser(name));
const data = (member) => getEconomyData(client, guild.id, member.id);
const save = async (member, patch) => setEconomyData(client, guild.id, member.id, { ...(await data(member)), ...patch });

async function open(member, options) {
  const interaction = mockInteraction({ client, guild, channel, member, commandName: 'napad', options });
  await runWithLocale('en', () => client.commands.get('napad').execute(interaction, {}, client))
    .catch((error) => interaction.replies.push({ content: error.userMessage ?? error.message }));
  return interaction.replies.at(-1);
}

function press(member, customId, extra = {}) {
  const calls = { reply: [], update: [], followUp: [], editReply: [] };
  return {
    calls, id: snowflake(), client, guild, guildId: guild.id, channel, channelId: channel.id, member, user: member.user,
    customId, replied: false, deferred: false, message: null, ...extra,
    reply: async (payload) => { calls.reply.push(payload); },
    update: async (payload) => { calls.update.push(payload); },
    followUp: async (payload) => { calls.followUp.push(payload); },
    editReply: async (payload) => { calls.editReply.push(payload); },
  };
}
const click = async (member, customId) => {
  const interaction = press(member, customId);
  await runWithLocale('en', () => heistButtons.execute(interaction, client, customId.split(':').slice(1)));
  return interaction.calls;
};
const lobbyId = (payload) => payload.components[0].toJSON().components[0].custom_id.split(':')[2];
const json = (payload) => JSON.stringify(payload.embeds.map((embed) => (embed.toJSON ? embed.toJSON() : embed)));
const buttons = (payload) => payload.components[0].toJSON().components.map((button) => `${button.custom_id.split(':')[1]}${button.disabled ? '(off)' : ''}`);

test('chance grows with the crew and stops at the cap', () => {
  const bank = getTarget('bank');
  assert.equal(heistChance(bank, 3), bank.chance);
  assert.equal(heistChance(bank, 4), bank.chance + CREW_BONUS);
  assert.equal(heistChance(getTarget('sklep'), 50), 85);
});

test('lobby: invites ping the invited, invite-only lobbies refuse others, start waits for the minimum crew', async () => {
  const [ola, kuba, ania, obcy] = ['Ola', 'Kuba', 'Ania', 'Obcy'].map(newMember);
  for (const member of [ola, kuba, ania, obcy]) await save(member, { wallet: 10_000, bank: 0, cooldowns: {} });

  const lobby = await open(ola, { cel: 'bank', tylko_zaproszeni: true });
  assert.match(json(lobby), /Heist: Club bank/);
  assert.match(json(lobby), /Needs at least \*\*3\*\* people - \*\*2\*\* more/);
  assert.deepEqual(buttons(lobby), ['dolacz', 'zapros', 'start(off)', 'wyjdz']);
  const id = lobbyId(lobby);

  // Only the leader invites; the picker is private.
  assert.match(json((await click(kuba, `napad:zapros:${id}`)).reply[0]), /Only the leader invites/);
  const picker = (await click(ola, `napad:zapros:${id}`)).reply[0];
  assert.equal(picker.flags, 64);
  assert.equal(picker.components[0].toJSON().components[0].custom_id, `napad:kogo:${id}`);

  // Picking people: they are pinged in the channel and listed on the lobby.
  const lobbyMessage = { id: 'm1', channel, edits: [], edit: async (payload) => { lobbyMessage.edits.push(payload); } };
  getLobby(id).message = lobbyMessage;
  const sent = channel.sent.length;
  const pick = press(ola, `napad:kogo:${id}`, { users: new Collection([[kuba.id, kuba.user], [ania.id, ania.user]]) });
  await runWithLocale('en', () => heistMenu.execute(pick, client, ['kogo', id]));
  const ping = channel.sent.at(-1);
  assert.equal(channel.sent.length, sent + 1);
  assert.match(ping.content, new RegExp(`<@${kuba.id}> <@${ania.id}> \\*\\*Ola\\*\\* invites you to a heist`));
  assert.deepEqual(ping.allowedMentions, { users: [kuba.id, ania.id] });
  assert.equal(ping.reply.messageReference, 'm1');
  assert.match(json(lobbyMessage.edits.at(-1)), /Invited/);
  assert.match(pick.calls.update[0].content, /Invited/);

  // Not invited: refused privately; invited: in.
  assert.match(json((await click(obcy, `napad:dolacz:${id}`)).reply[0]), /invite-only/);
  await click(kuba, `napad:dolacz:${id}`);
  const two = await click(ania, `napad:dolacz:${id}`);
  assert.deepEqual(buttons(two.update[0]), ['dolacz', 'zapros', 'start', 'wyjdz']);
  assert.match(json(two.update[0]), /Crew 3\/5/);

  // Only the leader starts.
  assert.match(json((await click(kuba, `napad:start:${id}`)).reply[0]), /Only the leader starts/);
  // A member leaves, the leader cancels.
  assert.match(json((await click(ania, `napad:wyjdz:${id}`)).update[0]), /Crew 2\/5/);
  const cancelled = await click(ola, `napad:wyjdz:${id}`);
  assert.match(json(cancelled.update[0]), /called it off/);
  assert.equal(getLobby(id), null);
});

test('success: everyone pays the gear, gets the loot per person and a break; nobody can rejoin during it', async () => {
  const [a, b] = ['Szef', 'Pomocnik'].map(newMember);
  await save(a, { wallet: 2000, bank: 0, cooldowns: {} });
  await save(b, { wallet: 200, bank: 2000, cooldowns: {} });
  const lobby = await open(a, { cel: 'kantor' });
  const id = lobbyId(lobby);
  await click(b, `napad:dolacz:${id}`);

  const target = getTarget('kantor');
  const outcome = await startHeist({ client, lobby: getLobby(id), now: Date.now(), random: () => 0 });
  assert.equal(outcome.started, true);
  assert.equal(outcome.success, true);
  assert.match(json(outcome.result), /clean getaway/);
  const [da, db] = [await data(a), await data(b)];
  assert.equal(da.wallet, 2000 - target.gear + target.loot[0]);
  assert.equal(db.wallet + db.bank, 2200 - target.gear + target.loot[0], 'gear from cash first, then the bank');
  assert.ok(da.cooldowns.heist > 0);
  assert.equal(getLobby(id), null);

  const again = await open(a, { cel: 'sklep' });
  assert.match(replyText({ replies: [again] }), /break for \d+ more min/);
});

test('busted: gear lost and the whole crew in jail; a member who cannot pay stays home', async () => {
  const [a, b, c] = ['Boss', 'Ziomek', 'Biedak'].map(newMember);
  await save(a, { wallet: 5000, bank: 0, cooldowns: {}, jailedUntil: 0 });
  await save(b, { wallet: 5000, bank: 0, cooldowns: {}, jailedUntil: 0 });
  await save(c, { wallet: 5000, bank: 0, cooldowns: {}, jailedUntil: 0 });
  const lobby = await open(a, { cel: 'sklep' });
  const id = lobbyId(lobby);
  await click(b, `napad:dolacz:${id}`);
  await click(c, `napad:dolacz:${id}`);
  await save(c, { wallet: 100 }); // spent it before the start

  const now = Date.now();
  const outcome = await startHeist({ client, lobby: getLobby(id), now, random: () => 0.99 });
  assert.equal(outcome.success, false);
  assert.match(json(outcome.result), /busted/);
  assert.match(json(outcome.result), /Stayed home/);
  const gear = getTarget('sklep').gear;
  for (const member of [a, b]) {
    const after = await data(member);
    assert.equal(after.wallet, 5000 - gear);
    assert.equal(after.jailedUntil, now + 120 * 60_000);
  }
  assert.equal((await data(c)).wallet, 100, 'the one who stayed home paid nothing');
  assert.ok(!(await data(c)).jailedUntil);
});

test('start through the button shows the result; a crew too small after the check stays open', async () => {
  const [a, b, c] = ['Lider', 'Druga', 'Trzeci'].map(newMember);
  for (const member of [a, b, c]) await save(member, { wallet: 9000, bank: 0, cooldowns: {}, jailedUntil: 0 });
  const lobby = await open(a, { cel: 'bank' });
  const id = lobbyId(lobby);
  await click(b, `napad:dolacz:${id}`);
  await click(c, `napad:dolacz:${id}`);
  await save(c, { jailedUntil: Date.now() + 60_000 });

  const tooSmall = await click(a, `napad:start:${id}`);
  assert.match(json(tooSmall.update[0]), /Not enough people can go/);
  assert.match(json(tooSmall.update[0]), /in jail/);
  assert.ok(getLobby(id), 'the lobby is still open');
  assert.equal((await data(a)).wallet, 9000, 'nobody paid');

  await save(c, { jailedUntil: 0 });
  await click(c, `napad:dolacz:${id}`);
  const done = await click(a, `napad:start:${id}`);
  assert.match(json(done.update[0]), /clean getaway|busted/);
  assert.deepEqual(done.update[0].components, []);
});
