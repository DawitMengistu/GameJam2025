import { parse as parseCookie } from 'cookie';
import { getUserBySessionRaw, SESSION_COOKIE } from './service.js';
import { isDbConfigured } from '../db/pool.js';

/** Resolve logged-in user from Socket.IO handshake cookies. */
export async function userFromSocket(socket) {
    if (!isDbConfigured()) return null;
    try {
        const rawHeader = socket.request?.headers?.cookie || '';
        const cookies = parseCookie(rawHeader);
        const raw = cookies[SESSION_COOKIE];
        if (!raw) return null;
        return await getUserBySessionRaw(raw);
    } catch (err) {
        console.warn('[auth] socket user:', err.message);
        return null;
    }
}
