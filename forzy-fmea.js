/* ===================================================================
   FORZY · FMEA — base de conhecimento compartilhada de modo de falha
   Mapa modo→componentes, árvore de componentes do motor e extensão de
   "manual de conserto" (reparabilidade, parada, tempo, ferramentas).
   Consumido por investigacao.js e rca.js. Sem libs, sem build.
   As chaves de modo espelham copiloto.js (window.FZCopiloto.MODOS).
   =================================================================== */
(function () {
  // componentes do motor/bomba, com posição relativa para o desenho "explodido"
  // x,y em unidades de viewBox 0..100 (corte lateral); dx,dy = deslocamento ao explodir
  const COMPONENTES = [
    { id: 'carcaca',     nome: 'Carcaça / base',        x: 50, y: 50, dx: 0,   dy: 26  },
    { id: 'estator',     nome: 'Estator / bobinado',    x: 50, y: 50, dx: 0,   dy: -24 },
    { id: 'rotor',       nome: 'Rotor / impelidor',     x: 50, y: 50, dx: 0,   dy: 0   },
    { id: 'eixo',        nome: 'Eixo',                  x: 50, y: 50, dx: 34,  dy: 0   },
    { id: 'rolamento_ld',nome: 'Rolamento LD (acopl.)', x: 33, y: 50, dx: -30, dy: 14  },
    { id: 'rolamento_la',nome: 'Rolamento LA (livre)',  x: 67, y: 50, dx: 30,  dy: 14  },
    { id: 'ventilacao',  nome: 'Sistema de ventilação', x: 22, y: 50, dx: -34, dy: -14 },
  ];
  const NOME = COMPONENTES.reduce((m, c) => (m[c.id] = c.nome, m), {});

  // modo de falha (chave do copiloto) → componentes suspeitos, do mais provável ao menos
  const MODO_COMPONENTES = {
    balanceamento: ['rotor', 'eixo', 'carcaca'],
    rolamento:     ['rolamento_la', 'rolamento_ld'],
    termico:       ['ventilacao', 'rolamento_la', 'estator'],
    cavitacao:     ['rotor'],
    severa:        ['rotor', 'eixo', 'rolamento_la', 'rolamento_ld'],
    normal:        [],
  };

  // extensão do "manual de conserto"
  const REPARO = {
    balanceamento: {
      reparavel: 'Sim — balanceamento do conjunto rotativo e realinhamento em campo, sem substituir o motor.',
      parada: 'Parada curta programada (ativo desenergizado).',
      tempo: '2 a 4 h',
      ferramentas: ['Alinhador a laser', 'Torquímetro', 'Kit de balanceamento de campo (planos 1 e 2)', 'Relógio comparador'],
    },
    rolamento: {
      reparavel: 'Sim — substituição do par de rolamentos e vedações; motor permanece em serviço.',
      parada: 'Parada programada.',
      tempo: '4 a 8 h',
      ferramentas: ['Extrator de rolamento', 'Aquecedor indutivo', 'Estetoscópio industrial / analisador de envelope', 'Termovisor'],
    },
    termico: {
      reparavel: 'Sim — correção de lubrificação e de refrigeração; troca de terminais se houver aquecimento elétrico.',
      parada: 'Curta, pode ser feita com o ativo parado por pouco tempo.',
      tempo: '1 a 3 h',
      ferramentas: ['Termovisor', 'Alicate amperímetro', 'Kit de lubrificação especificada', 'Escova / ar comprimido para aletas'],
    },
    cavitacao: {
      reparavel: 'Sim — ajuste hidráulico da linha de sucção; não exige desmontar o motor.',
      parada: 'Ajuste operacional, sem parada longa.',
      tempo: '1 a 2 h',
      ferramentas: ['Manovacuômetro de sucção', 'Chave de filtro', 'Medidor de nível do reservatório'],
    },
    severa: {
      reparavel: 'Parcial — depende da inspeção de bancada. Eixo empenado, rotor trincado ou estator queimado exigem substituição do componente ou do ativo.',
      parada: 'PARADA IMEDIATA (ISA-18.2 P1), com bloqueio e etiquetagem.',
      tempo: '8 a 24 h + diagnóstico de bancada',
      ferramentas: ['Bloqueio / etiquetagem (LOTO)', 'Relógio comparador', 'Extrator', 'Bancada de teste de rotativos', 'Megôhmetro'],
    },
    normal: {
      reparavel: 'Não aplicável — nenhuma falha detectada.',
      parada: 'Nenhuma.',
      tempo: '—',
      ferramentas: [],
    },
  };

  window.FZFMEA = {
    COMPONENTES, NOME,
    componentesDoModo: k => (MODO_COMPONENTES[k] || []).slice(),
    reparo: k => REPARO[k] || REPARO.normal,
    nomeComponente: id => NOME[id] || id,
  };
})();
