// staleFiles.js — the bot host unpacks every upload over the previous one, so a file
// that a newer version no longer ships stays in src/ and would still be loaded (a
// removed command would come back). The upload archive carries release-files.json, the
// list of its src/ files; anything else found in src/ is moved to stale-files/.
// Without that list nothing happens, and neither in a git checkout (a .git folder next to
// src/): there git removes deleted files itself, and a list that is one commit behind
// would move new files away.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from './logger.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RELEASE_LIST = 'release-files.json';
const OWN_PATH = 'src/utils/staleFiles.js';

function listFiles(directory, out = []) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) listFiles(full, out);
        else out.push(full);
    }
    return out;
}

/** Returns the moved files (paths relative to the project root, forward slashes). */
export function moveStaleSourceFiles(root = PROJECT_ROOT) {
    if (fs.existsSync(path.join(root, '.git'))) {
        return [];
    }

    let shipped;
    try {
        shipped = JSON.parse(fs.readFileSync(path.join(root, RELEASE_LIST), 'utf8')).files;
    } catch {
        return [];
    }

    // A list that does not name this very file is damaged or belongs to something else.
    if (!Array.isArray(shipped) || !shipped.includes(OWN_PATH)) {
        logger.warn(`${RELEASE_LIST} is not a usable file list; files of older versions are not cleaned up`);
        return [];
    }

    const keep = new Set(shipped);
    const moved = [];

    for (const file of listFiles(path.join(root, 'src'))) {
        const relative = path.relative(root, file).split(path.sep).join('/');
        if (keep.has(relative)) continue;

        const target = path.join(root, 'stale-files', relative);
        try {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.renameSync(file, target);
            moved.push(relative);
        } catch (error) {
            logger.warn(`Could not move the old file ${relative}: ${error.message}`);
        }
    }

    if (moved.length > 0) {
        logger.warn(`Moved ${moved.length} files of an older version from src/ to stale-files/: ${moved.join(', ')}`);
    }
    return moved;
}
