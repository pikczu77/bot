// Levels given back from level roles after the data file was lost (src/services/leveling/levelRestore.js).
import './helpers/env.js';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { Collection } from 'discord.js';
import { mockGuild, mockMember, mockRole, mockUser } from './helpers/mock.js';
import { initializeDatabase } from '../src/utils/database.js';
import { calculateTotalXp, getLevelingConfig, getUserLevelData, saveLevelingConfig, saveUserLevelData } from '../src/services/leveling/leveling.js';
import { levelFromRoleName, restoreLevelsFromRoles, restoreLevelsOnce, RESTORE_MARKER } from '../src/services/leveling/levelRestore.js';
import { reconcileLevelRoles } from '../src/services/leveling/levelRoleSyncService.js';

const client = { guilds: { cache: new Collection() }, users: { fetch: async () => null } };

before(async () => {
  const { db } = await initializeDatabase();
  client.db = db;
});

test('level role names', () => {
  assert.equal(levelFromRoleName('LVL 50'), 50);
  assert.equal(levelFromRoleName('lvl3'), 3);
  assert.equal(levelFromRoleName('Level 10'), 10);
  assert.equal(levelFromRoleName('Poziom 25'), 25);
  assert.equal(levelFromRoleName('LVL 0'), null);
  assert.equal(levelFromRoleName('Halloween 2026'), null);
  assert.equal(levelFromRoleName('LVL 5 VIP'), null);
  assert.equal(levelFromRoleName('admin'), null);
});

test('members get the level of their highest level role, never lower, and the rewards come back', async () => {
  const guild = mockGuild(client, 'Restore');
  const lvl5 = mockRole(guild, 'LVL 5');
  const lvl25 = mockRole(guild, 'LVL 25');
  const other = mockRole(guild, 'Halloween 2026');

  const both = mockMember(guild, mockUser('both'), { roles: [lvl5, lvl25] });
  const five = mockMember(guild, mockUser('five'), { roles: [lvl5, other] });
  const higher = mockMember(guild, mockUser('higher'), { roles: [lvl5] });
  const none = mockMember(guild, mockUser('none'), { roles: [other] });
  await saveUserLevelData(client, guild.id, higher.id, { xp: 40, level: 8, totalXp: calculateTotalXp(8, 40) });

  const summary = await restoreLevelsFromRoles(client, guild);
  assert.deepEqual(summary, { levelRoles: 2, members: 3, restored: 2, rewardsAdded: 2 });

  const bothData = await getUserLevelData(client, guild.id, both.id);
  assert.equal(bothData.level, 25);
  assert.equal(bothData.xp, 0);
  assert.equal(bothData.totalXp, calculateTotalXp(25, 0));
  assert.equal((await getUserLevelData(client, guild.id, five.id)).level, 5);
  assert.equal((await getUserLevelData(client, guild.id, higher.id)).level, 8, 'a higher level stays');
  assert.equal((await getUserLevelData(client, guild.id, higher.id)).xp, 40);
  assert.equal((await getUserLevelData(client, guild.id, none.id)).level, 0);
  assert.equal((await getUserLevelData(client, guild.id, guild.members.me.id)).level, 0, 'bots are skipped');

  const config = await getLevelingConfig(client, guild.id);
  assert.deepEqual(config.roleRewards, { 5: lvl5.id, 25: lvl25.id });
});

test('reward roles set in the panel are kept and count even without a level name', async () => {
  const guild = mockGuild(client, 'Rewards');
  const named = mockRole(guild, 'Weteran');
  mockRole(guild, 'LVL 3');
  const config = await getLevelingConfig(client, guild.id);
  config.roleRewards = { 30: named.id };
  await saveLevelingConfig(client, guild.id, config);
  const member = mockMember(guild, mockUser('vet'), { roles: [named] });

  const summary = await restoreLevelsFromRoles(client, guild);
  assert.equal(summary.rewardsAdded, 0);
  assert.equal((await getUserLevelData(client, guild.id, member.id)).level, 30);
  assert.deepEqual((await getLevelingConfig(client, guild.id)).roleRewards, { 30: named.id });
});

test('a server that kept only the highest role keeps it that way at the role sync', async () => {
  const guild = mockGuild(client, 'Highest');
  const lvl3 = mockRole(guild, 'LVL 3');
  const lvl10 = mockRole(guild, 'LVL 10');
  const lvl50 = mockRole(guild, 'LVL 50');
  const top = mockMember(guild, mockUser('top'), { roles: [lvl50] });
  mockMember(guild, mockUser('mid'), { roles: [lvl10] });
  mockMember(guild, mockUser('low'), { roles: [lvl3] });

  const summary = await restoreLevelsFromRoles(client, guild);
  assert.equal(summary.onlyHighest, true);
  assert.equal((await getLevelingConfig(client, guild.id)).removePreviousRoles, true);

  await reconcileLevelRoles(client, guild.id);
  assert.deepEqual([...top.roles.cache.keys()], [lvl50.id], 'no lower roles handed out');
});

test('a server that stacked the roles still gets the missing lower ones', async () => {
  const guild = mockGuild(client, 'Stacked');
  const lvl3 = mockRole(guild, 'LVL 3');
  const lvl10 = mockRole(guild, 'LVL 10');
  const lvl50 = mockRole(guild, 'LVL 50');
  const top = mockMember(guild, mockUser('top'), { roles: [lvl50] });
  mockMember(guild, mockUser('mid'), { roles: [lvl3, lvl10] });
  mockMember(guild, mockUser('mid2'), { roles: [lvl3, lvl10] });

  const summary = await restoreLevelsFromRoles(client, guild);
  assert.equal(summary.onlyHighest, undefined);
  await reconcileLevelRoles(client, guild.id);
  assert.deepEqual(new Set(top.roles.cache.keys()), new Set([lvl3.id, lvl10.id, lvl50.id]));
});

test('runs once per data file', async () => {
  await client.db.delete(RESTORE_MARKER);
  const guild = mockGuild(client, 'Once');
  const role = mockRole(guild, 'LVL 10');
  const member = mockMember(guild, mockUser('once'), { roles: [role] });

  const first = await restoreLevelsOnce(client);
  assert.equal(first[guild.id].restored, 1);
  assert.equal((await getUserLevelData(client, guild.id, member.id)).level, 10);

  await saveUserLevelData(client, guild.id, member.id, { xp: 0, level: 2, totalXp: calculateTotalXp(2, 0) });
  assert.equal(await restoreLevelsOnce(client), null);
  assert.equal((await getUserLevelData(client, guild.id, member.id)).level, 2, 'the second start changes nothing');
});
