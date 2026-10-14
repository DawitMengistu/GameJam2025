import { getSql, isDbConfigured } from './pool.js';

function requireSql() {
    if (!isDbConfigured()) {
        throw new Error('DATABASE_URL is not set');
    }
    return getSql();
}

/** @param {object} cupRow @param {object[]} playerRows */
export function hydrateCup(cupRow, playerRows) {
    const players = (playerRows || []).map((p) => ({
        id: null,
        sessionId: p.session_id || null,
        userId: p.user_id,
        displayName: p.display_name,
        elo: p.elo_snapshot ?? 100,
        online: false,
    }));

    const admin = players.find((p) => p.userId === cupRow.admin_user_id);
    const champion = cupRow.champion_user_id
        ? players.find((p) => p.userId === cupRow.champion_user_id)
        : null;

    return {
        code: cupRow.code,
        dbId: cupRow.id,
        adminId: admin?.sessionId || null,
        status: cupRow.status,
        players,
        bracket: cupRow.bracket || null,
        championId: champion?.sessionId || null,
    };
}

export async function createCupRow({
    code,
    adminUserId,
    maxPlayers = 64,
}) {
    const sql = requireSql();
    const rows = await sql`
        INSERT INTO cups (code, status, admin_user_id, max_players)
        VALUES (${code}, 'lobby', ${adminUserId}, ${maxPlayers})
        RETURNING *
    `;
    return rows[0];
}

export async function addCupPlayerRow({
    cupId,
    userId,
    sessionId,
    displayName,
    eloSnapshot,
    slot = null,
}) {
    const sql = requireSql();
    const rows = await sql`
        INSERT INTO cup_players (
            cup_id, user_id, session_id, display_name, elo_snapshot, slot
        )
        VALUES (
            ${cupId}, ${userId}, ${sessionId}, ${displayName}, ${eloSnapshot}, ${slot}
        )
        ON CONFLICT (cup_id, user_id) DO UPDATE SET
            session_id = EXCLUDED.session_id,
            display_name = EXCLUDED.display_name,
            elo_snapshot = EXCLUDED.elo_snapshot
        RETURNING *
    `;
    return rows[0];
}

export async function removeCupPlayerRow(cupId, userId) {
    const sql = requireSql();
    await sql`
        DELETE FROM cup_players
        WHERE cup_id = ${cupId} AND user_id = ${userId}
    `;
}

export async function deleteCupRow(cupId) {
    const sql = requireSql();
    await sql`DELETE FROM cups WHERE id = ${cupId}`;
}

export async function getCupByCode(code) {
    const sql = requireSql();
    const rows = await sql`
        SELECT * FROM cups WHERE code = ${code} LIMIT 1
    `;
    return rows[0] || null;
}

export async function listCupPlayers(cupId) {
    const sql = requireSql();
    return sql`
        SELECT * FROM cup_players
        WHERE cup_id = ${cupId}
        ORDER BY joined_at ASC
    `;
}

export async function loadCupBundleByCode(code) {
    const cup = await getCupByCode(code);
    if (!cup) return null;
    const players = await listCupPlayers(cup.id);
    return { cup, players };
}

/** Active (lobby|running) cup membership for restore / busy checks. */
export async function findOpenCupForIdentity({ userId = null, sessionId = null }) {
    if (!userId && !sessionId) return null;
    const sql = requireSql();
    const rows = userId
        ? await sql`
            SELECT c.*
            FROM cups c
            JOIN cup_players cp ON cp.cup_id = c.id
            WHERE cp.user_id = ${userId}
              AND c.status IN ('lobby', 'running')
            ORDER BY c.updated_at DESC
            LIMIT 1
          `
        : await sql`
            SELECT c.*
            FROM cups c
            JOIN cup_players cp ON cp.cup_id = c.id
            WHERE cp.session_id = ${sessionId}
              AND c.status IN ('lobby', 'running')
            ORDER BY c.updated_at DESC
            LIMIT 1
          `;
    const cup = rows[0];
    if (!cup) return null;
    const players = await listCupPlayers(cup.id);
    return { cup, players };
}

export async function updateCupAdmin(cupId, adminUserId) {
    const sql = requireSql();
    await sql`
        UPDATE cups
        SET admin_user_id = ${adminUserId}, updated_at = now()
        WHERE id = ${cupId}
    `;
}

export async function updateCupStatus(cupId, status, { championUserId = null } = {}) {
    const sql = requireSql();
    if (status === 'finished') {
        await sql`
            UPDATE cups
            SET status = ${status},
                champion_user_id = ${championUserId},
                finished_at = now(),
                updated_at = now()
            WHERE id = ${cupId}
        `;
        return;
    }
    await sql`
        UPDATE cups
        SET status = ${status}, updated_at = now()
        WHERE id = ${cupId}
    `;
}

export async function saveCupBracket(cupId, bracket) {
    const sql = requireSql();
    await sql`
        UPDATE cups
        SET bracket = ${bracket},
            updated_at = now()
        WHERE id = ${cupId}
    `;
}

/**
 * Upsert normalized match rows from an in-memory bracket.
 * @param {string} cupId
 * @param {object} bracket
 * @param {Record<string, string|null>} sessionToUserId
 */
export async function syncCupMatchesFromBracket(cupId, bracket, sessionToUserId) {
    if (!bracket?.matches) return;
    const sql = requireSql();

    for (const match of Object.values(bracket.matches)) {
        const playerA =
            match.playerIds?.[0] != null
                ? sessionToUserId[match.playerIds[0]] || null
                : null;
        const playerB =
            match.playerIds?.[1] != null
                ? sessionToUserId[match.playerIds[1]] || null
                : null;
        const winner =
            match.winnerId != null
                ? sessionToUserId[match.winnerId] || null
                : null;
        const board = match.lastHistories || null;
        const finishedAt = match.status === 'done' ? new Date().toISOString() : null;

        await sql`
            INSERT INTO cup_matches (
                cup_id, match_key, round, status,
                player_a_id, player_b_id, winner_id,
                room_code, board_snapshot, finished_at
            )
            VALUES (
                ${cupId},
                ${match.id},
                ${match.round || match.id},
                ${match.status || 'pending'},
                ${playerA},
                ${playerB},
                ${winner},
                ${match.roomCode || null},
                ${board},
                ${finishedAt}
            )
            ON CONFLICT (cup_id, match_key) DO UPDATE SET
                round = EXCLUDED.round,
                status = EXCLUDED.status,
                player_a_id = EXCLUDED.player_a_id,
                player_b_id = EXCLUDED.player_b_id,
                winner_id = EXCLUDED.winner_id,
                room_code = EXCLUDED.room_code,
                board_snapshot = COALESCE(EXCLUDED.board_snapshot, cup_matches.board_snapshot),
                finished_at = COALESCE(EXCLUDED.finished_at, cup_matches.finished_at)
        `;
    }
}

export function sessionToUserMap(players) {
    /** @type {Record<string, string|null>} */
    const map = {};
    for (const p of players || []) {
        if (p?.sessionId) map[p.sessionId] = p.userId || null;
    }
    return map;
}

export async function persistCupTree(cup) {
    if (!cup?.dbId || !cup.bracket) return;
    await saveCupBracket(cup.dbId, cup.bracket);
    await syncCupMatchesFromBracket(
        cup.dbId,
        cup.bracket,
        sessionToUserMap(cup.players)
    );
}
