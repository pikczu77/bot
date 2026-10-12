// The control message of temporary voice channels: every button, menu and form, on stand-in Discord objects.
import './helpers/env.js';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { Collection, MessageFlags, MessageFlagsBitField, OverwriteType, PermissionsBitField } from 'discord.js';
import { mockChannel, mockGuild, mockMember, mockUser, replyText } from './helpers/mock.js';
import { runWithLocale } from '../src/i18n/index.js';
import { getJoinToCreateConfig, initializeDatabase, registerTemporaryChannel, saveJoinToCreateConfig } from '../src/utils/database.js';
import { buildInterfaceMessage, handleInterfaceInteraction } from '../src/services/tempVoiceInterface.js';

const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null } };
let guild;
let trigger;

// A voice channel with permission overwrites that behave like the real ones.
function mockVoice(name, members = []) {
  const overwrites = new Collection();
  const channel = mockChannel(guild, name, {
    type: 2,
    userLimit: 0,
    parentId: null,
    members: new Collection(),
    permissionOverwrites: {
      cache: overwrites,
      edit: async (id, options, { type } = {}) => {
        assert.ok(type === OverwriteType.Role || type === OverwriteType.Member, 'overwrite type is given');
        const overwrite = overwrites.get(id) ?? { id, type, allow: new PermissionsBitField(), deny: new PermissionsBitField() };
        for (const [permission, value] of Object.entries(options)) {
          overwrite.allow.remove(permission);
          overwrite.deny.remove(permission);
          if (value === true) overwrite.allow.add(permission);
          if (value === false) overwrite.deny.add(permission);
        }
        overwrites.set(id, overwrite);
      },
      delete: async (id) => { overwrites.delete(id); },
    },
    setName: async (value) => { channel.name = value; },
    setUserLimit: async (value) => { channel.userLimit = value; },
    setRTCRegion: async (value) => { channel.rtcRegion = value; },
    delete: async () => { guild.channels.cache.delete(channel.id); channel.deleted = true; },
  });
  for (const member of members) join(member, channel);
  return channel;
}

function join(member, channel) {
  member.voice?.channel?.members.delete(member.id);
  channel?.members.set(member.id, member);
  member.voice = {
    channel,
    channelId: channel?.id ?? null,
    disconnect: async () => join(member, null),
    setChannel: async (target) => join(member, guild.channels.cache.get(target?.id ?? target)),
  };
}

function person(name, extra = {}) {
  const member = mockMember(guild, mockUser(name, extra));
  join(member, null);
  return member;
}

// One click, menu choice or form of `member`; `hidden` = it comes from a hidden message of the bot.
async function act(member, customId, { values, fields, hidden = false, channelId = null } = {}) {
  const interaction = {
    guild,
    guildId: guild.id,
    channelId,
    member,
    user: member.user,
    customId,
    values,
    message: { flags: new MessageFlagsBitField(hidden ? MessageFlags.Ephemeral : 0) },
    fields: { getTextInputValue: (key) => fields[key] },
    replies: [],
    modals: [],
    replied: false,
    deferred: false,
    inGuild: () => true,
    isModalSubmit: () => Boolean(fields),
    isAnySelectMenu: () => Boolean(values),
    reply: async (payload) => { interaction.replied = true; interaction.replies.push(payload); },
    update: async (payload) => { interaction.updated = true; interaction.replies.push(payload); },
    followUp: async (payload) => { interaction.replies.push(payload); },
    showModal: async (modal) => { interaction.modals.push(modal.toJSON()); },
  };
  const [, ...args] = customId.split(':');
  await runWithLocale('en', () => handleInterfaceInteraction(interaction, client, args));
  return interaction;
}

const menuOf = (interaction) => interaction.replies.at(-1).components[0].toJSON().components[0];
const pair = (option) => [option.value, option.label];
const record = async (channel) => (await getJoinToCreateConfig(client, guild.id)).temporaryChannels[channel.id];
const can = (channel, id, permission) => channel.permissionOverwrites.cache.get(id)?.allow.has(permission) ?? false;
const cannot = (channel, id, permission) => channel.permissionOverwrites.cache.get(id)?.deny.has(permission) ?? false;

async function room(owner, others = [], name = 'Pokój') {
  const channel = mockVoice(name, [owner, ...others]);
  await registerTemporaryChannel(client, guild.id, channel.id, owner.id, trigger.id);
  return channel;
}

before(async () => {
  const { db } = await initializeDatabase();
  client.db = db;
  guild = mockGuild(client);
  guild.channels.create = async (options) => {
    const created = mockVoice(options.name);
    created.parentId = options.parent ?? null;
    created.createdWith = options.permissionOverwrites;
    return created;
  };
  trigger = mockVoice('➕ Stwórz kanał');
  await saveJoinToCreateConfig(client, guild.id, { enabled: true, triggerChannels: [trigger.id] });
});

test('the interface has fifteen buttons in three rows', async () => {
  const message = await runWithLocale('pl', () => buildInterfaceMessage({ triggerChannels: [trigger.id] }));
  const rows = message.components.map((row) => row.toJSON().components);
  assert.deepEqual(rows.map((row) => row.length), [5, 5, 5]);
  assert.deepEqual(rows.flat().map((button) => button.custom_id.replace('tempvoice:', '')), [
    'name', 'limit', 'privacy', 'waiting', 'chat', 'trust', 'untrust', 'invite', 'kick', 'region', 'block', 'unblock', 'claim', 'transfer', 'delete',
  ]);
  assert.deepEqual(rows[0].map((button) => button.label), ['Nazwa', 'Limit', 'Dostęp', 'Poczekalnia', 'Czat']);
  assert.deepEqual(rows[2].map((button) => button.label), ['Zablokuj', 'Odblokuj', 'Przejmij', 'Transferuj', 'Usuń']);
  const embed = message.embeds[0].toJSON();
  assert.equal(embed.title, 'Interfejs TempVoice');
  assert.match(embed.description, new RegExp(`<#${trigger.id}>`));
});

test('only the owner inside a temporary channel controls it', async () => {
  const owner = person('Wlasciciel');
  const guest = person('Gosc');
  const outsider = person('Obcy');
  const channel = await room(owner, [guest]);

  assert.match(replyText(await act(outsider, 'tempvoice:limit')), /Join your temporary voice channel first/);
  const refused = await act(guest, 'tempvoice:name');
  assert.match(replyText(refused), new RegExp(`Only the owner.*<@${owner.id}>`));
  assert.equal(refused.modals.length, 0);
  assert.equal(refused.replies[0].flags, MessageFlags.Ephemeral);

  // A person in an ordinary voice channel has no temporary channel either.
  join(outsider, trigger);
  assert.match(replyText(await act(outsider, 'tempvoice:delete')), /Join your temporary voice channel first/);
  assert.equal(channel.deleted, undefined);
});

test('name and limit are changed through a form', async () => {
  const owner = person('Zosia');
  const channel = await room(owner, [], 'Pokój Zosi');

  const form = (await act(owner, 'tempvoice:name')).modals[0];
  assert.equal(form.custom_id, 'tempvoice:name');
  assert.equal(form.components[0].components[0].value, 'Pokój Zosi');

  assert.match(replyText(await act(owner, 'tempvoice:name', { fields: { value: '  Granie   w CS 🎮 ' } })), /Granie w CS 🎮/);
  assert.equal(channel.name, 'Granie w CS 🎮');
  assert.match(replyText(await act(owner, 'tempvoice:name', { fields: { value: '   ' } })), /Enter a name/);

  // Discord takes two renames per ten minutes; the third one is refused instead of waiting in a queue.
  await act(owner, 'tempvoice:name', { fields: { value: 'Drugi' } });
  assert.match(replyText(await act(owner, 'tempvoice:name', { fields: { value: 'Trzeci' } })), /2 name changes per 10 minutes/);
  assert.equal(channel.name, 'Drugi');

  await act(owner, 'tempvoice:limit', { fields: { value: '4' } });
  assert.equal(channel.userLimit, 4);
  for (const value of ['100', '-1', 'pięć', '']) {
    assert.match(replyText(await act(owner, 'tempvoice:limit', { fields: { value } })), /between 0/);
  }
  assert.equal(channel.userLimit, 4);
  assert.match(replyText(await act(owner, 'tempvoice:limit', { fields: { value: '0' } })), /no user limit/);
});

test('privacy, chat and region', async () => {
  const owner = person('Kuba');
  const channel = await room(owner);
  const everyone = guild.id;
  const bot = guild.members.me.id;

  const menu = menuOf(await act(owner, 'tempvoice:privacy'));
  assert.deepEqual(menu.options.map((option) => option.value), ['lock', 'unlock', 'hide', 'show']);

  const locked = await act(owner, 'tempvoice:privacy', { values: ['lock'], hidden: true });
  assert.ok(locked.updated, 'the answer replaces the menu');
  assert.ok(cannot(channel, everyone, 'Connect'));
  // The owner and the bot keep access to a locked or hidden channel.
  assert.ok(can(channel, owner.id, 'Connect') && can(channel, owner.id, 'ViewChannel'));
  assert.ok(can(channel, bot, 'Connect') && can(channel, bot, 'ViewChannel'));

  await act(owner, 'tempvoice:privacy', { values: ['hide'], hidden: true });
  assert.ok(cannot(channel, everyone, 'ViewChannel'));
  await act(owner, 'tempvoice:privacy', { values: ['show'], hidden: true });
  await act(owner, 'tempvoice:privacy', { values: ['unlock'], hidden: true });
  assert.ok(!cannot(channel, everyone, 'ViewChannel') && !cannot(channel, everyone, 'Connect') && can(channel, everyone, 'Connect'));
  assert.match(replyText(await act(owner, 'tempvoice:privacy', { values: ['open'], hidden: true })), /not available/);

  assert.match(replyText(await act(owner, 'tempvoice:chat')), /closed/);
  assert.ok(cannot(channel, everyone, 'SendMessages'));
  assert.match(replyText(await act(owner, 'tempvoice:chat')), /open again/);
  assert.ok(!cannot(channel, everyone, 'SendMessages'));

  const regions = menuOf(await act(owner, 'tempvoice:region')).options.map((option) => option.value);
  assert.ok(regions[0] === 'auto' && regions.includes('rotterdam'));
  await act(owner, 'tempvoice:region', { values: ['rotterdam'], hidden: true });
  assert.equal(channel.rtcRegion, 'rotterdam');
  await act(owner, 'tempvoice:region', { values: ['auto'], hidden: true });
  assert.equal(channel.rtcRegion, null);
});

test('trust, block, invite and kick', async () => {
  const owner = person('Ola');
  const friend = person('Przyjaciel');
  const troll = person('Troll');
  const quiet = person('Cichy', { send: async () => { throw new Error('Cannot send messages to this user'); } });
  const channel = await room(owner, [troll]);
  const direct = [];
  friend.send = async (payload) => { direct.push(payload); };
  quiet.send = quiet.user.send;

  assert.match(replyText(await act(owner, 'tempvoice:untrust')), /Nobody is trusted/);
  assert.equal(menuOf(await act(owner, 'tempvoice:trust')).type, 5, 'a member menu');
  await act(owner, 'tempvoice:trust', { values: [friend.id, owner.id], hidden: true });
  assert.ok(can(channel, friend.id, 'Connect') && can(channel, friend.id, 'ViewChannel'));
  assert.deepEqual(menuOf(await act(owner, 'tempvoice:untrust')).options.map(pair), [[friend.id, 'Przyjaciel']]);
  await act(owner, 'tempvoice:untrust', { values: [friend.id], hidden: true });
  assert.equal(channel.permissionOverwrites.cache.has(friend.id), false);

  // A blocked person is cut off and cannot see the channel.
  assert.match(replyText(await act(owner, 'tempvoice:unblock')), /Nobody is blocked/);
  await act(owner, 'tempvoice:block', { values: [troll.id], hidden: true });
  assert.ok(cannot(channel, troll.id, 'Connect') && cannot(channel, troll.id, 'ViewChannel'));
  assert.equal(channel.members.has(troll.id), false);
  assert.deepEqual(menuOf(await act(owner, 'tempvoice:unblock')).options.map((option) => option.value), [troll.id]);
  await act(owner, 'tempvoice:unblock', { values: [troll.id], hidden: true });
  assert.equal(channel.permissionOverwrites.cache.has(troll.id), false);

  // An invitation gives access and a private message with the link; closed messages are reported.
  const invited = await act(owner, 'tempvoice:invite', { values: [friend.id, quiet.id], hidden: true });
  assert.equal(direct.length, 1);
  assert.match(direct[0].content, new RegExp(`Ola.*Pokój.*https://discord.com/channels/${guild.id}/${channel.id}`));
  assert.match(replyText(invited), new RegExp(`Invited: <@${friend.id}>`));
  assert.match(replyText(invited), new RegExp(`<@${quiet.id}> can join, but the private message did not arrive`));
  assert.ok(can(channel, quiet.id, 'Connect'));
  await act(owner, 'tempvoice:invite', { values: [friend.id], hidden: true });
  await act(owner, 'tempvoice:invite', { values: [friend.id], hidden: true });
  assert.match(replyText(await act(owner, 'tempvoice:invite', { values: [friend.id], hidden: true })), /too quickly/);
  assert.equal(direct.length, 3);

  assert.match(replyText(await act(owner, 'tempvoice:kick')), /Nobody else/);
  join(friend, channel);
  assert.deepEqual(menuOf(await act(owner, 'tempvoice:kick')).options.map(pair), [[friend.id, 'Przyjaciel']]);
  await act(owner, 'tempvoice:kick', { values: [friend.id], hidden: true });
  assert.equal(channel.members.has(friend.id), false);
  assert.match(replyText(await act(owner, 'tempvoice:kick', { values: [friend.id], hidden: true })), /already left/);
});

test('claim and transfer move the ownership', async () => {
  const owner = person('Stary');
  const guest = person('Nowy');
  const helper = person('Pomocnik', { bot: true });
  const channel = await room(owner, [guest, helper]);
  await channel.permissionOverwrites.edit(owner.id, { Connect: true, Speak: true, PrioritySpeaker: true, MoveMembers: true }, { type: OverwriteType.Member });

  assert.match(replyText(await act(owner, 'tempvoice:claim')), /already yours/);
  assert.match(replyText(await act(guest, 'tempvoice:claim')), /still in the channel/);

  // The owner left: the channel stays theirs until somebody inside claims it.
  join(owner, null);
  assert.equal((await record(channel)).ownerId, owner.id);
  assert.match(replyText(await act(guest, 'tempvoice:claim')), /yours now/);
  assert.equal((await record(channel)).ownerId, guest.id);
  assert.ok(can(channel, guest.id, 'MoveMembers') && can(channel, guest.id, 'PrioritySpeaker'));
  assert.ok(!can(channel, owner.id, 'MoveMembers') && can(channel, owner.id, 'Connect'));

  // Only people (no bots) are offered as the next owner.
  assert.match(replyText(await act(guest, 'tempvoice:transfer')), /Nobody else/);
  join(owner, channel);
  assert.deepEqual(menuOf(await act(guest, 'tempvoice:transfer')).options.map((option) => option.value), [owner.id]);
  assert.match(replyText(await act(guest, 'tempvoice:transfer', { values: [helper.id], hidden: true })), /not in your channel/);
  await act(guest, 'tempvoice:transfer', { values: [owner.id], hidden: true });
  assert.equal((await record(channel)).ownerId, owner.id);
  assert.match(replyText(await act(guest, 'tempvoice:limit')), /Only the owner/);
});

test('the waiting room locks the channel and the owner lets people in', async () => {
  const owner = person('Gospodarz');
  const visitor = person('Wizyta');
  const channel = await room(owner, [], 'Salon');
  const { announceWaitingMember } = await import('../src/services/tempVoiceInterface.js');

  assert.match(replyText(await act(owner, 'tempvoice:waiting')), /waiting room .* is open/);
  const { waitingRoomId } = await record(channel);
  const waitingRoom = guild.channels.cache.get(waitingRoomId);
  assert.equal(waitingRoom.name, '⏳ Salon');
  assert.ok(cannot(channel, guild.id, 'Connect') && can(channel, owner.id, 'Connect'));
  assert.ok(waitingRoom.createdWith.some((overwrite) => overwrite.id === guild.id && overwrite.deny.length === 1));

  // A person in the waiting room is announced in the chat of the channel; the owner alone decides.
  join(visitor, waitingRoom);
  const config = await getJoinToCreateConfig(client, guild.id);
  assert.equal(await runWithLocale('en', () => announceWaitingMember(guild, config, waitingRoom.id, visitor)), true);
  assert.equal(await announceWaitingMember(guild, config, channel.id, visitor), false);
  const notice = channel.sent.at(-1);
  assert.equal(notice.content, `<@${owner.id}>`);
  assert.deepEqual(notice.components[0].toJSON().components.map((button) => button.custom_id), [`tempvoice:admit:${visitor.id}`, `tempvoice:reject:${visitor.id}`]);

  assert.match(replyText(await act(visitor, `tempvoice:admit:${visitor.id}`, { channelId: channel.id })), /Only the owner/);
  assert.equal(visitor.voice.channelId, waitingRoom.id);
  const admitted = await act(owner, `tempvoice:admit:${visitor.id}`, { channelId: channel.id });
  assert.equal(visitor.voice.channelId, channel.id);
  assert.deepEqual(admitted.replies.at(-1).components, []);

  join(visitor, waitingRoom);
  await act(owner, `tempvoice:reject:${visitor.id}`, { channelId: channel.id });
  assert.equal(visitor.voice.channelId, null);
  assert.match(replyText(await act(owner, `tempvoice:admit:${visitor.id}`, { channelId: channel.id })), /no longer waiting/);

  // Deleting the channel removes the waiting room and the stored record.
  const ask = await act(owner, 'tempvoice:delete');
  assert.equal(ask.replies[0].components[0].toJSON().components[0].custom_id, 'tempvoice:delete_confirm');
  assert.equal(channel.deleted, undefined);
  await act(owner, 'tempvoice:delete_confirm', { hidden: true });
  assert.ok(channel.deleted && waitingRoom.deleted);
  assert.equal(await record(channel), undefined);
});

test('a second press of "Waiting Room" removes it; missing permissions are explained', async () => {
  const owner = person('Ala');
  const channel = await room(owner);

  await act(owner, 'tempvoice:waiting');
  const waitingRoom = guild.channels.cache.get((await record(channel)).waitingRoomId);
  assert.match(replyText(await act(owner, 'tempvoice:waiting')), /waiting room is removed/);
  assert.ok(waitingRoom.deleted);
  assert.equal((await record(channel)).waitingRoomId, undefined);

  channel.setUserLimit = async () => { throw Object.assign(new Error('Missing Permissions'), { code: 50013 }); };
  assert.match(replyText(await act(owner, 'tempvoice:limit', { fields: { value: '3' } })), /missing permissions.*Manage Channels/);
});

test('the owner keeps the channel after leaving; an empty channel is deleted', async () => {
  const { default: voiceStateUpdate } = await import('../src/events/voiceStateUpdate.js');
  const owner = person('Pierwszy');
  const guest = person('Drugi');
  const channel = await room(owner, [guest], 'Pokój Pierwszego');
  const state = (member, target) => ({ member, guild, channel: target });

  join(owner, null);
  await voiceStateUpdate.execute(state(owner, channel), state(owner, null), client);
  assert.equal((await record(channel)).ownerId, owner.id);
  assert.equal(channel.name, 'Pokój Pierwszego');
  assert.equal(channel.deleted, undefined);

  join(guest, null);
  await voiceStateUpdate.execute(state(guest, channel), state(guest, null), client);
  assert.ok(channel.deleted);
  assert.equal(await record(channel), undefined);
});
