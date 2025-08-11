const COLOR_NAMES = { R: 'Red', Y: 'Yellow', G: 'Green', B: 'Blue' };

function colorName(code) {
  return COLOR_NAMES[code] || code;
}

function formatCard(card) {
  if (!card) return '';
  const colorKey = card[0];
  const body = card.slice(1);
  if (colorKey === 'W') {
    if (card.startsWith('W+4')) return 'Wild Draw 4';
    return 'Wild';
  }
  const color = colorName(colorKey);
  if (body === 'S') return `${color} Skip`;
  if (body === 'RV') return `${color} Reverse`;
  if (body === '+2') return `${color} Draw 2`;
  return `${color} ${body}`;
}

module.exports = { formatCard, colorName };
