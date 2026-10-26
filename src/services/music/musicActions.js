import { once } from 'node:events';
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import { successEmbed } from '../../utils/embeds.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { botHasPermission } from '../../utils/permissionGuard.js';
import { TitanBotError, ErrorTypes } from '../../utils/errorHandler.js';
import { getGuildMusicData, clearUpdateInterval } from './playerStore.js';
import { canControlMusic, requireVoiceChannel, VOICE_CHANNEL_DENIAL } from './permissions.js';
import { logger } from '../../utils/logger.js';
import {
    buildNowPlayingEmbed,
    buildPlaylistAddedEmbed,
    buildQueueEmbed,
    buildQueuePaginationRow,
    buildTrackAddedEmbed,
    getQueuePageSize,
    MAX_VOLUME,
} from './musicEmbeds.js';
import { refreshPlayerMessage } from './playerHandler.js';
import { markNodeFailed, rankNodes } from './nodeHealth.js';
import lavalinkConfig from '../../config/music/lavalink.js';
import { t } from '../../i18n/index.js';

const PLAYER_CONNECT_TIMEOUT_MS = 12_000;
const SEARCH_TIMEOUT_MS = 12_000;
// Nodes asked for one query before giving up, and search sites tried on each of them.
const SEARCH_NODE_LIMIT = 3;
const URL_PATTERN = /^https?:\/\//i;

/**
 * Cleans what a member typed. YouTube "Mix" / radio links (list=RD...) would load a
 * 50-song generated playlist, so only the video itself is kept.
 */
export function cleanQuery(query) {
    const text = String(query || '').trim().replace(/^<(.+)>$/, '$1');
    if (!URL_PATTERN.test(text)) {
        return text;
    }
    try {
        const url = new URL(text);
        if (/(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(url.hostname)) {
            const list = url.searchParams.get('list');
            if (list && /^RD/i.test(list) && (url.searchParams.get('v') || url.hostname.endsWith('youtu.be'))) {
                url.searchParams.delete('list');
                url.searchParams.delete('start_radio');
                url.searchParams.delete('index');
            }
            url.searchParams.delete('si');
            url.searchParams.delete('pp');
        }
        return url.toString();
    } catch {
        return text;
    }
}

function withTimeout(promise, ms, label) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
        }),
    ]).finally(() => clearTimeout(timer));
}

function searchSources() {
    return [...new Set([lavalinkConfig.defaultSearchPlatform || 'ytmsearch', 'ytsearch', 'scsearch'])];
}

/**
 * Looks the query up on the player's node first, then on the other healthy nodes. A plain
 * search that finds nothing on YouTube Music is tried on YouTube and SoundCloud too.
 */
export async function resolveTracks(client, query, requester, preferredNode = null) {
    const ranked = rankNodes(client.riffy.nodeMap.values());
    const nodes = (preferredNode?.connected ? [preferredNode, ...ranked.filter((node) => node !== preferredNode)] : ranked)
        .slice(0, SEARCH_NODE_LIMIT);
    const sources = URL_PATTERN.test(query) ? [undefined] : searchSources();

    let answered = false;
    for (const node of nodes) {
        for (const source of sources) {
            try {
                const result = await withTimeout(
                    client.riffy.resolve({ query, source, requester, node }),
                    SEARCH_TIMEOUT_MS,
                    `Search on "${node.name}"`,
                );
                answered = true;
                if (result?.tracks?.length) {
                    return { ...result, node };
                }
                if (result?.loadType === 'error') {
                    logger.warn(`Music search failed on "${node.name}" (${source || 'url'}): ${result.exception?.message || 'unknown error'}`);
                }
            } catch (error) {
                logger.warn(`Music search on "${node.name}" failed: ${error.message}`);
                markNodeFailed(node);
                break;
            }
        }
    }

    if (!answered) {
        throw new TitanBotError(
            'Lavalink search failed',
            ErrorTypes.CONFIGURATION,
            t('The music servers did not answer. Try again in a moment.'),
        );
    }
    return { loadType: 'empty', tracks: [], playlistInfo: null };
}

function getConnectedLavalinkNodes(client) {
    if (!client.riffy?.nodeMap) {
        return [];
    }

    return [...client.riffy.nodeMap.values()].filter((node) => node.connected);
}

export function assertLavalinkNodeAvailable(client) {
    if (!getConnectedLavalinkNodes(client).length) {
        throw new TitanBotError(
            'Lavalink unavailable',
            ErrorTypes.CONFIGURATION,
            t('Music is temporarily unavailable — no Lavalink nodes are connected. Try again shortly or configure your own Lavalink server.'),
        );
    }
}

function assertBotVoicePermissions(channel) {
    if (!channel) {
        throw new TitanBotError(
            'Voice channel unavailable',
            ErrorTypes.CONFIGURATION,
            t('Could not access that voice channel.'),
        );
    }

    if (!botHasPermission(channel, [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) {
        throw new TitanBotError(
            'Missing voice permissions',
            ErrorTypes.PERMISSION,
            t('I need **Connect** and **Speak** permissions in your voice channel.'),
        );
    }
}

async function waitForPlayerConnection(player) {
    if (player.connected) {
        return;
    }

    try {
        await player.connection.resolve();
    } catch {
        // Fall through to event-based wait below.
    }

    if (player.connected) {
        return;
    }

    try {
        await once(player, 'connectionRestored', {
            signal: AbortSignal.timeout(PLAYER_CONNECT_TIMEOUT_MS),
        });
    } catch {
        // Timed out waiting for Lavalink to confirm the voice session.
    }

    if (!player.connected) {
        throw new TitanBotError(
            'Voice connection failed',
            ErrorTypes.CONFIGURATION,
            t('Could not connect to the voice channel. Ensure Lavalink is online, the bot has Connect and Speak permissions, then try again.'),
        );
    }
}

async function startPlayback(player) {
    await waitForPlayerConnection(player);
    await player.play();
}

export function getPlayer(client, guildId) {
    return client.riffy?.players?.get(guildId) || null;
}

export function assertRiffyAvailable(client) {
    if (!client.riffy) {
        throw new TitanBotError(
            'Lavalink not configured',
            ErrorTypes.CONFIGURATION,
            t('Music is unavailable — Lavalink is not configured.'),
        );
    }
}

export function assertInVoice(member) {
    if (!requireVoiceChannel(member)) {
        throw new TitanBotError(
            'Not in voice channel',
            ErrorTypes.USER_INPUT,
            t('You need to be in a voice channel.'),
        );
    }
}

export function assertCanControl(member, player) {
    if (!canControlMusic(member, player)) {
        throw new TitanBotError(
            'Wrong voice channel',
            ErrorTypes.PERMISSION,
            VOICE_CHANNEL_DENIAL,
        );
    }
}

export async function ensurePlayer(client, interaction) {
    assertRiffyAvailable(client);
    assertLavalinkNodeAvailable(client);
    assertInVoice(interaction.member);

    const guildId = interaction.guild.id;
    const guildData = getGuildMusicData(guildId);
    let player = getPlayer(client, guildId);

    if (!player) {
        assertBotVoicePermissions(interaction.member.voice.channel);
        player = createPlayer(client, guildId, interaction.member.voice.channel.id, interaction.channel.id, guildData);
        guildData.playerChannelId = interaction.channel.id;
    } else if (player.volume !== guildData.volume) {
        player.setVolume(guildData.volume);
    }

    return { player, guildData };
}

// The volume goes with the first voice update, so a new player needs no separate request.
// 100% is the default: at any other volume the node has to decode and re-encode the audio,
// which on a busy public node is what makes music stutter.
function createPlayer(client, guildId, voiceChannelId, textChannelId, guildData) {
    return client.riffy.createConnection({
        guildId,
        voiceChannel: voiceChannelId,
        textChannel: textChannelId,
        deaf: true,
        defaultVolume: guildData.volume,
    });
}

function isDuplicateTrack(player, track) {
    const uri = track?.info?.uri;
    if (!uri) {
        return false;
    }
    if (player.current?.info?.uri === uri) {
        return true;
    }
    return player.queue.some((existing) => existing.info?.uri === uri);
}

export async function joinVoiceChannel(client, interaction) {
    assertRiffyAvailable(client);
    assertInVoice(interaction.member);

    const guildId = interaction.guild.id;
    const guildData = getGuildMusicData(guildId);
    const channel = interaction.member.voice.channel;
    assertBotVoicePermissions(channel);
    let player = getPlayer(client, guildId);

    if (player && player.voiceChannel !== channel.id) {
        try {
            player.destroy();
        } catch {
            // player may already be gone
        }
        player = null;
    }

    if (!player) {
        assertLavalinkNodeAvailable(client);
        player = createPlayer(client, guildId, channel.id, interaction.channel.id, guildData);
        guildData.playerChannelId = interaction.channel.id;
    } else if (player.volume !== guildData.volume) {
        player.setVolume(guildData.volume);
    }

    return successEmbed(
        t('Joined Voice Channel'),
        t`Connected to **${channel.name}**. Use /play to start music, or /music for playback controls.`,
    );
}

export async function playQuery(client, interaction, rawQuery) {
    const query = cleanQuery(rawQuery);
    if (!query) {
        throw new TitanBotError('Empty query', ErrorTypes.USER_INPUT, t('No results found for that query.'));
    }

    const { player } = await ensurePlayer(client, interaction);

    const result = await resolveTracks(client, query, interaction.user, player.node);

    const { loadType, tracks, playlistInfo } = result;

    if (loadType === 'playlist' || loadType === 'PLAYLIST_LOADED') {
        let added = 0;
        let skipped = 0;

        for (const track of tracks) {
            track.info.requester = interaction.user;
            if (isDuplicateTrack(player, track)) {
                skipped += 1;
                continue;
            }
            player.queue.add(track);
            added += 1;
        }

        if (!player.playing && !player.paused) {
            await startPlayback(player);
        } else {
            await refreshPlayerMessage(client, interaction.guild.id);
        }

        return {
            embed: buildPlaylistAddedEmbed(playlistInfo?.name, {
                added,
                total: tracks.length,
                skipped,
                firstTrack: tracks[0],
            }),
        };
    }

    if (
        loadType === 'search'
        || loadType === 'track'
        || loadType === 'SEARCH_RESULT'
        || loadType === 'TRACK_LOADED'
    ) {
        const track = tracks?.[0];
        if (!track) {
            throw new TitanBotError('No results', ErrorTypes.USER_INPUT, t('No results found for that query.'));
        }

        if (isDuplicateTrack(player, track)) {
            throw new TitanBotError(
                'Duplicate track',
                ErrorTypes.USER_INPUT,
                t`**${track.info.title}** is already in the queue or playing.`,
            );
        }

        track.info.requester = interaction.user;

        const willPlayNow = !player.playing && !player.paused;
        player.queue.add(track);
        const queuePosition = player.queue.length;

        if (willPlayNow) {
            await startPlayback(player);
        } else {
            await refreshPlayerMessage(client, interaction.guild.id);
        }

        return {
            embed: buildTrackAddedEmbed(track, { playingNow: willPlayNow, position: queuePosition }),
        };
    }

    throw new TitanBotError('No results', ErrorTypes.USER_INPUT, t('No results found for that query.'));
}

export async function skipTrack(client, interaction) {
    const player = getPlayer(client, interaction.guild.id);
    if (!player?.current) {
        throw new TitanBotError('No player', ErrorTypes.USER_INPUT, t('Nothing is playing right now.'));
    }
    assertCanControl(interaction.member, player);
    const title = player.current.info?.title || t('Unknown');
    // Under track-loop, stop() would replay the same track. Clear it so the skip
    // advances; trackStart re-applies the stored loop mode to the next track.
    if (player.loop === 'track') {
        player.setLoop('none');
    }
    player.stop();
    return successEmbed(t('Skipped'), t`Skipped **${title}**.`);
}

export async function stopPlayback(client, interaction) {
    const player = getPlayer(client, interaction.guild.id);
    if (!player) {
        throw new TitanBotError('No player', ErrorTypes.USER_INPUT, t('No active music player.'));
    }
    assertCanControl(interaction.member, player);

    const guildData = getGuildMusicData(interaction.guild.id);
    const queueLength = player.queue?.length || 0;

    if (queueLength >= 5 && guildData.stopConfirmPending !== interaction.user.id) {
        guildData.stopConfirmPending = interaction.user.id;
        setTimeout(() => {
            if (guildData.stopConfirmPending === interaction.user.id) {
                guildData.stopConfirmPending = null;
            }
        }, 15000);
        return successEmbed(
            t('Confirm Stop'),
            t`There are **${queueLength}** tracks in the queue. Run **/music stop** again within 15 seconds to confirm.`,
        );
    }

    guildData.stopConfirmPending = null;
    await destroyPlayerSession(client, interaction.guild.id, player, guildData);
    return successEmbed(t('Stopped'), t('Playback stopped and the queue was cleared.'));
}

export async function applyPause(client, guildId) {
    const player = getPlayer(client, guildId);
    if (!player?.current || player.paused) {
        return false;
    }

    player.pause(true);
    await refreshPlayerMessage(client, guildId);
    return true;
}

export async function applyResume(client, guildId) {
    const player = getPlayer(client, guildId);
    if (!player?.current || !player.paused) {
        return false;
    }

    player.pause(false);
    await refreshPlayerMessage(client, guildId);
    return true;
}

export async function pausePlayback(client, interaction) {
    const player = getPlayer(client, interaction.guild.id);
    if (!player?.current) {
        throw new TitanBotError('No player', ErrorTypes.USER_INPUT, t('Nothing is playing right now.'));
    }
    assertCanControl(interaction.member, player);

    if (player.paused) {
        throw new TitanBotError('Already paused', ErrorTypes.USER_INPUT, t('Playback is already paused.'));
    }

    await applyPause(client, interaction.guild.id);
    return successEmbed(t('Paused'), t('Playback paused.'));
}

export async function resumePlayback(client, interaction) {
    const player = getPlayer(client, interaction.guild.id);
    if (!player?.current) {
        throw new TitanBotError('No player', ErrorTypes.USER_INPUT, t('Nothing is playing right now.'));
    }
    assertCanControl(interaction.member, player);

    if (!player.paused) {
        throw new TitanBotError('Not paused', ErrorTypes.USER_INPUT, t('Playback is not paused.'));
    }

    await applyResume(client, interaction.guild.id);
    return successEmbed(t('Resumed'), t('Playback resumed.'));
}

export async function shuffleQueue(client, interaction) {
    const player = getPlayer(client, interaction.guild.id);
    if (!player?.queue?.length) {
        throw new TitanBotError('Empty queue', ErrorTypes.USER_INPUT, t('The queue is empty.'));
    }
    assertCanControl(interaction.member, player);
    player.queue.shuffle();
    getGuildMusicData(interaction.guild.id).shuffle = true;
    await refreshPlayerMessage(client, interaction.guild.id);
    return successEmbed(t('Shuffled'), t('The queue has been shuffled.'));
}

export async function setLoopMode(client, interaction, mode) {
    const player = getPlayer(client, interaction.guild.id);
    if (!player) {
        throw new TitanBotError('No player', ErrorTypes.USER_INPUT, t('No active music player.'));
    }
    assertCanControl(interaction.member, player);

    const guildData = getGuildMusicData(interaction.guild.id);
    guildData.loop = mode;
    player.setLoop(mode);

    const labels = { none: t('Off'), track: t('Track'), queue: t('Queue') };
    await refreshPlayerMessage(client, interaction.guild.id);
    return successEmbed(t('Loop Updated'), t`Loop mode set to **${labels[mode] || mode}**.`);
}

export async function toggleLoop(client, interaction) {
    const guildData = getGuildMusicData(interaction.guild.id);
    const next = guildData.loop === 'none' ? 'track' : guildData.loop === 'track' ? 'queue' : 'none';
    return setLoopMode(client, interaction, next);
}

export async function setVolume(client, interaction, volume) {
    const player = getPlayer(client, interaction.guild.id);
    if (!player) {
        throw new TitanBotError('No player', ErrorTypes.USER_INPUT, t('No active music player.'));
    }
    assertCanControl(interaction.member, player);

    const guildData = getGuildMusicData(interaction.guild.id);
    guildData.volume = Math.max(0, Math.min(MAX_VOLUME, volume));
    player.setVolume(guildData.volume);
    await refreshPlayerMessage(client, interaction.guild.id);
    return successEmbed(t('Volume Updated'), t`Volume set to **${guildData.volume}%**.`);
}

export async function adjustVolume(client, interaction, delta) {
    const guildData = getGuildMusicData(interaction.guild.id);
    return setVolume(client, interaction, guildData.volume + delta);
}

export async function seekTrack(client, interaction, seconds) {
    const player = getPlayer(client, interaction.guild.id);
    if (!player?.current) {
        throw new TitanBotError('No player', ErrorTypes.USER_INPUT, t('Nothing is playing right now.'));
    }
    assertCanControl(interaction.member, player);

    const info = player.current.info || {};
    if (info.isStream || info.isSeekable === false) {
        throw new TitanBotError(
            'Not seekable',
            ErrorTypes.USER_INPUT,
            t('This track cannot be seeked (it may be a live stream).'),
        );
    }

    const position = Math.max(0, seconds * 1000);
    if (info.length && position > info.length) {
        throw new TitanBotError(
            'Seek out of range',
            ErrorTypes.USER_INPUT,
            t`You can only seek up to ${Math.floor(info.length / 1000)}s for this track.`,
        );
    }

    player.seek(position);
    await refreshPlayerMessage(client, interaction.guild.id);
    return successEmbed(t('Seeked'), t`Seeked to **${seconds}s**.`);
}

export async function removeFromQueue(client, interaction, index) {
    const player = getPlayer(client, interaction.guild.id);
    if (!player?.queue?.length) {
        throw new TitanBotError('Empty queue', ErrorTypes.USER_INPUT, t('The queue is empty.'));
    }
    assertCanControl(interaction.member, player);

    const queueIndex = index - 1;
    if (queueIndex < 0 || queueIndex >= player.queue.length) {
        throw new TitanBotError('Invalid index', ErrorTypes.USER_INPUT, t`Invalid queue position. Queue has ${player.queue.length} track(s).`);
    }

    const removed = player.queue[queueIndex];
    player.queue.remove(queueIndex);
    await refreshPlayerMessage(client, interaction.guild.id);
    return successEmbed(t('Removed'), t`Removed **${removed.info?.title || 'track'}** from the queue.`);
}

export async function moveInQueue(client, interaction, from, to) {
    const player = getPlayer(client, interaction.guild.id);
    if (!player?.queue?.length) {
        throw new TitanBotError('Empty queue', ErrorTypes.USER_INPUT, t('The queue is empty.'));
    }
    assertCanControl(interaction.member, player);

    const fromIndex = from - 1;
    const toIndex = to - 1;
    if (fromIndex < 0 || fromIndex >= player.queue.length || toIndex < 0 || toIndex >= player.queue.length) {
        throw new TitanBotError('Invalid index', ErrorTypes.USER_INPUT, t('Invalid queue positions.'));
    }

    const track = player.queue[fromIndex];
    player.queue.remove(fromIndex);
    player.queue.splice(toIndex, 0, track);
    await refreshPlayerMessage(client, interaction.guild.id);
    return successEmbed(t('Moved'), t`Moved **${track.info?.title || 'track'}** to position #${to}.`);
}

export async function clearQueue(client, interaction) {
    const player = getPlayer(client, interaction.guild.id);
    if (!player?.queue?.length) {
        throw new TitanBotError('Empty queue', ErrorTypes.USER_INPUT, t('The queue is already empty.'));
    }
    assertCanControl(interaction.member, player);
    player.queue.clear();
    await refreshPlayerMessage(client, interaction.guild.id);
    return successEmbed(t('Queue Cleared'), t('All queued tracks were removed.'));
}

export async function setTwentyFourSeven(client, interaction, enabled) {
    const guildData = getGuildMusicData(interaction.guild.id);
    guildData.twentyFourSeven = enabled;
    return successEmbed(
        t('24/7 Mode'),
        enabled
            ? t('24/7 mode enabled. The bot will stay in the voice channel when the queue ends.')
            : t('24/7 mode disabled. The bot will leave after 30 seconds of idle time.'),
    );
}

export function buildNowPlayingReply(client, guildId) {
    const player = getPlayer(client, guildId);
    if (!player?.current) {
        throw new TitanBotError('No player', ErrorTypes.USER_INPUT, t('Nothing is playing right now.'));
    }
    const guildData = getGuildMusicData(guildId);
    return {
        embeds: [buildNowPlayingEmbed(player.current, player, guildData)],
    };
}

export function buildQueueReply(client, guildId, page = 0) {
    const player = getPlayer(client, guildId);
    if (!player) {
        throw new TitanBotError('No player', ErrorTypes.USER_INPUT, t('No active music player.'));
    }

    const totalPages = Math.max(1, Math.ceil((player.queue?.length || 0) / getQueuePageSize()));
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);

    return {
        embeds: [buildQueueEmbed(player.queue, player.current, safePage)],
        components: totalPages > 1 ? [buildQueuePaginationRow(safePage, totalPages)] : [],
        page: safePage,
        totalPages,
    };
}

export async function destroyPlayerSession(client, guildId, player, guildData, { forceDisconnect = false } = {}) {
    clearUpdateInterval(guildData);
    if (guildData.idleTimeout) {
        clearTimeout(guildData.idleTimeout);
        guildData.idleTimeout = null;
    }

    guildData.previousTracks = [];
    guildData.stopConfirmPending = null;
    guildData.autoPaused = false;
    guildData.queuePages?.clear();

    if (guildData.playerMessageId && guildData.playerChannelId) {
        try {
            const channel = client.channels.cache.get(guildData.playerChannelId);
            if (channel) {
                const msg = await channel.messages.fetch(guildData.playerMessageId);
                await msg.delete();
            }
        } catch {
            // message already deleted
        }
    }

    guildData.playerMessageId = null;
    guildData.playerChannelId = null;

    if (player) {
        player.queue.clear();
        player.stop();
        if (forceDisconnect || !guildData.twentyFourSeven) {
            player.destroy();
        }
    }
}

export async function leaveVoiceChannel(client, interaction) {
    assertRiffyAvailable(client);

    const guildId = interaction.guild.id;
    const player = getPlayer(client, guildId);
    if (!player) {
        throw new TitanBotError('No player', ErrorTypes.USER_INPUT, t('I am not in a voice channel.'));
    }
    assertCanControl(interaction.member, player);

    const channel = interaction.guild.channels.cache.get(player.voiceChannel);
    const channelName = channel?.name || t('voice channel');
    const guildData = getGuildMusicData(guildId);

    await destroyPlayerSession(client, guildId, player, guildData, { forceDisconnect: true });

    return successEmbed(t('Left Voice Channel'), t`Disconnected from **${channelName}**.`);
}

export async function replyMusicSuccess(interaction, embed) {
    const options = { embeds: [embed] };
    if (!interaction._isPrefixCommand) {
        options.flags = MessageFlags.Ephemeral;
    }
    await InteractionHelper.safeReply(interaction, options);
}
