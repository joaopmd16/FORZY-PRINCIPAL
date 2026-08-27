/* ===================================================================
   FORZY · INÍCIO — hub central funcional
   Player ao vivo sobre window.FORZY, KPIs, sparklines, log de eventos.
   =================================================================== */
(function () {
  const F = window.FORZY;
  if (!F) { console.error('inicio.js: FORZY ausente'); return; }

  const VEL_AL = 1.8, VEL_ALM = 4.5, TEMP_AL = 35.0, TEMP_ALM = 42.0;
  const NOME = ['NORMAL', 'ALERTA', 'ALARME'];
  const N = F.meta.n;
  const T0 = new Date(F.meta.t0).getTime();
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const COR = () => [cssVar('--fz-ok'), cssVar('--fz-warn'), cssVar('--fz-bad')];
  const SOFT = () => [cssVar('--fz-ok-soft'), cssVar('--fz-warn-soft'), cssVar('--fz-bad-soft')];

  const flag = (v, a, al) => (v >= al ? 2 : v >= a ? 1 : 0);
  const fmt = (v, d = 2) => (v == null || v !== v) ? '—' : Number(v).toFixed(d);
  const el = (id) => document.getElementById(id);
  function timeLabel(i) { const d = new Date(T0 + F.t[i] * 1000); return d.toLocaleTimeString('pt-BR', { hour12: false }); }
  function hm(i) { const d = new Date(T0 + F.t[i] * 1000); return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }

  /* ----------  estado  ---------- */
  const state = { fonte: 'forzy', auto: true, intervalo: 5000, idx: 0, t: 0, simHist: { v1: [], v2: [] }, timer: null };

  /* ----------  KPIs (calculados uma vez)  ---------- */
  const KPI = (function () {
    const m1 = F.m1.vel, m2 = F.m2.vel;
    let al = 0, up = 0;
    for (let i = 0; i < N; i++) { if (m1[i] >= VEL_ALM) al++; if (m2[i] >= VEL_ALM) al++; if (m1[i] < VEL_AL) up++; }
    const dur = (F.t[N - 1] - F.t[0]);
    const h = Math.floor(dur / 3600);
    const split = Math.max(1, Math.floor(N / 10));
    const mean = (arr, a, b) => { let s = 0; for (let i = a; i < b; i++) s += arr[i]; return s / (b - a); };
    const tend = mean(m1, N - split, N) - mean(m1, N - 2 * split, N - split);
    return { uptime: (up / N * 100).toFixed(1), alarmes: al, horas: h, tend, total: N };
  })();

  /* ----------  log de eventos (calculado uma vez)  ---------- */
  const EVENTS = (function () {
    const m1 = F.m1.vel, m2 = F.m2.vel;
    const st = v => (v >= VEL_ALM ? 2 : v >= VEL_AL ? 1 : 0);
    const ev = [];
    const lim = Math.min(N, 500);
    for (let i = 1; i < lim; i++) {
      if (st(m1[i]) !== st(m1[i - 1])) ev.push({ i, motor: 'Eixo 1', f: st(m1[i]), vel: m1[i] });
      if (st(m2[i]) !== st(m2[i - 1])) ev.push({ i, motor: 'Eixo 2', f: st(m2[i]), vel: m2[i] });
    }
    ev.push({ i: N - 1, motor: 'Dataset', f: -1, det: `${N.toLocaleString('pt-BR')} amostras · forzy.csv` });
    ev.sort((a, b) => b.i - a.i);
    return ev.slice(0, 12);
  })();

  /* ----------  sparkline  ---------- */
  function sparkPath(arr, threshold) {
    const W = 200, H = 48, n = arr.length;
    if (n < 2) return { line: '', area: '', threshY: null };
    let mn = Infinity, mx = -Infinity;
    for (const v of arr) { if (v < mn) mn = v; if (v > mx) mx = v; }
    if (threshold != null) mx = Math.max(mx, threshold);
    if (mx - mn < 1e-6) { mn -= 1; mx += 1; }
    const X = i => (i * W / (n - 1));
    const Y = v => (H - 4 - ((v - mn) / (mx - mn)) * (H - 8));
    let d = 'M' + X(0).toFixed(1) + ',' + Y(arr[0]).toFixed(1);
    for (let i = 1; i < n; i++) d += ' L' + X(i).toFixed(1) + ',' + Y(arr[i]).toFixed(1);
    const threshY = threshold != null ? Y(threshold) : null;
    return { line: d, area: `${d} L${W},${H} L0,${H} Z`, threshY };
  }

  /* ----------  geração simulada (simples)  ---------- */
  function rng() { return Math.random(); }
  function gauss(mu, sd) { let u = 0, v = 0; while (!u) u = rng(); while (!v) v = rng(); return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  const SIM = { normal: 1, desbalanco: 1.9, cavitacao: 2.6, desalinhamento: 2.2 };
  let simModo = 'normal';

  /* ----------  leitura atual  ---------- */
  function currentReading() {
    if (state.fonte === 'forzy') {
      const i = state.idx;
      return { v1: F.m1.vel[i], t1: F.m1.temp[i], v2: F.m2.vel[i], t2: F.m2.temp[i],
               win1: window120(F.m1.vel, i), win2: window120(F.m2.vel, i) };
    }
    const mult = SIM[simModo] || 1;
    const v1 = Math.max(0, gauss(0.8 * mult, 0.18 * mult)), t1 = gauss(31, 1.5);
    const v2 = Math.max(0, gauss(0.9 * mult, 0.2 * mult)), t2 = gauss(32, 1.6);
    state.simHist.v1.push(v1); state.simHist.v2.push(v2);
    state.simHist.v1 = state.simHist.v1.slice(-120); state.simHist.v2 = state.simHist.v2.slice(-120);
    return { v1, t1, v2, t2, win1: state.simHist.v1.slice(), win2: state.simHist.v2.slice() };
  }
  function window120(arr, i) { const a = Math.max(0, i - 120); return arr.slice(a, i + 1); }

  /* ----------  controles  ---------- */
  function renderControls() {
    const c = el('inicioControls');
    if (!c) return;
    c.innerHTML = `
      <div class="fz-field"><span>Fonte</span>
        <div class="fz-seg" data-act="fonte">
          <button class="${state.fonte === 'forzy' ? 'active' : ''}" data-v="forzy">Dataset Forzy</button>
          <button class="${state.fonte === 'sim' ? 'active' : ''}" data-v="sim">Simulado</button>
        </div>
      </div>
      <div class="fz-field"><span>Auto-refresh</span>
        <label class="fz-toggle ${state.auto ? 'on' : ''}" data-act="auto"><span class="sw"></span><span>${state.auto ? 'Ligado' : 'Pausado'}</span></label>
      </div>
      <div class="fz-field"><span>Intervalo</span>
        <select class="fz-select" data-act="intervalo">
          <option value="2000" ${state.intervalo === 2000 ? 'selected' : ''}>2s</option>
          <option value="5000" ${state.intervalo === 5000 ? 'selected' : ''}>5s</option>
          <option value="10000" ${state.intervalo === 10000 ? 'selected' : ''}>10s</option>
        </select>
      </div>
      ${state.fonte === 'sim' ? `
      <div class="fz-field"><span>Cenário</span>
        <select class="fz-select" data-act="modo">
          <option value="normal">Normal</option>
          <option value="desbalanco">Desbalanceamento</option>
          <option value="cavitacao">Cavitação</option>
          <option value="desalinhamento">Desalinhamento</option>
        </select>
      </div>` : ''}`;

    c.querySelector('[data-act="fonte"]').querySelectorAll('button').forEach(b =>
      b.addEventListener('click', () => { state.fonte = b.dataset.v; renderControls(); render(); }));
    c.querySelector('[data-act="auto"]').addEventListener('click', () => { state.auto = !state.auto; renderControls(); });
    c.querySelector('[data-act="intervalo"]').addEventListener('change', e => { state.intervalo = +e.target.value; startTimer(); });
    const modo = c.querySelector('[data-act="modo"]');
    if (modo) { modo.value = simModo; modo.addEventListener('change', e => { simModo = e.target.value; render(); }); }
  }

  /* ----------  render principal  ---------- */
  function render() {
    const [cOk, cWarn, cBad] = COR();
    const cols = [cOk, cWarn, cBad];
    const soft = SOFT();
    const r = currentReading();
    const f1 = Math.max(flag(r.v1, VEL_AL, VEL_ALM), flag(r.t1, TEMP_AL, TEMP_ALM));
    const f2 = Math.max(flag(r.v2, VEL_AL, VEL_ALM), flag(r.t2, TEMP_AL, TEMP_ALM));
    const pior = Math.max(f1, f2);

    // header
    const badge = el('inicioStatus');
    if (badge) {
      badge.textContent = NOME[pior];
      badge.className = 'fz-badge ' + ['fz-badge-ok', 'fz-badge-warn', 'fz-badge-bad'][pior];
    }
    const time = el('inicioTime');
    if (time) {
      time.textContent = state.fonte === 'forzy'
        ? new Date(T0 + F.t[state.idx] * 1000).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' })
        : new Date().toLocaleTimeString('pt-BR', { hour12: false });
    }

    // progress
    const prog = el('inicioProgress');
    if (prog) {
      if (state.fonte === 'forzy') {
        prog.hidden = false;
        const pct = (state.idx / Math.max(N - 1, 1) * 100);
        prog.querySelector('.fill').style.width = pct.toFixed(1) + '%';
        prog.querySelector('.p-lbl').textContent = `Dataset Forzy · frame ${state.idx + 1}/${N} · ${timeLabel(state.idx)}`;
      } else { prog.hidden = true; }
    }

    // KPIs
    const kbar = el('inicioKpis');
    if (kbar) {
      const ti = KPI.tend > 0.05 ? '↑' : KPI.tend < -0.05 ? '↓' : '→';
      const tc = KPI.tend > 0.05 ? cBad : KPI.tend < -0.05 ? cOk : cWarn;
      const cells = [
        ['Disponibilidade', KPI.uptime + '%', cOk],
        ['Total de Alarmes', String(KPI.alarmes), KPI.alarmes > 0 ? cBad : cOk],
        ['Horas em Operação', KPI.horas + 'h', cssVar('--text')],
        ['Tendência Vel Eixo 1', `${ti} ${Math.abs(KPI.tend).toFixed(3)} mm/s`, tc],
        ['Amostras', KPI.total.toLocaleString('pt-BR'), cssVar('--text-2')],
      ];
      kbar.innerHTML = cells.map(([l, v, c]) =>
        `<div class="fz-kpi-cell"><div class="k-lbl">${l}</div><div class="k-val" style="color:${c}">${v}</div></div>`).join('');
    }

    // assets
    const assets = el('inicioAssets');
    if (assets) {
      const motor = (nome, vel, temp, f, win) => {
        const sp = sparkPath(win, VEL_ALM);
        const cls = ['fz-asset-ok', 'fz-asset-warn', 'fz-asset-bad'][f];
        const thresh = (sp.threshY != null && sp.threshY >= 0 && sp.threshY <= 48)
          ? `<line class="a-thresh" x1="0" y1="${sp.threshY.toFixed(1)}" x2="200" y2="${sp.threshY.toFixed(1)}"/>` : '';
        return `<div class="fz-asset ${cls}">
          <div class="a-name">${nome}</div>
          <div class="a-status" style="color:${cols[f]}">${NOME[f]}</div>
          <div class="a-read">Vel: <b>${fmt(vel, 3)} mm/s</b> &nbsp; Temp: <b>${fmt(temp, 1)} °C</b></div>
          <svg class="a-spark" viewBox="0 0 200 48" preserveAspectRatio="none">
            <path fill="${soft[f]}" d="${sp.area}"/>
            ${thresh}
            <path fill="none" stroke="${cols[f]}" stroke-width="1.6" d="${sp.line}"/>
          </svg></div>`;
      };
      const dur = F.t[N - 1] - F.t[0];
      const dh = Math.floor(dur / 3600), dm = Math.floor((dur % 3600) / 60);
      assets.innerHTML =
        motor('Eixo 1', r.v1, r.t1, f1, r.win1) +
        motor('Eixo 2', r.v2, r.t2, f2, r.win2) +
        `<div class="fz-info-card"><div class="i-lbl">Sensor</div>
           <div class="i-body">VIM32PL-E1AC8<br>IO-Link 1.1<br>38,4 kBit/s<br><b style="color:${cOk}">Ativo</b></div></div>
         <div class="fz-info-card"><div class="i-lbl">Dataset</div>
           <div class="i-body">${N.toLocaleString('pt-BR')} amostras<br>${hm(0)} → ${hm(N - 1)}<br>Duração: ${dh}h ${String(dm).padStart(2, '0')}min<br><b>forzy.csv</b></div></div>`;
    }

    // log
    const log = el('inicioLog');
    if (log) {
      const ACAO = ['Nenhuma ação necessária.', 'Recomenda-se verificação na próxima ronda.', 'Intervenção imediata recomendada.'];
      const alertas = EVENTS.filter(e => e.f >= 1);
      if (!alertas.length) {
        log.innerHTML = `<div class="fz-log-empty">Nenhum alerta ou alarme recente — motor operando normalmente.</div>`;
        return;
      }
      log.innerHTML = alertas.map((e, idx) => {
        const c = e.f < 0 ? cssVar('--text-3') : cols[e.f];
        const status = e.f < 0 ? 'COLETADO' : NOME[e.f];
        const det = e.det || `Vel = ${fmt(e.vel, 3)} mm/s`;
        const full = new Date(T0 + F.t[e.i] * 1000).toLocaleString('pt-BR');
        const acao = e.f < 0 ? 'Dataset carregado com sucesso.' : ACAO[e.f];
        return `<div class="fz-log-row" data-idx="${idx}"><div class="l-time">${hm(e.i)}</div>
          <div class="l-dot" style="background:${c}"></div>
          <div class="l-txt"><b style="color:${c}">${e.motor}</b> → ${status}<span class="l-det">${det}</span>
            <div class="l-more"><span class="l-more-row"><b>Horário completo:</b> ${full}</span><span class="l-more-row"><b>Recomendação:</b> ${acao}</span></div>
          </div>
          <div class="l-chev">›</div></div>`;
      }).join('');
      if (!log.dataset.expandBound) {
        log.dataset.expandBound = '1';
        log.addEventListener('click', (ev) => {
          const row = ev.target.closest('.fz-log-row');
          if (!row || !log.contains(row)) return;
          row.classList.toggle('expanded');
        });
      }
    }
  }

  /* ----------  player  ---------- */
  function tick() {
    const active = document.getElementById('screen-inicio').classList.contains('active');
    if (!active || !state.auto) return;
    if (state.fonte === 'forzy') state.idx = (state.idx + 5) % N;
    render();
  }
  function startTimer() { if (state.timer) clearInterval(state.timer); state.timer = setInterval(tick, state.intervalo); }

  /* ----------  CSV export  ---------- */
  function exportCSV() {
    const cols = ['timestamp', 'm1_vel', 'm1_acel', 'm1_temp', 'm2_vel', 'm2_acel', 'm2_temp'];
    let csv = cols.join(';') + '\n';
    for (let i = 0; i < N; i++) {
      csv += [timeLabel(i), F.m1.vel[i], F.m1.acel[i], F.m1.temp[i], F.m2.vel[i], F.m2.acel[i], F.m2.temp[i]].join(';') + '\n';
    }
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'forzy_export.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* ----------  init  ---------- */
  function init() {
    if (!el('inicioControls')) return;
    renderControls();
    render();
    startTimer();
    const rf = el('inicioRefresh'); if (rf) rf.addEventListener('click', () => { state.idx = 0; state.simHist = { v1: [], v2: [] }; render(); });
    const ex = el('inicioExport'); if (ex) ex.addEventListener('click', exportCSV);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
