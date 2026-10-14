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

export function isUserOnline(userId) {
    if (!userId) return false;
    const set = onlineByUser.get(userId);
    return Boolean(set && set.size > 0);
}

export function getOnlineUserIds(userIds) {
    /** @type {Record<string, boolean>} */
    const out = {};
    for (const id of userIds || []) {
        out[id] = isUserOnline(id);
    }
    return out;
}

/** Latest socket for a logged-in user (any of their tabs). */
export function getSocketIdForUser(userId) {
    const set = onlineByUser.get(userId);
    if (!set || set.size === 0) return null;
    return [...set][set.size - 1];
}

/** All connected socket ids for a logged-in user (multi-tab). */
export function getSocketIdsForUser(userId) {
    const set = onlineByUser.get(userId);
    if (!set || set.size === 0) return [];
    return [...set];
}

export function getSocketIdForSession(sessionId) {
    return sessionId ? socketBySession.get(sessionId) || null : null;
}

function schedulePresenceNotify(userId, online) {
    if (!onPresenceChange || !userId) return;
    const prev = presenceFlushTimers.get(userId);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
        presenceFlushTimers.delete(userId);
        onPresenceChange(userId, isUserOnline(userId));
    }, 300);
    presenceFlushTimers.set(userId, t);
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
    if (!userId || !socketId) return;
    const wasOnline = isUserOnline(userId);
    let set = onlineByUser.get(userId);
    if (!set) {
        set = new Set();
        onlineByUser.set(userId, set);
    }
    set.add(socketId);
    userBySocket.set(socketId, userId);
    if (!wasOnline) schedulePresenceNotify(userId, true);
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
        schedulePresenceNotify(userId, false);
    }
}
