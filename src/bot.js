// src/bot.js
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const db = require('./db');
const state = require('./state');
const fs   = require('fs');
const path = require('path');

const GRUPO_NOME          = process.env.GRUPO_NOME           || 'Resenha';
const GRUPO_RETORNO_NOME  = process.env.GRUPO_RETORNO_NOME   || GRUPO_NOME;
const GRUPO_RELATORIO_NOME= process.env.GRUPO_RELATORIO_NOME || GRUPO_NOME;
const GRUPO_CHECKIN_NOME  = process.env.GRUPO_CHECKIN_NOME   || GRUPO_NOME;
const GRUPO_INSP_NOME     = process.env.GRUPO_INSP_NOME      || GRUPO_NOME;
const GRUPO_AUTOINSP_NOME = process.env.GRUPO_AUTOINSP_NOME  || GRUPO_RELATORIO_NOME;
const GRUPO_INDICADOR_NOME= process.env.GRUPO_INDICADOR_NOME || GRUPO_NOME;
const GRUPO_CIAO_NOME     = process.env.GRUPO_CIAO_NOME      || GRUPO_NOME;

const DATA_PATH = process.env.WA_DATA_PATH || '/data/.wwebjs_auth';
const EXEC_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

function limparGlobaisGrupo() {
  global._grupoId          = null;
  global._grupoRetornoId   = null;
  global._grupoRelId       = null;
  global._grupoCheckinId   = null;
  global._grupoInspId      = null;
  global._grupoAutoInspId  = null;
  global._grupoIndicadorId = null;
  global._grupoCiaoId      = null;
}

function limparLockChromium() {
  const lockNames = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];
  function removerLocksEm(dir) {
    try {
      if (!fs.existsSync(dir)) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) removerLocksEm(fullPath);
        else if (lockNames.includes(entry.name)) {
          try { fs.unlinkSync(fullPath); console.log('[BOT] Lock removido:', fullPath); }
          catch(e) {}
        }
      }
    } catch(e) {}
  }
  removerLocksEm(DATA_PATH);
}

// Pre-cacheia IDs de todos os grupos configurados
async function cachearGrupos(client) {
  try {
    await new Promise(r => setTimeout(r, 3000)); // aguarda estabilização
    const chats = await client.getChats();
    const grupos = chats.filter(c => c.isGroup);

    const mapear = (nome, globalKey) => {
      const g = grupos.find(c => c.name === nome);
      if (g) { global[globalKey] = g.id._serialized; console.log(`[BOT] ✅ Grupo cacheado: "${nome}"`); }
      else console.warn(`[BOT] ⚠️ Grupo não encontrado: "${nome}"`);
    };

    mapear(GRUPO_NOME,           '_grupoId');
    mapear(GRUPO_RETORNO_NOME,   '_grupoRetornoId');
    mapear(GRUPO_RELATORIO_NOME, '_grupoRelId');
    mapear(GRUPO_CHECKIN_NOME,   '_grupoCheckinId');
    mapear(GRUPO_INSP_NOME,      '_grupoInspId');
    mapear(GRUPO_AUTOINSP_NOME,  '_grupoAutoInspId');
    mapear(GRUPO_INDICADOR_NOME, '_grupoIndicadorId');
    mapear(GRUPO_CIAO_NOME,      '_grupoCiaoId');
  } catch(e) {
    console.error('[BOT] Erro ao cachear grupos:', e.message);
  }
}

function startBot() {
  limparLockChromium();

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: DATA_PATH }),
    puppeteer: {
      executablePath: EXEC_PATH,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', '--disable-gpu',
        '--no-first-run', '--no-zygote', '--disable-extensions',
      ],
      headless: true,
    },
  });

  let readyTimer = null;

  client.on('qr', async (qr) => {
    try {
      state.setQR(await qrcode.toDataURL(qr));
      console.log('[BOT] QR gerado → acesse /qr no painel para escanear.');
    } catch(err) {
      console.error('[BOT] Erro ao gerar QR:', err.message);
    }
  });

  client.on('authenticated', () => console.log('[BOT] Autenticado com sucesso.'));

  client.on('loading_screen', (percent, message) => {
    console.log(`[BOT] Carregando... ${percent}% — ${message}`);
    if (percent >= 99 && !state.isReady()) {
      clearTimeout(readyTimer);
      readyTimer = setTimeout(async () => {
        if (!state.isReady()) {
          state.setReady(true);
          state.clearQR();
          global._waClient = client;
          console.log(`[BOT] Pronto! (via 99%) Cacheando grupos...`);
          await cachearGrupos(client);
          console.log(`[BOT] Grupos cacheados.`);
        }
      }, 5000);
    }
  });

  client.on('ready', async () => {
    clearTimeout(readyTimer);
    state.setReady(true);
    state.clearQR();
    global._waClient = client;
    console.log('[BOT] Pronto! Cacheando grupos...');
    await cachearGrupos(client);
    console.log('[BOT] Grupos cacheados.');
  });

  client.on('auth_failure', (msg) => {
    console.error('[BOT] Falha de autenticação:', msg);
    state.setReady(false);
  });

  client.on('disconnected', (reason) => {
    state.setReady(false);
    global._waClient = null;
    limparGlobaisGrupo();
    console.warn('[BOT] Desconectado:', reason);
    setTimeout(() => {
      limparLockChromium();
      console.log('[BOT] Tentando reconectar...');
      client.initialize().catch(err => console.error('[BOT] Erro ao reconectar:', err.message));
    }, 10000);
  });

  client.initialize();
}

module.exports = { startBot };
