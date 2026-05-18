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

    // Encerra o processo após responder — Railway reinicia automaticamente
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

  app.get('/api/stats', (_req, res) => {
    try {
      res.json({ ok: true, data: db.estatisticas() });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.patch('/api/os/:id', (req, res) => {
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

  app.delete('/api/os/:id', (req, res) => {
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

  app.get('/api/checkin/ativo/:matricula', (req, res) => {
    try {
      const c = require('./checkin');
      // Reusa get interno via listarAtivos filtrado
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

  app.post('/api/checkout', (req, res) => {
    try {
      const { matricula } = req.body;
      if (!matricula) return res.status(400).json({ ok: false, erro: true, msg: 'Matrícula obrigatória.' });
      const result = checkin.fazerCheckout(matricula);
      res.json({ ok: !result.erro, ...result });
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

      // Deduplica ordens pelo código de OS antes de processar
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
        // descricao_inicial → título do card (imutável após criação)
        // descricao_final   → o que foi feito (só no final)
        const descInicial = tipo === 'inicial' ? (o.servico || o.descricao_inicial || null) : null;
        const descFinal   = tipo === 'final'   ? (o.servico || o.descricao_final   || null) : null;
        // servico = sempre o planejado (descricao_inicial); no final não sobrescreve
        const servicoBase = tipo === 'inicial'
          ? (descInicial || '')
          : (o.descricao_inicial || o.servico || ''); // preserva o que já estava
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

      // Envia mensagem de confirmação no WhatsApp
      try {
        const botState = require('./state');
        if (botState.isReady() && global._waClient) {
          const baseUrl = process.env.PUBLIC_URL || ('https://' + req.headers.host);
          const ordensComLink = registradas.map(r => ({ ...r, aprLink: baseUrl + '/apr.html?os=' + encodeURIComponent(r.os) }));
          const msgWA = formatMsgWhatsApp({ tipo, guarda, horario, dia_semana, data, equipe, telefone, veiculo, ordens: ordensComLink });

          if (global._grupoId) {
            // Envio direto pelo ID salvo — mais rápido e confiável
            const chat = await global._waClient.getChatById(global._grupoId);
            await chat.sendMessage(msgWA);
            console.log('[ATIVIDADE] ✅ Mensagem enviada ao grupo.');
          } else {
            // Fallback: busca pelos chats
            const grupoNome = process.env.GRUPO_NOME || 'Resenha';
            const chats = await global._waClient.getChats();
            const grupo = chats.find(c => c.isGroup && c.name === grupoNome);
            if (grupo) {
              global._grupoId = grupo.id._serialized; // salva para próxima vez
              await grupo.sendMessage(msgWA);
              console.log('[ATIVIDADE] ✅ Mensagem enviada ao grupo (fallback).');
            } else {
              console.warn('[ATIVIDADE] ⚠️ Grupo não encontrado. GRUPO_NOME =', grupoNome);
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

  // ── APR upload/serve ──────────────────────────────────────────────────────
  const multer = require('multer');
  const APR_DIR = process.env.APR_DIR || '/data/apr';
  require('fs').mkdirSync(APR_DIR, { recursive: true });

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, APR_DIR),
    filename: (req, _file, cb) => cb(null, 'apr_' + req.params.id + '.jpg'),
  });
  const upload = multer({
    storage,
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
    fileFilter: (_req, file, cb) => {
      cb(null, file.mimetype.startsWith('image/'));
    },
  });

  app.post('/api/os/:id/apr', upload.single('apr'), (req, res) => {
    try {
      const id   = parseInt(req.params.id, 10);
      const fs   = require('fs');
      const path = require('path');
      if (!req.file) return res.status(400).json({ ok: false, error: 'Nenhum arquivo enviado.' });
      // Renomeia para frente explícito
      const newPath = path.join(APR_DIR, 'apr_' + id + '_frente.jpg');
      fs.renameSync(req.file.path, newPath);
      db.updateAprPath(id, newPath);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Upload verso
  app.post('/api/os/:id/apr-verso', upload.single('apr'), (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!req.file) return res.status(400).json({ ok: false, error: 'Nenhum arquivo enviado.' });
      // Renomeia para verso
      const fs   = require('fs');
      const path = require('path');
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
      const fs  = require('fs');
      const path = require('path');

      // Tenta o caminho salvo no banco primeiro
      const os = db.buscarPorId(id);
      if (os && os.apr_path && fs.existsSync(os.apr_path)) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'private, max-age=3600');
        return fs.createReadStream(os.apr_path).pipe(res);
      }

      // Fallback: tenta o caminho padrão baseado no ID
      const APR_DIR = process.env.APR_DIR || '/data/apr';
      const fallback = path.join(APR_DIR, 'apr_' + id + '.jpg');
      if (fs.existsSync(fallback)) {
        // Atualiza o banco com o caminho correto
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
      const fs   = require('fs');
      const path = require('path');
      const os   = db.buscarPorId(id);
      const APR_DIR = process.env.APR_DIR || '/data/apr';
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

  // ── SharePoint Queue ─────────────────────────────────────────────────────
  // Gestor clica "Enviar ao SharePoint" → adiciona à fila
  app.post('/api/sp-enviar/:id', express.json(), (req, res) => {
    try {
      const id   = parseInt(req.params.id, 10);
      const peso = req.body?.peso || null;
      const os   = db.buscarPorId(id);
      if (!os) return res.status(404).json({ ok: false, error: 'OS não encontrada' });
      if (os.sp_enviado === 1) return res.json({ ok: true, msg: 'Já enviado ao SharePoint', ja_enviado: true });
      // Armazena o peso junto (reutiliza campo trajeto não — usa campo auxiliar)
      db.run('UPDATE ordens_servico SET sp_enviado=2, sp_peso=? WHERE id=?', [peso, id]);
      res.json({ ok: true, msg: 'OS adicionada à fila do SharePoint' });
    } catch(e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // sync.js no PC consulta esta rota para pegar OS pendentes
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

  // sync.js chama esta rota após enviar com sucesso ao SP
  app.post('/api/sp-confirmado/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      db.marcarSpEnviado(id);
      res.json({ ok: true });
    } catch(e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // sync.js chama se falhar — volta para sp_enviado=0 (não enviado)
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
    res.json({ ready: state.isReady(), hasQR: !!state.getQR() });
  });

  app.listen(PORT, () => {
    console.log(`[SERVER] Painel rodando em http://localhost:${PORT}`);
  });
}

module.exports = { startServer };
