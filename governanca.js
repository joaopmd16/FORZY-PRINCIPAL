/* ===================================================================
   FORZY · Governança  —  tela #screen-governanca
   Sub-abas: KPIs Estratégicos · Metric Contract + Circuit Breaker ·
   Auditoria / Trilha · Fairness. Gating por perfil (window.FZPerfil):
   Operador vê só KPIs; Analista vê tudo. Números vêm do window.FZBI
   e do window.FZGovDados — nada solto. Circuit Breaker portado da
   Sprint 3 GBA.
   =================================================================== */
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v, d = 1) => (v == null || v !== v) ? '—' : Number(v).toFixed(d);
  const brl = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR');

  let _root = null, _tab = null, _cbSensor = 'vibracao', _cbCenario = 'normal', _auditFiltro = '';

  const ABAS = [
    { id: 'kpi',    lbl: 'KPIs Estratégicos' },
    { id: 'metric', lbl: 'Metric Contract' },
    { id: 'audit',  lbl: 'Auditoria / Trilha' },
    { id: 'fair',   lbl: 'Fairness' },
  ];
  function abasPermitidas() {
    const op = window.FZPerfil && window.FZPerfil.isOperador && window.FZPerfil.isOperador();
    return op ? ABAS.filter(a => a.id === 'kpi') : ABAS.slice();
  }

  /* ==========  KPIs  ========== */
  function kpiPanel(titulo, rows) {
    return `<div class="fz-card fz-gov-kpi">
      <div class="fz-card-title">${esc(titulo)}</div>
      ${rows.map(([k, v, c]) => `<div class="fz-gov-kpi-row"><span>${esc(k)}</span><b style="color:${c || 'var(--text)'}">${esc(v)}</b></div>`).join('')}
    </div>`;
  }
  function renderKPI() {
    const bi = window.FZBI ? window.FZBI.resumo() : {};
    const m = (window.FZGovDados && window.FZGovDados.metrics && window.FZGovDados.metrics()) || {};
    const disp = bi.disponibilidade;
    const dispCor = disp >= 95 ? 'var(--fz-ok)' : disp >= 90 ? 'var(--fz-warn)' : 'var(--fz-bad)';
    return `<div class="fz-gov-kpi-grid">
      ${kpiPanel('Disponibilidade Operacional (série)', [
        ['Planta — vibração < alarme', fmt(disp) + '%', dispCor],
        ['MTBF estimado', bi.mtbf != null ? fmt(bi.mtbf) + ' h' : 'dados insuficientes', 'var(--teal)'],
        ['MTTR estimado', bi.mttr != null ? fmt(bi.mttr, 2) + ' h' : 'dados insuficientes', 'var(--teal)'],
        ['Ativos críticos / emergência', String(bi.criticos), bi.criticos ? 'var(--fz-bad)' : 'var(--fz-ok)'],
        ['Ativos em atenção', String(bi.atencao), bi.atencao ? 'var(--fz-warn)' : 'var(--fz-ok)'],
      ])}
      ${kpiPanel('Manutenção', [
        ['OS geradas (Copiloto)', String(bi.os ? bi.os.total : 0), 'var(--teal)'],
        ['Alertas na série', String(bi.alertas ? bi.alertas.total : 0), 'var(--fz-warn)'],
        ['— P1 crítico', String(bi.alertas ? bi.alertas.p1 : 0), 'var(--fz-bad)'],
        ['Custo evitado / mês (configurado)', brl(m.custo_evitado_mes), 'var(--fz-ok)'],
        ['Alertas validados (trilha)', bi.alertas ? String(bi.alertas.validados) : '0', 'var(--fz-ok)'],
      ])}
      ${kpiPanel('Performance do Modelo (configurado)', [
        ['Precisão', fmt(m.precisao) + '%', 'var(--teal)'],
        ['Recall', fmt(m.recall) + '%', 'var(--teal)'],
        ['F1-Score', fmt(m.f1) + '%', 'var(--teal)'],
        ['AUC-ROC', fmt(m.auc, 3), 'var(--fz-ok)'],
        ['Latência p99', fmt(m.latencia_p99_ms, 0) + ' ms', 'var(--fz-ok)'],
      ])}
      ${kpiPanel('Fairness — resumo', [
        ['Drift de modelo detectado', String(m.drift || '—'), m.drift === 'Não' ? 'var(--fz-ok)' : 'var(--fz-bad)'],
        ['Última revisão de fairness', String(m.ultima_revisao || '—'), 'var(--teal)'],
        ['Deploy do modelo', String(m.deploy || '—'), 'var(--text-2)'],
      ])}
      <div class="fz-gov-note">
        "Disponibilidade", MTBF, MTTR e contagem de alertas são <b>estimados da série histórica e da
        trilha local</b>. Precisão/Recall/F1/custo evitado são <b>valores configurados</b> (editáveis em
        forzy-gov.js) — em produção vêm da avaliação real do modelo no backend.
      </div>
    </div>`;
  }

  /* ==========  Metric Contract + Circuit Breaker  ========== */
  function metricContract() {
    const LIM = (window.FZCopiloto && window.FZCopiloto.LIM) || { vel: { a: 1.8, al: 4.5 }, acel: { a: 0.25, al: 0.45 }, temp: { a: 35, al: 42 } };
    const bl = (window.FORZY && window.FORZY.baseline) || {};
    return {
      vibracao: { label: 'Vibração RMS', unit: 'mm/s', atencao: LIM.vel.a, alarme: LIM.vel.al, baseline: bl.m1_vel ? +bl.m1_vel.mean.toFixed(2) : '—', norma: 'ISO 10816' },
      temperatura: { label: 'Temperatura de carcaça', unit: '°C', atencao: LIM.temp.a, alarme: LIM.temp.al, baseline: bl.m1_temp ? +bl.m1_temp.mean.toFixed(1) : '—', norma: 'ISA-18.2' },
      aceleracao: { label: 'Aceleração de impacto', unit: 'g', atencao: LIM.acel.a, alarme: LIM.acel.al, baseline: bl.m1_acel ? +bl.m1_acel.mean.toFixed(2) : '—', norma: 'ISO 10816' },
    };
  }
  function renderMetric() {
    const mc = metricContract();
    const CEN = {
      normal:   { conf: 91, gap: 0,  nota: 'Leitura íntegra, dentro da janela de amostragem esperada. Hash de integridade verificado.' },
      degraded: { conf: 54, gap: 18, nota: 'Perda intermitente de ~18% dos pacotes na janela de 60 s — abaixo do timeout, mas acima do aceitável para decisão autônoma.' },
      failure:  { conf: 0,  gap: 63, nota: 'Sensor sem reporte há 4 ciclos consecutivos e/ou leitura fora da faixa física do datasheet do fabricante.' },
    };
    const c = CEN[_cbCenario];
    let cls, titulo, texto, acao;
    if (_cbCenario === 'normal') {
      cls = 'ok'; titulo = 'IA aprovada para decisão autônoma';
      texto = `Dado íntegro (gap ${c.gap}%, confiança ${c.conf}%). O sistema classifica o valor contra os limiares do Metric Contract e gera o alerta proporcional automaticamente.`;
      acao = 'Alerta publicado conforme a severidade do limiar. Nenhuma intervenção humana bloqueante.';
    } else if (_cbCenario === 'degraded') {
      cls = 'warn'; titulo = 'Supervisão reforçada — confiança abaixo do limiar';
      texto = `Gap de ${c.gap}% e confiança ${c.conf}% (mínimo para decisão autônoma: 60%). O alerta não é bloqueado, mas cai para "não confirmado" e exige validação humana antes de qualquer Ordem de Serviço.`;
      acao = 'Alerta marcado como BAIXA CONFIANÇA. Handoff para o Engenheiro de Manutenção. A IA não decide sozinha.';
    } else {
      cls = 'trip'; titulo = 'Circuit Breaker acionado';
      texto = `Gap de ${c.gap}% (limite de contenção: 30%) e/ou leitura fisicamente incompatível com o datasheet. O sistema trava o alerta automático para evitar parada desnecessária motivada por dado não confiável.`;
      acao = 'Nenhuma Ordem de Serviço é gerada. Alerta suprimido e marcado como INVÁLIDO. Handoff obrigatório e imediato.';
    }
    return `<div class="fz-gov-stack">
      <div class="fz-card">
        <div class="fz-card-title">Metric Contract — limiares oficiais por sensor</div>
        <table class="fz-cop-table fz-gov-th">
          <thead><tr><th>Sensor</th><th>Normal</th><th>Atenção</th><th>Alarme</th><th>Baseline atual</th><th>Norma</th></tr></thead>
          <tbody>${Object.values(mc).map(v => `<tr>
            <td><b>${esc(v.label)}</b> <span style="color:var(--text-2)">(${esc(v.unit)})</span></td>
            <td style="color:var(--fz-ok)">&lt; ${v.atencao}</td>
            <td style="color:var(--fz-warn)">${v.atencao}–${v.alarme}</td>
            <td style="color:var(--fz-bad)">&gt; ${v.alarme}</td>
            <td>${esc(String(v.baseline))} ${esc(v.unit)}</td>
            <td style="color:var(--text-2)">${esc(v.norma)}</td>
          </tr>`).join('')}</tbody>
        </table>
        <div class="fz-cop-sub"><b>Definição de anomalia:</b> valor que ultrapassa o nível de Atenção por mais de 1 ciclo consecutivo e cujo padrão não é explicado por ruído. A IA gera um alerta proporcional à severidade — nunca interrompe a planta sozinha.</div>
      </div>

      <div class="fz-card">
        <div class="fz-card-title">Simulador de Circuit Breaker — qualidade do dado</div>
        <div class="fz-gov-simrow">
          ${Object.entries(mc).map(([k, v]) => `<button class="fz-btn ${_cbSensor === k ? 'fz-btn-primary' : 'ghost'}" data-cbs="${k}">${esc(v.label)}</button>`).join('')}
        </div>
        <div class="fz-gov-simrow">
          <button class="fz-btn ${_cbCenario === 'normal' ? 'fz-btn-primary' : 'ghost'}" data-cbc="normal">✓ Normal</button>
          <button class="fz-btn ${_cbCenario === 'degraded' ? 'fz-btn-primary' : 'ghost'}" data-cbc="degraded">⚠ Dados degradados</button>
          <button class="fz-btn ${_cbCenario === 'failure' ? 'fz-btn-primary' : 'ghost'}" data-cbc="failure">⛔ Falha do sensor</button>
        </div>
        <div class="fz-gov-cb fz-gov-cb-${cls}">
          <div class="fz-gov-cb-t">${esc(titulo)}</div>
          <p>${esc(texto)}</p>
          <div class="fz-gov-cb-foot"><b>Ação do sistema:</b> ${esc(acao)}<br><b>Detalhe técnico:</b> ${esc(c.nota)}</div>
        </div>
      </div>
    </div>`;
  }

  /* ==========  Auditoria  ========== */
  function renderAudit() {
    const l = (window.FZAudit && window.FZAudit.list()) || [];
    const filt = _auditFiltro ? l.filter(e => (e.tipo + e.ator + e.detalhe).toLowerCase().includes(_auditFiltro.toLowerCase())) : l;
    return `<div class="fz-card">
      <div class="fz-gov-audit-head">
        <div class="fz-card-title" style="margin:0">Trilha de auditoria — ${filt.length} evento(s)</div>
        <div class="fz-gov-audit-tools">
          <input class="fz-input" id="fzAuditF" placeholder="filtrar por tipo, ator, detalhe" value="${esc(_auditFiltro)}">
          <button class="fz-btn ghost" id="fzAuditCsv">Exportar CSV</button>
          <span class="fz-gov-integ">✓ append-only</span>
        </div>
      </div>
      <table class="fz-cop-table">
        <thead><tr><th>Trace</th><th>Quando</th><th>Tipo</th><th>Ator</th><th>Papel</th><th>Detalhe</th><th>Resultado</th></tr></thead>
        <tbody>${filt.length ? filt.slice(0, 200).map(e => `<tr>
          <td style="color:var(--teal);font-family:var(--font-num,monospace)">${esc(e.trace)}</td>
          <td style="color:var(--text-2)">${esc(new Date(e.ts).toLocaleString('pt-BR'))}</td>
          <td><b>${esc(e.tipo)}</b></td>
          <td>${esc(e.ator)}</td>
          <td style="color:var(--text-2)">${esc(e.papel)}</td>
          <td>${esc(e.detalhe)}</td>
          <td style="color:var(--text-2)">${esc(e.resultado)}</td>
        </tr>`).join('') : '<tr><td colspan="7" style="color:var(--text-2)">Sem eventos ainda. Faça login/logout, gere uma OS ou reconheça um alerta para popular a trilha.</td></tr>'}</tbody>
      </table>
      <div class="fz-cop-sub">Armazenamento local (localStorage, cap 500). Em produção: banco append-only + retenção de 5 anos (ver documento de arquitetura).</div>
    </div>`;
  }

  /* ==========  Fairness  ========== */
  function renderFair() {
    const F = (window.FZGovDados && window.FZGovDados.fairness && window.FZGovDados.fairness()) || [];
    return `<div class="fz-gov-fair-grid">
      ${F.map(b => `<div class="fz-card fz-gov-bias">
        <div class="fz-gov-bias-h">
          <b>${esc(b.nome)}</b>
          <span class="fz-cop-tag fz-cop-${b.nivel === 'alta' ? 'bad' : 'warn'}">Risco ${esc(b.nivel)}</span>
        </div>
        <p class="fz-cop-sub">${esc(b.desc)}</p>
        <div class="fz-gov-bias-mit">▶ Mitigação: ${esc(b.mitigacao)}</div>
      </div>`).join('')}
    </div>`;
  }

  /* ==========  shell  ========== */
  function render() {
    if (!_root) return;
    const abas = abasPermitidas();
    if (!abas.length) { _root.innerHTML = '<div class="fz-card">Você não tem acesso a nenhuma seção de Governança.</div>'; return; }
    if (!_tab || !abas.some(a => a.id === _tab)) _tab = abas[0].id;

    let corpo = '';
    if (_tab === 'kpi') corpo = renderKPI();
    else if (_tab === 'metric') corpo = renderMetric();
    else if (_tab === 'audit') corpo = renderAudit();
    else if (_tab === 'fair') corpo = renderFair();

    _root.innerHTML = `
      <div class="fz-tabs" id="fzGovTabs">
        ${abas.map(a => `<button class="fz-tab ${a.id === _tab ? 'active' : ''}" data-gt="${a.id}">${esc(a.lbl)}</button>`).join('')}
      </div>
      <div class="fz-gov-body">${corpo}</div>`;

    _root.querySelectorAll('[data-gt]').forEach(b => b.addEventListener('click', () => { _tab = b.dataset.gt; render(); }));
    _root.querySelectorAll('[data-cbs]').forEach(b => b.addEventListener('click', () => { _cbSensor = b.dataset.cbs; render(); }));
    _root.querySelectorAll('[data-cbc]').forEach(b => b.addEventListener('click', () => { _cbCenario = b.dataset.cbc; render(); }));
    const f = _root.querySelector('#fzAuditF');
    if (f) f.addEventListener('input', e => {
      _auditFiltro = e.target.value;
      render();
      const nf = _root.querySelector('#fzAuditF');
      if (nf) { nf.focus(); nf.setSelectionRange(nf.value.length, nf.value.length); }
    });
    const csv = _root.querySelector('#fzAuditCsv');
    if (csv) csv.addEventListener('click', () => window.FZAudit && window.FZAudit.exportCSV());
  }

  function init() {
    _root = document.getElementById('governancaRoot');
    if (!_root) return;
    render();
  }

  window.FZGovernanca = { init, render };
})();
