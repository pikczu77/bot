// 2026-10-15 (owner): slurs are never allowed, not even in the free hours after 22:00 or on the
// vulgar chat; swearing is free on the vulgar chat; that chat is visible only from 22:00 to 6:00.
import './helpers/env.js';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { Collection, OverwriteType, PermissionsBitField, PermissionFlagsBits } from 'discord.js';
import { initializeDatabase } from '../src/utils/database.js';
import { checkMessage, findBannedWord, findSlur, getAutomodConfig, updateAutomodConfig } from '../src/services/automodService.js';
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

// 2026-10-26 (owner): sexual words go too; nudes, pedofil and the like never, also on the night chat.
test('words for a young audience: swear list or never-list, innocent words pass', () => {
  for (const bad of ['ty stulejarzu', 'dih', 'pokaz cycki', 'walic konia', 'Seks', 'zboczeniec']) assert.ok(findBannedWord(bad, PRESET_WORDS), bad);
  for (const bad of ['wyślij nudesy', 'NUDES', 'pedofil', 'ty pedofilu', 'p3d0f1l', 'pornhub', 'r34']) assert.ok(findSlur(bad, PRESET_SLURS), bad);
  for (const fine of ['nudy na lekcji', 'pedagog', 'zboczenie z trasy', 'cyklon', 'stulecie', 'porcja', 'koktajl', 'sekunda']) {
    assert.equal(findBannedWord(fine, PRESET_WORDS), null, fine);
    assert.equal(findSlur(fine, PRESET_SLURS), null, fine);
  }
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

/** Channels whose permission overwrites behave like discord.js's, enough for nightChannel.js. */
function mockGuildWithChannels(guildId, channelIds) {
  const everyoneId = '600000000000000000';
  const botId = '600000000000000099';
  const memberRole = '600000000000000001';
  const guild = {
    id: guildId,
    roles: { everyone: { id: everyoneId } },
    members: { me: { id: botId } },
    channels: { cache: new Collection() },
  };
  const views = {};
  for (const id of channelIds) {
    const cache = new Collection();
    const set = (target, type, change) => {
      const current = cache.get(target) ?? { id: target, type, allow: new PermissionsBitField(), deny: new PermissionsBitField() };
      const allow = new PermissionsBitField(current.allow);
      const deny = new PermissionsBitField(current.deny);
      for (const [name, value] of Object.entries(change)) {
        const flag = PermissionFlagsBits[name];
        allow.remove(flag); deny.remove(flag);
        if (value === true) allow.add(flag);
        if (value === false) deny.add(flag);
      }
      cache.set(target, { id: target, type, allow, deny });
    };
    // As the admins set it up: @everyone nothing, the member role may see the channel.
    set(memberRole, OverwriteType.Role, { ViewChannel: true, SendMessages: true });
    const channel = {
      id, name: `kanal-${id.slice(-2)}`, guild, client: { user: { id: botId } },
      permissionOverwrites: { cache, edit: async (target, change, { type }) => set(target, type, change) },
    };
    guild.channels.cache.set(id, channel);
    views[id] = {
      sees: (target) => cache.get(target)?.allow.has(PermissionFlagsBits.ViewChannel) ?? null,
      hidden: (target) => cache.get(target)?.deny.has(PermissionFlagsBits.ViewChannel) ?? false,
    };
  }
  return { guild, everyoneId, botId, memberRole, views };
}

const VULGAR = '700000000000000001';
const EVENING = '700000000000000002';

test('night channel: hidden for everyone 6-22, the admins\' setup comes back at 22', async () => {
  const { guild, everyoneId, botId, memberRole, views } = mockGuildWithChannels('800000000000000001', [VULGAR]);
  const { sees, hidden } = views[VULGAR];
  await updateAutomodConfig(guild.id, (config) => { config.nightChannels = [{ channelId: VULGAR, from: 22, to: 6 }]; });

  assert.deepEqual(await applyNightChannel(guild, at(23)), {}, 'night: stays open');
  assert.deepEqual(await applyNightChannel(guild, at(6)), { [VULGAR]: 'closed' });
  assert.ok(hidden(everyoneId) && hidden(memberRole), 'nobody sees it');
  assert.equal(sees(botId), true, 'the bot keeps access');
  assert.deepEqual(await applyNightChannel(guild, at(14)), {}, 'already closed');

  assert.deepEqual(await applyNightChannel(guild, at(22)), { [VULGAR]: 'opened' });
  assert.equal(sees(memberRole), true, 'the member role sees it again');
  assert.equal(hidden(everyoneId), false, '@everyone back to how it was');

  // Taken off the list during the day: opened once and left alone.
  await applyNightChannel(guild, at(7));
  assert.ok(hidden(memberRole));
  await updateAutomodConfig(guild.id, (config) => { config.nightChannels = []; });
  assert.deepEqual(await applyNightChannel(guild, at(8)), { [VULGAR]: 'opened' });
  assert.equal(sees(memberRole), true);
  assert.deepEqual(await applyNightChannel(guild, at(9)), {});
});

test('several channels, each with its own hours; parallel runs remember the setup once', async () => {
  const { guild, everyoneId, memberRole, views } = mockGuildWithChannels('800000000000000002', [VULGAR, EVENING]);
  await updateAutomodConfig(guild.id, (config) => {
    config.nightChannels = [{ channelId: VULGAR, from: 22, to: 6 }, { channelId: EVENING, from: 18, to: 23 }];
  });

  // The minute job and a panel save at the same moment: one closes, the other finds it closed.
  const [first, second] = await Promise.all([applyNightChannel(guild, at(12)), applyNightChannel(guild, at(12))]);
  assert.deepEqual(first, { [VULGAR]: 'closed', [EVENING]: 'closed' });
  assert.deepEqual(second, {});

  assert.deepEqual(await applyNightChannel(guild, at(19)), { [EVENING]: 'opened' });
  assert.equal(views[EVENING].sees(memberRole), true);
  assert.ok(views[VULGAR].hidden(memberRole), 'the night channel is still closed at 19');

  assert.deepEqual(await applyNightChannel(guild, at(22)), { [VULGAR]: 'opened' });
  assert.deepEqual(await applyNightChannel(guild, at(23)), { [EVENING]: 'closed' });
  assert.equal(views[VULGAR].sees(memberRole), true);
  assert.equal(views[VULGAR].hidden(everyoneId), false);
  assert.ok(views[EVENING].hidden(everyoneId) && views[EVENING].hidden(memberRole));
});

test('the single night channel saved before 2026-10-17 becomes the first list entry and opens as before', async () => {
  const { guild, memberRole, views } = mockGuildWithChannels('800000000000000003', [VULGAR]);
  const { guildStore } = await import('../src/utils/featureKit.js');
  // Stored by the old code while the channel was closed during the day.
  await guildStore('automod', {}).set(guild.id, { enabled: false, nightChannel: { enabled: true, channelId: VULGAR, from: 22, to: 6 } });
  await guildStore('night-channel', {}).set(guild.id, { channelId: VULGAR, closed: true, everyone: null, allowed: [{ id: memberRole, type: OverwriteType.Role }] });
  await guild.channels.cache.get(VULGAR).permissionOverwrites.edit(memberRole, { ViewChannel: false }, { type: OverwriteType.Role });

  const config = await getAutomodConfig(guild.id, { fresh: true });
  assert.deepEqual(config.nightChannels, [{ channelId: VULGAR, from: 22, to: 6 }]);
  assert.equal(config.nightChannel, undefined);
  assert.deepEqual(await applyNightChannel(guild, at(14)), {}, 'already closed by the old code');
  assert.deepEqual(await applyNightChannel(guild, at(22)), { [VULGAR]: 'opened' });
  assert.equal(views[VULGAR].sees(memberRole), true, 'the role remembered by the old code sees it again');

  // A turned-off old night channel is not carried over.
  await guildStore('automod', {}).set('800000000000000004', { nightChannel: { enabled: false, channelId: VULGAR, from: 22, to: 6 } });
  assert.deepEqual((await getAutomodConfig('800000000000000004', { fresh: true })).nightChannels, []);
});

test('closing that fails half-way keeps what was remembered and is retried', async () => {
  const { guild, everyoneId, memberRole, views } = mockGuildWithChannels('800000000000000005', [VULGAR]);
  const channel = guild.channels.cache.get(VULGAR);
  const edit = channel.permissionOverwrites.edit;
  let fail = true;
  channel.permissionOverwrites.edit = async (target, change, options) => {
    if (fail && target === memberRole) throw new Error('Missing Permissions');
    return edit(target, change, options);
  };
  await updateAutomodConfig(guild.id, (config) => { config.nightChannels = [{ channelId: VULGAR, from: 22, to: 6 }]; });

  assert.deepEqual(await applyNightChannel(guild, at(10)), {}, 'the failure is logged, not thrown');
  assert.ok(views[VULGAR].hidden(everyoneId));
  fail = false;
  assert.deepEqual(await applyNightChannel(guild, at(10)), { [VULGAR]: 'closed' }, 'retried a minute later');
  assert.ok(views[VULGAR].hidden(memberRole));
  assert.deepEqual(await applyNightChannel(guild, at(22)), { [VULGAR]: 'opened' });
  assert.equal(views[VULGAR].sees(memberRole), true, 'the member role was remembered before the failure');
});
