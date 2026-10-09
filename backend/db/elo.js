/**
 * Standard Elo rating (FIDE-style expected score).
 * K = 32 for active / provisional play (common default for online games).
 */

export const ELO_K = 32;
export const ELO_START = 100;
/** Display / reference rating for the ATP AI opponent (does not change). */
export const AI_DEFAULT_ELO = Number(process.env.AI_DEFAULT_ELO || 1000);

/**
 * @param {number} ratingA
 * @param {number} ratingB
 * @returns {number} expected score for A (0..1)
 */
export function expectedScore(ratingA, ratingB) {
    return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

/**
 * @param {number} rating
 * @param {number} expected
 * @param {number} score 1 win, 0.5 draw, 0 loss
 * @param {number} [k]
 */
export function nextRating(rating, expected, score, k = ELO_K) {
    return Math.round(rating + k * (score - expected));
}

/**
 * Update both players after a decisive game (no draws in ATP).
 * @returns {{ aAfter: number, bAfter: number, aDelta: number, bDelta: number }}
 */
export function applyEloPair(ratingA, ratingB, aWon) {
    const ea = expectedScore(ratingA, ratingB);
    const eb = expectedScore(ratingB, ratingA);
    const scoreA = aWon ? 1 : 0;
    const scoreB = aWon ? 0 : 1;
    const aAfter = nextRating(ratingA, ea, scoreA);
    const bAfter = nextRating(ratingB, eb, scoreB);
    return {
        aAfter,
        bAfter,
        aDelta: aAfter - ratingA,
        bDelta: bAfter - ratingB,
    };
}
