/**
 * Accurate online presence for the global badge and friends list.
 * Global count = live Socket.IO connections (no hand-rolled counter).
 * Logged-in online = user has at least one connected socket id.
 */

/** @type {Map<string, Set<string>>} userId -> socketIds */
const onlineByUser = new Map();

/** @type {Map<string, string>} socketId -> userId */
const userBySocket = new Map();

/** @type {Map<string, string>} sessionId -> socketId (latest) */
const socketBySession = new Map();

/** @type {Map<string, string>} socketId -> sessionId */
const sessionBySocket = new Map();

/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const presenceFlushTimers = new Map();

/** @type {((userId: string, online: boolean) => void) | null} */
let onPresenceChange = null;

export function setPresenceChangeHandler(fn) {
    onPresenceChange = fn;
}

export function liveSocketCount(io) {
    return io?.engine?.clientsCount ?? io?.sockets?.sockets?.size ?? 0;
}

export function broadcastUserCount(io) {
    if (!io) return;
    io.emit('usercount', liveSocketCount(io));
}

function normUserId(userId) {
    return userId == null || userId === '' ? null : String(userId);
}

export function isUserOnline(userId) {
    const id = normUserId(userId);
    if (!id) return false;
    const set = onlineByUser.get(id);
    return Boolean(set && set.size > 0);
}

export function getOnlineUserIds(userIds) {
    /** @type {Record<string, boolean>} */
    const out = {};
    for (const id of userIds || []) {
        const key = normUserId(id);
        if (key) out[key] = isUserOnline(key);
    }
    return out;
}

/** Latest socket for a logged-in user (any of their tabs). */
export function getSocketIdForUser(userId) {
    const id = normUserId(userId);
    if (!id) return null;
    const set = onlineByUser.get(id);
    if (!set || set.size === 0) return null;
    return [...set][set.size - 1];
}

/** All connected socket ids for a logged-in user (multi-tab). */
export function getSocketIdsForUser(userId) {
    const id = normUserId(userId);
    if (!id) return [];
    const set = onlineByUser.get(id);
    if (!set || set.size === 0) return [];
    return [...set];
}

export function getSocketIdForSession(sessionId) {
    return sessionId ? socketBySession.get(sessionId) || null : null;
}

function schedulePresenceNotify(userId) {
    const id = normUserId(userId);
    if (!onPresenceChange || !id) return;
    const prev = presenceFlushTimers.get(id);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
        presenceFlushTimers.delete(id);
        onPresenceChange(id, isUserOnline(id));
    }, 300);
    presenceFlushTimers.set(id, t);
}

export function bindSessionSocket(sessionId, socketId) {
    if (!sessionId || !socketId) return;
    const prev = socketBySession.get(sessionId);
    if (prev && prev !== socketId) {
        // keep map pointing at newest socket for this browser session
    }
    socketBySession.set(sessionId, socketId);
    sessionBySocket.set(socketId, sessionId);
}

export function markUserOnline(userId, socketId) {
    const id = normUserId(userId);
    if (!id || !socketId) return;
    const wasOnline = isUserOnline(id);
    let set = onlineByUser.get(id);
    if (!set) {
        set = new Set();
        onlineByUser.set(id, set);
    }
    set.add(socketId);
    userBySocket.set(socketId, id);
    if (!wasOnline) schedulePresenceNotify(id);
}

export function clearSocketPresence(socketId) {
    if (!socketId) return;

    const sessionId = sessionBySocket.get(socketId);
    if (sessionId && socketBySession.get(sessionId) === socketId) {
        socketBySession.delete(sessionId);
    }
    sessionBySocket.delete(socketId);

    const userId = userBySocket.get(socketId);
    userBySocket.delete(socketId);
    if (!userId) return;

    const set = onlineByUser.get(userId);
    if (!set) return;
    set.delete(socketId);
    if (set.size === 0) {
        onlineByUser.delete(userId);
        schedulePresenceNotify(userId);
    }
}
