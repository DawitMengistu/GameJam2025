import express from 'express';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { Server } from 'socket.io';
import { fileURLToPath } from 'node:url';
import { v4 as uuidv4 } from 'uuid';



const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
app.use(express.static(join(__dirname, "./frontend")));



const server = createServer(app);
const io = new Server(server);

const playerHistory = [];
let currentRoom = getRandomId();

const rooms = {
    // 123456: {
    //     "playerOne": {
    //         "id": "abcd",
    //         "answer": 1234,
    //         "history": [
    //             [1234, 2, 5],
    //         ]
    //     },
    //     "playerTwo": {
    //         "id": "abcd",
    //         "answer": 1234,
    //         "history": [
    //             [1234, 2, 5],
    //         ]
    //     }
    // },
}




app.get('/', (req, res) => {
    res.sendFile(join(__dirname, '/frontend/index.html'));
});

io.on('connection', (socket) => {
    // here handle refresh for later
    console.log('a user connected');

    socket.on('joingame', (msg) => {
        console.log('message: ' + msg);
        const response = initializeNewGameRoom(socket.id, msg.answer, socket)
        socket.emit("gamejoined", response);
        if (response.playerName === "Player Two") {
            setTimeout(() => {
                // socket.emit("gamestarted", response);
                io.to(rooms[response.roomId].playerOne.id).emit("gamestarted", response);
                io.to(rooms[response.roomId].playerTwo.id).emit("gamestarted", response);
            }, 1000);
        }


    });


    socket.on('resigngame', (msg) => {
        if (rooms[msg.roomId]) {
            console.log("This user want to resign!", msg)
            console.log("msg.playerName", msg.playerName)
            if (msg.playerName == "Player One") {
                console.log("I'm sending it to player two", rooms[msg.roomId].playerTwo.id)
                io.to(rooms[msg.roomId].playerTwo.id).emit("gameresigned", "response");
            } else {
                console.log("I'm sending it to player one which is this id", rooms[msg.roomId].playerOne.id)
                io.to(rooms[msg.roomId].playerOne.id).emit("gameresigned", "");
            }

            delete rooms[msg];
            console.log(rooms, "<-- resigned");
        } else {
            console.log("You can't resign")
        }
    });




    socket.on('disconnect', () => {
        console.log('User with ID ' + socket.id + ' disconnected');


        for (let roomKey in rooms) {
            const room = rooms[roomKey];
            const playerIdToDelete = socket.id;

            if (room.playerOne && room.playerOne.id === playerIdToDelete) {
                if (room.playerTwo) {
                    io.to(room.playerTwo.id).emit("partnerleft", "reset");
                }
                delete rooms[roomKey];
                break
            }

            if (room.playerTwo && room.playerTwo.id === playerIdToDelete) {
                if (room.playerOne) {
                    io.to(room.playerOne.id).emit("partnerleft", "reset");
                }
                delete rooms[roomKey];
                break
            }
        }




    });


    socket.on('guessput', (msg) => {
        let { roomId, playerName, guess } = msg;
        if (playerName === "Player One") playerName = "playerOne"
        if (playerName === "Player Two") playerName = "playerTwo"

        if (rooms[roomId] && rooms[roomId][playerName]) {
            // Convert inputValue to an array of numbers and add it to the history
            const guessArray = guess.toString().split('').map(Number);
            guessArray.push(1, 2)
            rooms[roomId][playerName].history = [...rooms[roomId][playerName].history, guessArray];


            console.log(`Updated history for ${playerName} in room ${roomId}:`, rooms[roomId][playerName].history);

            // Check if playerOne and playerTwo history are equal
            const playerOneHistory = rooms[roomId].playerOne.history;
            const playerTwoHistory = rooms[roomId].playerTwo.history;

            const historiesAreEqual = playerOneHistory.length === playerTwoHistory.length;

            console.log(`Player histories are ${historiesAreEqual ? "equal" : "not equal"}`);

            if (!historiesAreEqual)
                socket.emit('historyUpdate', { roomId, playerOneHistory, playerTwoHistory, historiesAreEqual });
            else {
                io.to(rooms[roomId].playerTwo.id).emit("historyUpdate", { roomId, playerOneHistory, playerTwoHistory, historiesAreEqual });
                io.to(rooms[roomId].playerOne.id).emit("historyUpdate", { roomId, playerOneHistory, playerTwoHistory, historiesAreEqual });
            }

        } else {
            console.log(`Invalid roomId or playerName: roomId=${roomId}, playerName=${playerName}`);
        }
    });


});


function getRandomId() {
    return uuidv4().split('-').join('').slice(0, 16);
}

function initializeNewGameRoom(id, answer) {
    const roomId = currentRoom;
    let playerName = "Player One"
    if (!rooms[currentRoom]) {
        rooms[currentRoom] = {
            playerOne: {
                "id": id,
                "answer": answer,
                "history": []
            },
        };
    } else if (!rooms[currentRoom].playerTwo) {
        rooms[currentRoom].playerTwo = {
            "id": id,
            "answer": answer,
            "history": []
        };
        playerName = "Player Two"
        currentRoom = getRandomId();
    }
    console.log(rooms)
    return { roomId: roomId, playerName: playerName };



}


server.listen(3000, () => {
    console.log('server running at http://localhost:3000');
});
