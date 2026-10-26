// /profil (2026-10-26): one PNG card with level, money, collections, badges and spouse; buttons open
// the badges and missions privately.
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
import { renderProfileCard } from '../src/services/profileCard.js';
import { profileData } from '../src/commands/Leveling/profil.js';
import profileButtons from '../src/interactions/buttons/leveling/profile.js';

const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null } };
let guild;
let channel;

before(async () => {
  const { db } = await initializeDatabase();
  client.db = db;
  await loadCommands(client);
  guild = mockGuild(client, 'Profile');
  channel = mockChannel(guild, 'ogolny');
  await updateEconomySettings(guild.id, (settings) => {
    settings.currency = { symbol: '$', position: 'left', separator: ',' };
  });
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

test('the card is a PNG of 1000x420, also without an avatar', async () => {
  const png = await renderProfileCard({
    name: 'Ząbek Żółwiowy', subtitle: 'Poziom 3', accent: '#5865F2', level: 3, xp: 50, xpNeeded: 245, xpText: '50 / 245 XP',
    tiles: [{ label: 'Gotówka', value: '$1' }, { label: 'Bank', value: '$2' }, { label: 'Karty', value: '1/21' }, { label: 'Ryby', value: '0/20' }],
    badgesTitle: 'Odznaki 0/26', badges: [], noBadges: 'Brak',
  });
  assert.ok(png.subarray(0, 4).equals(PNG));
  assert.equal(png.readUInt32BE(16), 1000);
  assert.equal(png.readUInt32BE(20), 420);
});

test('profile data: money, collections, badges newest first, spouse', async () => {
  const member = mockMember(guild, mockUser('Ola'));
  await setEconomyData(client, guild.id, member.id, {
    ...(await getEconomyData(client, guild.id, member.id)),
    wallet: 1234, bank: 50, cards: { iwi: 1, miau: 2 }, fishIndex: { bass: 3 },
    achievements: { first_fish: 1000, gambler: 3000, fisher: 2000 },
  });
  const data = await runWithLocale('en', () => profileData({ client, guild, user: member.user, member }));
  assert.equal(data.tiles[0].value, '$1,234');
  assert.equal(data.tiles[2].value, '2/21');
  assert.equal(data.tiles[3].value, '1/20');
  assert.deepEqual(data.badges, ['Gambler', 'Angler', 'First catch']);
  assert.match(data.badgesTitle, /Badges 3\/26/);
  assert.match(data.subtitle, /Level 0/);
});

test('/profil answers with the picture and two buttons; the buttons answer privately', async () => {
  const member = mockMember(guild, mockUser('Kuba'));
  const interaction = mockInteraction({ client, guild, channel, member, commandName: 'profil' });
  await runWithLocale('en', () => client.commands.get('profil').execute(interaction, {}, client));
  const reply = interaction.replies.at(-1);
  assert.equal(reply.files.length, 1);
  assert.equal(reply.files[0].name, 'profil.png');
  const ids = reply.components[0].toJSON().components.map((button) => button.custom_id);
  assert.deepEqual(ids, [`profil:odznaki:${member.id}`, `profil:misje:${member.id}`]);

  const answers = [];
  const press = (customId) => ({
    id: snowflake(), client: { ...client, users: { fetch: async () => member.user } }, guild, guildId: guild.id, channel, member, user: member.user, customId,
    reply: async (payload) => { answers.push(payload); },
  });
  const local = { ...client, users: { fetch: async () => member.user } };
  await runWithLocale('en', () => profileButtons.execute(press(ids[0]), local, ['odznaki', member.id]));
  assert.match(replyText({ replies: [answers[0]] }), /Badges of Kuba/);
  await runWithLocale('en', () => profileButtons.execute(press(ids[1]), local, ['misje', member.id]));
  assert.match(replyText({ replies: [answers[1]] }), /Missions of Kuba/);
  assert.ok(answers.every((payload) => payload.flags));
});
