// src/state.js
// Estado compartilhado entre bot.js e server.js sem circular dependency

let _qrDataUrl = null;
let _ready = false;

module.exports = {
  setQR(url) { _qrDataUrl = url; },
  clearQR() { _qrDataUrl = null; },
  setReady(v) { _ready = v; },
  getQR() { return _qrDataUrl; },
  isReady() { return _ready; },
};
