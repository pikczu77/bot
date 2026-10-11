// release-files.js — writes release-files.json: the list of every file in src/.
//
// The bot reads that list at startup (src/utils/staleFiles.js) and moves files that are
// not on it out of src/, so a file left behind by an older version cannot be loaded.
// The list is committed; `npm test` fails when it no longer matches src/, and
// scripts/publish.js rewrites it before every commit.
//
//   node scripts/release-files.js          write the list
//   node scripts/release-files.js --check  exit 1 when the list is out of date
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const RELEASE_LIST = path.join(root, 'release-files.json');

function listFiles(directory, out = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) listFiles(full, out);
    else out.push(path.relative(root, full).split(path.sep).join('/'));
  }
  return out;
}

/** Every file in src/, relative to the project root, forward slashes, sorted. */
export function currentSourceFiles() {
  return listFiles(path.join(root, 'src')).sort();
}

export function readReleaseList() {
  try {
    return JSON.parse(fs.readFileSync(RELEASE_LIST, 'utf8')).files;
  } catch {
    return null;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = currentSourceFiles();
  if (process.argv.includes('--check')) {
    const listed = readReleaseList();
    const upToDate = Array.isArray(listed) && JSON.stringify(listed) === JSON.stringify(files);
    console.log(upToDate ? `release-files.json is up to date (${files.length} files)` : 'release-files.json is OUT OF DATE - run: node scripts/release-files.js');
    process.exit(upToDate ? 0 : 1);
  }
  fs.writeFileSync(RELEASE_LIST, `${JSON.stringify({ files }, null, 0)}\n`);
  console.log(`release-files.json: ${files.length} files`);
}
