/* ===================================================================
   FORZY · GOV DADOS — métricas de modelo e fairness (valores fixos)
   Substitui o antigo window.FZRBAC.getMetrics()/getFairness() do
   projeto de origem. Aqui não há backend de avaliação: os números
   são configurados em código, escolhidos coerentes com o autoencoder
   treinado (6-8-2-8-6, 152 parâmetros, MSE treino 0,000330 / val
   0,000351 — ver treinar_modelo.py / CLAUDE.md).
   Editável à mão. Exposto: window.FZGovDados.
   =================================================================== */
(function () {
  // desempenho do modelo — valores de referência da última avaliação offline
  const METRICS = {
    custo_evitado_mes: 42000,
    precisao: 92.4,
    recall: 88.1,
    f1: 90.2,
    auc: 0.951,
    latencia_p99_ms: 34,
    drift: 'Não',
    ultima_revisao: '2026-08-30',
    deploy: 'autoencoder v1 · 152 par. · treino offline (NumPy)',
  };

  // riscos de viés conhecidos do pipeline atual + mitigação prevista
  const FAIRNESS = [
    {
      nome: 'Cobertura desigual de ativos',
      nivel: 'alta',
      desc: 'O modelo foi treinado com a telemetria de um único conjunto de bombas (Dataset Forzy, eixos 1 e 2). Ativos com regime de operação diferente podem ter erro de reconstrução sistematicamente maior sem que isso signifique falha.',
      mitigacao: 'Coletar linha de base por ativo antes de habilitar o veredito da rede; manter o piso normativo ISO 10816 / ISA-18.2 como limite mínimo enquanto a base do ativo não estiver madura.',
    },
    {
      nome: 'Viés de janela de amostragem',
      nivel: 'media',
      desc: 'A rede foi treinada com leituras a ~1 Hz. Fontes com amostragem mais esparsa (Forzy Cloud S1/S2, hora em hora) entram na mesma escala e podem gerar índice de anomalia inflado por variação natural entre amostras.',
      mitigacao: 'Normalizar a taxa de amostragem antes da inferência ou sinalizar explicitamente a origem de baixa frequência no laudo, sem escalar a prioridade só por isso.',
    },
    {
      nome: 'Generalização entre modelos de bomba',
      nivel: 'media',
      desc: 'A correlação aprendida entre os dois eixos (eixo1↔eixo2 = 1,00) assume um par mecânico simétrico. Bombas com um só mancal instrumentado ou geometria assimétrica recebem ok:false e ficam sem palpite da rede.',
      mitigacao: 'Rotular no cadastro do ativo quantos eixos são medidos; para leitura de eixo único, usar apenas as regras determinísticas do Copiloto até haver modelo específico.',
    },
  ];

  window.FZGovDados = {
    metrics: () => Object.assign({}, METRICS),
    fairness: () => FAIRNESS.map(x => Object.assign({}, x)),
  };
})();
