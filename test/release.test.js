// Files left on the host by an older upload are moved out of src/ at startup.
import './helpers/env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { moveStaleSourceFiles } from '../src/utils/staleFiles.js';
import { currentSourceFiles, readReleaseList } from '../scripts/release-files.js';

function projectWith(t, files, releaseList) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'klubik-release-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), '// test');
  }
  if (releaseList !== undefined) fs.writeFileSync(path.join(root, 'release-files.json'), releaseList);
  return root;
}

const onDisk = ['src/app.js', 'src/utils/staleFiles.js', 'src/commands/Leveling/rank.js', 'src/commands/Tools/poll.js', 'src/handlers/calculateModals.js', 'data/storage.json', '.env'];
const shipped = ['src/app.js', 'src/utils/staleFiles.js', 'src/commands/Leveling/rank.js'];

test('files that the upload no longer ships are moved out of src', (t) => {
  const root = projectWith(t, onDisk, JSON.stringify({ files: shipped }));

  assert.deepEqual(moveStaleSourceFiles(root).sort(), ['src/commands/Tools/poll.js', 'src/handlers/calculateModals.js']);
  assert.equal(fs.existsSync(path.join(root, 'src/commands/Tools/poll.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'stale-files/src/commands/Tools/poll.js')), true);
  for (const kept of [...shipped, 'data/storage.json', '.env']) {
    assert.equal(fs.existsSync(path.join(root, kept)), true, `${kept} must stay`);
  }
  assert.deepEqual(moveStaleSourceFiles(root), [], 'a second start has nothing left to move');
});

test('nothing is moved without a usable file list', (t) => {
  for (const releaseList of [undefined, '{"files":', JSON.stringify({ files: ['src/app.js'] }), JSON.stringify({ files: 'src' })]) {
    const root = projectWith(t, onDisk, releaseList);
    assert.deepEqual(moveStaleSourceFiles(root), []);
    assert.equal(fs.existsSync(path.join(root, 'src/commands/Tools/poll.js')), true);
  }
});

test('a git checkout is left alone: git removes deleted files itself', (t) => {
  const root = projectWith(t, [...onDisk, '.git/HEAD'], JSON.stringify({ files: shipped }));
  assert.deepEqual(moveStaleSourceFiles(root), []);
  assert.equal(fs.existsSync(path.join(root, 'src/commands/Tools/poll.js')), true);
});

test('the committed file list matches src (run: node scripts/release-files.js)', () => {
  assert.deepEqual(readReleaseList(), currentSourceFiles());
});
