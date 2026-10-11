import { pgDb } from '../postgresDatabase.js';
import { MemoryStorage } from '../memoryStorage.js';
import fs from 'node:fs';
import { FileStorage, getStorageFilePath } from '../fileStorage.js';
import { logger } from '../logger.js';
import { validateGuildConfigOrThrow } from '../schemas.js';

class DatabaseWrapper {
    constructor() {
        this.initialized = false;
        this.db = null;
        this.useFallback = false;
        this.connectionType = 'none';
        this.degradedModeWarningShown = false;
        this.degradedReason = null;
    }

    async initialize() {
        if (this.initialized) {
            return;
        }

        // The JSON file is the bot's storage. PostgreSQL is used only with STORAGE=postgres:
        // a database that connects on one start and not on the next made the bot switch
        // between two sets of data, which looked like everything being reset.
        const wantsPostgres = (process.env.STORAGE ?? '').trim().toLowerCase() === 'postgres';
        if (wantsPostgres) {
            if (await this.connectPostgres()) {
                this.initialized = true;
                return;
            }
        } else {
            const postgresTarget = process.env.POSTGRES_URL || process.env.DATABASE_URL || process.env.POSTGRES_HOST || '';
            if (postgresTarget.trim()) {
                logger.info('A PostgreSQL address is set, but STORAGE is not "postgres" - the file storage is used');
            }
        }

        if (this.useFileStorage(wantsPostgres)) {
            this.initialized = true;
            return;
        }

        this.db = new MemoryStorage();
        this.useFallback = true;
        this.connectionType = 'memory';
        this.degradedReason = wantsPostgres ? 'POSTGRES_UNAVAILABLE' : 'FILE_STORAGE_UNAVAILABLE';
        logger.warn('⚠️ DATABASE DEGRADED MODE ENABLED - Using in-memory storage (data will be lost on restart)');
        logger.warn('⚠️ Neither PostgreSQL nor the storage file can be used - check the log lines above');
        this.initialized = true;
        this.degradedModeWarningShown = true;
    }

    /** Returns true when PostgreSQL is connected and in use. A schema version mismatch is thrown. */
    async connectPostgres() {
        try {
            logger.info('Attempting to connect to PostgreSQL...');
            const pgConnected = await pgDb.connect();
            if (pgConnected) {
                this.db = pgDb;
                this.connectionType = 'postgresql';
                this.degradedReason = null;
                logger.info('✅ PostgreSQL Database initialized - using persistent database');
                if (fs.existsSync(getStorageFilePath())) {
                    logger.warn(`⚠️ ${getStorageFilePath()} exists: what the bot saved there while PostgreSQL was not in use is NOT in PostgreSQL`);
                }
                return true;
            }

            const pgFailure = pgDb.getLastFailure?.();
            if (pgFailure?.reason === 'SCHEMA_VERSION_MISMATCH') {
                const schemaError = new Error(
                    `Schema version mismatch detected (${pgFailure.message}). Run migrations before startup.`,
                );
                schemaError.code = 'SCHEMA_VERSION_MISMATCH';
                throw schemaError;
            }
        } catch (error) {
            logger.warn('PostgreSQL connection failed:', error.message);

            if (error.code === 'SCHEMA_VERSION_MISMATCH') {
                throw error;
            }
        }
        return false;
    }

    /**
     * The data is kept in a JSON file, so levels, balances and settings survive a
     * restart. Returns false when the file cannot be used.
     * postgresFailed: PostgreSQL was asked for (STORAGE=postgres) and did not connect.
     */
    useFileStorage(postgresFailed = false) {
        if (process.env.NODE_ENV === 'test' || process.env.STORAGE_FILE === 'off') {
            return false;
        }

        try {
            const storage = new FileStorage().load();
            // process.exit() skips pending timers; the last changes are written here.
            process.once('exit', () => storage.flushSync());
            this.db = storage;
            this.connectionType = 'file';
            logger.info(`✅ File storage initialized - data is saved to ${storage.filePath}`);

            // A PostgreSQL that was asked for but does not answer stays a reported failure:
            // the file keeps the data over restarts, but the two stores are not merged.
            if (postgresFailed) {
                this.useFallback = true;
                this.degradedReason = 'POSTGRES_UNAVAILABLE';
                logger.warn('⚠️ STORAGE=postgres, but PostgreSQL did not connect - the file storage is used instead');
            } else {
                this.degradedReason = null;
            }
            return true;
        } catch (error) {
            logger.warn(`File storage is not usable (${error.message})`);
            return false;
        }
    }

    async set(key, value, ttl = null) {
        if (this.connectionType === 'memory') {
            logger.debug(`[DEGRADED] Writing to memory: ${key}`);
        }

        if (typeof key === 'string' && /^guild:[^:]+:config$/.test(key)) {
            const guildId = key.split(':')[1];
            validateGuildConfigOrThrow(value, {
                guildId,
                errorCode: 'VALIDATION_FAILED',
            });
        }

        return this.db.set(key, value, ttl);
    }

    async get(key, defaultValue = null) {
        return this.db.get(key, defaultValue);
    }

    async delete(key) {
        if (this.useFallback) {
            logger.debug(`[DEGRADED] Deleting from memory: ${key}`);
        }
        return this.db.delete(key);
    }

    async list(prefix) {
        return this.db.list(prefix);
    }

    async exists(key) {
        if (this.db.exists) {
            return this.db.exists(key);
        }
        const value = await this.db.get(key);
        return value !== null;
    }

    async increment(key, amount = 1) {
        if (this.useFallback) {
            logger.debug(`[DEGRADED] Incrementing in memory: ${key}`);
        }
        if (this.db.increment) {
            return this.db.increment(key, amount);
        }
        const current = await this.db.get(key, 0);
        const newValue = current + amount;
        await this.db.set(key, newValue);
        return newValue;
    }

    async decrement(key, amount = 1) {
        if (this.useFallback) {
            logger.debug(`[DEGRADED] Decrementing in memory: ${key}`);
        }
        if (this.db.decrement) {
            return this.db.decrement(key, amount);
        }
        const current = await this.db.get(key, 0);
        const newValue = current - amount;
        await this.db.set(key, newValue);
        return newValue;
    }

    isDegraded() {
        return this.useFallback;
    }

    /** True only with PostgreSQL (SQL queries can be run). */
    isAvailable() {
        return Boolean(this.db) && this.connectionType === 'postgresql';
    }

    /** Write pending changes of the file storage to disk (nothing to do for PostgreSQL). */
    async flush() {
        await this.db?.flush?.();
    }

    getStatus() {
        return {
            initialized: this.initialized,
            connectionType: this.connectionType,
            isDegraded: this.useFallback,
            isAvailable: this.isAvailable(),
            degradedReason: this.degradedReason,
            // File storage only: how many entries it holds and how many came from the file at startup.
            storage: this.db?.info?.() ?? null,
        };
    }

    getConnectionType() {
        return this.connectionType;
    }
}

export const db = new DatabaseWrapper();

export async function initializeDatabase() {
    try {
        logger.info('Initializing Database (PostgreSQL > Memory fallback)...');
        await db.initialize();
        logger.info('✅ Database initialized');
        return { db };
    } catch (error) {
        logger.error('❌ Database Initialization Error:', error);

        if (error.code === 'SCHEMA_VERSION_MISMATCH') {
            throw error;
        }

        return { db };
    }
}

export async function getFromDb(key, defaultValue = null) {
    try {
        const value = await db.get(key);
        return value === null ? defaultValue : value;
    } catch (error) {
        logger.error(`Error getting value for key ${key}:`, error);
        return defaultValue;
    }
}

export async function setInDb(key, value, ttl = null) {
    try {
        await db.set(key, value, ttl);
        return true;
    } catch (error) {
        logger.error(`Error setting value for key ${key}:`, error);
        return false;
    }
}

export async function deleteFromDb(key) {
    try {
        await db.delete(key);
        return true;
    } catch (error) {
        logger.error(`Error deleting key ${key}:`, error);
        return false;
    }
}
