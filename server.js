// server.js - Custom Next.js server with Socket.IO
const { createServer } = require('http');
const next = require('next');
const { Server } = require('socket.io');
const url = require('url');
const { games, defaultGameId } = require('./games');

const dev = process.env.NODE_ENV !== 'production';
const app = next({ dev });
const handle = app.getRequestHandler();

// In-memory store (very simple for MVP)
const rooms = new Map(); // roomCode -> { seed, status, players: Map<playerId, {name, hand: any[]}> , discard: any[], deck: any[] , turnIndex: number, order: string[] }

function trimLog(room) {
  try {
    if (!Array.isArray(room.log)) return;
    const MAX = 50;
    if (room.log.length > MAX) room.log = room.log.slice(-MAX);
  } catch {}
}

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

function makeRoom(code, seed, gameId) {
  return {
    code,
    seed,
    gameId: gameId || defaultGameId,
    status: 'lobby',
    players: new Map(),
    discard: [],
    deck: [],
    turnIndex: 0,
    order: [],
    log: [], // gameplay log (temporary, recent entries only)
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
    socket.on('createLobby', ({ roomCode, seed, gameId }) => {
      if (!roomCode) {
        socket.emit('error', { message: 'roomCode required' });
        return;
      }
      if (!rooms.has(roomCode)) {
        const gid = games[gameId] ? gameId : defaultGameId;
        rooms.set(roomCode, makeRoom(roomCode, seed || String(Date.now()), gid));
      }
      // allow table to watch room updates
      socket.join(`instance:${roomCode}`);
      const room = rooms.get(roomCode);
      io.of('/game').to(`instance:${roomCode}`).emit('roomState', serializeRoom(room));
    });

    // ==== Flip7 Phase 1: Hit / Stay, bust on duplicate number, 7-unique ends round ====
    socket.on('flip7:hit', ({ roomCode, playerId }) => {
      const room = rooms.get(roomCode);
      if (!room || room.status !== 'active' || room.gameId !== 'flip7') return;
      if (room.order[room.turnIndex] !== playerId) return;
      const f = room.flip7;
      if (!f || f.roundOver) return;
      if (f.stayed.has(playerId) || f.busted.has(playerId)) return;
      // draw top card
      if (!room.deck.length) return; // no reshuffle in Phase 1
      const card = room.deck.shift();
      // parse number component
      const num = card.slice(1); // e.g., 'R3' -> '3'
      const isNumber = /^\d+$/.test(num);
      if (!isNumber) {
        // For Phase 1, ignore non-number cards (not present in stub deck)
      } else {
        const set = f.uniques.get(playerId) || new Set();
        if (set.has(num)) {
          // bust
          f.busted.add(playerId);
        } else {
          set.add(num);
          f.uniques.set(playerId, set);
          const curr = f.roundScore.get(playerId) || 0;
          f.roundScore.set(playerId, curr + parseInt(num, 10));
          // 7 uniques ends round with +15 bonus
          if (set.size >= 7) {
            f.roundOver = true;
          }
        }
      }
      // advance turn to next non-stayed/non-busted player
      advanceFlip7Turn(room);
      // if round end conditions met, score and maybe finish game
      maybeFinishFlip7Round(io, room);
      io.of('/game').to(`instance:${roomCode}`).emit('roomState', serializeRoom(room));
    });

    socket.on('flip7:stay', ({ roomCode, playerId }) => {
      const room = rooms.get(roomCode);
      if (!room || room.status !== 'active' || room.gameId !== 'flip7') return;
      if (room.order[room.turnIndex] !== playerId) return;
      const f = room.flip7;
      if (!f || f.roundOver) return;
      f.stayed.add(playerId);
      advanceFlip7Turn(room);
      maybeFinishFlip7Round(io, room);
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
        rooms.set(roomCode, makeRoom(roomCode, String(Date.now()), defaultGameId));
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
      const game = games[room.gameId] || {};
      if (typeof game.start === 'function') {
        game.start(room);
      } else {
        // fallback to built-in demo
        room.deck = makeDemoDeck();
        for (const pid of room.order) {
          const p = room.players.get(pid);
          p.hand = room.deck.splice(0, 3);
        }
        room.discard = [room.deck.shift()];
        room.status = 'active';
        room.turnIndex = 0;
      }
      // Initialize log
      if (!Array.isArray(room.log)) room.log = [];
      // Emit any Uno notices generated during start (e.g., start-card +2/+4)
      if (room._unoNotices && Array.isArray(room._unoNotices)) {
        for (const n of room._unoNotices) {
          const target = findSocketByPlayer(io, roomCode, n.playerId);
          if (target && n.message) target.emit('notice', { message: n.message });
        }
        room._unoNotices = [];
      }
      // Append any Uno start logs
      if (room._unoLog && Array.isArray(room._unoLog)) {
        room.log.push(...room._unoLog);
        room._unoLog = [];
        trimLog(room);
      }
      // Flip7 per-round state (Phase 1 core) – only when selected
      if (room.gameId === 'flip7') {
        room.flip7 = room.flip7 || {};
        room.flip7.uniques = new Map(); // pid -> Set of numbers as strings
        room.flip7.stayed = new Set();
        room.flip7.busted = new Set();
        room.flip7.roundScore = new Map(); // pid -> number
        room.flip7.roundOver = false;
        // cumulative scores across rounds
        room.flip7.scores = room.flip7.scores || new Map();
        // initialize for any missing players this round
        for (const pid of room.order) {
          if (!room.flip7.scores.has(pid)) room.flip7.scores.set(pid, 0);
          room.flip7.uniques.set(pid, new Set());
          room.flip7.roundScore.set(pid, 0);
        }
      }
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
      const game = games[room.gameId] || {};
      if (typeof game.applyDraw === 'function') {
        const res = game.applyDraw(room, playerId);
        if (!res?.ok) {
          socket.emit('error', { message: res?.error || 'Draw failed' });
          return;
        }
      } else {
        const p = room.players.get(playerId);
        if (room.deck.length) {
          p.hand.push(room.deck.shift());
        }
      }
      io.of('/game').to(`instance:${roomCode}`).emit('roomState', serializeRoom(room));
      // update private hand
      const target = findSocketByPlayer(io, roomCode, playerId);
      const priv = room.players.get(playerId);
      if (target && priv) target.emit('playerHand', { hand: priv.hand });
    });

    socket.on('passTurn', ({ roomCode, playerId }) => {
      const room = rooms.get(roomCode);
      if (!room || room.status !== 'active') return;
      const currentPlayer = room.order[room.turnIndex];
      if (currentPlayer !== playerId) return;
      const game = games[room.gameId] || {};
      if (typeof game.applyPass === 'function') {
        const res = game.applyPass(room, playerId);
        if (!res?.ok) return;
      } else {
        room.turnIndex = (room.turnIndex + 1) % room.order.length;
      }
      io.of('/game').to(`instance:${roomCode}`).emit('roomState', serializeRoom(room));
    });

    socket.on('playCard', ({ roomCode, playerId, cardIndex, chosenColor }) => {
      const room = rooms.get(roomCode);
      if (!room || room.status !== 'active') return;
      if (room.gameId === 'flip7') return; // Flip7 does not use playCard
      const currentPlayer = room.order[room.turnIndex];
      if (currentPlayer !== playerId) return;
      const p = room.players.get(playerId);
      const game = games[room.gameId] || {};
      if (typeof game.applyPlay === 'function') {
        const res = game.applyPlay(room, playerId, cardIndex, { chosenColor });
        if (!res?.ok) {
          socket.emit('error', { message: res?.error || 'Illegal play' });
          return;
        }
        // forward any per-player notices (e.g., +2/+4 effects)
        if (Array.isArray(res.notices)) {
          for (const n of res.notices) {
            const target = findSocketByPlayer(io, roomCode, n.playerId);
            if (target && n.message) target.emit('notice', { message: n.message });
          }
        }
        // append log entries
        const logs = Array.isArray(res.log) ? res.log : (res.logEntry ? [res.logEntry] : []);
        if (logs.length) {
          if (!Array.isArray(room.log)) room.log = [];
          room.log.push(...logs);
          trimLog(room);
        }
      } else {
        if (cardIndex < 0 || cardIndex >= p.hand.length) return;
        const card = p.hand.splice(cardIndex, 1)[0];
        // Validate play against discard top
        const top = room.discard[0] || null;
        const legal = typeof game.isLegalPlay === 'function' ? game.isLegalPlay(card, top, chosenColor) : isLegalPlay(card, top, chosenColor);
        if (!legal) {
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
      }
      io.of('/game').to(`instance:${roomCode}`).emit('roomState', serializeRoom(room));
      // update private hand
      const target = findSocketByPlayer(io, roomCode, playerId);
      if (target) target.emit('playerHand', { hand: room.players.get(playerId)?.hand || [] });
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
    gameId: room.gameId,
    status: room.status,
    discardTop: room.discard[0] || null,
    playerCounts: Array.from(room.players.entries()).map(([id, p]) => ({ id, name: p.name, count: p.hand.length })),
    turn: room.order[room.turnIndex] || null,
    winner: room.winner || null,
    log: Array.isArray(room.log) ? room.log.slice(-20) : [],
    flip7: room.gameId === 'flip7' && room.flip7 ? serializeFlip7(room) : undefined,
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

function serializeFlip7(room) {
  const f = room.flip7;
  const scores = Array.from(f.scores.entries()).map(([id, score]) => ({ id, name: room.players.get(id)?.name || id, score }));
  const roundScore = Array.from(f.roundScore.entries()).map(([id, score]) => ({ id, name: room.players.get(id)?.name || id, score }));
  const stayed = Array.from(f.stayed.values());
  const busted = Array.from(f.busted.values());
  const uniquesCount = Array.from(f.uniques.entries()).map(([id, set]) => ({ id, name: room.players.get(id)?.name || id, count: set.size }));
  return { scores, roundScore, stayed, busted, uniquesCount, roundOver: !!f.roundOver };
}

function advanceFlip7Turn(room) {
  const f = room.flip7;
  if (!f) return;
  // find next player who is neither stayed nor busted
  const n = room.order.length;
  for (let step = 1; step <= n; step++) {
    const idx = (room.turnIndex + step) % n;
    const pid = room.order[idx];
    if (!f.stayed.has(pid) && !f.busted.has(pid)) {
      room.turnIndex = idx;
      return;
    }
  }
  // no eligible players -> round over
  f.roundOver = true;
}

function maybeFinishFlip7Round(io, room) {
  const f = room.flip7;
  if (!f) return;
  const allDone = room.order.every(pid => f.stayed.has(pid) || f.busted.has(pid));
  if (!f.roundOver && !allDone) return;
  // finalize round: apply +15 bonus to any player with 7 uniques
  for (const [pid, set] of f.uniques.entries()) {
    if (set.size >= 7) {
      f.roundScore.set(pid, (f.roundScore.get(pid) || 0) + 15);
    }
  }
  // accumulate to total scores
  for (const [pid, score] of f.roundScore.entries()) {
    f.scores.set(pid, (f.scores.get(pid) || 0) + (score || 0));
  }
  // check win condition 200+
  let winner = null;
  let best = -Infinity;
  for (const [pid, total] of f.scores.entries()) {
    if (total >= 200 && total > best) {
      best = total;
      winner = pid;
    }
  }
  if (winner) {
    room.status = 'finished';
    room.winner = winner;
    return;
  }
  // start next round: rebuild deck and reset per-round
  const game = require('./games').games[room.gameId];
  if (game && typeof game.start === 'function') {
    game.start(room);
  } else {
    // fallback deck reset
    room.deck = makeDemoDeck();
    room.discard = [room.deck.shift()];
    room.status = 'active';
    room.turnIndex = 0;
  }
  // reset per-round structures
  f.uniques = new Map();
  f.stayed = new Set();
  f.busted = new Set();
  f.roundScore = new Map();
  f.roundOver = false;
  for (const pid of room.order) {
    f.uniques.set(pid, new Set());
    f.roundScore.set(pid, 0);
  }
}
