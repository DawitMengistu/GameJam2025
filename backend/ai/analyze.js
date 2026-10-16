/**
 * Post-game move analysis: replay each seat vs remaining possibles + NN rank.
 * Does not use the secret to judge mid-game quality (only for hit/luck).
 */

import {
    LEGAL_CODES,
    scoreGuess,
    filterPossibles,
} from './codes.js';
import { rankGuessAmongPossibles } from './policy.js';

function historyEntryToParts(entry) {
    if (!entry || !entry.length) return null;
    // Live format: [d0,d1,d2,d3,n,o]
    if (entry.length >= 6 && typeof entry[0] === 'number') {
        const guess = entry.slice(0, 4).join('');
        return { guess, n: Number(entry[4]), o: Number(entry[5]) };
    }
    // Policy format: [guessStr, n, o]
    if (typeof entry[0] === 'string') {
        return {
            guess: entry[0],
            n: Number(entry[1]),
            o: Number(entry[2]),
        };
    }
    return null;
}

function expectedRemaining(possibles, guess) {
    if (!possibles.length) return 0;
    const buckets = new Map();
    for (const secret of possibles) {
        const [n, o] = scoreGuess(guess, secret);
        const key = `${n},${o}`;
        buckets.set(key, (buckets.get(key) || 0) + 1);
    }
    let expected = 0;
    const total = possibles.length;
    for (const size of buckets.values()) {
        expected += (size / total) * size;
    }
    return expected;
}

function bestExpectedRemaining(possibles) {
    if (!possibles.length) return 0;
    // Sample up to 40 candidates to keep analysis fast on large pools
    const step = Math.max(1, Math.floor(possibles.length / 40));
    let best = Infinity;
    for (let i = 0; i < possibles.length; i += step) {
        const e = expectedRemaining(possibles, possibles[i]);
        if (e < best) best = e;
    }
    return best === Infinity ? possibles.length : best;
}

function infoScore(possibles, guess) {
    if (possibles.length <= 1) return 1;
    const mine = expectedRemaining(possibles, guess);
    const best = bestExpectedRemaining(possibles);
    if (mine <= 0) return 1;
    // 1 when as good as best splitter; approaches 0 when worse
    const ratio = best / mine;
    return Math.max(0, Math.min(1, ratio));
}

function tagFromScore(score, blunder) {
    if (blunder) return 'blunder';
    if (score >= 0.85) return 'great';
    if (score >= 0.65) return 'good';
    if (score >= 0.4) return 'okay';
    return 'weak';
}

function labelForMove({ blunder, score, info, percentile, hit, pool }) {
    if (blunder) return 'Impossible under known clues';
    if (hit && pool >= 40) return 'Lucky hit — many codes left';
    if (hit && pool >= 12) return 'Hit with a fair pool left';
    if (hit) return 'Clean finish';
    if (score >= 0.85) return 'Strong pick';
    if (info >= 0.75 && percentile < 0.5) return 'Smart split';
    if (percentile >= 0.8) return 'Near top policy pick';
    if (score < 0.4) return 'Weak info';
    return 'Solid enough';
}

function luckFromHitPools(hitPools) {
    if (!hitPools.length) return 'fair';
    const maxPool = Math.max(...hitPools);
    if (maxPool >= 40) return 'high';
    if (maxPool >= 12) return 'fair';
    return 'low';
}

/**
 * @param {any[]} rawHistory board history rows
 * @param {string | null} targetSecret opponent secret (for hit detection only)
 */
export function analyzeSeat(rawHistory, targetSecret = null) {
    const rows = Array.isArray(rawHistory) ? rawHistory : [];
    let possibles = [...LEGAL_CODES];
    /** @type {[string, number, number][]} */
    const policyHistory = [];
    const moves = [];
    let blunders = 0;
    const hitPools = [];
    let bestMove = null;
    let worstMove = null;

    for (let i = 0; i < rows.length; i++) {
        const parts = historyEntryToParts(rows[i]);
        if (!parts?.guess) continue;
        const { guess, n, o } = parts;
        const poolBefore = possibles;
        const poolSize = poolBefore.length;
        const inPool = poolBefore.includes(guess);
        const hit =
            (n === 4 && o === 4) ||
            (targetSecret && guess === String(targetSecret));

        let rank = poolSize;
        let percentile = 0;
        let info = 0;
        let score = 0;
        let blunder = false;

        if (!inPool) {
            blunder = true;
            blunders += 1;
            score = 0;
            rank = poolSize || 1;
            percentile = 0;
            info = 0;
        } else {
            const ranked = rankGuessAmongPossibles(
                policyHistory,
                poolBefore,
                guess
            );
            rank = ranked.rank;
            percentile = ranked.percentile;
            info = infoScore(poolBefore, guess);
            // Soft-weight the winning guess so luck doesn't inflate accuracy
            const blend = 0.55 * percentile + 0.45 * info;
            score = hit ? Math.min(1, blend * 0.85 + 0.15) : blend;
            if (hit) hitPools.push(poolSize);
        }

        const tag = tagFromScore(score, blunder);
        const label = labelForMove({
            blunder,
            score,
            info,
            percentile,
            hit,
            pool: poolSize,
        });
        const move = {
            round: i + 1,
            guess,
            score: Math.round(score * 1000) / 1000,
            info: Math.round(info * 1000) / 1000,
            rank,
            pool: poolSize,
            tag,
            label,
            hit: Boolean(hit),
            blunder,
        };
        moves.push(move);

        if (!bestMove || move.score > bestMove.score) {
            bestMove = { round: move.round, label: move.label, score: move.score };
        }
        if (!worstMove || move.score < worstMove.score) {
            worstMove = { round: move.round, label: move.label, score: move.score };
        }

        policyHistory.push([guess, n, o]);
        if (inPool) {
            possibles = filterPossibles(poolBefore, guess, n, o);
        }
        // If blunder, still filter by observed N/O from the real secret path
        // so later moves are judged against what the player actually saw.
        else if (poolBefore.length) {
            possibles = filterPossibles(poolBefore, guess, n, o);
            if (!possibles.length) possibles = [...LEGAL_CODES];
        }
    }

    const accuracy =
        moves.length === 0
            ? 0
            : Math.round(
                  (moves.reduce((s, m) => s + m.score, 0) / moves.length) * 100
              );

    return {
        accuracy,
        luck: luckFromHitPools(hitPools),
        blunders,
        bestMove: bestMove
            ? { round: bestMove.round, label: bestMove.label }
            : null,
        worstMove: worstMove
            ? { round: worstMove.round, label: worstMove.label }
            : null,
        guessCount: moves.length,
        moves,
    };
}

/**
 * @param {{
 *   playerOneHistory?: any[],
 *   playerTwoHistory?: any[],
 *   playerOneSecret?: string | null,
 *   playerTwoSecret?: string | null,
 *   vsAI?: boolean,
 * }} snap
 */
export function analyzeGame(snap = {}) {
    // P1 guesses at P2 secret; P2 guesses at P1 secret
    const playerOne = analyzeSeat(
        snap.playerOneHistory || [],
        snap.playerTwoSecret || null
    );
    const playerTwo = analyzeSeat(
        snap.playerTwoHistory || [],
        snap.playerOneSecret || null
    );
    return {
        version: 1,
        playerOne,
        playerTwo,
    };
}
