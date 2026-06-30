// src/db_indicador.js — Indicador de Qualidade por Gerência (OOMC/OOMM/OOMT) + Consolidado Geral
let db;

const GERENCIAS = ['OOMC', 'OOMM', 'OOMT', 'GERAL'];

function setDb(database) {
  db = database;
  db.run(`
    CREATE TABLE IF NOT EXISTS indicador_gerencias (
      gerencia          TEXT PRIMARY KEY,
      dias              INTEGER NOT NULL DEFAULT 0,
      data_inicio       TEXT,
      recorde_dias      INTEGER NOT NULL DEFAULT 0,
      recorde_inicio    TEXT,
      recorde_fim       TEXT,
      ultimo_id         TEXT,
      ultimo_titulo     TEXT,
      ultimo_tipo       TEXT,
      ultimo_se         TEXT,
      ultimo_data       TEXT,
      horario1          TEXT,
      horario2          TEXT
    )
  `);

  const hoje = dataHojeBR();
  for (const g of GERENCIAS) {
    const existe = db_get(`SELECT gerencia FROM indicador_gerencias WHERE gerencia=?`, [g]);
    if (!existe) {
      db.run(
        `INSERT INTO indicador_gerencias (gerencia, dias, data_inicio, recorde_dias) VALUES (?,0,?,0)`,
        [g, hoje]
      );
    }
  }
  persist();
}

function persist() {
  // Reaproveita persist do módulo db principal (já é chamado via db.run/db.all do server)
}

function db_get(sql, params = []) {
  const s = db.prepare(sql); s.bind(params);
  const r = s.step() ? s.getAsObject() : null; s.free(); return r;
}

function db_all(sql, params = []) {
  const rows = []; const s = db.prepare(sql); s.bind(params);
  while (s.step()) rows.push(s.getAsObject()); s.free(); return rows;
}

function dataHojeBR() {
  const d = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${d.getUTCFullYear()}`;
}

function parseDataBR(s) {
  if (!s) return null;
  const [d, m, y] = s.split('/');
  return new Date(`${y}-${m}-${d}T00:00:00-03:00`);
}

function diffDias(dataInicioBR, dataFimBR) {
  const a = parseDataBR(dataInicioBR);
  const b = parseDataBR(dataFimBR);
  if (!a || !b) return 0;
  return Math.round((b - a) / 86400000);
}

function buscar(gerencia) {
  return db_get(`SELECT * FROM indicador_gerencias WHERE gerencia=?`, [gerencia]);
}

function buscarTodas() {
  const linhas = db_all(`SELECT * FROM indicador_gerencias`);
  const mapa = {};
  linhas.forEach(l => mapa[l.gerencia] = l);
  return mapa;
}

// Incrementa +1 dia em todas as gerências (cron meia-noite)
function incrementarTodas() {
  for (const g of GERENCIAS) {
    const atual = buscar(g);
    if (!atual) continue;
    db.run(`UPDATE indicador_gerencias SET dias=dias+1 WHERE gerencia=?`, [g]);
  }
}

// Zera o contador de uma gerência específica, registra ocorrência e atualiza recorde se aplicável
function zerar(gerencia, info = {}) {
  const atual = buscar(gerencia);
  if (!atual) return null;

  const hoje = dataHojeBR();
  const diasCorridos = atual.data_inicio ? diffDias(atual.data_inicio, hoje) : atual.dias;

  let recorde_dias   = atual.recorde_dias;
  let recorde_inicio = atual.recorde_inicio;
  let recorde_fim    = atual.recorde_fim;

  if (diasCorridos > recorde_dias) {
    recorde_dias   = diasCorridos;
    recorde_inicio = atual.data_inicio;
    recorde_fim    = hoje;
  }

  db.run(
    `UPDATE indicador_gerencias SET
       dias=0, data_inicio=?,
       recorde_dias=?, recorde_inicio=?, recorde_fim=?,
       ultimo_id=?, ultimo_titulo=?, ultimo_tipo=?, ultimo_se=?, ultimo_data=?
     WHERE gerencia=?`,
    [hoje, recorde_dias, recorde_inicio, recorde_fim,
     info.id || null, info.titulo || null, info.tipo || null, info.se || null, hoje,
     gerencia]
  );

  return buscar(gerencia);
}

// Zera a gerência específica E o consolidado geral (qualquer desarme afeta o geral)
function registrarDesarme(gerencia, info = {}) {
  zerar(gerencia, info);
  zerar('GERAL', info);
  return { [gerencia]: buscar(gerencia), GERAL: buscar('GERAL') };
}

// Ajuste manual de dias (ex: corrigir valor inicial)
function setDias(gerencia, dias) {
  const hoje = dataHojeBR();
  // Recalcula data_inicio com base nos dias informados, pra manter consistência no próximo zerar()
  const d = new Date(Date.now() - 3*60*60*1000 - dias*86400000);
  const dataInicio = `${String(d.getUTCDate()).padStart(2,'0')}/${String(d.getUTCMonth()+1).padStart(2,'0')}/${d.getUTCFullYear()}`;
  db.run(`UPDATE indicador_gerencias SET dias=?, data_inicio=? WHERE gerencia=?`, [dias, dataInicio, gerencia]);
  return buscar(gerencia);
}

// Ajuste manual de recorde (seed inicial, já que histórico anterior não está no sistema)
function setRecorde(gerencia, recorde_dias, recorde_inicio, recorde_fim) {
  db.run(
    `UPDATE indicador_gerencias SET recorde_dias=?, recorde_inicio=?, recorde_fim=? WHERE gerencia=?`,
    [recorde_dias, recorde_inicio || null, recorde_fim || null, gerencia]
  );
  return buscar(gerencia);
}

function atualizarHorarios(gerencia, { horario1, horario2 }) {
  db.run(`UPDATE indicador_gerencias SET horario1=?, horario2=? WHERE gerencia=?`,
    [horario1 || null, horario2 || null, gerencia]);
  return buscar(gerencia);
}

module.exports = {
  GERENCIAS, setDb, buscar, buscarTodas, incrementarTodas,
  zerar, registrarDesarme, setDias, setRecorde, atualizarHorarios,
};
