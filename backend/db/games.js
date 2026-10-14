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
 *   playerOneSecret?: string | null,
 *   playerTwoSecret?: string | null,
 *   playerOneName?: string | null,
 *   playerTwoName?: string | null,
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
        playerOneSecret = null,
        playerTwoSecret = null,
        playerOneName = null,
        playerTwoName = null,
    } = opts;

    const board = {
        playerOneHistory,
        playerTwoHistory,
        winner: winnerKey,
        playerOneSecret,
        playerTwoSecret,
        playerOneName,
        playerTwoName,
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
            kind: vsAi ? 'ai' : 'pvp',
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

export async function getGameDetailForUser(userId, gameId) {
    if (!isDbConfigured()) return null;
    const sql = getSql();
    const rows = await sql`
        SELECT
            g.id,
            g.mode,
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
        WHERE g.id = ${gameId}
          AND (g.player_one_id = ${userId} OR g.player_two_id = ${userId})
        LIMIT 1
    `;
    const g = rows[0];
    if (!g) return null;

    const isP1 = g.player_one_id === userId;
    const snap = g.board_snapshot || {};
    const vsAi = g.mode === 'ai';
    let won;
    if (g.winner_id) won = g.winner_id === userId;
    else if (vsAi && snap.winner) won = snap.winner === 'playerOne' && isP1;
    else if (vsAi) won = false;
    else won = null;

    const p1Name = snap.playerOneName || g.p1_name || 'Player One';
    const p2Name = snap.playerTwoName || (vsAi ? 'ATP AI' : g.p2_name) || 'Player Two';

    return {
        id: g.id,
        kind: vsAi ? 'ai' : 'pvp',
        mode: g.mode,
        result: won === true ? 'win' : won === false ? 'loss' : 'unknown',
        result_label: won === true ? 'You won' : won === false ? 'You lost' : 'Unknown',
        finished_at: g.finished_at,
        youWere: isP1 ? 'playerOne' : 'playerTwo',
        playerOneName: isP1 ? 'You' : p1Name,
        playerTwoName: isP1 ? p2Name : 'You',
        playerOneHistory: snap.playerOneHistory || [],
        playerTwoHistory: snap.playerTwoHistory || [],
        playerOneSecret: snap.playerOneSecret || null,
        playerTwoSecret: snap.playerTwoSecret || null,
        opponent: vsAi ? 'ATP AI' : isP1 ? p2Name : p1Name,
    };
}

export async function listCupMatchHistoryForUser(userId, limit = 20) {
    if (!isDbConfigured()) return [];
    const sql = getSql();
    const rows = await sql`
        SELECT
            cm.id,
            cm.match_key,
            cm.round,
            cm.finished_at,
            cm.winner_id,
            cm.board_snapshot,
            cm.player_a_id,
            cm.player_b_id,
            c.code AS cup_code,
            pa.display_name AS a_name,
            pb.display_name AS b_name
        FROM cup_matches cm
        JOIN cups c ON c.id = cm.cup_id
        LEFT JOIN users pa ON pa.id = cm.player_a_id
        LEFT JOIN users pb ON pb.id = cm.player_b_id
        WHERE cm.status = 'done'
          AND cm.board_snapshot IS NOT NULL
          AND (cm.player_a_id = ${userId} OR cm.player_b_id = ${userId})
        ORDER BY cm.finished_at DESC NULLS LAST
        LIMIT ${limit}
    `;

    return rows.map((m) => {
        const isA = m.player_a_id === userId;
        const won = m.winner_id ? m.winner_id === userId : null;
        const opponent = isA ? m.b_name || 'Opponent' : m.a_name || 'Opponent';
        return {
            id: `cup:${m.id}`,
            cup_match_id: m.id,
            kind: 'cup',
            mode: 'cup',
            result: won === true ? 'win' : won === false ? 'loss' : 'unknown',
            result_label:
                won === true ? 'You won' : won === false ? 'You lost' : 'Cup match',
            opponent,
            opponent_elo: null,
            elo_delta: 0,
            finished_at: m.finished_at,
            cup_code: m.cup_code,
            match_key: m.match_key,
        };
    });
}

export async function getCupMatchDetailForUser(userId, cupMatchId) {
    if (!isDbConfigured()) return null;
    const sql = getSql();
    const rows = await sql`
        SELECT
            cm.id,
            cm.match_key,
            cm.round,
            cm.finished_at,
            cm.winner_id,
            cm.board_snapshot,
            cm.player_a_id,
            cm.player_b_id,
            c.code AS cup_code,
            pa.display_name AS a_name,
            pb.display_name AS b_name
        FROM cup_matches cm
        JOIN cups c ON c.id = cm.cup_id
        LEFT JOIN users pa ON pa.id = cm.player_a_id
        LEFT JOIN users pb ON pb.id = cm.player_b_id
        WHERE cm.id = ${cupMatchId}
          AND (cm.player_a_id = ${userId} OR cm.player_b_id = ${userId})
        LIMIT 1
    `;
    const m = rows[0];
    if (!m) return null;
    const snap = m.board_snapshot || {};
    const isA = m.player_a_id === userId;
    const won = m.winner_id ? m.winner_id === userId : null;
    const aName = snap.playerOneName || m.a_name || 'Player One';
    const bName = snap.playerTwoName || m.b_name || 'Player Two';

    return {
        id: `cup:${m.id}`,
        kind: 'cup',
        mode: 'cup',
        result: won === true ? 'win' : won === false ? 'loss' : 'unknown',
        result_label: won === true ? 'You won' : won === false ? 'You lost' : 'Cup match',
        finished_at: m.finished_at,
        cup_code: m.cup_code,
        match_key: m.match_key,
        youWere: isA ? 'playerOne' : 'playerTwo',
        playerOneName: isA ? 'You' : aName,
        playerTwoName: isA ? bName : 'You',
        playerOneHistory: snap.playerOneHistory || [],
        playerTwoHistory: snap.playerTwoHistory || [],
        playerOneSecret: snap.playerOneSecret || null,
        playerTwoSecret: snap.playerTwoSecret || null,
        opponent: isA ? bName : aName,
    };
}
