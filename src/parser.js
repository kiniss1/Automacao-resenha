// src/parser.js
const EMOJI_OS     = '\u{1F9F0}'; // 🧰
const EMOJI_STATUS = '\u{1F4CC}'; // 📌

const STATUS_MAP = {
  'andamento':    'Andamento',
  'em andamento': 'Andamento',
  'concluido':    'Concluído',
  'concluído':    'Concluído',
  'cancelado':    'Cancelado',
  'cancelada':    'Cancelado',
};

function normStatus(raw, def = 'Andamento') {
  if (!raw) return def;
  const key = raw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  return STATUS_MAP[key] || def;
}

function stripEmojis(s) {
  return s
    .replace(/[\u{1F000}-\u{1FFFF}]/gu, '')
    .replace(/[\u{2600}-\u{26FF}]/gu, '')
    .replace(/[\u{2700}-\u{27BF}]/gu, '')
    .replace(/[\u{FE00}-\u{FEFF}]/gu, '')
    .replace(/\u{200D}/gu, '')
    .replace(/▪️?/gu, '')
    .replace(/\*/g, '')
    .trim();
}

function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) + str.charCodeAt(i) | 0;
  return Math.abs(h).toString(36).toUpperCase();
}

function gerarIdEstavel(texto) {
  const norm = texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9\s]/g, '').trim().replace(/\s+/g, ' ');
  const prefixo = norm.split(' ').slice(0, 4).join('-').toUpperCase().substring(0, 24);
  return prefixo + '-' + djb2(norm);
}

// Emojis de campo
const RE_GUARDA   = /\u{2699}\u{FE0F}?[^\S\n]*(?:Guarda:?\s*)(.+)/u;           // ⚙️
const RE_HORARIO  = /\u{23F0}[^\S\n]*(.+)/u;                           // ⏰
const RE_DIA      = /\u{1F4C6}[^\S\n]*(.+)/u;                          // 📆
const RE_BASE     = /\u{1F3DB}[^\S\n]*(.+)/u;                          // 🏛️
const RE_TELEFONE = /\u{1F4F1}[^\S\n]*(.+)/u;                          // 📱
const RE_VEICULO  = /\u{1F694}[^\S\n]*(.+)/u;                          // 🚔
const RE_EQUIPE   = /[\u{1F477}][\u{1F3FB}-\u{1F3FF}]?\u{200D}?[\u{2640}\u{2642}]?\u{FE0F}?\s*(.+)/u; // 👷
const RE_DATA     = /(\d{2}\/\d{2}\/\d{2,4})/;
const RE_SUBST    = /\u{26A1}/u;  // ⚡ — início do bloco de subestações

const RE_SE   = /\bSE\s+(\w+)(?:\s*\/\s*([\w#][\w#\s\-]*\d[\w\-]*))?/i;
const RE_DESC = /SE\s+\w+\s*\/[^-\u2013]*[-\u2013]\s*(.+)/i;

function parseOS(texto) {
  if (!texto || typeof texto !== 'string') return null;

  const isFinal   = /resenha\s+final/i.test(texto);
  const isInicial = /resenha\s+inicial/i.test(texto);
  if (!isFinal && !isInicial) return null;

  const linhas = texto.split('\n').map(l => l.trim()).filter(Boolean);
  if (!linhas.some(l => l.includes(EMOJI_OS))) return null;

  // ── Campos globais ─────────────────────────────────────────────────────────
  let data = null, veiculo = null, base = null;
  let guarda = null, horario = null, diaSemana = null, telefone = null;
  const membros = [];
  const subestacoes = [];
  let emSubstBloco = false;

  for (const linha of linhas) {
    if (!data)      { const m = linha.match(RE_DATA);     if (m) data      = m[1]; }
    if (!guarda)    { const m = linha.match(RE_GUARDA);   if (m) guarda    = stripEmojis(m[1]); }
    if (!horario)   { const m = linha.match(RE_HORARIO);  if (m) horario   = stripEmojis(m[1]); }
    if (!diaSemana) { const m = linha.match(RE_DIA);      if (m) diaSemana = stripEmojis(m[1]); }
    if (!telefone)  { const m = linha.match(RE_TELEFONE); if (m) telefone  = stripEmojis(m[1]); }
    if (!veiculo)   { const m = linha.match(RE_VEICULO);  if (m) { const v = stripEmojis(m[1]); if (v) veiculo = v; } }
    if (!base)      { const m = linha.match(RE_BASE);     if (m) { const b = stripEmojis(m[1]); if (b) base    = b; } }

    const mEq = linha.match(RE_EQUIPE);
    if (mEq) { const n = stripEmojis(mEq[1]); if (n) membros.push(n); }

    // Bloco ⚡ Subestações
    if (RE_SUBST.test(linha)) { emSubstBloco = true; continue; }
    if (emSubstBloco) {
      if (linha.includes(EMOJI_OS) || /^[^▪]/.test(linha.replace(/[\u{1F000}-\u{1FFFF}]/gu,''))) {
        emSubstBloco = false;
      } else {
        const sub = stripEmojis(linha);
        if (sub) subestacoes.push(sub);
      }
    }
  }

  // 🏛️ pode conter subestações separadas por vírgula (ex: "COP,BFG")
  if (base && subestacoes.length === 0 && base.includes(',')) {
    base.split(',').forEach(s => { const t = s.trim(); if (t) subestacoes.push(t); });
    base = null; // era subestações, não base
  }

  const equipe      = membros.length     ? membros.join(', ')     : null;
  const substeStr   = subestacoes.length ? subestacoes.join(', ') : (base || null);

  // ── Blocos por 🧰 ──────────────────────────────────────────────────────────
  const blocos = [];
  let atual = null;

  for (const linha of linhas) {
    if (linha.includes(EMOJI_OS)) {
      if (atual) blocos.push(atual);
      const textoRaw = stripEmojis(linha.replace(EMOJI_OS, '')).replace(/^[-\u2013]\s*/, '').trim();

      let unidade = substeStr || base || '—';
      let osId    = null;
      let servico = textoRaw;

      const mSE = textoRaw.match(RE_SE);
      if (mSE) {
        unidade = 'SE ' + mSE[1].trim().toUpperCase();
        if (mSE[2]) osId = mSE[2].trim().toUpperCase().replace(/\s+/g, ' ');
        const mD = textoRaw.match(RE_DESC);
        if (mD) servico = mD[1].trim();
      }

      if (!osId) osId = gerarIdEstavel(textoRaw);
      atual = { os: osId, unidade, servico, descricao: [], status: null };
      continue;
    }

    if (!atual) continue;

    if (linha.includes(EMOJI_STATUS) || /status:/i.test(linha)) {
      const mS = linha.replace(EMOJI_STATUS, '').match(/status:\s*(.+)/i);
      if (mS) atual.status = normStatus(mS[1].trim());
      continue;
    }

    if (linha.startsWith('-')) {
      atual.descricao.push(linha.replace(/^-\s*/, '').trim());
    }
  }

  if (atual) blocos.push(atual);
  if (!blocos.length) return null;

  return blocos.map(b => ({
    os:          b.os,
    unidade:     b.unidade,
    equipe,
    veiculo,
    servico:     b.descricao.length ? b.servico + ' | ' + b.descricao.join(' | ') : b.servico,
    status:      b.status || 'Andamento',
    data,
    guarda,
    horario,
    dia_semana:  diaSemana,
    telefone,
    subestacoes: substeStr,
  }));
}

module.exports = { parseOS };