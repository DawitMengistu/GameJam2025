/**
 * Bridge so Express auth routes can emit Socket.IO friend events
 * without importing app.js (avoids circular deps).
 */

import { getSocketIdsForUser } from './presence.js';

/** @type {import('socket.io').Server | null} */
let ioRef = null;

export function setFriendNotifyIo(io) {
    ioRef = io;
}

function emitToUser(userId, event, payload) {
    if (!ioRef || !userId) return;
    for (const socketId of getSocketIdsForUser(userId)) {
        ioRef.to(socketId).emit(event, payload);
    }
}

/**
 * @param {string} toUserId
 * @param {{ friendshipId: string, from: { id: string, display_name?: string, username?: string|null } }} payload
 */
export function notifyFriendRequestReceived(toUserId, payload) {
    emitToUser(toUserId, 'friendRequestReceived', payload);
}

/**
 * @param {string|string[]} userIds
 * @param {{ friendshipId: string, status: string, friendId?: string|null, friend?: object|null }} payload
 */
export function notifyFriendRequestResolved(userIds, payload) {
    const ids = Array.isArray(userIds) ? userIds : [userIds];
    for (const id of ids) {
        if (id) emitToUser(id, 'friendRequestResolved', payload);
    }
}
