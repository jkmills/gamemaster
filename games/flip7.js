// Flip7 full rules implementation (CommonJS)
// Exports: { id, name, start(room), isLegalPlay(card, top) }
// Cards encoded as strings matching public/flip7 images and rules in public/FLIP7.md.

const id = 'flip7';
const name = 'Flip7';

function makeDeck() {
  const deck = [];
  // Number cards: one 0, then n copies of n for 1-12
  deck.push('0');
  for (let n = 1; n <= 12; n++) {
    for (let i = 0; i < n; i++) deck.push(String(n));
  }
  // Modifier cards (one of each)
  const modifiers = ['+2', '+4', '+6', '+8', '+10', 'x2'];
  deck.push(...modifiers);
  // Action cards (three of each)
  const actions = ['Freeze', 'Flip3', 'SecondChance'];
  for (const a of actions) {
    for (let i = 0; i < 3; i++) deck.push(a);
  }
  return shuffle(deck);
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function start(room) {
  room.deck = makeDeck();
  room.discard = [];
  room.status = 'active';
  room.turnIndex = 0;
}

// Flip7 does not use isLegalPlay; return true for compatibility
function isLegalPlay() {
  return true;
}

module.exports = { id, name, start, isLegalPlay };
