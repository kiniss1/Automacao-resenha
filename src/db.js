// src/db.js
const initSqlJs = require('sql.js');
const fs   = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'os_local.db');
let db;

async function init() {
  const SQL = await initSqlJs();
  db = fs.existsSync(DB_PATH) ? new SQL.Database(fs.readFileSync(DB_PATH)) : new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS ordens_servico (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      os            TEXT NOT NULL UNIQUE,
      unidade       TEXT,
      equipe        TEXT,
      veiculo       TEXT,
      servico       TEXT,
      status        TEXT NOT NULL DEFAULT 'Andamento',
      data          TEXT,
      guarda        TEXT,
      horario       TEXT,
      dia_semana    TEXT,
      telefone      TEXT,
      subestacoes   TEXT,
      saida_base    TEXT,
      chegada_base  TEXT,
      criado_em     TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `);

  // Inicializa tabela de checkins
  const checkin = require('./checkin');
  checkin.setDb(db);

  persist();
  console.log('[DB] Banco iniciado:', DB_PATH);
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  } catch (err) { console.error('[DB] Erro ao salvar:', err.message); }
}

function run(sql, params = []) { db.run(sql, params); persist(); }

function get(sql, params = []) {
  const s = db.prepare(sql); s.bind(params);
  const r = s.step() ? s.getAsObject() : null; s.free(); return r;
}

function all(sql, params = []) {
  const rows = []; const s = db.prepare(sql); s.bind(params);
  while (s.step()) rows.push(s.getAsObject()); s.free(); return rows;
}

function inserirOS(d) {
  run(`
    INSERT INTO ordens_servico
      (os, unidade, equipe, veiculo, servico, status, data, guarda, horario, dia_semana, telefone, subestacoes, saida_base, chegada_base)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(os) DO UPDATE SET
      unidade=excluded.unidade, equipe=excluded.equipe, veiculo=excluded.veiculo,
      servico=excluded.servico, status=excluded.status, data=excluded.data,
      guarda=excluded.guarda, horario=excluded.horario, dia_semana=excluded.dia_semana,
      telefone=excluded.telefone, subestacoes=excluded.subestacoes,
      saida_base=excluded.saida_base, chegada_base=excluded.chegada_base,
      atualizado_em=datetime('now','localtime')
  `, [d.os, d.unidade, d.equipe, d.veiculo, d.servico, d.status, d.data,
      d.guarda, d.horario, d.dia_semana, d.telefone, d.subestacoes, d.saida_base, d.chegada_base]);
}

function listarOS({ status, unidade, search, dataDe, dataAte } = {}) {
  const cond = [], params = [];
  if (status)  { cond.push('status = ?');     params.push(status); }
  if (unidade) { cond.push('unidade LIKE ?'); params.push('%' + unidade + '%'); }
  if (search) {
    cond.push('(os LIKE ? OR equipe LIKE ? OR servico LIKE ? OR veiculo LIKE ?)');
    const s = '%' + search + '%'; params.push(s, s, s, s);
  }
  // Filtro de data — campo "data" está no formato DD/MM/AAAA
  // Converte para comparação: transforma input YYYY-MM-DD → DD/MM/AAAA
  if (dataDe) {
    const [y,m,d] = dataDe.split('-');
    cond.push("data >= ?"); params.push(`${d}/${m}/${y}`);
  }
  if (dataAte) {
    const [y,m,d] = dataAte.split('-');
    cond.push("data <= ?"); params.push(`${d}/${m}/${y}`);
  }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  return all('SELECT * FROM ordens_servico ' + where + ' ORDER BY criado_em DESC', params);
}

function atualizarStatus(id, status) {
  run(`UPDATE ordens_servico SET status=?, atualizado_em=datetime('now','localtime') WHERE id=?`, [status, id]);
  return get('SELECT * FROM ordens_servico WHERE id=?', [id]);
}

function removerOS(id) {
  const os = get('SELECT * FROM ordens_servico WHERE id=?', [id]);
  if (!os) return null;
  run('DELETE FROM ordens_servico WHERE id=?', [id]);
  return os;
}

function estatisticas() {
  return get(`SELECT COUNT(*) AS total,
    SUM(status='Andamento') AS andamento,
    SUM(status='Concluído') AS concluido,
    SUM(status='Cancelado') AS cancelado
    FROM ordens_servico`);
}

function updateAprPath(id, aprPath) {
  run(`UPDATE ordens_servico SET apr_path=? WHERE id=?`, [aprPath, id]);
  return get('SELECT * FROM ordens_servico WHERE id=?', [id]);
}

module.exports = { init, inserirOS, listarOS, atualizarStatus, removerOS, estatisticas, updateAprPath };
