import express from 'express';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

app.use(express.static(join(__dirname, './frontend')));

const server = createServer(app);
const io = new Server(server);

/** @type {Record<string, {
 *   code: string,
 *   playerOne: { id: string, answer: string|null, history: number[][], ready: boolean } | null,
 *   playerTwo: { id: string, answer: string|null, history: number[][], ready: boolean } | null,
 *   status: 'waiting' | 'ready' | 'playing' | 'finished'
 * }>} */
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

/**
 * Validate a 4-digit secret/guess: digits only, no zero, all unique.
 * @returns {{ ok: true, value: string } | { ok: false, reason: string }}
 */
function validateNumber(input) {
    const value = String(input ?? '').trim();

    if (!/^\d{4}$/.test(value)) {
        return { ok: false, reason: 'Enter exactly 4 digits' };
    }
    if (value.includes('0')) {
        return { ok: false, reason: 'Digits cannot include 0' };
    }
    if (new Set(value).size !== 4) {
        return { ok: false, reason: 'Each digit must be unique' };
    }
    return { ok: true, value };
}

function calculateNumberOrder(guess, answer) {
    const guessStr = String(guess);
    const answerStr = String(answer);
    let numberCorrect = 0;
    let orderCorrect = 0;

    for (let i = 0; i < guessStr.length; i++) {
        const digit = guessStr[i];
        if (answerStr.includes(digit)) {
            numberCorrect++;
            if (answerStr[i] === digit) {
                orderCorrect++;
            }
        }
    }
    return [numberCorrect, orderCorrect];
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

function tryStartGame(code) {
    const room = rooms[code];
    if (!room?.playerOne?.ready || !room?.playerTwo?.ready) return;
    if (room.status === 'playing') return;

    room.status = 'playing';
    const payload = { roomId: code };
    io.to(room.playerOne.id).emit('gamestarted', payload);
    io.to(room.playerTwo.id).emit('gamestarted', payload);
}

function cleanupRoom(code) {
    delete rooms[code];
}

app.get('/', (req, res) => {
    res.sendFile(join(__dirname, '/frontend/index.html'));
});

io.on('connection', (socket) => {
    userCounter += 1;
    io.emit('usercount', userCounter);

    socket.on('createRoom', () => {
        const existing = findRoomBySocketId(socket.id);
        if (existing) {
            emitError(socket, 'You are already in a room');
            return;
        }

        const code = generateRoomCode();
        rooms[code] = {
            code,
            playerOne: {
                id: socket.id,
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

    socket.on('joinRoom', (msg = {}) => {
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

        room.playerTwo = {
            id: socket.id,
            answer: null,
            history: [],
            ready: false,
        };
        room.status = 'ready';

        socket.emit('roomJoined', {
            roomId: code,
            playerName: 'Player Two',
        });

        io.to(room.playerOne.id).emit('opponentJoined', {
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
        if (!room[key]) {
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
        if (other?.id) {
            io.to(other.id).emit('gameresigned', { roomId: code });
        }
        socket.emit('gameresigned', { roomId: code });
        cleanupRoom(code);
    });

    socket.on('guessput', (msg = {}) => {
        const code = String(msg.roomId ?? '').trim().toUpperCase();
        const room = rooms[code];
        if (!room || room.status !== 'playing') {
            emitError(socket, 'Game is not active');
            return;
        }

        const key = playerKeyFromName(msg.playerName);
        if (!key || room[key]?.id !== socket.id) {
            emitError(socket, 'Invalid player');
            return;
        }

        const other = otherKey(key);
        if (!room[other]) {
            emitError(socket, 'Opponent missing');
            return;
        }

        const myHistory = room[key].history;
        const theirHistory = room[other].history;
        if (myHistory.length > theirHistory.length) {
            emitError(socket, 'Wait for your opponent to guess');
            return;
        }

        const validation = validateNumber(msg.guess);
        if (!validation.ok) {
            emitError(socket, validation.reason);
            return;
        }

        const [numberCorrect, orderCorrect] = calculateNumberOrder(
            validation.value,
            room[other].answer
        );

        const guessArray = validation.value.split('').map(Number);
        guessArray.push(numberCorrect, orderCorrect);
        room[key].history = [...myHistory, guessArray];

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
            socket.emit('historyUpdate', historyPayload);
        } else {
            io.to(room.playerOne.id).emit('historyUpdate', historyPayload);
            io.to(room.playerTwo.id).emit('historyUpdate', historyPayload);
        }

        if (numberCorrect === 4 && orderCorrect === 4) {
            room.status = 'finished';
            const winPayload = { roomId: code, winner: key };
            io.to(room.playerOne.id).emit('gamewin', winPayload);
            io.to(room.playerTwo.id).emit('gamewin', winPayload);
            cleanupRoom(code);
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

        if (partner?.id) {
            io.to(partner.id).emit('partnerleft', { roomId: code });
        }
        cleanupRoom(code);
    });
});

server.listen(3000, () => {
    console.log('server running at http://localhost:3000');
});
