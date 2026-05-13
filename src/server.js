// src/server.js
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const db      = require('./db');
const state   = require('./state');

const PORT = process.env.PORT || 3000;
const STATUS_VALIDOS = ['Andamento', 'Concluído', 'Cancelado'];

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
  app.post('/api/atividade', (req, res) => {
    try {
      const { tipo, guarda, horario, dia_semana, data, equipe, telefone, veiculo, trajeto, ordens } = req.body;

      if (!ordens || !ordens.length) return res.status(400).json({ ok: false, error: 'Nenhuma atividade informada.' });

      const registradas = [];

      for (const o of ordens) {
        if (!o.servico) continue;

        // Gera ID estável (número da OS ou hash do texto)
        let osId = o.os && o.os.trim() ? o.os.trim() : null;
        if (!osId) {
          const norm = (o.servico || '').toLowerCase().replace(/[^a-z0-9\s]/g,'').trim().replace(/\s+/g,' ');
          const prefixo = norm.split(' ').slice(0,3).join('-').toUpperCase().substring(0,20);
          const h = norm.split('').reduce((h,c) => (((h<<5)+h)+c.charCodeAt(0))|0, 5381);
          osId = prefixo + '-' + Math.abs(h).toString(36).toUpperCase();
        }

        // Monta serviço com trajeto se houver
        const servicoFinal = trajeto ? o.servico + ' | Trajeto: ' + trajeto : o.servico;
        const status = tipo === 'final' ? (o.status || 'Concluído') : 'Andamento';

        db.inserirOS({
          os:          osId,
          unidade:     o.unidade || '—',
          equipe,
          veiculo:     veiculo || null,
          servico:     servicoFinal,
          status,
          data:        data || null,
          guarda:      guarda || null,
          horario:     horario || null,
          dia_semana:  dia_semana || null,
          telefone:    telefone || null,
          subestacoes: o.unidade || null,
          saida_base:  null,
          chegada_base: null,
        });

        registradas.push({ os: osId, unidade: o.unidade, status });
      }

      res.json({ ok: true, registradas });
    } catch (err) {
      console.error('[API] POST /api/atividade:', err.message);
      res.status(500).json({ ok: false, error: err.message });
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
