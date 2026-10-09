import { getSql } from '../db/pool.js';
import { ELO_START } from '../db/elo.js';
import { randomToken, sha256 } from './crypto.js';

const SESSION_DAYS = 30;
const MAGIC_LINK_MINUTES = 15;
export const SESSION_COOKIE = 'atp_session';

function sessionMaxAgeMs() {
    return SESSION_DAYS * 24 * 60 * 60 * 1000;
}

function displayNameFromTelegram({ first_name, last_name, username, telegram_id }) {
    const parts = [first_name, last_name].filter(Boolean);
    if (parts.length) return parts.join(' ').trim();
    if (username) return `@${username}`;
    return `Player ${telegram_id}`;
}

export async function upsertTelegramUser(contact) {
    const sql = getSql();
    const telegramId = Number(contact.telegram_id);
    if (!Number.isFinite(telegramId)) {
        throw new Error('Invalid telegram_id');
    }

    const displayName = displayNameFromTelegram(contact);
    const rows = await sql`
        INSERT INTO users (telegram_id, phone, username, display_name, elo)
        VALUES (
            ${telegramId},
            ${contact.phone_number ?? null},
            ${contact.username ?? null},
            ${displayName},
            ${ELO_START}
        )
        ON CONFLICT (telegram_id) DO UPDATE SET
            phone = COALESCE(EXCLUDED.phone, users.phone),
            username = COALESCE(EXCLUDED.username, users.username),
            display_name = EXCLUDED.display_name,
            updated_at = now()
        RETURNING id, telegram_id, phone, username, display_name, elo, created_at
    `;
    return rows[0];
}

export async function createMagicLink(userId) {
    const sql = getSql();
    const raw = randomToken(32);
    const tokenHash = sha256(raw);
    const expiresAt = new Date(Date.now() + MAGIC_LINK_MINUTES * 60 * 1000);

    await sql`
        INSERT INTO auth_tokens (token_hash, user_id, expires_at)
        VALUES (${tokenHash}, ${userId}, ${expiresAt.toISOString()})
    `;

    const base = (process.env.APP_PUBLIC_URL || 'http://localhost:3000').replace(/\/$/, '');
    return {
        url: `${base}/auth?token=${raw}`,
        expires_in_seconds: MAGIC_LINK_MINUTES * 60,
    };
}

export async function consumeMagicLink(rawToken) {
    const sql = getSql();
    const tokenHash = sha256(rawToken);
    const now = new Date();

    const tokens = await sql`
        SELECT id, user_id, expires_at, used_at
        FROM auth_tokens
        WHERE token_hash = ${tokenHash}
        LIMIT 1
    `;
    const row = tokens[0];
    if (!row) return { ok: false, reason: 'Invalid or expired link' };
    if (row.used_at) return { ok: false, reason: 'Link already used' };
    if (new Date(row.expires_at) < now) {
        return { ok: false, reason: 'Link expired' };
    }

    await sql`
        UPDATE auth_tokens SET used_at = ${now.toISOString()} WHERE id = ${row.id}
    `;

    const session = await createSession(row.user_id);
    const users = await sql`
        SELECT id, telegram_id, phone, username, display_name, elo
        FROM users WHERE id = ${row.user_id}
    `;

    return { ok: true, session, user: users[0] };
}

export async function createSession(userId) {
    const sql = getSql();
    const raw = randomToken(32);
    const sessionHash = sha256(raw);
    const expiresAt = new Date(Date.now() + sessionMaxAgeMs());

    await sql`
        INSERT INTO sessions (session_hash, user_id, expires_at)
        VALUES (${sessionHash}, ${userId}, ${expiresAt.toISOString()})
    `;

    return {
        raw,
        expiresAt,
        maxAgeMs: sessionMaxAgeMs(),
    };
}

export async function getUserBySessionRaw(rawSession) {
    if (!rawSession) return null;
    const sql = getSql();
    const sessionHash = sha256(rawSession);
    const now = new Date();

    const rows = await sql`
        SELECT u.id, u.telegram_id, u.phone, u.username, u.display_name, u.elo, s.expires_at
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.session_hash = ${sessionHash}
          AND s.expires_at > ${now.toISOString()}
        LIMIT 1
    `;
    return rows[0] ?? null;
}

export async function deleteSessionRaw(rawSession) {
    if (!rawSession) return;
    const sql = getSql();
    const sessionHash = sha256(rawSession);
    await sql`DELETE FROM sessions WHERE session_hash = ${sessionHash}`;
}
