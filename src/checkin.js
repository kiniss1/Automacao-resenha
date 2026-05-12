// src/checkin.js

const initSqlJs = require('sql.js');
const fs   = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'os_local.db');
let db;

const COLABORADORES = [
  { matricula: '4010928', nome: 'ADRIANA DE OLIVEIRA RIBEIRO', cargo: 'AGENTE ADMINISTRATIVO JR' },
  { matricula: '4005819', nome: 'ADRIANO DA ROCHA LIMA', cargo: 'TECNICO DE CAMPO' },
  { matricula: '4005265', nome: 'ADRIANO SANTANA DA SILVA', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES JR' },
  { matricula: '4004883', nome: 'ALAN JULIANO ALVES DA SILVA', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES PL' },
  { matricula: '4008600', nome: 'ALESSANDRO SILVA DE OLIVEIRA', cargo: 'MANTENEDOR DE SUBESTACAO DE AT' },
  { matricula: '4008775', nome: 'ALEX DIAS DA PAZ', cargo: 'TECNICO DE CAMPO JR' },
  { matricula: '4006306', nome: 'ALEXANDER DA SILVA PEREIRA', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES PL' },
  { matricula: '4006322', nome: 'ALEXANDRE DO NASCIMENTO COUTO', cargo: 'TECNICO DE CAMPO' },
  { matricula: '4012969', nome: 'ALEXANDRO CORREIA DOS SANTOS JUNIOR', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES JR' },
  { matricula: '4012691', nome: 'ALEXSANDRE PATRICK BRANCO ARAUJO', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES JR' },
  { matricula: '4004718', nome: 'ALEXSANDRO DOS SANTOS MAGALHAES', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES PL' },
  { matricula: '4006273', nome: 'ALEXSANDRO SANTOS', cargo: 'TECNICO DE CAMPO' },
  { matricula: '4005447', nome: 'ALISSON LUIS SANTOS', cargo: 'TECNICO DE CAMPO JR' },
  { matricula: '3096076', nome: 'ALUIZIO ALBERTO PEIXOTO SOARES', cargo: 'ENGENHEIRO SR' },
  { matricula: '4005479', nome: 'ANA CRISTINA PIRES MENDES', cargo: 'SUPERVISOR DE EQUIPE DE CAMPO' },
  { matricula: '3143040', nome: 'ANDERSON ALEX CORTES SALDANHA', cargo: 'TECNICO DE CAMPO SR' },
  { matricula: '4006182', nome: 'ANDERSON DE ANDRADE SANT ANNA', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES JR' },
  { matricula: '4009932', nome: 'ANDRE PHILIPPE CARDOSO DE OLIVEIRA', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES JR' },
  { matricula: '4006130', nome: 'ANTONIO DOUGLAS DE FREITAS DAMASCENO', cargo: 'SUPERVISOR DE EQUIPE DE CAMPO' },
  { matricula: '3149323', nome: 'ARIMILTON FERREIRA', cargo: 'TECNICO DE CAMPO SR' },
  { matricula: '4006079', nome: 'AUGUSTO ANDERSON DA SILVA', cargo: 'TECNICO DE CAMPO JR' },
  { matricula: '4001362', nome: 'BRUNO MARINHO SANT ANA', cargo: 'ENGENHEIRO JR' },
  { matricula: '4009915', nome: 'BRUNO THIAGO TEIXEIRA MACIEL', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES JR' },
  { matricula: '4013828', nome: 'CLAUDIO ANDRADE DE ASSIS', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES JR' },
  { matricula: '3127036', nome: 'CLAUDIO PEREIRA NUNES', cargo: 'SUPERVISOR DE EQUIPE DE CAMPO' },
  { matricula: '4010344', nome: 'CLEBER DINIZ PEREIRA', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES JR' },
  { matricula: '4004508', nome: 'DANIEL RANGEL HERMES', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES SR' },
  { matricula: '4002392', nome: 'DAVI TELLES RANGEL COUTINHO', cargo: 'TECNICO DE CAMPO JR' },
  { matricula: '4003923', nome: 'DEIVISON MESSIAS DO NASCIMENTO', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES JR' },
  { matricula: '4007153', nome: 'DENISON GOMES ELEUTERIO', cargo: 'TECNICO DE CAMPO PL' },
  { matricula: '4006131', nome: 'DIOGO DA COSTA DINIZ', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES JR' },
  { matricula: '4012446', nome: 'DUALLA PEREIRA DA SILVA', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES JR' },
  { matricula: '4006305', nome: 'EDILSON JOSE DA SILVA', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES PL' },
  { matricula: '4003123', nome: 'EDSON JULIO DE FREITAS', cargo: 'TECNICO DE CAMPO PL' },
  { matricula: '4000857', nome: 'EDSON MACHADO DE SOUZA JUNIOR', cargo: 'TECNICO DE CAMPO SR' },
  { matricula: '4008403', nome: 'EDUARDO FONTES NASCIMENTO', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES JR' },
  { matricula: '4005688', nome: 'EDUARDO GUIMARAES', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES PL' },
  { matricula: '4006153', nome: 'EVERSON MELONI RIBEIRO', cargo: 'TECNICO DE CAMPO JR' },
  { matricula: '4000692', nome: 'EZEQUIAS DE OLIVEIRA CORDEIRO', cargo: 'ELETROMECANICO DE SUBTRANSMISSAO SR' },
  { matricula: '4004485', nome: 'FABIANO GABRIEL DA SILVA', cargo: 'TECNICO DE CAMPO SR' },
  { matricula: '4005528', nome: 'FABIO LUIZ ALMEIDA PEREIRA', cargo: 'TECNICO DE CAMPO PL' },
  { matricula: '4013596', nome: 'FELIPE MIRANDA SANTOS', cargo: 'TRAINEE' },
  { matricula: '4006320', nome: 'FELLIPE REBELO REI ALVES', cargo: 'TECNICO DE CAMPO' },
  { matricula: '3150062', nome: 'FERNANDO AUGUSTO NETO', cargo: 'SUPERVISOR DE EQUIPE DE CAMPO' },
  { matricula: '4002630', nome: 'FILIPE MARQUES PEREIRA', cargo: 'GERENTE MANUTENCAO ALTA TENSAO' },
  { matricula: '4012845', nome: 'GABRIEL FILIPE CHAGAS RIBEIRO', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES JR' },
  { matricula: '4005750', nome: 'GERSON DA CUNHA FERREIRA', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES JR' },
  { matricula: '3126145', nome: 'GILCINEA RANGEL PESENTI', cargo: 'ANALISTA DE QUALIDADE SR' },
  { matricula: '4005283', nome: 'GUARACI LUIZ ANACLETO', cargo: 'ELETROMECANICO DE SUBTRANSMISSAO JR' },
  { matricula: '4006269', nome: 'HAMILTON ALVES FERREIRA DE CARVALHO', cargo: 'TECNICO DE CAMPO PL' },
  { matricula: '4004889', nome: 'JAKELINE GUILHERME BADARO', cargo: 'AGENTE ADMINISTRATIVO' },
  { matricula: '4010388', nome: 'JONAS DE OLIVEIRA MAGALHAES', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES JR' },
  { matricula: '3114821', nome: 'JORGE LUIZ LOPES DA SILVA', cargo: 'TECNICO SR' },
  { matricula: '4000342', nome: 'JOSE ODAIR GOMES DE LIRA', cargo: 'TECNICO DE CAMPO SR' },
  { matricula: '3130304', nome: 'JOSELITO BUENO DE MORAES', cargo: 'TECNICO DE CAMPO SR' },
  { matricula: '4005548', nome: 'JUAN PEDRO MIRALHA GARCIA', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES PL' },
  { matricula: '4002676', nome: 'JULIANO SANTANA DA COSTA LIMA', cargo: 'TECNICO DE CAMPO SR' },
  { matricula: '3150127', nome: 'JULIO CESAR DA COSTA PERES', cargo: 'ENGENHEIRO DE CAMPO JR' },
  { matricula: '4013830', nome: 'KAUE PACHECO CARVALHO', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES JR' },
  { matricula: '4003716', nome: 'LAUDIMAR ANTONIO SANTOS JUNIOR', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES SR' },
  { matricula: '4010763', nome: 'LUCAS GOMES DOS SANTOS', cargo: 'ENGENHEIRO PL' },
  { matricula: '4007288', nome: 'LEANDRO ALVES DA MOTTA', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES PL' },
  { matricula: '4010939', nome: 'LEONARDO ALVES FARIAS', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES JR' },
  { matricula: '4005791', nome: 'LEONARDO SANTOS DE SOUZA', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES JR' },
  { matricula: '4004968', nome: 'LEONARDO SANTOS LEITE', cargo: 'TECNICO DE CAMPO JR' },
  { matricula: '4003899', nome: 'LUCAS MACENA SOUZA', cargo: 'TECNICO DE CAMPO' },
  { matricula: '4001396', nome: 'LUCIANO DOS SANTOS LEAL', cargo: 'TECNICO DE CAMPO SR' },
  { matricula: '4003705', nome: 'LUCIANO LOPES DOS SANTOS', cargo: 'TECNICO DE CAMPO' },
  { matricula: '4001560', nome: 'LUIZ NASCIMENTO COELHO', cargo: 'TECNICO DE CAMPO SR' },
  { matricula: '4006318', nome: 'MARCELO CICERO QUIRINO', cargo: 'TECNICO DE CAMPO PL' },
  { matricula: '4007289', nome: 'MARCELO DE PAULO QUIRINO', cargo: 'TECNICO DE CAMPO' },
  { matricula: '4002725', nome: 'MARCIO LIMA DA SILVA JUNIOR', cargo: 'SUPERVISOR DE EQUIPE DE CAMPO' },
  { matricula: '4003886', nome: 'MARCOS SOARES GUEDES', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES PL' },
  { matricula: '4006546', nome: 'MARCUS EUGENIO CAMARA BOUHID', cargo: 'SUPERVISOR DE EQUIPE DE CAMPO' },
  { matricula: '4000043', nome: 'MARCUS VINICIUS GOUVEA GOMES', cargo: 'ENGENHEIRO DE CAMPO PL' },
  { matricula: '4011591', nome: 'MICAEL DO NASCIMENTO DA SILVA', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES JR' },
  { matricula: '4004557', nome: 'MICHEL BRITO SIMOES', cargo: 'TECNICO DE CAMPO PL' },
  { matricula: '4004933', nome: 'NICOLAS ALVES AMARAL', cargo: 'ENGENHEIRO DE CAMPO JR' },
  { matricula: '3135918', nome: 'NILSON ALVES DA SILVA', cargo: 'TECNICO DE CAMPO SR' },
  { matricula: '4005751', nome: 'NOREDIN HAMMES GOMES DA SILVA', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES PL' },
  { matricula: '4012379', nome: 'PAULO FERNANDO DE LIMA', cargo: 'TECNICO DE CAMPO JR' },
  { matricula: '4011394', nome: 'RAFAEL VIANA DE SOUZA', cargo: 'APRENDIZ ELETRICISTA' },
  { matricula: '4009914', nome: 'RENAN SILVA DO NASCIMENTO', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES JR' },
  { matricula: '4012737', nome: 'RICARDO TEIXEIRA MONTEIRO', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES JR' },
  { matricula: '4005448', nome: 'RODRIGO SOUSA DOS SANTOS', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES PL' },
  { matricula: '4003089', nome: 'RONAN RIBEIRO BRAZ', cargo: 'SUPERVISOR DE EQUIPE DE CAMPO' },
  { matricula: '4013779', nome: 'SAMUEL CARLOS DE SOUZA NUNES', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES JR' },
  { matricula: '3129675', nome: 'SILVIO JOSE DO NASCIMENTO', cargo: 'SUPERVISOR DE EQUIPE DE CAMPO' },
  { matricula: '4011636', nome: 'THALISSON DE LIMA CUNHA', cargo: 'COORDENADOR MANUT SUBESTACOES CAPITAL' },
  { matricula: '4012255', nome: 'THIAGO DE ARAUJO ALMEIDA DA SILVA', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES JR' },
  { matricula: '4013633', nome: 'UELLINGTON RODRIGO SANTIAGO BARRETO', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES JR' },
  { matricula: '4012259', nome: 'VALDIR JACINTO DA SILVA', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES JR' },
  { matricula: '4008404', nome: 'VITOR DORIA FIRMO ALVES', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES JR' },
  { matricula: '4009127', nome: 'VITOR HUGO CORREA MESSIAS', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES JR' },
  { matricula: '4004944', nome: 'VITOR HUGO MENDONCA DO NASCIMENTO', cargo: 'ENGENHEIRO DE CAMPO JR' },
  { matricula: '4005561', nome: 'WAGNER DA CONCEICAO SANTOS', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES JR' },
  { matricula: '3131599', nome: 'WAGNER DO BONFIM CORDEIRO', cargo: 'TECNICO DE CAMPO SR' },
  { matricula: '4006091', nome: 'WAGNER TEIXEIRA FERREIRA', cargo: 'TECNICO DE CAMPO JR' },
  { matricula: '4012406', nome: 'WALLACE SILVA DE SOUZA', cargo: 'TECNICO DE CAMPO JR' },
  { matricula: '4012469', nome: 'WILIAM PECANHA PINTO', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES JR' },
  { matricula: '4013886', nome: 'JUAN DE OLIVEIRA TAVARES', cargo: 'ELETRICISTA MANTENEDOR DE SUBESTACOES JR' },
  { matricula: '4011832', nome: 'MONIQUE OLIVEIRA DOS SANTOS', cargo: 'TECNICO DE CAMPO JR' },
];

const SUBESTACOES = [
  'BFG','LEM','FCN','SCO','ITP','MKZ','BPD','COT','SLZ','ITQ','COP',
  'ALV','ANT','ARC','BAR','BEL','BOA','CAM','CAP','CAS','CEN','CLI',
  'COL','COR','CRU','CUR','DIV','ENT','FAR','FLO','FOR','GAL','GRA',
  'GUA','IBI','IGA','ILH','INA','IND','INH','ITB','ITC','ITG','JAC',
  'JAR','JOA','JUA','LAG','LAJ','LAR','LIN','LON','LOU','MAG','MAR',
  'MED','MEN','MES','MOC','MON','MOR','MUR','NAZ','NIL','NIT','NOV',
  'OLI','OUR','PAC','PAR','PAS','PAT','PAU','PED','PER','PIR','PON',
  'POR','QUA','RAI','REC','RES','RIB','RIO','ROC','SAL','SAN','SAO',
  'SER','SOB','TAB','TAQ','TER','TIM','TOQ','TRE','TUB','UBA','UNA',
  'VAL','VEN','VIT','VOU'
];

function setDb(database) {
  db = database;
  db.run(`
    CREATE TABLE IF NOT EXISTS checkins (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      matricula     TEXT NOT NULL,
      nome          TEXT,
      cargo         TEXT,
      subestacao    TEXT NOT NULL,
      atividade     TEXT,
      entrada       TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      saida         TEXT,
      status        TEXT NOT NULL DEFAULT 'Ativo' CHECK(status IN ('Ativo','Encerrado'))
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_checkin_status ON checkins(status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_checkin_mat ON checkins(matricula)`);
}

function persist() {
  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  } catch (err) { console.error('[DB] Erro ao salvar checkin:', err.message); }
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

function buscarColaborador(matricula) {
  return COLABORADORES.find(c => c.matricula === String(matricula).trim()) || null;
}

function fazerCheckin({ matricula, subestacao, atividade }) {
  const colab = buscarColaborador(matricula);
  if (!colab) return { erro: true, msg: `Matrícula ${matricula} não encontrada. Verifique e tente novamente.` };

  const ativo = get(`SELECT * FROM checkins WHERE matricula=? AND status='Ativo'`, [matricula]);
  if (ativo) return { erro: true, msg: `${colab.nome} já tem entrada ativa em ${ativo.subestacao} desde ${ativo.entrada}. Faça o checkout primeiro.`, checkin: ativo };

  run(`INSERT INTO checkins (matricula, nome, cargo, subestacao, atividade) VALUES (?,?,?,?,?)`,
    [matricula, colab.nome, colab.cargo, subestacao.toUpperCase(), atividade || null]);

  return { erro: false, msg: 'Entrada registrada', nome: colab.nome, cargo: colab.cargo, subestacao };
}

function fazerCheckout(matricula) {
  const colab = buscarColaborador(matricula);
  if (!colab) return { erro: true, msg: `Matrícula ${matricula} não encontrada.` };

  const ativo = get(`SELECT * FROM checkins WHERE matricula=? AND status='Ativo'`, [matricula]);
  if (!ativo) return { erro: true, msg: `${colab.nome} não possui entrada ativa no momento.` };

  run(`UPDATE checkins SET saida=datetime('now','localtime'), status='Encerrado' WHERE id=?`, [ativo.id]);
  return { erro: false, msg: 'Saída registrada', checkin: get('SELECT * FROM checkins WHERE id=?', [ativo.id]) };
}

function listarAtivos() {
  return all(`SELECT * FROM checkins WHERE status='Ativo' ORDER BY entrada DESC`);
}

function listarHistorico({ subestacao, matricula, dataDe, dataAte, status } = {}) {
  const cond = [], params = [];
  if (subestacao) { cond.push('subestacao = ?'); params.push(subestacao.toUpperCase()); }
  if (matricula)  { cond.push('matricula = ?');  params.push(matricula); }
  if (status)     { cond.push('status = ?');     params.push(status); }
  if (dataDe)  { const [y,m,d]=dataDe.split('-');  cond.push("date(entrada) >= date(?)"); params.push(`${y}-${m}-${d}`); }
  if (dataAte) { const [y,m,d]=dataAte.split('-'); cond.push("date(entrada) <= date(?)"); params.push(`${y}-${m}-${d}`); }
  const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
  return all(`SELECT * FROM checkins ${where} ORDER BY entrada DESC LIMIT 500`, params);
}

function estatisticasCheckin() {
  return get(`SELECT COUNT(*) as total, SUM(status='Ativo') as ativos, SUM(status='Encerrado') as encerrados FROM checkins`);
}

module.exports = { setDb, fazerCheckin, fazerCheckout, listarAtivos, listarHistorico, estatisticasCheckin, buscarColaborador, COLABORADORES, SUBESTACOES };
