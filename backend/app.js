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

/** @type {Record<string, any>} */
const rooms = {};
/** @type {Record<string, any>} */
const cups = {};
const CUP_SIZE = 4;
const OFFLINE_MISS_LIMIT = 2;
/** Server-authoritative turn length (client bar must follow remaining time). */
const TURN_MS = 60_000;
/** @type {Map<string, NodeJS.Timeout>} */
const turnExpiryTimers = new Map();
let userCounter = 0;

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

function bindRematchPartners(playerA, playerB) {
    if (!playerA?.id || !playerB?.id || isAiId(playerA.id) || isAiId(playerB.id)) return;
    const sockA = io.sockets.sockets.get(playerA.id);
    const sockB = io.sockets.sockets.get(playerB.id);
    if (sockA) {
        sockA.data.rematchPartner = {
            socketId: playerB.id,
            userId: playerB.userId || null,
            displayName: playerB.displayName || 'Opponent',
        };
    }
    if (sockB) {
        sockB.data.rematchPartner = {
            socketId: playerA.id,
            userId: playerA.userId || null,
            displayName: playerA.displayName || 'Opponent',
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

function shufflePlayers(list) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
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
        maxPlayers: CUP_SIZE,
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

function emitCupLobby(cup) {
    const payload = cupPublicState(cup);
    for (const p of cup.players) {
        if (p?.id) io.to(p.id).emit('cupLobbyUpdate', payload);
    }
}

function emitCupBracket(cup) {
    const payload = cupPublicState(cup);
    for (const p of cup.players) {
        if (p?.id) io.to(p.id).emit('cupBracketUpdate', payload);
    }
}

function emitToCupMembers(cup, event, payload, { exceptIds = [] } = {}) {
    const skip = new Set(exceptIds.filter(Boolean));
    for (const p of cup.players) {
        if (!p?.id || skip.has(p.id)) continue;
        io.to(p.id).emit(event, payload);
    }
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
    const shuffled = shufflePlayers(cup.players);
    cup.bracket = {
        matches: {
            sf1: {
                id: 'sf1',
                label: 'Semifinal 1',
                round: 'semifinal',
                playerIds: [shuffled[0].sessionId, shuffled[1].sessionId],
                winnerId: null,
                roomCode: null,
                status: 'pending',
            },
            sf2: {
                id: 'sf2',
                label: 'Semifinal 2',
                round: 'semifinal',
                playerIds: [shuffled[2].sessionId, shuffled[3].sessionId],
                winnerId: null,
                roomCode: null,
                status: 'pending',
            },
            final: {
                id: 'final',
                label: 'Final',
                round: 'final',
                playerIds: [null, null],
                winnerId: null,
                roomCode: null,
                status: 'pending',
            },
        },
    };
    cup.championId = null;
}

function tryStartCupFinal(cup) {
    const sf1 = cup.bracket.matches.sf1;
    const sf2 = cup.bracket.matches.sf2;
    const final = cup.bracket.matches.final;
    if (sf1.status !== 'done' || sf2.status !== 'done') return;
    if (final.status !== 'pending') return;
    if (!sf1.winnerId || !sf2.winnerId) return;

    final.playerIds = [sf1.winnerId, sf2.winnerId];
    createCupMatchRoom(cup, 'final');
    emitCupBracket(cup);

    for (const p of cup.players) {
        if (
            p.sessionId === sf1.winnerId ||
            p.sessionId === sf2.winnerId ||
            !p.id ||
            p.online === false
        ) {
            continue;
        }
        io.to(p.id).emit('cupWaiting', {
            cupCode: cup.code,
            message: 'Final is starting — you can watch from Cups soon',
        });
    }
}

function advanceCupMatch(cupCode, matchId, winnerSessionId) {
    const cup = cups[cupCode];
    if (!cup?.bracket?.matches?.[matchId]) return;
    const match = cup.bracket.matches[matchId];
    if (match.status === 'done') return;

    match.winnerId = winnerSessionId;
    match.status = 'done';
    match.roomCode = null;

    emitCupBracket(cup);

    if (matchId === 'sf1' || matchId === 'sf2') {
        const final = cup.bracket.matches.final;
        if (matchId === 'sf1') final.playerIds[0] = winnerSessionId;
        else final.playerIds[1] = winnerSessionId;

        const winner = cupPlayerBySession(cup, winnerSessionId);
        if (winner?.id && winner.online !== false) {
            io.to(winner.id).emit('cupWaiting', {
                cupCode: cup.code,
                message: 'You advanced — waiting for the other semifinal…',
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

        tryStartCupFinal(cup);
        return;
    }

    if (matchId === 'final') {
        cup.status = 'finished';
        cup.championId = winnerSessionId;
        const payload = cupPublicState(cup);
        for (const p of cup.players) {
            if (p?.id && p.online !== false) io.to(p.id).emit('cupFinished', payload);
        }
        emitCupBracket(cup);
    }
}

function removePlayerFromCup(socketId, sessionId = null) {
    const found =
        findCupBySocketId(socketId) ||
        (sessionId ? findCupBySessionId(sessionId) : null);
    if (!found) return null;
    const { code, cup } = found;
    const leaving =
        cup.players.find((p) => p.id === socketId) ||
        (sessionId ? cupPlayerBySession(cup, sessionId) : null);
    const leavingSession = leaving?.sessionId;
    cup.players = cup.players.filter(
        (p) =>
            p.id !== leaving?.id &&
            !(leavingSession && p.sessionId === leavingSession)
    );

    if (cup.players.length === 0) {
        delete cups[code];
        return {
            code,
            dissolved: true,
            wasAdmin: leavingSession && cup.adminId === leavingSession,
        };
    }

    if (leavingSession && cup.adminId === leavingSession) {
        cup.adminId = cup.players[0].sessionId;
    }

    emitCupLobby(cup);
    return { code, dissolved: false, cup };
}

function isSocketBusy(socketId, sessionId = null) {
    if (findCupBySocketId(socketId) || (sessionId && findCupBySessionId(sessionId))) {
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
    const canAddGuess =
        room.status === 'playing' && isSeatTurn(room, key);
    return {
        roomId: code,
        playerName: displayName(key),
        vsAI: !!room.vsAI,
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
    rooms[code] = {
        code,
        vsAI: false,
        playerOne: seatFromSocket(socketA),
        playerTwo: seatFromSocket(socketB),
        status: 'ready',
    };
    clearRematchState(socketA);
    clearRematchState(socketB);
    socketA.emit('rematchStarted', { roomId: code, playerName: 'Player One' });
    socketB.emit('rematchStarted', { roomId: code, playerName: 'Player Two' });
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

    if (!room.vsAI && !isCupMatch) {
        bindRematchPartners(room.playerOne, room.playerTwo);
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

    if (isCupMatch && cupId && cupMatchId && winnerSessionId) {
        advanceCupMatch(cupId, cupMatchId, winnerSessionId);
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
    emitToPlayer(room.playerOne, 'gamestarted', {
        roomId: code,
        turnMsRemaining: turnMsRemainingFor(room.playerOne) ?? TURN_MS,
    });
    emitToPlayer(room.playerTwo, 'gamestarted', {
        roomId: code,
        turnMsRemaining: isAiId(room.playerTwo?.id)
            ? null
            : turnMsRemainingFor(room.playerTwo) ?? TURN_MS,
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

io.on('connection', (socket) => {
    userCounter += 1;
    io.emit('usercount', userCounter);

    // Register handlers first — do not await before this or early client
    // emits (sessionHello / createRoom) are dropped.
    void (async () => {
        socket.data.user = await userFromSocket(socket);
        if (socket.data.user) {
            socket.emit('authed', {
                id: socket.data.user.id,
                display_name: socket.data.user.display_name,
                elo: socket.data.user.elo,
                ai_elo: AI_DEFAULT_ELO,
            });
        }
    })();

    socket.on('createRoom', (msg = {}) => {
        if (!requireSession(socket, msg.sessionId)) return;
        if (
            findRoomBySocketId(socket.id) ||
            findRoomBySessionId(socket.data.sessionId) ||
            findCupBySocketId(socket.id) ||
            findCupBySessionId(socket.data.sessionId)
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

    socket.on('playVsAI', (msg = {}) => {
        if (!requireSession(socket, msg.sessionId)) return;
        if (
            findRoomBySocketId(socket.id) ||
            findRoomBySessionId(socket.data.sessionId) ||
            findCupBySocketId(socket.id) ||
            findCupBySessionId(socket.data.sessionId)
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

    socket.on('joinRoom', (msg = {}) => {
        if (!requireSession(socket, msg.sessionId)) return;
        if (
            findRoomBySocketId(socket.id) ||
            findRoomBySessionId(socket.data.sessionId) ||
            findCupBySocketId(socket.id) ||
            findCupBySessionId(socket.data.sessionId)
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

        socket.emit('roomJoined', {
            roomId: code,
            playerName: 'Player Two',
        });

        emitToPlayer(room.playerOne, 'opponentJoined', {
            roomId: code,
            message: 'Player Two joined — set your secret number',
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

    socket.on('sessionHello', (msg = {}) => {
        const sessionId = bindSession(socket, msg.sessionId);
        if (!sessionId) {
            emitError(socket, 'Missing session id');
            return;
        }

        const cupFound = findCupBySessionId(sessionId);
        if (cupFound) {
            const { cup } = cupFound;
            const player = cupPlayerBySession(cup, sessionId);
            if (player) {
                player.id = socket.id;
                player.online = true;
            }
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

    socket.on('cupCreate', (msg = {}) => {
        if (!requireSession(socket, msg.sessionId)) return;
        if (
            findRoomBySocketId(socket.id) ||
            findRoomBySessionId(socket.data.sessionId) ||
            findCupBySocketId(socket.id) ||
            findCupBySessionId(socket.data.sessionId)
        ) {
            emitError(socket, 'Leave your current game or cup first');
            return;
        }

        const ident = identityFromSocket(socket);
        const code = generateCupCode();
        cups[code] = {
            code,
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

        socket.emit('cupCreated', cupPublicState(cups[code]));
        emitCupLobby(cups[code]);
    });

    socket.on('cupJoin', (msg = {}) => {
        if (!requireSession(socket, msg.sessionId)) return;
        if (
            findRoomBySocketId(socket.id) ||
            findRoomBySessionId(socket.data.sessionId) ||
            findCupBySocketId(socket.id) ||
            findCupBySessionId(socket.data.sessionId)
        ) {
            emitError(socket, 'Leave your current game or cup first');
            return;
        }

        const code = String(msg.code ?? '').trim().toUpperCase();
        if (!code) {
            emitError(socket, 'Enter a cup code');
            return;
        }

        const cup = cups[code];
        if (!cup) {
            emitError(socket, 'Cup not found');
            return;
        }
        if (cup.status !== 'lobby') {
            emitError(socket, 'This cup has already started');
            return;
        }
        if (cup.players.length >= CUP_SIZE) {
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

        cup.players.push({
            id: socket.id,
            sessionId: socket.data.sessionId,
            userId: ident.userId,
            displayName: ident.displayName,
            elo: ident.elo,
            online: true,
        });

        socket.emit('cupJoined', cupPublicState(cup));
        emitCupLobby(cup);
    });

    socket.on('cupLeave', () => {
        const found =
            findCupBySocketId(socket.id) ||
            findCupBySessionId(socket.data.sessionId);
        if (!found) {
            emitError(socket, 'You are not in a cup');
            return;
        }
        if (found.cup.status !== 'lobby') {
            emitError(socket, 'Cannot leave after the cup has started');
            return;
        }
        const player =
            found.cup.players.find((p) => p.id === socket.id) ||
            cupPlayerBySession(found.cup, socket.data.sessionId);
        const result = player
            ? removePlayerFromCup(player.id, player.sessionId)
            : null;
        if (!result) {
            emitError(socket, 'You are not in a cup');
            return;
        }
        socket.emit('cupLeft', { code: result.code });
    });

    socket.on('cupStart', (msg = {}) => {
        if (!requireSession(socket, msg.sessionId)) return;
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
        if (cup.players.length !== CUP_SIZE) {
            emitError(socket, `Need exactly ${CUP_SIZE} players to start`);
            return;
        }

        cup.status = 'running';
        buildCupBracket(cup);
        createCupMatchRoom(cup, 'sf1');
        createCupMatchRoom(cup, 'sf2');

        const payload = cupPublicState(cup);
        for (const p of cup.players) {
            if (p?.id && p.online !== false) io.to(p.id).emit('cupStarted', payload);
        }
        emitCupBracket(cup);
        emitCupLobby(cup);
    });

    socket.on('cupSpectate', (msg = {}) => {
        const found =
            findCupBySocketId(socket.id) ||
            findCupBySessionId(socket.data.sessionId);
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

    socket.on('disconnect', () => {
        userCounter = Math.max(0, userCounter - 1);
        io.emit('usercount', userCounter);

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
