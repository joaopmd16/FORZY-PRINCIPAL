/* ===================================================================
   PROJETO FORZY - Sistema de Monitoramento Industrial
   Trabalho academico FIAP + Forzy-Promon

   Integrantes:
   - Arthur Baptista dos Santos       (RM 565346)
   - Joao Pedro de Moura Dutra Franco (RM 561738)
   - Nelson Felix Neto                (RM 565603)
   - Pietro Boroto Rodrigues          (RM 562407)
   - Vitor Soares Goncalves           (RM 566181)

   Arquivo: forzy-bi.js
   O que faz: calcula os indicadores usados na tela de Governanca
   =================================================================== */

(function () {
  const LIM = { vel: { a: 1.8, al: 4.5 }, acel: { a: 0.25, al: 0.45 }, temp: { a: 35, al: 42 } };

  function serie(eixo) {
    const F = window.FORZY;
    if (!F || !F[eixo]) return null;
    return { vel: F[eixo].vel, acel: F[eixo].acel, temp: F[eixo].temp, t: F.t, t0: F.meta && F.meta.t0 };
  }

  function disponibilidade(eixo) {
    const s = serie(eixo); if (!s) return null;
    let ok = 0;
    for (let i = 0; i < s.vel.length; i++) if (s.vel[i] < LIM.vel.al && s.temp[i] < LIM.temp.al) ok++;
    return +(ok / s.vel.length * 100).toFixed(1);
  }

  function mtbf(eixo) {
    const s = serie(eixo); if (!s || !s.t) return null;
    const cruz = [];
    for (let i = 1; i < s.vel.length; i++) {
      if (s.vel[i] >= LIM.vel.al && s.vel[i - 1] < LIM.vel.al) cruz.push(s.t[i]);
    }
    if (cruz.length < 2) return null;
    let acc = 0; for (let i = 1; i < cruz.length; i++) acc += (cruz[i] - cruz[i - 1]);
    return +(acc / (cruz.length - 1) / 3600).toFixed(1);
  }

  function mttr(eixo) {
    const s = serie(eixo); if (!s || !s.t) return null;
    const durs = []; let ini = null;
    for (let i = 0; i < s.vel.length; i++) {
      const acima = s.vel[i] >= LIM.vel.al;
      if (acima && ini == null) ini = s.t[i];
      if (!acima && ini != null) { durs.push(s.t[i] - ini); ini = null; }
    }
    if (!durs.length) return null;
    return +(durs.reduce((a, b) => a + b, 0) / durs.length / 3600).toFixed(2);
  }

  function frota() {
    const ativos = (window.FZStore && window.FZStore.getAtivosIndustrial && window.FZStore.getAtivosIndustrial()) || [];
    const cop = window.FZCopiloto;
    const out = [];
    ['m1', 'm2'].forEach(eixo => {
      if (!cop || !cop.piorLeitura) return;
      const pior = cop.piorLeitura(eixo);
      if (!pior) return;
      const dNow = cop.diagnosticar(cop.leituraAtual ? (cop.leituraAtual() || pior) : pior, eixo);
      const dPeak = cop.diagnosticar(pior, eixo);
      const F = window.FORZY;
      const seg = (F.t && F.t[pior.idx] != null) ? F.t[pior.idx] : 0;
      const quando = F.meta && F.meta.t0 ? new Date(Date.parse(F.meta.t0) + seg * 1000) : null;
      const velNow = +(dNow.evidencias.find(e => e.k.startsWith('Vel')) || {}).v || 0;
      const nivel = Math.min(1, velNow / LIM.vel.al);
      const sev = dPeak.prioridade === 'P1' ? 1 : dPeak.prioridade === 'P2' ? 0.55 : 0.15;
      const tend = dNow.tendencia > 0.15 ? 1 : dNow.tendencia > 0 ? 0.4 : 0;
      const score = Math.round((nivel * 0.55 + sev * 0.30 + tend * 0.15) * 100);
      out.push({
        eixo, eixoLbl: eixo === 'm2' ? 'Eixo 2' : 'Eixo 1',
        modoAtual: dNow.modo, modoPico: dPeak.modo,
        prioridade: dPeak.prioridade, prioridadeAtual: dNow.prioridade,
        acaoCurta: dPeak.acoes && dPeak.acoes[0] ? dPeak.acoes[0] : 'Manter inspeção de rotina.',
        score, quandoPico: quando,
        status: score >= 70 ? 'emergency' : score >= 45 ? 'critical' : score >= 20 ? 'warning' : 'normal',
      });
    });
    const worst = out.slice().sort((a, b) => b.score - a.score)[0] || null;
    return { eixos: out, ativos: ativos.map(a => ({ codigo: a.codigo, descricao: a.descricao || '', worst })), worst };
  }

  function alertas() {
    const fa = window.FZAlertas;
    const log = fa && typeof fa.historico === 'function' ? (fa.historico() || [])
      : (fa && Array.isArray(fa.historico) ? fa.historico : []);
    const ativados = log.filter(e => e.status === 'ATIVADO' || e.evento === 'ATIVADO' || e.tipo === 'ATIVADO');
    const p1 = ativados.filter(e => (e.prioridade || '').indexOf('1') > -1).length;
    const p2 = ativados.filter(e => (e.prioridade || '').indexOf('2') > -1).length;
    const audit = (window.FZAudit && window.FZAudit.list && window.FZAudit.list()) || [];
    const valid = audit.filter(a => a.tipo === 'alerta_validado').length;
    const rej = audit.filter(a => a.tipo === 'alerta_rejeitado').length;
    return { total: ativados.length, p1, p2, validados: valid, rejeitados: rej };
  }

  function ordensServico() {
    try {
      const l = JSON.parse(localStorage.getItem('forzy-os-log') || '[]');
      return { total: l.length, ultimas: l.slice(0, 5) };
    } catch (e) { return { total: 0, ultimas: [] }; }
  }

  function resumo() {
    const f = frota();
    const nCrit = f.eixos.filter(e => e.status === 'critical' || e.status === 'emergency').length;
    const nAtencao = f.eixos.filter(e => e.status === 'warning').length;
    return {
      disponibilidade: disponibilidade('m1'),
      mtbf: mtbf('m1'), mttr: mttr('m1'),
      alertas: alertas(), os: ordensServico(),
      frota: f, criticos: nCrit, atencao: nAtencao,
      modelo: (window.FZGovDados && window.FZGovDados.metrics && window.FZGovDados.metrics()) || {},
    };
  }

  window.FZBI = { disponibilidade, mtbf, mttr, frota, alertas, ordensServico, resumo, LIM };
})();
