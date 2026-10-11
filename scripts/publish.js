// publish.js — send the current state of the bot to GitHub (origin/main).
//
// The host pulls that branch at every restart, so a push plus a restart is a release.
//
//   node scripts/publish.js "Commit message"            commit everything and push
//   node scripts/publish.js --message-file path.txt     the same, message read from a file
//
// Steps: rewrite release-files.json, run the tests, refuse to continue when a file that
// must stay private is about to be committed, commit, push. Nothing is pushed when a
// step fails.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';

function run(command, args, { capture = false } = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', shell: isWindows && command === 'npm' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    if (capture) process.stderr.write(`${result.stdout ?? ''}${result.stderr ?? ''}`);
    console.error(`\nSTOPPED: "${command} ${args.join(' ')}" failed. Nothing was pushed.`);
    process.exit(result.status ?? 1);
  }
  return capture ? result.stdout : '';
}

const fileFlag = process.argv.indexOf('--message-file');
const message = fileFlag >= 0 ? fs.readFileSync(process.argv[fileFlag + 1], 'utf8').trim() : (process.argv[2] ?? '').trim();
if (!message) {
  console.error('Usage: node scripts/publish.js "Commit message"');
  process.exit(1);
}

run('node', ['scripts/release-files.js']);
run('npm', ['test']);
run('git', ['add', '-A']);

// The repository is public: secrets and the bot's data must never be in a commit.
const PRIVATE = /(^|\/)(\.env(\..*)?|data\/.*|stale-files\/.*|logs\/.*|node_modules\/.*|.*\.pem|.*klucz.*)$/i;
const ALLOWED = new Set(['.env.example']);
const staged = run('git', ['diff', '--cached', '--name-only'], { capture: true }).split('\n').map((line) => line.trim()).filter(Boolean);
const leaked = staged.filter((file) => PRIVATE.test(file) && !ALLOWED.has(file));
if (leaked.length > 0) {
  run('git', ['reset', '-q']);
  console.error(`\nSTOPPED: these files must not be published: ${leaked.join(', ')}. Nothing was committed.`);
  process.exit(1);
}
if (staged.length === 0) {
  console.log('Nothing to publish - the working folder matches the last commit.');
  process.exit(0);
}

const messageFile = path.join(root, '.git', 'PUBLISH_MESSAGE');
fs.writeFileSync(messageFile, `${message}\n`);
run('git', ['commit', '-q', '-F', messageFile]);
fs.rmSync(messageFile, { force: true });
run('git', ['push', 'origin', 'HEAD:main']);

console.log(`\nPublished ${staged.length} files: ${run('git', ['log', '-1', '--format=%h %s'], { capture: true }).trim()}`);
console.log('The host applies it at the next restart of the bot.');
