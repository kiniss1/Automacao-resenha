// src/bot.js
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { parseOS } = require('./parser');
const db = require('./db');
const state = require('./state');

const GRUPO_NOME = process.env.GRUPO_NOME || 'Resenha';
const DATA_PATH  = process.env.WA_DATA_PATH || '/data/.wwebjs_auth';
const EXEC_PATH  = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

async function processarMensagem(msg) {
  try {
    const chat = await msg.getChat();
    console.log(`[MSG] Chat: "${chat.name}" | isGroup: ${chat.isGroup}`);
    if (!chat.isGroup || chat.name !== GRUPO_NOME) return;
    if (msg.fromMe && msg.body.startsWith('✅')) return;

    const ordens = parseOS(msg.body);
    if (!ordens) { console.log('[PARSER] Nenhuma OS detectada.'); return; }

    const registradas = [];
    for (const os of ordens) {
      db.inserirOS(os);
      registradas.push(`• ${os.unidade} — ${os.servico.substring(0, 50)}`);
      console.log(`[BOT] ✅ Registrada: ${os.os} | ${os.unidade} | ${os.status}`);
    }

    await msg.reply(`✅ *${registradas.length} OS(s) registrada(s):*\n${registradas.join('\n')}`);
  } catch (err) {
    console.error('[BOT] Erro:', err.message);
  }
}

function startBot() {
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: DATA_PATH }),
    puppeteer: {
      executablePath: EXEC_PATH,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--disable-extensions',
      ],
      headless: true,
    },
  });

  let readyTimer = null;

  client.on('qr', async (qr) => {
    try {
      state.setQR(await qrcode.toDataURL(qr));
      console.log('[BOT] QR gerado → acesse /qr no painel para escanear.');
    } catch (err) {
      console.error('[BOT] Erro ao gerar QR:', err.message);
    }
  });

  client.on('authenticated', () => console.log('[BOT] Autenticado com sucesso.'));

  client.on('loading_screen', (percent, message) => {
    console.log(`[BOT] Carregando... ${percent}% — ${message}`);
    if (percent >= 99 && !state.isReady()) {
      clearTimeout(readyTimer);
      readyTimer = setTimeout(() => {
        if (!state.isReady()) {
          state.setReady(true);
          state.clearQR();
          console.log(`[BOT] Pronto! (via 99%) Monitorando grupo "${GRUPO_NOME}".`);
        }
      }, 5000);
    }
  });

  client.on('ready', () => {
    clearTimeout(readyTimer);
    state.setReady(true);
    state.clearQR();
    console.log(`[BOT] Pronto! Monitorando grupo "${GRUPO_NOME}".`);
  });

  client.on('auth_failure', (msg) => { console.error('[BOT] Falha de autenticação:', msg); state.setReady(false); });
  client.on('disconnected', (reason) => { state.setReady(false); console.warn('[BOT] Desconectado:', reason); });
  client.on('message', processarMensagem);
  client.on('message_create', (msg) => { if (msg.fromMe) processarMensagem(msg); });

  client.initialize();
}

module.exports = { startBot };
