// server.js - Custom Next.js server with Socket.IO
const { createServer } = require('http');
const next = require('next');
const { Server } = require('socket.io');
const url = require('url');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

// In-memory store (very simple for MVP)
const rooms = new Map(); // roomCode -> { seed, status, players: Map<playerId, {name, hand: any[]}> , discard: any[], deck: any[] , turnIndex: number, order: string[] }

function findSocketByPlayer(io, roomCode, playerId) {
  const nsp = io.of('/game');
  const roomName = `instance:${roomCode}`;
  const room = nsp.adapter.rooms.get(roomName);
  if (!room) return null;
  for (const id of room) {
    const s = nsp.sockets.get(id);
    if (s && s.data && s.data.playerId === playerId) return s;
  }
  return null;
}

function makeRoom(code, seed) {
  return {
    code,
    seed,
    status: 'lobby',
    players: new Map(),
    discard: [],
    deck: [],
    turnIndex: 0,
    order: [],
  };
}

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    await handle(req, res, parsedUrl);
  });

  const io = new Server(server, {
    path: '/socket.io',
    cors: { origin: true, credentials: true },
  });

  io.of('/game').on('connection', (socket) => {
    // Create a lobby without adding a player
    socket.on('createLobby', ({ roomCode, seed }) => {
      if (!roomCode) {
        socket.emit('error', { message: 'roomCode required' });
        return;
      }
      if (!rooms.has(roomCode)) {
        rooms.set(roomCode, makeRoom(roomCode, seed || String(Date.now())));
      }
      // allow table to watch room updates
      socket.join(`instance:${roomCode}`);
      const room = rooms.get(roomCode);
      io.of('/game').to(`instance:${roomCode}`).emit('roomState', serializeRoom(room));
    });

    // close/delete the room and kick all clients
    socket.on('closeRoom', ({ roomCode }) => {
      const room = rooms.get(roomCode);
      if (!room) return;
      const nsp = io.of('/game');
      const roomName = `instance:${roomCode}`;
      const sockIds = nsp.adapter.rooms.get(roomName);
      // notify clients the room is closed
      nsp.to(roomName).emit('roomClosed', { roomCode });
      // make all sockets leave the room
      if (sockIds) {
        for (const id of sockIds) {
          const s = nsp.sockets.get(id);
          if (s) s.leave(roomName);
        }
      }
      rooms.delete(roomCode);
    });

    // Join room as a non-playing observer (e.g., Table)
    socket.on('watchRoom', ({ roomCode }) => {
      if (!roomCode) return;
      socket.join(`instance:${roomCode}`);
      const room = rooms.get(roomCode);
      if (room) {
        socket.emit('roomState', serializeRoom(room));
      }
    });

    // Join room as a player
    // Expected payload: roomCode, playerId, name
    socket.on('joinRoom', ({ roomCode, playerId, name }) => {
      if (!roomCode || !playerId || !name) {
        socket.emit('error', { message: 'Invalid join payload' });
        return;
      }
      if (!rooms.has(roomCode)) {
        rooms.set(roomCode, makeRoom(roomCode, String(Date.now())));
      }
      const room = rooms.get(roomCode);
      if (!room.players.has(playerId)) {
        room.players.set(playerId, { name, hand: [] });
        room.order.push(playerId);
      }
      // remember identity for convenience
      socket.data.roomCode = roomCode;
      socket.data.playerId = playerId;
      socket.join(`instance:${roomCode}`);
      io.of('/game').to(`instance:${roomCode}`).emit('roomState', serializeRoom(room));
      // send private hand to this player
      const p = room.players.get(playerId);
      socket.emit('playerHand', { hand: p.hand });
    });

    socket.on('startGame', ({ roomCode }) => {
      const room = rooms.get(roomCode);
      if (!room) return;
      if (room.status !== 'lobby') return;
      if (room.order.length < 2) {
        socket.emit('error', { message: 'Need at least 2 players to start' });
        return;
      }
      // Minimal deck for MVP demo
      room.deck = makeDemoDeck();
      // deal 3 cards to each player for MVP
      for (const pid of room.order) {
        const p = room.players.get(pid);
        p.hand = room.deck.splice(0, 3);
      }
      room.discard = [room.deck.shift()];
      room.status = 'active';
      room.turnIndex = 0;
      io.of('/game').to(`instance:${roomCode}`).emit('roomState', serializeRoom(room));
    });

    socket.on('drawCard', ({ roomCode, playerId }) => {
      const room = rooms.get(roomCode);
      if (!room || room.status !== 'active') {
        socket.emit('error', { message: 'Cannot draw: game not active' });
        return;
      }
      const currentPlayer = room.order[room.turnIndex];
      if (currentPlayer !== playerId) {
        socket.emit('error', { message: 'Not your turn' });
        return;
      }
      const p = room.players.get(playerId);
      if (room.deck.length) {
        p.hand.push(room.deck.shift());
      }
      io.of('/game').to(`instance:${roomCode}`).emit('roomState', serializeRoom(room));
      // update private hand
      const target = findSocketByPlayer(io, roomCode, playerId);
      if (target) target.emit('playerHand', { hand: p.hand });
    });

    socket.on('passTurn', ({ roomCode, playerId }) => {
      const room = rooms.get(roomCode);
      if (!room || room.status !== 'active') return;
      const currentPlayer = room.order[room.turnIndex];
      if (currentPlayer !== playerId) return;
      room.turnIndex = (room.turnIndex + 1) % room.order.length;
      io.of('/game').to(`instance:${roomCode}`).emit('roomState', serializeRoom(room));
    });

    socket.on('playCard', ({ roomCode, playerId, cardIndex, chosenColor }) => {
      const room = rooms.get(roomCode);
      if (!room || room.status !== 'active') return;
      const currentPlayer = room.order[room.turnIndex];
      if (currentPlayer !== playerId) return;
      const p = room.players.get(playerId);
      if (cardIndex < 0 || cardIndex >= p.hand.length) return;
      const card = p.hand.splice(cardIndex, 1)[0];
      // Validate play against discard top
      const top = room.discard[0] || null;
      if (!isLegalPlay(card, top, chosenColor)) {
        // put card back in hand at original position and notify error
        p.hand.splice(cardIndex, 0, card);
        socket.emit('error', { message: `Illegal play: ${card} on ${top ?? '∅'}` });
        return;
      }
      // If this is a Wild, encode the chosen color e.g. 'WR'
      const played = card === 'W' && chosenColor ? (`W${chosenColor}`) : card;
      room.discard.unshift(played);
      // advance turn
      room.turnIndex = (room.turnIndex + 1) % room.order.length;
      io.of('/game').to(`instance:${roomCode}`).emit('roomState', serializeRoom(room));
      // update private hand
      const target = findSocketByPlayer(io, roomCode, playerId);
      if (target) target.emit('playerHand', { hand: p.hand });
      // win check
      if (p.hand.length === 0) {
        room.status = 'finished';
        room.winner = playerId;
        io.of('/game').to(`instance:${roomCode}`).emit('roomState', serializeRoom(room));
      }
    });

    // allow client to request current hand on reload
    socket.on('getHand', ({ roomCode, playerId }) => {
      const room = rooms.get(roomCode);
      if (!room) return;
      const p = room.players.get(playerId);
      if (!p) return;
      socket.emit('playerHand', { hand: p.hand });
    });

    // player leaves a room: remove from players/order and adjust turn
    socket.on('leaveRoom', ({ roomCode, playerId }) => {
      const room = rooms.get(roomCode);
      if (!room) return;
      const idx = room.order.indexOf(playerId);
      if (idx !== -1) {
        room.order.splice(idx, 1);
      }
      room.players.delete(playerId);
      // adjust turnIndex if necessary
      if (room.turnIndex >= room.order.length) {
        room.turnIndex = 0;
      }
      // if no players left, delete room entirely
      if (room.order.length === 0) {
        const nsp = io.of('/game');
        const roomName = `instance:${roomCode}`;
        nsp.to(roomName).emit('roomClosed', { roomCode });
        rooms.delete(roomCode);
        return;
      }
      io.of('/game').to(`instance:${roomCode}`).emit('roomState', serializeRoom(room));
      // remove socket from the room
      socket.leave(`instance:${roomCode}`);
    });

    // reset now behaves like close: kick everyone and delete the room
    socket.on('resetRoom', ({ roomCode }) => {
      const room = rooms.get(roomCode);
      if (!room) return;
      const nsp = io.of('/game');
      const roomName = `instance:${roomCode}`;
      const sockIds = nsp.adapter.rooms.get(roomName);
      nsp.to(roomName).emit('roomClosed', { roomCode });
      if (sockIds) {
        for (const id of sockIds) {
          const s = nsp.sockets.get(id);
          if (s) s.leave(roomName);
        }
      }
      rooms.delete(roomCode);
    });
  });

  const port = process.env.PORT || 3000;
  const host = '0.0.0.0';
  server.listen(port, host, () => {
    console.log(`> Ready on http://${host}:${port}`);
  });
});

function serializeRoom(room) {
  return {
    code: room.code,
    status: room.status,
    discardTop: room.discard[0] || null,
    playerCounts: Array.from(room.players.entries()).map(([id, p]) => ({ id, name: p.name, count: p.hand.length })),
    turn: room.order[room.turnIndex] || null,
    winner: room.winner || null,
  };
}

// Card encoding for MVP: `${Color}${Number}` like 'R3', 'G0', etc. Wild is 'W'.
// Wild with chosen color is encoded as 'WR', 'WG', 'WB', 'WY'.
function isLegalPlay(card, top, chosenColor) {
  if (!top) return true; // any card can start
  // If playing a Wild, chosenColor must be valid
  if (card === 'W') {
    if (!['R','G','B','Y'].includes(chosenColor || '')) return false;
    return true;
  }
  // interpret top color/number
  const tIsWild = top && top[0] === 'W';
  const cColor = card[0];
  const cNum = card.slice(1);
  if (tIsWild) {
    const tChosen = top[1]; // may be undefined if plain 'W'
    if (!tChosen) return true; // plain wild allows any card
    return cColor === tChosen;
  }
  const tColor = top[0];
  const tNum = top.slice(1);
  return cColor === tColor || cNum === tNum;
}

function makeDemoDeck() {
  // Minimal deterministic-ish deck for MVP demo
  const colors = ['R', 'G', 'B', 'Y'];
  const deck = [];
  for (const c of colors) {
    for (let n = 0; n < 5; n++) deck.push(`${c}${n}`);
  }
  // Add a few wilds
  for (let i = 0; i < 4; i++) deck.push('W');
  return shuffle(deck);
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
