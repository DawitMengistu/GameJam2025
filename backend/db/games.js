import { getSql, isDbConfigured } from './pool.js';
import { applyEloPair, AI_DEFAULT_ELO } from './elo.js';

export { AI_DEFAULT_ELO };

/**
 * Persist a finished match. PvP updates Elo; AI games record only (human Elo unchanged).
 *
 * @param {{
 *   roomCode: string,
 *   mode: 'pvp' | 'ai',
 *   playerOneId: string | null,
 *   playerTwoId: string | null,
 *   winnerKey: 'playerOne' | 'playerTwo',
 *   playerOneHistory: number[][],
 *   playerTwoHistory: number[][],
 * }} opts
 */
export async function recordFinishedGame(opts) {
    if (!isDbConfigured()) return null;

    const sql = getSql();
    const {
        roomCode,
        mode,
        playerOneId,
        playerTwoId,
        winnerKey,
        playerOneHistory,
        playerTwoHistory,
    } = opts;

    const board = {
        playerOneHistory,
        playerTwoHistory,
        winner: winnerKey,
        ai_elo: mode === 'ai' ? AI_DEFAULT_ELO : undefined,
    };

    let p1Before = null;
    let p2Before = null;
    let p1After = null;
    let p2After = null;
    let winnerId = null;

    if (mode === 'pvp' && playerOneId && playerTwoId) {
        const rows = await sql`
            SELECT id, elo FROM users WHERE id IN (${playerOneId}, ${playerTwoId})
        `;
        const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
        const u1 = byId[playerOneId];
        const u2 = byId[playerTwoId];
        if (!u1 || !u2) {
            console.warn('[games] missing users for pvp record');
        } else {
            p1Before = u1.elo;
            p2Before = u2.elo;
            const aWon = winnerKey === 'playerOne';
            const { aAfter, bAfter } = applyEloPair(p1Before, p2Before, aWon);
            p1After = aAfter;
            p2After = bAfter;
            winnerId = aWon ? playerOneId : playerTwoId;

            await sql`UPDATE users SET elo = ${p1After}, updated_at = now() WHERE id = ${playerOneId}`;
            await sql`UPDATE users SET elo = ${p2After}, updated_at = now() WHERE id = ${playerTwoId}`;
        }
    } else if (mode === 'ai' && playerOneId) {
        const rows = await sql`SELECT id, elo FROM users WHERE id = ${playerOneId}`;
        const u1 = rows[0];
        if (u1) {
            p1Before = u1.elo;
            p1After = u1.elo;
            p2Before = AI_DEFAULT_ELO;
            p2After = AI_DEFAULT_ELO;
            winnerId = winnerKey === 'playerOne' ? playerOneId : null;
        }
    }

    const inserted = await sql`
        INSERT INTO games (
            room_code, mode,
            player_one_id, player_two_id, winner_id,
            player_one_elo_before, player_one_elo_after,
            player_two_elo_before, player_two_elo_after,
            board_snapshot
        ) VALUES (
            ${roomCode},
            ${mode},
            ${playerOneId},
            ${playerTwoId},
            ${winnerId},
            ${p1Before},
            ${p1After},
            ${p2Before},
            ${p2After},
            ${board}
        )
        RETURNING id
    `;

    return {
        gameId: inserted[0]?.id,
        playerOneElo: p1After,
        playerTwoElo: p2After,
        playerOneDelta: p1Before != null && p1After != null ? p1After - p1Before : 0,
        playerTwoDelta: p2Before != null && p2After != null ? p2After - p2Before : 0,
    };
}

export async function listGamesForUser(userId, limit = 30) {
    if (!isDbConfigured()) return [];
    const sql = getSql();
    const rows = await sql`
        SELECT
            g.id,
            g.mode,
            g.room_code,
            g.finished_at,
            g.winner_id,
            g.player_one_id,
            g.player_two_id,
            g.player_one_elo_before,
            g.player_one_elo_after,
            g.player_two_elo_before,
            g.player_two_elo_after,
            g.board_snapshot,
            p1.display_name AS p1_name,
            p2.display_name AS p2_name
        FROM games g
        LEFT JOIN users p1 ON p1.id = g.player_one_id
        LEFT JOIN users p2 ON p2.id = g.player_two_id
        WHERE g.player_one_id = ${userId} OR g.player_two_id = ${userId}
        ORDER BY g.finished_at DESC
        LIMIT ${limit}
    `;

    return rows.map((g) => {
        const isP1 = g.player_one_id === userId;
        const vsAi = g.mode === 'ai';
        const snapWinner = g.board_snapshot?.winner;

        let won;
        if (g.winner_id) {
            won = g.winner_id === userId;
        } else if (vsAi && snapWinner) {
            // AI wins store winner_id=null; snapshot has playerOne | playerTwo
            won = snapWinner === 'playerOne' && isP1;
        } else if (vsAi) {
            // No winner_id on vs-AI means the AI (player two) won
            won = false;
        } else {
            won = null;
        }

        const result = won === true ? 'win' : won === false ? 'loss' : 'unknown';
        const opponentName = vsAi
            ? 'ATP AI'
            : isP1
              ? g.p2_name || 'Opponent'
              : g.p1_name || 'Opponent';
        const eloBefore = isP1 ? g.player_one_elo_before : g.player_two_elo_before;
        const eloAfter = isP1 ? g.player_one_elo_after : g.player_two_elo_after;
        const eloDelta =
            eloBefore != null && eloAfter != null ? eloAfter - eloBefore : 0;
        const opponentElo = vsAi
            ? AI_DEFAULT_ELO
            : isP1
              ? g.player_two_elo_before
              : g.player_one_elo_before;

        return {
            id: g.id,
            mode: g.mode,
            result,
            result_label: won === true ? 'You won' : won === false ? 'You lost' : 'Unknown',
            opponent: opponentName,
            opponent_elo: opponentElo,
            elo_before: eloBefore,
            elo_after: eloAfter,
            elo_delta: eloDelta,
            finished_at: g.finished_at,
        };
    });
}
