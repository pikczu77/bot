import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { getPaginationRow } from '../../utils/components.js';
import { t } from '../../i18n/index.js';

const QUEUE_PAGE_SIZE = 10;

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

function getTrackArtwork(track) {
    return track?.info?.artworkUrl || track?.info?.thumbnail || null;
}

function getLoopLabel(loop) {
    switch (loop) {
        case 'track':
            return t('Track');
        case 'queue':
            return t('Queue');
        default:
            return t('Off');
    }
}

export function buildNowPlayingEmbed(track, player, guildData) {
    const requester = track?.info?.requester;
    const requesterLabel = requester
        ? (requester.username || requester.tag || t('Unknown'))
        : t('Unknown');

    const position = formatDuration(player?.position || 0);
    const duration = formatDuration(track?.info?.length || 0);

    return createEmbed({
        title: t('Now Playing'),
        description: track?.info?.title || t('Unknown track'),
        color: 'primary',
        fields: [
            { name: t('Artist'), value: track?.info?.author || t('Unknown'), inline: true },
            { name: t('Requester'), value: requesterLabel, inline: true },
            { name: t('Progress'), value: `${position} / ${duration}`, inline: true },
            { name: t('Volume'), value: `${guildData?.volume ?? 75}%`, inline: true },
            { name: t('Loop'), value: getLoopLabel(guildData?.loop), inline: true },
            { name: t('Queue'), value: t`${player?.queue?.length || 0} track(s)`, inline: true },
        ],
        thumbnail: getTrackArtwork(track),
        footer: player?.paused ? t('Paused') : t('Playing'),
    });
}

export function buildQueueEmbed(queue, currentTrack, page = 0) {
    const totalTracks = queue?.length || 0;
    const totalPages = Math.max(1, Math.ceil(totalTracks / QUEUE_PAGE_SIZE));
    const safePage = Math.min(Math.max(page, 0), totalPages - 1);
    const start = safePage * QUEUE_PAGE_SIZE;
    const slice = queue?.slice(start, start + QUEUE_PAGE_SIZE) || [];

    let description = '';
    if (currentTrack) {
        description += t`**Now Playing**\n${currentTrack.info?.title || t('Unknown')} — ${currentTrack.info?.author || t('Unknown')}\n\n`;
    }

    if (slice.length === 0) {
        description += t('The queue is empty.');
    } else {
        description += slice
            .map((track, index) => {
                const num = start + index + 1;
                return `${num}. ${track.info?.title || t('Unknown')} — ${track.info?.author || t('Unknown')}`;
            })
            .join('\n');
    }

    return createEmbed({
        title: t('Music Queue'),
        description: description.substring(0, 4096),
        color: 'info',
        footer: t`Page ${safePage + 1} of ${totalPages} • ${totalTracks} queued`,
    });
}

export function buildPlayerButtonRows(player, guildData) {
    const paused = player?.paused;
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.PAUSE)
            .setLabel(t('Pause'))
            .setStyle(ButtonStyle.Primary)
            .setEmoji('⏸️')
            .setDisabled(Boolean(paused)),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.RESUME)
            .setLabel(t('Resume'))
            .setStyle(ButtonStyle.Success)
            .setEmoji('▶️')
            .setDisabled(!paused),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.SKIP)
            .setLabel(t('Skip'))
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('⏭️'),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.STOP)
            .setLabel(t('Stop'))
            .setStyle(ButtonStyle.Danger)
            .setEmoji('⏹️'),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.SHUFFLE)
            .setLabel(t('Shuffle'))
            .setStyle(guildData?.shuffle ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji('🔀'),
    );

    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.LOOP)
            .setLabel(t('Loop'))
            .setStyle(guildData?.loop !== 'none' ? ButtonStyle.Success : ButtonStyle.Secondary)
            .setEmoji('🔁'),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.VOL_DOWN)
            .setLabel(t('Vol -'))
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🔉'),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.VOL_UP)
            .setLabel(t('Vol +'))
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('🔊'),
        new ButtonBuilder()
            .setCustomId(MUSIC_BUTTON_IDS.QUEUE)
            .setLabel(t('Queue'))
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📋'),
    );

    return [row1, row2];
}

export function buildQueuePaginationRow(page, totalPages) {
    return getPaginationRow('music_queue', page + 1, totalPages);
}

export function getQueuePageSize() {
    return QUEUE_PAGE_SIZE;
}
