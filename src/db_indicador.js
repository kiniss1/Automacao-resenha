// src/db_indicador.js — Contador de dias sem desarme
let db;

function setDb(database) {
  db = database;
  db.run(`
    CREATE TABLE IF NOT EXISTS indicador_qualidade (
      id              INTEGER PRIMARY KEY DEFAULT 1,
      dias            INTEGER NOT NULL DEFAULT 0,
      ultimo_reset    TEXT,
      ultimo_disparo  TEXT,
      horario1        TEXT NOT NULL DEFAULT '07:00',
      horario2        TEXT,
      criado_em       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `);
  // Garante que sempre existe exatamente 1 linha (id=1)
  const row = get(`SELECT * FROM indicador_qualidade WHERE id=1`);
  if (!row) {
    db.run(`INSERT INTO indicador_qualidade (id, dias) VALUES (1, 0)`);
    persist();
  }
}

function persist() {
  try {
    const fs   = require('fs');
    const path = require('path');
    const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'os_local.db');
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  } catch(e) { console.error('[DB_INDICADOR] Erro ao salvar:', e.message); }
}

function run(sql, params = []) { db.run(sql, params); persist(); }

function get(sql, params = []) {
  const s = db.prepare(sql); s.bind(params);
  const r = s.step() ? s.getAsObject() : null; s.free(); return r;
}

function buscar() {
  return get(`SELECT * FROM indicador_qualidade WHERE id=1`);
}

function incrementar() {
  run(`UPDATE indicador_qualidade SET dias=dias+1 WHERE id=1`);
  return buscar();
}

function zerar() {
  run(`UPDATE indicador_qualidade SET dias=0, ultimo_reset=datetime('now','localtime') WHERE id=1`);
  return buscar();
}

function atualizarHorarios({ horario1, horario2 }) {
  run(`UPDATE indicador_qualidade SET horario1=?, horario2=? WHERE id=1`,
    [horario1 || '07:00', horario2 || null]);
  return buscar();
}

function registrarDisparo() {
  run(`UPDATE indicador_qualidade SET ultimo_disparo=datetime('now','localtime') WHERE id=1`);
}

module.exports = { setDb, buscar, incrementar, zerar, atualizarHorarios, registrarDisparo };
