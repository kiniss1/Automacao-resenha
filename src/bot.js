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

// IDs fixos via variável de ambiente (ex: GRUPO_RELATORIO_ID=120363xxxxxx@g.us)
const GRUPOS_ID_CONFIG = [
  { env: 'GRUPO_NOME_ID',           key: '_grupoId'          },
  { env: 'GRUPO_RETORNO_ID',        key: '_grupoRetornoId'   },
  { env: 'GRUPO_RELATORIO_ID',      key: '_grupoRelId'       },
  { env: 'GRUPO_CHECKIN_ID',        key: '_grupoCheckinId'   },
  { env: 'GRUPO_INSP_ID',           key: '_grupoInspId'      },
  { env: 'GRUPO_AUTOINSP_ID',       key: '_grupoAutoInspId'  },
  { env: 'GRUPO_INDICADOR_ID',      key: '_grupoIndicadorId' },
  { env: 'GRUPO_CIAO_ID',           key: '_grupoCiaoId'      },
];

function carregarIdsFixos() {
  let fixos = 0;
  for (const { env, key } of GRUPOS_ID_CONFIG) {
    const id = process.env[env];
    if (id && id.includes('@g.us')) {
      global[key] = id;
      console.log(`[BOT] ID fixo carregado: ${key} = ${id}`);
      fixos++;
    }
  }
  return fixos;
}

function limparGlobaisGrupo() {
  // Só limpa os que não têm ID fixo configurado
  for (const { env: envId, key } of GRUPOS_ID_CONFIG) {
    if (!process.env[envId]) global[key] = null;
  }
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

async function cachearGruposPorNome(client) {
  const pendentes = GRUPOS_CONFIG.filter(g => !global[g.key] && process.env[g.env]);
  if (!pendentes.length) { console.log('[BOT] Todos os grupos já têm ID.'); return; }

  for (let tentativa = 1; tentativa <= 5; tentativa++) {
    await new Promise(r => setTimeout(r, tentativa * 8000));
    try {
      const grupos = await client.pupPage.evaluate(async () => {
        // Descobre módulos disponíveis que têm grupos
        const tryModules = [
          'WAWebChatCollection', 'ChatStore', 'Wap.Chat',
          'WAWebGroupMetadataStore', 'ContactStore'
        ];

        // Tenta via webpack chunk
        let chats = null;
        try {
          const keys = Object.keys(window.webpackChunkbuild?.__webpack_require__?.m || {});
          for (const k of keys.slice(0, 200)) {
            try {
              const mod = window.webpackChunkbuild.__webpack_require__(k);
              if (mod && mod.default && typeof mod.default.getModelsArray === 'function') {
                const arr = mod.default.getModelsArray();
                if (arr && arr.length > 0 && arr[0].isGroup !== undefined) {
                  chats = arr;
                  break;
                }
              }
            } catch(e) {}
          }
        } catch(e) {}

        if (chats) {
          return chats.filter(c => c.isGroup).map(c => ({
            id: c.id._serialized,
            name: c.name || c.formattedTitle || ''
          }));
        }
        throw new Error('Nenhum modulo de chat encontrado');
      });

      let achou = 0;
      for (const { key, env } of pendentes) {
        const nome = process.env[env];
        const g = grupos.find(c => c.name === nome);
        if (g) { global[key] = g.id; console.log(`[BOT] ✅ "${nome}" → ${g.id}`); achou++; }
        else console.warn(`[BOT] ⚠️ "${nome}" não encontrado. Grupos: ${grupos.map(c=>c.name).join(' | ')}`);
      }
      if (achou > 0) { console.log(`[BOT] ${achou}/${pendentes.length} grupos cacheados.`); return; }
    } catch(e) {
      console.warn(`[BOT] Tentativa ${tentativa} falhou: ${e.message}`);
    }
  }
  setTimeout(() => cachearGruposPorNome(client), 300000);
}

function startBot() {
  limparLockChromium();
  carregarIdsFixos(); // Carrega IDs fixos imediatamente, sem precisar do WhatsApp

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
      readyTimer = setTimeout(async () => {
        if (!state.isReady()) {
          state.setReady(true);
          state.clearQR();
          global._waClient = client;
          console.log('[BOT] Pronto! (via 99%)');
          cachearGruposPorNome(client);
        }
      }, 5000);
    }
  });

  client.on('ready', async () => {
    clearTimeout(readyTimer);
    state.setReady(true);
    state.clearQR();
    global._waClient = client;
    console.log('[BOT] Pronto!');
    cachearGruposPorNome(client);
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
