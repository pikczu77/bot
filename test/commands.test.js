// Runs real command code against stand-in Discord objects and in-memory storage.
import './helpers/env.js';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { Collection, PermissionFlagsBits } from 'discord.js';
import { mockChannel, mockGuild, mockInteraction, mockMember, mockRole, mockUser, replyText, snowflake } from './helpers/mock.js';
import { runWithLocale } from '../src/i18n/index.js';
import { initializeDatabase } from '../src/utils/database.js';
import { loadCommands } from '../src/handlers/loaders/commandLoader.js';
import { selectWinners, createGiveawayEmbed, createGiveawayButtons } from '../src/services/giveawayService.js';
import { checkGiveawayEntry } from '../src/services/giveawayRules.js';
import { addBonusInvites } from '../src/services/inviteService.js';

const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null } };
let guild;
let channel;
let admin;
let regular;

before(async () => {
  const { db } = await initializeDatabase();
  client.db = db;
  await loadCommands(client);
  guild = mockGuild(client);
  channel = mockChannel(guild, 'ogolny');
  admin = mockMember(guild, mockUser('Pikczu'), { permissions: [PermissionFlagsBits.Administrator] });
  regular = mockMember(guild, mockUser('Zwykly'));
});

async function run(commandName, { locale = 'en', member = admin, ...rest } = {}) {
  const interaction = mockInteraction({ client, guild, channel, member, commandName, ...rest });
  const command = client.commands.get(commandName);
  assert.ok(command, `command ${commandName} is not loaded`);
  await runWithLocale(locale, () => command.execute(interaction, {}, client));
  return interaction;
}

test('commands removed on 2026-10-11 stay removed; /poziom shows the level', async () => {
  // Their settings live in the web panel (or the feature was dropped). See the project notes.
  const removed = [
    'welcome', 'goodbye', 'greet', 'autorole', 'level', 'automod', 'notify', 'language',
    'tools', 'poll', 'embedbuilder', 'tag', 'apply', 'app-admin', 'verification', 'verify', 'autoverify', 'rank',
  ];
  assert.deepEqual(removed.filter((name) => client.commands.has(name)), []);
  // 64 on 2026-10-14 morning; then /hajs /ruletka /blackjack /slots /ekwipunek and /randka /slub.
  assert.equal(client.commands.size, 74);

  const text = replyText(await run('poziom', { member: regular }));
  assert.match(text, /Zwykly/);
  assert.match(text, /0\/50/);
});

test('/ship is stable for a pair and refuses self-ships', async () => {
  const first = await run('ship', { options: { first: admin.user, second: regular.user } });
  const again = await run('ship', { options: { first: regular.user, second: admin.user } });
  const percent = (interaction) => replyText(interaction).match(/\*\*(\d+)%\*\*/)?.[1];
  assert.ok(percent(first) !== undefined);
  assert.equal(percent(first), percent(again));
  await assert.rejects(run('ship', { options: { first: admin.user, second: admin.user } }));

  const polish = await run('ship', { locale: 'pl', options: { first: admin.user, second: regular.user } });
  assert.match(replyText(polish), /Nazwa shipu/);
});

test('/zaproszenia shows stats, leaderboard and admin tools', async () => {
  await addBonusInvites(guild.id, regular.id, 4);
  const shown = await run('zaproszenia', { subcommand: 'show', options: { user: regular.user } });
  assert.match(replyText(shown), /\*\*4\*\* invites/);
  const polish = await run('zaproszenia', { locale: 'pl', subcommand: 'show', options: { user: regular.user } });
  assert.match(replyText(polish), /\*\*4\*\* zaproszenia/);

  const board = await run('zaproszenia', { subcommand: 'top' });
  assert.match(replyText(board), new RegExp(`<@${regular.id}>`));

  const role = mockRole(guild, 'Inviter');
  await run('zaproszenia', { subcommand: 'nagroda-dodaj', options: { invites: 3, role } });
  const rewards = await run('zaproszenia', { subcommand: 'nagrody' });
  assert.match(replyText(rewards), new RegExp(role.id));

  await assert.rejects(run('zaproszenia', { member: regular, subcommand: 'reset' }), /permission/i);
});

test('/channel wolny-tryb goes through the command group', async () => {
  const done = await run('channel', { subcommand: 'wolny-tryb', options: { time: '30s' } });
  assert.equal(channel.rateLimitPerUser, 30);
  assert.match(replyText(done), /30s/);
  await run('channel', { subcommand: 'wolny-tryb', options: { time: '0' } });
  assert.equal(channel.rateLimitPerUser, 0);
  await assert.rejects(run('channel', { subcommand: 'wolny-tryb', options: { time: 'kiedys' } }));

  // Discord only gates the top-level command; the member check must stop a regular user.
  const blocked = mockInteraction({ client, guild, channel, member: regular, commandName: 'channel', subcommand: 'wolny-tryb', options: { time: '5s' } });
  await runWithLocale('en', () => client.commands.get('channel').execute(blocked, {}, client));
  assert.equal(channel.rateLimitPerUser, 0);
});

test('empty lists explain what to do next', async () => {
  assert.match(replyText(await run('minecraft', { subcommand: 'list' })), /minecraft track/);
  assert.match(replyText(await run('modmail', { subcommand: 'status' })), /Modmail/);
  assert.match(replyText(await run('konkurs', { subcommand: 'list' })), /konkurs utworz/);
  assert.match(replyText(await run('role', { subcommand: 'info', options: { role: mockRole(guild, 'VIP') } })), /VIP/);
});

test('giveaway winners respect extra entries and requirements', async () => {
  assert.deepEqual(selectWinners([], 1), []);
  assert.equal(new Set(selectWinners(['a', 'b', 'c'], 5)).size, 3);

  let heavyWins = 0;
  for (let i = 0; i < 400; i += 1) {
    if (selectWinners(['light', 'heavy'], 1, { heavy: 9 })[0] === 'heavy') heavyWins += 1;
  }
  assert.ok(heavyWins > 300, `heavy won only ${heavyWins}/400`);

  const vip = mockRole(guild, 'Giveaway VIP');
  const giveaway = {
    prize: 'Nitro',
    hostId: admin.id,
    winnerCount: 1,
    endsAt: Date.now() + 3_600_000,
    participants: ['1', '2'],
    requirements: { roleId: vip.id, minInvites: 2 },
    bonusEntries: [{ roleId: vip.id, entries: 2 }],
  };

  const refused = await runWithLocale('en', () => checkGiveawayEntry(client, mockMember(guild, mockUser('Nowy')), giveaway));
  assert.equal(refused.ok, false);
  assert.equal(refused.missing.length, 2);

  regular.roles.cache.set(vip.id, vip);
  const accepted = await runWithLocale('en', () => checkGiveawayEntry(client, regular, giveaway));
  assert.deepEqual({ ok: accepted.ok, tickets: accepted.tickets }, { ok: true, tickets: 3 });

  const embed = runWithLocale('pl', () => createGiveawayEmbed(giveaway, 'active')).toJSON();
  assert.match(embed.description, /Wymagania/);
  assert.match(embed.description, /Dodatkowe losy/);
  const button = runWithLocale('en', () => createGiveawayButtons(false, 2)).toJSON().components[0];
  assert.equal(button.label, '🎉 Join · 2');
});

test('economy commands follow the server settings: payouts, currency, tax, shop, channels', async () => {
  const { getEconomyAccessDenial, updateEconomySettings } = await import('../src/services/economySettings.js');
  const { getEconomyData, setEconomyData } = await import('../src/utils/economy.js');
  const vip = mockRole(guild, 'VIP');
  const casino = mockChannel(guild, 'kasyno');

  await updateEconomySettings(guild.id, (settings) => {
    settings.currency = { symbol: 'zł', position: 'right', separator: ' ' };
    settings.startingWallet = 1000;
    settings.payTaxPercent = 10;
    settings.commands.daily = { amount: 7777, cooldownMinutes: 60 };
    settings.shop.items.pen = { enabled: false };
    settings.shop.roles = [{ roleId: vip.id, price: 500, description: 'Kolor' }];
    settings.channels = { mode: 'allow', list: [casino.id] };
  });

  const claimed = await run('daily', { member: regular });
  assert.match(replyText(claimed), /\*\*7 777 zł\*\*/);
  assert.equal((await getEconomyData(client, guild.id, regular.id)).wallet, 8777);
  await assert.rejects(run('daily', { member: regular }), /cooldown/i);

  await run('pay', { member: regular, options: { user: admin.user, amount: 1000 } });
  assert.equal((await getEconomyData(client, guild.id, regular.id)).wallet, 7777);
  assert.equal((await getEconomyData(client, guild.id, admin.id)).wallet, 1900);

  await assert.rejects(run('sklep', { member: regular, options: { kup: 'pen' } }), /not found/);
  const bought = await run('sklep', { member: regular, options: { kup: `role_${vip.id}` } });
  assert.match(replyText(bought), /500 zł/);
  assert.ok(regular.roles.cache.has(vip.id));
  assert.equal((await getEconomyData(client, guild.id, regular.id)).wallet, 7277);

  const work = client.commands.get('work');
  assert.match(await getEconomyAccessDenial({ guild, member: regular, channel }, work), /only in/);
  assert.equal(await getEconomyAccessDenial({ guild, member: regular, channel: casino }, work), null);
  assert.equal(await getEconomyAccessDenial({ guild, member: admin, channel }, work), null);
  assert.equal(await getEconomyAccessDenial({ guild, member: regular, channel }, client.commands.get('ship')), null);

  await setEconomyData(client, guild.id, regular.id, { ...(await getEconomyData(client, guild.id, regular.id)), wallet: 0 });
});

/** A button or menu click on a message. Records what the handler answered. */
function mockComponent({ guild, channel, member, customId, values = [] }) {
  const calls = { reply: [], update: [], followUp: [] };
  return {
    calls,
    id: snowflake(),
    client,
    guild,
    guildId: guild.id,
    channel,
    channelId: channel.id,
    member,
    user: member.user,
    customId,
    values,
    createdTimestamp: Date.now(),
    replied: false,
    deferred: false,
    reply: async (payload) => { calls.reply.push(payload); },
    update: async (payload) => { calls.update.push(payload); },
    followUp: async (payload) => { calls.followUp.push(payload); },
  };
}

const payloadText = (payload) => replyText({ replies: [payload] });

test('economy: /sklep picks items from a list, /ulepszenia upgrades stay and pay, /rob reaches the bank', async () => {
  const { updateEconomySettings } = await import('../src/services/economySettings.js');
  const { getEconomyData, setEconomyData, getMaxBankCapacity } = await import('../src/utils/economy.js');
  const { buyUpgrade, bankStealPercent, getUpgrade, upgradePrice } = await import('../src/services/economyUpgrades.js');
  const upgradeButtons = (await import('../src/interactions/buttons/economy/upgrades.js')).default;
  const shopMenu = (await import('../src/interactions/selectMenus/economy/shop.js')).default;

  const town = mockGuild(client, 'Miasto');
  const street = mockChannel(town, 'ulica');
  const player = mockMember(town, mockUser('Gracz'));
  const victim = mockMember(town, mockUser('Ofiara'));
  const inTown = (name, options) => run(name, { guild: town, channel: street, ...options });
  const data = (member) => getEconomyData(client, town.id, member.id);
  const save = async (member, patch) => setEconomyData(client, town.id, member.id, { ...(await data(member)), ...patch });

  await updateEconomySettings(town.id, (settings) => {
    settings.currency = { symbol: 'zł', position: 'right', separator: ' ' };
    settings.commands.rob = { ...settings.commands.rob, successPercent: 100, finePercent: 10, minVictimCash: 500 };
  });

  // Bank security: 50% of the bank, 10 points less per level, never below 10%.
  assert.deepEqual([0, 1, 2, 3, 4].map((level) => bankStealPercent({ upgrades: { bank_security: level } })), [50, 40, 30, 20, 10]);
  assert.equal(upgradePrice(getUpgrade('bank_security'), 4), null);
  assert.equal(getMaxBankCapacity({ upgrades: { bank_capacity: 2 } }) - getMaxBankCapacity({}), 40_000);

  // /sklep kup: the item list comes from autocomplete; a typed name works too.
  const asking = mockInteraction({ client, guild: town, channel: street, member: player, commandName: 'sklep' });
  let choices = [];
  asking.respond = async (list) => { choices = list; };
  await runWithLocale('pl', () => client.commands.get('sklep').autocomplete(asking, client));
  assert.ok(choices.some((choice) => choice.value === 'lockpick' && /Wytrych — 1 500 zł/.test(choice.name)), JSON.stringify(choices));

  await save(player, { wallet: 1000, bank: 9000 });
  const lockpicks = await inTown('sklep', { member: player, options: { kup: 'Lockpick', ilosc: 2 } });
  assert.match(replyText(lockpicks), /2x \*\*🗝️ Lockpick\*\*/);
  assert.deepEqual({ wallet: (await data(player)).wallet, bank: (await data(player)).bank, picks: (await data(player)).inventory.lockpick }, { wallet: 0, bank: 7000, picks: 2 });
  await assert.rejects(inTown('sklep', { member: player, options: { kup: 'lockpick', ilosc: 4 } }), /limit/i);

  // The shop message: the item menu buys for whoever picks.
  const shop = await inTown('sklep', { member: player });
  const shopRows = shop.replies.at(-1).components.map((row) => row.toJSON());
  assert.ok(shopRows.some((row) => row.components[0].custom_id === `sklep:kup:${player.id}:tool`));
  const pick = mockComponent({ guild: town, channel: street, member: player, customId: `sklep:kup:${player.id}:consumable`, values: ['energy_drink'] });
  await runWithLocale('en', () => shopMenu.execute(pick, client, ['kup', player.id, 'consumable']));
  assert.equal(pick.calls.update.length, 1);
  assert.match(payloadText(pick.calls.followUp[0]), /Energy Drink/);
  assert.equal((await data(player)).inventory.energy_drink, 1);

  // /ulepszenia: one button per upgrade; pressing it buys the next level for good.
  await save(player, { wallet: 1000, bank: 5000 });
  const list = await inTown('ulepszenia', { member: player });
  assert.match(replyText(list), /Career · 0\/10/);
  const buttons = list.replies.at(-1).components.flatMap((row) => row.toJSON().components);
  const careerButton = buttons.find((button) => button.custom_id === `ulepszenia:kup:${player.id}:work`);
  assert.equal(careerButton.disabled, false);

  const press = mockComponent({ guild: town, channel: street, member: player, customId: careerButton.custom_id });
  await runWithLocale('en', () => upgradeButtons.execute(press, client, ['kup', player.id, 'work']));
  assert.match(payloadText(press.calls.update[0]), /Career\*\* is now level \*\*1\*\*/);
  assert.deepEqual({ wallet: (await data(player)).wallet, bank: (await data(player)).bank, level: (await data(player)).upgrades.work }, { wallet: 0, bank: 4000, level: 1 });

  const stranger = mockComponent({ guild: town, channel: street, member: victim, customId: careerButton.custom_id });
  await runWithLocale('en', () => upgradeButtons.execute(stranger, client, ['kup', player.id, 'work']));
  assert.equal(stranger.calls.update.length, 0);
  assert.match(payloadText(stranger.calls.reply[0]), /Ofiara/);
  assert.equal((await data(victim)).upgrades?.work ?? 0, 0);

  const offers = await inTown('work', { member: player });
  assert.match(replyText(offers), /Job offers/);

  // /nagraj and /fish need a tool from the shop.
  await assert.rejects(inTown('nagraj', { member: player, locale: 'pl' }), (error) => {
    assert.match(error.message, /Missing tool for mine/);
    assert.match(error.userMessage, /Komputer.*2 500 zł/);
    return true;
  });
  await assert.rejects(inTown('fish', { member: player }), /Missing tool for fish/);
  await save(player, { inventory: { ...(await data(player)).inventory, pickaxe: 1, fishing_rod: 1 } });
  assert.match(replyText(await inTown('fish', { member: player })), /zł/);

  // /nagraj on a break: the Energy Drink skips it once. An old pickaxe counts as the computer.
  await inTown('nagraj', { member: player });
  const again = await inTown('nagraj', { member: player });
  assert.match(replyText(again), /Energy Drink/);
  assert.equal((await data(player)).inventory.energy_drink, 0);
  await assert.rejects(inTown('nagraj', { member: player }), /cooldown/i);

  // /rob: 80% of the cash and 50% of an unprotected bank.
  await save(victim, { wallet: 1000, bank: 10_000 });
  await save(player, { wallet: 0 });
  const robbed = await inTown('rob', { member: player, options: { user: victim.user } });
  assert.match(replyText(robbed), /5 800 zł/);
  assert.deepEqual({ wallet: (await data(victim)).wallet, bank: (await data(victim)).bank }, { wallet: 200, bank: 5000 });
  assert.equal((await data(player)).inventory.lockpick, 1);

  // Bank security level 1: only 40% of the bank.
  await save(victim, { wallet: 10_000, bank: 5000 });
  assert.equal((await buyUpgrade(client, town.id, victim.id, 'bank_security')).ok, true);
  await save(player, { lastRob: 0 });
  await save(victim, { wallet: 1000, bank: 5000 });
  await inTown('rob', { member: player, options: { user: victim.user } });
  assert.deepEqual({ wallet: (await data(victim)).wallet, bank: (await data(victim)).bank }, { wallet: 200, bank: 3000 });

  // A Personal Safe stops one robbery and breaks.
  await save(player, { lastRob: 0 });
  await save(victim, { inventory: { personal_safe: 1 } });
  const blocked = await inTown('rob', { member: player, options: { user: victim.user } });
  assert.match(replyText(blocked), /Personal Safe/);
  assert.deepEqual({ wallet: (await data(victim)).wallet, safes: (await data(victim)).inventory.personal_safe }, { wallet: 200, safes: 0 });
});

test('leveling follows the server settings: multipliers, exceptions, rewards, voice', async () => {
  const { applyXpMultipliers, canEarnXp, getLevelingConfig, getUserLevelData, getXpForLevel, saveLevelingConfig } = await import('../src/services/leveling/leveling.js');
  const { addXp } = await import('../src/services/leveling/xpSystem.js');
  const { findVoiceEarners } = await import('../src/services/leveling/voiceXp.js');
  const { getEconomyData } = await import('../src/utils/economy.js');
  const booster = mockRole(guild, 'Booster XP');
  const first = mockRole(guild, 'Poziom 1');
  const second = mockRole(guild, 'Poziom 2');
  const talk = mockChannel(guild, 'pogaduchy');
  const player = mockMember(guild, mockUser('Gracz'), { roles: [booster] });
  const bot = mockMember(guild, mockUser('Robot', { bot: true }));

  const settings = {
    enabled: true, xpMultiplier: 2, roleMultipliers: [{ id: booster.id, percent: 150 }, { id: first.id, percent: 300 }], channelMultipliers: [{ id: talk.id, percent: 200 }],
    longMessageBonusPercent: 50, attachmentBonusPercent: 100, channelMode: 'block', roleMode: 'block', ignoredChannels: [], ignoredRoles: [], blacklistedUsers: [],
  };
  assert.equal(applyXpMultipliers(settings, 10, { member: player, channel }), 30);
  assert.equal(applyXpMultipliers(settings, 10, { member: player, channel: talk }), 60);
  assert.equal(applyXpMultipliers(settings, 10, { member: player, channel, message: { content: 'a'.repeat(151), attachments: { size: 1 } } }), 90);
  assert.equal(applyXpMultipliers({ ...settings, xpMultiplier: 0.5, roleMultipliers: [] }, 1, { member: player, channel }), 1);

  assert.equal(canEarnXp(settings, player, channel), true);
  assert.equal(canEarnXp(settings, bot, channel), false);
  assert.equal(canEarnXp({ ...settings, enabled: false }, player, channel), false);
  assert.equal(canEarnXp({ ...settings, ignoredChannels: [channel.id] }, player, channel), false);
  assert.equal(canEarnXp({ ...settings, channelMode: 'allow', ignoredChannels: [talk.id] }, player, channel), false);
  assert.equal(canEarnXp({ ...settings, channelMode: 'allow', ignoredChannels: [talk.id] }, player, talk), true);
  assert.equal(canEarnXp({ ...settings, ignoredRoles: [booster.id] }, player, channel), false);
  assert.equal(canEarnXp({ ...settings, roleMode: 'allow', ignoredRoles: [first.id] }, player, channel), false);
  assert.equal(canEarnXp({ ...settings, blacklistedUsers: [player.id] }, player, channel), false);

  const state = (member, voiceChannel, extra = {}) => ({ member, channelId: voiceChannel.id, channel: voiceChannel, ...extra });
  const quiet = mockMember(guild, mockUser('Cichy'));
  const loner = mockMember(guild, mockUser('Samotnik'));
  const voiceGuild = (states) => ({ afkChannelId: 'afk', voiceStates: { cache: new Collection(states.map((entry, index) => [String(index), entry])) } });
  const room = { id: 'room' };
  const names = (earners) => earners.map((earner) => earner.member.user.username).sort().join();
  const states = [state(player, room), state(quiet, room, { selfMute: true }), state(bot, room), state(loner, { id: 'solo' }), state(admin, { id: 'afk' })];
  assert.equal(names(findVoiceEarners(voiceGuild(states), settings)), 'Gracz');
  assert.equal(names(findVoiceEarners(voiceGuild(states), { ...settings, voiceCountMuted: true, voiceCountAlone: true })), 'Cichy,Gracz,Samotnik');

  // Kept from the time guild config was read only from PostgreSQL; any storage is read now (see storage.test.js).
  const live = { ...client, db: Object.assign(Object.create(client.db), { isAvailable: () => true }) };
  await saveLevelingConfig(live, guild.id, {
    ...(await getLevelingConfig(live, guild.id)),
    enabled: true, announceLevelUp: true, levelUpSameChannel: true, levelUpMessage: 'GG {user} poziom {level} {money} {role}',
    roleRewards: { 1: first.id, 2: second.id }, removePreviousRoles: true, moneyPerLevel: 200,
  });
  const walletBefore = (await getEconomyData(client, guild.id, player.id)).wallet;
  const result = await runWithLocale('en', () => addXp(live, guild, player, getXpForLevel(0) + getXpForLevel(1), { channel: talk, touchCooldown: false }));
  assert.equal(result.level, 2);
  assert.ok(player.roles.cache.has(second.id));
  assert.equal(player.roles.cache.has(first.id), false);
  assert.equal((await getEconomyData(client, guild.id, player.id)).wallet, walletBefore + 400);
  assert.equal(talk.sent.at(-1).content, `GG <@${player.id}> poziom 2 400 zł **Poziom 2**`);
  assert.equal((await getUserLevelData(client, guild.id, player.id)).lastMessage, 0);
});

test('/jointocreate interface posts the message with the control buttons', async () => {
  const target = mockChannel(guild, 'kanaly-glosowe');
  const interaction = await run('jointocreate', { subcommand: 'interface', options: { channel: target } });

  assert.equal(target.sent.length, 1);
  assert.deepEqual(target.sent[0].components.map((row) => row.toJSON().components.length), [5, 4]);
  assert.match(replyText(interaction), new RegExp(`controls are now in <#${target.id}>`));

  // Without a channel the message goes where the command was used.
  await run('jointocreate', { subcommand: 'interface' });
  assert.equal(channel.sent.at(-1).components.length, 2);
  assert.equal((await run('jointocreate', { subcommand: 'interface', member: regular })).replies.length > 0, true);
  assert.equal(channel.sent.filter((message) => message.components?.length === 2).length, 1);
});
