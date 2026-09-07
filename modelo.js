/* ===================================================================
   FORZY · Modelo de anomalia — inferência da rede neural
   Roda o autoencoder treinado em treinar_modelo.py (pesos em
   data/forzy-model.js) direto no browser, sem lib e sem build.

   Como funciona
   -------------
   A rede foi treinada pra RECONSTRUIR as 6 variáveis dos dois eixos.
   Ela aprendeu, sozinha, as relações físicas do conjunto: vibração e
   aceleração andam juntas (correlação 1,00), os dois eixos andam juntos,
   e as duas temperaturas se acompanham (0,95). Quando chega uma leitura
   que ela não consegue reconstruir, é porque aquela COMBINAÇÃO de valores
   nunca aconteceu no histórico — isso é a anomalia.

   Por que isso importa (o Z-score antigo não pegava):
   com média 2,50 e desvio 2,90 no m1_vel (distribuição bimodal: a máquina
   fica metade do tempo parada), a pior vibração do dataset — 7,46 mm/s,
   ALARME pela ISO 10816 — dava Z = 1,77, ou seja, "Normal". E um eixo 1 a
   7 mm/s com o eixo 2 parado (fisicamente impossível) dava Z = 1,55.
   A rede dá índice 119 nesse mesmo caso.

   Decisão de projeto: a rede SOMA, nunca subtrai.
   O veredito final é o PIOR entre a classificação por norma (ISO 10816 /
   ISA-18.2, determinística e auditável) e a da rede. Assim o modelo só
   pode subir a severidade, jamais silenciar um alarme normativo.

     window.FZModelo = { pronto, info, avaliar, NIVEL }
   =================================================================== */
(function () {
  const M = window.FORZY_MODELO || null;

  const NIVEL = { NORMAL: 0, MEDIO: 1, CRITICO: 2 };
  const ROTULO = ['Normal', 'Atenção', 'Crítico'];
  const COR = ['#2ecc71', '#f39c12', '#e74c3c'];

  /* limites normativos por tipo de variável — mesma tabela do forzy.js */
  const NORMA = {
    vel:  { a: 1.8,  al: 4.5,  un: 'mm/s', nome: 'vibração',    dec: 2, ref: 'ISO 10816' },
    acel: { a: 0.25, al: 0.45, un: 'g',    nome: 'aceleração',  dec: 2, ref: 'ISO 10816' },
    temp: { a: 35.0, al: 42.0, un: '°C',   nome: 'temperatura', dec: 1, ref: 'ISA-18.2' },
  };

  const EIXO_NOME = { m1: 'Eixo 1', m2: 'Eixo 2' };

  const num = v => (typeof v === 'number' && isFinite(v)) ? v : null;
  const fmt = (v, d) => v == null ? '—' : Number(v).toFixed(d).replace('.', ',');
  // No treino os valores foram cortados em [0,1]. Na inferência NÃO cortamos em 1:
  // uma leitura acima da faixa histórica (ex.: 50 °C num sensor que nunca passou de 46)
  // precisa gerar erro de reconstrução — é exatamente o caso que queremos detectar.
  // O limite largo [-1, 2] existe só pra um sensor em curto não estourar a escala.
  const faixa = v => v < -1 ? -1 : (v > 2 ? 2 : v);

  /* ---------------- inferência ---------------- */
  function tanh(x) {
    if (Math.tanh) return Math.tanh(x);
    const e = Math.exp(2 * x);
    return (e - 1) / (e + 1);
  }
  const sigmoid = x => 1 / (1 + Math.exp(-Math.max(-60, Math.min(60, x))));

  // passa o vetor normalizado pelas 4 camadas: tanh, tanh, tanh, sigmoide
  function frente(v) {
    let a = v;
    const nCamadas = M.W.length;
    for (let c = 0; c < nCamadas; c++) {
      const W = M.W[c], b = M.b[c];
      const saida = new Array(W[0].length);
      for (let j = 0; j < W[0].length; j++) {
        let z = b[j];
        for (let i = 0; i < W.length; i++) z += a[i] * W[i][j];
        saida[j] = (c === nCamadas - 1) ? sigmoid(z) : tanh(z);
      }
      a = saida;
    }
    return a;
  }

  const normalizar = x => M.cols.map((_, i) => faixa((x[i] - M.norm.lo[i]) / (M.norm.hi[i] - M.norm.lo[i])));
  const desnormalizar = v => M.cols.map((_, i) => M.norm.lo[i] + v[i] * (M.norm.hi[i] - M.norm.lo[i]));

  /* ---------------- classificação por norma ---------------- */
  function nivelNorma(col, valor) {
    const n = NORMA[col.slice(3)];
    if (!n || valor == null) return NIVEL.NORMAL;
    if (valor >= n.al) return NIVEL.CRITICO;
    if (valor >= n.a) return NIVEL.MEDIO;
    return NIVEL.NORMAL;
  }

  /* ---------------- API ---------------- */
  function info() {
    if (!M) return null;
    return {
      versao: M.versao,
      gerado: M.gerado,
      arquitetura: M.arquitetura.join('–'),
      parametros: M.treino.parametros,
      amostras: M.treino.amostras,
      validacao: M.treino.validacao,
      epocas: M.treino.epocas,
      mseTreino: M.treino.mse_treino,
      mseValidacao: M.treino.mse_validacao,
      limCritico: M.limiares.p1 / M.limiares.p2,
      limAlarmeP2: M.alarme ? M.alarme.p2 / M.limiares.p2 : null,
      limAlarmeP1: M.alarme ? M.alarme.p1 / M.limiares.p2 : null,
    };
  }

  /**
   * avaliar(leitura) — leitura = { m1_vel, m1_acel, m1_temp, m2_vel, m2_acel, m2_temp }
   * Devolve o veredito combinado (rede + norma) e a explicação de qual
   * variável está fora e o que a rede esperava no lugar.
   */
  function avaliar(leitura) {
    if (!M || !leitura) return { ok: false, nivel: NIVEL.NORMAL, rotulo: '—', cor: COR[0], indice: 0 };

    const x = M.cols.map(c => num(leitura[c]));
    if (x.some(v => v == null)) {
      return { ok: false, nivel: NIVEL.NORMAL, rotulo: '—', cor: COR[0], indice: 0,
               motivo: 'leitura incompleta' };
    }

    const v = normalizar(x);
    const rec = frente(v);
    const recReal = desnormalizar(rec);

    // erro quadrático médio na escala normalizada — a mesma métrica do treino
    let soma = 0;
    const errCol = M.cols.map((_, i) => {
      const e = (rec[i] - v[i]) * (rec[i] - v[i]);
      soma += e;
      return e;
    });
    const erro = soma / M.cols.length;

    const indice = erro / M.limiares.p2;                 // 1,00 = limiar de atenção (p95 do histórico)
    const limCritico = M.limiares.p1 / M.limiares.p2;    // ~2,6 = limiar crítico (p99,5)
    const nRede = indice >= limCritico ? NIVEL.CRITICO : (indice >= 1 ? NIVEL.MEDIO : NIVEL.NORMAL);

    // Limiares de ALARME sao mais altos que os de analise. O p95 serve pra desenhar
    // o gráfico; pra tocar a sirene ele geraria um alarme a cada ~20 quadros do
    // replay do dataset. O pipeline da topbar usa estes:
    const limAlarmeP2 = M.alarme ? M.alarme.p2 / M.limiares.p2 : limCritico;
    const limAlarmeP1 = M.alarme ? M.alarme.p1 / M.limiares.p2 : limCritico * 2;
    const nAlarme = indice >= limAlarmeP1 ? NIVEL.CRITICO
                  : (indice >= limAlarmeP2 ? NIVEL.MEDIO : NIVEL.NORMAL);

    // norma: pior coluna
    let nNorma = NIVEL.NORMAL, colNorma = null;
    M.cols.forEach((c, i) => {
      const n = nivelNorma(c, x[i]);
      if (n > nNorma) { nNorma = n; colNorma = c; }
    });

    // quem está fora, segundo a rede: erro da coluna vs. erro típico dela no treino
    const fora = M.cols.map((c, i) => {
      const eixo = c.slice(0, 2), variavel = c.slice(3), n = NORMA[variavel];
      return {
        col: c, eixo, variavel,
        rotulo: EIXO_NOME[eixo] + ' · ' + n.nome,
        medido: x[i],
        esperado: recReal[i],
        unidade: n.un,
        dec: n.dec,
        // quantas vezes acima do erro médio dessa coluna no histórico
        desvio: errCol[i] / M.erroCol[i],
        pct: soma > 0 ? errCol[i] / soma : 0,
      };
    }).sort((a, b) => b.pct - a.pct);

    const nivel = Math.max(nRede, nNorma);
    const motivo = nRede > NIVEL.NORMAL && nNorma > NIVEL.NORMAL ? 'ambos'
                 : nRede > nNorma ? 'rede'
                 : nNorma > NIVEL.NORMAL ? 'norma' : null;

    // Assimetria entre eixos. A rede aprendeu que os dois eixos vibram juntos
    // (correlação 1,00 no histórico); quando divergem ela acusa, mas o erro de
    // reconstrução se espalha pelas seis colunas e fora[0] nem sempre nomeia o par
    // certo (costuma cair em "aceleração"). Este bloco só dá NOME ao que a rede já
    // pegou — não mexe em índice nem em veredito. Só existe quando a rede acusou.
    const assimetria = nRede > NIVEL.NORMAL ? detectarAssimetria(x) : null;

    return {
      ok: true,
      erro, indice, limCritico,
      nivelRede: nRede,
      nivelAlarmeRede: nAlarme,          // usado pelo pipeline de alarmes (topbar.js)
      limAlarme: { p2: limAlarmeP2, p1: limAlarmeP1 },
      nivelNorma: nNorma,
      colNorma,
      nivel,
      rotulo: ROTULO[nivel],
      cor: COR[nivel],
      motivo,
      fora,
      assimetria,
      reconstrucao: recReal,
      explicacao: explicar({ nivel, nRede, nNorma, indice, limCritico, fora, colNorma, x, assimetria }),
    };
  }

  // um eixo vibrando de verdade (≥ 1,0 mm/s) enquanto o outro fica em menos da metade.
  // Limiar largo de propósito: no histórico a razão entre os eixos nunca passa disso,
  // então quando passa é porque a máquina saiu do padrão aprendido.
  function detectarAssimetria(x) {
    const i1 = M.cols.indexOf('m1_vel'), i2 = M.cols.indexOf('m2_vel');
    if (i1 < 0 || i2 < 0) return null;
    const v1 = x[i1], v2 = x[i2];
    const maior = Math.max(v1, v2), menor = Math.min(v1, v2);
    if (maior < 1.0 || menor > maior * 0.5) return null;
    return { eixoMaior: v1 >= v2 ? 'm1' : 'm2', eixoMenor: v1 >= v2 ? 'm2' : 'm1',
             maior, menor, razao: menor > 0.05 ? maior / menor : Infinity };
  }

  /* frase pronta — usada no alerta, no Copiloto e no contexto do Assistente */
  function explicar(r) {
    if (r.nivel === NIVEL.NORMAL) {
      return 'Rede neural: leitura compatível com a operação normal da máquina (índice '
        + fmt(r.indice, 2) + ', limiar 1,00).';
    }

    const partes = [];

    if (r.nNorma > NIVEL.NORMAL && r.colNorma) {
      const i = M.cols.indexOf(r.colNorma);
      const n = NORMA[r.colNorma.slice(3)];
      const eixo = EIXO_NOME[r.colNorma.slice(0, 2)];
      partes.push(n.ref + ': ' + eixo + ' com ' + n.nome + ' de ' + fmt(r.x[i], n.dec) + ' ' + n.un
        + ' (limite de ' + (r.nNorma === NIVEL.CRITICO ? 'alarme ' + fmt(n.al, n.dec) : 'alerta ' + fmt(n.a, n.dec))
        + ' ' + n.un + ').');
    }

    if (r.nRede > NIVEL.NORMAL && r.assimetria) {
      const a = r.assimetria;
      partes.push('Rede neural: índice ' + fmt(r.indice, 2) + ' (atenção a partir de 1,00, crítico a partir de '
        + fmt(r.limCritico, 2) + '). Os dois eixos divergiram: ' + EIXO_NOME[a.eixoMaior] + ' a '
        + fmt(a.maior, 2) + ' mm/s com ' + EIXO_NOME[a.eixoMenor] + ' a ' + fmt(a.menor, 2)
        + ' mm/s. No histórico eles sempre vibraram juntos — um só subir aponta pra problema '
        + 'localizado nesse mancal (desalinhamento, folga de acoplamento ou rolamento), não pra carga do processo.');
    } else if (r.nRede > NIVEL.NORMAL) {
      const t = r.fora[0];
      partes.push('Rede neural: índice ' + fmt(r.indice, 2) + ' (atenção a partir de 1,00, crítico a partir de '
        + fmt(r.limCritico, 2) + '). O desvio vem de ' + t.rotulo.toLowerCase()
        + ' — medido ' + fmt(t.medido, t.dec) + ' ' + t.unidade
        + ', a rede esperava cerca de ' + fmt(t.esperado, t.dec) + ' ' + t.unidade
        + ' para esse conjunto de leituras.');
    } else if (r.nNorma > NIVEL.NORMAL) {
      partes.push('A rede não vê inconsistência entre as variáveis (índice ' + fmt(r.indice, 2)
        + '): o valor é alto, mas a máquina já operou assim. O alarme vem da norma.');
    }

    return partes.join(' ');
  }

  /* veredito curto pro operador — sem norma, sem número solto */
  function veredito(r) {
    if (!r || !r.ok || r.nivel === NIVEL.NORMAL) return 'Máquina operando normal.';
    // se quem disparou foi a norma, nomeia a variável da norma; senão, a que a rede apontou
    const t = (r.nivelNorma >= r.nivelRede && r.colNorma)
      ? r.fora.find(f => f.col === r.colNorma) || r.fora[0]
      : r.fora[0];
    const eixo = EIXO_NOME[r.assimetria && r.nivelRede >= r.nivelNorma ? r.assimetria.eixoMaior : t.eixo];
    const crit = r.nivel === NIVEL.CRITICO;
    if (t.variavel === 'temp') {
      return eixo + ' esquentando' + (crit ? ' demais. Pare a bomba e chame a manutenção.' : '. Fique de olho.');
    }
    return eixo + ' vibrando' + (crit ? ' muito. Pare a bomba e chame a manutenção.' : ' acima do normal. Fique de olho.');
  }

  window.FZModelo = {
    NIVEL,
    ROTULO,
    COR,
    pronto: () => !!M,
    info,
    avaliar,
    veredito,
  };

  if (!M) console.warn('[FZModelo] data/forzy-model.js não carregou — rode `python treinar_modelo.py`.');
})();
