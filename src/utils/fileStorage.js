// fileStorage.js — the in-memory storage, saved to a JSON file so the data survives a
// restart. Used when no PostgreSQL is configured.
//
// Values are copied on the way in and out (like a real database), every change is
// written within SAVE_DELAY_MS, and the file is replaced in one step so a crash in the
// middle of a write cannot damage it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MemoryStorage } from './memoryStorage.js';
import { logger } from './logger.js';

const SAVE_DELAY_MS = 1000;
const FORMAT_VERSION = 1;

/** `data/storage.json` next to `src`, or inside DATA_DIR when that is set. */
export function getStorageFilePath() {
    const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const directory = (process.env.DATA_DIR ?? '').trim() || path.join(projectRoot, 'data');
    return path.join(directory, 'storage.json');
}

const copy = (value) => (value !== null && typeof value === 'object' ? structuredClone(value) : value);

class FileStorage extends MemoryStorage {
    constructor(filePath = getStorageFilePath()) {
        super();
        this.filePath = filePath;
        this.backupPath = filePath.replace(/\.json$/, '.backup.json');
        this.dirty = false;
        this.saveFailing = false;
        this.saveTimer = null;
        this.writing = Promise.resolve();
        // For /health: proof that data written before the last restart was read back.
        this.loadedEntries = 0;
        this.loadedFrom = 'new';
        this.lastSavedAt = null;
    }

    info() {
        return { entries: this.data.size, loadedEntries: this.loadedEntries, loadedFrom: this.loadedFrom, lastSavedAt: this.lastSavedAt };
    }

    /**
     * Read the file into memory. Throws when the folder cannot be created or written,
     * so the caller can fall back to plain memory.
     */
    load() {
        const directory = path.dirname(this.filePath);
        fs.mkdirSync(directory, { recursive: true });
        fs.accessSync(directory, fs.constants.W_OK);

        const main = this.readFile(this.filePath);
        if (main.ok) {
            this.adopt(main.content);
            // One copy of the last file that loaded correctly, in case the next one is damaged.
            if (main.exists) {
                fs.copyFileSync(this.filePath, this.backupPath);
                this.loadedFrom = 'file';
                this.lastSavedAt = main.content.savedAt ?? null;
            }
            return this;
        }

        const damagedPath = this.filePath.replace(/\.json$/, `.damaged-${Date.now()}.json`);
        fs.renameSync(this.filePath, damagedPath);
        logger.error(`Storage file could not be read (${main.error}); kept as ${damagedPath}`);

        const backup = this.readFile(this.backupPath);
        if (backup.ok && backup.exists) {
            logger.warn(`Storage restored from the backup copy ${this.backupPath}`);
            this.adopt(backup.content);
            this.loadedFrom = 'backup';
            this.dirty = true;
            this.flushSync();
        }
        return this;
    }

    readFile(filePath) {
        let text;
        try {
            text = fs.readFileSync(filePath, 'utf8');
        } catch (error) {
            if (error.code === 'ENOENT') return { ok: true, exists: false, content: null };
            return { ok: false, error: error.message };
        }
        try {
            const content = JSON.parse(text);
            if (!content || typeof content !== 'object' || typeof content.data !== 'object' || content.data === null) {
                return { ok: false, error: 'unexpected file format' };
            }
            return { ok: true, exists: true, content };
        } catch (error) {
            return { ok: false, error: error.message };
        }
    }

    adopt(content) {
        this.data.clear();
        this.expirationTimes.clear();
        if (!content) return;

        const now = Date.now();
        const expires = content.expires && typeof content.expires === 'object' ? content.expires : {};
        for (const [key, value] of Object.entries(content.data)) {
            const expiresAt = Number(expires[key]);
            if (expiresAt && expiresAt <= now) continue;
            this.data.set(key, value);
            if (expiresAt) this.expirationTimes.set(key, expiresAt);
        }
        this.loadedEntries = this.data.size;
    }

    serialize() {
        this.lastSavedAt = new Date().toISOString();
        return JSON.stringify({
            version: FORMAT_VERSION,
            savedAt: this.lastSavedAt,
            data: Object.fromEntries(this.data),
            expires: Object.fromEntries(this.expirationTimes),
        });
    }

    async get(key, defaultValue = null) {
        return copy(await super.get(key, defaultValue));
    }

    async set(key, value, ttl = null) {
        await super.set(key, copy(value), ttl);
        this.scheduleSave();
        return true;
    }

    async delete(key) {
        await super.delete(key);
        this.scheduleSave();
        return true;
    }

    async clear() {
        await super.clear();
        this.scheduleSave();
        return true;
    }

    scheduleSave() {
        this.dirty = true;
        if (this.saveTimer) return;
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            this.flush().catch(() => {});
        }, SAVE_DELAY_MS);
        this.saveTimer.unref?.();
    }

    /** Write pending changes now. Resolves when the file is on disk. */
    flush() {
        this.writing = this.writing.then(async () => {
            if (!this.dirty) return;
            this.dirty = false;
            const temporaryPath = `${this.filePath}.tmp`;
            try {
                await fs.promises.writeFile(temporaryPath, this.serialize(), 'utf8');
                await fs.promises.rename(temporaryPath, this.filePath);
                if (this.saveFailing) logger.info(`Storage file ${this.filePath} is being saved again`);
                this.saveFailing = false;
            } catch (error) {
                this.dirty = true;
                // Keeps trying every SAVE_DELAY_MS; one log line per outage is enough.
                if (!this.saveFailing) logger.error(`Could not save the storage file ${this.filePath}: ${error.message}`);
                this.saveFailing = true;
                this.scheduleSave();
            }
        });
        return this.writing;
    }

    /** For the moment the process exits, when nothing asynchronous runs any more. */
    flushSync() {
        if (!this.dirty) return;
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        const temporaryPath = `${this.filePath}.exit.tmp`;
        try {
            fs.writeFileSync(temporaryPath, this.serialize(), 'utf8');
            fs.renameSync(temporaryPath, this.filePath);
            this.dirty = false;
        } catch (error) {
            logger.error(`Could not save the storage file ${this.filePath}: ${error.message}`);
        }
    }
}

export { FileStorage };
