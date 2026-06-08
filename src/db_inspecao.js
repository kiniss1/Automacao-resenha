// src/db_inspecao.js
// Módulo de inspeção de subestações — tabelas e funções

let db;  // referência ao db sql.js compartilhado

function setDb(database) {
  db = database;

  // ── Fichas de inspeção (templates por SE) ─────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS inspecao_fichas (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo_se   TEXT NOT NULL UNIQUE,   -- ex: FCN
      nome_se     TEXT NOT NULL,          -- ex: SE Frei Caneca
      descricao   TEXT,
      ativa       INTEGER NOT NULL DEFAULT 1,
      criado_em   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `);

  // ── Campos de cada ficha (perguntas configuráveis) ─────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS inspecao_campos (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ficha_id    INTEGER NOT NULL REFERENCES inspecao_fichas(id) ON DELETE CASCADE,
      ordem       INTEGER NOT NULL DEFAULT 0,
      label       TEXT NOT NULL,
      tipo        TEXT NOT NULL DEFAULT 'texto',
      -- tipos: texto | multipla_escolha | upload_foto | sim_nao | numero
      opcoes      TEXT,   -- JSON array para multipla_escolha, ex: ["Bom","Ruim","Outra"]
      obrigatorio INTEGER NOT NULL DEFAULT 1,
      grupo       TEXT    -- agrupamento visual, ex: "Disjuntores 138kV"
    )
  `);

  // ── Preenchimentos (instâncias de uma ficha respondida) ───────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS inspecao_preenchimentos (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ficha_id    INTEGER NOT NULL REFERENCES inspecao_fichas(id),
      codigo_se   TEXT NOT NULL,
      matricula   TEXT,
      nome_tecnico TEXT,
      data_insp   TEXT NOT NULL,  -- DD/MM/YYYY
      hora_insp   TEXT,
      status      TEXT NOT NULL DEFAULT 'Rascunho',  -- Rascunho | Concluído
      obs_geral   TEXT,
      criado_em   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )
  `);

  // ── Respostas individuais por campo ───────────────────────────────────────
  db.run(`
    CREATE TABLE IF NOT EXISTS inspecao_respostas (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      preenchimento_id INTEGER NOT NULL REFERENCES inspecao_preenchimentos(id) ON DELETE CASCADE,
      campo_id         INTEGER NOT NULL REFERENCES inspecao_campos(id),
      resposta_texto   TEXT,
      resposta_opcao   TEXT,
      foto_path        TEXT   -- caminho do arquivo salvo
    )
  `);

  // Índices
  db.run(`CREATE INDEX IF NOT EXISTS idx_insp_pre_ficha ON inspecao_preenchimentos(ficha_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_insp_pre_data  ON inspecao_preenchimentos(data_insp)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_insp_pre_se    ON inspecao_preenchimentos(codigo_se)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_insp_resp_pre  ON inspecao_respostas(preenchimento_id)`);
}

// ── helpers ───────────────────────────────────────────────────────────────────
function run(sql, params = []) {
  db.run(sql, params);
  persist();
}

function get(sql, params = []) {
  const s = db.prepare(sql); s.bind(params);
  const r = s.step() ? s.getAsObject() : null; s.free(); return r;
}

function all(sql, params = []) {
  const rows = []; const s = db.prepare(sql); s.bind(params);
  while (s.step()) rows.push(s.getAsObject()); s.free(); return rows;
}

function persist() {
  try {
    const fs   = require('fs');
    const path = require('path');
    const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'os_local.db');
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  } catch (err) { console.error('[DB_INSP] persist error:', err.message); }
}

// ── Fichas ────────────────────────────────────────────────────────────────────
function criarFicha({ codigo_se, nome_se, descricao }) {
  run(`INSERT INTO inspecao_fichas (codigo_se, nome_se, descricao)
       VALUES (?, ?, ?)`, [codigo_se.toUpperCase(), nome_se, descricao || null]);
  return get(`SELECT * FROM inspecao_fichas WHERE codigo_se=?`, [codigo_se.toUpperCase()]);
}

function atualizarFicha(id, { nome_se, descricao, ativa }) {
  const fields = [], vals = [];
  if (nome_se    !== undefined) { fields.push('nome_se=?');    vals.push(nome_se); }
  if (descricao  !== undefined) { fields.push('descricao=?');  vals.push(descricao); }
  if (ativa      !== undefined) { fields.push('ativa=?');      vals.push(ativa ? 1 : 0); }
  fields.push("atualizado_em=datetime('now','localtime')");
  vals.push(id);
  run(`UPDATE inspecao_fichas SET ${fields.join(',')} WHERE id=?`, vals);
  return get(`SELECT * FROM inspecao_fichas WHERE id=?`, [id]);
}

function listarFichas() {
  return all(`SELECT * FROM inspecao_fichas ORDER BY nome_se ASC`);
}

function buscarFicha(id) {
  return get(`SELECT * FROM inspecao_fichas WHERE id=?`, [id]);
}

function buscarFichaPorCodigo(codigo) {
  return get(`SELECT * FROM inspecao_fichas WHERE codigo_se=?`, [codigo.toUpperCase()]);
}

function deletarFicha(id) {
  run(`DELETE FROM inspecao_fichas WHERE id=?`, [id]);
}

// ── Campos ────────────────────────────────────────────────────────────────────
function criarCampo({ ficha_id, label, tipo, opcoes, obrigatorio, grupo, ordem }) {
  run(`INSERT INTO inspecao_campos (ficha_id, label, tipo, opcoes, obrigatorio, grupo, ordem)
       VALUES (?,?,?,?,?,?,?)`,
    [ficha_id, label, tipo || 'texto',
     opcoes ? JSON.stringify(opcoes) : null,
     obrigatorio !== false ? 1 : 0,
     grupo || null,
     ordem ?? 0]);
  return get(`SELECT * FROM inspecao_campos WHERE rowid=last_insert_rowid()`);
}

function listarCampos(ficha_id) {
  return all(`SELECT * FROM inspecao_campos WHERE ficha_id=? ORDER BY ordem ASC`, [ficha_id]);
}

function atualizarCampo(id, { label, tipo, opcoes, obrigatorio, grupo, ordem }) {
  const fields = [], vals = [];
  if (label      !== undefined) { fields.push('label=?');      vals.push(label); }
  if (tipo       !== undefined) { fields.push('tipo=?');       vals.push(tipo); }
  if (opcoes     !== undefined) { fields.push('opcoes=?');     vals.push(opcoes ? JSON.stringify(opcoes) : null); }
  if (obrigatorio!== undefined) { fields.push('obrigatorio=?');vals.push(obrigatorio ? 1 : 0); }
  if (grupo      !== undefined) { fields.push('grupo=?');      vals.push(grupo || null); }
  if (ordem      !== undefined) { fields.push('ordem=?');      vals.push(ordem); }
  if (!fields.length) return get(`SELECT * FROM inspecao_campos WHERE id=?`, [id]);
  vals.push(id);
  run(`UPDATE inspecao_campos SET ${fields.join(',')} WHERE id=?`, vals);
  return get(`SELECT * FROM inspecao_campos WHERE id=?`, [id]);
}

function deletarCampo(id) {
  run(`DELETE FROM inspecao_campos WHERE id=?`, [id]);
}

function reordenarCampos(fichaId, ordemArray) {
  // ordemArray = [{id, ordem}, ...]
  for (const item of ordemArray) {
    run(`UPDATE inspecao_campos SET ordem=? WHERE id=? AND ficha_id=?`, [item.ordem, item.id, fichaId]);
  }
}

// ── Preenchimentos ────────────────────────────────────────────────────────────
function criarPreenchimento({ ficha_id, codigo_se, matricula, nome_tecnico, data_insp, hora_insp, obs_geral }) {
  run(`INSERT INTO inspecao_preenchimentos (ficha_id, codigo_se, matricula, nome_tecnico, data_insp, hora_insp, obs_geral)
       VALUES (?,?,?,?,?,?,?)`,
    [ficha_id, codigo_se.toUpperCase(), matricula || null, nome_tecnico || null,
     data_insp, hora_insp || null, obs_geral || null]);
  return get(`SELECT * FROM inspecao_preenchimentos WHERE rowid=last_insert_rowid()`);
}

function concluirPreenchimento(id) {
  run(`UPDATE inspecao_preenchimentos SET status='Concluído' WHERE id=?`, [id]);
  return get(`SELECT * FROM inspecao_preenchimentos WHERE id=?`, [id]);
}

function buscarPreenchimento(id) {
  return get(`SELECT * FROM inspecao_preenchimentos WHERE id=?`, [id]);
}

function listarPreenchimentos({ ficha_id, codigo_se, dataDe, dataAte, status } = {}) {
  const cond = [], params = [];
  if (ficha_id)  { cond.push('ficha_id=?');   params.push(ficha_id); }
  if (codigo_se) { cond.push('codigo_se=?');  params.push(codigo_se.toUpperCase()); }
  if (status)    { cond.push('status=?');     params.push(status); }
  if (dataDe)    { cond.push("date(criado_em) >= date(?)"); params.push(dataDe); }
  if (dataAte)   { cond.push("date(criado_em) <= date(?)"); params.push(dataAte); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  return all(`SELECT p.*, f.nome_se FROM inspecao_preenchimentos p
              LEFT JOIN inspecao_fichas f ON f.id = p.ficha_id
              ${where} ORDER BY p.criado_em DESC LIMIT 200`, params);
}

function deletarPreenchimento(id) {
  run(`DELETE FROM inspecao_preenchimentos WHERE id=?`, [id]);
}

// ── Respostas ─────────────────────────────────────────────────────────────────
function salvarResposta({ preenchimento_id, campo_id, resposta_texto, resposta_opcao, foto_path }) {
  // Upsert por preenchimento+campo
  const existing = get(`SELECT id FROM inspecao_respostas WHERE preenchimento_id=? AND campo_id=?`,
    [preenchimento_id, campo_id]);
  if (existing) {
    run(`UPDATE inspecao_respostas SET resposta_texto=?, resposta_opcao=?, foto_path=? WHERE id=?`,
      [resposta_texto || null, resposta_opcao || null, foto_path || null, existing.id]);
    return get(`SELECT * FROM inspecao_respostas WHERE id=?`, [existing.id]);
  } else {
    run(`INSERT INTO inspecao_respostas (preenchimento_id, campo_id, resposta_texto, resposta_opcao, foto_path)
         VALUES (?,?,?,?,?)`,
      [preenchimento_id, campo_id, resposta_texto || null, resposta_opcao || null, foto_path || null]);
    return get(`SELECT * FROM inspecao_respostas WHERE rowid=last_insert_rowid()`);
  }
}

function listarRespostas(preenchimento_id) {
  return all(`SELECT r.*, c.label, c.tipo, c.grupo, c.ordem
              FROM inspecao_respostas r
              JOIN inspecao_campos c ON c.id = r.campo_id
              WHERE r.preenchimento_id=?
              ORDER BY c.ordem ASC`, [preenchimento_id]);
}

// ── Dashboard / stats ─────────────────────────────────────────────────────────
function statsDashboard(dataDe, dataAte) {
  const params = [];
  let dateFilter = '';
  if (dataDe)  { dateFilter += " AND date(p.criado_em) >= date(?)"; params.push(dataDe); }
  if (dataAte) { dateFilter += " AND date(p.criado_em) <= date(?)"; params.push(dataAte); }

  const total = get(`SELECT COUNT(*) as c FROM inspecao_preenchimentos p WHERE 1=1 ${dateFilter}`, params);
  const concluidas = get(`SELECT COUNT(*) as c FROM inspecao_preenchimentos p WHERE status='Concluído' ${dateFilter}`, params);
  const porSE = all(`SELECT p.codigo_se, f.nome_se, COUNT(*) as total,
                     SUM(p.status='Concluído') as concluidas
                     FROM inspecao_preenchimentos p
                     LEFT JOIN inspecao_fichas f ON f.id=p.ficha_id
                     WHERE 1=1 ${dateFilter}
                     GROUP BY p.codigo_se ORDER BY total DESC`, params);
  const porDia = all(`SELECT date(p.criado_em) as dia, COUNT(*) as total
                      FROM inspecao_preenchimentos p
                      WHERE 1=1 ${dateFilter}
                      GROUP BY dia ORDER BY dia ASC LIMIT 30`, params);

  return { total: total?.c || 0, concluidas: concluidas?.c || 0, porSE, porDia };
}

module.exports = {
  setDb,
  criarFicha, atualizarFicha, listarFichas, buscarFicha, buscarFichaPorCodigo, deletarFicha,
  criarCampo, listarCampos, atualizarCampo, deletarCampo, reordenarCampos,
  criarPreenchimento, concluirPreenchimento, buscarPreenchimento, listarPreenchimentos, deletarPreenchimento,
  salvarResposta, listarRespostas,
  statsDashboard,
};
