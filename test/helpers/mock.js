// Minimal stand-ins for discord.js objects, enough to run commands end to end.
import { Collection, PermissionsBitField } from 'discord.js';

let nextId = 100000000000000000n;
export const snowflake = () => String(nextId += 1n);

export function mockRole(guild, name, extra = {}) {
  const role = {
    id: snowflake(),
    name,
    managed: false,
    editable: true,
    mentionable: false,
    hoist: false,
    position: 1,
    color: 0,
    hexColor: '#000000',
    createdTimestamp: Date.now() - 86_400_000,
    members: new Collection(),
    toString() { return `<@&${this.id}>`; },
    ...extra,
  };
  guild.roles.cache.set(role.id, role);
  return role;
}

export function mockUser(name, extra = {}) {
  const id = snowflake();
  return {
    id,
    username: name,
    displayName: name,
    tag: name,
    bot: false,
    createdTimestamp: Date.now() - 400 * 86_400_000,
    displayAvatarURL: () => `https://cdn.example/avatars/${id}.png`,
    toString() { return `<@${id}>`; },
    send: async () => ({}),
    ...extra,
  };
}

export function mockMember(guild, user, { permissions = [], roles = [] } = {}) {
  const bitfield = new PermissionsBitField(permissions);
  const member = {
    id: user.id,
    user,
    guild,
    displayName: user.displayName,
    joinedTimestamp: Date.now() - 30 * 86_400_000,
    permissions: bitfield,
    moderatable: true,
    manageable: true,
    kickable: true,
    bannable: true,
    roles: {
      cache: new Collection(roles.map((role) => [role.id, role])),
      highest: { position: 10, comparePositionTo: () => 1 },
      add: async (role) => { member.roles.cache.set(role.id, role); },
      remove: async (role) => { member.roles.cache.delete(role.id); },
    },
    displayAvatarURL: () => user.displayAvatarURL(),
    toString() { return `<@${user.id}>`; },
  };
  guild.members.cache.set(user.id, member);
  return member;
}

export function mockChannel(guild, name, extra = {}) {
  const sent = [];
  const channel = {
    id: snowflake(),
    name,
    guild,
    type: 0,
    topic: null,
    parentId: null,
    position: 0,
    sent,
    isTextBased: () => true,
    isThread: () => false,
    permissionsFor: () => new PermissionsBitField(PermissionsBitField.All),
    send: async (payload) => {
      const message = { id: snowflake(), ...((typeof payload === 'string') ? { content: payload } : payload), delete: async () => {}, edit: async () => {} };
      sent.push(message);
      return message;
    },
    messages: { fetch: async () => null, delete: async () => {} },
    setRateLimitPerUser: async (seconds) => { channel.rateLimitPerUser = seconds; },
    toString() { return `<#${this.id}>`; },
    ...extra,
  };
  guild.channels.cache.set(channel.id, channel);
  return channel;
}

export function mockGuild(client, name = 'Klubik Pikcza') {
  const id = snowflake();
  const guild = {
    id,
    name,
    client,
    ownerId: '1',
    memberCount: 321,
    features: [],
    iconURL: () => null,
    roles: { cache: new Collection(), everyone: { id } },
    channels: { cache: new Collection(), create: async (options) => mockChannel(guild, options.name, options) },
    members: {
      cache: new Collection(),
      me: null,
      fetch: async (userId) => (userId ? guild.members.cache.get(userId) ?? Promise.reject(new Error('Unknown Member')) : guild.members.cache),
      ban: async () => {},
      unban: async () => {},
    },
    invites: { fetch: async () => new Collection() },
  };
  guild.roles.cache.set(id, { id, name: '@everyone' });
  const botUser = mockUser('Klubik Pikcza', { bot: true });
  guild.members.me = mockMember(guild, botUser, { permissions: [PermissionsBitField.All] });
  client.guilds.cache.set(id, guild);
  client.user ??= botUser;
  return guild;
}

/**
 * A chat-input interaction. `options` maps option name -> value (users, roles and
 * channels are passed as the mock objects themselves).
 */
export function mockInteraction({ client, guild, channel, member, commandName, subcommand = null, group = null, options = {} }) {
  const replies = [];
  const value = (name) => (name in options ? options[name] : null);
  const interaction = {
    id: snowflake(),
    client,
    guild,
    guildId: guild?.id ?? null,
    channel,
    channelId: channel?.id ?? null,
    member,
    user: member.user,
    commandName,
    createdTimestamp: Date.now(),
    replied: false,
    deferred: false,
    replies,
    inGuild: () => Boolean(guild),
    isChatInputCommand: () => true,
    options: {
      getSubcommand: () => subcommand,
      getSubcommandGroup: () => group,
      getString: value,
      getInteger: value,
      getNumber: value,
      getBoolean: value,
      getUser: value,
      getMember: (name) => (value(name) ? guild.members.cache.get(value(name).id) ?? null : null),
      getRole: value,
      getChannel: value,
      getFocused: () => '',
    },
    reply: async (payload) => { interaction.replied = true; replies.push(payload); return { resource: { message: null } }; },
    deferReply: async () => { interaction.deferred = true; },
    editReply: async (payload) => { replies.push(payload); return {}; },
    followUp: async (payload) => { replies.push(payload); return {}; },
    fetchReply: async () => ({ awaitMessageComponent: async () => { throw new Error('no component'); } }),
  };
  return interaction;
}

/** Text of the last reply: content plus every embed title/description/field/footer. */
export function replyText(interaction) {
  const payload = interaction.replies.at(-1);
  if (!payload) return '';
  const parts = [payload.content ?? ''];
  for (const embed of payload.embeds ?? []) {
    const data = embed.toJSON ? embed.toJSON() : embed;
    parts.push(data.author?.name ?? '', data.title ?? '', data.description ?? '');
    for (const field of data.fields ?? []) parts.push(field.name, field.value);
    parts.push(data.footer?.text ?? '');
  }
  return parts.filter(Boolean).join('\n');
}
