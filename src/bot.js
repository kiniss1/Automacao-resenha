// src/bot.js
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
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

function carregarIdsFixos() {
  // Suporte a IDs fixos via env: GRUPO_RELATORIO_ID=120363xxx@g.us
  const ID_MAP = [
    { env: 'GRUPO_NOME_ID',      key: '_grupoId'          },
    { env: 'GRUPO_RETORNO_ID',   key: '_grupoRetornoId'   },
    { env: 'GRUPO_RELATORIO_ID', key: '_grupoRelId'       },
    { env: 'GRUPO_CHECKIN_ID',   key: '_grupoCheckinId'   },
    { env: 'GRUPO_INSP_ID',      key: '_grupoInspId'      },
    { env: 'GRUPO_AUTOINSP_ID',  key: '_grupoAutoInspId'  },
    { env: 'GRUPO_INDICADOR_ID', key: '_grupoIndicadorId' },
    { env: 'GRUPO_CIAO_ID',      key: '_grupoCiaoId'      },
  ];
  for (const { env, key } of ID_MAP) {
    const id = process.env[env];
    if (id) { global[key] = id; console.log(`[BOT] ID fixo: ${key} = ${id}`); }
  }
}

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

// Tenta cachear usando o evento 'message' — quando uma mensagem chega de um grupo,
// captura o ID automaticamente
function configurarAutoCacheViaMessage(client) {
  client.on('message', async (msg) => {
    try {
      if (!msg.from.includes('@g.us')) return; // só grupos
      const chat = await msg.getChat();
      if (!chat.isGroup) return;

      const id = chat.id._serialized;
      const nome = chat.name;

      for (const { env, key } of GRUPOS_CONFIG) {
        const nomeConfig = process.env[env];
        if (nomeConfig && nomeConfig === nome && !global[key]) {
          global[key] = id;
          console.log(`[BOT] ✅ Auto-cacheado via mensagem: "${nome}" → ${id}`);
        }
      }
    } catch(e) {}
  });
}

function startBot() {
  limparLockChromium();
  carregarIdsFixos();

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
    } catch(err) { console.error('[BOT] Erro ao gerar QR:', err.message); }
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
          global._waClient = client;
          configurarAutoCacheViaMessage(client);
          const pendentes = GRUPOS_CONFIG.filter(g => !global[g.key] && process.env[g.env]).map(g => process.env[g.env]);
          if (pendentes.length) {
            console.log(`[BOT] Pronto! (via 99%) Aguardando mensagens para cachear: ${pendentes.join(', ')}`);
          } else {
            console.log('[BOT] Pronto! (via 99%) Todos os grupos já têm ID.');
          }
        }
      }, 5000);
    }
  });

  client.on('ready', () => {
    clearTimeout(readyTimer);
    state.setReady(true);
    state.clearQR();
    global._waClient = client;
    configurarAutoCacheViaMessage(client);
    console.log('[BOT] Pronto!');
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
      client.initialize().catch(err => console.error('[BOT] Erro ao reconectar:', err.message));
    }, 10000);
  });

  client.initialize();
}

module.exports = { startBot };
