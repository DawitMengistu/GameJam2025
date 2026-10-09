import { Router } from 'express';
import { isDbConfigured } from '../db/pool.js';
import { listGamesForUser, AI_DEFAULT_ELO } from '../db/games.js';
import { ELO_START } from '../db/elo.js';
import {
    upsertTelegramUser,
    createMagicLink,
    consumeMagicLink,
    deleteSessionRaw,
    SESSION_COOKIE,
} from './service.js';
import { attachUser, requireUser } from './middleware.js';

const router = Router();

function dbRequired(_req, res, next) {
    if (!isDbConfigured()) {
        return res.status(503).json({ error: 'Database not configured' });
    }
    next();
}

function verifyBotSecret(req, res, next) {
    const expected = process.env.BOT_API_SECRET;
    if (!expected) {
        return res.status(503).json({ error: 'BOT_API_SECRET not configured' });
    }
    const provided = req.headers['x-bot-secret'] || req.body?.botSecret;
    if (provided !== expected) {
        return res.status(401).json({ error: 'Invalid bot secret' });
    }
    next();
}

router.use(attachUser);

router.post('/auth/telegram', dbRequired, verifyBotSecret, async (req, res) => {
    try {
        const body = req.body ?? {};
        const telegramId = body.telegram_id ?? body.telegramId ?? body.user?.id;
        if (!telegramId) {
            return res.status(400).json({ error: 'telegram_id required' });
        }

        const user = await upsertTelegramUser({
            telegram_id: telegramId,
            phone_number: body.phone_number ?? body.phoneNumber ?? body.contact?.phone_number,
            first_name: body.first_name ?? body.firstName ?? body.user?.first_name,
            last_name: body.last_name ?? body.lastName ?? body.user?.last_name,
            username: body.username ?? body.user?.username,
        });

        const link = await createMagicLink(user.id);
        return res.json({
            ok: true,
            user_id: user.id,
            url: link.url,
            expires_in_seconds: link.expires_in_seconds,
        });
    } catch (err) {
        console.error('[auth] telegram:', err);
        return res.status(500).json({ error: 'Auth failed' });
    }
});

router.post('/auth/consume', dbRequired, async (req, res) => {
    try {
        const token = String(req.body?.token ?? req.query?.token ?? '').trim();
        if (!token) {
            return res.status(400).json({ error: 'token required' });
        }

        const result = await consumeMagicLink(token);
        if (!result.ok) {
            return res.status(400).json({ error: result.reason });
        }

        const secure = process.env.NODE_ENV === 'production';
        res.cookie(SESSION_COOKIE, result.session.raw, {
            httpOnly: true,
            sameSite: 'lax',
            secure,
            maxAge: result.session.maxAgeMs,
            path: '/',
        });

        return res.json({
            ok: true,
            user: {
                id: result.user.id,
                display_name: result.user.display_name,
                username: result.user.username,
                elo: result.user.elo,
            },
        });
    } catch (err) {
        console.error('[auth] consume:', err);
        return res.status(500).json({ error: 'Could not sign in' });
    }
});

router.get('/me', dbRequired, requireUser, (req, res) => {
    res.json({
        id: req.user.id,
        display_name: req.user.display_name,
        username: req.user.username,
        elo: req.user.elo,
        ai_elo: AI_DEFAULT_ELO,
        elo_start: ELO_START,
    });
});

router.get('/config', (_req, res) => {
    const bot = process.env.TELEGRAM_BOT_USERNAME || '';
    res.json({
        auth_required: isDbConfigured(),
        telegram_bot_username: bot.replace(/^@/, ''),
        telegram_login_url: bot
            ? `https://t.me/${bot.replace(/^@/, '')}?start=auth`
            : null,
        ai_elo: AI_DEFAULT_ELO,
        elo_start: ELO_START,
    });
});

router.get('/history', dbRequired, requireUser, async (req, res) => {
    try {
        const games = await listGamesForUser(req.user.id, 40);
        return res.json({ games });
    } catch (err) {
        console.error('[api] history:', err);
        return res.status(500).json({ error: 'Could not load history' });
    }
});

router.post('/auth/logout', dbRequired, async (req, res) => {
    try {
        const raw = req.cookies?.[SESSION_COOKIE];
        await deleteSessionRaw(raw);
        res.clearCookie(SESSION_COOKIE, { path: '/' });
        return res.json({ ok: true });
    } catch (err) {
        console.error('[auth] logout:', err);
        return res.status(500).json({ error: 'Logout failed' });
    }
});

export default router;
