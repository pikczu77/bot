// Keeps music playing when a public Lavalink node fails or stutters: the player moves to
// another node and continues the same track from the same second.

import { logger } from '../../utils/logger.js';
import {
    frameLossRatio,
    isNodeCoolingDown,
    markNodeFailed,
    rankNodes,
} from './nodeHealth.js';

const STUTTER_CHECK_MS = 60 * 1000;
// Move when the node lost more than 4% of the audio frames last minute...
const STUTTER_LOSS_RATIO = 0.04;
// ...to a node that lost clearly less.
const GOOD_LOSS_RATIO = 0.015;
const STUTTER_MOVE_COOLDOWN_MS = 4 * 60 * 1000;
// A track that fails (cannot load, gets stuck) is retried on up to two other nodes.
const MAX_TRACK_RETRIES = 2;

/** Current position in ms, counting the time since Lavalink last reported it. */
export function estimatePosition(player, now = Date.now()) {
    const base = Number(player?.position) || 0;
    const reportedAt = player?.data?.positionAt;
    let position = base;
    if (reportedAt && player.playing && !player.paused) {
        position += Math.max(0, now - reportedAt);
    }
    const length = player?.current?.info?.length;
    if (length && !player.current.info.isStream) {
        position = Math.min(position, length);
    }
    return position;
}

function pickOtherNode(riffy, player, { maxLossRatio = 1 } = {}) {
    const now = Date.now();
    return rankNodes(riffy.nodeMap.values(), now).find((node) =>
        node !== player.node
        && node.sessionId
        && !isNodeCoolingDown(node, now)
        && frameLossRatio(node) <= maxLossRatio,
    ) || null;
}

/**
 * Moves a player to another node. Unlike Riffy's moveTo(), the voice data includes
 * channelId (Lavalink 4.2 needs it for Discord's voice encryption) and the old node is
 * not awaited, because it may be the one that stopped answering.
 */
export async function movePlayer(player, newNode, { reason = 'moved', position = null } = {}) {
    const oldNode = player.node;
    const voice = player.connection?.voice;
    if (!voice?.sessionId || !voice?.endpoint || !voice?.token) {
        throw new Error('Player has no voice session to move');
    }

    const track = player.current;
    const data = {
        voice: {
            token: voice.token,
            endpoint: voice.endpoint,
            sessionId: voice.sessionId,
            channelId: player.voiceChannel,
        },
        volume: player.volume,
    };
    if (track?.track) {
        data.track = { encoded: track.track };
        data.position = track.info?.isSeekable === false || track.info?.isStream
            ? 0
            : Math.floor(position ?? estimatePosition(player));
        data.paused = Boolean(player.paused);
    }

    player.migrating = true;
    try {
        if (oldNode && oldNode !== newNode && oldNode.connected) {
            oldNode.rest.destroyPlayer(player.guildId).catch(() => null);
        }
        player.node = newNode;
        await newNode.rest.updatePlayer({ guildId: player.guildId, data });
        player.data.movedAt = Date.now();
        logger.info(`Music player ${player.guildId} moved from "${oldNode?.name}" to "${newNode.name}" (${reason}).`);
    } finally {
        player.migrating = false;
    }
}

function continueAfterFailedMove(riffy, player) {
    if (!riffy.players.has(player.guildId)) {
        return;
    }
    if (player.queue.length) {
        player.play().catch((error) => logger.warn(`Music: could not start the next track: ${error.message}`));
        return;
    }
    player.playing = false;
    riffy.emit('queueEnd', player);
}

/**
 * Called synchronously from Riffy's trackError / trackStuck events. Riffy would skip the
 * track; if another healthy node exists, the same track is played there instead.
 * Returns true when a move was started (Riffy's own "track ended" event is then ignored).
 */
export function retryOnAnotherNode(riffy, player, reason) {
    if (!player?.current?.track || player.migrating || !riffy.players.has(player.guildId)) {
        return false;
    }

    const encoded = player.current.track;
    const attempts = player.data.retryTrack === encoded ? player.data.retryCount || 0 : 0;
    markNodeFailed(player.node);
    if (attempts >= MAX_TRACK_RETRIES) {
        return false;
    }

    const target = pickOtherNode(riffy, player);
    if (!target) {
        return false;
    }

    player.data.retryTrack = encoded;
    player.data.retryCount = attempts + 1;
    // Riffy calls player.stop() right after this event and then handles the old node's
    // "track ended" event. The flag makes Riffy ignore that event; the move waits one tick
    // so the stop request still goes to the old node, not to the new one.
    const position = estimatePosition(player);
    player.migrating = true;
    setImmediate(() => {
        movePlayer(player, target, { reason, position }).catch((error) => {
            logger.warn(`Music: moving player ${player.guildId} to "${target.name}" failed: ${error.message}`);
            markNodeFailed(target);
            continueAfterFailedMove(riffy, player);
        });
    });
    return true;
}

async function moveStutteringPlayers(client) {
    const riffy = client.riffy;
    if (!riffy?.players?.size) {
        return;
    }
    const now = Date.now();
    for (const player of riffy.players.values()) {
        if (!player.playing || player.paused || player.migrating || !player.current) {
            continue;
        }
        if (player.data.movedAt && now - player.data.movedAt < STUTTER_MOVE_COOLDOWN_MS) {
            continue;
        }
        const loss = frameLossRatio(player.node);
        if (!player.node?.connected || loss > STUTTER_LOSS_RATIO) {
            const target = pickOtherNode(riffy, player, { maxLossRatio: GOOD_LOSS_RATIO });
            if (!target) {
                continue;
            }
            try {
                await movePlayer(player, target, { reason: `${Math.round(loss * 100)}% audio frames lost` });
            } catch (error) {
                logger.warn(`Music: stutter move for ${player.guildId} failed: ${error.message}`);
            }
        }
    }
}

export function attachPlayerRecovery(client) {
    const riffy = client.riffy;

    riffy.on('playerUpdate', (player) => {
        player.data.positionAt = Date.now();
    });

    riffy.on('trackError', (player) => {
        retryOnAnotherNode(riffy, player, 'track failed');
    });

    riffy.on('trackStuck', (player) => {
        retryOnAnotherNode(riffy, player, 'track stuck');
    });

    riffy.on('trackStart', (player, track) => {
        if (player.data.retryTrack && player.data.retryTrack !== track?.track) {
            player.data.retryTrack = null;
            player.data.retryCount = 0;
        }
    });

    // Riffy emits this before it marks the node as disconnected.
    riffy.on('nodeDisconnect', (node) => {
        for (const player of riffy.players.values()) {
            if (player.node !== node || player.migrating) {
                continue;
            }
            const target = rankNodes(riffy.nodeMap.values()).find((other) => other !== node && other.sessionId);
            if (!target) {
                continue;
            }
            movePlayer(player, target, { reason: 'node disconnected' }).catch((error) => {
                logger.warn(`Music: moving player ${player.guildId} off "${node.name}" failed: ${error.message}`);
            });
        }
    });

    const timer = setInterval(() => {
        moveStutteringPlayers(client).catch((error) => logger.warn(`Music stutter check failed: ${error.message}`));
    }, STUTTER_CHECK_MS);
    timer.unref?.();
    client.musicRecoveryTimer = timer;
}
