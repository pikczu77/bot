import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCounterChannelName, normalizeCounterNameTemplate, saveServerCounters, getServerCounters } from '../src/services/serverstatsService.js';

test('custom counter name replaces {count}', () => {
  assert.equal(formatCounterChannelName('members_only', 2429, 'Ludzie: {count}'), 'Ludzie: 2429');
});

test('custom counter name without {count} gets the number appended', () => {
  assert.equal(normalizeCounterNameTemplate('Ludzie:'), 'Ludzie: {count}');
  assert.equal(formatCounterChannelName('members_only', 5, 'Ludzie:'), 'Ludzie: 5');
});

test('empty custom name falls back to the default format', () => {
  assert.equal(normalizeCounterNameTemplate('   '), null);
  assert.match(formatCounterChannelName('members_only', 7, ''), /-7$/);
});

test('custom counter name survives save and load', async () => {
  const store = new Map();
  const client = { db: { get: async (key) => store.get(key), set: async (key, value) => { store.set(key, value); } } };
  await saveServerCounters(client, 'g1', [{ id: '1', type: 'members_only', channelId: 'c1', name: 'Ludzie: {count}' }]);
  const [counter] = await getServerCounters(client, 'g1');
  assert.equal(counter.name, 'Ludzie: {count}');
});
