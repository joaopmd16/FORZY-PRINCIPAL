/* ===================================================================
   PROJETO FORZY - Sistema de Monitoramento Industrial
   Trabalho academico FIAP + Forzy-Promon

   Integrantes:
   - Arthur Baptista dos Santos       (RM 565346)
   - Joao Pedro de Moura Dutra Franco (RM 561738)
   - Nelson Felix Neto                (RM 565603)
   - Pietro Boroto Rodrigues          (RM 562407)
   - Vitor Soares Goncalves           (RM 566181)

   Arquivo: forzy-gov.js
   O que faz: numeros de governanca do modelo de IA
   =================================================================== */

(function () {

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
