// resumo_turno.js — monta o resumo de um turno a partir da lista do SharePoint
// e envia ao painel, que publica no grupo do WhatsApp.
//
// uso:   node resumo_turno.js noturno|diurno|14-23 [--data DD/MM/AAAA] [--dry-run]
// env:   ROBO_RESUMO_TOKEN (obrigatório sem --dry-run), PAINEL_URL (opcional)
//
// Agendar no Agendador de Tarefas do Windows, um por turno:
//   noturno -> 07:30 | diurno -> 16:00 | 14-23 -> 23:00
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // mesmo ajuste do sync.js (SSL corporativo)
const { execFile } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

const SP_HOST    = 'dt';
const LIST_GUID  = '87520c05-8a00-45bd-8f62-5529da941a7b'; // Novo - Formulário Cadastro Operacional
const PAINEL_URL = process.env.PAINEL_URL || 'https://painel-resenha.up.railway.app';
const ROBO_TOKEN = process.env.ROBO_RESUMO_TOKEN || '';

// noturno começa no dia anterior às 22:30 e termina hoje às 07:30
const TURNOS = {
  'noturno': { guarda: '22:30 x 07:30', rotulo: 'Noturno 22:30 às 07:30', diaAnterior: true,  h: 22, mi: 30 },
  'diurno':  { guarda: '07:00 x 16:00', rotulo: 'Diurno 07:00 às 16:00',  diaAnterior: false, h: 7,  mi: 0  },
  '14-23':   { guarda: '14:00 x 23:00', rotulo: '14:00 às 23:00',         diaAnterior: false, h: 14, mi: 0  },
};

const pad = n => String(n).padStart(2, '0');
const fmtData = d => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
const fmtCaml = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00Z`;

function decode(s) {
  return (s || '')
    .replace(/&#10;/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ').trim();
}

function attr(row, nome) {
  const m = row.match(new RegExp(`ows_${nome}='([^']*)'`));
  return m ? decode(m[1]) : '';
}

// "07;#fernando augusto neto 3150062" -> "Fernando Augusto"
function nomeEncarregado(raw) {
  const nome = raw.replace(/^\d+;#/, '').replace(/ \d+$/, '').split(' ').slice(0, 2);
  return nome.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}

// "HH:MM:SS" ou "HH:MM" -> "HH:MM"; "00:00" é o vazio do SharePoint
function hora(s) {
  const m = (s || '').match(/^(\d{2}:\d{2})/);
  return m && m[1] !== '00:00' ? m[1] : '';
}

function classificar(tipo) {
  const t = tipo.toLowerCase();
  if (t.startsWith('inspe') && !t.includes('termo')) return 'inspecao';
  if ((t.includes('manobra') && !t.includes('desarme')) || t.includes('encostar')) return 'manobra';
  if (t.startsWith('pi')) return 'impedimento';
  if (t.startsWith('leitura')) return 'outros';
  return 'ocorrencia';
}

// quebra uma lista de itens em linhas de `n` itens separados por " · "
function emLinhas(itens, n) {
  const out = [];
  for (let k = 0; k < itens.length; k += n) out.push(itens.slice(k, k + n).join(' · '));
  return out.join('\n');
}

// Consulta a lista via SOAP usando as credenciais do Windows (mesmo caminho do sync.js)
function consultarSharePoint(start) {
  return new Promise((resolve, reject) => {
    const soap = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetListItems xmlns="http://schemas.microsoft.com/sharepoint/soap/">
      <listName>{${LIST_GUID}}</listName>
      <query><Query><Where><And><Eq><FieldRef Name="TipoDeRegistro"/><Value Type="Choice">RDI</Value></Eq><Geq><FieldRef Name="Created"/><Value Type="DateTime" IncludeTimeValue="TRUE">${fmtCaml(start)}</Value></Geq></And></Where><OrderBy><FieldRef Name="ID" Ascending="FALSE"/></OrderBy></Query></query>
      <viewFields><ViewFields><FieldRef Name="ID"/><FieldRef Name="Created"/><FieldRef Name="DataEHora"/><FieldRef Name="Guarda"/><FieldRef Name="CAS"/><FieldRef Name="Subesta_x00e7__x00e3_oRDA"/><FieldRef Name="Encarregado"/><FieldRef Name="TipoDeAtividade"/><FieldRef Name="OBSAtivRDI"/><FieldRef Name="HorarioPrimeiroContatoMantenedor"/><FieldRef Name="Liberado"/></ViewFields></viewFields>
      <rowLimit>500</rowLimit>
    </GetListItems>
  </soap:Body>
</soap:Envelope>`;
    const tmp = os.tmpdir();
    const bodyFile = path.join(tmp, 'resumo_turno_body.xml');
    const outFile  = path.join(tmp, 'resumo_turno_out.xml');
    const psFile   = path.join(tmp, 'resumo_turno.ps1');
    fs.writeFileSync(bodyFile, soap, 'utf8');
    fs.writeFileSync(psFile, `
$b = [System.IO.File]::ReadAllText("${bodyFile}")
$r = Invoke-WebRequest -Uri "http://${SP_HOST}/_vti_bin/lists.asmx" -Method POST -Body $b -ContentType "text/xml; charset=utf-8" -Headers @{ SOAPAction = "http://schemas.microsoft.com/sharepoint/soap/GetListItems" } -UseDefaultCredentials -UseBasicParsing
[System.IO.File]::WriteAllText("${outFile}", $r.Content, [System.Text.Encoding]::UTF8)`);
    execFile('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psFile], { timeout: 60000 }, err => {
      if (err) return reject(err);
      resolve(fs.readFileSync(outFile, 'utf8'));
    });
  });
}

async function montarResumo(turno, base) {
  const cfg = TURNOS[turno];
  const start = new Date(base.getFullYear(), base.getMonth(), base.getDate() - (cfg.diaAnterior ? 1 : 0), cfg.h, cfg.mi);
  const xml = await consultarSharePoint(start);
  const rows = [...xml.matchAll(/<z:row [^>]*\/>/g)].map(m => m[0]);

  const itens = rows
    .map(row => ({
      id: attr(row, 'ID'),
      criado: new Date(attr(row, 'Created').replace(' ', 'T')),
      registro: attr(row, 'DataEHora'),
      guarda: attr(row, 'Guarda'),
      sub: attr(row, 'Subesta_x00e7__x00e3_oRDA') || attr(row, 'CAS'),
      encarregado: nomeEncarregado(attr(row, 'Encarregado')),
      tipo: attr(row, 'TipoDeAtividade'),
      obs: attr(row, 'OBSAtivRDI'),
      ini: hora(attr(row, 'HorarioPrimeiroContatoMantenedor')),
      lib: hora(attr(row, 'Liberado')),
    }))
    .filter(i => i.guarda === cfg.guarda && i.criado >= start);

  const porSub = {};
  itens.forEach(i => { porSub[i.sub] = (porSub[i.sub] || 0) + 1; });
  const subs = Object.entries(porSub).sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
  const subTxt = emLinhas(subs.map(([s, n]) => `${s} [${n}]`), 5);

  const grupos = { ocorrencia: [], manobra: [], impedimento: [], inspecao: [], outros: [] };
  itens.forEach(i => grupos[classificar(i.tipo)].push(i));

  const codigos = lista => emLinhas(lista.map(i => i.sub), 6);
  const horario = i => {
    if (i.ini && i.lib) return `🕐 ${i.ini} às ${i.lib} · `;
    if (i.ini) return `🕐 desde ${i.ini} · `;
    if (i.lib) return `🕐 até ${i.lib} · `;
    return '';
  };
  const texto = s => s.length > 220 ? s.slice(0, 220) + '…' : s;

  const enc = {};
  itens.forEach(i => { enc[i.encarregado] = (enc[i.encarregado] || 0) + 1; });
  const encTxt = Object.entries(enc).sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n} ${c}`).join(' · ');

  const linhas = [
    '📋 *Resumo Atividades CAS Operação*',
    `📅 ${fmtData(base)} · ${cfg.rotulo}`,
    `📊 Total de registros: *${itens.length}*`,
    '',
    `📍 *Atendimento por subestação*${subs.length ? ` (${subs.length} SEs)` : ''}`,
    '',
    subTxt || 'Nenhum registro neste turno',
  ];

  if (grupos.ocorrencia.length) {
    linhas.push('', `⚠️ *Ocorrências (${grupos.ocorrencia.length})*`);
    grupos.ocorrencia
      .sort((a, b) => (a.registro > b.registro ? 1 : -1))
      .forEach(i => linhas.push('', `*${i.sub}* – ${i.tipo}`, ...(i.obs ? [texto(i.obs)] : []), `${horario(i)}${i.encarregado}`));
  }
  if (grupos.impedimento.length) {
    linhas.push('', `⛔ *Impedimentos (${grupos.impedimento.length})*`, codigos(grupos.impedimento));
  }
  if (grupos.manobra.length) {
    linhas.push('', `🔌 *Manobras (${grupos.manobra.length})*`, codigos(grupos.manobra));
  }
  if (grupos.inspecao.length) {
    linhas.push('', `🔍 *Inspeções de rotina (${grupos.inspecao.length})*`, codigos(grupos.inspecao));
  }
  if (grupos.outros.length) {
    linhas.push('', `📈 *Leitura (${grupos.outros.length})*`, codigos(grupos.outros));
  }
  if (itens.length) {
    linhas.push('', '👷 *Supervisores*', encTxt);
  }
  return linhas.join('\n');
}

async function enviarAoPainel(turno, data, texto) {
  const r = await fetch(`${PAINEL_URL}/api/resumo-turno/enviar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-robo-token': ROBO_TOKEN },
    body: JSON.stringify({ turno: TURNOS[turno].rotulo, data, texto }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
}

(async () => {
  const args = process.argv.slice(2);
  const turno = args[0];
  if (!TURNOS[turno]) {
    console.error('uso: node resumo_turno.js noturno|diurno|14-23 [--data DD/MM/AAAA] [--dry-run]');
    process.exit(1);
  }
  const dataIdx = args.indexOf('--data');
  let base = new Date();
  if (dataIdx > -1) {
    const [d, m, y] = args[dataIdx + 1].split('/').map(Number);
    base = new Date(y, m - 1, d);
  }
  const dryRun = args.includes('--dry-run');

  const texto = await montarResumo(turno, base);
  if (dryRun) {
    console.log(texto);
    return;
  }
  if (!ROBO_TOKEN) throw new Error('Defina ROBO_RESUMO_TOKEN (mesmo valor do painel).');
  await enviarAoPainel(turno, fmtData(base), texto);
  console.log(`Resumo ${TURNOS[turno].rotulo} enviado ao painel.`);
})().catch(e => {
  console.error('ERRO:', e.message);
  process.exit(1);
});
