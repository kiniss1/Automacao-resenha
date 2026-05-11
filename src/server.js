// src/server.js
const express = require('express');
const cors    = require('cors');
const path    = require('path');
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

  app.get('/api/os', (req, res) => {
    try {
      const { status, unidade, search } = req.query;
      res.json({ ok: true, data: db.listarOS({ status, unidade, search }) });
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
      const id     = parseInt(req.params.id, 10);
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

  app.get('/api/bot-status', (_req, res) => {
    res.json({ ready: state.isReady(), hasQR: !!state.getQR() });
  });

  app.listen(PORT, () => {
    console.log(`[SERVER] Painel rodando em http://localhost:${PORT}`);
  });
}

module.exports = { startServer };