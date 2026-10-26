import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { frameLossRatio, markNodeFailed, nodeScore, rankNodes } from '../src/services/music/nodeHealth.js';
import { estimatePosition, movePlayer, retryOnAnotherNode } from '../src/services/music/playerRecovery.js';
import { prepareNode } from '../src/services/music/riffySetup.js';
import { cleanQuery, resolveTracks } from '../src/services/music/musicActions.js';
import {
  buildNowPlayingEmbed,
  buildPlayerButtonRows,
  buildProgressBar,
  buildQueueEmbed,
  buildTrackAddedEmbed,
  MUSIC_BUTTON_IDS,
} from '../src/services/music/musicEmbeds.js';
import { GuildMusicData } from '../src/services/music/playerStore.js';
import { runWithLocale } from '../src/i18n/index.js';

const require = createRequire(import.meta.url);
const { Node } = require('riffy');

function fakeNode(name, stats = {}, extra = {}) {
  const calls = [];
  return {
    name,
    connected: true,
    sessionId: `s-${name}`,
    stats: { players: 0, playingPlayers: 0, cpu: { cores: 4, systemLoad: 0.1 }, frameStats: null, ...stats },
    calls,
    rest: {
      updatePlayer: async (options) => { calls.push(['update', options]); return {}; },
      destroyPlayer: async (guildId) => { calls.push(['destroy', guildId]); return null; },
    },
    ...extra,
  };
}

function fakeTrack(title, extra = {}) {
  return {
    track: `enc-${title}`,
    info: {
      title,
      author: 'Artist',
      length: 200_000,
      uri: `https://www.youtube.com/watch?v=${title}`,
      artworkUrl: 'https://i.ytimg.com/vi/x/hqdefault.jpg',
      isSeekable: true,
      ...extra,
    },
  };
}

function fakePlayer(node, extra = {}) {
  const queue = [];
  queue.add = (track) => queue.push(track);
  return {
    guildId: 'g1',
    node,
    voiceChannel: 'vc1',
    volume: 100,
    position: 30_000,
    playing: true,
    paused: false,
    migrating: false,
    data: {},
    queue,
    current: fakeTrack('song'),
    connection: { voice: { sessionId: 'sess', endpoint: 'c-waw01.discord.media', token: 'tok' } },
    play: async () => {},
    ...extra,
  };
}

function fakeRiffy(nodes, players = []) {
  const events = [];
  return {
    nodeMap: new Map(nodes.map((node) => [node.name, node])),
    players: new Map(players.map((player) => [player.guildId, player])),
    emit: (...args) => events.push(args),
    events,
  };
}

test('overloaded, stuttering and failed nodes go to the back', () => {
  const calm = fakeNode('calm', { playingPlayers: 5, cpu: { cores: 2, systemLoad: 0.3 } });
  const crowded = fakeNode('crowded', { playingPlayers: 1025, cpu: { cores: 2, systemLoad: 0 }, frameStats: { sent: 2659, nulled: 32, deficit: 114 } });
  const big = fakeNode('big', { playingPlayers: 372, cpu: { cores: 32, systemLoad: 0 } });
  const failed = fakeNode('failed');
  const offline = fakeNode('offline', {}, { connected: false });
  markNodeFailed(failed);

  const order = rankNodes([crowded, failed, offline, big, calm]).map((node) => node.name);
  // calm: 2.5 playing per core, big: 11.6 per core
  assert.deepEqual(order, ['calm', 'big', 'crowded', 'failed']);
  assert.ok(nodeScore(failed) > nodeScore(crowded));
});

test('frame loss is the share of audio frames not sent', () => {
  assert.equal(frameLossRatio(fakeNode('a')), 0);
  const lossy = fakeNode('b', { frameStats: { sent: 2850, nulled: 50, deficit: 100 } });
  assert.equal(frameLossRatio(lossy), 0.05);
});

test('YouTube radio links keep only the song, normal playlists stay', () => {
  assert.equal(
    cleanQuery('https://www.youtube.com/watch?v=abc123&list=RDabc123&start_radio=1&si=xyz'),
    'https://www.youtube.com/watch?v=abc123',
  );
  assert.equal(
    cleanQuery('https://www.youtube.com/playlist?list=PL1234'),
    'https://www.youtube.com/playlist?list=PL1234',
  );
  assert.equal(cleanQuery('  <https://youtu.be/abc?si=q>  '), 'https://youtu.be/abc');
  assert.equal(cleanQuery('  dawid podsiadło  '), 'dawid podsiadło');
});

test('search falls back to the next node and to YouTube when YouTube Music finds nothing', async () => {
  const broken = fakeNode('broken');
  const good = fakeNode('good', { playingPlayers: 1 });
  const asked = [];
  const client = {
    riffy: {
      nodeMap: new Map([['broken', broken], ['good', good]]),
      resolve: async ({ node, source }) => {
        asked.push(`${node.name}:${source}`);
        if (node === broken) throw new Error('500 proxy error');
        if (source === 'ytmsearch') return { loadType: 'empty', tracks: [] };
        return { loadType: 'search', tracks: [fakeTrack('found')] };
      },
    },
  };

  const result = await resolveTracks(client, 'some song', { id: 'u1' }, broken);
  assert.equal(result.tracks[0].info.title, 'found');
  assert.equal(result.node, good);
  assert.deepEqual(asked, ['broken:ytmsearch', 'good:ytmsearch', 'good:ytsearch']);
  assert.ok(broken.failedUntil > Date.now(), 'the broken node is avoided for a while');
});

test('search reports that no music server answered', async () => {
  const down = fakeNode('down');
  const client = { riffy: { nodeMap: new Map([['down', down]]), resolve: async () => { throw new Error('ECONNRESET'); } } };
  await assert.rejects(() => resolveTracks(client, 'x', null), (error) => /music servers did not answer/i.test(error.userMessage));
});

test('moving a player sends voice with channelId, the track and the position', async () => {
  const from = fakeNode('from');
  const to = fakeNode('to');
  const player = fakePlayer(from);
  await movePlayer(player, to, { position: 42_000 });

  assert.equal(player.node, to);
  assert.equal(player.migrating, false);
  const [, update] = to.calls.find(([kind]) => kind === 'update');
  assert.equal(update.data.voice.channelId, 'vc1');
  assert.equal(update.data.voice.endpoint, 'c-waw01.discord.media');
  assert.equal(update.data.track.encoded, 'enc-song');
  assert.equal(update.data.position, 42_000);
  assert.deepEqual(from.calls.map(([kind]) => kind), ['destroy']);
});

test('a failed track is retried on another node, at most twice, then skipped', async () => {
  const a = fakeNode('a');
  const b = fakeNode('b', { playingPlayers: 1 });
  const c = fakeNode('c', { playingPlayers: 2 });
  const player = fakePlayer(a);
  const riffy = fakeRiffy([a, b, c], [player]);

  assert.equal(retryOnAnotherNode(riffy, player, 'track failed'), true);
  assert.equal(player.migrating, true, 'Riffy must ignore the old node\'s end event');
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(player.node, b);

  assert.equal(retryOnAnotherNode(riffy, player, 'track failed'), true);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(player.node, c);

  assert.equal(retryOnAnotherNode(riffy, player, 'track failed'), false, 'third failure skips the track');
});

test('events from a node the player left are dropped', () => {
  const handled = [];
  const node = { rest: { makeRequest: async () => null }, riffy: { players: new Map() } };
  node.message = (data) => handled.push(JSON.parse(data.toString()).op);
  prepareNode(node);

  const other = {};
  node.riffy.players.set('g1', { node: other });
  node.message(Buffer.from(JSON.stringify({ op: 'event', guildId: 'g1', type: 'TrackEndEvent' })));
  node.message(Buffer.from(JSON.stringify({ op: 'stats', players: 1 })));
  node.riffy.players.set('g1', { node });
  node.message(Buffer.from(JSON.stringify({ op: 'playerUpdate', guildId: 'g1' })));

  assert.deepEqual(handled, ['stats', 'playerUpdate']);
});

test('REST answers with 5xx are not retried for 30 seconds', async () => {
  const seen = [];
  const node = { rest: { makeRequest: async (...args) => { seen.push(args[4]); return null; } }, riffy: { players: new Map() }, message() {} };
  prepareNode(node);
  await node.rest.makeRequest('GET', '/v4/info');
  assert.deepEqual(seen, [5]);
});

test('the Riffy node class still has the parts prepareNode changes', () => {
  assert.equal(typeof Node.prototype.message, 'function');
  assert.equal(typeof Node.prototype.connect, 'function');
});

test('position estimate moves on between Lavalink updates and stops at the end', () => {
  const player = fakePlayer(fakeNode('a'), { position: 10_000, data: { positionAt: 1_000 } });
  assert.equal(estimatePosition(player, 4_000), 13_000);
  player.paused = true;
  assert.equal(estimatePosition(player, 4_000), 10_000);
  player.paused = false;
  assert.equal(estimatePosition(player, 1_000_000), 200_000);
});

test('player message: progress bar, next song, toggle button, Polish text', async () => {
  const node = fakeNode('a');
  const player = fakePlayer(node, { position: 100_000, data: { positionAt: Date.now() } });
  player.queue.add(fakeTrack('next one'));
  player.queue.add(fakeTrack('third'));
  player.current.info.requester = { id: '123', username: 'pikczu' };
  const guildData = new GuildMusicData();

  assert.equal(guildData.volume, 100, 'default volume avoids re-encoding on the node');
  assert.match(buildProgressBar(100_000, 200_000), /^`1:40` ━{8}●─{7} `3:20`$/);

  await runWithLocale('pl', () => {
    const embed = buildNowPlayingEmbed(player.current, player, guildData).toJSON();
    assert.equal(embed.author.name, '🎶 Teraz gra');
    assert.equal(embed.title, 'song');
    assert.equal(embed.url, 'https://www.youtube.com/watch?v=song');
    assert.match(embed.description, /━●─/);
    assert.ok(embed.fields.some((field) => field.name === 'Dodał(a)' && field.value === '<@123>'));
    assert.ok(embed.fields.some((field) => field.name === 'Następne' && /next one/.test(field.value) && /\+1 więcej/.test(field.value)));

    const [controls, extras] = buildPlayerButtonRows(player, guildData).map((row) => row.toJSON().components);
    assert.equal(controls[0].custom_id, MUSIC_BUTTON_IDS.PAUSE);
    assert.equal(extras[1].disabled, true, 'volume up is off at 100%');

    player.paused = true;
    const pausedRows = buildPlayerButtonRows(player, guildData).map((row) => row.toJSON().components);
    assert.equal(pausedRows[0][0].custom_id, MUSIC_BUTTON_IDS.RESUME);
    assert.equal(buildNowPlayingEmbed(player.current, player, guildData).toJSON().author.name, '⏸️ Wstrzymano');

    const added = buildTrackAddedEmbed(fakeTrack('[weird] *title*', { uri: 'https://youtu.be/w' }), { position: 3 }).toJSON();
    assert.match(added.description, /Miejsce w kolejce: \*\*#3\*\*/);
    assert.ok(!added.description.includes('[weird]'), 'brackets cannot break the link');

    const queue = buildQueueEmbed(player.queue, player.current, 0).toJSON();
    assert.match(queue.description, /` 1\.` \[next one\]/);
    assert.match(queue.footer.text, /Strona 1 z 1/);
  });
});
