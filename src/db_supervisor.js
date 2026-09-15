// src/db_supervisor.js — Supervisor da equipe (nome/cargo/foto) exibido no relatório diário
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'os_local.db');
let db;

function setDb(database) {
  db = database;
  db.run(`
    CREATE TABLE IF NOT EXISTS supervisor_equipe (
      id            INTEGER PRIMARY KEY CHECK (id = 1),
      nome          TEXT,
      cargo         TEXT,
      foto_path     TEXT,
      atualizado_em TEXT
    )
  `);
  persist();
}

function persist() {
  try {
    fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  } catch (err) { console.error('[DB] Erro ao salvar supervisor_equipe:', err.message); }
}

function get(sql, params = []) {
  const s = db.prepare(sql); s.bind(params);
  const r = s.step() ? s.getAsObject() : null; s.free(); return r;
}

function buscar() {
  return get(`SELECT * FROM supervisor_equipe WHERE id=1`);
}

function salvar({ nome, cargo, foto_path }) {
  const atual = buscar();
  const agora = new Date().toISOString();
  if (atual) {
    const fields = ['nome=?', 'cargo=?', 'atualizado_em=?'];
    const vals = [nome || null, cargo || null, agora];
    if (foto_path !== undefined) { fields.push('foto_path=?'); vals.push(foto_path); }
    db.run(`UPDATE supervisor_equipe SET ${fields.join(', ')} WHERE id=1`, vals);
  } else {
    db.run(
      `INSERT INTO supervisor_equipe (id, nome, cargo, foto_path, atualizado_em) VALUES (1,?,?,?,?)`,
      [nome || null, cargo || null, foto_path || null, agora]
    );
  }
  persist();
  return buscar();
}

module.exports = { setDb, buscar, salvar };
