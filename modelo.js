/* ===================================================================
   PROJETO FORZY - Sistema de Monitoramento Industrial
   Trabalho academico FIAP + Forzy-Promon

   Integrantes:
   - Arthur Baptista dos Santos       (RM 565346)
   - Joao Pedro de Moura Dutra Franco (RM 561738)
   - Nelson Felix Neto                (RM 565603)
   - Pietro Boroto Rodrigues          (RM 562407)
   - Vitor Soares Goncalves           (RM 566181)

   Arquivo: modelo.js
   O que faz: roda o modelo de IA (rede neural) que detecta anomalia
   =================================================================== */

(function () {
  const M = window.FORZY_MODELO || null;

  const NIVEL = { NORMAL: 0, MEDIO: 1, CRITICO: 2 };
  const ROTULO = ['Normal', 'Atenção', 'Crítico'];
  const COR = ['#2ecc71', '#f39c12', '#e74c3c'];

  const NORMA = {
    vel:  { a: 1.8,  al: 4.5,  un: 'mm/s', nome: 'vibração',    dec: 2, ref: 'ISO 10816' },
    acel: { a: 0.25, al: 0.45, un: 'g',    nome: 'aceleração',  dec: 2, ref: 'ISO 10816' },
    temp: { a: 35.0, al: 42.0, un: '°C',   nome: 'temperatura', dec: 1, ref: 'ISA-18.2' },
  };

  const EIXO_NOME = { m1: 'Eixo 1', m2: 'Eixo 2' };

  const num = v => (typeof v === 'number' && isFinite(v)) ? v : null;
  const fmt = (v, d) => v == null ? '—' : Number(v).toFixed(d).replace('.', ',');

  const faixa = v => v < -1 ? -1 : (v > 2 ? 2 : v);

  function tanh(x) {
    if (Math.tanh) return Math.tanh(x);
    const e = Math.exp(2 * x);
    return (e - 1) / (e + 1);
  }
  const sigmoid = x => 1 / (1 + Math.exp(-Math.max(-60, Math.min(60, x))));

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

  function nivelNorma(col, valor) {
    const n = NORMA[col.slice(3)];
    if (!n || valor == null) return NIVEL.NORMAL;
    if (valor >= n.al) return NIVEL.CRITICO;
    if (valor >= n.a) return NIVEL.MEDIO;
    return NIVEL.NORMAL;
  }

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

    let soma = 0;
    const errCol = M.cols.map((_, i) => {
      const e = (rec[i] - v[i]) * (rec[i] - v[i]);
      soma += e;
      return e;
    });
    const erro = soma / M.cols.length;

    const indice = erro / M.limiares.p2;
    const limCritico = M.limiares.p1 / M.limiares.p2;
    const nRede = indice >= limCritico ? NIVEL.CRITICO : (indice >= 1 ? NIVEL.MEDIO : NIVEL.NORMAL);

    const limAlarmeP2 = M.alarme ? M.alarme.p2 / M.limiares.p2 : limCritico;
    const limAlarmeP1 = M.alarme ? M.alarme.p1 / M.limiares.p2 : limCritico * 2;
    const nAlarme = indice >= limAlarmeP1 ? NIVEL.CRITICO
                  : (indice >= limAlarmeP2 ? NIVEL.MEDIO : NIVEL.NORMAL);

    let nNorma = NIVEL.NORMAL, colNorma = null;
    M.cols.forEach((c, i) => {
      const n = nivelNorma(c, x[i]);
      if (n > nNorma) { nNorma = n; colNorma = c; }
    });

    const fora = M.cols.map((c, i) => {
      const eixo = c.slice(0, 2), variavel = c.slice(3), n = NORMA[variavel];
      return {
        col: c, eixo, variavel,
        rotulo: EIXO_NOME[eixo] + ' · ' + n.nome,
        medido: x[i],
        esperado: recReal[i],
        unidade: n.un,
        dec: n.dec,

        desvio: errCol[i] / M.erroCol[i],
        pct: soma > 0 ? errCol[i] / soma : 0,
      };
    }).sort((a, b) => b.pct - a.pct);

    const nivel = Math.max(nRede, nNorma);
    const motivo = nRede > NIVEL.NORMAL && nNorma > NIVEL.NORMAL ? 'ambos'
                 : nRede > nNorma ? 'rede'
                 : nNorma > NIVEL.NORMAL ? 'norma' : null;

    const assimetria = nRede > NIVEL.NORMAL ? detectarAssimetria(x) : null;

    return {
      ok: true,
      erro, indice, limCritico,
      nivelRede: nRede,
      nivelAlarmeRede: nAlarme,
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

  function detectarAssimetria(x) {
    const i1 = M.cols.indexOf('m1_vel'), i2 = M.cols.indexOf('m2_vel');
    if (i1 < 0 || i2 < 0) return null;
    const v1 = x[i1], v2 = x[i2];
    const maior = Math.max(v1, v2), menor = Math.min(v1, v2);
    if (maior < 1.0 || menor > maior * 0.5) return null;
    return { eixoMaior: v1 >= v2 ? 'm1' : 'm2', eixoMenor: v1 >= v2 ? 'm2' : 'm1',
             maior, menor, razao: menor > 0.05 ? maior / menor : Infinity };
  }

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

  function veredito(r) {
    if (!r || !r.ok || r.nivel === NIVEL.NORMAL) return 'Máquina operando normal.';

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
