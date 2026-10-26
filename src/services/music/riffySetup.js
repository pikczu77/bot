import { createRequire } from 'module';
import { GatewayDispatchEvents } from 'discord.js';
import { logger } from '../../utils/logger.js';
import lavalinkConfig from '../../config/music/lavalink.js';
import { setupPlayerHandler } from './playerHandler.js';
import { rankNodes } from './nodeHealth.js';
import { attachPlayerRecovery } from './playerRecovery.js';

const require = createRequire(import.meta.url);
const { Riffy, Node } = require('riffy');

// Public nodes drop often. Riffy gives up after 3 reconnect attempts and deletes the node
// for good, so after a few hours the bot had no music at all until a restart.
const NODE_RECONNECT_TRIES = 1_000_000;
const NODE_RECONNECT_MS = 15_000;
// Riffy retries a 5xx answer 5 times with 2-10 s pauses (30 s in total) before failing.
// A broken node should fail fast so the next node can answer instead.
const RIFFY_MAX_RETRY_COUNT = 5;

/** Changes a Riffy node before it connects (see the comments inside). */
export function prepareNode(node) {
    const makeRequest = node.rest.makeRequest.bind(node.rest);
    node.rest.makeRequest = (method, endpoint, body = null, includeHeaders = false) =>
        makeRequest(method, endpoint, body, includeHeaders, RIFFY_MAX_RETRY_COUNT);

    // After a player moves to another node, the old node can still send events for that
    // guild (track ended, position). Riffy would apply them to the moved player and skip
    // a song, so drop events that come from a node the player no longer uses.
    const handleMessage = node.message;
    node.message = function filteredMessage(raw) {
        let data = raw;
        if (Array.isArray(data)) {
            data = Buffer.concat(data);
        } else if (data instanceof ArrayBuffer) {
            data = Buffer.from(data);
        }
        try {
            const payload = JSON.parse(data.toString());
            if (payload.guildId && (payload.op === 'event' || payload.op === 'playerUpdate')) {
                const player = node.riffy.players.get(payload.guildId);
                if (player && player.node !== node) {
                    return undefined;
                }
            }
        } catch {
            return undefined;
        }
        return handleMessage.call(node, data);
    };
    return node;
}

class KlubikRiffy extends Riffy {
    // Used by createConnection() and resolve(): pick nodes by health, not by REST call count.
    get leastUsedNodes() {
        return rankNodes(this.nodeMap.values());
    }

    createNode(options) {
        const node = prepareNode(new Node(this, options, this.options));
        this.nodeMap.set(options.name || options.host, node);
        node.connect();
        this.emit('nodeCreate', node);
        return node;
    }
}

export function initializeMusic(client) {
    if (!lavalinkConfig.nodes?.length) {
        logger.error('No Lavalink nodes configured. Add lavalink/nodes.json, set LAVALINK_NODES, or set LAVALINK_HOST in your environment.');
        return;
    }

    client.riffy = new KlubikRiffy(client, lavalinkConfig.nodes, {
        send: (payload) => {
            const guildId = payload.d?.guild_id;
            if (!guildId) {
                return;
            }

            const guild = client.guilds.cache.get(guildId);
            if (guild?.shard) {
                guild.shard.send(payload);
                return;
            }

            const shardCount = client.ws.shards.size || 1;
            const shardId = Number((BigInt(guildId) >> 22n) % BigInt(shardCount));
            client.ws.shards.get(shardId)?.send(payload);
        },
        defaultSearchPlatform: lavalinkConfig.defaultSearchPlatform,
        restVersion: lavalinkConfig.restVersion,
        reconnectTries: NODE_RECONNECT_TRIES,
        reconnectTimeout: NODE_RECONNECT_MS,
        bypassChecks: {
            nodeFetchInfo: true,
        },
    });

    // Recovery listeners must run before the message handlers in playerHandler.
    attachPlayerRecovery(client);
    setupPlayerHandler(client);

    client.on('raw', (packet) => {
        if (
            ![
                GatewayDispatchEvents.VoiceStateUpdate,
                GatewayDispatchEvents.VoiceServerUpdate,
            ].includes(packet.t)
        ) {
            return;
        }
        client.riffy.updateVoiceState(packet).catch((error) => {
            logger.warn(`Music voice update failed: ${error?.message || error}`);
        });
    });

    client.riffy.on('playerError', (player, error) => {
        logger.error(`Music player error in guild ${player.guildId}:`, error);
    });

    logger.info(`Music initialized with ${lavalinkConfig.nodes.length} Lavalink node(s).`);
}

export function initRiffyAfterReady(client) {
    if (client.riffy && client.user?.id) {
        client.riffy.init(client.user.id);
        logger.info('Riffy voice connection manager initialized.');
    }
}
