require('dotenv').config();
const fs   = require('fs');
const path = require('path');

// Reset de sessão se solicitado
if (process.env.RESET_SESSION === 'true') {
  const authPath  = process.env.WA_DATA_PATH || '/data/.wwebjs_auth';
  const cachePath = '/data/.wwebjs_cache';
  try {
    if (fs.existsSync(authPath))  fs.rmSync(authPath,  { recursive: true, force: true });
    if (fs.existsSync(cachePath)) fs.rmSync(cachePath, { recursive: true, force: true });
    console.log('[RESET] Sessão apagada.');
  } catch (err) {
    console.error('[RESET] Erro:', err.message);
  }
}

const { init }        = require('./src/db');
const { startServer } = require('./src/server');
const { startBot }    = require('./src/bot');

init()
  .then(() => {
    // Servidor sobe imediato — healthcheck passa
    startServer();

    // Bot inicializa em background — não bloqueia o servidor
    setImmediate(() => {
      try {
        startBot();
      } catch (err) {
        console.error('[BOT] Erro ao iniciar:', err.message);
      }
    });
  })
  .catch(err => {
    console.error('[FATAL] Banco não iniciou:', err.message);
    process.exit(1);
  });
