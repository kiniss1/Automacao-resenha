// src/server.js
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const db      = require('./db');
const state   = require('./state');

const PORT = process.env.PORT || 3000;
const STATUS_VALIDOS = ['Andamento', 'Concluído', 'Etapa Concluída', 'Cancelado'];

function startServer() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.get('/health', (_req, res) => {
    res.json({ ok: true, bot: state.isReady(), ts: new Date().toISOString() });
  });

  app.get('/qr', (_req, res) => {
    const qr = state.getQR();
    if (state.isReady()) return res.send('<h2 style="font-family:sans-serif;color:green;padding:40px">✅ WhatsApp conectado!</h2>');
    if (!qr) return res.send(`
      <html><head><meta http-equiv="refresh" content="5">
      <style>body{font-family:sans-serif;text-align:center;padding:40px}</style></head>
      <body><h2>⏳ Aguardando QR Code...</h2><p>Página atualiza automaticamente.</p></body></html>
    `);
    return res.send(`
      <html><head><meta http-equiv="refresh" content="30">
      <style>body{font-family:sans-serif;text-align:center;padding:40px}img{border:4px solid #000;border-radius:8px}</style></head>
      <body>
        <h2>📱 Escaneie com o WhatsApp</h2>
        <img src="${qr}" width="300" />
        <p style="color:#666">Atualiza em 30s.</p>
      </body></html>
    `);
  });

  // ── Reset de sessão WhatsApp ───────────────────────────────────────────────
  app.get('/reset-session', (_req, res) => {
    const authPath  = process.env.WA_DATA_PATH || '/data/.wwebjs_auth';
    const cachePath = '/data/.wwebjs_cache';

    try {
      if (fs.existsSync(authPath))  fs.rmSync(authPath,  { recursive: true, force: true });
      if (fs.existsSync(cachePath)) fs.rmSync(cachePath, { recursive: true, force: true });
      state.setReady(false);
      console.log('[RESET] Sessão apagada via /reset-session. Reiniciando processo...');
    } catch (err) {
      console.error('[RESET] Erro ao apagar sessão:', err.message);
      return res.send(`
        <html><head><style>body{font-family:sans-serif;text-align:center;padding:40px}</style></head>
        <body><h2 style="color:red">❌ Erro ao apagar sessão</h2><p>${err.message}</p></body></html>
      `);
    }

    res.send(`
      <html>
      <head>
        <meta http-equiv="refresh" content="6;url=/qr">
        <style>body{font-family:sans-serif;text-align:center;padding:40px}</style>
      </head>
      <body>
        <h2>🔄 Sessão apagada!</h2>
        <p>O bot vai reiniciar em instantes...</p>
        <p>Você será redirecionado para o QR Code em <strong>6 segundos</strong>.</p>
        <a href="/qr">Ir agora →</a>
      </body></html>
    `);

    setTimeout(() => process.exit(0), 1000);
  });

  // ── API OS ─────────────────────────────────────────────────────────────────
  app.get('/api/os', (req, res) => {
    try {
      const { status, unidade, search, dataDe, dataAte } = req.query;
      res.json({ ok: true, data: db.listarOS({ status, unidade, search, dataDe, dataAte }) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/stats', (req, res) => {
    try {
      const { dataDe, dataAte } = req.query;
      res.json({ ok: true, data: db.estatisticas({ dataDe, dataAte }) });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.patch('/api/os/:id', requireAuth, requirePermissao('alterar_status_os'), (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { status } = req.body;
      if (!STATUS_VALIDOS.includes(status)) {
        return res.status(400).json({ ok: false, error: `Status inválido. Use: ${STATUS_VALIDOS.join(', ')}` });
      }
      const atualizado = db.atualizarStatus(id, status);
      if (!atualizado) return res.status(404).json({ ok: false, error: 'OS não encontrada.' });
      res.json({ ok: true, data: atualizado });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.delete('/api/os/:id', requireAuth, requirePermissao('excluir_os'), (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const removida = db.removerOS(id);
      if (!removida) return res.status(404).json({ ok: false, error: 'OS não encontrada.' });
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Check-in routes ───────────────────────────────────────────────────────
  const checkin = require('./checkin');

  app.get('/api/subestacoes', (_req, res) => {
    res.json({ ok: true, data: checkin.SUBESTACOES });
  });

  app.get('/api/colaborador/:matricula', (req, res) => {
    const colab = checkin.buscarColaborador(req.params.matricula);
    res.json({ ok: true, data: colab || null });
  });

  app.get('/api/colaboradores', requireAuth, requirePermissao('gerenciar_usuarios'), (req, res) => {
    try { res.json({ ok: true, data: checkin.listarColaboradores() }); }
    catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/colaboradores', requireAuth, requirePermissao('gerenciar_usuarios'), express.json(), (req, res) => {
    try {
      const c = checkin.criarColaborador(req.body);
      res.json({ ok: true, data: c });
    } catch(e) {
      const msg = e.message.includes('UNIQUE') ? 'Já existe um colaborador com essa matrícula.' : e.message;
      res.status(400).json({ ok: false, error: msg });
    }
  });

  app.patch('/api/colaboradores/:matricula', requireAuth, requirePermissao('gerenciar_usuarios'), express.json(), (req, res) => {
    try { res.json({ ok: true, data: checkin.atualizarColaborador(req.params.matricula, req.body) }); }
    catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.delete('/api/colaboradores/:matricula', requireAuth, requirePermissao('gerenciar_usuarios'), (req, res) => {
    try { checkin.deletarColaborador(req.params.matricula); res.json({ ok: true }); }
    catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/checkin/ativo/:matricula', (req, res) => {
    try {
      const c = require('./checkin');
      const ativos = c.listarAtivos();
      const ativo = ativos.find(a => a.matricula === req.params.matricula) || null;
      res.json({ ok: true, data: ativo });
    } catch(err) { res.status(500).json({ ok: false, error: err.message }); }
  });

  app.post('/api/checkin', (req, res) => {
    try {
      const { matricula, subestacao, atividade } = req.body;
      if (!matricula || !subestacao) return res.status(400).json({ ok: false, erro: true, msg: 'Matrícula e subestação obrigatórios.' });
      const result = checkin.fazerCheckin({ matricula, subestacao, atividade });
      res.json({ ok: !result.erro, ...result });
    } catch(err) { res.status(500).json({ ok: false, erro: true, msg: err.message }); }
  });

  // Notifica o grupo do WhatsApp com TODOS os colaboradores do mesmo lote de check-in
  // numa única mensagem (em vez de uma mensagem por colaborador)
  app.post('/api/checkin/notificar-grupo', express.json(), async (req, res) => {
    try {
      const { subestacao, atividade, colaboradores } = req.body;
      if (!subestacao || !Array.isArray(colaboradores) || !colaboradores.length) {
        return res.status(400).json({ ok: false, error: 'subestacao e colaboradores[] são obrigatórios' });
      }

      const botState = require('./state');
      if (!botState.isReady() || !global._waClient) {
        return res.json({ ok: false, error: 'Bot WhatsApp não conectado (notificação ignorada)' });
      }

      const hora = new Date(Date.now() - 3*60*60*1000).toISOString().slice(11,16);
      const listaColab = colaboradores
        .map(c => `👷 ${c.nome}` + (c.cargo ? ` — ${c.cargo}` : ''))
        .join('\n');

      const msgWA =
        `🟢 *Check-in registrado*\n` +
        `📍 SE ${subestacao.toUpperCase()}\n` +
        `${listaColab}\n` +
        (atividade ? `📝 ${atividade}\n` : '') +
        `⏰ ${hora}`;

      const grupoNome = process.env.GRUPO_CHECKIN_NOME || process.env.GRUPO_NOME || 'Resenha';

      try {
        if (global._grupoCheckinId) {
          const chat = await global._waClient.getChatById(global._grupoCheckinId);
          await chat.sendMessage(msgWA);
        } else {
          const chats = await global._waClient.getChats();
          const grupo = chats.find(c => c.isGroup && c.name === grupoNome);
          if (grupo) {
            global._grupoCheckinId = grupo.id._serialized;
            await grupo.sendMessage(msgWA);
          } else {
            console.warn('[CHECKIN] Grupo "' + grupoNome + '" não encontrado. Verifique GRUPO_CHECKIN_NOME no .env');
            return res.json({ ok: false, error: `Grupo "${grupoNome}" não encontrado` });
          }
        }
      } catch(e) {
        if (e.message?.includes('not found') || e.message?.includes('404')) global._grupoCheckinId = null;
        throw e;
      }

      res.json({ ok: true });
    } catch(e) {
      console.error('[CHECKIN] Erro ao notificar grupo:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/checkout', async (req, res) => {
    try {
      const { matricula } = req.body;
      if (!matricula) return res.status(400).json({ ok: false, erro: true, msg: 'Matrícula obrigatória.' });
      const result = checkin.fazerCheckout(matricula);
      res.json({ ok: !result.erro, ...result });

      // Notifica o grupo do WhatsApp (não bloqueia a resposta)
      if (!result.erro && result.checkin) {
        try {
          const botState = require('./state');
          if (botState.isReady() && global._waClient) {
            const c = result.checkin;
            const hora = new Date(Date.now() - 3*60*60*1000).toISOString().slice(11,16);

            // Calcula tempo em campo (entrada → saída)
            let duracao = '';
            try {
              const ent = new Date(c.entrada.replace(' ', 'T'));
              const sai = new Date(c.saida.replace(' ', 'T'));
              const mins = Math.round((sai - ent) / 60000);
              const h = Math.floor(mins / 60), m = mins % 60;
              duracao = h > 0 ? `${h}h${m > 0 ? m + 'min' : ''}` : `${m}min`;
            } catch(e) {}

            const msgWA =
              `🔴 *Check-out registrado*\n` +
              `📍 SE ${c.subestacao}\n` +
              `👷 ${c.nome || matricula}` + (c.cargo ? ` — ${c.cargo}` : '') + `\n` +
              (duracao ? `⏱️ Tempo em campo: ${duracao}\n` : '') +
              `⏰ ${hora}`;

            const grupoNome = process.env.GRUPO_CHECKIN_NOME || process.env.GRUPO_NOME || 'Resenha';

            if (global._grupoCheckinId) {
              const chat = await global._waClient.getChatById(global._grupoCheckinId);
              await chat.sendMessage(msgWA);
            } else {
              const chats = await global._waClient.getChats();
              const grupo = chats.find(c => c.isGroup && c.name === grupoNome);
              if (grupo) {
                global._grupoCheckinId = grupo.id._serialized;
                await grupo.sendMessage(msgWA);
              } else {
                console.warn('[CHECKOUT] Grupo "' + grupoNome + '" não encontrado. Verifique GRUPO_CHECKIN_NOME no .env');
              }
            }
          }
        } catch(e) {
          console.error('[CHECKOUT] Erro ao notificar grupo:', e.message);
          if (e.message?.includes('not found') || e.message?.includes('404')) {
            global._grupoCheckinId = null;
          }
        }
      }
    } catch(err) { res.status(500).json({ ok: false, erro: true, msg: err.message }); }
  });

  app.get('/api/checkin/ativos', (req, res) => {
    try {
      const ativos = checkin.listarAtivos();
      const sub = req.query.sub;
      res.json({ ok: true, data: sub ? ativos.filter(a => a.subestacao === sub.toUpperCase()) : ativos });
    } catch(err) { res.status(500).json({ ok: false, error: err.message }); }
  });

  app.get('/api/checkin/historico', (req, res) => {
    try {
      const { subestacao, status, dataDe, dataAte, matricula } = req.query;
      const data = checkin.listarHistorico({ subestacao, matricula, dataDe, dataAte });
      const filtered = status ? data.filter(c => c.status === status) : data;
      res.json({ ok: true, data: filtered });
    } catch(err) { res.status(500).json({ ok: false, error: err.message }); }
  });

  app.get('/api/checkin/stats', (_req, res) => {
    try { res.json({ ok: true, data: checkin.estatisticasCheckin() }); }
    catch(err) { res.status(500).json({ ok: false, error: err.message }); }
  });

  app.delete('/api/checkin/:id', requireAuth, requirePermissao('excluir_checkin'), (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      checkin.deletarCheckin(id);
      res.json({ ok: true });
    } catch(err) { res.status(500).json({ ok: false, error: err.message }); }
  });

  app.get('/api/qrcode', async (req, res) => {
    try {
      const qrcode = require('qrcode');
      const url = req.query.url;
      if (!url) return res.status(400).send('URL obrigatória');
      const buffer = await qrcode.toBuffer(url, { width: 300, margin: 2 });
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(buffer);
    } catch(err) { res.status(500).send(err.message); }
  });

  // ── Registro de atividade via formulário web ──────────────────────────────
  app.post('/api/atividade', async (req, res) => {
    try {
      const { tipo, guarda, horario, dia_semana, data, equipe, telefone, veiculo, trajeto, ordens } = req.body;

      if (!ordens || !ordens.length) return res.status(400).json({ ok: false, error: 'Nenhuma atividade informada.' });

      const registradas = [];

      const ordensDedup = [];
      const osVistas = new Set();
      for (const o of ordens) {
        const key = (o.os || '').trim() || (o.servico || '').substring(0, 30);
        if (!osVistas.has(key)) { osVistas.add(key); ordensDedup.push(o); }
      }
      console.log('[ATIVIDADE] Recebido', ordens.length, 'ordens,', ordensDedup.length, 'únicas, tipo:', tipo);

      for (const o of ordensDedup) {
        if (!o.servico && !o.descricao_inicial && !o.descricao_final) continue;

        let osId = o.os && o.os.trim() ? o.os.trim() : null;
        if (!osId) {
          const norm = (o.servico || o.descricao_inicial || '').toLowerCase().replace(/[^a-z0-9\s]/g,'').trim().replace(/\s+/g,' ');
          const prefixo = norm.split(' ').slice(0,3).join('-').toUpperCase().substring(0,20);
          const h = norm.split('').reduce((h,c) => (((h<<5)+h)+c.charCodeAt(0))|0, 5381);
          osId = prefixo + '-' + Math.abs(h).toString(36).toUpperCase();
        }

        const status = tipo === 'final' ? (o.status || 'Concluído') : 'Andamento';
        const descInicial = tipo === 'inicial' ? (o.servico || o.descricao_inicial || null) : null;
        const descFinal   = tipo === 'final'   ? (o.servico || o.descricao_final   || null) : null;
        const servicoBase = tipo === 'inicial'
          ? (descInicial || '')
          : (o.descricao_inicial || o.servico || '');
        const servicoFull = trajeto ? servicoBase + ' | Trajeto: ' + trajeto : servicoBase;

        db.inserirOS({
          os:                osId,
          unidade:           o.unidade || '—',
          equipe,
          veiculo:           veiculo || null,
          servico:           servicoFull,
          status,
          data:              data || null,
          guarda:            guarda || null,
          horario:           horario || null,
          dia_semana:        dia_semana || null,
          telefone:          telefone || null,
          subestacoes:       o.unidade || null,
          saida_base:        null,
          chegada_base:      null,
          descricao_inicial: descInicial,
          descricao_final:   descFinal,
          trajeto:           trajeto || null,
        });

        registradas.push({ os: osId, unidade: o.unidade, status, servico: servicoFull });
      }

      try {
        const botState = require('./state');
        if (botState.isReady() && global._waClient) {
          const baseUrl = process.env.PUBLIC_URL || ('https://' + req.headers.host);
          const ordensComLink = registradas.map(r => ({ ...r, aprLink: baseUrl + '/apr.html?os=' + encodeURIComponent(r.os) }));
          const msgWA = formatMsgWhatsApp({ tipo, guarda, horario, dia_semana, data, equipe, telefone, veiculo, ordens: ordensComLink });

          if (global._grupoRetornoId) {
            const chat = await global._waClient.getChatById(global._grupoRetornoId);
            await chat.sendMessage(msgWA);
            console.log('[ATIVIDADE] ✅ Mensagem enviada ao grupo.');
          } else {
            const grupoNome = process.env.GRUPO_RETORNO_NOME || process.env.GRUPO_NOME || 'Resenha';
            const chats = await global._waClient.getChats();
            const grupo = chats.find(c => c.isGroup && c.name === grupoNome);
            if (grupo) {
              global._grupoRetornoId = grupo.id._serialized;
              await grupo.sendMessage(msgWA);
              console.log('[ATIVIDADE] ✅ Mensagem enviada ao grupo (fallback).');
            } else {
              console.warn('[ATIVIDADE] ⚠️ Grupo não encontrado. GRUPO_RETORNO_NOME =', grupoNome);
            }
          }
        } else {
          console.warn('[ATIVIDADE] Bot não está pronto para enviar mensagem.');
        }
      } catch(wErr) {
        console.error('[ATIVIDADE] Erro WhatsApp:', wErr.message);
      }

      const baseUrl = process.env.PUBLIC_URL || ('https://' + req.headers.host);
      const registradasComLink = registradas.map(r => ({
        ...r,
        aprLink: baseUrl + '/apr.html?os=' + encodeURIComponent(r.os),
      }));
      res.json({ ok: true, registradas: registradasComLink });
    } catch (err) {
      console.error('[API] POST /api/atividade:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  function formatMsgWhatsApp({ tipo, guarda, horario, dia_semana, data, equipe, telefone, veiculo, ordens }) {
    const titulo = tipo === 'inicial' ? '*📋 Resenha Inicial — Registro de Atividade*' : '*📋 Resenha Final — Registro de Atividade*';
    const linhas = [titulo, ''];
    if (guarda)    linhas.push('⚙️ Guarda: ' + guarda);
    if (horario)   linhas.push('⏰ Horário: ' + horario);
    if (dia_semana || data) linhas.push('📆 ' + [dia_semana, data].filter(Boolean).join(', '));
    if (equipe) {
      equipe.split(',').map(n => n.trim()).filter(Boolean).forEach(nome => {
        linhas.push('👷🏼‍♂️ ' + nome);
      });
    }
    if (telefone)  linhas.push('📱 ' + telefone);
    if (veiculo)   linhas.push('🚔 ' + veiculo);
    linhas.push('');
    for (const o of ordens) {
      linhas.push('🧰 ' + o.os + (o.unidade && o.unidade !== '—' ? ' — ' + o.unidade : ''));
      if (o.servico) linhas.push(o.servico.split(' | ')[0]);
      linhas.push('📌 Status: ' + o.status);
      if (o.aprLink) linhas.push('📎 APR: ' + o.aprLink);
      linhas.push('');
    }
    return linhas.join('\n').trim();
  }

  // ── Envio manual WhatsApp ─────────────────────────────────────────────────
  app.post('/api/os/:id/enviar-resumo', requireAuth, requirePermissao('enviar_relatorio_painel'), async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const os = db.buscarPorId(id);
      if (!os) return res.status(404).json({ ok: false, error: 'OS não encontrada' });

      const tipo = os.descricao_final ? 'final' : 'inicial';
      const baseUrl = process.env.PUBLIC_URL || ('https://' + req.headers.host);
      const aprLink = baseUrl + '/apr.html?os=' + encodeURIComponent(os.os);

      const ordens = [{
        os:       os.os,
        unidade:  os.unidade,
        servico:  os.descricao_inicial || os.servico || '',
        status:   os.status,
        aprLink:  os.apr_path ? aprLink : null,
      }];

      const msgWA = formatMsgWhatsApp({
        tipo,
        guarda:     os.guarda,
        horario:    os.horario,
        dia_semana: os.dia_semana,
        data:       os.data,
        equipe:     os.equipe,
        telefone:   os.telefone,
        veiculo:    os.veiculo,
        ordens,
      });

      if (!global._waClient) {
        // Aguarda até 15s pelo _waClient ser atribuído após scan do QR
        await new Promise((resolve, reject) => {
          let elapsed = 0;
          const t = setInterval(() => {
            if (global._waClient) { clearInterval(t); resolve(); }
            else if ((elapsed += 500) >= 15000) { clearInterval(t); reject(new Error('Bot WhatsApp não conectado')); }
          }, 500);
        });
      }

      if (!global._grupoRetornoId) {
        const grupoNome = process.env.GRUPO_RETORNO_NOME || process.env.GRUPO_NOME || 'Resenha';
        const chats = await global._waClient.getChats();
        const grupo = chats.find(c => c.isGroup && c.name === grupoNome);
        if (!grupo) return res.status(404).json({ ok: false, error: `Grupo "${grupoNome}" não encontrado.` });
        global._grupoRetornoId = grupo.id._serialized;
      }

      const chat = await global._waClient.getChatById(global._grupoRetornoId);
      await chat.sendMessage(msgWA);
      res.json({ ok: true, msg: 'Resumo enviado ao grupo!' });
    } catch(e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── APR upload/serve ──────────────────────────────────────────────────────
  const multer  = require('multer');
  const APR_DIR = process.env.APR_DIR || '/data/apr';
  require('fs').mkdirSync(APR_DIR, { recursive: true });

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, APR_DIR),
    filename: (req, _file, cb) => cb(null, 'apr_' + req.params.id + '.jpg'),
  });
  const upload = multer({
    storage,
    limits: { fileSize: 15 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      cb(null, file.mimetype.startsWith('image/'));
    },
  });

  app.post('/api/os/:id/apr', upload.single('apr'), (req, res) => {
    try {
      const id   = parseInt(req.params.id, 10);
      if (!req.file) return res.status(400).json({ ok: false, error: 'Nenhum arquivo enviado.' });
      const newPath = path.join(APR_DIR, 'apr_' + id + '_frente.jpg');
      fs.renameSync(req.file.path, newPath);
      db.updateAprPath(id, newPath);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/os/:id/apr-verso', upload.single('apr'), (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!req.file) return res.status(400).json({ ok: false, error: 'Nenhum arquivo enviado.' });
      const newPath = path.join(APR_DIR, 'apr_' + id + '_verso.jpg');
      fs.renameSync(req.file.path, newPath);
      db.updateAprVersoPath(id, newPath);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/os/:id/apr', (req, res) => {
    try {
      const id  = parseInt(req.params.id, 10);
      const os  = db.buscarPorId(id);
      if (os && os.apr_path && fs.existsSync(os.apr_path)) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'private, max-age=3600');
        return fs.createReadStream(os.apr_path).pipe(res);
      }
      const fallback = path.join(APR_DIR, 'apr_' + id + '.jpg');
      if (fs.existsSync(fallback)) {
        db.updateAprPath(id, fallback);
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'private, max-age=3600');
        return fs.createReadStream(fallback).pipe(res);
      }
      res.status(404).json({ ok: false, error: 'APR não encontrada.' });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/os/:id/apr-verso', (req, res) => {
    try {
      const id   = parseInt(req.params.id, 10);
      const os   = db.buscarPorId(id);
      const filePath = (os && os.apr_verso_path && fs.existsSync(os.apr_verso_path))
        ? os.apr_verso_path
        : path.join(APR_DIR, 'apr_' + id + '_verso.jpg');
      if (!fs.existsSync(filePath)) return res.status(404).json({ ok: false, error: 'Verso não encontrado.' });
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ── Edição completa de OS (painel gestor) ───────────────────────────────
  app.patch('/api/os/:id/edit', requireAuth, requirePermissao('editar_os'), express.json(), (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const b  = req.body;
      const os = db.buscarPorId(id);
      if (!os) return res.status(404).json({ ok: false, error: 'OS não encontrada' });

      const fields = [];
      const vals   = [];
      const map = {
        os:'os', unidade:'unidade', guarda:'guarda', horario:'horario',
        equipe:'equipe', telefone:'telefone', veiculo:'veiculo',
        descricao_inicial:'descricao_inicial', descricao_final:'descricao_final',
        status:'status', trajeto:'trajeto', data:'data',
      };
      for (const [key, col] of Object.entries(map)) {
        if (b[key] !== undefined) { fields.push(col+'=?'); vals.push(b[key]||null); }
      }
      if (!fields.length) return res.json({ ok: true, data: os });

      vals.push(id);
      db.run(`UPDATE ordens_servico SET ${fields.join(',')} WHERE id=?`, vals);
      const updated = db.buscarPorId(id);
      res.json({ ok: true, data: updated });
    } catch(e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Atualizar Trajeto ────────────────────────────────────────────────────
  app.post('/api/trajeto/:id', express.json(), (req, res) => {
    try {
      const id     = parseInt(req.params.id, 10);
      const pontos = req.body?.pontos || '';
      const os     = db.buscarPorId(id);
      if (!os) return res.status(404).json({ ok: false, error: 'OS não encontrada' });
      const trajetoAtual = os.trajeto || '';
      const novoTrajeto  = trajetoAtual ? trajetoAtual + ' | ' + pontos : pontos;
      db.run(`UPDATE ordens_servico SET trajeto=?, atualizado_em=datetime('now','localtime') WHERE id=?`,
        [novoTrajeto, id]);
      const updated = db.buscarPorId(id);
      res.json({ ok: true, data: updated });
    } catch(e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── SharePoint Queue ─────────────────────────────────────────────────────
  app.post('/api/sp-enviar/:id', requireAuth, requirePermissao('enviar_sharepoint'), express.json(), (req, res) => {
    try {
      const id   = parseInt(req.params.id, 10);
      const peso = req.body?.peso || null;
      const os   = db.buscarPorId(id);
      if (!os) return res.status(404).json({ ok: false, error: 'OS não encontrada' });
      db.run('UPDATE ordens_servico SET sp_enviado=2, sp_peso=? WHERE id=?', [peso, id]);
      res.json({ ok: true, msg: 'OS adicionada à fila do SharePoint' });
    } catch(e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/sp-queue', (req, res) => {
    try {
      const pending = db.all(
        'SELECT * FROM ordens_servico WHERE sp_enviado=2 ORDER BY atualizado_em DESC LIMIT 20'
      );
      res.json({ ok: true, data: pending });
    } catch(e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/sp-confirmado/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      db.marcarSpEnviado(id);
      res.json({ ok: true });
    } catch(e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.post('/api/sp-falhou/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      db.run('UPDATE ordens_servico SET sp_enviado=0 WHERE id=?', [id]);
      res.json({ ok: true });
    } catch(e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.get('/api/bot-status', (_req, res) => {
    res.json({ ready: state.isReady() && !!global._waClient, hasQR: !!state.getQR() });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ── AUTENTICAÇÃO E PERMISSÕES ──────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  const auth = require('./db_auth');

  function requireAuth(req, res, next) {
    const header = req.headers['authorization'] || '';
    const token  = req.headers['x-auth-token'] || header.replace('Bearer ', '').trim();
    const usuario = auth.verificarToken(token);
    if (!usuario) return res.status(401).json({ ok: false, error: 'Não autenticado. Faça login novamente.' });
    req.user = usuario;
    auth.registrarAtividade(usuario.id);
    next();
  }

  function requirePermissao(perm) {
    return (req, res, next) => {
      if (!req.user) return res.status(401).json({ ok: false, error: 'Não autenticado.' });
      if (!req.user.permissoes.includes(perm)) {
        return res.status(403).json({ ok: false, error: 'Você não tem permissão para esta ação.' });
      }
      next();
    };
  }

  app.post('/api/auth/login', express.json(), (req, res) => {
    try {
      const { username, senha } = req.body;
      if (!username || !senha) return res.status(400).json({ ok: false, error: 'Informe usuário e senha.' });
      const r = auth.login(username, senha);
      if (!r.ok) return res.status(401).json(r);
      res.json(r);
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({ ok: true, usuario: req.user });
  });

  app.get('/api/auth/permissoes-info', (req, res) => {
    res.json({ ok: true, data: auth.PERMISSOES_INFO });
  });

  app.get('/api/auth/usuarios', requireAuth, requirePermissao('gerenciar_usuarios'), (req, res) => {
    try { res.json({ ok: true, data: auth.listarUsuarios() }); }
    catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/auth/usuarios', requireAuth, requirePermissao('gerenciar_usuarios'), express.json(), (req, res) => {
    try {
      const { username, senha, nome, permissoes } = req.body;
      if (!username || !senha || !nome) return res.status(400).json({ ok: false, error: 'Usuário, senha e nome são obrigatórios.' });
      const u = auth.criarUsuario({ username, senha, nome, permissoes });
      res.json({ ok: true, data: u });
    } catch(e) {
      const msg = e.message.includes('UNIQUE') ? 'Esse nome de usuário já existe.' : e.message;
      res.status(500).json({ ok: false, error: msg });
    }
  });

  app.patch('/api/auth/usuarios/:id', requireAuth, requirePermissao('gerenciar_usuarios'), express.json(), (req, res) => {
    try {
      const u = auth.atualizarUsuario(parseInt(req.params.id), req.body);
      res.json({ ok: true, data: u });
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.delete('/api/auth/usuarios/:id', requireAuth, requirePermissao('gerenciar_usuarios'), (req, res) => {
    try {
      if (req.user.id === parseInt(req.params.id)) {
        return res.status(400).json({ ok: false, error: 'Você não pode excluir o próprio usuário.' });
      }
      auth.deletarUsuario(parseInt(req.params.id));
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/auth/usuarios/:id/desconectar', requireAuth, requirePermissao('gerenciar_usuarios'), (req, res) => {
    try {
      if (req.user.id === parseInt(req.params.id)) {
        return res.status(400).json({ ok: false, error: 'Você não pode desconectar a si mesmo.' });
      }
      const u = auth.forcarDesconexao(parseInt(req.params.id));
      res.json({ ok: true, data: u });
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ── INSPEÇÃO DE SUBESTAÇÕES ────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  const insp      = require('./db_inspecao');
  const INSP_DIR  = process.env.INSP_IMG_DIR || path.join(__dirname, '..', 'data', 'insp_imgs');
  fs.mkdirSync(INSP_DIR, { recursive: true });

  const insp_storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, INSP_DIR),
    filename:    (_req, file,  cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, 'insp_' + Date.now() + '_' + Math.random().toString(36).slice(2,7) + ext);
    }
  });
  const insp_upload = multer({
    storage: insp_storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ok = /^image\/(jpeg|png|gif|webp)$/i.test(file.mimetype);
      cb(null, ok);
    }
  });

  app.get('/api/inspecao/foto/:filename', (req, res) => {
    try {
      const fp = path.join(INSP_DIR, path.basename(req.params.filename));
      if (!fs.existsSync(fp)) return res.status(404).json({ ok: false });
      res.setHeader('Cache-Control', 'private, max-age=3600');
      fs.createReadStream(fp).pipe(res);
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/inspecao/login', express.json(), (req, res) => {
    const { usuario, senha } = req.body || {};
    const USER = process.env.INSP_USER || 'supervisor';
    const PASS = process.env.INSP_PASS || 'supervisor';
    if (usuario === USER && senha === PASS) {
      return res.json({ ok: true, token: 'insp_sup_' + Buffer.from(USER+':'+PASS).toString('base64') });
    }
    res.status(401).json({ ok: false, error: 'Credenciais inválidas' });
  });

  function authSup(req, res, next) {
    const USER = process.env.INSP_USER || 'supervisor';
    const PASS = process.env.INSP_PASS || 'supervisor';
    const expected = 'insp_sup_' + Buffer.from(USER+':'+PASS).toString('base64');
    const tok = req.headers['x-insp-token'] || req.query.token;
    if (tok !== expected) return res.status(403).json({ ok: false, error: 'Não autorizado' });
    next();
  }

  app.get('/api/inspecao/fichas', (req, res) => {
    try { res.json({ ok: true, data: insp.listarFichas() }); }
    catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/inspecao/fichas/:id', (req, res) => {
    try {
      const f = isNaN(req.params.id)
        ? insp.buscarFichaPorCodigo(req.params.id)
        : insp.buscarFicha(parseInt(req.params.id));
      if (!f) return res.status(404).json({ ok: false, error: 'Ficha não encontrada' });
      const campos = insp.listarCampos(f.id);
      res.json({ ok: true, data: { ...f, campos } });
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/inspecao/fichas', authSup, express.json(), (req, res) => {
    try {
      const { codigo_se, nome_se, descricao } = req.body;
      if (!codigo_se || !nome_se) return res.status(400).json({ ok: false, error: 'codigo_se e nome_se obrigatórios' });
      const f = insp.criarFicha({ codigo_se, nome_se, descricao });
      res.json({ ok: true, data: f });
    } catch(e) {
      if (e.message?.includes('UNIQUE')) return res.status(409).json({ ok: false, error: 'Código SE já existe' });
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  app.patch('/api/inspecao/fichas/:id', authSup, express.json(), (req, res) => {
    try {
      const f = insp.atualizarFicha(parseInt(req.params.id), req.body);
      res.json({ ok: true, data: f });
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.delete('/api/inspecao/fichas/:id', authSup, (req, res) => {
    try { insp.deletarFicha(parseInt(req.params.id)); res.json({ ok: true }); }
    catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/inspecao/fichas/:fichaId/campos', (req, res) => {
    try { res.json({ ok: true, data: insp.listarCampos(parseInt(req.params.fichaId)) }); }
    catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/inspecao/fichas/:fichaId/campos', authSup, express.json(), (req, res) => {
    try {
      const ficha_id = parseInt(req.params.fichaId);
      const { label, tipo, opcoes, obrigatorio, grupo, ordem, permite_foto } = req.body;
      if (!label) return res.status(400).json({ ok: false, error: 'label obrigatório' });
      const c = insp.criarCampo({ ficha_id, label, tipo, opcoes, obrigatorio, grupo, ordem, permite_foto });
      res.json({ ok: true, data: c });
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.patch('/api/inspecao/campos/:id', authSup, express.json(), (req, res) => {
    try {
      const c = insp.atualizarCampo(parseInt(req.params.id), req.body);
      res.json({ ok: true, data: c });
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.delete('/api/inspecao/campos/:id', authSup, (req, res) => {
    try { insp.deletarCampo(parseInt(req.params.id)); res.json({ ok: true }); }
    catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/inspecao/fichas/:fichaId/reordenar', authSup, express.json(), (req, res) => {
    try {
      insp.reordenarCampos(parseInt(req.params.fichaId), req.body.ordem || []);
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/inspecao/preenchimentos', (req, res) => {
    try {
      const { ficha_id, codigo_se, matricula, dataDe, dataAte, status } = req.query;
      res.json({ ok: true, data: insp.listarPreenchimentos({ ficha_id, codigo_se, matricula, dataDe, dataAte, status }) });
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/inspecao/preenchimentos/:id', (req, res) => {
    try {
      const p = insp.buscarPreenchimento(parseInt(req.params.id));
      if (!p) return res.status(404).json({ ok: false, error: 'Não encontrado' });
      const respostas = insp.listarRespostas(p.id);
      const campos    = insp.listarCampos(p.ficha_id);
      res.json({ ok: true, data: { ...p, respostas, campos } });
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/inspecao/preenchimentos', express.json(), (req, res) => {
    try {
      const { ficha_id, codigo_se, matricula, nome_tecnico, data_insp, hora_insp, obs_geral } = req.body;
      if (!ficha_id || !codigo_se || !data_insp)
        return res.status(400).json({ ok: false, error: 'ficha_id, codigo_se e data_insp obrigatórios' });
      const p = insp.criarPreenchimento({ ficha_id, codigo_se, matricula, nome_tecnico, data_insp, hora_insp, obs_geral });
      res.json({ ok: true, data: p });
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/inspecao/preenchimentos/:id/concluir', async (req, res) => {
    try {
      const p = insp.concluirPreenchimento(parseInt(req.params.id));
      res.json({ ok: true, data: p });

      // Notifica o grupo de inspeções (não bloqueia a resposta)
      try {
        const botState = require('./state');
        if (botState.isReady() && global._waClient && p) {
          const ficha = insp.buscarFicha(p.ficha_id);
          const hora = new Date(Date.now() - 3*60*60*1000).toISOString().slice(11,16);
          const msgWA =
            `🤖 *Sistema de Monitoramento Automático*\n` +
            `🔍 Inspeção concluída\n` +
            `📍 SE ${p.codigo_se}${ficha?.nome_se ? ' — ' + ficha.nome_se : ''}\n` +
            `👷 ${p.nome_tecnico || p.matricula}\n` +
            `⏰ ${hora}\n\n` +
            `_Gerado automaticamente pelo sistema OOMC_`;

          const grupoNome = process.env.GRUPO_INSP_NOME || process.env.GRUPO_NOME || 'Resenha';

          if (global._grupoInspId) {
            const chat = await global._waClient.getChatById(global._grupoInspId);
            await chat.sendMessage(msgWA);
          } else {
            const chats = await global._waClient.getChats();
            const grupo = chats.find(c => c.isGroup && c.name === grupoNome);
            if (grupo) {
              global._grupoInspId = grupo.id._serialized;
              await grupo.sendMessage(msgWA);
            } else {
              console.warn('[INSPECAO] Grupo "' + grupoNome + '" não encontrado.');
            }
          }
        }
      } catch(e) {
        console.error('[INSPECAO] Erro ao notificar grupo:', e.message);
        if (e.message?.includes('not found') || e.message?.includes('404')) {
          global._grupoInspId = null;
        }
      }
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.delete('/api/inspecao/preenchimentos/:id', (req, res) => {
    try { insp.deletarPreenchimento(parseInt(req.params.id)); res.json({ ok: true }); }
    catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/inspecao/preenchimentos/:id/respostas', express.json(), (req, res) => {
    try {
      const preenchimento_id = parseInt(req.params.id);
      const { campo_id, resposta_texto, resposta_opcao } = req.body;
      if (!campo_id) return res.status(400).json({ ok: false, error: 'campo_id obrigatório' });
      const r = insp.salvarResposta({ preenchimento_id, campo_id, resposta_texto, resposta_opcao });
      res.json({ ok: true, data: r });
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/inspecao/preenchimentos/:preId/campo/:campoId/foto',
    insp_upload.single('foto'), (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ ok: false, error: 'Nenhum arquivo enviado' });
        const preenchimento_id = parseInt(req.params.preId);
        const campo_id         = parseInt(req.params.campoId);
        const foto_path        = req.file.filename;
        // Acumula no array de fotos do campo — suporta múltiplas fotos por campo
        const r = insp.adicionarFoto({ preenchimento_id, campo_id, foto_path });
        res.json({ ok: true, data: r, foto_path });
      } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
    }
  );

  app.get('/api/inspecao/dashboard', (req, res) => {
    try {
      const { dataDe, dataAte } = req.query;
      res.json({ ok: true, data: insp.statsDashboard(dataDe, dataAte) });
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ── AUTOINSPEÇÃO DE EPI ────────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════════
  const autoInsp = require('./db_autoinspecao');

  // Itens da checklist — pública (o colaborador precisa ver sem login)
  app.get('/api/autoinspecao/campos', (req, res) => {
    try { res.json({ ok: true, data: autoInsp.listarCampos() }); }
    catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Gerenciar itens da checklist — protegido
  app.post('/api/autoinspecao/campos', requireAuth, requirePermissao('gerenciar_inspecao'), express.json(), (req, res) => {
    try { res.json({ ok: true, data: autoInsp.criarCampo(req.body) }); }
    catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.patch('/api/autoinspecao/campos/:id', requireAuth, requirePermissao('gerenciar_inspecao'), express.json(), (req, res) => {
    try { res.json({ ok: true, data: autoInsp.atualizarCampo(parseInt(req.params.id), req.body) }); }
    catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.delete('/api/autoinspecao/campos/:id', requireAuth, requirePermissao('gerenciar_inspecao'), (req, res) => {
    try { autoInsp.deletarCampo(parseInt(req.params.id)); res.json({ ok: true }); }
    catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Preenchimento — público (colaborador faz a autoinspeção sem login)
  app.post('/api/autoinspecao/preenchimentos', express.json(), (req, res) => {
    try {
      const { matricula, nome_tecnico, data_insp, hora_insp } = req.body;
      if (!matricula || !data_insp) return res.status(400).json({ ok: false, error: 'matricula e data_insp obrigatórios' });
      res.json({ ok: true, data: autoInsp.criarPreenchimento({ matricula, nome_tecnico, data_insp, hora_insp }) });
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/autoinspecao/preenchimentos/:id/respostas', express.json(), (req, res) => {
    try {
      const preenchimento_id = parseInt(req.params.id);
      const { campo_id, resposta_opcao, validade_data, observacao_texto } = req.body;
      if (!campo_id) return res.status(400).json({ ok: false, error: 'campo_id obrigatório' });
      res.json({ ok: true, data: autoInsp.salvarResposta({ preenchimento_id, campo_id, resposta_opcao, validade_data, observacao_texto }) });
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/autoinspecao/preenchimentos/:preId/campo/:campoId/foto',
    insp_upload.single('foto'), (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ ok: false, error: 'Nenhum arquivo enviado' });
        const r = autoInsp.adicionarFoto({
          preenchimento_id: parseInt(req.params.preId),
          campo_id: parseInt(req.params.campoId),
          foto_path: req.file.filename,
        });
        res.json({ ok: true, data: r, foto_path: req.file.filename });
      } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
    }
  );

  app.get('/api/autoinspecao/preenchimentos/:id', (req, res) => {
    try {
      const p = autoInsp.buscarPreenchimento(parseInt(req.params.id));
      if (!p) return res.status(404).json({ ok: false, error: 'Não encontrado' });
      res.json({ ok: true, data: { ...p, respostas: autoInsp.listarRespostas(p.id) } });
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Conclui e dispara alerta no WhatsApp se houver item irregular
  app.post('/api/autoinspecao/preenchimentos/:id/concluir', async (req, res) => {
    try {
      const preId = parseInt(req.params.id);
      const p = autoInsp.buscarPreenchimento(preId);
      if (!p) return res.status(404).json({ ok: false, error: 'Não encontrado' });
      const irregularidades = autoInsp.listarIrregularidades(preId);
      res.json({ ok: true, data: p, irregularidades });

      // Notifica SEMPRE que uma autoinspeção é registrada (grupo de retorno de atividades)
      try {
        const botState = require('./state');
        if (botState.isReady() && global._waClient) {
          const link = `${req.protocol}://${req.get('host')}/autoinspecao-detalhe.html?id=${preId}`;
          const msgRetorno =
            `🤖 *Sistema de Monitoramento Automático*\n` +
            `✅ Nova inspeção registrada no sistema\n` +
            `👷 ${p.nome_tecnico || p.matricula}\n` +
            `📅 ${p.data_insp}\n` +
            `📄 ${link}\n\n` +
            `_Gerado automaticamente pelo sistema OOMC_`;

          const grupoRetornoNome = process.env.GRUPO_AUTOINSP_NOME || process.env.GRUPO_RELATORIO_NOME || process.env.GRUPO_NOME || 'Resenha';
          if (global._grupoAutoInspId) {
            const chat = await global._waClient.getChatById(global._grupoAutoInspId);
            await chat.sendMessage(msgRetorno);
          } else {
            const chats = await global._waClient.getChats();
            const grupo = chats.find(c => c.isGroup && c.name === grupoRetornoNome);
            if (grupo) { global._grupoAutoInspId = grupo.id._serialized; await grupo.sendMessage(msgRetorno); }
            else console.warn('[AUTOINSPECAO] Grupo "' + grupoRetornoNome + '" não encontrado. Verifique GRUPO_AUTOINSP_NOME no .env');
          }
        }
      } catch(e) {
        console.error('[AUTOINSPECAO] Erro ao notificar grupo de retorno:', e.message);
        if (e.message?.includes('not found') || e.message?.includes('404')) global._grupoAutoInspId = null;
      }

      if (irregularidades.length) {
        try {
          const botState = require('./state');
          if (botState.isReady() && global._waClient) {
            const hora = new Date(Date.now() - 3*60*60*1000).toISOString().slice(11,16);
            const linhas = irregularidades.map(r => {
              const venc = r.validade_data ? ` (venceu ${r.validade_data})` : '';
              return `• ${r.label} — ${r.resposta_opcao}${venc}`;
            }).join('\n');
            const msgWA =
              `🤖 *Sistema de Monitoramento Automático*\n` +
              `⚠️ Itens irregulares na autoinspeção\n` +
              `👷 ${p.nome_tecnico || p.matricula}\n` +
              `📋 ${irregularidades.length} item(ns) irregular(es):\n${linhas}\n` +
              `⏰ ${hora}\n\n` +
              `_Gerado automaticamente pelo sistema OOMC_`;

            const grupoNome = process.env.GRUPO_INSP_NOME || process.env.GRUPO_NOME || 'Resenha';
            if (global._grupoInspId) {
              const chat = await global._waClient.getChatById(global._grupoInspId);
              await chat.sendMessage(msgWA);
            } else {
              const chats = await global._waClient.getChats();
              const grupo = chats.find(c => c.isGroup && c.name === grupoNome);
              if (grupo) { global._grupoInspId = grupo.id._serialized; await grupo.sendMessage(msgWA); }
            }
          }
        } catch(e) {
          console.error('[AUTOINSPECAO] Erro ao notificar grupo:', e.message);
          if (e.message?.includes('not found') || e.message?.includes('404')) global._grupoInspId = null;
        }
      }
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.delete('/api/autoinspecao/preenchimentos/:id', requireAuth, requirePermissao('gerenciar_inspecao'), (req, res) => {
    try {
      const id = parseInt(req.params.id);
      autoInsp.deletarPreenchimento(id);
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Dashboard e listagem — protegidos
  app.get('/api/autoinspecao/preenchimentos', requireAuth, requirePermissao('gerenciar_inspecao'), (req, res) => {
    try {
      const { matricula, dataDe, dataAte } = req.query;
      res.json({ ok: true, data: autoInsp.listarPreenchimentos({ matricula, dataDe, dataAte }) });
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.get('/api/autoinspecao/dashboard', requireAuth, requirePermissao('gerenciar_inspecao'), (req, res) => {
    try {
      const data_insp = req.query.data || (() => {
        const d = new Date(); return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+d.getFullYear();
      })();
      res.json({ ok: true, data: autoInsp.estatisticasDia(data_insp) });
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ── INDICADOR DE QUALIDADE — por Gerência (OOMC/OOMM/OOMT) + Geral ────────
  // ═══════════════════════════════════════════════════════════════════════════
  const indicador = require('./db_indicador');

  const COR_VERDE   = '#0d6b5f';
  const COR_VERDE2  = '#0a4f47';
  const COR_LARANJA = '#e8923a';

  // Quebra uma string em várias linhas (~maxChars por linha) sem cortar palavras
  function escXml(str) {
    return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  }

  function quebrarLinhas(txt, maxChars) {
    const palavras = (txt || '').split(' ');
    const linhas = [];
    let atual = '';
    for (const p of palavras) {
      if ((atual + ' ' + p).trim().length > maxChars) { linhas.push(atual.trim()); atual = p; }
      else { atual = (atual + ' ' + p).trim(); }
    }
    if (atual) linhas.push(atual);
    return linhas;
  }

  function cardSVG(x, sigla, dias, recorde) {
    const recordeTxt = recorde.recorde_dias > 0 ? `${recorde.recorde_dias} dias` : '—';
    const periodo = (recorde.recorde_inicio && recorde.recorde_fim)
      ? `de ${recorde.recorde_inicio} até ${recorde.recorde_fim}` : '';
    const ultimoBruto = recorde.ultimo_id
      ? [
          recorde.ultimo_data ? escXml(recorde.ultimo_data) : null,
          `ID: ${escXml(String(recorde.ultimo_id))}`,
          recorde.ultimo_tipo ? `Tipo: ${escXml(recorde.ultimo_tipo)}` : null,
          recorde.ultimo_se   ? `SE: ${escXml(recorde.ultimo_se)}`   : null,
          recorde.ultimo_equipamento ? `Equipamento: ${escXml(recorde.ultimo_equipamento)}` : null,
        ].filter(Boolean).join(' | ')
      : 'Sem registros';
    const ultimoLinhas = quebrarLinhas(ultimoBruto, 38);
    const ultimoTspans = ultimoLinhas.map((l, i) =>
      `<tspan x="30" dy="${i === 0 ? 0 : 16}">${l}</tspan>`
    ).join('');

    return `
    <g transform="translate(${x},185)">
      <rect width="380" height="430" rx="16" fill="#ffffff" stroke="#e2e8e6" stroke-width="1.5"/>
      <rect x="120" y="22" width="140" height="34" rx="17" fill="#e3f3ef"/>
      <text x="190" y="44" font-family="Arial,sans-serif" font-size="15" font-weight="800" fill="${COR_VERDE}" text-anchor="middle" letter-spacing="1">${sigla}</text>
      <text x="190" y="160" font-family="Arial Black,Arial,sans-serif" font-size="92" font-weight="900" fill="${COR_VERDE}" text-anchor="middle">${dias}</text>
      <text x="190" y="195" font-family="Arial,sans-serif" font-size="14" font-weight="700" fill="#52615e" text-anchor="middle" letter-spacing="1">DIAS SEM DESARMES</text>
      <line x1="30" y1="222" x2="350" y2="222" stroke="#eef2f1" stroke-width="1.5"/>
      <text x="190" y="252" font-family="Arial,sans-serif" font-size="14" fill="#52615e" text-anchor="middle">Recorde: <tspan font-weight="800" fill="${COR_LARANJA}">${recordeTxt}</tspan></text>
      <text x="190" y="270" font-family="Arial,sans-serif" font-size="11" fill="#8a9794" text-anchor="middle">${periodo}</text>
      <line x1="30" y1="296" x2="350" y2="296" stroke="#eef2f1" stroke-width="1.5"/>
      <text x="30" y="320" font-family="Arial,sans-serif" font-size="12" font-weight="800" fill="${COR_VERDE}">ÚLTIMO DESARME</text>
      <text x="30" y="340" font-family="Arial,sans-serif" font-size="12" fill="#52615e">${ultimoTspans}</text>
    </g>`;
  }

  function gerarImagemIndicador(dados, dataHora) {
    const outPath = path.join(__dirname, '..', 'data', `indicador_${Date.now()}.png`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    const geral = dados.GERAL;
    const ultimoGeral = geral.ultimo_id
      ? [
          geral.ultimo_data ? escXml(geral.ultimo_data) : null,
          `ID: ${escXml(String(geral.ultimo_id))}`,
          geral.ultimo_tipo ? `Tipo: ${escXml(geral.ultimo_tipo)}` : null,
          geral.ultimo_se   ? `SE: ${escXml(geral.ultimo_se)}`     : null,
          geral.ultimo_equipamento ? `Equipamento: ${escXml(geral.ultimo_equipamento)}` : null,
        ].filter(Boolean).join(' | ')
      : 'Sem registros';

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1240" height="870">
  <rect width="1240" height="870" fill="#f4f7f6"/>
  <rect width="1240" height="10" fill="${COR_VERDE}"/>
  <text x="40" y="55" font-family="Arial,sans-serif" font-size="13" font-weight="800" fill="${COR_VERDE}" letter-spacing="3">SEGURANÇA OPERACIONAL</text>
  <text x="40" y="100" font-family="Arial Black,Arial,sans-serif" font-size="38" font-weight="900" fill="${COR_VERDE2}">GERÊNCIA MANUTENÇÃO ALTA TENSÃO</text>
  <text x="40" y="128" font-family="Arial,sans-serif" font-size="15" fill="#52615e">Status consolidado de desarmes com interrupção</text>
  <line x1="40" y1="155" x2="1200" y2="155" stroke="#dde5e3" stroke-width="1.5"/>

  ${cardSVG(40,  'OOMC', dados.OOMC.dias, dados.OOMC)}
  ${cardSVG(430, 'OOMM', dados.OOMM.dias, dados.OOMM)}
  ${cardSVG(820, 'OOMT', dados.OOMT.dias, dados.OOMT)}

  <rect x="40" y="780" width="1160" height="70" rx="14" fill="#fdf3e7" stroke="${COR_LARANJA}" stroke-width="2"/>
  <text x="65" y="810" font-family="Arial,sans-serif" font-size="13" font-weight="800" fill="${COR_VERDE2}">CONSOLIDADO GERAL</text>
  <text x="65" y="830" font-family="Arial,sans-serif" font-size="11" fill="#7a685a">${ultimoGeral}</text>
  <text x="980" y="820" font-family="Arial Black,Arial,sans-serif" font-size="40" font-weight="900" fill="${COR_VERDE2}" text-anchor="middle">${geral.dias}</text>
  <text x="980" y="838" font-family="Arial,sans-serif" font-size="10" fill="#52615e" text-anchor="middle">DIAS SEM DESARME</text>
  <text x="1150" y="820" font-family="Arial Black,Arial,sans-serif" font-size="30" font-weight="900" fill="${COR_LARANJA}" text-anchor="end">${geral.recorde_dias}</text>
  <text x="1150" y="838" font-family="Arial,sans-serif" font-size="10" fill="#52615e" text-anchor="end">RECORDE GERAL</text>

  <text x="40" y="863" font-family="Arial,sans-serif" font-size="10" fill="#8a9794">GESTÃO DE ATIVOS E OCORRÊNCIAS</text>
  <text x="1200" y="863" font-family="Arial,sans-serif" font-size="10" fill="#8a9794" text-anchor="end">GERADO EM ${dataHora}</text>
</svg>`;

    const svgPath = outPath.replace('.png', '.svg');
    fs.writeFileSync(svgPath, svg);

    try {
      const sharp = require('sharp');
      sharp(Buffer.from(svg, 'utf8')).png().toFileSync(outPath);
      try { fs.unlinkSync(svgPath); } catch(e) {}
      return outPath;
    } catch(e) {
      return svgPath;
    }
  }

  async function dispararIndicador() {
    const botState = require('./state');
    if (!botState.isReady() || !global._waClient) return;

    const dados = indicador.buscarTodas();
    const agoraBR = new Date(Date.now() - 3*60*60*1000);
    const dataHora = String(agoraBR.getUTCDate()).padStart(2,'0')+'/'+
      String(agoraBR.getUTCMonth()+1).padStart(2,'0')+'/'+agoraBR.getUTCFullYear()+
      ' às '+String(agoraBR.getUTCHours()).padStart(2,'0')+':'+String(agoraBR.getUTCMinutes()).padStart(2,'0');

    const msgTexto =
      `🤖 *Sistema de Monitoramento Automático*\n\n` +
      `🏆 *INDICADOR DE QUALIDADE*\n\n` +
      `🏆 *OOMC: ${dados.OOMC.dias} dias sem desarme*\n` +
      `🏆 *OOMM: ${dados.OOMM.dias} dias sem desarme*\n` +
      `🏆 *OOMT: ${dados.OOMT.dias} dias sem desarme*\n` +
      `✅ *Geral: ${dados.GERAL.dias} dias sem desarme*\n\n` +
      `🕐 Atualizado em: ${dataHora}\n\n` +
      `_Gerado automaticamente pelo sistema OOMC_`;

    const grupoNome = process.env.GRUPO_INDICADOR_NOME || process.env.GRUPO_NOME || 'Resenha';

    try {
      if (!global._grupoIndicadorId) {
        const chats = await global._waClient.getChats();
        const grupo = chats.find(c => c.isGroup && c.name === grupoNome);
        if (!grupo) { console.warn('[INDICADOR] Grupo "' + grupoNome + '" não encontrado.'); return; }
        global._grupoIndicadorId = grupo.id._serialized;
      }
      const chat = await global._waClient.getChatById(global._grupoIndicadorId);

      try {
        const imgPath = gerarImagemIndicador(dados, dataHora);
        const { MessageMedia } = require('whatsapp-web.js');
        const media = MessageMedia.fromFilePath(imgPath);
        await chat.sendMessage(media, { caption: msgTexto });
        try { fs.unlinkSync(imgPath); } catch(e) {}
      } catch(imgErr) {
        console.warn('[INDICADOR] Falha ao gerar imagem, enviando só texto:', imgErr.message);
        await chat.sendMessage(msgTexto);
      }

      console.log(`[INDICADOR] Disparado — grupo: ${grupoNome}`);
    } catch(e) {
      console.error('[INDICADOR] Erro ao disparar:', e.message);
      if (e.message?.includes('not found') || e.message?.includes('404')) global._grupoIndicadorId = null;
    }
  }

  // Cron: roda a cada minuto pra verificar incremento meia-noite e horários de disparo
  setInterval(async () => {
    try {
      const agoraBR = new Date(Date.now() - 3*60*60*1000);
      const hh = String(agoraBR.getUTCHours()).padStart(2,'0');
      const mm = String(agoraBR.getUTCMinutes()).padStart(2,'0');
      const horaAtual = `${hh}:${mm}`;

      if (horaAtual === '00:00') {
        indicador.incrementarTodas();
        console.log('[INDICADOR] +1 dia em todas as gerências.');
      }

      const geral = indicador.buscar('GERAL');
      if (geral?.horario1 && horaAtual === geral.horario1) await dispararIndicador();
      if (geral?.horario2 && horaAtual === geral.horario2) await dispararIndicador();
    } catch(e) { console.error('[INDICADOR] Cron error:', e.message); }
  }, 60_000);

  // Rotas
  app.get('/api/indicador', requireAuth, (req, res) => {
    try { res.json({ ok: true, data: indicador.buscarTodas() }); }
    catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.patch('/api/indicador/horarios', requireAuth, requirePermissao('gerenciar_usuarios'), express.json(), (req, res) => {
    try { res.json({ ok: true, data: indicador.atualizarHorarios('GERAL', req.body) }); }
    catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.patch('/api/indicador/:gerencia/dias', requireAuth, requirePermissao('gerenciar_usuarios'), express.json(), (req, res) => {
    try {
      const gerencia = req.params.gerencia.toUpperCase();
      if (!indicador.GERENCIAS.includes(gerencia)) return res.status(400).json({ ok: false, error: 'Gerência inválida' });
      const dias = parseInt(req.body.dias);
      if (isNaN(dias) || dias < 0) return res.status(400).json({ ok: false, error: 'Valor inválido' });
      indicador.setDias(gerencia, dias);
      res.json({ ok: true, data: indicador.buscar(gerencia) });
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.patch('/api/indicador/:gerencia/recorde', requireAuth, requirePermissao('gerenciar_usuarios'), express.json(), (req, res) => {
    try {
      const gerencia = req.params.gerencia.toUpperCase();
      if (!indicador.GERENCIAS.includes(gerencia)) return res.status(400).json({ ok: false, error: 'Gerência inválida' });
      const { recorde_dias, recorde_inicio, recorde_fim } = req.body;
      indicador.setRecorde(gerencia, parseInt(recorde_dias) || 0, recorde_inicio, recorde_fim);
      res.json({ ok: true, data: indicador.buscar(gerencia) });
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/indicador/:gerencia/zerar', requireAuth, requirePermissao('gerenciar_usuarios'), async (req, res) => {
    try {
      const gerencia = req.params.gerencia.toUpperCase();
      if (!indicador.GERENCIAS.includes(gerencia)) return res.status(400).json({ ok: false, error: 'Gerência inválida' });
      const dados = indicador.registrarDesarme(gerencia, {});
      res.json({ ok: true, data: dados });
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  app.post('/api/indicador/disparar', requireAuth, requirePermissao('gerenciar_usuarios'), async (req, res) => {
    try {
      await dispararIndicador();
      res.json({ ok: true, msg: 'Disparado!' });
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Liga/desliga alertas automáticos de desarme no grupo (o registro/zerar continua acontecendo)
  app.post('/api/indicador/mute', requireAuth, requirePermissao('gerenciar_usuarios'), express.json(), (req, res) => {
    try {
      const mutado = !!req.body.mute;
      const dados = indicador.setMute(mutado);
      res.json({ ok: true, data: dados });
    } catch(e) { res.status(500).json({ ok: false, error: e.message }); }
  });

  // Sincroniza o "último desarme" de cada gerência com o histórico real do SharePoint
  // (NÃO zera dias nem mexe no recorde — só preenche o card de "último desarme")
  // Chamada pelo desarme-monitor.js (modo --sync), sem disparar mensagem no WhatsApp
  app.post('/api/indicador/sincronizar-historico', express.json(), (req, res) => {
    try {
      const chave = req.headers['x-desarme-key'];
      if (chave !== process.env.DESARME_SECRET) {
        return res.status(403).json({ ok: false, error: 'Chave inválida' });
      }
      const itens = Array.isArray(req.body.itens) ? req.body.itens : [];
      const resultado = {};
      let maisRecente = null;
      for (const item of itens) {
        const { gerencia, sharepoint_id, titulo, tipo, se, data, equipamento } = item;
        if (!indicador.GERENCIAS.includes(gerencia) || gerencia === 'GERAL') continue;
        resultado[gerencia] = indicador.setUltimoDesarme(gerencia, { id: sharepoint_id, titulo, tipo, se, data, equipamento });
        if (!maisRecente || parseInt(sharepoint_id) > parseInt(maisRecente.sharepoint_id)) {
          maisRecente = { sharepoint_id, titulo, tipo, se, data };
        }
      }
      if (maisRecente) {
        resultado['GERAL'] = indicador.setUltimoDesarme('GERAL', { id: maisRecente.sharepoint_id, titulo: maisRecente.titulo, tipo: maisRecente.tipo, se: maisRecente.se, data: maisRecente.data, equipamento: maisRecente.equipamento });
      }
      res.json({ ok: true, data: resultado });
    } catch(e) {
      console.error('[SYNC-HIST] Erro:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Detecção automática de Desarme via SharePoint (Ocorrencias AT) ───────
  // Recebe a gerência já resolvida pelo desarme-monitor.js (via mapa SE→Gerência)
  app.post('/api/indicador/desarme-detectado', express.json(), async (req, res) => {
    try {
      const chave = req.headers['x-desarme-key'];
      if (chave !== process.env.DESARME_SECRET) {
        return res.status(403).json({ ok: false, error: 'Chave inválida' });
      }

      const { sharepoint_id, titulo, tipo, se, gerencia, equipamento, data } = req.body || {};
      if (!indicador.GERENCIAS.includes(gerencia) || gerencia === 'GERAL') {
        console.warn('[DESARME] Gerência inválida ou ausente:', gerencia, '— SE:', se);
        return res.status(400).json({ ok: false, error: 'Gerência inválida/ausente' });
      }

      const info = { id: sharepoint_id, titulo, tipo, se, equipamento, data };
      const dados = indicador.registrarDesarme(gerencia, info);
      res.json({ ok: true, data: dados });

      const botState = require('./state');
      if (!botState.isReady() || !global._waClient) return;
      if (indicador.estaMutado()) {
        console.log('[DESARME] Alertas automáticos mutados — não enviado ao grupo (dados já registrados).');
        return;
      }

      const grupoNome = process.env.GRUPO_CIAO_NOME || process.env.GRUPO_NOME || 'Resenha';
      const agoraBR = new Date(Date.now() - 3*60*60*1000);
      const dataHora = String(agoraBR.getUTCDate()).padStart(2,'0')+'/'+
        String(agoraBR.getUTCMonth()+1).padStart(2,'0')+'/'+agoraBR.getUTCFullYear()+
        ' às '+String(agoraBR.getUTCHours()).padStart(2,'0')+':'+String(agoraBR.getUTCMinutes()).padStart(2,'0');

      const msg =
        `🤖 *Sistema de Monitoramento Automático*\n\n` +
        `🚨 *DESARME REGISTRADO — ${gerencia}*\n\n` +
        (titulo ? `📋 ${titulo}\n` : '') +
        (tipo   ? `🔧 Tipo: ${tipo}\n` : '') +
        (se     ? `📍 SE: ${se}\n` : '') +
        (sharepoint_id ? `🆔 Ocorrência: ${sharepoint_id}\n` : '') +
        `🔄 Indicador ${gerencia} e Geral zerados\n` +
        `🕐 ${dataHora}\n\n` +
        `_Gerado automaticamente pelo sistema OOMC_`;

      try {
        if (!global._grupoCiaoId) {
          const chats = await global._waClient.getChats();
          const grupo = chats.find(c => c.isGroup && c.name === grupoNome);
          if (!grupo) { console.warn('[DESARME] Grupo "' + grupoNome + '" não encontrado.'); return; }
          global._grupoCiaoId = grupo.id._serialized;
        }
        const chat = await global._waClient.getChatById(global._grupoCiaoId);

        try {
          const dadosTodos = indicador.buscarTodas();
          const imgPath = gerarImagemIndicador(dadosTodos, dataHora);
          const { MessageMedia } = require('whatsapp-web.js');
          const media = MessageMedia.fromFilePath(imgPath);
          await chat.sendMessage(media, { caption: msg });
          try { fs.unlinkSync(imgPath); } catch(e) {}
        } catch(imgErr) {
          console.warn('[DESARME] Falha ao gerar imagem, enviando só texto:', imgErr.message);
          await chat.sendMessage(msg);
        }

        console.log('[DESARME] Notificado grupo:', grupoNome, '— gerência:', gerencia);
      } catch(e) {
        console.error('[DESARME] Erro ao notificar:', e.message);
        if (e.message?.includes('not found') || e.message?.includes('404')) global._grupoCiaoId = null;
      }
    } catch(e) {
      console.error('[DESARME] Erro:', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════

  // ── Relatório de Inspeções WhatsApp (grupo separado) ─────────────────────
  app.post('/api/relatorio/inspecoes/enviar', requireAuth, requirePermissao('enviar_relatorio_operacao'), async (req, res) => {
    try {
      const botState = require('./state');
      if (!botState.isReady() || !global._waClient) {
        return res.status(503).json({ ok: false, error: 'Bot WhatsApp não conectado' });
      }

      const GRUPO_INSP = process.env.GRUPO_INSP_NOME || process.env.GRUPO_NOME || 'Resenha';

      // Resolve grupo de inspeção (cache separado do grupo principal)
      if (!global._grupoInspId) {
        const chats = await global._waClient.getChats();
        const grupo  = chats.find(c => c.isGroup && c.name === GRUPO_INSP);
        if (!grupo) return res.status(404).json({ ok: false, error: `Grupo "${GRUPO_INSP}" não encontrado. Verifique GRUPO_INSP_NOME no .env` });
        global._grupoInspId = grupo.id._serialized;
      }

      // Data Brasília (UTC-3)
      const agoraBR = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const y  = agoraBR.getUTCFullYear();
      const m  = String(agoraBR.getUTCMonth()+1).padStart(2,'0');
      const d  = String(agoraBR.getUTCDate()).padStart(2,'0');
      const hh = String(agoraBR.getUTCHours()).padStart(2,'0');
      const mi = String(agoraBR.getUTCMinutes()).padStart(2,'0');
      const dataISO = `${y}-${m}-${d}`;
      const dataFmt = `${d}/${m}/${y}`;
      const horaFmt = `${hh}:${mi}`;

      // Inspeções do dia
      const inspStats = insp.statsDashboard(dataISO, dataISO);
      const preenchimentos = insp.listarPreenchimentos({ dataDe: dataISO, dataAte: dataISO });

      // Monta mensagem
      const linhas = [];
      linhas.push('🔍 *Sistema de Monitoramento — Inspeções*');
      linhas.push(`📊 Relatório de Inspeções — ${dataFmt} às ${horaFmt}`);
      linhas.push('');
      linhas.push(`📋 *Total hoje: ${inspStats.total || 0}* (${inspStats.concluidas || 0} concluída(s) / ${(inspStats.total - inspStats.concluidas) || 0} rascunho(s))`);
      linhas.push('');

      if (preenchimentos.length > 0) {
        preenchimentos.forEach(p => {
          const icon  = p.status === 'Concluído' ? '✅' : '⏳';
          const se    = p.nome_se ? `${p.codigo_se} — ${p.nome_se}` : p.codigo_se;
          const tec   = p.nome_tecnico || p.matricula || '—';
          const hora  = p.hora_insp || p.data_insp || '—';
          linhas.push(`${icon} SE ${se} | ${tec} | ${hora}`);
        });
        linhas.push('');
      } else {
        linhas.push('📭 Nenhuma inspeção registrada hoje.');
        linhas.push('');
      }

      // SEs inspecionadas
      if (inspStats.porSE && inspStats.porSE.length > 0) {
        linhas.push(`📍 *SEs inspecionadas: ${inspStats.porSE.map(s => s.codigo_se).join(', ')}*`);
        linhas.push('');
      }

      // Colaboradores em campo agora — combina check-ins ativos + equipe das OS em andamento hoje
      const checkinsAtivosInsp = db.all(`SELECT nome, matricula, subestacao FROM checkins WHERE status='Ativo' ORDER BY entrada DESC`);
      const osAndamentoHoje = db.all(
        `SELECT equipe, subestacoes, unidade FROM ordens_servico
         WHERE status='Andamento' AND date(criado_em) = date('now','localtime')`
      );
      const colabInspMap = new Map(); // nome -> SE
      checkinsAtivosInsp.forEach(c => {
        const n = (c.nome || c.matricula || '').trim();
        if (n) colabInspMap.set(n, c.subestacao || '—');
      });
      osAndamentoHoje.forEach(os => {
        const se = (os.subestacoes || os.unidade || '—').trim();
        (os.equipe || '').split(',').forEach(n => {
          const t = n.trim();
          if (t && !colabInspMap.has(t)) colabInspMap.set(t, se);
        });
      });
      if (colabInspMap.size > 0) {
        linhas.push(`👷 *${colabInspMap.size} colaborador(es) em campo no momento*`);
        colabInspMap.forEach((se, nome) => linhas.push(`📍 SE ${se} | ${nome}`));
        linhas.push('');
      } else {
        linhas.push('👷 *Nenhum colaborador em campo no momento*');
        linhas.push('');
      }

      linhas.push('_Gerado automaticamente pelo sistema OOMC_');

      const msg = linhas.join('\n').trim();

      const chat = await global._waClient.getChatById(global._grupoInspId);
      await chat.sendMessage(msg);

      res.json({ ok: true, msg: `Relatório enviado para "${GRUPO_INSP}"!`, preview: msg });
    } catch(e) {
      console.error('[RELATORIO-INSP]', e.message);
      // Se erro de grupo não encontrado, limpa cache para tentar de novo
      if (e.message?.includes('not found') || e.message?.includes('404')) {
        global._grupoInspId = null;
      }
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Screenshot do painel (para anexar ao relatório) ─────────────────────
  async function capturarTelaDosPainel() {
    let browser;
    try {
      const puppeteer = require('puppeteer');
      browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      const page = await browser.newPage();
      page.setViewport({ width: 1280, height: 900 });
      
      const urlLocal = `http://localhost:${PORT}/index.html`;
      await page.goto(urlLocal, { waitUntil: 'networkidle0', timeout: 30000 });
      
      // Verifica se está pedindo login
      const temLogin = await page.$('input[type="password"], [placeholder*="senha"], form');
      if (temLogin) {
        const USER = process.env.ADMIN_USER || 'admin';
        const PASS = process.env.ADMIN_PASS || 'admin';
        
        // Preenche e submete login
        await page.type('input[type="text"], input[name="username"]', USER).catch(() => {});
        await page.type('input[type="password"]', PASS).catch(() => {});
        await page.click('button[type="submit"], button').catch(() => {});
        
        // Aguarda redirecionamento pra dashboard
        await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {});
      }
      
      // Aguarda o painel carregar (elemento com a tabela de OS ou badge de indicador)
      await page.waitForFunction(
        () => {
          const table = document.querySelector('table');
          const badge = document.querySelector('[class*="badge"]');
          const loaded = (table && table.querySelectorAll('tr').length > 1) || (badge && badge.textContent.trim());
          return loaded;
        },
        { timeout: 20000 }
      ).catch(() => {});
      
      // Aguarda mais 3s pra garantir que animações terminaram e dados estão renderizados
      await page.evaluate(() => new Promise(r => setTimeout(r, 3000)));
      
      const screenshotPath = path.join(__dirname, '..', 'data', `painel_screenshot_${Date.now()}.png`);
      fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
      
      await page.screenshot({ path: screenshotPath, fullPage: false });
      console.log('[SCREENSHOT] Captura salva em:', screenshotPath);
      
      return screenshotPath;
    } catch(e) {
      console.error('[SCREENSHOT] Erro ao capturar tela:', e.message);
      return null;
    } finally {
      if (browser) await browser.close();
    }
  }

  // ── Relatório diário WhatsApp ─────────────────────────────────────────────
  app.post('/api/relatorio/enviar', requireAuth, requirePermissao('enviar_relatorio_painel'), async (req, res) => {
    try {
      const botState = require('./state');

      // Aguarda até 10s pelo bot ficar pronto (caso tenha acabado de escanear o QR)
      if (!botState.isReady() || !global._waClient) {
        await new Promise((resolve, reject) => {
          const MAX = 10000, STEP = 500;
          let elapsed = 0;
          const t = setInterval(() => {
            if (botState.isReady() && global._waClient) { clearInterval(t); resolve(); }
            else if ((elapsed += STEP) >= MAX) { clearInterval(t); reject(new Error('Bot WhatsApp não conectado')); }
          }, STEP);
        });
      }

      // Data/hora de Brasília (UTC-3)
      const agoraBR = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const y  = agoraBR.getUTCFullYear();
      const m  = String(agoraBR.getUTCMonth()+1).padStart(2,'0');
      const d  = String(agoraBR.getUTCDate()).padStart(2,'0');
      const hh = String(agoraBR.getUTCHours()).padStart(2,'0');
      const mi = String(agoraBR.getUTCMinutes()).padStart(2,'0');
      // Campo `data` no banco é DD/MM/YYYY
      const dataFmt  = `${d}/${m}/${y}`;
      const horaFmt  = `${hh}:${mi}`;

      // OS do dia — usa o campo `data` (mesmo critério da prévia e do painel de stats)
      const osHoje = db.all(
        `SELECT status, subestacoes, unidade, equipe FROM ordens_servico
         WHERE data = ?
         ORDER BY criado_em DESC`,
        [dataFmt]
      );

      const osAndamento  = osHoje.filter(o => o.status === 'Andamento');
      const osConcluidas = osHoje.filter(o => o.status === 'Concluído');
      const osEtapa      = osHoje.filter(o => o.status === 'Etapa Concluída');
      const osCanceladas = osHoje.filter(o => o.status === 'Cancelado');

      // Colaboradores em campo agora — baseado apenas na equipe das OS em andamento HOJE
      const colabSet = new Set();
      osAndamento.forEach(os => {
        (os.equipe || '').split(',').forEach(n => { const t = n.trim(); if (t) colabSet.add(t); });
      });
      const ativos = Array.from(colabSet);

      // Inspeções do dia
      const dataISO   = `${y}-${m}-${d}`;
      const inspStats = insp.statsDashboard(dataISO, dataISO);

      // ── Monta mensagem ──
      const linhas = [];
      linhas.push('🤖 *Sistema de Monitoramento Automático*');
      linhas.push(`📊 Relatório diário gerado — ${dataFmt} às ${horaFmt}`);
      linhas.push('');

      // Em andamento
      linhas.push(`⚡ *Em andamento: ${osAndamento.length}*`);
      osAndamento.forEach(os => {
        const se    = (os.subestacoes || os.unidade || '—').trim();
        const nomes = (os.equipe || '—').split(',').map(n => {
          const p = n.trim().split(' ');
          return p[0] + (p[1] ? ' ' + p[1] : '');
        }).join(' / ');
        linhas.push(`📍 SE ${se} | ${nomes}`);
      });
      linhas.push('');

      // Concluídas
      linhas.push(`✅ *Concluídas hoje: ${osConcluidas.length}*`);
      if (osEtapa.length > 0)      linhas.push(`🔄 *Etapa concluída: ${osEtapa.length}*`);
      if (osCanceladas.length > 0) linhas.push(`❌ *Canceladas: ${osCanceladas.length}*`);
      linhas.push('');

      // Colaboradores em campo
      if (ativos.length > 0) {
        linhas.push(`👷 *${ativos.length} colaborador(es) em campo no momento*`);
      } else {
        linhas.push('👷 *Nenhum colaborador em campo no momento*');
      }
      linhas.push('');

      // Inspeções
      if (inspStats.total > 0) {
        linhas.push('');
        linhas.push(`🔍 *Inspeções hoje: ${inspStats.total}* (${inspStats.concluidas} concluída(s))`);
      }

      linhas.push('');
      linhas.push('_Gerado automaticamente pelo sistema OOMC_');

      const msg = linhas.join('\n').trim();

      // Captura screenshot do painel no momento do disparo
      let screenshotPath = null;
      try {
        console.log('[RELATORIO] Capturando screenshot...');
        screenshotPath = await capturarTelaDosPainel();
        console.log('[RELATORIO] Screenshot capturado:', screenshotPath, '| Existe:', screenshotPath ? fs.existsSync(screenshotPath) : 'N/A');
      } catch(screenshotErr) {
        console.error('[RELATORIO] Erro ao capturar screenshot:', screenshotErr.message);
      }

      // Envia ao grupo de relatórios (separado do grupo de monitoramento de resenha)
      const GRUPO_REL = process.env.GRUPO_RELATORIO_NOME || process.env.GRUPO_NOME || 'Resenha';
      if (global._grupoRelId) {
        const chat = await global._waClient.getChatById(global._grupoRelId);
        if (screenshotPath && fs.existsSync(screenshotPath)) {
          try {
            const { MessageMedia } = require('whatsapp-web.js');
            const media = MessageMedia.fromFilePath(screenshotPath);
            await chat.sendMessage(media, { caption: msg });
          } catch(mediaErr) {
            console.warn('[RELATORIO] Erro ao enviar imagem, tentando só texto:', mediaErr.message);
            await chat.sendMessage(msg);
          }
        } else {
          await chat.sendMessage(msg);
        }
      } else {
        const chats = await global._waClient.getChats();
        const grupo  = chats.find(c => c.isGroup && c.name === GRUPO_REL);
        if (!grupo) return res.status(404).json({ ok: false, error: `Grupo "${GRUPO_REL}" não encontrado. Verifique GRUPO_RELATORIO_NOME.` });
        global._grupoRelId = grupo.id._serialized;
        if (screenshotPath && fs.existsSync(screenshotPath)) {
          try {
            const { MessageMedia } = require('whatsapp-web.js');
            const media = MessageMedia.fromFilePath(screenshotPath);
            await grupo.sendMessage(media, { caption: msg });
          } catch(mediaErr) {
            console.warn('[RELATORIO] Erro ao enviar imagem, tentando só texto:', mediaErr.message);
            await grupo.sendMessage(msg);
          }
        } else {
          await grupo.sendMessage(msg);
        }
      }

      // Limpa arquivo de screenshot
      if (screenshotPath) {
        try { fs.unlinkSync(screenshotPath); } catch(e) {}
      }

      res.json({ ok: true, msg: 'Relatório enviado!', preview: msg });
    } catch(e) {
      console.error('[RELATORIO]', e.message);
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════

  app.listen(PORT, () => {
    console.log(`[SERVER] Painel rodando em http://localhost:${PORT}`);
  });
}

module.exports = { startServer };
