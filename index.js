require('dotenv').config();
const fs   = require('fs');
const path = require('path');

// Se RESET_SESSION=true, apaga a sessão antes de iniciar
if (process.env.RESET_SESSION === 'true') {
  const authPath  = process.env.WA_DATA_PATH || '/data/.wwebjs_auth';
  const cachePath = '/data/.wwebjs_cache';
  try {
    if (fs.existsSync(authPath))  fs.rmSync(authPath,  { recursive: true, force: true });
    if (fs.existsSync(cachePath)) fs.rmSync(cachePath, { recursive: true, force: true });
    console.log('[RESET] Sessão WhatsApp apagada. Remova RESET_SESSION após escanear o QR.');
  } catch (err) {
    console.error('[RESET] Erro ao apagar sessão:', err.message);
  }
}

const { init }        = require('./src/db');
const { startServer } = require('./src/server');
const { startBot }    = require('./src/bot');

init()
  .then(() => {
    startServer();
    startBot();
  })
  .catch(err => {
    console.error('[FATAL] Banco não iniciou:', err.message);
    process.exit(1);
  });
