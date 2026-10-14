/**
 * Single-elimination cup bracket helpers.
 * Pads the field with byes to the next power of 2 and builds a full tree.
 */

export const CUP_MIN_START = 4;
export const CUP_MAX = 64;

export function nextPowerOfTwo(n) {
    let p = 1;
    while (p < n) p *= 2;
    return p;
}

export function shufflePlayers(list) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function matchIdFor(roundSize, index) {
    return roundSize === 2 ? 'final' : `r${roundSize}_m${index}`;
}

function roundKeyFor(roundSize) {
    return roundSize === 2 ? 'final' : `r${roundSize}`;
}

function matchLabel(roundSize, index) {
    if (roundSize === 2) return 'Final';
    if (roundSize === 4) return `Semifinal ${index + 1}`;
    if (roundSize === 8) return `Quarterfinal ${index + 1}`;
    return `Round of ${roundSize} · ${index + 1}`;
}

/**
 * Build first-round pairings so byes always sit opposite a real player
 * (never null vs null). Pair order is shuffled for fairness.
 * @param {string[]} sessionIds
 * @param {number} size power of two
 * @returns {Array<[string|null, string|null]>}
 */
function firstRoundPairs(sessionIds, size) {
    const pool = shufflePlayers(sessionIds);
    const byeCount = size - pool.length;
    /** @type {Array<[string|null, string|null]>} */
    const pairs = [];

    for (let i = 0; i < byeCount; i += 1) {
        pairs.push([pool.pop(), null]);
    }
    while (pool.length >= 2) {
        pairs.push([pool.pop(), pool.pop()]);
    }
    if (pool.length !== 0) {
        throw new Error('Odd player count after bye pairing');
    }
    if (pairs.length !== size / 2) {
        throw new Error('First-round pair count mismatch');
    }

    return shufflePlayers(pairs);
}

/**
 * @param {Array<{ sessionId: string }>} players
 * @returns {{ matches: Record<string, object>, rounds: string[], size: number }}
 */
export function buildCupBracket(players) {
    const n = players.length;
    if (n < CUP_MIN_START || n > CUP_MAX) {
        throw new Error(`Cup needs ${CUP_MIN_START}–${CUP_MAX} players`);
    }

    const size = nextPowerOfTwo(n);
    const pairs = firstRoundPairs(
        players.map((p) => p.sessionId),
        size
    );

    /** @type {Record<string, object>} */
    const matches = {};
    /** @type {string[]} */
    const rounds = [];

    for (let roundSize = size; roundSize >= 2; roundSize /= 2) {
        const matchCount = roundSize / 2;
        const roundKey = roundKeyFor(roundSize);
        rounds.push(roundKey);

        for (let i = 0; i < matchCount; i += 1) {
            const id = matchIdFor(roundSize, i);
            const parentRoundSize = roundSize / 2;
            const parentId =
                roundSize === 2
                    ? null
                    : matchIdFor(parentRoundSize, Math.floor(i / 2));
            const parentSlot = roundSize === 2 ? null : i % 2;
            const pair = roundSize === size ? pairs[i] : [null, null];

            matches[id] = {
                id,
                label: matchLabel(roundSize, i),
                round: roundKey,
                roundSize,
                index: i,
                playerIds: [...pair],
                winnerId: null,
                roomCode: null,
                status: 'pending',
                parentId,
                parentSlot,
            };
        }
    }

    applyOpeningByes(matches, size);

    return { matches, rounds, size };
}

function feedWinnerIntoParent(matches, match) {
    if (!match.parentId || match.parentSlot == null || !match.winnerId) return;
    const parent = matches[match.parentId];
    if (!parent) return;
    parent.playerIds[match.parentSlot] = match.winnerId;
}

/** Resolve first-round byes (one real player + null). */
function applyOpeningByes(matches, size) {
    const firstRound = roundKeyFor(size);
    for (const match of Object.values(matches)) {
        if (match.round !== firstRound) continue;
        const [a, b] = match.playerIds;
        if (a && !b) {
            match.status = 'done';
            match.winnerId = a;
            feedWinnerIntoParent(matches, match);
        } else if (!a && b) {
            match.status = 'done';
            match.winnerId = b;
            feedWinnerIntoParent(matches, match);
        }
    }
}

/**
 * Match ids that are ready to open a live room (two players, still pending).
 * @param {Record<string, object>} matches
 * @returns {string[]}
 */
export function readyMatchIds(matches) {
    return Object.values(matches)
        .filter(
            (m) =>
                m.status === 'pending' &&
                m.playerIds?.[0] &&
                m.playerIds?.[1]
        )
        .map((m) => m.id);
}

/**
 * After a match result: write winner into parent; return parent if both slots filled.
 * @returns {{ parent: object|null, cupFinished: boolean }}
 */
export function placeWinner(matches, matchId, winnerSessionId) {
    const match = matches[matchId];
    if (!match || match.status === 'done') {
        return { parent: null, cupFinished: false };
    }

    match.winnerId = winnerSessionId;
    match.status = 'done';
    match.roomCode = null;

    if (!match.parentId) {
        return { parent: null, cupFinished: true };
    }

    feedWinnerIntoParent(matches, match);
    const parent = matches[match.parentId];
    const ready =
        parent &&
        parent.status === 'pending' &&
        parent.playerIds?.[0] &&
        parent.playerIds?.[1];
    return { parent: ready ? parent : null, cupFinished: false };
}
