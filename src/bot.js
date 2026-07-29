// src/bot.js
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const db = require('./db');
const state = require('./state');
const fs   = require('fs');
const path = require('path');

const DATA_PATH = process.env.WA_DATA_PATH || '/data/.wwebjs_auth';
const EXEC_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

const GRUPOS_CONFIG = [
  { env: 'GRUPO_NOME',           key: '_grupoId'          },
  { env: 'GRUPO_RETORNO_NOME',   key: '_grupoRetornoId'   },
  { env: 'GRUPO_RELATORIO_NOME', key: '_grupoRelId'       },
  { env: 'GRUPO_CHECKIN_NOME',   key: '_grupoCheckinId'   },
  { env: 'GRUPO_INSP_NOME',      key: '_grupoInspId'      },
  { env: 'GRUPO_AUTOINSP_NOME',  key: '_grupoAutoInspId'  },
  { env: 'GRUPO_INDICADOR_NOME', key: '_grupoIndicadorId' },
  { env: 'GRUPO_CIAO_NOME',      key: '_grupoCiaoId'      },
];

function limparGlobaisGrupo() {
  GRUPOS_CONFIG.forEach(g => { global[g.key] = null; });
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
          try { fs.unlinkSync(fullPath); console.log('[BOT] Lock removido:', fullPath); } catch(e) {}
        }
      }
    } catch(e) {}
  }
  removerLocksEm(DATA_PATH);
}

// Busca grupos via WWebJS sem usar getChats() (que usa page.evaluate e falha)
async function cachearGrupos(client) {
  // Aguarda o Chromium estabilizar
  await new Promise(r => setTimeout(r, 8000));
  
  try {
    // Usa o store interno do whatsapp-web.js diretamente
    const grupos = await client.pupPage.evaluate(() => {
      return WWebJS.getChats().then(chats =>
        chats
          .filter(c => c.isGroup)
          .map(c => ({ id: c.id._serialized, name: c.name }))
      );
    });

    for (const { env, key } of GRUPOS_CONFIG) {
      const nome = process.env[env];
      if (!nome) continue;
      const g = grupos.find(c => c.name === nome);
      if (g) { global[key] = g.id; console.log(`[BOT] ✅ "${nome}" → ${g.id}`); }
      else console.warn(`[BOT] ⚠️ Grupo não encontrado: "${nome}"`);
    }
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
          console.log('[BOT] Pronto! (via 99%) Cacheando grupos...');
          await cachearGrupos(client);
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
