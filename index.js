require('dotenv').config();

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