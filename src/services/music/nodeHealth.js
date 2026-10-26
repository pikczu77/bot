// Picks the Lavalink node a player should use and remembers nodes that just failed.
//
// Riffy's own choice ("leastUsedNodes") sorts by how many REST calls the bot made to each
// node, so it rotates through every connected node, including overloaded or broken public
// ones. Here the order comes from each node's own stats: playing players per CPU core,
// CPU load, and the frames it failed to send (missing frames are what listeners hear as
// stutter). A node that failed a request or a track is pushed to the back for a while.

export const NODE_FAIL_COOLDOWN_MS = 3 * 60 * 1000;
const FAILED_PENALTY = 1_000_000;

// Lavalink reports frame counts per player per minute; 3000 frames are expected (one per 20 ms).
export const EXPECTED_FRAMES_PER_MINUTE = 3000;

/** Share of audio frames the node failed to deliver last minute (0..1). */
export function frameLossRatio(node) {
    const frames = node?.stats?.frameStats;
    if (!frames) {
        return 0;
    }
    const lost = (Number(frames.deficit) || 0) + (Number(frames.nulled) || 0);
    if (lost <= 0) {
        return 0;
    }
    const sent = Number(frames.sent) || 0;
    const expected = sent + lost > 0 ? sent + lost : EXPECTED_FRAMES_PER_MINUTE;
    return Math.min(1, lost / expected);
}

export function markNodeFailed(node, now = Date.now()) {
    if (node) {
        node.failedUntil = now + NODE_FAIL_COOLDOWN_MS;
    }
}

export function isNodeCoolingDown(node, now = Date.now()) {
    return Boolean(node?.failedUntil && node.failedUntil > now);
}

/** Lower is better. */
export function nodeScore(node, now = Date.now()) {
    const stats = node?.stats || {};
    const cores = Math.max(1, Number(stats.cpu?.cores) || 1);
    const playing = Number(stats.playingPlayers ?? stats.players) || 0;
    const load = Math.min(1, Math.max(0, Number(stats.cpu?.systemLoad) || 0));

    let score = (playing / cores) * 10;
    score += Math.pow(1.05, 100 * load) * 10 - 10;
    score += frameLossRatio(node) * 2000;
    if (isNodeCoolingDown(node, now)) {
        score += FAILED_PENALTY;
    }
    return score;
}

/** Connected nodes, best first. Ties keep the order from lavalink/nodes.json. */
export function rankNodes(nodes, now = Date.now()) {
    return [...nodes]
        .map((node, index) => ({ node, index, score: nodeScore(node, now) }))
        .filter(({ node }) => node.connected)
        .sort((a, b) => a.score - b.score || a.index - b.index)
        .map(({ node }) => node);
}
