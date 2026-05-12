// src/bot.js
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const { parseOS } = require('./parser');
const db = require('./db');
const state = require('./state');

const GRUPO_NOME = process.env.GRUPO_NOME || 'Resenha';
const DATA_PATH  = process.env.WA_DATA_PATH || '/data/.wwebjs_auth';
const EXEC_PATH  = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

const MAX_RETRY = 3;
const RETRY_DELAY = 2000; // ms

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
    if (msg.fromMe && msg.body.startsWith('✅')) return;
    if (msg.fromMe && msg.body.startsWith('⚠️')) return;

    const resultado = parseOS(msg.body);
    if (!resultado) return; // mensagem comum, não é resenha

    // Resenha sem 🧰 — avisa no grupo
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

    // Monta resposta
    const linhas = [];

    if (registradas.length) {
      linhas.push(`✅ *${registradas.length} OS(s) registrada(s):*`);
      linhas.push(...registradas);
    }

    if (falhas.length) {
      linhas.push(`\n❌ Falha ao salvar: ${falhas.join(', ')}`);
    }

    // Avisos de campos ausentes ou status não reconhecido
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
  // Remove arquivo de lock que o Chromium deixa ao ser encerrado abruptamente
  const lockFiles = [
    '/data/.wwebjs_auth/Default/SingletonLock',
    '/data/.wwebjs_auth/Default/SingletonSocket',
    '/data/.wwebjs_auth/Default/SingletonCookie',
  ];
  lockFiles.forEach(f => {
    try {
      if (require('fs').existsSync(f)) {
        require('fs').unlinkSync(f);
        console.log('[BOT] Lock removido:', f);
      }
    } catch (e) { /* silencioso */ }
  });

  // Remove também qualquer SingletonLock dentro de subpastas do perfil
  try {
    const base = '/data/.wwebjs_auth';
    const fs = require('fs');
    if (fs.existsSync(base)) {
      fs.readdirSync(base).forEach(dir => {
        const lock = require('path').join(base, dir, 'SingletonLock');
        if (fs.existsSync(lock)) { fs.unlinkSync(lock); console.log('[BOT] Lock removido:', lock); }
      });
    }
  } catch (e) { /* silencioso */ }
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

  client.on('auth_failure', (msg) => {
    console.error('[BOT] Falha de autenticação:', msg);
    state.setReady(false);
  });

  client.on('disconnected', (reason) => {
    state.setReady(false);
    console.warn('[BOT] Desconectado:', reason);
    // Tenta reinicializar após 10s
    setTimeout(() => {
      console.log('[BOT] Tentando reconectar...');
      client.initialize().catch(err => console.error('[BOT] Erro ao reconectar:', err.message));
    }, 10000);
  });

  client.on('message', processarMensagem);
  client.on('message_create', (msg) => { if (msg.fromMe) processarMensagem(msg); });

  client.initialize();
}

module.exports = { startBot };
