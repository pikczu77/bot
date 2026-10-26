import { ActionRowBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { getPaginationRow } from '../../utils/components.js';
import { estimatePosition } from './playerRecovery.js';
import { t } from '../../i18n/index.js';

const QUEUE_PAGE_SIZE = 10;
const PROGRESS_SEGMENTS = 16;
export const MAX_VOLUME = 100;

export const MUSIC_BUTTON_IDS = {
    PAUSE: 'music_pause',
    RESUME: 'music_resume',
    SKIP: 'music_skip',
    STOP: 'music_stop',
    SHUFFLE: 'music_shuffle',
    LOOP: 'music_loop',
    VOL_DOWN: 'music_vol_down',
    VOL_UP: 'music_vol_up',
    QUEUE: 'music_queue',
    QUEUE_FIRST: 'music_queue_first',
    QUEUE_PREV: 'music_queue_prev',
    QUEUE_NEXT: 'music_queue_next',
    QUEUE_LAST: 'music_queue_last',
};

export function formatDuration(ms) {
    if (!ms || Number.isNaN(ms)) {
        return t('Live');
    }
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** `1:23` ━━━━●──────── `3:45` */
export function buildProgressBar(position, length, segments = PROGRESS_SEGMENTS) {
    const ratio = length > 0 ? Math.min(1, Math.max(0, position / length)) : 0;
    const filled = Math.min(segments - 1, Math.round(ratio * (segments - 1)));
    const bar = `${'━'.repeat(filled)}●${'─'.repeat(segments - 1 - filled)}`;
    return `\`${formatDuration(position || 1)}\` ${bar} \`${formatDuration(length)}\``;
}

function clip(text, max) {
    const value = String(text ?? '');
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function plainTitle(info, max = 80) {
    return clip(info?.title || t('Unknown track'), max);
}

/** Title as a link when the track has one; brackets removed so the link cannot break. */
function linkedTitle(info, max = 80) {
    const title = escapeMarkdown(plainTitle(info, max)).replace(/[[\]]/g, '');
    const uri = info?.uri;
    return uri && /^https?:\/\//.test(uri) ? `[${title}](${uri})` : `**${title}**`;
}

function trackAuthor(info) {
    return escapeMarkdown(clip(info?.author || t('Unknown'), 60));
}

function trackLength(info) {
    return info?.isStream ? t('Live') : formatDuration(info?.length || 0);
}

function getTrackArtwork(track) {
    return track?.info?.artworkUrl || track?.info?.thumbnail || null;
}

function requesterText(track) {
    const requester = track?.info?.requester || track?.requester;
    if (requester?.id) {
        return `<@${requester.id}>`;
    }
    return requester?.username || requester?.tag || t('Unknown');
}

function getLoopLabel(loop) {
    switch (loop) {
        case 'track':
            return t('🔂 Track');
        case 'queue':
            return t('🔁 Queue');
        default:
            return t('Off');
    }
}

function queueDuration(queue) {
    return (queue || []).reduce((sum, track) => sum + (track.info?.isStream ? 0 : track.info?.length || 0), 0);
}

export function buildNowPlayingEmbed(track, player, guildData) {
    const info = track?.info || {};
    const paused = Boolean(player?.paused);
    const position = estimatePosition(player);
    const queue = player?.queue || [];

    const progress = info.isStream
        ? t('🔴 Live stream')
        : buildProgressBar(position, info.length || 0);

    const next = queue[0];
    const nextValue = next
        ? `${linkedTitle(next.info, 60)} · ${trackAuthor(next.info)}${queue.length > 1 ? `\n${t`+${queue.length - 1} more in the queue`}` : ''}`
        : t('Nothing queued. Add songs with /play.');

    const footer = queue.length
        ? t`${queue.length} in queue · ${formatDuration(queueDuration(queue) || 1)} in total`
        : null;

    return createEmbed({
        author: { name: paused ? t('⏸️ Paused') : t('🎶 Now Playing') },
        title: plainTitle(info, 250),
        url: info.uri && /^https?:\/\//.test(info.uri) ? info.uri : null,
        description: `${trackAuthor(info)}\n\n${progress}`,
        color: paused ? 'warning' : 'primary',
        fields: [
            { name: t('Requested by'), value: requesterText(track), inline: true },
            { name: t('Volume'), value: `${guildData?.volume ?? MAX_VOLUME}%`, inline: true },
            { name: t('Loop'), value: getLoopLabel(guildData?.loop), inline: true },
            { name: t('Up next'), value: nextValue, inline: false },
        ],
        thumbnail: getTrackArtwork(track),
        footer,
    });
}

/** Private answer to /play. */
export function buildTrackAddedEmbed(track, { playingNow = false, position = 0 } = {}) {
    const info = track?.info || {};
    const lines = [
        `${linkedTitle(info, 90)}`,
        `${trackAuthor(info)} · \`${trackLength(info)}\``,
    ];
    if (!playingNow) {
        lines.push('', t`Position in queue: **#${position}**`);
    }
    return createEmbed({
        author: { name: playingNow ? t('🎶 Now Playing') : t('➕ Added to the queue') },
        description: lines.join('\n'),
        color: 'primary',
        thumbnail: getTrackArtwork(track),
    });
}

export function buildPlaylistAddedEmbed(name, { added, total, skipped, firstTrack }) {
    const lines = [
        `**${escapeMarkdown(clip(name || t('Playlist'), 100))}**`,
        t`Added ${added} of ${total} track(s).`,
    ];
    if (skipped) {
        lines.push(t`Skipped ${skipped} duplicate(s).`);
    }
    return createEmbed({
        author: { name: t('📃 Playlist added') },
        description: lines.join('\n'),
        color: 'primary',
        thumbnail: getTrackArtwork(firstTrack),
    });
}

export function buildQueueEmbed(queue, currentTrack, page = 0) {
    const totalTracks = queue?.length || 0;
    const totalPages = Math.max(1, Math.ceil(totalTracks / QUEUE_PAGE_SIZE));
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);
    const start = safePage * QUEUE_PAGE_SIZE;
    const slice = queue?.slice(start, start + QUEUE_PAGE_SIZE) || [];

    const parts = [];
    if (currentTrack) {
        parts.push(`**${t('Now Playing')}**\n${linkedTitle(currentTrack.info, 70)} · ${trackAuthor(currentTrack.info)} · \`${trackLength(currentTrack.info)}\``);
    }

    if (slice.length === 0) {
        parts.push(t('The queue is empty.'));
    } else {
        const lines = slice.map((track, index) =>
            `\`${String(start + index + 1).padStart(2, ' ')}.\` ${linkedTitle(track.info, 55)} · ${trackAuthor(track.info)} · \`${trackLength(track.info)}\``);
        parts.push(`**${t('Up next')}**\n${lines.join('\n')}`);
    }

    let description = parts.join('\n\n');
    if (description.length > 4096) {
        description = `${description.slice(0, 4093)}...`;
    }

    return createEmbed({
        author: { name: t('📋 Music Queue') },
        description,
        color: 'primary',
        thumbnail: getTrackArtwork(currentTrack),
        footer: t`Page ${safePage + 1} of ${totalPages} · ${totalTracks} queued · ${formatDuration(queueDuration(queue) || 1)} in total`,
    });
}

export function buildPlayerButtonRows(player, guildData) {
    const paused = Boolean(player?.paused);
    const loop = guildData?.loop || 'none';
    const volume = guildData?.volume ?? MAX_VOLUME;

    const controls = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(paused ? MUSIC_BUTTON_IDS.RESUME : MUSIC_BUTTON_IDS.PAUSE)
            .setStyle(paused ? ButtonStyle.Success : ButtonStyle.Primary)
            .setEmoji(paused ? '▶️' : '⏸️'),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.SKIP)
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⏭️'),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.STOP)
            .setStyle(ButtonStyle.Danger)
            .setEmoji('⏹️'),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.SHUFFLE)
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🔀')
            .setDisabled(!(player?.queue?.length > 1)),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.LOOP)
            .setStyle(loop !== 'none' ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji(loop === 'track' ? '🔂' : '🔁'),
    );

    const extras = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.VOL_DOWN)
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🔉')
            .setDisabled(volume <= 0),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.VOL_UP)
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🔊')
            .setDisabled(volume >= MAX_VOLUME),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.QUEUE)
            .setLabel(t('Queue'))
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📋'),
    );

    return [controls, extras];
}

export function buildQueuePaginationRow(page, totalPages) {
    return getPaginationRow('music_queue', page + 1, totalPages);
}

export function getQueuePageSize() {
    return QUEUE_PAGE_SIZE;
}
