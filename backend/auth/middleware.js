import { getUserBySessionRaw, SESSION_COOKIE } from './service.js';
import { isDbConfigured } from '../db/pool.js';

export async function attachUser(req, res, next) {
    req.user = null;
    if (!isDbConfigured()) return next();

    try {
        const raw = req.cookies?.[SESSION_COOKIE];
        if (raw) {
            req.user = await getUserBySessionRaw(raw);
        }
    } catch (err) {
        console.warn('[auth] attachUser failed:', err.message);
    }
    next();
}

export function requireUser(req, res, next) {
    if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated' });
    }
    next();
}
