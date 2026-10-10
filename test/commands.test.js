// Runs real command code against stand-in Discord objects and in-memory storage.
import './helpers/env.js';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { Collection, PermissionFlagsBits } from 'discord.js';
import { mockChannel, mockGuild, mockInteraction, mockMember, mockRole, mockUser, replyText } from './helpers/mock.js';
import { runWithLocale } from '../src/i18n/index.js';
import { initializeDatabase } from '../src/utils/database.js';
import { loadCommands } from '../src/handlers/loaders/commandLoader.js';
import { getGuildLocale } from '../src/services/languageService.js';
import { selectWinners, createGiveawayEmbed, createGiveawayButtons } from '../src/services/giveawayService.js';
import { checkGiveawayEntry } from '../src/services/giveawayRules.js';
import { handleTagMessage } from '../src/services/tagService.js';
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

test('/language switches the server language and answers in it', async () => {
  const shown = await run('language', { locale: 'en' });
  assert.match(replyText(shown), /Server language/);

  const changed = await run('language', { locale: 'en', options: { language: 'pl' } });
  assert.match(replyText(changed), /Zmieniono język/);
  assert.equal(await getGuildLocale(client, guild.id), 'pl');

  await assert.rejects(run('language', { member: regular, options: { language: 'en' } }), /permission/i);
  await run('language', { options: { language: 'en' } });
  assert.equal(await getGuildLocale(client, guild.id), 'en');
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

test('/invites shows stats, leaderboard and admin tools', async () => {
  await addBonusInvites(guild.id, regular.id, 4);
  const shown = await run('invites', { subcommand: 'show', options: { user: regular.user } });
  assert.match(replyText(shown), /\*\*4\*\* invites/);
  const polish = await run('invites', { locale: 'pl', subcommand: 'show', options: { user: regular.user } });
  assert.match(replyText(polish), /\*\*4\*\* zaproszenia/);

  const board = await run('invites', { subcommand: 'leaderboard' });
  assert.match(replyText(board), new RegExp(`<@${regular.id}>`));

  const role = mockRole(guild, 'Inviter');
  await run('invites', { subcommand: 'reward-add', options: { invites: 3, role } });
  const rewards = await run('invites', { subcommand: 'rewards' });
  assert.match(replyText(rewards), new RegExp(role.id));

  await assert.rejects(run('invites', { member: regular, subcommand: 'reset' }), /permission/i);
});

test('/automod configures rules', async () => {
  await run('automod', { subcommand: 'toggle', options: { enabled: true } });
  await run('automod', { subcommand: 'rule', options: { rule: 'invites', enabled: true, action: 'timeout' } });
  await run('automod', { subcommand: 'words', options: { add: 'brzydkie, spam*' } });
  const status = await run('automod', { locale: 'pl', subcommand: 'status' });
  const text = replyText(status);
  assert.match(text, /Automod jest włączony/);
  assert.match(text, /🟢 \*\*Zaproszenia na inne serwery\*\* — usuń \+ wyciszenie/);
  assert.match(text, /słów: 2/);
});

test('/tag stores a tag that answers to the prefix', async () => {
  await run('tag', { subcommand: 'set', options: { name: 'Regulamin', text: 'Czytaj {channel}, {user}!' } });
  const shown = await run('tag', { subcommand: 'show', options: { name: 'regulamin' } });
  assert.match(replyText(shown), new RegExp(`Czytaj <#${channel.id}>, <@${admin.id}>!`));

  const message = { guild, channel, channelId: channel.id, content: '!regulamin', author: regular.user, client };
  assert.equal(await handleTagMessage(message, '!'), true);
  assert.match(channel.sent.at(-1).content, /Czytaj/);
  assert.equal(await handleTagMessage({ ...message, content: '!nieistnieje' }, '!'), false);
  // A tag never shadows a real command.
  await run('tag', { subcommand: 'set', options: { name: 'ban', text: 'x' } });
  assert.equal(await handleTagMessage({ ...message, content: '!ban' }, '!'), false);
});

test('/channel slowmode goes through the command group', async () => {
  const done = await run('channel', { subcommand: 'slowmode', options: { time: '30s' } });
  assert.equal(channel.rateLimitPerUser, 30);
  assert.match(replyText(done), /30s/);
  await run('channel', { subcommand: 'slowmode', options: { time: '0' } });
  assert.equal(channel.rateLimitPerUser, 0);
  await assert.rejects(run('channel', { subcommand: 'slowmode', options: { time: 'kiedys' } }));

  // Discord only gates the top-level command; the member check must stop a regular user.
  const blocked = mockInteraction({ client, guild, channel, member: regular, commandName: 'channel', subcommand: 'slowmode', options: { time: '5s' } });
  await runWithLocale('en', () => client.commands.get('channel').execute(blocked, {}, client));
  assert.equal(channel.rateLimitPerUser, 0);
});

test('empty lists explain what to do next', async () => {
  assert.match(replyText(await run('notify', { group: 'youtube', subcommand: 'list' })), /notify youtube add/);
  assert.match(replyText(await run('minecraft', { subcommand: 'list' })), /minecraft track/);
  assert.match(replyText(await run('modmail', { subcommand: 'status' })), /Modmail/);
  assert.match(replyText(await run('giveaway', { subcommand: 'list' })), /giveaway create/);
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
