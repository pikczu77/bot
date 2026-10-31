// restore-backup.js — puts one server's copy from the backup channel (src/services/dataBackup.js) back
// into the storage file. Other servers in the file stay as they are. The bot must be stopped.
//
//   node scripts/restore-backup.js <kopia.json.gz | kopia.json.gz.part1 kopia.json.gz.part2 ...> [--storage data/storage.json]
//
// Every entry of that server in the file is replaced. The file as it was is kept next to it as
// storage.before-restore-<time>.json. The copy has no Minecraft key: a key still in the file is kept,
// otherwise type it again with /minecraft whitelista ustaw.

import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

const FORMAT = 'klubik-guild-backup-1';

function parseArguments(argv) {
  const files = [];
  let storage = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'storage.json') : path.join('data', 'storage.json');
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--storage') storage = argv[(index += 1)];
    else files.push(argv[index]);
  }
  return { files, storage };
}

const partNumber = (file) => Number(/\.part(\d+)$/.exec(file)?.[1] ?? 0);

function readBackup(files) {
  const sorted = [...files].sort((a, b) => partNumber(a) - partNumber(b));
  const backup = JSON.parse(gunzipSync(Buffer.concat(sorted.map((file) => fs.readFileSync(file)))).toString('utf8'));
  if (backup?.format !== FORMAT || !backup.guildId || typeof backup.entries !== 'object') throw new Error('This is not a server copy of the bot.');
  return backup;
}

function restore(backup, storagePath) {
  const exists = fs.existsSync(storagePath);
  const storage = exists ? JSON.parse(fs.readFileSync(storagePath, 'utf8')) : { version: 1, data: {}, expires: {} };
  const belongs = (key) => key.startsWith(`guild:${backup.guildId}:`) || key.startsWith(`user:${backup.guildId}:`);

  const whitelistKey = `guild:${backup.guildId}:minecraft-whitelist`;
  const savedKey = storage.data?.[whitelistKey]?.apiKey ?? null;

  let removed = 0;
  for (const key of Object.keys(storage.data ?? {})) {
    if (!belongs(key)) continue;
    delete storage.data[key];
    if (storage.expires) delete storage.expires[key];
    removed += 1;
  }
  storage.data = { ...storage.data, ...backup.entries };
  if (savedKey && storage.data[whitelistKey]) storage.data[whitelistKey].apiKey = savedKey;
  storage.savedAt = new Date().toISOString();

  let kept = null;
  if (exists) {
    kept = storagePath.replace(/\.json$/, `.before-restore-${Date.now()}.json`);
    fs.copyFileSync(storagePath, kept);
  } else {
    fs.mkdirSync(path.dirname(storagePath), { recursive: true });
  }
  const temporary = `${storagePath}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(storage), 'utf8');
  fs.renameSync(temporary, storagePath);
  return { removed, added: Object.keys(backup.entries).length, kept, keyKept: Boolean(savedKey) };
}

try {
  const { files, storage } = parseArguments(process.argv.slice(2));
  if (!files.length) throw new Error('Usage: node scripts/restore-backup.js <copy file(s)> [--storage data/storage.json]');
  const backup = readBackup(files);
  const done = restore(backup, storage);
  console.log(`Server ${backup.guildName ?? backup.guildId}, copy of ${backup.createdAt}: removed ${done.removed} entries, restored ${done.added}.`);
  if (done.kept) console.log(`The old file is kept as ${done.kept}`);
  if (!done.keyKept) console.log('No Minecraft key in the file: type it again with /minecraft whitelista ustaw.');
} catch (error) {
  console.error(`Restore failed: ${error.message}`);
  process.exitCode = 1;
}
