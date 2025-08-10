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

    socket.on('playCard', ({ roomCode, playerId, cardIndex }) => {
      const room = rooms.get(roomCode);
      if (!room || room.status !== 'active') return;
      const currentPlayer = room.order[room.turnIndex];
      if (currentPlayer !== playerId) return;
      const p = room.players.get(playerId);
      if (cardIndex < 0 || cardIndex >= p.hand.length) return;
      const card = p.hand.splice(cardIndex, 1)[0];
      // Validate play against discard top
      const top = room.discard[0] || null;
      if (!isLegalPlay(card, top)) {
        // put card back in hand at original position and notify error
        p.hand.splice(cardIndex, 0, card);
        socket.emit('error', { message: `Illegal play: ${card} on ${top ?? '∅'}` });
        return;
      }
      room.discard.unshift(card);
      // advance turn
      room.turnIndex = (room.turnIndex + 1) % room.order.length;
      io.of('/game').to(`instance:${roomCode}`).emit('roomState', serializeRoom(room));
      // update private hand
      const target = findSocketByPlayer(io, roomCode, playerId);
      if (target) target.emit('playerHand', { hand: p.hand });
    });

    // allow client to request current hand on reload
    socket.on('getHand', ({ roomCode, playerId }) => {
      const room = rooms.get(roomCode);
      if (!room) return;
      const p = room.players.get(playerId);
      if (!p) return;
      socket.emit('playerHand', { hand: p.hand });
    });

    // reset/cancel the game but keep players
    socket.on('resetRoom', ({ roomCode }) => {
      const room = rooms.get(roomCode);
      if (!room) return;
      // reset state to lobby, keep players/order
      room.status = 'lobby';
      room.discard = [];
      room.deck = [];
      room.turnIndex = 0;
      for (const pid of room.order) {
        const p = room.players.get(pid);
        if (p) p.hand = [];
      }
      io.of('/game').to(`instance:${roomCode}`).emit('roomState', serializeRoom(room));
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
  };
}

// Card encoding for MVP: `${Color}${Number}` like 'R3', 'G0', etc. Wild is 'W'
function isLegalPlay(card, top) {
  if (!top) return true; // any card can start
  if (card === 'W') return true; // wild always legal
  if (top === 'W') return true; // any card can follow wild
  const cColor = card[0];
  const tColor = top[0];
  const cNum = card.slice(1);
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
