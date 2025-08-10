// Simple games registry for the MVP server (CommonJS)
// Each game module should export: { id, name, start(room), isLegalPlay(card, top, chosenColor) }

const uno = require('./uno');
const flip7 = require('./flip7');

/** @type {Record<string, any>} */
const games = {
  [uno.id]: uno,
  [flip7.id]: flip7,
};

const defaultGameId = uno.id;

module.exports = {
  games,
  defaultGameId,
};
