// Flip7 minimal stub rules for MVP (CommonJS)
// Exports: { id, name, start(room), isLegalPlay(card, top) }
// Cards encoded as `${Color}${Number}` like 'R3'. No wilds. Numbers 1-7.

const id = 'flip7';
const name = 'Flip7 (MVP Stub)';

function makeDeck() {
  const colors = ['R', 'G', 'B', 'Y'];
  const deck = [];
  for (const c of colors) {
    for (let n = 1; n <= 7; n++) deck.push(`${c}${n}`);
  }
  // simple shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function start(room) {
  room.deck = makeDeck();
  // deal 3 cards to each player for MVP
  for (const pid of room.order) {
    const p = room.players.get(pid);
    p.hand = room.deck.splice(0, 3);
  }
  room.discard = [room.deck.shift()];
  room.status = 'active';
  room.turnIndex = 0;
}

// Legal if top is empty, or same number as top, or exactly '7' (acts as a wildcard number)
function isLegalPlay(card, top) {
  if (!top) return true;
  const cNum = card.slice(1);
  const tNum = top.slice(1);
  if (cNum === '7') return true;
  return cNum === tNum;
}

module.exports = { id, name, start, isLegalPlay };
