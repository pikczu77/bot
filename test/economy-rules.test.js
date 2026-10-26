// Economy changes of 2026-10-14 evening: the Fortune upgrade (+10% of every payout per level),
// Stamina on every earning command and the casino, jail that locks earning, and the
// /economy poradnik guide with its topic menu.
import './helpers/env.js';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { Collection, MessageFlags } from 'discord.js';
import { mockChannel, mockGuild, mockInteraction, mockMember, mockUser, replyText, snowflake } from './helpers/mock.js';
import { handleInteractionError } from '../src/utils/errorHandler.js';
import { runWithLocale } from '../src/i18n/index.js';
import { initializeDatabase } from '../src/utils/database.js';
import { loadCommands } from '../src/handlers/loaders/commandLoader.js';
import { getEconomyData, setEconomyData } from '../src/utils/economy.js';
import { earningsLine, getEconomySettings, scaleEarnings, updateEconomySettings } from '../src/services/economySettings.js';
import { getUpgrade, staminaCooldown, upgradePrice } from '../src/services/economyUpgrades.js';
import { GUIDE_TOPICS, GUIDE_VERSION, refreshEconomyGuides } from '../src/commands/Economy/modules/economy_guide.js';

const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null } };
let guild;
let channel;

before(async () => {
  const { db } = await initializeDatabase();
  client.db = db;
  await loadCommands(client);
  guild = mockGuild(client, 'Zasady');
  channel = mockChannel(guild, 'ekonomia');
  await updateEconomySettings(guild.id, (settings) => {
    settings.currency = { symbol: '$', position: 'left', separator: ',' };
    settings.earningsPercent = 100;
  });
});

const newMember = (name) => mockMember(guild, mockUser(name));
const data = (member) => getEconomyData(client, guild.id, member.id);
const save = async (member, patch) => setEconomyData(client, guild.id, member.id, { ...(await data(member)), ...patch });

const text = (payload) => replyText({ replies: [payload] });

async function run(commandName, member, options = {}, subcommand = null) {
  const interaction = mockInteraction({ client, guild, channel, member, commandName, subcommand, options });
  await runWithLocale('en', () => client.commands.get(commandName).execute(interaction, {}, client));
  return interaction;
}

test('Fortune: 5 expensive levels, +10% of every payout each, on top of the server multiplier', async () => {
  const fortune = getUpgrade('fortune');
  assert.equal(fortune.maxLevel, 5);
  assert.deepEqual([0, 1, 2, 3, 4].map((level) => upgradePrice(fortune, level)), [25_000, 50_000, 100_000, 200_000, 400_000]);
  assert.equal(getUpgrade('luck').maxLevel, 15);
  assert.equal(getUpgrade('stamina').maxLevel, 10);

  assert.equal(scaleEarnings({ earningsPercent: 100 }, 1000), 1000);
  assert.equal(scaleEarnings({ earningsPercent: 100 }, 1000, { upgrades: { fortune: 5 } }), 1500);
  assert.equal(scaleEarnings({ earningsPercent: 150 }, 1000, { upgrades: { fortune: 2 } }), 1800);
  assert.equal(scaleEarnings({ earningsPercent: 100 }, 1000, { upgrades: { fortune: 9 } }), 1500, 'capped at level 5');
  assert.match(earningsLine({ earningsPercent: 100 }, { upgrades: { fortune: 2 } }), /Fortune 2\/5:\*\* \+20% all earnings/);

  const miner = newMember('Gornik');
  await updateEconomySettings(guild.id, (settings) => { settings.commands.mine = { min: 100, max: 100, cooldownMinutes: 60 }; });
  await save(miner, { wallet: 0, inventory: { pickaxe: 1 }, upgrades: { fortune: 2 } });
  const random = Math.random;
  Math.random = () => 0.6; // uncommon video: x0.8
  let mined;
  try { mined = await run('nagraj', miner); } finally { Math.random = random; }
  assert.match(replyText(mined), /Fortune 2\/5/);
  assert.equal((await data(miner)).wallet, 96);
});

test('Stamina: -5% a level, -50% at 10, on /crime, /slut, /rob and the casino too', async () => {
  assert.equal(staminaCooldown({ upgrades: { stamina: 10 } }, 60 * 60_000), 30 * 60_000);
  assert.equal(staminaCooldown({ upgrades: { stamina: 4 } }, 100_000), 80_000);

  const now = Date.now();
  await updateEconomySettings(guild.id, (settings) => {
    settings.commands.crime.cooldownMinutes = 60;
    settings.commands.crime.jailMinutes = 0;
    settings.commands.slut.cooldownMinutes = 60;
    settings.commands.rob.cooldownMinutes = 60;
    settings.commands.rob.minVictimCash = 0;
    settings.commands.gamble = { cooldownMinutes: 10, winPercent: 50, payoutPercent: 200, maxBet: 0 };
  });

  const fit = newMember('Wysportowany');
  const victim = newMember('Ofiara');
  await save(victim, { wallet: 1000 });
  await save(fit, {
    wallet: 10_000, upgrades: { stamina: 10 },
    cooldowns: { crime: now - 31 * 60_000 }, lastSlut: now - 31 * 60_000, lastRob: now - 31 * 60_000, lastGamble: now - 6 * 60_000,
  });
  await run('crime', fit, { type: 'pickpocketing' });
  await run('slut', fit);
  await run('rob', fit, { user: victim.user });
  await run('gamble', fit, { amount: 10 });

  // Without Stamina the same waits are still too short.
  const tired = newMember('Zmeczony');
  await save(tired, { wallet: 10_000, cooldowns: { crime: now - 31 * 60_000 }, lastRob: now - 31 * 60_000, lastGamble: now - 6 * 60_000 });
  await assert.rejects(run('crime', tired, { type: 'pickpocketing' }), /cooldown/i);
  await assert.rejects(run('rob', tired, { user: victim.user }), /cooldown/i);
  await assert.rejects(run('gamble', tired, { amount: 10 }), /cooldown/i);
});

test('jail: no work, earning or casino; /daily still works; Stamina does not shorten it', async () => {
  const prisoner = newMember('Wiezien');
  await save(prisoner, { wallet: 5000, inventory: { pickaxe: 1, fishing_rod: 1 }, upgrades: { stamina: 10 }, jailedUntil: Date.now() + 60 * 60_000 });
  for (const [command, options] of [['work', {}], ['nagraj', {}], ['fish', {}], ['beg', {}], ['crime', { type: 'pickpocketing' }], ['slut', {}], ['gamble', { amount: 10 }], ['slots', { stawka: 10 }]]) {
    await assert.rejects(run(command, prisoner, options), /jail/i, command);
  }
  const daily = await run('daily', prisoner);
  assert.match(replyText(daily), /\$/);

  await save(prisoner, { jailedUntil: Date.now() - 1000 });
  await run('beg', prisoner);
});

test('bail: 2,000 by default, button under every jail message, cash first then bank, 0 turns it off', async () => {
  const bailButton = (await import('../src/interactions/buttons/economy/jail.js')).default;
  const press = (member, message = null) => {
    const calls = { reply: [], update: [] };
    return {
      calls, id: snowflake(), client, guild, guildId: guild.id, channel, channelId: channel.id, member, user: member.user,
      customId: 'wiezienie:wykup', message, createdTimestamp: Date.now(),
      reply: async (payload) => { calls.reply.push(payload); },
      update: async (payload) => { calls.update.push(payload); },
    };
  };
  const click = (interaction) => runWithLocale('en', () => bailButton.execute(interaction, client, ['wykup']));
  const buttonIds = (payload) => (payload.components ?? []).flatMap((row) => (row.toJSON ? row.toJSON() : row).components.map((b) => b.custom_id));

  assert.equal((await getEconomySettings(guild.id)).commands.crime.bailPrice, 2000);
  await updateEconomySettings(guild.id, (settings) => { settings.commands.crime.jailMinutes = 120; });

  // A failed /crime offers bail right away.
  const thief = newMember('Zlodziej');
  await save(thief, { wallet: 100 });
  const random = Math.random;
  Math.random = () => 0;
  let caught;
  try { caught = await run('crime', thief, { type: 'pickpocketing' }); } finally { Math.random = random; }
  assert.match(replyText(caught), /Crime Failed[\s\S]*bail costs \*\*\$2,000\*\*/);
  assert.deepEqual(buttonIds(caught.replies.at(-1)), ['wiezienie:wykup']);
  assert.ok((await data(thief)).jailedUntil > Date.now(), 'in jail after the failed crime');

  // Every jail message carries the button; the error handler sends it with the embed.
  const prisoner = newMember('Kaucja');
  await save(prisoner, { wallet: 500, bank: 1000, inventory: { pickaxe: 1 }, jailedUntil: Date.now() + 60 * 60_000 });
  let jailError;
  await assert.rejects(run('nagraj', prisoner), (error) => { jailError = error; return true; });
  assert.match(jailError.userMessage, /bail costs \*\*\$2,000\*\*/);
  assert.deepEqual(buttonIds(jailError.context), ['wiezienie:wykup']);
  const shown = mockInteraction({ client, guild, channel, member: prisoner, commandName: 'nagraj' });
  await runWithLocale('en', () => handleInteractionError(shown, jailError));
  assert.deepEqual(buttonIds(shown.replies.at(-1)), ['wiezienie:wykup']);

  // 1,500 is not enough: nothing is taken.
  const poor = press(prisoner);
  await click(poor);
  assert.match(text(poor.calls.reply[0]), /Bail costs \*\*\$2,000\*\* - you do not have that much/);
  assert.equal(poor.calls.reply[0].flags, MessageFlags.Ephemeral);
  assert.equal((await data(prisoner)).wallet, 500);

  // Cash first, then the bank. On the prisoner's own message the button is replaced.
  await save(prisoner, { bank: 1600 });
  const own = press(prisoner, { interactionMetadata: { user: { id: prisoner.id } } });
  await click(own);
  assert.match(text(own.calls.update[0]), /You paid \*\*\$2,000\*\* bail/);
  assert.deepEqual(own.calls.update[0].components, []);
  const free = await data(prisoner);
  assert.equal(free.wallet, 0);
  assert.equal(free.bank, 100);
  assert.equal(free.jailedUntil, 0);
  await run('nagraj', prisoner);

  // Someone who is not in jail gets a private note.
  const bystander = press(newMember('Gap'));
  await click(bystander);
  assert.match(text(bystander.calls.reply[0]), /You are not in jail/);

  // The thief from the failed /crime pays with the button too (bail is a fixed price, no multiplier).
  await updateEconomySettings(guild.id, (settings) => { settings.earningsPercent = 300; });
  await save(thief, { wallet: 2500 });
  await click(press(thief));
  assert.equal((await data(thief)).wallet, 500);
  await updateEconomySettings(guild.id, (settings) => { settings.earningsPercent = 100; });

  // bailPrice 0: no offer, no button, the button refuses.
  await updateEconomySettings(guild.id, (settings) => { settings.commands.crime.bailPrice = 0; });
  await save(prisoner, { wallet: 5000, jailedUntil: Date.now() + 60 * 60_000 });
  await assert.rejects(run('nagraj', prisoner), (error) => !/bail/i.test(error.userMessage) && buttonIds(error.context).length === 0);
  const off = press(prisoner);
  await click(off);
  assert.match(text(off.calls.reply[0]), /Bail is turned off/);
  assert.equal((await data(prisoner)).wallet, 5000);
  await updateEconomySettings(guild.id, (settings) => { settings.commands.crime.bailPrice = 2000; });
});

test('/economy poradnik posts one message with a topic menu; old guide messages are replaced', async () => {
  const info = mockChannel(guild, 'ekonomia-info');
  info.messages = { fetch: async (id) => info.sent.find((message) => message.id === id && !message.deleted) ?? null };
  const admin = newMember('Admin');

  // A guide of the old kind (two messages) is replaced by the single menu message.
  const old = [await info.send({ content: 'old 1' }), await info.send({ content: 'old 2' })];
  for (const message of old) message.delete = async () => { message.deleted = true; };
  await client.db.set(`guild:${guild.id}:economy-guide`, { channelId: info.id, messageIds: old.map((message) => message.id) });

  const first = await run('economy', admin, { kanal: info }, 'poradnik');
  assert.match(replyText(first), /The guide is posted in/);
  assert.ok(old.every((message) => message.deleted), 'old guide messages removed');
  const posted = info.sent.at(-1);
  assert.equal(posted.embeds.length, 1);
  const menu = posted.components[0].toJSON().components[0];
  assert.equal(menu.custom_id, 'poradnik:pokaz');
  assert.deepEqual(menu.options.map((option) => option.value), GUIDE_TOPICS.map((topic) => topic.id));
  assert.ok(menu.options.length <= 25);

  let edited = false;
  posted.edit = async () => { edited = true; };
  const second = await run('economy', admin, { kanal: info }, 'poradnik');
  assert.match(replyText(second), /is updated/);
  assert.ok(edited);
  assert.equal(info.sent.filter((message) => !message.deleted).length, 1, 'still one message');
});

test('guide menu: every topic opens privately, fits Discord limits and the menu switches topics', async () => {
  const menuHandler = (await import('../src/interactions/selectMenus/economy/guide.js')).default;
  const reader = newMember('Czytelnik');
  const pick = (action, value) => {
    const calls = { update: [], followUp: [], reply: [] };
    const interaction = {
      client, guild, guildId: guild.id, channel, member: reader, user: reader.user, customId: `poradnik:${action}`, values: [value],
      update: async (payload) => { calls.update.push(payload); },
      followUp: async (payload) => { calls.followUp.push(payload); },
      reply: async (payload) => { calls.reply.push(payload); },
    };
    return { interaction, calls };
  };

  const everything = [];
  for (const topic of GUIDE_TOPICS) {
    const { interaction, calls } = pick('pokaz', topic.id);
    await runWithLocale('en', () => menuHandler.execute(interaction, client, ['pokaz']));
    assert.equal(calls.update.length, 1, 'the channel menu is reset');
    assert.equal(calls.followUp.length, 1, topic.id);
    const view = calls.followUp[0];
    assert.equal(view.flags, MessageFlags.Ephemeral, 'only the member sees it');
    const embed = view.embeds[0].toJSON();
    assert.ok(embed.title.includes(topic.emoji), embed.title);
    assert.ok((embed.fields ?? []).length <= 25);
    for (const entry of embed.fields ?? []) {
      assert.ok(entry.name.length <= 256 && entry.value.length <= 1024, `${topic.id}: ${entry.name}`);
    }
    const size = (embed.title?.length ?? 0) + (embed.description?.length ?? 0) + (embed.footer?.text?.length ?? 0)
      + (embed.fields ?? []).reduce((sum, entry) => sum + entry.name.length + entry.value.length, 0);
    assert.ok(size < 6000, `${topic.id}: ${size}`);
    const inner = view.components[0].toJSON().components[0];
    assert.equal(inner.custom_id, 'poradnik:zmien');
    assert.equal(inner.options.find((option) => option.default)?.value, topic.id);
    everything.push(JSON.stringify(embed));
  }

  const all = everything.join('\n');
  for (const command of ['/work', '/daily', '/nagraj', '/fish', '/beg', '/crime', '/slut', '/rob', '/gamble', '/ruletka', '/slots', '/blackjack', '/sklep', '/ulepszenia', '/hajs', '/bank wplac', '/pay', '/topkasa', '/ekwipunek', '/randka', '/slub', '/napad', '/wordle', '/misje', '/osiagniecia', '/wymiana']) {
    assert.ok(all.includes(command), command);
  }
  assert.match(all, /Fortune/);
  assert.doesNotMatch(all, /1d|undefined|NaN|\{\d/);

  // Inside a tutorial the menu switches the topic in place.
  const { interaction, calls } = pick('zmien', 'kasyno');
  await runWithLocale('en', () => menuHandler.execute(interaction, client, ['zmien']));
  assert.equal(calls.followUp.length, 0);
  assert.match(text(calls.update[0]), /Casino/);
});

test('a guide posted before the games topics is edited at startup, once', async () => {
  const info = mockChannel(guild, 'stary-poradnik');
  const message = await info.send({ content: 'old menu' });
  const edits = [];
  message.edit = async (payload) => { edits.push(payload); };
  info.messages = { fetch: async (id) => (id === message.id ? message : null) };
  await client.db.set(`guild:${guild.id}:economy-guide`, { channelId: info.id, messageIds: [message.id] });

  assert.equal(await refreshEconomyGuides(client), 1);
  const menu = edits[0].components[0].toJSON().components[0];
  assert.ok(menu.options.some((option) => option.value === 'gry'));
  assert.ok(menu.options.some((option) => option.value === 'misje'));
  assert.ok(JSON.stringify(edits[0].embeds[0].toJSON()).includes('/napad'));
  assert.equal((await client.db.get(`guild:${guild.id}:economy-guide`)).version, GUIDE_VERSION);
  assert.equal(await refreshEconomyGuides(client), 0, 'not again');
});
