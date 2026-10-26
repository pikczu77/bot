// Player event handlers for Riffy. Adapted from Musicify playerHandler (Apache-2.0).

import { logger } from '../../utils/logger.js';
import { getGuildMusicData, clearUpdateInterval } from './playerStore.js';
import {
    buildNowPlayingEmbed,
    buildPlayerButtonRows,
} from './musicEmbeds.js';
import { withGuildLocale } from '../languageService.js';
import { t } from '../../i18n/index.js';

const UPDATE_INTERVAL_MS = 15 * 1000;
const IDLE_DISCONNECT_MS = 30 * 1000;

async function editOrSendPlayerMessage(client, guildData, channelId, embed, components) {
    const channel = client.channels.cache.get(channelId);
    if (!channel) {
        guildData.playerMessageId = null;
        guildData.playerChannelId = null;
        return;
    }

    const payload = { embeds: [embed], components };

    if (guildData.playerMessageId) {
        try {
            const msg = await channel.messages.fetch(guildData.playerMessageId);
            await msg.edit(payload);
            return;
        } catch {
            guildData.playerMessageId = null;
            guildData.playerChannelId = null;
            clearUpdateInterval(guildData);
        }
    }

    try {
        const newMsg = await channel.send(payload);
        guildData.playerMessageId = newMsg.id;
        guildData.playerChannelId = channel.id;
    } catch (error) {
        logger.error('Failed to send music player message:', error);
    }
}

// Riffy events and the refresh timer run outside any interaction, so the guild's language
// is entered here. Updates for one guild run one after another, so two of them cannot both
// see "no message yet" and post two player messages.
function inGuildLocale(client, guildId, callback) {
    const guildData = getGuildMusicData(guildId);
    const run = () => withGuildLocale(client, guildId, callback).catch((error) => {
        logger.error('Music player message update failed:', error);
    });
    const next = (guildData.messageChain || Promise.resolve()).then(run, run);
    guildData.messageChain = next;
    return next;
}

export async function refreshPlayerMessage(client, guildId) {
    return inGuildLocale(client, guildId, async () => {
        const player = client.riffy?.players?.get(guildId);
        if (!player?.current) {
            return;
        }

        const guildData = getGuildMusicData(guildId);
        const embed = buildNowPlayingEmbed(player.current, player, guildData);
        const components = buildPlayerButtonRows(player, guildData);
        const channelId = guildData.playerChannelId || player.textChannel;
        await editOrSendPlayerMessage(client, guildData, channelId, embed, components);
    });
}

function startUpdateInterval(client, guildId) {
    const guildData = getGuildMusicData(guildId);
    clearUpdateInterval(guildData);
    guildData.updateInterval = setInterval(() => {
        refreshPlayerMessage(client, guildId);
    }, UPDATE_INTERVAL_MS);
}

export function setupPlayerHandler(client) {
    if (!client.riffy) {
        logger.warn('Riffy not initialized; music player handlers not attached.');
        return;
    }

    // Lavalink nodes often flap (reconnect -> error -> reconnect). Throttle all
    // per-node messages to one line per interval, log the first connect only,
    // and skip reconnect noise entirely since it is meaningless during flapping.
    const nodeLogState = new Map();
    const NODE_LOG_INTERVAL_MS = 5 * 60 * 1000;

    const shouldLogNodeEvent = (nodeName) => {
        const prev = nodeLogState.get(nodeName) ?? { lastLogAt: 0, hasConnected: false };
        const now = Date.now();
        if (now - prev.lastLogAt < NODE_LOG_INTERVAL_MS) {
            return false;
        }
        nodeLogState.set(nodeName, { ...prev, lastLogAt: now });
        return true;
    };

    const markNodeConnected = (nodeName) => {
        const prev = nodeLogState.get(nodeName) ?? { lastLogAt: 0, hasConnected: false };
        nodeLogState.set(nodeName, { ...prev, hasConnected: true });
    };

    client.riffy.on('nodeConnect', (node) => {
        const prev = nodeLogState.get(node.name) ?? { lastLogAt: 0, hasConnected: false };
        if (prev.hasConnected) {
            return;
        }
        markNodeConnected(node.name);
        logger.info(`Lavalink node "${node.name}" connected.`);
    });

    client.riffy.on('nodeReconnect', () => {
        // Intentionally silent — reconnect spam is not actionable during flapping.
    });

    client.riffy.on('nodeError', (node, error) => {
        if (!shouldLogNodeEvent(node.name)) {
            return;
        }
        logger.warn(`Lavalink node "${node.name}" error: ${error?.message || error}`);
    });

    client.riffy.on('nodeDisconnect', (node) => {
        if (!shouldLogNodeEvent(node.name)) {
            return;
        }
        logger.warn(`Lavalink node "${node.name}" disconnected.`);
    });

    client.riffy.on('trackStart', async (player, track) => {
        try {
            const guildData = getGuildMusicData(player.guildId);

            // Keep the Lavalink player's loop mode aligned with the stored preference.
            // Skip temporarily clears track-loop so it can advance; restore it here.
            if (guildData.loop && player.loop !== guildData.loop) {
                player.setLoop(guildData.loop);
            }

            // A track that moved to another node starts again; it is not a new "previous" track.
            if (player.previous && guildData.previousTracks.at(-1) !== player.previous) {
                guildData.previousTracks.push(player.previous);
                if (guildData.previousTracks.length > 20) {
                    guildData.previousTracks.shift();
                }
            }

            if (guildData.idleTimeout) {
                clearTimeout(guildData.idleTimeout);
                guildData.idleTimeout = null;
            }

            await refreshPlayerMessage(client, player.guildId);
            startUpdateInterval(client, player.guildId);
        } catch (error) {
            logger.error('Music trackStart error:', error);
        }
    });

    client.riffy.on('queueEnd', async (player) => {
        try {
            const guildData = getGuildMusicData(player.guildId);
            clearUpdateInterval(guildData);

            if (guildData.autoplay) {
                player.autoplay(player);
                return;
            }

            await inGuildLocale(client, player.guildId, async () => {
                if (!guildData.playerMessageId || !guildData.playerChannelId) {
                    return;
                }
                try {
                    const channel = client.channels.cache.get(guildData.playerChannelId);
                    if (channel) {
                        const msg = await channel.messages.fetch(guildData.playerMessageId);
                        await msg.delete();
                    }
                } catch {
                    // already deleted
                }
                guildData.playerMessageId = null;
                guildData.playerChannelId = null;
            });

            if (!guildData.twentyFourSeven) {
                if (guildData.idleTimeout) {
                    clearTimeout(guildData.idleTimeout);
                }
                guildData.idleTimeout = setTimeout(() => {
                    try {
                        // Riffy keeps the last track in player.current after the queue ends,
                        // so "nothing left to play" is: not playing, not paused, empty queue.
                        const currentPlayer = client.riffy.players.get(player.guildId);
                        if (currentPlayer && !currentPlayer.playing && !currentPlayer.paused && !currentPlayer.queue.length) {
                            currentPlayer.destroy();
                        }
                    } catch {
                        // player already destroyed
                    }
                    guildData.idleTimeout = null;
                }, IDLE_DISCONNECT_MS);
            }
        } catch (error) {
            logger.error('Music queueEnd error:', error);
        }
    });

    client.riffy.on('playerDisconnect', async (player) => {
        const guildData = getGuildMusicData(player.guildId);
        clearUpdateInterval(guildData);

        if (guildData.playerMessageId && guildData.playerChannelId) {
            try {
                const channel = client.channels.cache.get(guildData.playerChannelId);
                if (channel) {
                    const msg = await channel.messages.fetch(guildData.playerMessageId);
                    await msg.delete();
                }
            } catch {
                // already deleted
            }
        }

        guildData.playerMessageId = null;
        guildData.playerChannelId = null;
        guildData.previousTracks = [];
        guildData.autoPaused = false;
        if (guildData.idleTimeout) {
            clearTimeout(guildData.idleTimeout);
            guildData.idleTimeout = null;
        }
    });

    client.riffy.on('trackError', async (player, track, payload) => {
        const retrying = player.migrating;
        logger.warn(`Track error in ${player.guildId} on node "${player.node?.name}" for "${track?.info?.title}": ${payload?.exception?.message || payload?.error || 'unknown'}${retrying ? ' (retrying on another node)' : ''}`);
        if (retrying) {
            return;
        }
        const guildData = getGuildMusicData(player.guildId);
        const channel = client.channels.cache.get(guildData.playerChannelId || player.textChannel);
        if (channel) {
            withGuildLocale(client, player.guildId, () =>
                channel.send(`⚠️ ${t`Failed to play **${track?.info?.title || 'track'}**. Skipping...`}`))
                .catch(() => null);
        }
    });

    client.riffy.on('trackStuck', async (player, track, payload) => {
        logger.warn(`Track stuck in ${player.guildId} for "${track?.info?.title}" (${payload?.thresholdMs}ms)`);
    });
}

export async function shutdownMusic(client) {
    if (!client.riffy?.players) {
        return;
    }

    for (const player of client.riffy.players.values()) {
        try {
            player.destroy();
        } catch (error) {
            logger.debug('Error destroying music player during shutdown:', error.message);
        }
    }
}
