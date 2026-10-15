import 'dotenv/config';
import express from 'express';
import cookieParser from 'cookie-parser';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import { validateNumber, scoreGuess, randomCode } from './ai/codes.js';
import { createAiBrain, getAiEngine } from './ai/policy.js';
import apiRouter from './auth/routes.js';
import { isDbConfigured } from './db/pool.js';
import { userFromSocket } from './auth/socketUser.js';
import { recordFinishedGame, AI_DEFAULT_ELO } from './db/games.js';
import {
    addCupPlayerRow,
    createCupRow,
    deleteCupRow,
    findOpenCupForIdentity,
    hydrateCup,
    loadCupBundleByCode,
    persistCupTree,
    removeCupPlayerRow,
    updateCupAdmin,
    updateCupStatus,
} from './db/cups.js';
import { areFriends, listAcceptedFriendIds } from './db/friends.js';
import {
    CUP_MAX,
    CUP_MIN_START,
    buildCupBracket as buildBracketTree,
    placeWinner,
    readyMatchIds,
} from './cupBracket.js';
import {
    bindSessionSocket,
    broadcastUserCount,
    clearSocketPresence,
    getSocketIdsForUser,
    isUserOnline,
    markUserOnline,
    setPresenceChangeHandler,
} from './presence.js';
import { setFriendNotifyIo } from './friendNotify.js';

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());
app.use('/api', apiRouter);

app.get('/auth', (req, res) => {
    res.sendFile(join(__dirname, './frontend/auth.html'));
});

app.use(express.static(join(__dirname, './frontend')));

const server = createServer(app);
const io = new Server(server);
setFriendNotifyIo(io);

/** @type {Record<string, any>} */
const rooms = {};
/** @type {Record<string, any>} */
const cups = {};
const OFFLINE_MISS_LIMIT = 2;
/** Server-authoritative turn length (client bar must follow remaining time). */
const TURN_MS = 60_000;
/** @type {Map<string, NodeJS.Timeout>} */
const turnExpiryTimers = new Map();

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRoomCode() {
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    if (rooms[code] || cups[code]) return generateRoomCode();
    return code;
}

function generateCupCode() {
    return generateRoomCode();
}

function isAiId(id) {
    return typeof id === 'string' && id.startsWith('AI:');
}

function emitToPlayer(player, event, payload) {
    if (!player?.id || isAiId(player.id)) return;
    io.to(player.id).emit(event, payload);
}

function findRoomBySocketId(socketId) {
    for (const code of Object.keys(rooms)) {
        const room = rooms[code];
        if (room.playerOne?.id === socketId || room.playerTwo?.id === socketId) {
            return { code, room };
        }
    }
    return null;
}

function findRoomBySessionId(sessionId) {
    if (!sessionId) return null;
    for (const code of Object.keys(rooms)) {
        const room = rooms[code];
        if (
            room.playerOne?.sessionId === sessionId ||
            room.playerTwo?.sessionId === sessionId
        ) {
            return { code, room };
        }
    }
    return null;
}

function seatKeyInRoom(room, sessionId) {
    if (room.playerOne?.sessionId === sessionId) return 'playerOne';
    if (room.playerTwo?.sessionId === sessionId) return 'playerTwo';
    return null;
}

function clearTurnExpiryTimer(code, key) {
    const timerKey = `${code}:${key}`;
    const t = turnExpiryTimers.get(timerKey);
    if (t) {
        clearTimeout(t);
        turnExpiryTimers.delete(timerKey);
    }
}

function clearRoomTurnTimers(code) {
    clearTurnExpiryTimer(code, 'playerOne');
    clearTurnExpiryTimer(code, 'playerTwo');
}

function turnMsRemainingFor(seat) {
    if (!seat?.turnDeadline) return null;
    return Math.max(0, seat.turnDeadline - Date.now());
}

function syncTurnDeadlines(room) {
    if (!room || room.status !== 'playing') return;
    const now = Date.now();
    for (const key of ['playerOne', 'playerTwo']) {
        const seat = room[key];
        if (!seat || isAiId(seat.id)) {
            if (seat) seat.turnDeadline = null;
            continue;
        }
        if (isSeatTurn(room, key)) {
            if (!seat.turnDeadline) seat.turnDeadline = now + TURN_MS;
        } else {
            seat.turnDeadline = null;
        }
    }
}

function isSeatTurn(room, key) {
    const seat = room[key];
    const other = room[otherKey(key)];
    if (!seat || !other) return false;
    return seat.history.length <= other.history.length;
}

function playerKeyFromName(playerName) {
    if (playerName === 'Player One' || playerName === 'playerOne') return 'playerOne';
    if (playerName === 'Player Two' || playerName === 'playerTwo') return 'playerTwo';
    return null;
}

function displayName(key) {
    return key === 'playerOne' ? 'Player One' : 'Player Two';
}

function otherKey(key) {
    return key === 'playerOne' ? 'playerTwo' : 'playerOne';
}

function emitError(socket, reason) {
    socket.emit('roomError', { reason });
}

function cleanupRoom(code) {
    clearRoomTurnTimers(code);
    delete rooms[code];
}

function applySeriesWin(room, winnerKey) {
    if (!room || room.vsAI || room.cupId) return null;
    const series = {
        playerOne: Number(room.series?.playerOne) || 0,
        playerTwo: Number(room.series?.playerTwo) || 0,
    };
    if (winnerKey === 'playerOne') series.playerOne += 1;
    else if (winnerKey === 'playerTwo') series.playerTwo += 1;
    room.series = series;
    return { ...series };
}

function bindRematchPartners(playerA, playerB, series = null) {
    if (!playerA?.id || !playerB?.id || isAiId(playerA.id) || isAiId(playerB.id)) return;
    const sockA = io.sockets.sockets.get(playerA.id);
    const sockB = io.sockets.sockets.get(playerB.id);
    const p1 = Number(series?.playerOne) || 0;
    const p2 = Number(series?.playerTwo) || 0;
    if (sockA) {
        sockA.data.rematchPartner = {
            socketId: playerB.id,
            userId: playerB.userId || null,
            displayName: playerB.displayName || 'Opponent',
            myWins: p1,
            theirWins: p2,
        };
    }
    if (sockB) {
        sockB.data.rematchPartner = {
            socketId: playerA.id,
            userId: playerA.userId || null,
            displayName: playerA.displayName || 'Opponent',
            myWins: p2,
            theirWins: p1,
        };
    }
}

function clearRematchState(socket, { notifyRequester = false } = {}) {
    if (!socket?.data) return;
    const pendingFrom = socket.data.pendingRematchFrom;
    if (notifyRequester && pendingFrom) {
        const requester = io.sockets.sockets.get(pendingFrom);
        if (requester) {
            requester.emit('rematchBusy', { reason: 'Opponent left' });
        }
    }
    socket.data.rematchPartner = null;
    socket.data.pendingRematchFrom = null;
}

function findCupBySocketId(socketId) {
    for (const code of Object.keys(cups)) {
        const cup = cups[code];
        if (cup.players?.some((p) => p.id === socketId)) {
            return { code, cup };
        }
    }
    return null;
}

function findCupBySessionId(sessionId) {
    if (!sessionId) return null;
    for (const code of Object.keys(cups)) {
        const cup = cups[code];
        if (cup.players?.some((p) => p.sessionId === sessionId)) {
            return { code, cup };
        }
    }
    return null;
}

/** Cup membership that blocks starting another room/cup (finished cups do not block). */
function findBlockingCupBySocketId(socketId) {
    const found = findCupBySocketId(socketId);
    if (!found || found.cup.status === 'finished') return null;
    return found;
}

function findBlockingCupBySessionId(sessionId) {
    const found = findCupBySessionId(sessionId);
    if (!found || found.cup.status === 'finished') return null;
    return found;
}

function putCupInMemory(cup) {
    if (!cup?.code) return null;
    cups[cup.code] = cup;
    return cup;
}

async function restoreOpenCupToMemory({ userId = null, sessionId = null }) {
    if (!isDbConfigured()) return null;
    if (sessionId && findCupBySessionId(sessionId)) {
        return findCupBySessionId(sessionId);
    }
    try {
        const bundle = await findOpenCupForIdentity({ userId, sessionId });
        if (!bundle) return null;
        if (cups[bundle.cup.code]) {
            return { code: bundle.cup.code, cup: cups[bundle.cup.code] };
        }
        const hydrated = hydrateCup(bundle.cup, bundle.players);
        putCupInMemory(hydrated);
        return { code: hydrated.code, cup: hydrated };
    } catch (err) {
        console.warn('[cups] restore open cup:', err.message);
        return null;
    }
}

async function ensureCupLoadedByCode(code) {
    if (cups[code]) return cups[code];
    if (!isDbConfigured()) return null;
    try {
        const bundle = await loadCupBundleByCode(code);
        if (!bundle) return null;
        return putCupInMemory(hydrateCup(bundle.cup, bundle.players));
    } catch (err) {
        console.warn('[cups] load by code:', err.message);
        return null;
    }
}

function requireCupAuth(socket) {
    if (!isDbConfigured()) {
        emitError(socket, 'Cups are unavailable right now');
        return false;
    }
    if (!socket.data?.user?.id) {
        emitError(socket, 'Sign in with Telegram to play cups');
        return false;
    }
    return true;
}

async function persistCupSafely(cup, label = 'persist') {
    if (!cup?.dbId || !isDbConfigured()) return;
    try {
        await persistCupTree(cup);
    } catch (err) {
        console.warn(`[cups] ${label}:`, err.message);
    }
}

function normalizeSessionId(raw) {
    return String(raw || '')
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .slice(0, 64);
}

function bindSession(socket, raw) {
    const sessionId = normalizeSessionId(raw);
    if (!sessionId) return null;
    socket.data.sessionId = sessionId;
    return sessionId;
}

function requireSession(socket, rawFromMsg = null) {
    if (rawFromMsg) {
        const fromMsg = bindSession(socket, rawFromMsg);
        if (fromMsg) return fromMsg;
    }
    if (socket.data?.sessionId) return socket.data.sessionId;
    emitError(socket, 'Session not ready — refresh the page');
    return null;
}

function cupPlayerBySession(cup, sessionId) {
    return cup.players.find((p) => p.sessionId === sessionId) || null;
}

function nameFromCupPlayerId(cup, sessionId) {
    return cupPlayerBySession(cup, sessionId)?.displayName || 'TBD';
}

function cupPublicState(cup) {
    const bracket = cup.bracket
        ? {
              matches: Object.fromEntries(
                  Object.entries(cup.bracket.matches).map(([id, m]) => [
                      id,
                      {
                          id: m.id,
                          label: m.label,
                          round: m.round,
                          roundSize: m.roundSize,
                          index: m.index,
                          status: m.status,
                          playerNames: (m.playerIds || []).map((pid) =>
                              pid ? nameFromCupPlayerId(cup, pid) : 'TBD'
                          ),
                          playerIds: m.playerIds || [],
                          winnerId: m.winnerId,
                          winnerName: m.winnerId
                              ? nameFromCupPlayerId(cup, m.winnerId)
                              : null,
                          roomCode: m.roomCode,
                      },
                  ])
              ),
              rounds: cup.bracket.rounds || [],
              size: cup.bracket.size || null,
              championId: cup.championId || null,
              championName: cup.championId
                  ? nameFromCupPlayerId(cup, cup.championId)
                  : null,
          }
        : null;

    return {
        code: cup.code,
        status: cup.status,
        adminId: cup.adminId,
        maxPlayers: CUP_MAX,
        players: cup.players.map((p) => ({
            id: p.id,
            sessionId: p.sessionId,
            displayName: p.displayName,
            online: p.online !== false,
            isAdmin: p.sessionId === cup.adminId,
        })),
        bracket,
        championId: cup.championId || null,
        championName: cup.championId
            ? nameFromCupPlayerId(cup, cup.championId)
            : null,
    };
}

function cupIoRoom(code) {
    return `cup:${code}`;
}

function joinCupIoRoom(socket, code) {
    if (socket && code) socket.join(cupIoRoom(code));
}

function leaveCupIoRoom(socket, code) {
    if (socket && code) socket.leave(cupIoRoom(code));
}

function emitCupLobby(cup) {
    io.to(cupIoRoom(cup.code)).emit('cupLobbyUpdate', cupPublicState(cup));
}

function emitCupBracket(cup) {
    io.to(cupIoRoom(cup.code)).emit('cupBracketUpdate', cupPublicState(cup));
}

function emitToCupMembers(cup, event, payload, { exceptIds = [] } = {}) {
    const skip = exceptIds.filter(Boolean);
    if (skip.length === 0) {
        io.to(cupIoRoom(cup.code)).emit(event, payload);
        return;
    }
    let target = io.to(cupIoRoom(cup.code));
    for (const id of skip) {
        target = target.except(id);
    }
    target.emit(event, payload);
}

function cupMatchSnapshot(cup, match, room) {
    const live = Boolean(room);
    return {
        cupCode: cup.code,
        matchId: match.id,
        label: match.label,
        status: match.status,
        roomId: match.roomCode || room?.code || null,
        playerOneName:
            room?.playerOne?.displayName ||
            match.lastHistories?.playerOneName ||
            (match.playerIds?.[0] ? nameFromCupPlayerId(cup, match.playerIds[0]) : 'TBD'),
        playerTwoName:
            room?.playerTwo?.displayName ||
            match.lastHistories?.playerTwoName ||
            (match.playerIds?.[1] ? nameFromCupPlayerId(cup, match.playerIds[1]) : 'TBD'),
        playerOneHistory:
            room?.playerOne?.history || match.lastHistories?.playerOneHistory || [],
        playerTwoHistory:
            room?.playerTwo?.history || match.lastHistories?.playerTwoHistory || [],
        playerOneSecret:
            room?.playerOne?.answer || match.lastHistories?.playerOneSecret || null,
        playerTwoSecret:
            room?.playerTwo?.answer || match.lastHistories?.playerTwoSecret || null,
        winnerName: match.winnerName || (match.winnerId
            ? nameFromCupPlayerId(cup, match.winnerId)
            : null),
        live,
    };
}

function seatFromCupPlayer(player) {
    return {
        id: player.id,
        sessionId: player.sessionId,
        userId: player.userId || null,
        displayName: player.displayName,
        elo: player.elo ?? 100,
        answer: null,
        history: [],
        ready: false,
        online: player.online !== false,
        missedGuesses: 0,
        turnDeadline: null,
    };
}

function createCupMatchRoom(cup, matchId) {
    const match = cup.bracket.matches[matchId];
    if (!match) return null;
    const [idA, idB] = match.playerIds || [];
    const playerA = cupPlayerBySession(cup, idA);
    const playerB = cupPlayerBySession(cup, idB);
    if (!playerA || !playerB) return null;

    const code = generateRoomCode();
    rooms[code] = {
        code,
        vsAI: false,
        cupId: cup.code,
        cupMatchId: matchId,
        skipElo: true,
        playerOne: seatFromCupPlayer(playerA),
        playerTwo: seatFromCupPlayer(playerB),
        status: 'ready',
    };

    match.roomCode = code;
    match.status = 'ready';

    const payloadBase = {
        cupCode: cup.code,
        matchId,
        roomId: code,
        label: match.label,
    };
    if (playerA.online !== false && playerA.id) {
        io.to(playerA.id).emit('cupMatchAssigned', {
            ...payloadBase,
            playerName: 'Player One',
            opponentName: playerB.displayName,
        });
    }
    if (playerB.online !== false && playerB.id) {
        io.to(playerB.id).emit('cupMatchAssigned', {
            ...payloadBase,
            playerName: 'Player Two',
            opponentName: playerA.displayName,
        });
    }

    return code;
}

function buildCupBracket(cup) {
    const tree = buildBracketTree(cup.players);
    cup.bracket = {
        matches: tree.matches,
        rounds: tree.rounds,
        size: tree.size,
    };
    cup.championId = null;
}

function openReadyCupMatches(cup) {
    for (const matchId of readyMatchIds(cup.bracket.matches)) {
        createCupMatchRoom(cup, matchId);
    }
}

function notifyCupMatchOutcome(cup, match, winnerSessionId) {
    const winner = cupPlayerBySession(cup, winnerSessionId);
    if (winner?.id && winner.online !== false && match.parentId) {
        io.to(winner.id).emit('cupWaiting', {
            cupCode: cup.code,
            message: 'You advanced — waiting for your next match…',
        });
    }

    const loserSessionId = (match.playerIds || []).find(
        (id) => id && id !== winnerSessionId
    );
    const loser = loserSessionId
        ? cupPlayerBySession(cup, loserSessionId)
        : null;
    if (loser?.id && loser.online !== false) {
        io.to(loser.id).emit('cupWaiting', {
            cupCode: cup.code,
            message: 'You are out — watch the rest of the cup',
        });
    }
}

async function advanceCupMatch(cupCode, matchId, winnerSessionId) {
    const cup = cups[cupCode];
    if (!cup?.bracket?.matches?.[matchId]) return;
    const match = cup.bracket.matches[matchId];
    if (match.status === 'done') return;

    const { parent, cupFinished } = placeWinner(
        cup.bracket.matches,
        matchId,
        winnerSessionId
    );

    notifyCupMatchOutcome(cup, match, winnerSessionId);
    emitCupBracket(cup);
    await persistCupSafely(cup, 'advance');

    if (parent) {
        createCupMatchRoom(cup, parent.id);
        emitCupBracket(cup);
        await persistCupSafely(cup, 'open-parent');
        return;
    }

    if (cupFinished) {
        cup.status = 'finished';
        cup.championId = winnerSessionId;
        if (cup.dbId && isDbConfigured()) {
            const championUserId =
                cupPlayerBySession(cup, winnerSessionId)?.userId || null;
            try {
                await updateCupStatus(cup.dbId, 'finished', { championUserId });
            } catch (err) {
                console.warn('[cups] finish cup:', err.message);
            }
        }
        io.to(cupIoRoom(cup.code)).emit('cupFinished', cupPublicState(cup));
        emitCupBracket(cup);
        await persistCupSafely(cup, 'finish-tree');
    }
}

async function removePlayerFromCup(socketId, sessionId = null) {
    const found =
        findCupBySocketId(socketId) ||
        (sessionId ? findCupBySessionId(sessionId) : null);
    if (!found) return null;
    const { code, cup } = found;
    const leaving =
        cup.players.find((p) => p.id === socketId) ||
        (sessionId ? cupPlayerBySession(cup, sessionId) : null);
    const leavingSession = leaving?.sessionId;
    const leavingUserId = leaving?.userId;
    cup.players = cup.players.filter(
        (p) =>
            p.id !== leaving?.id &&
            !(leavingSession && p.sessionId === leavingSession)
    );

    if (cup.dbId && leavingUserId && isDbConfigured()) {
        try {
            await removeCupPlayerRow(cup.dbId, leavingUserId);
        } catch (err) {
            console.warn('[cups] remove player:', err.message);
        }
    }

    if (cup.players.length === 0) {
        // Keep finished cups in DB for history; dissolve lobby cups fully.
        if (cup.status !== 'finished' && cup.dbId && isDbConfigured()) {
            try {
                await deleteCupRow(cup.dbId);
            } catch (err) {
                console.warn('[cups] delete cup:', err.message);
            }
        }
        delete cups[code];
        return {
            code,
            dissolved: true,
            wasAdmin: leavingSession && cup.adminId === leavingSession,
        };
    }

    if (leavingSession && cup.adminId === leavingSession) {
        cup.adminId = cup.players[0].sessionId;
        if (cup.dbId && cup.players[0].userId && isDbConfigured()) {
            try {
                await updateCupAdmin(cup.dbId, cup.players[0].userId);
            } catch (err) {
                console.warn('[cups] update admin:', err.message);
            }
        }
    }

    emitCupLobby(cup);
    return { code, dissolved: false, cup };
}

function isSocketBusy(socketId, sessionId = null) {
    if (
        findBlockingCupBySocketId(socketId) ||
        (sessionId && findBlockingCupBySessionId(sessionId))
    ) {
        return true;
    }
    const found =
        findRoomBySocketId(socketId) ||
        (sessionId ? findRoomBySessionId(sessionId) : null);
    if (!found) return false;
    return (
        found.room.status === 'waiting' ||
        found.room.status === 'ready' ||
        found.room.status === 'playing'
    );
}

/** Logged-in user or ephemeral guest (Telegram optional). */
function identityFromSocket(socket) {
    if (socket.data?.user?.id) {
        return {
            userId: socket.data.user.id,
            displayName: socket.data.user.display_name || 'Player',
            elo: socket.data.user.elo ?? 100,
        };
    }
    if (!socket.data.guest) {
        socket.data.guest = {
            displayName: `Guest ${String(socket.id).slice(0, 4).toUpperCase()}`,
            elo: 100,
        };
    }
    return {
        userId: null,
        displayName: socket.data.guest.displayName,
        elo: socket.data.guest.elo,
    };
}

function seatFromSocket(socket) {
    const id = identityFromSocket(socket);
    return {
        id: socket.id,
        sessionId: socket.data.sessionId || null,
        userId: id.userId,
        displayName: id.displayName,
        elo: id.elo,
        answer: null,
        history: [],
        ready: false,
        online: true,
        missedGuesses: 0,
        turnDeadline: null,
    };
}

function scheduleTurnExpiry(code, key) {
    clearTurnExpiryTimer(code, key);
    const room = rooms[code];
    if (!room || room.status !== 'playing') return;
    const seat = room[key];
    if (!seat || isAiId(seat.id) || !seat.turnDeadline) return;
    if (!isSeatTurn(room, key)) return;

    const delay = Math.max(0, seat.turnDeadline - Date.now());
    const timerKey = `${code}:${key}`;
    const timer = setTimeout(async () => {
        turnExpiryTimers.delete(timerKey);
        const live = rooms[code];
        if (!live || live.status !== 'playing') return;
        const s = live[key];
        if (!s || isAiId(s.id) || !isSeatTurn(live, key)) return;

        const wasOffline = s.online === false;
        let result = await applyGuess(code, key, randomCode());
        if (!result.ok && result.illegal) {
            result = await applyGuess(code, key, randomCode());
        }
        if (result.win) return;

        if (wasOffline) {
            s.missedGuesses = (s.missedGuesses || 0) + 1;
            if (s.missedGuesses >= OFFLINE_MISS_LIMIT) {
                await finishGame(code, otherKey(key));
                return;
            }
        }
        syncTurnTimers(code);
    }, delay);
    turnExpiryTimers.set(timerKey, timer);
}

function syncTurnTimers(code) {
    const room = rooms[code];
    if (!room || room.status !== 'playing') {
        clearRoomTurnTimers(code);
        return;
    }
    syncTurnDeadlines(room);
    for (const key of ['playerOne', 'playerTwo']) {
        const seat = room[key];
        if (!seat || isAiId(seat.id) || !seat.turnDeadline) {
            clearTurnExpiryTimer(code, key);
            continue;
        }
        scheduleTurnExpiry(code, key);
    }
}

function buildRoomResumePayload(code, room, sessionId) {
    const key = seatKeyInRoom(room, sessionId);
    if (!key) return null;
    const seat = room[key];
    const oppKey = key === 'playerOne' ? 'playerTwo' : 'playerOne';
    const canAddGuess =
        room.status === 'playing' && isSeatTurn(room, key);
    return {
        roomId: code,
        playerName: displayName(key),
        vsAI: !!room.vsAI,
        opponentName: room.vsAI
            ? 'AI'
            : room[oppKey]?.displayName || null,
        cupId: room.cupId || null,
        cupMatchId: room.cupMatchId || null,
        status: room.status,
        secretLocked: Boolean(seat.ready && seat.answer),
        secret: seat.ready ? seat.answer : null,
        playerOneHistory: room.playerOne?.history || [],
        playerTwoHistory: room.playerTwo?.history || [],
        historiesAreEqual:
            (room.playerOne?.history?.length || 0) ===
            (room.playerTwo?.history?.length || 0),
        canAddGuess,
        turnMsRemaining: canAddGuess ? turnMsRemainingFor(seat) : null,
    };
}

function createPvpRematchRoom(socketA, socketB) {
    const code = generateRoomCode();
    // Requester is always Player One — map series by identity, not prior seats
    const series = {
        playerOne: Number(socketA.data?.rematchPartner?.myWins) || 0,
        playerTwo: Number(socketA.data?.rematchPartner?.theirWins) || 0,
    };
    rooms[code] = {
        code,
        vsAI: false,
        playerOne: seatFromSocket(socketA),
        playerTwo: seatFromSocket(socketB),
        status: 'ready',
        series,
    };
    clearRematchState(socketA);
    clearRematchState(socketB);
    socketA.emit('rematchStarted', {
        roomId: code,
        playerName: 'Player One',
        opponentName: rooms[code].playerTwo?.displayName || 'Opponent',
        series,
    });
    socketB.emit('rematchStarted', {
        roomId: code,
        playerName: 'Player Two',
        opponentName: rooms[code].playerOne?.displayName || 'Opponent',
        series,
    });
}

async function finishGame(code, winnerKey) {
    const room = rooms[code];
    if (!room || room.status === 'finished') return;
    room.status = 'finished';

    const isCupMatch = Boolean(room.cupId);
    const cupId = room.cupId || null;
    const cupMatchId = room.cupMatchId || null;
    const winnerSeat =
        winnerKey === 'playerTwo' ? room.playerTwo : room.playerOne;
    const winnerSessionId = winnerSeat?.sessionId || null;

    // Optimistic: notify clients immediately, then persist (DB must not delay the UI)
    const snapshot = {
        roomCode: code,
        mode: room.vsAI ? 'ai' : 'pvp',
        playerOneId: room.playerOne?.userId || null,
        playerTwoId: room.vsAI ? null : room.playerTwo?.userId || null,
        winnerKey,
        playerOneHistory: room.playerOne?.history || [],
        playerTwoHistory: room.playerTwo?.history || [],
        vsAI: room.vsAI,
        playerOne: room.playerOne,
        playerTwo: room.playerTwo,
        isCupMatch,
        cupId,
        cupMatchId,
    };

    const series =
        !room.vsAI && !isCupMatch
            ? applySeriesWin(room, winnerKey)
            : null;
    if (series) {
        bindRematchPartners(room.playerOne, room.playerTwo, series);
    }

    const winPayload = {
        roomId: code,
        winner: winnerKey,
        vsAI: !!room.vsAI,
        cupId,
        cupMatchId,
        playerOneHistory: snapshot.playerOneHistory,
        playerTwoHistory: snapshot.playerTwoHistory,
        // Secrets for end-game digit review (what each player was defending)
        playerOneSecret: room.playerOne?.answer || null,
        playerTwoSecret: room.playerTwo?.answer || null,
        series,
        elo: room.vsAI
            ? {
                  playerOneDelta: 0,
                  playerTwoDelta: 0,
                  playerOneElo: room.playerOne?.elo ?? null,
                  playerTwoElo: AI_DEFAULT_ELO,
                  aiElo: AI_DEFAULT_ELO,
              }
            : isCupMatch
              ? { cup: true, playerOneDelta: 0, playerTwoDelta: 0 }
              : null,
    };
    emitToPlayer(snapshot.playerOne, 'gamewin', winPayload);
    emitToPlayer(snapshot.playerTwo, 'gamewin', winPayload);

    if (isCupMatch && cupId && cupMatchId) {
        const cup = cups[cupId];
        const match = cup?.bracket?.matches?.[cupMatchId];
        if (match) {
            match.lastHistories = {
                playerOneHistory: snapshot.playerOneHistory,
                playerTwoHistory: snapshot.playerTwoHistory,
                playerOneName: snapshot.playerOne?.displayName,
                playerTwoName: snapshot.playerTwo?.displayName,
                playerOneSecret: room.playerOne?.answer || null,
                playerTwoSecret: room.playerTwo?.answer || null,
            };
            if (cup) {
                emitToCupMembers(cup, 'cupMatchUpdate', {
                    ...cupMatchSnapshot(
                        cup,
                        { ...match, status: 'done', winnerId: winnerSessionId },
                        null
                    ),
                    status: 'done',
                    live: false,
                    winnerName: winnerSessionId
                        ? nameFromCupPlayerId(cup, winnerSessionId)
                        : null,
                });
            }
        }
    }

    cleanupRoom(code);

    if (isCupMatch && cupId && cupMatchId) {
        if (winnerSessionId) {
            await advanceCupMatch(cupId, cupMatchId, winnerSessionId);
        } else {
            // Avoid leaving the bracket card stuck on "Live" if winner seat has no session.
            const cup = cups[cupId];
            const match = cup?.bracket?.matches?.[cupMatchId];
            if (match && match.status !== 'done') {
                match.status = 'done';
                match.roomCode = null;
                emitCupBracket(cup);
                await persistCupSafely(cup, 'force-done');
            }
        }
    }

    if (isCupMatch) return;

    try {
        const eloInfo = await recordFinishedGame({
            roomCode: snapshot.roomCode,
            mode: snapshot.mode,
            playerOneId: snapshot.playerOneId,
            playerTwoId: snapshot.playerTwoId,
            winnerKey: snapshot.winnerKey,
            playerOneHistory: snapshot.playerOneHistory,
            playerTwoHistory: snapshot.playerTwoHistory,
            playerOneSecret: room.playerOne?.answer || null,
            playerTwoSecret: room.playerTwo?.answer || null,
            playerOneName: room.playerOne?.displayName || null,
            playerTwoName: room.playerTwo?.displayName || null,
        });
        // PvP: push Elo update after DB (optional refresh for clients still on overlay)
        if (eloInfo && snapshot.mode === 'pvp') {
            const eloPayload = {
                roomId: code,
                winner: winnerKey,
                elo: {
                    playerOneDelta: eloInfo.playerOneDelta,
                    playerTwoDelta: eloInfo.playerTwoDelta,
                    playerOneElo: eloInfo.playerOneElo,
                    playerTwoElo: eloInfo.playerTwoElo,
                },
            };
            emitToPlayer(snapshot.playerOne, 'eloUpdate', eloPayload);
            emitToPlayer(snapshot.playerTwo, 'eloUpdate', eloPayload);
        }
    } catch (err) {
        console.warn('[games] record failed:', err.message);
    }
}

function tryStartGame(code) {
    const room = rooms[code];
    if (!room?.playerOne?.ready || !room?.playerTwo?.ready) return;
    if (room.status === 'playing') return;

    room.status = 'playing';
    if (room.cupId && room.cupMatchId) {
        const cup = cups[room.cupId];
        const match = cup?.bracket?.matches?.[room.cupMatchId];
        if (match && match.status !== 'done') {
            match.status = 'playing';
            emitCupBracket(cup);
        }
    }

    syncTurnTimers(code);
    const seriesPayload =
        !room.vsAI && !room.cupId && room.series
            ? {
                  playerOne: Number(room.series.playerOne) || 0,
                  playerTwo: Number(room.series.playerTwo) || 0,
              }
            : null;
    emitToPlayer(room.playerOne, 'gamestarted', {
        roomId: code,
        turnMsRemaining: turnMsRemainingFor(room.playerOne) ?? TURN_MS,
        series: seriesPayload,
    });
    emitToPlayer(room.playerTwo, 'gamestarted', {
        roomId: code,
        turnMsRemaining: isAiId(room.playerTwo?.id)
            ? null
            : turnMsRemainingFor(room.playerTwo) ?? TURN_MS,
        series: seriesPayload,
    });

    if (room.vsAI) {
        scheduleAiGuess(code);
    }
}

/**
 * Apply a guess for a seat. Returns { ok, win, illegal, reason }.
 */
async function applyGuess(code, key, guessRaw) {
    const room = rooms[code];
    if (!room || room.status !== 'playing') {
        // Late guess after AI/human already finished — silent for the client
        return { ok: false, reason: 'Game is not active', silent: true };
    }

    const other = otherKey(key);
    if (!room[key] || !room[other]) {
        return { ok: false, reason: 'Opponent missing' };
    }

    const myHistory = room[key].history;
    const theirHistory = room[other].history;
    if (myHistory.length > theirHistory.length) {
        return { ok: false, reason: 'Wait for your opponent to guess' };
    }

    const validation = validateNumber(guessRaw);
    if (!validation.ok) {
        return { ok: false, reason: validation.reason, illegal: true };
    }

    const [numberCorrect, orderCorrect] = scoreGuess(
        validation.value,
        room[other].answer
    );

    const guessArray = validation.value.split('').map(Number);
    guessArray.push(numberCorrect, orderCorrect);
    room[key].history = [...myHistory, guessArray];
    room[key].turnDeadline = null;

    if (room.vsAI && key === 'playerTwo' && room.aiBrain) {
        room.aiBrain.observe(validation.value, numberCorrect, orderCorrect);
    }

    const playerOneHistory = room.playerOne.history;
    const playerTwoHistory = room.playerTwo.history;
    const historiesAreEqual = playerOneHistory.length === playerTwoHistory.length;

    syncTurnTimers(code);

    const payloadFor = (seatKey) => ({
        roomId: code,
        playerOneHistory,
        playerTwoHistory,
        historiesAreEqual,
        canAddGuess: isSeatTurn(room, seatKey),
        turnMsRemaining: isSeatTurn(room, seatKey)
            ? turnMsRemainingFor(room[seatKey])
            : null,
    });

    if (!historiesAreEqual) {
        // Only the guesser sees the mid-round board; opponent keeps their turn clock
        emitToPlayer(room[key], 'historyUpdate', payloadFor(key));
    } else {
        emitToPlayer(room.playerOne, 'historyUpdate', payloadFor('playerOne'));
        emitToPlayer(room.playerTwo, 'historyUpdate', payloadFor('playerTwo'));
    }

    // Cup spectators get live board updates
    if (room.cupId) {
        const cup = cups[room.cupId];
        const match = cup?.bracket?.matches?.[room.cupMatchId];
        if (cup && match) {
            emitToCupMembers(
                cup,
                'cupMatchUpdate',
                {
                    ...cupMatchSnapshot(cup, match, room),
                    historiesAreEqual,
                },
                {
                    exceptIds: [room.playerOne?.id, room.playerTwo?.id],
                }
            );
        }
    }

    if (numberCorrect === 4 && orderCorrect === 4) {
        await finishGame(code, key);
        return { ok: true, win: true };
    }

    return { ok: true, win: false, historiesAreEqual };
}

function scheduleAiGuess(code) {
    setTimeout(async () => {
        const room = rooms[code];
        if (!room?.vsAI || room.status !== 'playing') return;

        const ai = room.playerTwo;
        const human = room.playerOne;
        if (!ai || !human) return;
        if (ai.history.length > human.history.length) return;

        const guess = room.aiBrain ? room.aiBrain.act() : randomCode();
        const result = await applyGuess(code, 'playerTwo', guess);
        if (!result.ok && !result.illegal) {
            await applyGuess(code, 'playerTwo', randomCode());
        }
    }, 700);
}

function requireSocketUser(socket) {
    // Kept for optional authenticated-only features; play no longer requires login.
    if (!isDbConfigured()) return true;
    if (socket.data?.user?.id) return true;
    emitError(socket, 'Log in with Telegram to play');
    return false;
}

app.get('/', (req, res) => {
    res.sendFile(join(__dirname, '/frontend/index.html'));
});

setPresenceChangeHandler((userId, online) => {
    void (async () => {
        if (!isDbConfigured() || !userId) return;
        try {
            const friendIds = await listAcceptedFriendIds(userId);
            const payload = { userId: String(userId), online: Boolean(online) };
            for (const friendId of friendIds) {
                for (const sid of getSocketIdsForUser(friendId)) {
                    io.to(sid).emit('friendsPresence', payload);
                }
            }
        } catch (err) {
            console.warn('[presence] notify friends:', err.message);
        }
    })();
});

io.on('connection', (socket) => {
    broadcastUserCount(io);

    // Register handlers first — do not await before this or early client
    // emits (sessionHello / createRoom) are dropped.
    void (async () => {
        socket.data.user = await userFromSocket(socket);
        if (socket.data.user) {
            markUserOnline(socket.data.user.id, socket.id);
            socket.emit('authed', {
                id: socket.data.user.id,
                display_name: socket.data.user.display_name,
                username: socket.data.user.username || null,
                elo: socket.data.user.elo,
                friend_code: socket.data.user.friend_code || null,
                ai_elo: AI_DEFAULT_ELO,
            });
        }
    })();

    socket.on('createRoom', async (msg = {}) => {
        if (!requireSession(socket, msg.sessionId)) return;
        await restoreOpenCupToMemory({
            userId: socket.data?.user?.id || null,
            sessionId: socket.data.sessionId,
        });
        if (
            findRoomBySocketId(socket.id) ||
            findRoomBySessionId(socket.data.sessionId) ||
            findBlockingCupBySocketId(socket.id) ||
            findBlockingCupBySessionId(socket.data.sessionId)
        ) {
            emitError(socket, 'You are already in a room');
            return;
        }

        const code = generateRoomCode();
        rooms[code] = {
            code,
            vsAI: false,
            playerOne: seatFromSocket(socket),
            playerTwo: null,
            status: 'waiting',
        };

        socket.emit('roomCreated', {
            roomId: code,
            playerName: 'Player One',
        });
        socket.emit('statusMessage', {
            message: `Room created — share your code ${code}`,
            type: 'info',
        });
    });

    socket.on('playVsAI', async (msg = {}) => {
        if (!requireSession(socket, msg.sessionId)) return;
        await restoreOpenCupToMemory({
            userId: socket.data?.user?.id || null,
            sessionId: socket.data.sessionId,
        });
        if (
            findRoomBySocketId(socket.id) ||
            findRoomBySessionId(socket.data.sessionId) ||
            findBlockingCupBySocketId(socket.id) ||
            findBlockingCupBySessionId(socket.data.sessionId)
        ) {
            emitError(socket, 'You are already in a room');
            return;
        }

        const code = generateRoomCode();
        const aiSecret = randomCode();
        rooms[code] = {
            code,
            vsAI: true,
            aiBrain: createAiBrain(),
            playerOne: seatFromSocket(socket),
            playerTwo: {
                id: `AI:${code}`,
                sessionId: null,
                userId: null,
                displayName: 'ATP AI',
                elo: AI_DEFAULT_ELO,
                answer: aiSecret,
                history: [],
                ready: true,
                online: true,
                missedGuesses: 0,
                turnDeadline: null,
            },
            status: 'ready',
        };

        socket.emit('aiMatched', {
            roomId: code,
            playerName: 'Player One',
            engine: getAiEngine(),
            aiElo: AI_DEFAULT_ELO,
        });
        socket.emit('statusMessage', {
            message:
                getAiEngine() === 'neural'
                    ? `Playing vs AI (${AI_DEFAULT_ELO} Elo) — set your secret`
                    : `Playing vs AI (${AI_DEFAULT_ELO} Elo) — set your secret`,
            type: 'info',
        });
    });

    socket.on('joinRoom', async (msg = {}) => {
        if (!requireSession(socket, msg.sessionId)) return;
        await restoreOpenCupToMemory({
            userId: socket.data?.user?.id || null,
            sessionId: socket.data.sessionId,
        });
        if (
            findRoomBySocketId(socket.id) ||
            findRoomBySessionId(socket.data.sessionId) ||
            findBlockingCupBySocketId(socket.id) ||
            findBlockingCupBySessionId(socket.data.sessionId)
        ) {
            emitError(socket, 'You are already in a room');
            return;
        }

        const code = String(msg.code ?? '').trim().toUpperCase();
        if (!code) {
            emitError(socket, 'Enter a room code');
            return;
        }

        const room = rooms[code];
        if (!room) {
            emitError(socket, 'Room not found');
            return;
        }
        if (room.vsAI) {
            emitError(socket, 'This is an AI game room');
            return;
        }
        if (room.status === 'finished') {
            emitError(socket, 'This room has already ended');
            return;
        }
        if (room.playerTwo) {
            emitError(socket, 'This room already has two players');
            return;
        }
        if (room.playerOne?.id === socket.id) {
            emitError(socket, 'You cannot join your own room');
            return;
        }
        const me = identityFromSocket(socket);
        if (me.userId && room.playerOne?.userId && room.playerOne.userId === me.userId) {
            emitError(socket, 'You are already in this room');
            return;
        }

        room.playerTwo = seatFromSocket(socket);
        room.status = 'ready';

        emitToPlayer(room.playerOne, 'opponentJoined', {
            roomId: code,
            message: 'Player Two joined — set your secret number',
            opponentName: room.playerTwo.displayName || 'Opponent',
        });
        socket.emit('roomJoined', {
            roomId: code,
            playerName: 'Player Two',
            opponentName: room.playerOne?.displayName || 'Opponent',
        });
        socket.emit('statusMessage', {
            message: 'Joined room — set your secret number',
            type: 'info',
        });
    });

    socket.on('setSecret', (msg = {}) => {
        const found = findRoomBySocketId(socket.id);
        if (!found) {
            emitError(socket, 'You are not in a room');
            return;
        }

        const { code, room } = found;
        if (room.status === 'playing' || room.status === 'finished') {
            emitError(socket, 'Game already started');
            return;
        }

        const validation = validateNumber(msg.answer);
        if (!validation.ok) {
            emitError(socket, validation.reason);
            return;
        }

        const isPlayerOne = room.playerOne?.id === socket.id;
        const key = isPlayerOne ? 'playerOne' : 'playerTwo';
        if (!room[key] || isAiId(room[key].id)) {
            emitError(socket, 'Invalid player');
            return;
        }
        if (room[key].ready) {
            emitError(socket, 'Secret already set');
            return;
        }

        room[key].answer = validation.value;
        room[key].ready = true;

        socket.emit('secretAccepted', {
            roomId: code,
            answer: validation.value,
            playerName: displayName(key),
        });

        const other = room[otherKey(key)];
        if (!other?.ready) {
            socket.emit('statusMessage', {
                message: 'Secret locked in — waiting for opponent…',
                type: 'info',
            });
        }

        tryStartGame(code);
    });

    socket.on('resigngame', async (msg = {}) => {
        const code = String(msg.roomId ?? '').trim().toUpperCase();
        const room = rooms[code];
        if (!room) {
            emitError(socket, "You can't resign");
            return;
        }

        const key = playerKeyFromName(msg.playerName);
        if (!key || room[key]?.id !== socket.id) {
            emitError(socket, "You can't resign");
            return;
        }

        // Mid-game resign = opponent wins (same end banner as a normal loss)
        if (room.status === 'playing') {
            await finishGame(code, otherKey(key));
            return;
        }

        const other = room[otherKey(key)];
        emitToPlayer(other, 'gameresigned', { roomId: code });
        socket.emit('gameresigned', { roomId: code });
        cleanupRoom(code);
    });

    socket.on('guessput', async (msg = {}) => {
        const code = String(msg.roomId ?? '').trim().toUpperCase();
        const room = rooms[code];
        if (!room || room.status !== 'playing') {
            // Quiet ignore — game already ended (common when AI wins mid-type)
            return;
        }

        const key = playerKeyFromName(msg.playerName);
        if (!key || room[key]?.id !== socket.id) {
            emitError(socket, 'Invalid player');
            return;
        }

        const result = await applyGuess(code, key, msg.guess);
        if (!result.ok) {
            if (!result.silent) emitError(socket, result.reason);
            return;
        }

        // room may be deleted after a win — use snapshot flag
        if (!result.win) {
            const still = rooms[code];
            if (still?.vsAI) scheduleAiGuess(code);
        }
    });

    socket.on('chatSend', (msg = {}) => {
        if (msg.sessionId) bindSession(socket, msg.sessionId);
        const code = String(msg.roomId ?? '').trim().toUpperCase();
        const room = rooms[code];
        if (!room || room.vsAI) return;
        if (room.status !== 'playing' && room.status !== 'ready') return;

        const key =
            room.playerOne?.id === socket.id
                ? 'playerOne'
                : room.playerTwo?.id === socket.id
                  ? 'playerTwo'
                  : null;
        if (!key || isAiId(room[key]?.id)) return;

        let text = String(msg.text ?? '')
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
            .slice(0, 100)
            .trimEnd();
        if (!text.trim()) return;

        const payload = {
            roomId: code,
            from: room[key].displayName || displayName(key),
            sessionId: room[key].sessionId || socket.data.sessionId || null,
            text,
            at: Date.now(),
        };
        emitToPlayer(room.playerOne, 'chatMessage', payload);
        emitToPlayer(room.playerTwo, 'chatMessage', payload);
    });

    socket.on('rematchRequest', () => {
        const partner = socket.data.rematchPartner;
        if (!partner?.socketId) {
            socket.emit('rematchBusy', { reason: 'No rematch partner' });
            return;
        }
        if (isSocketBusy(socket.id)) {
            socket.emit('rematchBusy', { reason: 'Finish your current game first' });
            return;
        }

        const partnerSocket = io.sockets.sockets.get(partner.socketId);
        if (!partnerSocket) {
            socket.emit('rematchBusy', { reason: 'Opponent left' });
            clearRematchState(socket);
            return;
        }
        if (isSocketBusy(partner.socketId)) {
            socket.emit('rematchBusy', { reason: 'Opponent is busy' });
            return;
        }

        const me = identityFromSocket(socket);
        partnerSocket.data.pendingRematchFrom = socket.id;
        partnerSocket.emit('rematchInvite', {
            fromSocketId: socket.id,
            fromUserId: me.userId,
            fromName: me.displayName || 'Opponent',
        });
        socket.emit('statusMessage', {
            message: 'Rematch invite sent…',
            type: 'info',
        });
    });

    socket.on('rematchAccept', (msg = {}) => {
        const fromSocketId = String(msg.fromSocketId || socket.data.pendingRematchFrom || '');
        if (!fromSocketId) {
            socket.emit('rematchBusy', { reason: 'Rematch expired' });
            return;
        }

        const requester = io.sockets.sockets.get(fromSocketId);
        if (!requester) {
            socket.emit('rematchBusy', { reason: 'Opponent left' });
            clearRematchState(socket);
            return;
        }
        if (isSocketBusy(socket.id) || isSocketBusy(fromSocketId)) {
            requester.emit('rematchBusy', { reason: 'Opponent is busy' });
            socket.emit('rematchBusy', { reason: 'Someone is already in a game' });
            return;
        }

        // Requester is Player One; accepter is Player Two
        createPvpRematchRoom(requester, socket);
    });

    socket.on('rematchDecline', (msg = {}) => {
        const fromSocketId = String(msg.fromSocketId || socket.data.pendingRematchFrom || '');
        socket.data.pendingRematchFrom = null;
        if (!fromSocketId) return;
        const requester = io.sockets.sockets.get(fromSocketId);
        if (requester) {
            requester.emit('rematchBusy', { reason: 'Opponent declined' });
        }
    });

    socket.on('clearRematch', () => {
        clearRematchState(socket, { notifyRequester: true });
    });

    // ——— Session resume (M5) ———

    socket.on('sessionHello', async (msg = {}) => {
        const sessionId = bindSession(socket, msg.sessionId);
        if (!sessionId) {
            emitError(socket, 'Missing session id');
            return;
        }

        bindSessionSocket(sessionId, socket.id);
        // Refresh cookie user so profile edits (name) apply mid-session
        try {
            const fresh = await userFromSocket(socket);
            if (fresh) socket.data.user = fresh;
        } catch {
            /* keep prior socket.data.user */
        }
        if (socket.data?.user?.id) {
            markUserOnline(socket.data.user.id, socket.id);
            socket.emit('authed', {
                id: socket.data.user.id,
                display_name: socket.data.user.display_name,
                username: socket.data.user.username || null,
                elo: socket.data.user.elo,
                friend_code: socket.data.user.friend_code || null,
                ai_elo: AI_DEFAULT_ELO,
            });
        }

        let cupFound = findCupBySessionId(sessionId);
        if (!cupFound) {
            cupFound = await restoreOpenCupToMemory({
                userId: socket.data?.user?.id || null,
                sessionId,
            });
        }
        if (cupFound) {
            const { cup } = cupFound;
            const player = cupPlayerBySession(cup, sessionId);
            if (player) {
                player.id = socket.id;
                player.online = true;
                if (!player.userId && socket.data?.user?.id) {
                    player.userId = socket.data.user.id;
                }
            }
            joinCupIoRoom(socket, cup.code);
        }

        const roomFound = findRoomBySessionId(sessionId);
        let roomResume = null;
        if (roomFound) {
            const { code, room } = roomFound;
            const key = seatKeyInRoom(room, sessionId);
            if (key && room[key]) {
                room[key].id = socket.id;
                room[key].online = true;
                room[key].missedGuesses = 0;
                // Keep turnDeadline — refresh must not reset the clock
                roomResume = buildRoomResumePayload(code, room, sessionId);
                if (room.status === 'playing') syncTurnTimers(code);
            }
        }

        const restored = {
            sessionId,
            cup: cupFound ? cupPublicState(cupFound.cup) : null,
            room: roomResume,
        };
        socket.emit('sessionRestored', restored);

        if (cupFound) {
            emitCupLobby(cupFound.cup);
            if (cupFound.cup.bracket) emitCupBracket(cupFound.cup);
        }
    });

    // ——— Cups ———

    socket.on('cupCreate', async (msg = {}) => {
        if (!requireSession(socket, msg.sessionId)) return;
        if (!requireCupAuth(socket)) return;

        await restoreOpenCupToMemory({
            userId: socket.data.user.id,
            sessionId: socket.data.sessionId,
        });

        if (
            findRoomBySocketId(socket.id) ||
            findRoomBySessionId(socket.data.sessionId) ||
            findBlockingCupBySocketId(socket.id) ||
            findBlockingCupBySessionId(socket.data.sessionId)
        ) {
            emitError(socket, 'Leave your current game or cup first');
            return;
        }

        const ident = identityFromSocket(socket);
        const code = generateCupCode();

        let dbRow;
        try {
            dbRow = await createCupRow({
                code,
                adminUserId: ident.userId,
                maxPlayers: CUP_MAX,
            });
            await addCupPlayerRow({
                cupId: dbRow.id,
                userId: ident.userId,
                sessionId: socket.data.sessionId,
                displayName: ident.displayName,
                eloSnapshot: ident.elo,
                slot: 0,
            });
        } catch (err) {
            console.warn('[cups] create:', err.message);
            emitError(socket, 'Could not create cup');
            return;
        }

        cups[code] = {
            code,
            dbId: dbRow.id,
            adminId: socket.data.sessionId,
            status: 'lobby',
            players: [
                {
                    id: socket.id,
                    sessionId: socket.data.sessionId,
                    userId: ident.userId,
                    displayName: ident.displayName,
                    elo: ident.elo,
                    online: true,
                },
            ],
            bracket: null,
        };

        joinCupIoRoom(socket, code);
        socket.emit('cupCreated', cupPublicState(cups[code]));
        emitCupLobby(cups[code]);
    });

    socket.on('cupJoin', async (msg = {}) => {
        if (!requireSession(socket, msg.sessionId)) return;
        if (!requireCupAuth(socket)) return;

        await restoreOpenCupToMemory({
            userId: socket.data.user.id,
            sessionId: socket.data.sessionId,
        });

        if (
            findRoomBySocketId(socket.id) ||
            findRoomBySessionId(socket.data.sessionId) ||
            findBlockingCupBySocketId(socket.id) ||
            findBlockingCupBySessionId(socket.data.sessionId)
        ) {
            emitError(socket, 'Leave your current game or cup first');
            return;
        }

        const code = String(msg.code ?? '').trim().toUpperCase();
        if (!code) {
            emitError(socket, 'Enter a cup code');
            return;
        }

        const cup = (await ensureCupLoadedByCode(code)) || cups[code];
        if (!cup) {
            emitError(socket, 'Cup not found');
            return;
        }
        if (cup.status !== 'lobby') {
            emitError(socket, 'This cup has already started');
            return;
        }
        if (cup.players.length >= CUP_MAX) {
            emitError(socket, 'This cup is full');
            return;
        }

        const ident = identityFromSocket(socket);
        if (
            ident.userId &&
            cup.players.some((p) => p.userId && p.userId === ident.userId)
        ) {
            emitError(socket, 'You are already in this cup');
            return;
        }
        if (cup.players.some((p) => p.sessionId === socket.data.sessionId)) {
            emitError(socket, 'You are already in this cup');
            return;
        }

        if (cup.dbId) {
            try {
                await addCupPlayerRow({
                    cupId: cup.dbId,
                    userId: ident.userId,
                    sessionId: socket.data.sessionId,
                    displayName: ident.displayName,
                    eloSnapshot: ident.elo,
                    slot: cup.players.length,
                });
            } catch (err) {
                console.warn('[cups] join:', err.message);
                emitError(socket, 'Could not join cup');
                return;
            }
        }

        cup.players.push({
            id: socket.id,
            sessionId: socket.data.sessionId,
            userId: ident.userId,
            displayName: ident.displayName,
            elo: ident.elo,
            online: true,
        });

        joinCupIoRoom(socket, code);
        socket.emit('cupJoined', cupPublicState(cup));
        emitCupLobby(cup);
    });

    socket.on('cupLeave', async () => {
        let found =
            findCupBySocketId(socket.id) ||
            findCupBySessionId(socket.data.sessionId);
        if (!found && socket.data?.user?.id) {
            found = await restoreOpenCupToMemory({
                userId: socket.data.user.id,
                sessionId: socket.data.sessionId,
            });
        }
        if (!found) {
            emitError(socket, 'You are not in a cup');
            return;
        }
        if (found.cup.status !== 'lobby' && found.cup.status !== 'finished') {
            emitError(socket, 'Cannot leave after the cup has started');
            return;
        }
        const player =
            found.cup.players.find((p) => p.id === socket.id) ||
            cupPlayerBySession(found.cup, socket.data.sessionId);
        const cupCode = found.code;
        const result = player
            ? await removePlayerFromCup(player.id, player.sessionId)
            : null;
        if (!result) {
            emitError(socket, 'You are not in a cup');
            return;
        }
        leaveCupIoRoom(socket, cupCode);
        socket.emit('cupLeft', { code: result.code });
    });

    socket.on('cupStart', async (msg = {}) => {
        if (!requireSession(socket, msg.sessionId)) return;
        if (!requireCupAuth(socket)) return;
        const found =
            findCupBySocketId(socket.id) ||
            findCupBySessionId(socket.data.sessionId);
        if (!found) {
            emitError(socket, 'You are not in a cup');
            return;
        }
        const { cup } = found;
        if (cup.adminId !== socket.data.sessionId) {
            emitError(socket, 'Only the cup admin can start');
            return;
        }
        if (cup.status !== 'lobby') {
            emitError(socket, 'Cup already started');
            return;
        }
        const n = cup.players.length;
        if (n < CUP_MIN_START || n > CUP_MAX) {
            emitError(
                socket,
                `Need ${CUP_MIN_START}–${CUP_MAX} players to start (have ${n})`
            );
            return;
        }

        cup.status = 'running';
        buildCupBracket(cup);
        openReadyCupMatches(cup);

        if (cup.dbId && isDbConfigured()) {
            try {
                await updateCupStatus(cup.dbId, 'running');
                await persistCupTree(cup);
            } catch (err) {
                console.warn('[cups] start persist:', err.message);
            }
        }

        const payload = cupPublicState(cup);
        io.to(cupIoRoom(cup.code)).emit('cupStarted', payload);
        emitCupBracket(cup);
        emitCupLobby(cup);
    });

    socket.on('cupSpectate', async (msg = {}) => {
        let found =
            findCupBySocketId(socket.id) ||
            findCupBySessionId(socket.data.sessionId);
        if (!found) {
            found = await restoreOpenCupToMemory({
                userId: socket.data?.user?.id || null,
                sessionId: socket.data.sessionId,
            });
        }
        if (!found) {
            emitError(socket, 'You are not in a cup');
            return;
        }
        const { cup } = found;
        const matchId = String(msg.matchId || '');
        const match = cup.bracket?.matches?.[matchId];
        if (!match) {
            emitError(socket, 'Match not found');
            return;
        }

        const mySession = socket.data.sessionId;
        if (
            mySession &&
            match.playerIds?.includes(mySession) &&
            (match.status === 'ready' || match.status === 'playing')
        ) {
            emitError(socket, 'You are playing this match');
            return;
        }

        const room = match.roomCode ? rooms[match.roomCode] : null;
        if (!room && match.status !== 'done') {
            emitError(socket, 'Match is not available yet');
            return;
        }

        socket.emit('cupSpectateStart', cupMatchSnapshot(cup, match, room));
    });

    // ——— Friend play invite ———

    socket.on('friendPlayInvite', async (msg = {}) => {
        if (!requireSession(socket, msg.sessionId)) return;
        if (!requireSocketUser(socket)) return;

        const friendUserId = String(msg.userId || '').trim();
        if (!friendUserId) {
            emitError(socket, 'Pick a friend to invite');
            return;
        }

        try {
            if (!(await areFriends(socket.data.user.id, friendUserId))) {
                socket.emit('friendPlayInviteResult', {
                    ok: false,
                    reason: 'not_friends',
                    message: 'You can only invite accepted friends',
                });
                return;
            }
        } catch (err) {
            console.warn('[friends] invite check:', err.message);
            emitError(socket, 'Could not invite right now');
            return;
        }

        if (!isUserOnline(friendUserId)) {
            socket.emit('friendPlayInviteResult', {
                ok: false,
                reason: 'offline',
                message: 'Not online — ask them to open ATP',
            });
            return;
        }

        let friendSocket = null;
        for (const sid of getSocketIdsForUser(friendUserId)) {
            const s = io.sockets.sockets.get(sid);
            if (s?.data?.sessionId) {
                friendSocket = s;
                break;
            }
        }
        if (!friendSocket) {
            socket.emit('friendPlayInviteResult', {
                ok: false,
                reason: 'offline',
                message: 'Not online — ask them to open ATP',
            });
            return;
        }

        await restoreOpenCupToMemory({
            userId: socket.data.user.id,
            sessionId: socket.data.sessionId,
        });
        await restoreOpenCupToMemory({
            userId: friendUserId,
            sessionId: friendSocket.data.sessionId,
        });

        if (
            isSocketBusy(socket.id, socket.data.sessionId) ||
            findRoomBySocketId(socket.id) ||
            findRoomBySessionId(socket.data.sessionId)
        ) {
            socket.emit('friendPlayInviteResult', {
                ok: false,
                reason: 'self_busy',
                message: 'Leave your current game or cup first',
            });
            return;
        }

        if (
            isSocketBusy(friendSocket.id, friendSocket.data.sessionId) ||
            findRoomBySocketId(friendSocket.id) ||
            findRoomBySessionId(friendSocket.data.sessionId)
        ) {
            socket.emit('friendPlayInviteResult', {
                ok: false,
                reason: 'busy',
                message: 'In a game or cup right now',
            });
            return;
        }

        const code = generateRoomCode();
        rooms[code] = {
            code,
            vsAI: false,
            playerOne: seatFromSocket(socket),
            playerTwo: null,
            status: 'waiting',
            friendInvite: {
                toUserId: friendUserId,
                fromUserId: socket.data.user.id,
            },
        };

        socket.emit('roomCreated', {
            roomId: code,
            playerName: 'Player One',
        });
        socket.emit('statusMessage', {
            message: `Invite sent — waiting in room ${code}`,
            type: 'info',
        });
        socket.emit('friendPlayInviteResult', {
            ok: true,
            roomId: code,
            message: 'Invite sent…',
        });

        friendSocket.emit('friendPlayInvite', {
            roomId: code,
            fromUserId: socket.data.user.id,
            fromName:
                socket.data.user.display_name ||
                identityFromSocket(socket).displayName,
        });
    });

    socket.on('friendPlayRespond', async (msg = {}) => {
        if (!requireSession(socket, msg.sessionId)) return;
        const roomId = String(msg.roomId || '')
            .trim()
            .toUpperCase();
        const accept = Boolean(msg.accept);
        const room = rooms[roomId];

        if (!accept) {
            if (room?.playerOne?.id) {
                io.to(room.playerOne.id).emit('friendPlayInviteResult', {
                    ok: false,
                    reason: 'declined',
                    message: 'Friend declined the invite',
                    roomId,
                });
                io.to(room.playerOne.id).emit('statusMessage', {
                    message: 'Friend declined — room closed',
                    type: 'info',
                });
            }
            if (room && room.status === 'waiting' && !room.playerTwo) {
                delete rooms[roomId];
            }
            return;
        }

        if (!room || room.status !== 'waiting' || room.playerTwo) {
            emitError(socket, 'Invite expired');
            return;
        }

        if (
            findRoomBySocketId(socket.id) ||
            findRoomBySessionId(socket.data.sessionId) ||
            findBlockingCupBySocketId(socket.id) ||
            findBlockingCupBySessionId(socket.data.sessionId)
        ) {
            emitError(socket, 'Leave your current game or cup first');
            return;
        }

        room.playerTwo = seatFromSocket(socket);
        room.status = 'ready';

        socket.emit('roomJoined', {
            roomId,
            playerName: 'Player Two',
            opponentName: room.playerOne?.displayName || 'Opponent',
        });
        emitToPlayer(room.playerOne, 'opponentJoined', {
            roomId,
            message: 'Friend joined — set your secret number',
            opponentName: room.playerTwo.displayName || 'Opponent',
        });
        socket.emit('statusMessage', {
            message: 'Joined — set your secret number',
            type: 'info',
        });
    });

    socket.on('disconnect', () => {
        clearSocketPresence(socket.id);
        broadcastUserCount(io);

        const partnerInfo = socket.data.rematchPartner;
        if (partnerInfo?.socketId) {
            const partnerSocket = io.sockets.sockets.get(partnerInfo.socketId);
            if (partnerSocket?.data?.rematchPartner?.socketId === socket.id) {
                partnerSocket.data.rematchPartner = null;
            }
        }
        clearRematchState(socket);

        const cupFound = findCupBySocketId(socket.id);
        if (cupFound) {
            const player = cupFound.cup.players.find((p) => p.id === socket.id);
            if (player) {
                player.online = false;
                // Keep seat for reconnect (lobby + running)
                emitCupLobby(cupFound.cup);
            }
        }

        const found = findRoomBySocketId(socket.id);
        if (!found) return;

        const { code, room } = found;
        const leaverKey =
            room.playerOne?.id === socket.id ? 'playerOne' : 'playerTwo';
        const seat = room[leaverKey];
        if (!seat || isAiId(seat.id)) return;

        // Soft offline — turn deadline stays; expiry auto-guesses / forfeit if 2 misses
        seat.online = false;
        // Waiting / secret / playing: keep room for reconnect
    });
});

server.listen(3000, () => {
    console.log('server running at http://localhost:3000');
    console.log(`[ai] engine: ${getAiEngine()}`);
    console.log(`[db] ${isDbConfigured() ? 'Neon connected (DATABASE_URL set)' : 'no DATABASE_URL — auth disabled'}`);
});
