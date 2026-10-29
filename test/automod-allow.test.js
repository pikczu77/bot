// Words that pass the words rule even when the list matches them (2026-10-29, owner: "niech zajebiscie nie usuwa").
import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESET_ALLOWED_WORDS, PRESET_WORDS } from '../src/config/automodPresets.js';
import { checkMessage, findBannedWord, getAutomodConfig } from '../src/services/automodService.js';
import { initializeDatabase } from '../src/utils/database.js';

test('"zajebiście" passes the *jeb* pattern, other forms and other words in the message are still caught', async () => {
  for (const text of ['to jest zajebiście', 'ZAJEBISTY film', 'zajebista gra', 'zajebiscie!!']) {
    assert.equal(findBannedWord(text, PRESET_WORDS, PRESET_ALLOWED_WORDS), null, text);
  }
  assert.equal(findBannedWord('jebać to', PRESET_WORDS, PRESET_ALLOWED_WORDS), '*jeb*');
  assert.equal(findBannedWord('wyjebane', PRESET_WORDS, PRESET_ALLOWED_WORDS), '*jeb*');
  assert.equal(findBannedWord('zajebiście kurwa', PRESET_WORDS, PRESET_ALLOWED_WORDS), '*kurw*');
  assert.equal(findBannedWord('zajebiście', PRESET_WORDS), '*jeb*', 'without the exceptions it would be deleted');

  // A server that saved its list before the exceptions existed gets them from the defaults.
  await initializeDatabase();
  const config = await getAutomodConfig('900000000000000001', { fresh: true });
  assert.deepEqual(config.rules.words.allow, PRESET_ALLOWED_WORDS);
  config.rules.words.enabled = true;
  config.rules.words.list = ['*jeb*'];
  const message = (content) => ({ content, mentionCount: 0, mentionsEveryone: false, channelId: '1' });
  assert.equal(checkMessage(config, message('jest zajebiście'), { timestamps: [], recent: [] }), null);
  assert.equal(checkMessage(config, message('jebać'), { timestamps: [], recent: [] })?.rule, 'words');
});
