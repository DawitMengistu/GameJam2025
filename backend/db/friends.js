import { getSql, isDbConfigured } from './pool.js';

function requireSql() {
    if (!isDbConfigured()) throw new Error('DATABASE_URL is not set');
    return getSql();
}

export async function listFriendshipsForUser(userId) {
    const sql = requireSql();
    const rows = await sql`
        SELECT
            f.id,
            f.status,
            f.requester_id,
            f.addressee_id,
            f.created_at,
            f.updated_at,
            r.display_name AS requester_display_name,
            r.username AS requester_username,
            r.elo AS requester_elo,
            a.display_name AS addressee_display_name,
            a.username AS addressee_username,
            a.elo AS addressee_elo
        FROM friendships f
        JOIN users r ON r.id = f.requester_id
        JOIN users a ON a.id = f.addressee_id
        WHERE (f.requester_id = ${userId} OR f.addressee_id = ${userId})
          AND f.status IN ('pending', 'accepted')
        ORDER BY f.updated_at DESC
    `;

    const accepted = [];
    const pendingIn = [];
    const pendingOut = [];

    for (const row of rows) {
        const isRequester = row.requester_id === userId;
        const friend = isRequester
            ? {
                  id: row.addressee_id,
                  display_name: row.addressee_display_name,
                  username: row.addressee_username,
                  elo: row.addressee_elo,
              }
            : {
                  id: row.requester_id,
                  display_name: row.requester_display_name,
                  username: row.requester_username,
                  elo: row.requester_elo,
              };

        const item = {
            id: row.id,
            status: row.status,
            friend,
            direction: isRequester ? 'out' : 'in',
            created_at: row.created_at,
            updated_at: row.updated_at,
        };

        if (row.status === 'accepted') accepted.push(item);
        else if (isRequester) pendingOut.push(item);
        else pendingIn.push(item);
    }

    return { accepted, pendingIn, pendingOut };
}

export function normalizeFriendCode(raw) {
    return String(raw || '')
        .trim()
        .replace(/\s+/g, '')
        .replace(/[^0-9]/g, '')
        .slice(0, 8);
}

export async function findUserByFriendCode(userId, friendCode) {
    const sql = requireSql();
    const code = normalizeFriendCode(friendCode);
    if (!/^\d{8}$/.test(code)) return null;

    const rows = await sql`
        SELECT u.id, u.display_name, u.username, u.elo, u.friend_code
        FROM users u
        WHERE u.friend_code = ${code}
          AND u.id <> ${userId}
        LIMIT 1
    `;
    return rows[0] ?? null;
}

/** @deprecated name search removed — use findUserByFriendCode */
export async function searchUsers(userId, query) {
    const user = await findUserByFriendCode(userId, query);
    return user ? [user] : [];
}

const RUTH_ONLY_FRIEND_USERNAME = 'ruth_abiti';
const RUTH_ALLOWED_FRIEND_USERNAME = 'dawitmengistu';
const RUTH_ONLY_FRIEND_MESSAGE = 'Dawit is your only friend';

function normalizeUsername(value) {
    return String(value || '')
        .trim()
        .replace(/^@/, '')
        .toLowerCase();
}

export async function createFriendRequest(requesterId, addresseeId) {
    if (!requesterId || !addresseeId || requesterId === addresseeId) {
        return { ok: false, reason: 'Invalid request' };
    }
    const sql = requireSql();

    const users = await sql`
        SELECT id, username
        FROM users
        WHERE id IN (${requesterId}, ${addresseeId})
    `;
    const byId = new Map(users.map((u) => [String(u.id), u]));
    const requester = byId.get(String(requesterId));
    const addressee = byId.get(String(addresseeId));
    if (!requester || !addressee) {
        return { ok: false, reason: 'User not found' };
    }
    if (
        normalizeUsername(requester.username) === RUTH_ONLY_FRIEND_USERNAME &&
        normalizeUsername(addressee.username) !== RUTH_ALLOWED_FRIEND_USERNAME
    ) {
        return { ok: false, reason: RUTH_ONLY_FRIEND_MESSAGE };
    }

    const existing = await sql`
        SELECT id, status, requester_id, addressee_id
        FROM friendships
        WHERE (
            (requester_id = ${requesterId} AND addressee_id = ${addresseeId})
            OR (requester_id = ${addresseeId} AND addressee_id = ${requesterId})
        )
        LIMIT 1
    `;

    if (existing[0]) {
        const row = existing[0];
        if (row.status === 'accepted') {
            return { ok: false, reason: 'Already friends' };
        }
        if (row.status === 'pending') {
            return { ok: false, reason: 'Request already pending' };
        }
        // Re-open declined
        const updated = await sql`
            UPDATE friendships
            SET status = 'pending',
                requester_id = ${requesterId},
                addressee_id = ${addresseeId},
                updated_at = now()
            WHERE id = ${row.id}
            RETURNING *
        `;
        return { ok: true, friendship: updated[0] };
    }

    const inserted = await sql`
        INSERT INTO friendships (requester_id, addressee_id, status)
        VALUES (${requesterId}, ${addresseeId}, 'pending')
        RETURNING *
    `;
    return { ok: true, friendship: inserted[0] };
}

export async function respondFriendRequest(userId, friendshipId, accept) {
    const sql = requireSql();
    const rows = await sql`
        SELECT * FROM friendships WHERE id = ${friendshipId} LIMIT 1
    `;
    const row = rows[0];
    if (!row) return { ok: false, reason: 'Request not found' };
    if (row.addressee_id !== userId) {
        return { ok: false, reason: 'Not your request to answer' };
    }
    if (row.status !== 'pending') {
        return { ok: false, reason: 'Request is not pending' };
    }

    if (accept) {
        const users = await sql`
            SELECT id, username
            FROM users
            WHERE id IN (${row.addressee_id}, ${row.requester_id})
        `;
        const byId = new Map(users.map((u) => [String(u.id), u]));
        const me = byId.get(String(userId));
        const other = byId.get(String(row.requester_id));
        if (
            normalizeUsername(me?.username) === RUTH_ONLY_FRIEND_USERNAME &&
            normalizeUsername(other?.username) !== RUTH_ALLOWED_FRIEND_USERNAME
        ) {
            return { ok: false, reason: RUTH_ONLY_FRIEND_MESSAGE };
        }
    }

    const status = accept ? 'accepted' : 'declined';
    const updated = await sql`
        UPDATE friendships
        SET status = ${status}, updated_at = now()
        WHERE id = ${friendshipId}
        RETURNING *
    `;
    return { ok: true, friendship: updated[0] };
}

export async function deleteFriendship(userId, friendshipId) {
    const sql = requireSql();
    const rows = await sql`
        DELETE FROM friendships
        WHERE id = ${friendshipId}
          AND (requester_id = ${userId} OR addressee_id = ${userId})
        RETURNING *
    `;
    if (!rows[0]) return { ok: false, reason: 'Not found' };
    return { ok: true, friendship: rows[0] };
}

export async function areFriends(userA, userB) {
    if (!userA || !userB) return false;
    const sql = requireSql();
    const rows = await sql`
        SELECT 1 FROM friendships
        WHERE status = 'accepted'
          AND (
            (requester_id = ${userA} AND addressee_id = ${userB})
            OR (requester_id = ${userB} AND addressee_id = ${userA})
          )
        LIMIT 1
    `;
    return Boolean(rows[0]);
}

export async function listAcceptedFriendIds(userId) {
    const sql = requireSql();
    const rows = await sql`
        SELECT
            CASE WHEN requester_id = ${userId} THEN addressee_id ELSE requester_id END AS friend_id
        FROM friendships
        WHERE status = 'accepted'
          AND (requester_id = ${userId} OR addressee_id = ${userId})
    `;
    return rows.map((r) => String(r.friend_id));
}
