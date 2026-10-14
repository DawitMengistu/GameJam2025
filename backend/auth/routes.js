import { Router } from 'express';
import { isDbConfigured } from '../db/pool.js';
import {
    listGamesForUser,
    listCupMatchHistoryForUser,
    getGameDetailForUser,
    getCupMatchDetailForUser,
    AI_DEFAULT_ELO,
} from '../db/games.js';
import { ELO_START } from '../db/elo.js';
import {
    createFriendRequest,
    deleteFriendship,
    listFriendshipsForUser,
    respondFriendRequest,
    searchUsers,
} from '../db/friends.js';
import { isUserOnline } from '../presence.js';
import {
    notifyFriendRequestReceived,
    notifyFriendRequestResolved,
} from '../friendNotify.js';
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
        const [games, cupMatches] = await Promise.all([
            listGamesForUser(req.user.id, 40),
            listCupMatchHistoryForUser(req.user.id, 20),
        ]);
        const merged = [...games, ...cupMatches].sort((a, b) => {
            const ta = a.finished_at ? new Date(a.finished_at).getTime() : 0;
            const tb = b.finished_at ? new Date(b.finished_at).getTime() : 0;
            return tb - ta;
        });
        return res.json({ games: merged.slice(0, 50) });
    } catch (err) {
        console.error('[api] history:', err);
        return res.status(500).json({ error: 'Could not load history' });
    }
});

router.get('/history/:id', dbRequired, requireUser, async (req, res) => {
    try {
        const rawId = String(req.params.id || '').trim();
        if (!rawId) return res.status(400).json({ error: 'id required' });

        if (rawId.startsWith('cup:')) {
            const cupMatchId = rawId.slice(4);
            const detail = await getCupMatchDetailForUser(
                req.user.id,
                cupMatchId
            );
            if (!detail) return res.status(404).json({ error: 'Not found' });
            return res.json({ game: detail });
        }

        const detail = await getGameDetailForUser(req.user.id, rawId);
        if (!detail) return res.status(404).json({ error: 'Not found' });
        return res.json({ game: detail });
    } catch (err) {
        console.error('[api] history detail:', err);
        return res.status(500).json({ error: 'Could not load game' });
    }
});

router.get('/friends', dbRequired, requireUser, async (req, res) => {
    try {
        const lists = await listFriendshipsForUser(req.user.id);
        const withOnline = (items) =>
            items.map((item) => ({
                ...item,
                online: isUserOnline(item.friend?.id),
            }));
        return res.json({
            accepted: withOnline(lists.accepted),
            pendingIn: withOnline(lists.pendingIn),
            pendingOut: withOnline(lists.pendingOut),
        });
    } catch (err) {
        console.error('[api] friends:', err);
        return res.status(500).json({ error: 'Could not load friends' });
    }
});

router.get('/friends/search', dbRequired, requireUser, async (req, res) => {
    try {
        const q = String(req.query?.q ?? '');
        const users = await searchUsers(req.user.id, q);
        return res.json({
            users: users.map((u) => ({
                ...u,
                online: isUserOnline(u.id),
            })),
        });
    } catch (err) {
        console.error('[api] friends search:', err);
        return res.status(500).json({ error: 'Search failed' });
    }
});

router.post('/friends/request', dbRequired, requireUser, async (req, res) => {
    try {
        const userId = String(req.body?.userId ?? '').trim();
        if (!userId) return res.status(400).json({ error: 'userId required' });
        const result = await createFriendRequest(req.user.id, userId);
        if (!result.ok) return res.status(400).json({ error: result.reason });

        notifyFriendRequestReceived(userId, {
            friendshipId: result.friendship.id,
            from: {
                id: req.user.id,
                display_name: req.user.display_name,
                username: req.user.username || null,
            },
        });

        return res.json({ ok: true, friendship: result.friendship });
    } catch (err) {
        console.error('[api] friends request:', err);
        return res.status(500).json({ error: 'Could not send request' });
    }
});

router.post('/friends/respond', dbRequired, requireUser, async (req, res) => {
    try {
        const friendshipId = String(req.body?.friendshipId ?? '').trim();
        const accept = Boolean(req.body?.accept);
        if (!friendshipId) {
            return res.status(400).json({ error: 'friendshipId required' });
        }
        const result = await respondFriendRequest(
            req.user.id,
            friendshipId,
            accept
        );
        if (!result.ok) return res.status(400).json({ error: result.reason });

        const f = result.friendship;
        const otherId =
            f.requester_id === req.user.id ? f.addressee_id : f.requester_id;
        const status = accept ? 'accepted' : 'declined';
        const meFriend = {
            id: req.user.id,
            display_name: req.user.display_name,
            username: req.user.username || null,
            elo: req.user.elo,
        };
        notifyFriendRequestResolved(
            accept ? [otherId, req.user.id] : [otherId],
            {
                friendshipId: f.id,
                status,
                friendId: accept ? req.user.id : otherId,
                friend: accept ? meFriend : null,
            }
        );

        return res.json({ ok: true, friendship: result.friendship });
    } catch (err) {
        console.error('[api] friends respond:', err);
        return res.status(500).json({ error: 'Could not respond' });
    }
});

router.delete('/friends/:id', dbRequired, requireUser, async (req, res) => {
    try {
        const id = String(req.params.id || '').trim();
        const result = await deleteFriendship(req.user.id, id);
        if (!result.ok) return res.status(404).json({ error: result.reason });

        const f = result.friendship;
        const otherId =
            f.requester_id === req.user.id ? f.addressee_id : f.requester_id;
        notifyFriendRequestResolved(otherId, {
            friendshipId: f.id,
            status: 'removed',
            friendId: req.user.id,
            friend: null,
        });

        return res.json({ ok: true });
    } catch (err) {
        console.error('[api] friends delete:', err);
        return res.status(500).json({ error: 'Could not remove' });
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
