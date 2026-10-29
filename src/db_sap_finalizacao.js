// src/db_sap_finalizacao.js — fila de finalização de Ordens no SAP + credenciais SAP pessoais (cifradas)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'os_local.db');
let db;

function carregarChave() {
  const raw = process.env.SAP_CRED_ENC_KEY;
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  const b = Buffer.from(raw, 'base64');
  return b.length === 32 ? b : null;
}
const ENC_KEY = carregarChave();

function setDb(database) {
  db = database;
  db.run(`
    CREATE TABLE IF NOT EXISTS sap_credenciais (
      usuario_id     INTEGER PRIMARY KEY,
      sap_usuario    TEXT NOT NULL,
      sap_senha_iv   TEXT NOT NULL,
      sap_senha_tag  TEXT NOT NULL,
      sap_senha_enc  TEXT NOT NULL,
      atualizado_em  TEXT NOT NULL
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS finalizacoes_sap (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      os_id             INTEGER,
      numero_ordem_sap  TEXT NOT NULL,
      possui_nota       INTEGER DEFAULT 0,
      dtl_ve            TEXT,
      horas_trabalhadas TEXT,
      qtd_funcionarios  TEXT,
      veiculo           TEXT,
      km                TEXT,
      anexo_path        TEXT,
      status            TEXT NOT NULL DEFAULT 'fila',
      etapa_atual       TEXT,
      erro_mensagem     TEXT,
      enviado_por       INTEGER NOT NULL,
      criado_em         TEXT NOT NULL,
      atualizado_em     TEXT NOT NULL,
      concluido_em      TEXT
    )
  `);
  persist();
}

function persist() {
  try { fs.writeFileSync(DB_PATH, Buffer.from(db.export())); }
  catch (err) { console.error('[DB] Erro ao salvar sap_finalizacao:', err.message); }
}

function run(sql, params = []) { db.run(sql, params); persist(); }
function get(sql, params = []) { const s = db.prepare(sql); s.bind(params); const r = s.step() ? s.getAsObject() : null; s.free(); return r; }
function all(sql, params = []) { const rows = []; const s = db.prepare(sql); s.bind(params); while (s.step()) rows.push(s.getAsObject()); s.free(); return rows; }

// ── Credenciais SAP (cifradas, AES-256-GCM) ─────────────────────────────────
// Cada colaborador cadastra só a própria senha. Nunca é devolvida em texto puro
// por nenhuma rota do painel — só o agente desktop autenticado recebe o valor
// decifrado, na hora de pegar um job, pra logar no SAP.

function cifrar(texto) {
  if (!ENC_KEY) throw new Error('SAP_CRED_ENC_KEY não configurada (ou com tamanho inválido) no ambiente.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString('base64'), tag: tag.toString('base64'), enc: enc.toString('base64') };
}

function decifrar(row) {
  if (!ENC_KEY) throw new Error('SAP_CRED_ENC_KEY não configurada (ou com tamanho inválido) no ambiente.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(row.sap_senha_iv, 'base64'));
  decipher.setAuthTag(Buffer.from(row.sap_senha_tag, 'base64'));
  const dec = Buffer.concat([decipher.update(Buffer.from(row.sap_senha_enc, 'base64')), decipher.final()]);
  return dec.toString('utf8');
}

function salvarCredencial(usuario_id, sap_usuario, sap_senha) {
  const { iv, tag, enc } = cifrar(sap_senha);
  const agora = new Date().toISOString();
  run(`
    INSERT INTO sap_credenciais (usuario_id, sap_usuario, sap_senha_iv, sap_senha_tag, sap_senha_enc, atualizado_em)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(usuario_id) DO UPDATE SET
      sap_usuario=excluded.sap_usuario, sap_senha_iv=excluded.sap_senha_iv,
      sap_senha_tag=excluded.sap_senha_tag, sap_senha_enc=excluded.sap_senha_enc,
      atualizado_em=excluded.atualizado_em
  `, [usuario_id, sap_usuario, iv, tag, enc, agora]);
}

function statusCredencial(usuario_id) {
  const r = get(`SELECT sap_usuario, atualizado_em FROM sap_credenciais WHERE usuario_id=?`, [usuario_id]);
  return r ? { sapUsuario: r.sap_usuario, atualizadoEm: r.atualizado_em } : null;
}

function buscarCredencialDecifrada(usuario_id) {
  const r = get(`SELECT * FROM sap_credenciais WHERE usuario_id=?`, [usuario_id]);
  if (!r) return null;
  return { sapUsuario: r.sap_usuario, sapSenha: decifrar(r) };
}

// ── Fila de finalizações ─────────────────────────────────────────────────────

function criarJob(dados) {
  const agora = new Date().toISOString();
  run(`
    INSERT INTO finalizacoes_sap
      (os_id, numero_ordem_sap, possui_nota, dtl_ve, horas_trabalhadas, qtd_funcionarios, veiculo, km, anexo_path, status, enviado_por, criado_em, atualizado_em)
    VALUES (?,?,?,?,?,?,?,?,?, 'fila', ?,?,?)
  `, [
    dados.os_id || null, dados.numero_ordem_sap, dados.possui_nota ? 1 : 0, dados.dtl_ve || null,
    dados.horas_trabalhadas || null, dados.qtd_funcionarios || null, dados.veiculo || null, dados.km || null,
    dados.anexo_path || null, dados.enviado_por, agora, agora,
  ]);
  return get(`SELECT * FROM finalizacoes_sap ORDER BY id DESC LIMIT 1`);
}

function listarJobs() {
  return all(`
    SELECT f.*, u.nome AS enviado_por_nome, u.username AS enviado_por_username, os.os AS os_codigo
    FROM finalizacoes_sap f
    LEFT JOIN usuarios u ON u.id = f.enviado_por
    LEFT JOIN ordens_servico os ON os.id = f.os_id
    ORDER BY
      CASE f.status WHEN 'processando' THEN 0 WHEN 'erro' THEN 1 WHEN 'fila' THEN 2 ELSE 3 END,
      f.criado_em DESC
    LIMIT 200
  `);
}

function proximoJobPendente() {
  const job = get(`SELECT * FROM finalizacoes_sap WHERE status='fila' ORDER BY criado_em ASC LIMIT 1`);
  if (!job) return null;
  run(`UPDATE finalizacoes_sap SET status='processando', atualizado_em=? WHERE id=?`, [new Date().toISOString(), job.id]);
  return get(`SELECT * FROM finalizacoes_sap WHERE id=?`, [job.id]);
}

function buscarJob(id) {
  return get(`SELECT * FROM finalizacoes_sap WHERE id=?`, [id]);
}

function atualizarAnexo(id, anexo_path) {
  run(`UPDATE finalizacoes_sap SET anexo_path=?, atualizado_em=? WHERE id=?`, [anexo_path, new Date().toISOString(), id]);
}

function atualizarEtapa(id, etapa_atual) {
  run(`UPDATE finalizacoes_sap SET etapa_atual=?, atualizado_em=? WHERE id=?`, [etapa_atual, new Date().toISOString(), id]);
}

function marcarConcluido(id) {
  const agora = new Date().toISOString();
  run(`UPDATE finalizacoes_sap SET status='concluido', etapa_atual=NULL, atualizado_em=?, concluido_em=? WHERE id=?`, [agora, agora, id]);
}

function marcarErro(id, mensagem) {
  run(`UPDATE finalizacoes_sap SET status='erro', erro_mensagem=?, atualizado_em=? WHERE id=?`, [mensagem, new Date().toISOString(), id]);
}

function reenviarJob(id) {
  run(`UPDATE finalizacoes_sap SET status='fila', erro_mensagem=NULL, etapa_atual=NULL, atualizado_em=? WHERE id=?`, [new Date().toISOString(), id]);
}

module.exports = {
  setDb,
  salvarCredencial, statusCredencial, buscarCredencialDecifrada,
  criarJob, listarJobs, proximoJobPendente, buscarJob, atualizarAnexo,
  atualizarEtapa, marcarConcluido, marcarErro, reenviarJob,
};
