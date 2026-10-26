import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

function parseBoolean(value, defaultValue = false) {
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }
    return ['true', '1', 'yes'].includes(String(value).toLowerCase());
}

function parseNodesFromEnv() {
    const raw = process.env.LAVALINK_NODES?.trim();
    if (!raw) {
        return null;
    }

    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function parseNodesPayload(parsed) {
    if (Array.isArray(parsed)) {
        return parsed;
    }
    if (Array.isArray(parsed?.nodes)) {
        return parsed.nodes;
    }
    return null;
}

function loadNodesFromFile() {
    const nodesFile = process.env.LAVALINK_NODES_FILE?.trim()
        || path.join(projectRoot, 'lavalink', 'nodes.json');

    if (!existsSync(nodesFile)) {
        return null;
    }

    try {
        const parsed = JSON.parse(readFileSync(nodesFile, 'utf8'));
        return parseNodesPayload(parsed);
    } catch {
        return null;
    }
}

// The owner's own Lavalink server (lavalink/README.md): LAVALINK_HOST in .env. It goes first and
// is preferred while it is healthy (nodeHealth.js); the public nodes stay as a backup.
export const OWN_NODE_NAME = process.env.LAVALINK_NAME?.trim() || 'Wlasny';

function ownNodeFromEnv() {
    const host = process.env.LAVALINK_HOST?.trim();
    if (!host) {
        return null;
    }
    return {
        host,
        port: Number(process.env.LAVALINK_PORT || 2333),
        password: process.env.LAVALINK_PASSWORD || 'youshallnotpass',
        secure: parseBoolean(process.env.LAVALINK_SECURE, false),
        name: OWN_NODE_NAME,
    };
}

export function getLavalinkNodes() {
    const own = ownNodeFromEnv();
    const publicNodes = parseNodesFromEnv() || loadNodesFromFile() || [];
    if (own) {
        const onlyOwn = parseBoolean(process.env.LAVALINK_ONLY_OWN, false);
        return onlyOwn ? [own] : [own, ...publicNodes.filter((node) => node.name !== own.name)];
    }
    if (publicNodes.length) {
        return publicNodes;
    }

    const host = process.env.LAVALINK_HOST || 'localhost';
    const port = Number(process.env.LAVALINK_PORT || 2333);
    const password = process.env.LAVALINK_PASSWORD || 'youshallnotpass';
    const secure = parseBoolean(process.env.LAVALINK_SECURE, false);

    return [{
        host,
        port,
        password,
        secure,
        name: process.env.LAVALINK_NAME || 'Main',
    }];
}

export const lavalinkConfig = {
    nodes: getLavalinkNodes(),
    defaultSearchPlatform: process.env.LAVALINK_SEARCH_PLATFORM || 'ytmsearch',
    restVersion: process.env.LAVALINK_REST_VERSION || 'v4',
};

export default lavalinkConfig;
