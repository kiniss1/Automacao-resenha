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

  // Migrações de colunas novas
  const migrations = [
    'ALTER TABLE ordens_servico ADD COLUMN apr_path TEXT',
    'ALTER TABLE ordens_servico ADD COLUMN apr_verso_path TEXT',
    'ALTER TABLE ordens_servico ADD COLUMN descricao_inicial TEXT',
    'ALTER TABLE ordens_servico ADD COLUMN descricao_final TEXT',
    'ALTER TABLE ordens_servico ADD COLUMN trajeto TEXT',
    'ALTER TABLE ordens_servico ADD COLUMN sp_enviado INTEGER DEFAULT 0',
    'ALTER TABLE ordens_servico ADD COLUMN sp_enviado_em TEXT',
    'ALTER TABLE ordens_servico ADD COLUMN sp_peso REAL',
  ];
  for (const m of migrations) {
    try { db.run(m); } catch(e) { /* coluna já existe */ }
  }

  // Inicializa tabela de checkins
  const checkin = require('./checkin');
  checkin.setDb(db);

  // Inicializa tabelas de inspeção
  const dbInsp = require('./db_inspecao');
  dbInsp.setDb(db);

  // Inicializa tabela de usuários/login
  const auth = require('./db_auth');
  auth.setDb(db);

  // Inicializa tabelas de autoinspeção de EPI
  const autoInsp = require('./db_autoinspecao');
  autoInsp.setDb(db);

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
      (os, unidade, equipe, veiculo, servico, status, data, guarda, horario, dia_semana, telefone, subestacoes, saida_base, chegada_base, descricao_inicial, descricao_final, trajeto)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(os) DO UPDATE SET
      unidade=excluded.unidade, equipe=excluded.equipe, veiculo=excluded.veiculo,
      servico=CASE WHEN servico IS NULL OR servico='' THEN excluded.servico ELSE servico END,
      status=excluded.status, data=excluded.data,
      guarda=excluded.guarda, horario=excluded.horario, dia_semana=excluded.dia_semana,
      telefone=excluded.telefone, subestacoes=excluded.subestacoes,
      saida_base=excluded.saida_base, chegada_base=excluded.chegada_base,
      descricao_final=CASE WHEN excluded.descricao_final IS NOT NULL THEN excluded.descricao_final ELSE descricao_final END,
      descricao_inicial=CASE WHEN descricao_inicial IS NULL THEN excluded.descricao_inicial ELSE descricao_inicial END,
      trajeto=CASE WHEN excluded.trajeto IS NOT NULL AND trajeto IS NOT NULL AND trajeto != excluded.trajeto THEN trajeto || ' | ' || excluded.trajeto WHEN excluded.trajeto IS NOT NULL THEN excluded.trajeto ELSE trajeto END,
      atualizado_em=datetime('now','localtime')
  `, [d.os, d.unidade, d.equipe, d.veiculo, d.servico, d.status, d.data,
      d.guarda, d.horario, d.dia_semana, d.telefone, d.subestacoes,
      d.saida_base || null, d.chegada_base || null,
      d.descricao_inicial || null, d.descricao_final || null,
      d.trajeto || null]);
}

function listarOS({ status, unidade, search, dataDe, dataAte } = {}) {
  const cond = [], params = [];
  if (status)  { cond.push('status = ?');     params.push(status); }
  if (unidade) { cond.push('unidade LIKE ?'); params.push('%' + unidade + '%'); }
  if (search) {
    cond.push('(os LIKE ? OR equipe LIKE ? OR servico LIKE ? OR veiculo LIKE ?)');
    const s = '%' + search + '%'; params.push(s, s, s, s);
  }
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

function estatisticas({ dataDe, dataAte } = {}) {
  const cond = [], params = [];
  if (dataDe) {
    const [y,m,d] = dataDe.split('-');
    cond.push("data >= ?"); params.push(`${d}/${m}/${y}`);
  }
  if (dataAte) {
    const [y,m,d] = dataAte.split('-');
    cond.push("data <= ?"); params.push(`${d}/${m}/${y}`);
  }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  return get(`SELECT COUNT(*) AS total,
    SUM(status='Andamento')       AS andamento,
    SUM(status='Concluído')       AS concluido,
    SUM(status='Etapa Concluída') AS etapa,
    SUM(status='Cancelado')       AS cancelado
    FROM ordens_servico ${where}`, params);
}

function buscarPorId(id) {
  return get('SELECT * FROM ordens_servico WHERE id=?', [id]);
}

function updateAprVersoPath(id, aprPath) {
  run(`UPDATE ordens_servico SET apr_verso_path=? WHERE id=?`, [aprPath, id]);
  return get('SELECT * FROM ordens_servico WHERE id=?', [id]);
}

function updateAprPath(id, aprPath) {
  run(`UPDATE ordens_servico SET apr_path=? WHERE id=?`, [aprPath, id]);
  return get('SELECT * FROM ordens_servico WHERE id=?', [id]);
}

function marcarSpEnviado(id) {
  run(`UPDATE ordens_servico SET sp_enviado=1, sp_enviado_em=datetime('now','localtime') WHERE id=?`, [id]);
  return get('SELECT * FROM ordens_servico WHERE id=?', [id]);
}

function listarSpQueue() {
  return all(`SELECT * FROM ordens_servico WHERE sp_enviado=0 AND status IN ('Concluído','Cancelado','Etapa Concluída') ORDER BY atualizado_em DESC LIMIT 50`);
}

module.exports = {
  init, inserirOS, listarOS, atualizarStatus, removerOS, estatisticas,
  updateAprPath, updateAprVersoPath, buscarPorId, marcarSpEnviado, listarSpQueue,
  // acesso direto para server.js
  run: (sql, params) => run(sql, params),
  all: (sql, params) => all(sql, params),
};
