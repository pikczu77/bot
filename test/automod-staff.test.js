// Swearing rules for everyone (2026-11-01, owner: "ban na przeklenstwa maja dzialac na wszystkich, nie tylko ludzi zwyklych,
// moderacje tez"). Moderators and exempt roles skip the other rules; exempt channels skip everything.
import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Collection, PermissionsBitField, PermissionFlagsBits } from 'discord.js';
import { initializeDatabase } from '../src/utils/database.js';
import { runAutomod, updateAutomodConfig } from '../src/services/automodService.js';

const GUILD = '900000000000000077';
const MOD_ROLE = '900000000000000078';
const FREE_CHANNEL = '900000000000000079';
let nextId = 1;

function fakeMessage(content, { permissions = [], roles = [], channelId = '900000000000000080' } = {}) {
  const authorId = `9100000000000000${String(nextId++).padStart(2, '0')}`;
  const message = {
    content,
    deleted: false,
    guild: { id: GUILD, channels: { cache: new Collection() } },
    client: { user: { id: '1' } },
    author: { id: authorId, tag: 'someone', toString: () => `<@${authorId}>`, displayAvatarURL: () => '' },
    member: {
      permissions: new PermissionsBitField(permissions),
      roles: { cache: new Collection(roles.map((id) => [id, { id }])) },
      moderatable: false,
    },
    channelId,
    channel: { parentId: null, send: async () => null, toString: () => `<#${channelId}>` },
    mentions: { users: new Collection(), roles: new Collection(), everyone: false },
    delete: async () => { message.deleted = true; },
  };
  return message;
}

test('moderators and exempt roles: swearing and slurs are deleted, other rules leave them alone', async () => {
  await initializeDatabase();
  await updateAutomodConfig(GUILD, (config) => {
    config.enabled = true;
    config.exemptRoles = [MOD_ROLE];
    config.exemptChannels = [FREE_CHANNEL];
    config.rules.slurs = { ...config.rules.slurs, action: 'delete' };
    config.rules.words = { ...config.rules.words, enabled: true, action: 'delete', list: ['*kurw*'] };
    config.rules.links = { ...config.rules.links, enabled: true, allow: [] };
    config.rules.caps = { ...config.rules.caps, enabled: true };
  });

  const moderator = { permissions: [PermissionFlagsBits.ManageMessages] };
  const admin = { permissions: [PermissionFlagsBits.Administrator] };
  const exemptRole = { roles: [MOD_ROLE] };
  for (const [who, options] of [['moderator', moderator], ['administrator', admin], ['exempt role', exemptRole], ['member', {}]]) {
    assert.equal(await runAutomod(fakeMessage('no kurwa', options)), true, `${who}: banned word`);
    assert.equal(await runAutomod(fakeMessage('ty cwelu', options)), true, `${who}: slur`);
  }
  for (const [who, options] of [['moderator', moderator], ['administrator', admin], ['exempt role', exemptRole]]) {
    assert.equal(await runAutomod(fakeMessage('patrz https://example.com', options)), false, `${who}: links stay allowed`);
    assert.equal(await runAutomod(fakeMessage('TO JEST BARDZO WAZNE OGLOSZENIE', options)), false, `${who}: caps stay allowed`);
  }
  assert.equal(await runAutomod(fakeMessage('patrz https://example.com')), true, 'a member still gets the links rule');

  assert.equal(await runAutomod(fakeMessage('no kurwa', { ...moderator, channelId: FREE_CHANNEL })), false, 'exempt channel: nothing');
  assert.equal(await runAutomod(fakeMessage('ty cwelu', { channelId: FREE_CHANNEL })), false, 'exempt channel: nothing for anyone');
});
