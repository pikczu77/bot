// 2026-10-15 (owner): slurs are never allowed, not even in the free hours after 22:00 or on the
// vulgar chat; swearing is free on the vulgar chat; that chat is visible only from 22:00 to 6:00.
import './helpers/env.js';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { Collection, OverwriteType, PermissionsBitField, PermissionFlagsBits } from 'discord.js';
import { initializeDatabase } from '../src/utils/database.js';
import { checkMessage, findSlur, getAutomodConfig, updateAutomodConfig } from '../src/services/automodService.js';
import { applyNightChannel } from '../src/services/nightChannel.js';
import { PRESET_SLURS, PRESET_WORDS } from '../src/config/automodPresets.js';

before(async () => {
  await initializeDatabase();
});

// Hours in Polish time (October = UTC+2).
const at = (hour) => Date.UTC(2026, 9, 16, (hour + 22) % 24, 30);

test('slurs: on by default, digits read as letters, innocent words pass', async () => {
  const config = await getAutomodConfig('900000000000000001', { fresh: true });
  assert.equal(config.rules.slurs.enabled, true);
  assert.deepEqual(config.rules.slurs.list, PRESET_SLURS);
  assert.ok(findSlur('ty cwelu', PRESET_SLURS));
  assert.ok(findSlur('N1GG3R', PRESET_SLURS));
  assert.ok(findSlur('czarnuchy', PRESET_SLURS));
  for (const fine of ['asfalt na drodze', 'bambus', 'Niger to kraj', 'nigdy', 'ciocia', 'night']) assert.equal(findSlur(fine, PRESET_SLURS), null, fine);
});

test('free hours and the vulgar chat allow swearing, never slurs', () => {
  const rules = {
    slurs: { enabled: true, action: 'warn', list: PRESET_SLURS },
    invites: { enabled: false }, links: { enabled: false, allow: [] },
    words: { enabled: true, action: 'delete', list: PRESET_WORDS, freeHours: true, freeFrom: 22, freeTo: 6, freeChannels: ['500000000000000009'] },
    spam: { enabled: false }, mentions: { enabled: false }, caps: { enabled: false }, duplicates: { enabled: false }, emojis: { enabled: false },
  };
  const config = { rules };
  const general = (content) => ({ content, mentionCount: 0, channelId: '500000000000000001', parentId: null });
  const vulgar = (content) => ({ content, mentionCount: 0, channelId: '500000000000000009', parentId: null });

  assert.equal(checkMessage(config, general('kurwa'), null, at(14))?.rule, 'words', 'daytime on a normal channel');
  assert.equal(checkMessage(config, general('kurwa'), null, at(23)), null, 'free hours');
  assert.equal(checkMessage(config, vulgar('kurwa'), null, at(14)), null, 'vulgar chat');
  assert.equal(checkMessage(config, general('ty cwelu'), null, at(23))?.rule, 'slurs', 'slurs after 22');
  assert.equal(checkMessage(config, vulgar('n1gger'), null, at(2))?.rule, 'slurs', 'slurs on the vulgar chat');
});

/** A channel whose permission overwrites behave like discord.js's, enough for nightChannel.js. */
function mockGuildWithChannel() {
  const everyoneId = '600000000000000000';
  const botId = '600000000000000099';
  const memberRole = '600000000000000001';
  const cache = new Collection();
  const set = (id, type, change) => {
    const current = cache.get(id) ?? { id, type, allow: new PermissionsBitField(), deny: new PermissionsBitField() };
    const allow = new PermissionsBitField(current.allow);
    const deny = new PermissionsBitField(current.deny);
    for (const [name, value] of Object.entries(change)) {
      const flag = PermissionFlagsBits[name];
      allow.remove(flag); deny.remove(flag);
      if (value === true) allow.add(flag);
      if (value === false) deny.add(flag);
    }
    cache.set(id, { id, type, allow, deny });
  };
  // As the admins set it up: @everyone nothing, the member role may see the channel.
  set(memberRole, OverwriteType.Role, { ViewChannel: true, SendMessages: true });
  const channel = {
    id: '700000000000000001', name: 'wulgarny-chat', client: { user: { id: botId } },
    permissionOverwrites: { cache, edit: async (id, change, { type }) => set(id, type, change) },
  };
  const guild = {
    id: '800000000000000001',
    roles: { everyone: { id: everyoneId } },
    members: { me: { id: botId } },
    channels: { cache: new Collection([[channel.id, channel]]) },
  };
  channel.guild = guild;
  const sees = (id) => cache.get(id)?.allow.has(PermissionFlagsBits.ViewChannel) ?? null;
  const hidden = (id) => cache.get(id)?.deny.has(PermissionFlagsBits.ViewChannel) ?? false;
  return { guild, channel, everyoneId, botId, memberRole, sees, hidden };
}

test('night channel: hidden for everyone 6-22, the admins\' setup comes back at 22', async () => {
  const { guild, everyoneId, botId, memberRole, sees, hidden } = mockGuildWithChannel();
  await updateAutomodConfig(guild.id, (config) => { config.nightChannel = { enabled: true, channelId: '700000000000000001', from: 22, to: 6 }; });

  assert.equal(await applyNightChannel(guild, at(23)), null, 'night: stays open');
  assert.equal(await applyNightChannel(guild, at(6)), 'closed');
  assert.ok(hidden(everyoneId) && hidden(memberRole), 'nobody sees it');
  assert.equal(sees(botId), true, 'the bot keeps access');
  assert.equal(await applyNightChannel(guild, at(14)), null, 'already closed');

  assert.equal(await applyNightChannel(guild, at(22)), 'opened');
  assert.equal(sees(memberRole), true, 'the member role sees it again');
  assert.equal(hidden(everyoneId), false, '@everyone back to how it was');

  // Turned off during the day: opened once and left alone.
  await applyNightChannel(guild, at(7));
  assert.ok(hidden(memberRole));
  await updateAutomodConfig(guild.id, (config) => { config.nightChannel.enabled = false; });
  assert.equal(await applyNightChannel(guild, at(8)), 'opened');
  assert.equal(sees(memberRole), true);
  assert.equal(await applyNightChannel(guild, at(9)), null);
});
