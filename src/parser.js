// src/parser.js

const EMOJI_OS     = '\u{1F9F0}'; // 🧰
const EMOJI_STATUS = '\u{1F4CC}'; // 📌

// ── Levenshtein ────────────────────────────────────────────────────────────────
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

// ── Status fuzzy ───────────────────────────────────────────────────────────────
const STATUS_TARGETS = ['andamento', 'concluido', 'cancelado'];
const STATUS_DISPLAY = { 'andamento': 'Andamento', 'concluido': 'Concluído', 'cancelado': 'Cancelado' };

function normalizarTexto(s) {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function matchStatusFuzzy(raw) {
  if (!raw) return null;
  const input = normalizarTexto(raw)
    .replace(/^em\s+/, '') // remove "em " do início
    .replace(/[^a-z]/g, '');

  // Match exato primeiro
  for (const t of STATUS_TARGETS) {
    const clean = t.replace(/[^a-z]/g, '');
    if (input === clean) return STATUS_DISPLAY[t];
  }

  // Fuzzy com distância <= 2
  let best = null, bestDist = Infinity;
  for (const t of STATUS_TARGETS) {
    const clean = t.replace(/[^a-z]/g, '');
    const dist = levenshtein(input, clean);
    if (dist < bestDist) { bestDist = dist; best = t; }
  }

  return bestDist <= 2 ? STATUS_DISPLAY[best] : null;
}

// ── Strip emojis ───────────────────────────────────────────────────────────────
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

// ── Hash estável ───────────────────────────────────────────────────────────────
function djb2(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) + str.charCodeAt(i) | 0;
  return Math.abs(h).toString(36).toUpperCase();
}

// ── Extrai número de OS da linha 🧰 ───────────────────────────────────────────
// Padrão: qualquer coisa com número no início (ex: "8127-2", "TSL 41", "DJ 3336")
// O número/código vem ANTES do traço descritivo
// Formato: 🧰 [CODIGO] - descrição livre
// OU:      🧰 SE SIGLA / CODIGO - descrição
// OU:      🧰 descrição livre sem código (gera hash)
const RE_OS_CODIGO = /^([\w#][\w#\s]*\d[\w\-]*)\s*[-–]/i;  // código explícito antes do traço
const RE_SE_CODIGO = /SE\s+\w+\s*\/\s*([\w#][\w#\s\-]*\d[\w\-]*)/i; // SE X / CODIGO

function extrairCodigo(textoRaw) {
  // Tenta SE SIGLA / CODIGO
  const mSE = textoRaw.match(RE_SE_CODIGO);
  if (mSE) return mSE[1].trim().toUpperCase().replace(/\s+/g, ' ');

  // Tenta CODIGO - descrição
  const mCod = textoRaw.match(RE_OS_CODIGO);
  if (mCod) return mCod[1].trim().toUpperCase().replace(/\s+/g, ' ');

  // Sem código → hash do texto normalizado (consistente entre mensagens)
  const norm = normalizarTexto(textoRaw).replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
  const prefixo = norm.split(' ').slice(0, 3).join('-').toUpperCase().substring(0, 20);
  return prefixo + '-' + djb2(norm);
}

function extrairUnidade(textoRaw) {
  const m = textoRaw.match(/SE\s+(\w+)/i);
  return m ? 'SE ' + m[1].toUpperCase() : null;
}

function extrairServico(textoRaw) {
  // Remove código SE X / Y - desc → retorna só desc
  const mSE = textoRaw.match(/SE\s+\w+\s*\/[^-–]*[-–]\s*(.+)/i);
  if (mSE) return mSE[1].trim();
  // Remove CODIGO - desc → retorna só desc
  const mCod = textoRaw.match(/^[\w#][\w#\s]*\d[\w\-]*\s*[-–]\s*(.+)/i);
  if (mCod) return mCod[1].trim();
  return textoRaw;
}

// ── Regex de campos — separadores opcionais ────────────────────────────────────
// ⚙️ Guarda: Manhã  OU  ⚙️ Guarda Manhã  OU  ⚙ Guarda - Manhã
const RE_GUARDA   = /\u{2699}\u{FE0F}?\s*Guarda\s*[:=\-]?\s*(.+)/iu;
const RE_HORARIO  = /\u{23F0}\s*(?!Sa[íi]da|Chegada)(\d.+)/iu;
const RE_DIA      = /\u{1F4C6}\s*(.+)/u;
const RE_BASE     = /\u{1F3DB}\s*\u{FE0F}?\s*(.+)/u;
const RE_TELEFONE = /\u{1F4F1}\s*(.+)/u;
const RE_VEICULO  = /\u{1F694}\s*(.+)/u;
const RE_EQUIPE   = /[\u{1F477}][\u{1F3FB}-\u{1F3FF}]?\u{200D}?[\u{2640}\u{2642}]?\u{FE0F}?\s*(.+)/u;
const RE_DATA     = /(\d{2}\/\d{2}\/\d{2,4})/;
const RE_SAIDA    = /\u{23F0}\s*Sa[íi]da\s*(?:base)?[:\-]?\s*(.*)/iu;
const RE_CHEGADA  = /\u{23F0}\s*Chegada\s*(?:base)?[:\-]?\s*(.*)/iu;
// 📌 Status — separador opcional, aceita variações
const RE_STATUS_LINHA = /[\u{1F4CC}📌]\s*Status\s*[:=\-]?\s*(.+)/iu;

// ── Parser principal ───────────────────────────────────────────────────────────
function parseOS(texto) {
  if (!texto || typeof texto !== 'string') return null;

  const isFinal   = /resenha\s+final/i.test(texto);
  const isInicial = /resenha\s+inicial/i.test(texto);
  const isResenha = isFinal || isInicial;

  const linhas = texto.split('\n').map(l => l.trim()).filter(Boolean);
  const temOS  = linhas.some(l => l.includes(EMOJI_OS));

  // ── Aviso se parece resenha mas não tem 🧰 ──────────────────────────────────
  if (isResenha && !temOS) {
    return {
      erro: true,
      aviso: '⚠️ Resenha recebida mas nenhuma atividade encontrada.\nAdicione pelo menos uma linha com 🧰 para registrar.',
    };
  }

  if (!isResenha && !temOS) return null;

  // ── Campos globais ─────────────────────────────────────────────────────────
  let data = null, veiculo = null, base = null;
  let guarda = null, horario = null, diaSemana = null, telefone = null;
  let saida_base = null, chegada_base = null;
  const membros = [];
  const subestacoes = [];
  let emSubstBloco = false;
  const avisos = [];

  for (const linha of linhas) {
    if (!data)       { const m = linha.match(RE_DATA);     if (m) data       = m[1]; }
    if (!guarda)     { const m = linha.match(RE_GUARDA);   if (m) guarda     = stripEmojis(m[1]); }
    if (!horario)    { const m = linha.match(RE_HORARIO);  if (m) horario    = stripEmojis(m[1]); }
    if (!diaSemana)  { const m = linha.match(RE_DIA);      if (m) diaSemana  = stripEmojis(m[1]); }
    if (!telefone)   { const m = linha.match(RE_TELEFONE); if (m) telefone   = stripEmojis(m[1]); }
    if (!veiculo)    { const m = linha.match(RE_VEICULO);  if (m) { const v = stripEmojis(m[1]); if (v) veiculo = v; } }
    if (!base)       { const m = linha.match(RE_BASE);     if (m) { const b = stripEmojis(m[1]); if (b) base    = b; } }
    if (!saida_base) { const m = linha.match(RE_SAIDA);    if (m) saida_base   = m[1] ? stripEmojis(m[1]) : 'Registrada'; }
    if (!chegada_base){ const m = linha.match(RE_CHEGADA); if (m) chegada_base = m[1] ? stripEmojis(m[1]) : 'Registrada'; }

    const mEq = linha.match(RE_EQUIPE);
    if (mEq) { const n = stripEmojis(mEq[1]); if (n) membros.push(n); }

    if (/\u{26A1}/u.test(linha)) { emSubstBloco = true; continue; }
    if (emSubstBloco) {
      if (linha.includes(EMOJI_OS) || !/^[▪•\-]/.test(linha)) emSubstBloco = false;
      else { const s = stripEmojis(linha); if (s) subestacoes.push(s); }
    }
  }

  // 🏛️ com vírgula = subestações separadas
  if (base && subestacoes.length === 0 && base.includes(',')) {
    base.split(',').forEach(s => { const t = s.trim(); if (t) subestacoes.push(t); });
    base = null;
  }

  const equipe    = membros.length     ? membros.join(', ')     : null;
  const substeStr = subestacoes.length ? subestacoes.join(', ') : (base || null);

  // Avisa campos importantes ausentes apenas em resenha
  if (isResenha) {
    if (!data)   avisos.push('📅 data');
    if (!equipe) avisos.push('👷 equipe');
    if (!veiculo) avisos.push('🚔 veículo');
  }

  // ── Blocos por 🧰 ──────────────────────────────────────────────────────────
  const blocos = [];
  let atual = null;

  for (const linha of linhas) {
    if (linha.includes(EMOJI_OS)) {
      if (atual) blocos.push(atual);

      const textoRaw = stripEmojis(linha.replace(EMOJI_OS, '')).replace(/^[-–]\s*/, '').trim();
      const osId     = extrairCodigo(textoRaw);
      const unidade  = extrairUnidade(textoRaw) || substeStr || base || '—';
      const servico  = extrairServico(textoRaw);

      atual = { os: osId, unidade, servico, descricao: [], status: null };
      continue;
    }

    if (!atual) continue;

    // Status — fuzzy match
    const mStatus = linha.match(RE_STATUS_LINHA);
    if (mStatus) {
      const statusMatch = matchStatusFuzzy(mStatus[1]);
      if (statusMatch) {
        atual.status = statusMatch;
      } else {
        avisos.push(`❓ Status não reconhecido: "${mStatus[1]}" — use Andamento, Concluído ou Cancelado`);
      }
      continue;
    }

    if (linha.startsWith('-')) {
      atual.descricao.push(linha.replace(/^-\s*/, '').trim());
    }
  }

  if (atual) blocos.push(atual);
  if (!blocos.length) return null;

  const ordens = blocos.map(b => ({
    os:           b.os,
    unidade:      b.unidade,
    equipe,
    veiculo,
    servico:      b.descricao.length ? b.servico + ' | ' + b.descricao.join(' | ') : b.servico,
    status:       b.status || 'Andamento',
    data,
    guarda,
    horario,
    dia_semana:   diaSemana,
    telefone,
    subestacoes:  substeStr,
    saida_base,
    chegada_base,
  }));

  return { ordens, avisos };
}

module.exports = { parseOS };
