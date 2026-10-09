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
let userCounter = 0;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRoomCode() {
    let code = '';
    for (let i = 0; i < 6; i++) {
        code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    if (rooms[code]) return generateRoomCode();
    return code;
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
    delete rooms[code];
}

async function finishGame(code, winnerKey) {
    const room = rooms[code];
    if (!room || room.status === 'finished') return;
    room.status = 'finished';

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
    };

    const winPayload = {
        roomId: code,
        winner: winnerKey,
        elo: room.vsAI
            ? {
                  playerOneDelta: 0,
                  playerTwoDelta: 0,
                  playerOneElo: room.playerOne?.elo ?? null,
                  playerTwoElo: AI_DEFAULT_ELO,
                  aiElo: AI_DEFAULT_ELO,
              }
            : null,
    };
    emitToPlayer(snapshot.playerOne, 'gamewin', winPayload);
    emitToPlayer(snapshot.playerTwo, 'gamewin', winPayload);
    cleanupRoom(code);

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
    const payload = { roomId: code };
    emitToPlayer(room.playerOne, 'gamestarted', payload);
    emitToPlayer(room.playerTwo, 'gamestarted', payload);

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

    if (room.vsAI && key === 'playerTwo' && room.aiBrain) {
        room.aiBrain.observe(validation.value, numberCorrect, orderCorrect);
    }

    const playerOneHistory = room.playerOne.history;
    const playerTwoHistory = room.playerTwo.history;
    const historiesAreEqual = playerOneHistory.length === playerTwoHistory.length;

    const historyPayload = {
        roomId: code,
        playerOneHistory,
        playerTwoHistory,
        historiesAreEqual,
    };

    if (!historiesAreEqual) {
        emitToPlayer(room[key], 'historyUpdate', historyPayload);
    } else {
        emitToPlayer(room.playerOne, 'historyUpdate', historyPayload);
        emitToPlayer(room.playerTwo, 'historyUpdate', historyPayload);
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
    if (!isDbConfigured()) return true;
    if (socket.data?.user?.id) return true;
    emitError(socket, 'Log in with Telegram to play');
    return false;
}

app.get('/', (req, res) => {
    res.sendFile(join(__dirname, '/frontend/index.html'));
});

io.on('connection', async (socket) => {
    userCounter += 1;
    io.emit('usercount', userCounter);

    socket.data.user = await userFromSocket(socket);
    if (socket.data.user) {
        socket.emit('authed', {
            id: socket.data.user.id,
            display_name: socket.data.user.display_name,
            elo: socket.data.user.elo,
            ai_elo: AI_DEFAULT_ELO,
        });
    }

    socket.on('createRoom', () => {
        if (!requireSocketUser(socket)) return;
        const existing = findRoomBySocketId(socket.id);
        if (existing) {
            emitError(socket, 'You are already in a room');
            return;
        }

        const code = generateRoomCode();
        rooms[code] = {
            code,
            vsAI: false,
            playerOne: {
                id: socket.id,
                userId: socket.data.user.id,
                displayName: socket.data.user.display_name,
                elo: socket.data.user.elo,
                answer: null,
                history: [],
                ready: false,
            },
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

    socket.on('playVsAI', () => {
        if (!requireSocketUser(socket)) return;
        const existing = findRoomBySocketId(socket.id);
        if (existing) {
            emitError(socket, 'You are already in a room');
            return;
        }

        const code = generateRoomCode();
        const aiSecret = randomCode();
        rooms[code] = {
            code,
            vsAI: true,
            aiBrain: createAiBrain(),
            playerOne: {
                id: socket.id,
                userId: socket.data.user.id,
                displayName: socket.data.user.display_name,
                elo: socket.data.user.elo,
                answer: null,
                history: [],
                ready: false,
            },
            playerTwo: {
                id: `AI:${code}`,
                userId: null,
                displayName: 'ATP AI',
                elo: AI_DEFAULT_ELO,
                answer: aiSecret,
                history: [],
                ready: true,
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
        if (!requireSocketUser(socket)) return;
        const existing = findRoomBySocketId(socket.id);
        if (existing) {
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
        if (room.playerOne?.userId && room.playerOne.userId === socket.data.user.id) {
            emitError(socket, 'You are already in this room');
            return;
        }

        room.playerTwo = {
            id: socket.id,
            userId: socket.data.user.id,
            displayName: socket.data.user.display_name,
            elo: socket.data.user.elo,
            answer: null,
            history: [],
            ready: false,
        };
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

    socket.on('resigngame', (msg = {}) => {
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

    socket.on('disconnect', () => {
        userCounter = Math.max(0, userCounter - 1);
        io.emit('usercount', userCounter);

        const found = findRoomBySocketId(socket.id);
        if (!found) return;

        const { code, room } = found;
        const partner =
            room.playerOne?.id === socket.id ? room.playerTwo : room.playerOne;

        emitToPlayer(partner, 'partnerleft', { roomId: code });
        cleanupRoom(code);
    });
});

server.listen(3000, () => {
    console.log('server running at http://localhost:3000');
    console.log(`[ai] engine: ${getAiEngine()}`);
    console.log(`[db] ${isDbConfigured() ? 'Neon connected (DATABASE_URL set)' : 'no DATABASE_URL — auth disabled'}`);
});
