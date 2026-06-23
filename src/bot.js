// src/bot.js
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { parseOS } = require('./parser');
const db = require('./db');
const state = require('./state');
const fs   = require('fs');
const path = require('path');

const GRUPO_NOME = process.env.GRUPO_NOME || 'Resenha';
const DATA_PATH  = process.env.WA_DATA_PATH || '/data/.wwebjs_auth';
const EXEC_PATH  = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

const MAX_RETRY = 3;
const RETRY_DELAY = 2000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function salvarComRetry(os, tentativa = 1) {
  try {
    db.inserirOS(os);
    return true;
  } catch (err) {
    if (tentativa < MAX_RETRY) {
      console.warn(`[DB] Tentativa ${tentativa} falhou para OS ${os.os}: ${err.message}. Tentando novamente...`);
      await sleep(RETRY_DELAY);
      return salvarComRetry(os, tentativa + 1);
    }
    console.error(`[DB] Falha definitiva ao salvar OS ${os.os} após ${MAX_RETRY} tentativas:`, err.message);
    return false;
  }
}

async function processarMensagem(msg) {
  try {
    const chat = await msg.getChat();
    console.log(`[MSG] Chat: "${chat.name}" | isGroup: ${chat.isGroup}`);
    if (!chat.isGroup || chat.name !== GRUPO_NOME) return;
    if (msg.fromMe) return;

    const resultado = parseOS(msg.body);
    if (!resultado) return;

    if (resultado.erro) {
      await msg.reply(resultado.aviso);
      return;
    }

    const { ordens, avisos } = resultado;
    const registradas = [];
    const falhas = [];

    for (const os of ordens) {
      const ok = await salvarComRetry(os);
      if (ok) {
        registradas.push(`• ${os.unidade} — ${os.servico.substring(0, 50)}`);
        console.log(`[BOT] ✅ Registrada: ${os.os} | ${os.unidade} | ${os.status}`);
      } else {
        falhas.push(os.os);
      }
    }

    const linhas = [];
    if (registradas.length) {
      linhas.push(`✅ *${registradas.length} OS(s) registrada(s):*`);
      linhas.push(...registradas);
    }
    if (falhas.length) linhas.push(`\n❌ Falha ao salvar: ${falhas.join(', ')}`);
    if (avisos.length) {
      linhas.push(`\n⚠️ *Atenção:*`);
      avisos.forEach(a => linhas.push(`  ${a}`));
    }
    if (linhas.length) await msg.reply(linhas.join('\n'));

  } catch (err) {
    console.error('[BOT] Erro ao processar mensagem:', err.message);
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
        if (entry.isDirectory()) {
          removerLocksEm(fullPath);
        } else if (lockNames.includes(entry.name)) {
          try { fs.unlinkSync(fullPath); console.log('[BOT] Lock removido:', fullPath); }
          catch(e) { console.warn('[BOT] Não foi possível remover lock:', fullPath); }
        }
      }
    } catch(e) { /* silencioso */ }
  }

  removerLocksEm(DATA_PATH);
}

function startBot() {
  limparLockChromium();

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
      readyTimer = setTimeout(async () => {
        if (!state.isReady()) {
          state.setReady(true);
          state.clearQR();
          global._waClient = client;
          try {
            const chats = await client.getChats();
            const grupo = chats.find(c => c.isGroup && c.name === GRUPO_NOME);
            if (grupo) { global._grupoId = grupo.id._serialized; console.log(`[BOT] Grupo ID salvo: ${global._grupoId}`); }
          } catch(e) {}
          console.log(`[BOT] Pronto! (via 99%) Monitorando grupo "${GRUPO_NOME}".`);
        }
      }, 5000);
    }
  });

  client.on('ready', async () => {
    clearTimeout(readyTimer);
    state.setReady(true);
    state.clearQR();
    global._waClient = client;

    try {
      const chats = await client.getChats();
      const grupo = chats.find(c => c.isGroup && c.name === GRUPO_NOME);
      if (grupo) {
        global._grupoId = grupo.id._serialized;
        console.log(`[BOT] Grupo "${GRUPO_NOME}" encontrado. ID: ${global._grupoId}`);
      } else {
        console.warn(`[BOT] ⚠️ Grupo "${GRUPO_NOME}" não encontrado nos chats.`);
      }
    } catch(e) {
      console.error('[BOT] Erro ao buscar grupo:', e.message);
    }

    console.log(`[BOT] Pronto! Monitorando grupo "${GRUPO_NOME}".`);
  });

  client.on('auth_failure', (msg) => {
    console.error('[BOT] Falha de autenticação:', msg);
    state.setReady(false);
  });

  client.on('disconnected', (reason) => {
    state.setReady(false);
    global._waClient = null;
    global._grupoId = null;
    global._grupoInspId = null;
    global._grupoCheckinId = null;
    global._grupoRetornoId = null;
    console.warn('[BOT] Desconectado:', reason);
    setTimeout(() => {
      limparLockChromium();
      console.log('[BOT] Tentando reconectar...');
      client.initialize().catch(err => console.error('[BOT] Erro ao reconectar:', err.message));
    }, 10000);
  });

  // client.on('message', processarMensagem);

  client.initialize();
}

module.exports = { startBot };
