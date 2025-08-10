// Uno module (CommonJS) – Phase A parity with docs/UNO.md
// Exports: { id, name, start(room), isLegalPlay(card, top, chosenColor), applyPlay, applyDraw, applyPass }

const id = 'uno';
const name = 'Uno (Classic)';

const COLORS = ['R','Y','G','B'];

function buildDeck() {
  const deck = [];
  // Numbers: per color, one 0, two each of 1-9
  for (const c of COLORS) {
    deck.push(`${c}0`);
    for (let n = 1; n <= 9; n++) { deck.push(`${c}${n}`); deck.push(`${c}${n}`); }
    // Actions per color: Skip(S), Reverse(RV), Draw Two(+2) – two of each
    deck.push(`${c}S`); deck.push(`${c}S`);
    deck.push(`${c}RV`); deck.push(`${c}RV`);
    deck.push(`${c}+2`); deck.push(`${c}+2`);
  }
  // Wilds: 4x W, 4x W+4
  for (let i = 0; i < 4; i++) deck.push('W');
  for (let i = 0; i < 4; i++) deck.push('W+4');
  return shuffle(deck);
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function drawOne(room) {
  if (!room.deck.length) {
    // reshuffle discards except top
    if ((room.discard?.length || 0) > 1) {
      const top = room.discard[0];
      const pool = room.discard.slice(1);
      shuffle(pool);
      room.deck = pool;
      room.discard = [top];
    }
  }
  return room.deck.shift();
}

function start(room) {
  room.deck = buildDeck();
  room.direction = 1; // 1=clockwise, -1=counter-clockwise
  room._unoNotices = []; // transient notices to emit after start
  // Deal 7 to each
  for (const pid of room.order) {
    const p = room.players.get(pid);
    p.hand = [];
    for (let i = 0; i < 7; i++) {
      const card = drawOne(room);
      if (card) p.hand.push(card);
    }
  }
  // Flip first discard and apply if action
  const first = drawOne(room);
  room.discard = [];
  if (first) {
    // If wilds, choose a random color for MVP
    let top = first;
    if (first === 'W') {
      const col = COLORS[Math.floor(Math.random()*COLORS.length)];
      top = `W${col}`; // encode chosen color
    } else if (first === 'W+4') {
      const col = COLORS[Math.floor(Math.random()*COLORS.length)];
      top = `W+4${col}`;
      // apply +4 to next player and skip
      const next = nextPlayerIndex(room);
      forceDraw(room, room.order[next], 4);
      pushNotice(room, room.order[next], `You received +4 from start card`);
      room.turnIndex = nextPlayerIndex(room, 2); // skip next
      room.discard.unshift(top);
      room.status = 'active';
      return;
    } else {
      // Colored actions
      const sym = first.slice(1);
      if (sym === 'S') {
        // skip next
        room.turnIndex = nextPlayerIndex(room, 1);
      } else if (sym === 'RV') {
        if (room.order.length === 2) {
          // Reverse acts like Skip in 2-player
          room.turnIndex = nextPlayerIndex(room, 1);
        } else {
          room.direction = -room.direction;
        }
      } else if (sym === '+2') {
        const next = nextPlayerIndex(room);
        forceDraw(room, room.order[next], 2);
        pushNotice(room, room.order[next], `You received +2 from start card`);
        room.turnIndex = nextPlayerIndex(room, 2);
      }
    }
    room.discard.unshift(top);
  }
  room.status = 'active';
  room.turnIndex = 0;
}

// Legal if matches by color/number/symbol, or Wild; honors chosenColor when card === 'W'
function isLegalPlay(card, top, chosenColor) {
  if (!top) return true;
  if (card === 'W' || card === 'W+4') return true;
  const tIsWild = top[0] === 'W';
  const cColor = card[0];
  const cSym = card.slice(1); // '0'-'9', 'S','RV','+2'
  if (tIsWild) {
    const tChosen = top.replace('W','').replace('+4','')[0]; // e.g., 'WR' or 'W+4R'
    if (!tChosen) return true;
    return cColor === tChosen;
  }
  const tColor = top[0];
  const tSym = top.slice(1);
  return cColor === tColor || cSym === tSym;
}

function applyPlay(room, playerId, cardIndex, payload) {
  const p = room.players.get(playerId);
  if (!p) return { ok: false, error: 'Player not found' };
  if (cardIndex < 0 || cardIndex >= p.hand.length) return { ok: false, error: 'Invalid card index' };
  const raw = p.hand[cardIndex];
  const top = room.discard[0] || null;
  const chosenColor = payload?.chosenColor;
  if (!isLegalPlay(raw, top, chosenColor)) return { ok: false, error: 'Illegal play' };

  // remove from hand
  const card = p.hand.splice(cardIndex, 1)[0];

  let encodedTop = card;
  if (card === 'W') {
    const col = (chosenColor && COLORS.includes(chosenColor)) ? chosenColor : COLORS[Math.floor(Math.random()*COLORS.length)];
    encodedTop = `W${col}`;
  } else if (card === 'W+4') {
    const col = (chosenColor && COLORS.includes(chosenColor)) ? chosenColor : COLORS[Math.floor(Math.random()*COLORS.length)];
    encodedTop = `W+4${col}`;
  }
  room.discard.unshift(encodedTop);

  // apply effects
  let skip = 0;
  const notices = [];
  if (card.endsWith('S')) {
    skip = 1;
  } else if (card.endsWith('RV')) {
    if (room.order.length === 2) skip = 1; else room.direction = -room.direction;
  } else if (card.endsWith('+2')) {
    const next = nextPlayerIndex(room);
    forceDraw(room, room.order[next], 2);
    skip = 1;
    const actor = room.players.get(playerId)?.name || 'Someone';
    notices.push({ playerId: room.order[next], message: `${actor} played +2. You drew 2 cards and are skipped.` });
  } else if (card === 'W+4') {
    const next = nextPlayerIndex(room);
    forceDraw(room, room.order[next], 4);
    skip = 1;
    const actor = room.players.get(playerId)?.name || 'Someone';
    notices.push({ playerId: room.order[next], message: `${actor} played +4. You drew 4 cards and are skipped.` });
  }

  // win check
  if (p.hand.length === 0) {
    room.status = 'finished';
    room.winner = playerId;
    return { ok: true, notices };
  }

  // advance turn
  room.turnIndex = nextPlayerIndex(room, 1 + skip);
  return { ok: true, notices };
}

function applyDraw(room, playerId) {
  const p = room.players.get(playerId);
  if (!p) return { ok: false, error: 'Player not found' };
  const c = drawOne(room);
  if (c) p.hand.push(c);
  return { ok: true };
}

function applyPass(room) {
  room.turnIndex = nextPlayerIndex(room, 1);
  return { ok: true };
}

function nextPlayerIndex(room, steps = 1) {
  const n = room.order.length;
  let idx = room.turnIndex;
  for (let i = 0; i < steps; i++) {
    idx = (idx + (room.direction || 1) + n) % n;
  }
  return idx;
}

function forceDraw(room, playerId, count) {
  const p = room.players.get(playerId);
  if (!p) return;
  for (let i = 0; i < count; i++) {
    const c = drawOne(room);
    if (c) p.hand.push(c);
  }
}

function pushNotice(room, playerId, message) {
  try {
    if (!room._unoNotices) room._unoNotices = [];
    room._unoNotices.push({ playerId, message });
  } catch {}
}

module.exports = { id, name, start, isLegalPlay, applyPlay, applyDraw, applyPass };
