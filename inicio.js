/* inicio.js: tela Inicio (painel principal): escolhe a fabrica, o setor e o motor e mostra as metricas dele */

(function () {
  const F = window.FORZY;
  if (!F) { console.error('inicio.js: FORZY ausente'); return; }
  const FAB = window.FZFabrica, SEL = window.FZSelecao;
  if (!FAB || !SEL) { console.error('inicio.js: fabrica.js ausente'); return; }

  const VEL_AL = 1.8, VEL_ALM = 4.5, ACEL_AL = 0.25, ACEL_ALM = 0.45, TEMP_AL = 35.0, TEMP_ALM = 42.0;
  const NOME = ['NORMAL', 'ALERTA', 'ALARME'];
  const N = F.meta.n;
  const T0 = new Date(F.meta.t0).getTime();
  // le o valor de uma variavel CSS (cor do tema)
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  // cores por nivel de status
  const COR = () => [cssVar('--fz-ok'), cssVar('--fz-warn'), cssVar('--fz-bad')];
  // versao suave das cores
  const SOFT = () => [cssVar('--fz-ok-soft'), cssVar('--fz-warn-soft'), cssVar('--fz-bad-soft')];

  // classifica o valor: 0 normal, 1 alerta, 2 alarme
  const flag = (v, a, al) => (v >= al ? 2 : v >= a ? 1 : 0);
  const fmt = (v, d = 2) => (v == null || v !== v) ? '—' : Number(v).toFixed(d);
  // atalho pra pegar um elemento pelo id
  const el = (id) => document.getElementById(id);
  // protege o texto contra HTML/XSS antes de ir pro innerHTML
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // formata o tempo pra mostrar na tela
  function timeLabel(i) { const d = new Date(T0 + F.t[i] * 1000); return d.toLocaleTimeString('pt-BR', { hour12: false }); }
  // formata hora:minuto
  function hm(i) { const d = new Date(T0 + F.t[i] * 1000); return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }

  // fonte da bancada: "forzy" (dataset) ou "cloud"
  const state = { fonte: 'forzy', auto: true, intervalo: 2000, idx: 0, timer: null };

  // alertas do dataset real (bancada)
  const EVENTS = (function () {
    const m1 = F.m1.vel, m2 = F.m2.vel;
    const st = v => (v >= VEL_ALM ? 2 : v >= VEL_AL ? 1 : 0);
    const ev = [];
    const lim = Math.min(N, 500);
    for (let i = 1; i < lim; i++) {
      if (st(m1[i]) !== st(m1[i - 1])) ev.push({ i, motor: 'Eixo 1', f: st(m1[i]), vel: m1[i] });
      if (st(m2[i]) !== st(m2[i - 1])) ev.push({ i, motor: 'Eixo 2', f: st(m2[i]), vel: m2[i] });
    }
    ev.sort((a, b) => b.i - a.i);
    return ev.slice(0, 12);
  })();

  // caminho SVG do mini grafico
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
  // mini grafico pronto (area + linha + limite de alarme tracejado)
  function spark(arr, limite, f) {
    const cols = COR(), soft = SOFT(), sp = sparkPath(arr, limite);
    const thresh = (sp.threshY != null && sp.threshY >= 0 && sp.threshY <= 48)
      ? `<line class="a-thresh" x1="0" y1="${sp.threshY.toFixed(1)}" x2="200" y2="${sp.threshY.toFixed(1)}"/>` : '';
    return `<svg class="a-spark" viewBox="0 0 200 48" preserveAspectRatio="none">
      <path fill="${soft[f]}" d="${sp.area}"/>${thresh}<path fill="none" stroke="${cols[f]}" stroke-width="1.6" d="${sp.line}"/></svg>`;
  }

  // ultimos 120 pontos
  function window120(arr, i) { const a = Math.max(0, i - 120); return arr.slice(a, i + 1); }

  // leitura atual da bancada (dataset ou cloud)
  function currentReading() {
    if (state.fonte === 'cloud') {
      const s1 = (window.FZCloud && window.FZCloud.getRows('s1')) || [];
      const s2 = (window.FZCloud && window.FZCloud.getRows('s2')) || [];
      const l1 = s1.length ? s1[s1.length - 1] : null;
      const l2 = s2.length ? s2[s2.length - 1] : null;
      return { v1: l1 ? l1.velocidade : 0, t1: l1 ? l1.temperatura : 0,
               v2: l2 ? l2.velocidade : 0, t2: l2 ? l2.temperatura : 0,
               win1: s1.slice(-120).map(r => r.velocidade), win2: s2.slice(-120).map(r => r.velocidade) };
    }
    const i = state.idx;
    return { v1: F.m1.vel[i], t1: F.m1.temp[i], v2: F.m2.vel[i], t2: F.m2.temp[i],
             win1: window120(F.m1.vel, i), win2: window120(F.m2.vel, i) };
  }
  // true se o Forzy Cloud ja carregou
  const cloudCarregado = () => !!(window.FZCloud && window.FZCloud.isLoaded());
  // true se a tela esta mostrando a Fabrica Forzy
  const naFabrica = () => SEL.get().fabrica === 'forzy';

  // ---------------------------------------------------------------- controles (engrenagem)
  function renderControls() {
    const c = el('inicioControls');
    if (!c) return;
    c.innerHTML = `
      ${naFabrica() ? '' : `<div class="fz-field"><span>Fonte</span>
        <div class="fz-seg" data-act="fonte">
          <button class="${state.fonte === 'forzy' ? 'active' : ''}" data-v="forzy">Dataset Forzy (rede neural)</button>
          <button class="${state.fonte === 'cloud' ? 'active' : ''}" data-v="cloud"
            style="${cloudCarregado() ? 'color:var(--fz-ok)' : 'opacity:.55'}">⬤ Forzy Cloud</button>
        </div></div>`}
      <div class="fz-field"><span>Auto-refresh</span>
        <label class="fz-toggle ${state.auto ? 'on' : ''}" data-act="auto"><span class="sw"></span><span>${state.auto ? 'Ligado' : 'Pausado'}</span></label>
      </div>
      <div class="fz-field"><span>Intervalo</span>
        <select class="fz-select" data-act="intervalo">
          ${[2000, 5000, 10000].map(v => `<option value="${v}" ${state.intervalo === v ? 'selected' : ''}>${v / 1000}s</option>`).join('')}
        </select>
      </div>`;
    c.querySelectorAll('[data-act="fonte"] button').forEach(b =>
      b.addEventListener('click', () => { state.fonte = b.dataset.v; renderControls(); render(); }));
    c.querySelector('[data-act="auto"]').addEventListener('click', () => { state.auto = !state.auto; renderControls(); });
    c.querySelector('[data-act="intervalo"]').addEventListener('change', e => { state.intervalo = +e.target.value; startTimer(); });
  }

  // ---------------------------------------------------------------- Fabrica Forzy
  // faixa com o resumo do que esta na tela (quantos motores em cada status)
  function resumoHtml(setor) {
    const r = FAB.resumo(setor), cols = COR();
    const chip = (n, lbl, c) => `<span class="fz-res-chip"><i style="background:${c}"></i><b>${n}</b> ${lbl}</span>`;
    return `<span class="fz-res-tit">${esc(setor || 'Fábrica Forzy')} · ${r.total} motores</span>` +
      chip(r.normal, 'normal', cols[0]) + chip(r.alerta, 'em alerta', cols[1]) + chip(r.alarme, 'em alarme', cols[2]);
  }

  // metrica de um eixo: valor grande, status e grafico dos ultimos pontos
  function metrica(lbl, unit, dec, serie, a, al) {
    const cols = COR(), v = serie[serie.length - 1], f = flag(v, a, al);
    return `<div class="fz-met">
      <div class="fz-met-top"><span class="fz-met-lbl">${lbl}</span><span class="fz-met-val" style="color:${cols[f]}">${fmt(v, dec)} <small>${unit}</small></span></div>
      ${spark(serie.slice(-60), al, f)}
      <div class="fz-met-foot">alerta ${fmt(a, a < 1 ? 2 : 1)} · alarme ${fmt(al, al < 1 ? 2 : 1)} ${unit}</div></div>`;
  }
  // card de um eixo com as 3 metricas
  function eixoHtml(m, e) {
    const cols = COR(), h = m.hist, p = 'm' + e + '_', r = m.r;
    const f = FAB.statusEixo(r[p + 'vel'], r[p + 'acel'], r[p + 'temp']);
    return `<div class="fz-card fz-eixo"><div class="fz-eixo-head"><b>Eixo ${e}</b><span class="fz-badge" style="color:${cols[f]};border:1px solid ${cols[f]}">${NOME[f]}</span></div>
      ${metrica('Velocidade RMS', 'mm/s', 2, h.map(x => x[p + 'vel']), VEL_AL, VEL_ALM)}
      ${metrica('Aceleração', 'g', 3, h.map(x => x[p + 'acel']), ACEL_AL, ACEL_ALM)}
      ${metrica('Temperatura', '°C', 1, h.map(x => x[p + 'temp']), TEMP_AL, TEMP_ALM)}</div>`;
  }
  // painel completo do motor escolhido
  function motorHtml(m) {
    const cols = COR(), r = m.r, tend = FAB.tendencia(m.codigo);
    const ti = tend > 0.02 ? '↑' : tend < -0.02 ? '↓' : '→', tc = tend > 0.02 ? cols[2] : tend < -0.02 ? cols[0] : cols[1];
    const sc = m.saude >= 70 ? cols[0] : m.saude >= 40 ? cols[1] : cols[2];
    const op = (l, v, u) => `<div class="fz-op"><div class="fz-op-lbl">${l}</div><div class="fz-op-val">${v}<small> ${u}</small></div></div>`;
    return `<div class="fz-card fz-motor">
      <div class="fz-motor-head">
        <div><div class="fz-motor-cod">${esc(m.codigo)} <span class="fz-badge" style="color:${cols[m.f]};border:1px solid ${cols[m.f]}">${NOME[m.f]}</span></div>
          <div class="fz-motor-nome">${esc(m.descricao.replace(' · 2 eixos', ''))} · ${esc(m.setor)} · ${m.potencia_kw} kW · ${esc(m.fabricante)}</div></div>
        <div class="fz-motor-saude"><div class="fz-saude-num" style="color:${sc}">${m.saude}</div><div class="fz-op-lbl">Saúde / 100</div></div>
      </div>
      <div class="fz-ops">
        ${op('Rotação', fmt(r.rpm, 0), 'rpm')}${op('Corrente', fmt(r.corrente, 1), 'A')}${op('Carga', fmt(r.carga, 0), '%')}
        <div class="fz-op"><div class="fz-op-lbl">Tendência da vibração</div><div class="fz-op-val" style="color:${tc}">${ti} ${fmt(Math.abs(tend), 2)}<small> mm/s por min</small></div></div>
      </div>
      <div class="fz-motor-acoes">
        <button class="fz-btn" data-ir="dashboard">Ver no Monitoramento</button>
        <button class="fz-btn" data-ir="diagnostico">Diagnosticar este motor</button>
        <button class="fz-btn ghost" data-ir="assistente">Perguntar ao Assistente IA</button>
        <button class="fz-btn ghost" data-ir="voltar">← Voltar à visão geral</button>
      </div></div>
      <div class="fz-row2">${eixoHtml(m, 1)}${eixoHtml(m, 2)}</div>`;
  }

  function renderFabrica() {
    const s = SEL.get(), cols = COR();
    const motores = FAB.motores(s.setor), pior = motores.reduce((p, m) => Math.max(p, m.f), 0);
    const badge = el('inicioStatus');
    if (badge) { badge.textContent = NOME[pior]; badge.className = 'fz-badge ' + ['fz-badge-ok', 'fz-badge-warn', 'fz-badge-bad'][pior]; }
    const time = el('inicioTime');
    if (time) time.textContent = new Date().toLocaleTimeString('pt-BR', { hour12: false }) + ' · dados simulados ao vivo';
    const prog = el('inicioProgress'); if (prog) prog.hidden = true;

    const res = el('inicioResumo');
    if (res) { res.hidden = false; res.innerHTML = resumoHtml(s.setor); }
    const tit = el('inicioTitulo'); if (tit) tit.textContent = s.motor ? 'Motor selecionado' : (s.setor ? 'Motores do setor ' + s.setor : 'Motores da fábrica');

    const box = el('inicioAssets'); if (!box) return;
    box.className = 'fz-fab-box';
    const m = s.motor ? FAB.motores().find(x => x.codigo === s.motor) : null;
    if (m) {
      box.innerHTML = motorHtml(m);
      box.querySelectorAll('[data-ir]').forEach(b => b.addEventListener('click', () => {
        const d = b.dataset.ir;
        if (d === 'voltar') SEL.set({ motor: null });
        else if (d === 'assistente') { window.FZChatScreen?.abrirAtivo?.(m.codigo); window.showScreen('assistente'); }
        else window.showScreen(d);
      }));
    } else {
      box.innerHTML = '<div id="inicioTiles"></div>';
      FAB.tiles(el('inicioTiles'), s.setor);
    }
  }

  // alertas recentes da fabrica: so do que esta na tela (setor ou motor escolhido)
  function logFabrica() {
    const log = el('inicioLog'); if (!log) return;
    const s = SEL.get(), cols = COR();
    const ev = FAB.eventos().filter(e => s.motor ? e.codigo === s.motor : (!s.setor || e.setor === s.setor)).slice(0, 8);
    if (!ev.length) { log.innerHTML = '<div class="fz-log-empty">Nenhum alerta ou alarme recente — tudo operando normalmente.</div>'; return; }
    const ACAO = ['Voltou ao normal.', 'Recomenda-se verificação na próxima ronda.', 'Intervenção imediata recomendada.'];
    log.innerHTML = ev.map(e => {
      const c = cols[e.f], hora = new Date(e.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      return `<div class="fz-log-row" data-cod="${e.codigo}"><div class="l-time">${hora}</div><div class="l-dot" style="background:${c}"></div>
        <div class="l-txt"><b style="color:${c}">${e.codigo}</b> · ${esc(e.desc)} → ${NOME[e.f]}<span class="l-det">${esc(e.setor)} · Eixo ${e.eixo} · Vel ${fmt(e.vel, 2)} mm/s · ${fmt(e.temp, 0)} °C · ${ACAO[e.f]}</span></div>
        <div class="l-chev">›</div></div>`;
    }).join('');
    log.onclick = ev2 => { const row = ev2.target.closest('.fz-log-row'); if (row && row.dataset.cod) SEL.set({ fabrica: 'forzy', motor: row.dataset.cod }); };
  }

  // ---------------------------------------------------------------- Bancada (dataset real)
  function renderBancada() {
    const cols = COR();
    const r = currentReading();
    const f1 = Math.max(flag(r.v1, VEL_AL, VEL_ALM), flag(r.t1, TEMP_AL, TEMP_ALM));
    const f2 = Math.max(flag(r.v2, VEL_AL, VEL_ALM), flag(r.t2, TEMP_AL, TEMP_ALM));
    const pior = Math.max(f1, f2);
    const badge = el('inicioStatus');
    if (badge) { badge.textContent = NOME[pior]; badge.className = 'fz-badge ' + ['fz-badge-ok', 'fz-badge-warn', 'fz-badge-bad'][pior]; }
    const time = el('inicioTime');
    if (time) time.textContent = state.fonte === 'forzy'
      ? new Date(T0 + F.t[state.idx] * 1000).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' })
      : new Date().toLocaleTimeString('pt-BR', { hour12: false });
    const res = el('inicioResumo'); if (res) res.hidden = true;
    const tit = el('inicioTitulo'); if (tit) tit.textContent = 'Status dos Eixos';

    const prog = el('inicioProgress');
    if (prog) {
      prog.hidden = false;
      const forzy = state.fonte === 'forzy';
      prog.querySelector('.fill').style.width = (forzy ? state.idx / Math.max(N - 1, 1) * 100 : 100).toFixed(1) + '%';
      prog.querySelector('.p-lbl').textContent = forzy ? `Dataset Forzy · frame ${state.idx + 1}/${N} · ${timeLabel(state.idx)}`
        : (cloudCarregado() ? `Forzy Cloud · ${(window.FZCloud.getRows('s1') || []).length} coleta(s)` : 'Forzy Cloud · aguardando 1ª coleta do daily_bridge.py');
    }
    const motor = (nome, vel, temp, f, win) => {
      if (vel == null || vel !== vel) {
        return `<div class="fz-asset"><div class="a-name">${nome}</div><div class="a-status" style="color:var(--text-3)">SEM LEITURA</div>
          <div class="a-read" style="color:var(--text-3)">Esta fonte não fornece dados deste eixo.</div></div>`;
      }
      return `<div class="fz-asset ${['fz-asset-ok', 'fz-asset-warn', 'fz-asset-bad'][f]}">
        <div class="a-name">${nome}</div><div class="a-status" style="color:${cols[f]}">${NOME[f]}</div>
        <div class="a-read">Vel: <b>${fmt(vel, 3)} mm/s</b> &nbsp; Temp: <b>${fmt(temp, 1)} °C</b></div>${spark(win, VEL_ALM, f)}</div>`;
    };
    const box = el('inicioAssets');
    if (box) { box.className = 'fz-grid4 fz-bancada'; box.innerHTML = motor('Eixo 1', r.v1, r.t1, f1, r.win1) + motor('Eixo 2', r.v2, r.t2, f2, r.win2); }
  }
  // alertas do dataset real
  function logBancada() {
    const log = el('inicioLog'); if (!log) return;
    const cols = COR();
    const ACAO = ['Nenhuma ação necessária.', 'Recomenda-se verificação na próxima ronda.', 'Intervenção imediata recomendada.'];
    const alertas = EVENTS.filter(e => e.f >= 1);
    log.onclick = null;
    if (!alertas.length) { log.innerHTML = '<div class="fz-log-empty">Nenhum alerta ou alarme recente — motor operando normalmente.</div>'; return; }
    log.innerHTML = alertas.map((e, idx) => {
      const c = cols[e.f], full = new Date(T0 + F.t[e.i] * 1000).toLocaleString('pt-BR');
      return `<div class="fz-log-row" data-idx="${idx}"><div class="l-time">${hm(e.i)}</div><div class="l-dot" style="background:${c}"></div>
        <div class="l-txt"><b style="color:${c}">${e.motor}</b> → ${NOME[e.f]}<span class="l-det">Vel = ${fmt(e.vel, 3)} mm/s</span>
          <div class="l-more"><span class="l-more-row"><b>Horário completo:</b> ${full}</span><span class="l-more-row"><b>Recomendação:</b> ${ACAO[e.f]}</span></div></div>
        <div class="l-chev">›</div></div>`;
    }).join('');
    log.onclick = ev => { const row = ev.target.closest('.fz-log-row'); if (row) row.classList.toggle('expanded'); };
  }

  // ---------------------------------------------------------------- desenha a tela
  function render() {
    if (naFabrica()) { renderFabrica(); logFabrica(); } else { renderBancada(); logBancada(); }
    const ex = el('inicioExport'); if (ex) ex.hidden = naFabrica();
    const rf = el('inicioRefresh'); if (rf) rf.hidden = naFabrica();
  }

  // atualiza a tela a cada ciclo
  function tick() {
    const active = el('screen-inicio').classList.contains('active');
    if (!active || !state.auto) return;
    if (!naFabrica() && state.fonte === 'forzy') state.idx = (state.idx + 5) % N;
    render();
  }
  // liga o timer da tela
  function startTimer() { if (state.timer) clearInterval(state.timer); state.timer = setInterval(tick, state.intervalo); }

  // exporta os dados em CSV
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

  // a topbar le a fonte do Inicio pra alarmar a fabrica tambem quando ela e escolhida aqui
  window.FZInicio = { getFonte: () => (naFabrica() ? 'fabrica' : state.fonte) };

  // liga a tela (roda so na primeira visita)
  function init() {
    if (!el('inicioControls')) return;
    window.FZSeletor.montar(el('inicioSel'));
    SEL.onChange(() => { renderControls(); render(); });
    renderControls();
    render();
    startTimer();
    const rf = el('inicioRefresh'); if (rf) rf.addEventListener('click', () => { state.idx = 0; render(); });
    const ex = el('inicioExport'); if (ex) ex.addEventListener('click', exportCSV);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
