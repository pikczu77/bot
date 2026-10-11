// Storage without PostgreSQL: data is kept in a JSON file and survives a restart.
import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileStorage } from '../src/utils/fileStorage.js';
import { MemoryStorage } from '../src/utils/memoryStorage.js';
import { getGuildConfig } from '../src/services/config/guildConfig.js';
import { getLevelingConfig, getUserLevelData, saveLevelingConfig, saveUserLevelData } from '../src/services/leveling/leveling.js';

const guildId = '200000000000000001';
const userId = '200000000000000002';

function temporaryFile(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'klubik-storage-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'data', 'storage.json');
}

test('levels and settings written to the file storage are there after a restart', async (t) => {
  const file = temporaryFile(t);
  const first = { db: new FileStorage(file).load() };

  await saveUserLevelData(first, guildId, userId, { xp: 40, level: 7, totalXp: 1234, lastMessage: 5 });
  await saveLevelingConfig(first, guildId, { ...(await getLevelingConfig(first, guildId)), xpCooldown: 5, moneyPerLevel: 300 });
  await first.db.set('cache:short', 'gone', 0.001);
  await first.db.flush();

  await new Promise((resolve) => setTimeout(resolve, 20));
  const second = { db: new FileStorage(file).load() };
  const level = await getUserLevelData(second, guildId, userId);
  const leveling = await getLevelingConfig(second, guildId);

  assert.deepEqual({ level: level.level, xp: level.xp, totalXp: level.totalXp }, { level: 7, xp: 40, totalXp: 1234 });
  assert.deepEqual({ cooldown: leveling.xpCooldown, money: leveling.moneyPerLevel }, { cooldown: 5, money: 300 });
  assert.equal(await second.db.get('cache:short'), null, 'an expired entry is dropped when the file is loaded');
  assert.deepEqual(await second.db.list(`guild:${guildId}:leveling:users:`), [`guild:${guildId}:leveling:users:${userId}`]);
});

test('guild settings are read back without PostgreSQL', async () => {
  const client = { db: new MemoryStorage() };
  await saveLevelingConfig(client, guildId, { ...(await getLevelingConfig(client, guildId)), enabled: false, levelUpChannel: '200000000000000003' });

  const config = await getGuildConfig(client, guildId);
  assert.equal(config.leveling.enabled, false);
  assert.equal((await getLevelingConfig(client, guildId)).levelUpChannel, '200000000000000003');
});

test('the file storage hands out copies and saves at exit', async (t) => {
  const file = temporaryFile(t);
  const storage = new FileStorage(file).load();

  const original = { wallet: 10, items: ['a'] };
  await storage.set('guild:1:economy:2', original);
  original.wallet = 999;
  const read = await storage.get('guild:1:economy:2');
  read.items.push('b');
  assert.deepEqual(await storage.get('guild:1:economy:2'), { wallet: 10, items: ['a'] });

  assert.equal(fs.existsSync(file), false, 'nothing is written before the save delay');
  storage.flushSync();
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).data['guild:1:economy:2'], { wallet: 10, items: ['a'] });

  await storage.delete('guild:1:economy:2');
  await storage.flush();
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).data, {});
});

test('a damaged storage file is set aside and the backup copy is used', async (t) => {
  const file = temporaryFile(t);
  const storage = new FileStorage(file).load();
  await storage.set('guild:1:welcome', { enabled: true });
  await storage.flush();

  // The next start makes the backup copy; then the file gets damaged.
  new FileStorage(file).load();
  fs.writeFileSync(file, '{"version":1,"data":{"guild:1:wel', 'utf8');

  const restored = new FileStorage(file).load();
  assert.deepEqual(await restored.get('guild:1:welcome'), { enabled: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).data, { 'guild:1:welcome': { enabled: true } });
  assert.equal(fs.readdirSync(path.dirname(file)).filter((name) => name.includes('.damaged-')).length, 1);
});
