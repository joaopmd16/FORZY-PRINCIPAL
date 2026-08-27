/* ===================================================================
   FORZY · GESTÃO — Navegação · RPA · Pipeline (funcionais, via FZStore)
   =================================================================== */
(function () {
  const S = window.FZStore;
  if (!S) { console.error('gestao.js: FZStore ausente'); return; }

  const STATUS = ['ativo', 'manutencao', 'inativo'];
  const el = id => document.getElementById(id);
  const esc = s => (s == null ? '' : String(s)).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (v, d = 2) => (v == null || v === '' || v !== v) ? '—' : Number(v).toFixed(d);
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function gauss(mu, sd) { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  function checklist(id, codigos, checked) {
    return `<div class="fz-checklist" id="${id}">${codigos.map(c =>
      `<label class="fz-check"><input type="checkbox" value="${esc(c)}" ${checked && checked.includes(c) ? 'checked' : ''}><span>${esc(c)}</span></label>`).join('')}</div>`;
  }
  const checkedVals = id => [...el(id).querySelectorAll('input:checked')].map(i => i.value);

  function resultBox(res) {
    const cor = res.erros === 0 ? cssVar('--fz-ok') : cssVar('--fz-warn');
    return `<div class="fz-card" style="border-left:3px solid ${cor};margin-top:12px">
      <div style="font-weight:700;color:${cor}">${res.ok} processados · ${res.erros} erros</div>
      <details class="fz-details" style="margin-top:10px"><summary>Ver detalhes</summary>
        <div style="margin-top:8px;font-family:var(--font-num);font-size:12px;line-height:1.8">
          ${res.detalhes.map(d => `<div style="color:${d.startsWith('OK') ? cssVar('--fz-ok') : cssVar('--fz-bad')}">${esc(d)}</div>`).join('')}
        </div></details></div>`;
  }

  /* mini-mapa SVG (substitui st.map) */
  function miniMap(points, selCod) {
    const pts = points.filter(p => p.lat && p.lon);
    if (!pts.length) return `<div class="fz-empty">Coordenadas não cadastradas.</div>`;
    let minLa = Infinity, maxLa = -Infinity, minLo = Infinity, maxLo = -Infinity;
    for (const p of pts) { minLa = Math.min(minLa, p.lat); maxLa = Math.max(maxLa, p.lat); minLo = Math.min(minLo, p.lon); maxLo = Math.max(maxLo, p.lon); }
    const pLa = (maxLa - minLa) || 0.002, pLo = (maxLo - minLo) || 0.002;
    minLa -= pLa * 0.35; maxLa += pLa * 0.35; minLo -= pLo * 0.35; maxLo += pLo * 0.35;
    const W = 100, H = 64;
    const X = lo => ((lo - minLo) / (maxLo - minLo)) * W;
    const Y = la => (1 - (la - minLa) / (maxLa - minLa)) * H;
    let grid = '';
    for (let i = 1; i < 6; i++) { const x = i * W / 6; grid += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" class="mm-grid"/>`; }
    for (let i = 1; i < 4; i++) { const y = i * H / 4; grid += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" class="mm-grid"/>`; }
    const pins = pts.map(p => {
      const c = S.statusColor(p.status); const sel = p.codigo === selCod;
      return `<circle cx="${X(p.lon).toFixed(2)}" cy="${Y(p.lat).toFixed(2)}" r="${sel ? 2.4 : 1.6}" fill="${c}" stroke="${sel ? cssVar('--text') : 'none'}" stroke-width="${sel ? 0.5 : 0}"><title>${esc(p.codigo)} (${S.statusLabel(p.status)})</title></circle>`;
    }).join('');
    return `<div class="fz-minimap"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${grid}${pins}</svg></div>`;
  }
  function mapLegend() {
    return `<div class="fz-legend" style="margin-top:8px">
      <span><i style="background:${cssVar('--fz-ok')}"></i>Ativo</span>
      <span><i style="background:${cssVar('--fz-warn')}"></i>Manutenção</span>
      <span><i style="background:${cssVar('--fz-bad')}"></i>Inativo</span></div>`;
  }

  /* =====================================================================
     NAVEGAÇÃO — Drill-down visual: Fábrica → Área → Equipamento → Sensores
     ===================================================================== */
  const nav = { planta: null, area: null, ativo: null, query: '', level: 'plantas' };

  /* ---------- busca NLP ---------- */
  function buscaNLP(query, ativos) {
    const toks = query.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
    if (!toks.length) return [];
    const campos = ['codigo', 'tag', 'descricao', 'fabricante', 'status', 'area_nome', 'planta_nome', 'localizacao_descricao'];
    const res = [];
    for (const a of ativos) {
      const txt = campos.map(c => (a[c] || '')).join(' ').toLowerCase();
      const hits = toks.reduce((n, t) => n + (txt.includes(t) ? 1 : 0), 0);
      if (hits) res.push([hits, a]);
    }
    res.sort((x, y) => y[0] - x[0]);
    return res.map(r => r[1]);
  }

  /* ---------- breadcrumb ---------- */
  function breadcrumb() {
    const plantas = S.getPlantas();
    const pl = plantas.find(p => p.id === nav.planta);
    const ar = pl ? S.getAreas(pl.id).find(a => a.id === nav.area) : null;
    const at = nav.ativo ? S.getAtivoPorCodigo(nav.ativo) : null;

    const crumbs = [{ label: 'Fábricas', level: 'plantas' }];
    if (pl) crumbs.push({ label: esc(pl.nome), level: 'areas' });
    if (ar) crumbs.push({ label: esc(ar.nome), level: 'ativos' });
    if (at) crumbs.push({ label: esc(at.codigo), level: 'detalhe' });

    return `<nav class="fz-breadcrumb">
      ${crumbs.map((c, i) => i < crumbs.length - 1
        ? `<span class="bc-link" data-level="${c.level}">${c.label}</span><span class="bc-sep">›</span>`
        : `<span class="bc-active">${c.label}</span>`
      ).join('')}
    </nav>`;
  }

  /* ---------- mini-sparkline inline ---------- */
  function sparkLine(vals, cor) {
    if (!vals.length) return '';
    const W = 120, H = 36, pad = 3;
    const mn = Math.min(...vals), mx = Math.max(...vals) || 1;
    const X = i => pad + i * (W - pad * 2) / Math.max(vals.length - 1, 1);
    const Y = v => H - pad - ((v - mn) / (mx - mn || 1)) * (H - pad * 2);
    let d = vals.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join(' ');
    return `<svg viewBox="0 0 ${W} ${H}" style="width:${W}px;height:${H}px;vertical-align:middle"><path d="${d}" fill="none" stroke="${cor}" stroke-width="1.8"/></svg>`;
  }

  /* ---------- status badge ---------- */
  function badge(st) {
    const c = S.statusColor(st);
    return `<span class="fz-badge" style="background:${c}22;border:1px solid ${c};color:${c}">${S.statusLabel(st)}</span>`;
  }

  /* ---------- renderiza o container principal do drill ---------- */
  function renderNavDrill() {
    const wrap = el('navDrill'); if (!wrap) return;
    wrap.innerHTML = breadcrumb() + `<div id="navDrillContent"></div>`;
    wrap.querySelectorAll('.bc-link').forEach(b =>
      b.addEventListener('click', () => { nav.level = b.dataset.level; renderNavDrill(); })
    );

    if (nav.level === 'plantas') renderPlantas();
    else if (nav.level === 'areas') renderAreas();
    else if (nav.level === 'ativos') renderAtivos();
    else if (nav.level === 'detalhe') renderDetalheAtivo();
  }

  /* ---------- nível 1: plantas ---------- */
  function renderPlantas() {
    const box = el('navDrillContent'); if (!box) return;
    const plantas = S.getPlantas();
    if (!plantas.length) {
      box.innerHTML = `<div class="fz-empty" style="margin-top:16px">Nenhuma planta cadastrada. Crie uma em <b>Cadastro → Plantas &amp; Áreas</b>.</div>`;
      return;
    }
    box.innerHTML = `<p class="fz-drill-label">Selecione uma planta para explorar</p>
      <div class="fz-drill-grid">
      ${plantas.map(pl => {
        const areas = S.getAreas(pl.id);
        const ativos = areas.flatMap(a => S.getAtivosIndustrial(a.id));
        const alarme = ativos.filter(a => a.status === 'inativo').length;
        const manut  = ativos.filter(a => a.status === 'manutencao').length;
        const borda  = alarme ? 'var(--fz-bad)' : manut ? 'var(--fz-warn)' : 'var(--fz-ok)';
        return `<div class="fz-drill-card" data-pid="${pl.id}" style="border-top:3px solid ${borda}">
                    <div class="dc-title">${esc(pl.nome)}</div>
          <div class="dc-sub">${esc(pl.descricao || '')}</div>
          <div class="dc-stats">
            <span>${areas.length} área${areas.length !== 1 ? 's' : ''}</span>
            <span>${ativos.length} ativo${ativos.length !== 1 ? 's' : ''}</span>
          </div>
          <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
            <span class="fz-badge" style="background:var(--fz-ok)22;border:1px solid var(--fz-ok);color:var(--fz-ok)">${ativos.filter(a=>a.status==='ativo').length} em operação</span>
            ${manut ? `<span class="fz-badge" style="background:var(--fz-warn)22;border:1px solid var(--fz-warn);color:var(--fz-warn)">${manut} manutenção</span>` : ''}
            ${alarme ? `<span class="fz-badge" style="background:var(--fz-bad)22;border:1px solid var(--fz-bad);color:var(--fz-bad)">${alarme} inativo</span>` : ''}
          </div>
          <div class="dc-action">Explorar →</div>
        </div>`;
      }).join('')}
      </div>`;
    box.querySelectorAll('.fz-drill-card').forEach(card =>
      card.addEventListener('click', () => {
        nav.planta = +card.dataset.pid;
        nav.area = null; nav.ativo = null;
        nav.level = 'areas';
        renderNavDrill();
      })
    );
  }

  /* ---------- nível 2: áreas ---------- */
  function renderAreas() {
    const box = el('navDrillContent'); if (!box) return;
    const areas = S.getAreas(nav.planta);
    if (!areas.length) {
      box.innerHTML = `<div class="fz-empty" style="margin-top:16px">Nenhuma área nesta planta.</div>`;
      return;
    }
    box.innerHTML = `<p class="fz-drill-label">Selecione uma seção / área</p>
      <div class="fz-drill-grid">
      ${areas.map(ar => {
        const ativos = S.getAtivosIndustrial(ar.id);
        const alarme = ativos.filter(a => a.status === 'inativo').length;
        const manut  = ativos.filter(a => a.status === 'manutencao').length;
        const borda  = alarme ? 'var(--fz-bad)' : manut ? 'var(--fz-warn)' : 'var(--fz-ok)';
        return `<div class="fz-drill-card" data-aid="${ar.id}" style="border-top:3px solid ${borda}">
                    <div class="dc-title">${esc(ar.nome)}</div>
          <div class="dc-sub">${esc(ar.descricao || '')}</div>
          <div class="dc-stats">
            <span>${ativos.length} equipamento${ativos.length !== 1 ? 's' : ''}</span>
          </div>
          <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
            <span class="fz-badge" style="background:var(--fz-ok)22;border:1px solid var(--fz-ok);color:var(--fz-ok)">${ativos.filter(a=>a.status==='ativo').length} em operação</span>
            ${manut ? `<span class="fz-badge" style="background:var(--fz-warn)22;border:1px solid var(--fz-warn);color:var(--fz-warn)">${manut} manutenção</span>` : ''}
            ${alarme ? `<span class="fz-badge" style="background:var(--fz-bad)22;border:1px solid var(--fz-bad);color:var(--fz-bad)">${alarme} inativo</span>` : ''}
          </div>
          <div class="dc-action">Ver equipamentos →</div>
        </div>`;
      }).join('')}
      </div>`;
    box.querySelectorAll('.fz-drill-card').forEach(card =>
      card.addEventListener('click', () => {
        nav.area = +card.dataset.aid;
        nav.ativo = null;
        nav.level = 'ativos';
        renderNavDrill();
      })
    );
  }

  /* ---------- nível 3: ativos/equipamentos ---------- */
  function renderAtivos() {
    const box = el('navDrillContent'); if (!box) return;
    const ativos = S.getAtivosIndustrial(nav.area);
    if (!ativos.length) {
      box.innerHTML = `<div class="fz-empty" style="margin-top:16px">Nenhum ativo cadastrado nesta área.</div>`;
      return;
    }
    box.innerHTML = `<p class="fz-drill-label">Selecione um equipamento para ver os sensores</p>
      <div class="fz-drill-grid">
      ${ativos.map(a => {
        const sc = S.statusColor(a.status);
        const leituras = S.getLeituras(a.codigo, 20);
        const vib = leituras.map(l => +l.vibracao_mm_s || 0).reverse();
        const lastVib = vib.length ? vib[vib.length - 1] : null;
        const flag = lastVib == null ? 0 : lastVib >= 4.5 ? 2 : lastVib >= 1.8 ? 1 : 0;
        const vibCor = ['var(--fz-ok)', 'var(--fz-warn)', 'var(--fz-bad)'][flag];
        return `<div class="fz-drill-card" data-cod="${esc(a.codigo)}" style="border-top:3px solid ${sc}">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div class="dc-title">${esc(a.codigo)}</div>
            ${badge(a.status)}
          </div>
          <div class="dc-sub">${esc(a.descricao || '')}</div>
          <div class="dc-sub" style="margin-top:2px;color:var(--text-3)">
            ${esc(a.fabricante || '—')} · ${a.potencia_kw != null ? a.potencia_kw + ' kW' : '—'} · ${a.tensao_v != null ? a.tensao_v + ' V' : '—'}
          </div>
          ${vib.length ? `<div style="margin-top:10px;display:flex;align-items:center;gap:8px">
            <span style="font-size:11px;color:var(--text-2)">Vibração:</span>
            ${sparkLine(vib, vibCor)}
            <span style="font-size:12px;font-weight:700;color:${vibCor}">${lastVib != null ? lastVib.toFixed(2)+' mm/s' : ''}</span>
          </div>` : `<div style="margin-top:10px;font-size:11px;color:var(--text-3)">Sem leituras IoT</div>`}
          <div class="dc-action">Ver sensores →</div>
        </div>`;
      }).join('')}
      </div>`;
    box.querySelectorAll('.fz-drill-card').forEach(card =>
      card.addEventListener('click', () => {
        nav.ativo = card.dataset.cod;
        nav.level = 'detalhe';
        renderNavDrill();
      })
    );
  }

  /* ---------- nível 4: detalhe com sensores ---------- */
  function renderDetalheAtivo() {
    const box = el('navDrillContent'); if (!box) return;
    if (!nav.ativo) { box.innerHTML = `<div class="fz-empty">Ativo não encontrado.</div>`; return; }

    const a = S.getAtivoPorCodigo(nav.ativo);
    const sc = S.statusColor(a.status);
    const leituras = S.getLeituras(a.codigo, 200);
    const areaAtivos = S.getAtivosIndustrial(a.area_id).map(x => ({ lat: x.latitude, lon: x.longitude, status: x.status, codigo: x.codigo }));
    const specCell = (l, v) => `<div class="nv-cell"><div class="c-lbl">${l}</div><div class="c-val">${esc(String(v ?? '—'))}</div></div>`;

    /* gauge z-score via dataset Forzy */
    const F = window.FORZY;
    let scoreHtml = '';
    if (F) {
      const COLS = ['m1_vel','m1_acel','m1_temp','m2_vel','m2_acel','m2_temp'];
      const i = F.meta.n - 1;
      const r = {}; COLS.forEach(c => { r[c] = F[c.slice(0,2)][c.slice(3)][i]; });
      const zs = COLS.map(c => { const b = F.baseline[c]; return b && b.std ? Math.abs(r[c]-b.mean)/b.std : 0; });
      const score = Math.max(...zs);
      const cor = score < 2 ? cssVar('--fz-ok') : score < 3 ? cssVar('--fz-warn') : cssVar('--fz-bad');
      const classe = score < 2 ? 'Normal' : score < 3 ? 'Alerta' : 'Anomalia';
      scoreHtml = `<div class="fz-card" style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
        <div>
          <div class="fz-card-title" style="margin-bottom:4px">Score Baseline ML</div>
          <div class="fz-card-sub">Z-score multivariado</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:32px;font-weight:700;color:${cor};font-family:var(--font-num)">${score.toFixed(2)}</div>
          <span class="fz-badge" style="background:${cor}22;border:1px solid ${cor};color:${cor}">${classe.toUpperCase()}</span>
        </div>
      </div>`;
    }

    /* vibração chart */
    let vibHtml = '';
    if (leituras.length) {
      const rec = leituras.slice(0, 120).reverse();
      const vals = rec.map(l => +l.vibracao_mm_s || 0);
      const mx = Math.max(6, ...vals);
      const W = 680, H = 180, padL = 36, padR = 10, padT = 10, padB = 20;
      const X = i => padL + (vals.length < 2 ? 0 : i * (W-padL-padR)/(vals.length-1));
      const Y = v => padT + (1 - v/mx)*(H-padT-padB);
      const band = (y0, y1, c) => `<rect x="${padL}" y="${Y(y1).toFixed(1)}" width="${W-padL-padR}" height="${(Y(y0)-Y(y1)).toFixed(1)}" fill="${c}" opacity="0.07"/>`;
      let d = ''; vals.forEach((v, i) => { d += (i?'L':'M')+X(i).toFixed(1)+','+Y(v).toFixed(1); });
      const lastV = vals[vals.length-1];
      const vibCor = lastV >= 4.5 ? cssVar('--fz-bad') : lastV >= 1.8 ? cssVar('--fz-warn') : cssVar('--fz-ok');
      vibHtml = `<div class="fz-card" style="margin-top:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div class="fz-card-title">Vibração RMS — IoT ao vivo</div>
          <span style="font-size:22px;font-weight:700;color:${vibCor};font-family:var(--font-num)">${lastV.toFixed(3)} mm/s</span>
        </div>
        <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">
          ${band(0,1.8,cssVar('--fz-ok'))}${band(1.8,4.5,cssVar('--fz-warn'))}${band(4.5,mx,cssVar('--fz-bad'))}
          <line x1="${padL}" x2="${W-padR}" y1="${Y(1.8).toFixed(1)}" y2="${Y(1.8).toFixed(1)}" stroke="${cssVar('--fz-warn')}" stroke-width="1" stroke-dasharray="3 3"/>
          <line x1="${padL}" x2="${W-padR}" y1="${Y(4.5).toFixed(1)}" y2="${Y(4.5).toFixed(1)}" stroke="${cssVar('--fz-bad')}" stroke-width="1" stroke-dasharray="3 3"/>
          <path d="${d}" fill="none" stroke="${cssVar('--teal')}" stroke-width="2"/>
        </svg>
        <div style="font-size:11px;color:var(--text-2);margin-top:6px">${leituras.length} leituras · última: ${new Date(leituras[0].coletado_em).toLocaleString('pt-BR')}</div>
      </div>`;
    }

    box.innerHTML = `
      <div class="fz-card" style="border-left:4px solid ${sc};margin-top:14px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:16px">
          <div>
            <div class="da-cod">${esc(a.codigo)}</div>
            <div class="da-desc">${esc(a.descricao)}</div>
            <div class="da-loc" style="margin-top:4px">${esc(a.area_nome) || '—'} · ${esc(a.planta_nome) || '—'}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            ${badge(a.status)}
            <button class="fz-btn" onclick="window.FZCadastro?.switchTab('dash'); window.FZCadastro && (window.FZCadastro._selDash='${esc(a.codigo)}'); window.FZApp?.showScreen('cadastro')">
              Ver Dashboard Completo →
            </button>
          </div>
        </div>
        <div class="nv-grid">
          ${specCell('TAG', a.tag)}
          ${specCell('Fabricante', a.fabricante)}
          ${specCell('Potência', a.potencia_kw != null ? a.potencia_kw+' kW' : null)}
          ${specCell('Tensão', a.tensao_v != null ? a.tensao_v+' V' : null)}
          ${specCell('Corrente Nom', a.corrente_nom != null ? a.corrente_nom+' A' : null)}
          ${specCell('Proteção IP', a.ip_rating)}
          ${specCell('Localização', a.localizacao_descricao)}
          ${specCell('Instalação', a.data_install ? new Date(a.data_install).toLocaleDateString('pt-BR') : null)}
        </div>
      </div>

      <div class="fz-row2" style="margin-top:14px">
        ${scoreHtml}
        <div class="fz-card">
          <div class="fz-card-title">Localização no Mapa</div>
          ${miniMap(areaAtivos, a.codigo)}${mapLegend()}
        </div>
      </div>

      ${vibHtml}

      ${leituras.length ? `
      <div class="fz-card" style="margin-top:14px">
        <div class="fz-card-title">Últimas Leituras — Sensores</div>
        <div style="overflow:auto"><table class="fz-table"><thead><tr>
          <th>Data/Hora</th><th>Vibração mm/s</th><th>Temp °C</th><th>Corrente A</th><th>Status ISO</th>
        </tr></thead><tbody>
        ${leituras.slice(0,10).map(l => {
          const v = +l.vibracao_mm_s || 0;
          const fl = v>=4.5?2:v>=1.8?1:0;
          const cor = ['var(--fz-ok)','var(--fz-warn)','var(--fz-bad)'][fl];
          const nome = ['Normal','Alerta','Alarme'][fl];
          return `<tr>
            <td>${new Date(l.coletado_em).toLocaleString('pt-BR')}</td>
            <td style="font-weight:700;color:${cor}">${fmt(l.vibracao_mm_s,3)}</td>
            <td>${fmt(l.temperatura_c,1)}</td>
            <td>${fmt(l.corrente_a,2)}</td>
            <td><span style="color:${cor};font-weight:700">${nome}</span></td>
          </tr>`;
        }).join('')}
        </tbody></table></div>
      </div>` : `<div class="fz-card" style="margin-top:14px">
        <div class="fz-card-title">Sensores</div>
        <div class="fz-empty">Sem leituras IoT vinculadas a este ativo. Conecte o ESP32 na aba IoT gravando neste ativo, ou execute uma Coleta de Leituras no RPA.</div>
      </div>`}`;
  }

  function renderNavBusca() {
    const c = el('navBusca'); if (!c) return;
    c.innerHTML = `
      <div class="fz-controls">
        <input class="fz-input" id="navQ" style="flex:1;min-width:200px" placeholder="Buscar ativo: bomba, WEG, BBA-001, manutenção..." value="${esc(nav.query)}">
        <button class="fz-btn ghost" id="navLimpar">Limpar</button>
      </div>
      <div id="navResultados"></div>`;
    el('navQ').addEventListener('input', e => { nav.query = e.target.value; drawNavResultados(); });
    el('navLimpar').addEventListener('click', () => { nav.query = ''; el('navQ').value = ''; drawNavResultados(); });
    if (nav.query) drawNavResultados();
  }
  function drawNavResultados() {
    const box = el('navResultados'); if (!box) return;
    if (!nav.query.trim()) { box.innerHTML = ''; return; }
    const r = buscaNLP(nav.query.trim(), S.getAtivosIndustrial());
    if (!r.length) { box.innerHTML = `<div class="fz-empty">Nenhum ativo encontrado.</div>`; return; }
    box.innerHTML = `<p class="fz-section-label" style="margin-top:12px">${r.length} ativo(s)</p>
      <div class="fz-row3">${r.slice(0, 9).map(a => {
        const c = S.statusColor(a.status);
        return `<div class="fz-card fz-drill-card" data-cod="${esc(a.codigo)}" style="border-top:3px solid ${c};cursor:pointer">
          <div style="font-weight:700;color:var(--teal)">${esc(a.codigo)}</div>
          <div style="font-size:12px;color:var(--text-2);margin:2px 0 4px">TAG: ${esc(a.tag) || '—'}</div>
          <div style="font-size:13px">${esc(a.descricao) || '—'}</div>
          <div style="font-size:11px;color:var(--text-3);margin-top:4px">${esc(a.area_nome) || '—'} · ${esc(a.planta_nome) || '—'}</div>
          <div style="margin-top:8px">${badge(a.status)}</div>
          <div class="dc-action">Ver sensores →</div>
        </div>`;
      }).join('')}</div>`;
    box.querySelectorAll('.fz-drill-card').forEach(card =>
      card.addEventListener('click', () => {
        const at = S.getAtivoPorCodigo(card.dataset.cod);
        if (!at) return;
        nav.planta = at.planta_id; nav.area = at.area_id;
        nav.ativo = at.codigo; nav.level = 'detalhe';
        renderNavDrill();
      })
    );
  }

  function initNav() {
    if (!el('navBusca')) return;
    renderNavBusca();
    renderNavDrill();
  }

  /* =====================================================================
     RPA
     ===================================================================== */
  function rpaSwitch(name) {
    document.querySelectorAll('#rpaTabs .fz-tab').forEach(b => b.classList.toggle('active', b.dataset.rtab === name));
    document.querySelectorAll('#screen-rpa .fz-cpanel').forEach(p => p.classList.toggle('active', p.dataset.rpanel === name));
    if (name === 'assoc') rpaAssoc();
    if (name === 'status') rpaStatus();
    if (name === 'coleta') rpaColeta();
    if (name === 'logs') rpaLogs();
  }

  function rpaAssoc(msg) {
    const p = el('rpaAssoc'); if (!p) return;
    const cods = S.getAtivosIndustrial().map(a => a.codigo);
    const areas = S.getAreas();
    p.innerHTML = `<div class="fz-card">
      ${msg || ''}
      <div class="fz-card-sub">Vincule TAG e Área para vários ativos de uma vez.</div>
      <p class="fz-section-label">Ativos a associar</p>${checklist('asCk', cods)}
      <div class="fz-form" style="margin-top:12px">
        <div class="fld"><label>Nova TAG (aplica a todos)</label><input class="fz-input" id="asTag" placeholder="TAG-XX"></div>
        <div class="fld"><label>Nova Área</label><select class="fz-select" id="asArea">${areas.map(a => `<option value="${a.id}">${esc(a.nome)}</option>`).join('')}</select></div>
      </div>
      <button class="fz-btn" id="asBtn" style="margin-top:12px">Executar Associação</button>
      <div id="asRes"></div></div>`;
    el('asBtn').addEventListener('click', () => {
      const sel = checkedVals('asCk');
      if (!sel.length) return rpaAssoc(`<div class="fz-feedback bad">Selecione ao menos um ativo.</div>`);
      const tag = el('asTag').value.trim(); const area_id = +el('asArea').value;
      const det = []; let ok = 0, er = 0;
      for (const c of sel) {
        const a = S.getAtivoPorCodigo(c);
        if (!a) { er++; det.push(`ERRO — ${c}: não encontrado`); continue; }
        S.editarAtivoIndustrial(c, { tag: tag || a.tag, area_id });
        ok++; det.push(`OK — ${c}: TAG=${tag || a.tag} | Área ID=${area_id}`);
      }
      S.logExecucao('Associação de TAGs', er === 0 ? 'sucesso' : 'parcial', ok, er, det.join('\n'));
      el('asRes').innerHTML = resultBox({ ok, erros: er, detalhes: det });
    });
  }

  function rpaStatus() {
    const p = el('rpaStatus'); if (!p) return;
    const ativos = S.getAtivosIndustrial();
    const cods = ativos.map(a => a.codigo);
    p.innerHTML = `<div class="fz-card">
      <div class="fz-card-sub">Muda o status operacional de vários ativos de uma vez.</div>
      <p class="fz-section-label">Ativos</p>${checklist('stCk', cods)}
      <p class="fz-section-label" style="margin-top:12px">Novo status</p>
      <div class="fz-seg" id="stSeg">${STATUS.map((s, i) => `<button class="${i === 0 ? 'active' : ''}" data-v="${s}">${S.statusLabel(s)}</button>`).join('')}</div>
      <div id="stPrev" style="margin-top:12px"></div>
      <button class="fz-btn" id="stBtn" style="margin-top:12px">Aplicar</button>
      <div id="stRes"></div></div>`;
    let novo = STATUS[0];
    const prev = () => {
      const sel = checkedVals('stCk');
      el('stPrev').innerHTML = sel.map(c => {
        const a = ativos.find(x => x.codigo === c);
        const ca = S.statusColor(a.status), cn = S.statusColor(novo);
        return `<div style="font-size:13px;margin:3px 0"><b>${esc(c)}</b> <span style="color:${ca};font-weight:700">${S.statusLabel(a.status)}</span> → <span style="color:${cn};font-weight:700">${S.statusLabel(novo)}</span></div>`;
      }).join('');
    };
    p.querySelectorAll('#stSeg button').forEach(b => b.addEventListener('click', () => { novo = b.dataset.v; p.querySelectorAll('#stSeg button').forEach(x => x.classList.toggle('active', x === b)); prev(); }));
    p.querySelectorAll('#stCk input').forEach(i => i.addEventListener('change', prev));
    el('stBtn').addEventListener('click', () => {
      const sel = checkedVals('stCk'); if (!sel.length) return;
      const det = []; let ok = 0, er = 0;
      for (const c of sel) { const a = S.getAtivoPorCodigo(c); S.editarAtivoIndustrial(c, { status: novo }); ok++; det.push(`OK — ${c}: ${S.statusLabel(a.status)} → ${S.statusLabel(novo)}`); }
      S.logExecucao('Atualização de Status', 'sucesso', ok, er, det.join('\n'));
      rpaStatus(); el('stRes') && (el('stRes').innerHTML = resultBox({ ok, erros: er, detalhes: det }));
    });
  }

  function gerarLeitura(a) {
    const anom = Math.random() < 0.05;
    const vel = anom ? 5 + Math.random() * 4 : Math.max(0, gauss(1.2, 0.4));
    return { fonte: 'rpa_simulado', temperatura_c: anom ? 85 + Math.random() * 15 : gauss(55, 5), vibracao_mm_s: vel,
      corrente_a: gauss(a.corrente_nom || 80, 5), tensao_v: gauss(a.tensao_v || 380, 3), rpm: gauss(1780, 20),
      fator_potencia: gauss(0.88, 0.02), coletado_em: new Date().toISOString(), flag_anomalia: anom ? 1 : 0,
      ax_rms: gauss(0.02, 0.005), ay_rms: gauss(0.98, 0.01), az_rms: gauss(0.15, 0.01), _vel: vel, _anom: anom };
  }

  function rpaColeta() {
    const p = el('rpaColeta'); if (!p) return;
    const cods = S.getAtivosIndustrial().map(a => a.codigo);
    p.innerHTML = `<div class="fz-card">
      <div class="fz-card-sub">Simula coleta de sensores e grava leituras no banco.</div>
      <p class="fz-section-label">Ativos para coletar</p>${checklist('coCk', cods, cods)}
      <div class="fz-form" style="margin-top:12px"><div class="fld"><label>Rodadas de coleta</label><input class="fz-input" id="coRod" type="number" min="1" max="20" value="1"></div></div>
      <button class="fz-btn" id="coBtn" style="margin-top:12px">Executar Coleta</button>
      <div class="fz-progress" id="coProg" hidden style="margin-top:12px"><span class="p-lbl"></span><div class="track"><div class="fill" style="width:0%"></div></div></div>
      <div id="coRes"></div></div>`;
    el('coBtn').addEventListener('click', async () => {
      const sel = checkedVals('coCk'); if (!sel.length) return;
      const rod = Math.max(1, Math.min(20, +el('coRod').value || 1));
      const prog = el('coProg'); prog.hidden = false;
      const tot = { ok: 0, erros: 0, detalhes: [] };
      for (let i = 0; i < rod; i++) {
        for (const c of sel) { const a = S.getAtivoPorCodigo(c); const d = gerarLeitura(a); S.insertLeitura(c, d); tot.ok++; tot.detalhes.push(`OK — ${c}: vel=${d._vel.toFixed(2)} mm/s${d._anom ? ' [ANOMALIA]' : ''}`); }
        prog.querySelector('.fill').style.width = ((i + 1) / rod * 100) + '%';
        prog.querySelector('.p-lbl').textContent = `Rodada ${i + 1}/${rod}...`;
        await sleep(180);
      }
      S.logExecucao('Coleta de Leituras', 'sucesso', tot.ok, 0, `${rod} rodadas · ${sel.length} ativos`);
      prog.hidden = true; el('coRes').innerHTML = resultBox(tot);
    });
  }

  function rpaLogs() {
    const p = el('rpaLogs'); if (!p) return;
    const logs = S.getLogs(200), hist = S.getHistorico(200);
    p.innerHTML = `<div class="fz-card">
      <div class="fz-subtabs" id="lgSub"><button class="fz-subtab active" data-v="log">Log de Execuções</button><button class="fz-subtab" data-v="hist">Histórico de Mudanças</button></div>
      <div class="fz-subpanel active" data-sp="log">${logs.length ? `<div style="overflow:auto"><table class="fz-table"><thead><tr><th>Data/Hora</th><th>Automação</th><th>Status</th><th>Proc</th><th>Erros</th></tr></thead><tbody>
        ${logs.map(l => { const c = S.statusColor(l.status === 'sucesso' ? 'ativo' : l.status === 'parcial' ? 'manutencao' : 'inativo'); return `<tr><td>${new Date(l.iniciado_em).toLocaleString('pt-BR')}</td><td style="font-family:var(--font)">${esc(l.automacao)}</td><td style="color:${c};font-weight:700;font-family:var(--font)">${esc(l.status)}</td><td>${l.registros_proc}</td><td>${l.registros_erro}</td></tr>`; }).join('')}
        </tbody></table></div>` : `<div class="fz-empty">Nenhuma execução registrada ainda.</div>`}</div>
      <div class="fz-subpanel" data-sp="hist">${hist.length ? `<div style="overflow:auto"><table class="fz-table"><thead><tr><th>Data/Hora</th><th>Tabela</th><th>Operação</th></tr></thead><tbody>
        ${hist.map(h => `<tr><td>${new Date(h.ts).toLocaleString('pt-BR')}</td><td style="font-family:var(--font)">${esc(h.tabela)}</td><td style="font-family:var(--font)">${esc(h.operacao)}</td></tr>`).join('')}
        </tbody></table></div>` : `<div class="fz-empty">Nenhuma mudança registrada ainda.</div>`}</div>
    </div>`;
    p.querySelectorAll('#lgSub .fz-subtab').forEach(b => b.addEventListener('click', () => {
      p.querySelectorAll('#lgSub .fz-subtab').forEach(x => x.classList.toggle('active', x === b));
      p.querySelectorAll('.fz-subpanel').forEach(sp => sp.classList.toggle('active', sp.dataset.sp === b.dataset.v));
    }));
  }

  function initRpa() {
    const t = el('rpaTabs'); if (!t) return;
    t.querySelectorAll('.fz-tab').forEach(b => b.addEventListener('click', () => rpaSwitch(b.dataset.rtab)));
    rpaAssoc();
  }

  /* =====================================================================
     PIPELINE
     ===================================================================== */
  function pipeSwitch(name) {
    document.querySelectorAll('#pipeTabs .fz-tab').forEach(b => b.classList.toggle('active', b.dataset.ptab === name));
    document.querySelectorAll('#screen-pipeline .fz-cpanel').forEach(p => p.classList.toggle('active', p.dataset.ppanel === name));
    if (name === 'exec') pipeExec();
    if (name === 'mapa') pipeMapa();
    if (name === 'ocr') pipeOcr();
  }

  function pipeExec() {
    const p = el('pipeExec'); if (!p) return;
    const cods = S.getAtivosIndustrial().map(a => a.codigo);
    p.innerHTML = `<div class="fz-card">
      <div class="fz-card-sub">Roda o pipeline completo: valida ativos → coleta leituras → registra log.</div>
      <p class="fz-section-label">Ativos no pipeline</p>${checklist('peCk', cods, cods)}
      <div class="fz-form" style="margin-top:12px"><div class="fld"><label>Rodadas de coleta</label><input class="fz-input" id="peRod" type="number" min="1" max="10" value="3"></div></div>
      <button class="fz-btn" id="peBtn" style="margin-top:12px">Executar Pipeline Completo</button>
      <div class="fz-progress" id="peProg" hidden style="margin-top:12px"><span class="p-lbl"></span><div class="track"><div class="fill" style="width:0%"></div></div></div>
      <div id="peRes"></div></div>`;
    el('peBtn').addEventListener('click', async () => {
      const sel = checkedVals('peCk'); if (!sel.length) return;
      const rod = Math.max(1, Math.min(10, +el('peRod').value || 3));
      const prog = el('peProg'); prog.hidden = false;
      const setp = (pct, txt) => { prog.querySelector('.fill').style.width = pct + '%'; prog.querySelector('.p-lbl').textContent = txt; };
      setp(10, 'Validando ativos...'); await sleep(400);
      const invalidos = sel.filter(c => !S.getAtivoPorCodigo(c));
      setp(20, 'Coletando leituras...');
      let ok = 0, er = 0;
      for (let i = 0; i < rod; i++) {
        for (const c of sel) { const a = S.getAtivoPorCodigo(c); if (!a) { er++; continue; } S.insertLeitura(c, gerarLeitura(a)); ok++; }
        setp(20 + 65 * (i + 1) / rod, `Coletando leituras... ${i + 1}/${rod}`); await sleep(200);
      }
      setp(95, 'Registrando resultados...');
      S.logExecucao('Pipeline Completo', er === 0 ? 'sucesso' : 'parcial', ok, er, `${rod} rodadas · ${sel.length} ativos · ${invalidos.length} inválidos`);
      await sleep(300); setp(100, 'Concluído'); await sleep(200); prog.hidden = true;
      const cor = er === 0 ? cssVar('--fz-ok') : cssVar('--fz-warn');
      el('peRes').innerHTML = `<div class="fz-card" style="border-left:3px solid ${cor};margin-top:12px">
        <div style="font-weight:700;color:${cor}">Pipeline concluído</div>
        <div class="fz-kpibar" style="grid-template-columns:repeat(4,1fr);margin-top:10px">
          ${kpiCell('Ativos', sel.length, cssVar('--text'))}${kpiCell('Rodadas', rod, cssVar('--text'))}
          ${kpiCell('Leituras OK', ok, cssVar('--fz-ok'))}${kpiCell('Erros', er, cssVar('--fz-bad'))}
        </div></div>`;
    });
  }
  const kpiCell = (l, v, c) => `<div class="fz-kpi-cell"><div class="k-lbl">${l}</div><div class="k-val" style="color:${c}">${v}</div></div>`;

  function pipeMapa() {
    const p = el('pipeMapa'); if (!p) return;
    const areas = S.getAreas();
    p.innerHTML = `<div class="fz-card">
      <div class="fz-card-sub">Todos os ativos cadastrados, coloridos por status operacional.</div>
      <div class="fz-controls" style="margin:6px 0 12px">
        <div class="fz-field"><span>Status</span><div class="fz-checklist inline" id="pmSt">${STATUS.map(s => `<label class="fz-check"><input type="checkbox" value="${s}" checked><span>${S.statusLabel(s)}</span></label>`).join('')}</div></div>
        <div class="fz-field"><span>Área</span><select class="fz-select" id="pmArea"><option value="">Todas</option>${areas.map(a => `<option value="${a.id}">${esc(a.nome)}</option>`).join('')}</select></div>
      </div>
      <div id="pmMap"></div></div>`;
    const draw = () => {
      const sts = [...el('pmSt').querySelectorAll('input:checked')].map(i => i.value);
      const aid = el('pmArea').value ? +el('pmArea').value : null;
      let ats = S.getAtivosIndustrial().filter(a => sts.includes(a.status) && a.latitude && a.longitude);
      if (aid) ats = ats.filter(a => a.area_id === aid);
      el('pmMap').innerHTML = ats.length ? miniMap(ats.map(a => ({ lat: a.latitude, lon: a.longitude, status: a.status, codigo: a.codigo }))) + mapLegend()
        : `<div class="fz-empty">Nenhum ativo com coordenadas para os filtros.</div>`;
    };
    el('pmSt').querySelectorAll('input').forEach(i => i.addEventListener('change', draw));
    el('pmArea').addEventListener('change', draw);
    draw();
  }

  const OCR = { campos: null, imagemUpload: null };

  // rasteriza a plaqueta SVG de demonstração em PNG (base64) pra poder mandar como imagem pra IA de visão
  function svgToPngDataUrl(svgMarkup, w = 520, h = 300) {
    return new Promise((resolve, reject) => {
      const blob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Falha ao renderizar imagem da plaqueta')); };
      img.src = url;
    });
  }

  function pipeOcr() {
    const p = el('pipeOcr'); if (!p) return;
    const cods = S.getAtivosIndustrial().map(a => a.codigo);
    p.innerHTML = `<div class="fz-row2">
      <div class="fz-card">
        <p class="fz-section-label">Imagem da Plaqueta</p>
        <div id="ocrImgHost">${nameplateSVG()}</div>
        <input type="file" id="ocrImgInput" accept="image/*" style="display:none">
        <div style="display:flex;gap:8px;margin-top:12px">
          <button class="fz-btn fz-btn-ghost" id="ocrUploadBtn" style="flex:1">Enviar foto real</button>
          <button class="fz-btn fz-btn-ghost" id="ocrDemoBtn" style="flex:1" hidden>Usar imagem demo</button>
        </div>
        <button class="fz-btn" id="ocrBtn" style="margin-top:8px;width:100%">Processar OCR com IA</button>
      </div>
      <div class="fz-card">
        <p class="fz-section-label">Resultado da Extração</p>
        <div id="ocrRes"><div class="fz-empty">Clique em "Processar OCR com IA" para extrair os campos.</div></div>
      </div></div>`;

    const imgHost = el('ocrImgHost');
    const demoBtn = el('ocrDemoBtn');

    el('ocrUploadBtn').addEventListener('click', () => el('ocrImgInput').click());
    el('ocrImgInput').addEventListener('change', e => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        OCR.imagemUpload = ev.target.result;
        imgHost.innerHTML = `<img src="${ev.target.result}" style="width:100%;border-radius:8px;display:block">`;
        demoBtn.hidden = false;
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    });
    demoBtn.addEventListener('click', () => {
      OCR.imagemUpload = null;
      imgHost.innerHTML = nameplateSVG();
      demoBtn.hidden = true;
    });

    el('ocrBtn').addEventListener('click', async () => {
      el('ocrRes').innerHTML = `<div class="fz-empty">Processando OCR com IA (gpt-4o-mini visão)...</div>`;
      const key = window.FORZY_OPENAI_KEY;
      if (!key) { el('ocrRes').innerHTML = `<div class="fz-feedback bad">Chave de API não configurada em config.js</div>`; return; }

      try {
        const dataUrl = OCR.imagemUpload || await svgToPngDataUrl(nameplateSVG());
        const prompt = `Você é um sistema de OCR industrial. Extraia os dados da placa de identificação (nameplate) do motor elétrico na imagem.
Responda APENAS com um JSON válido, sem markdown e sem texto adicional, exatamente neste formato:
{"fabricante":string,"potencia_kw":number,"tensao_v":number,"corrente_nom":number,"ip_rating":string,"rpm":number,"confianca":number}
Se um campo não estiver legível ou não existir na imagem, use null nesse campo e reduza "confianca" (0 a 1) de acordo.`;

        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [{ role: 'user', content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: dataUrl } }
            ] }],
            max_tokens: 400,
            temperature: 0,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);

        let raw = (data.choices?.[0]?.message?.content || '').trim();
        raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```$/, '').trim();
        const campos = JSON.parse(raw);
        OCR.campos = campos;

        const confianca = Number(campos.confianca) || 0;
        const avisos = [];
        if (campos.tensao_v != null && ![220, 380, 440, 690].includes(campos.tensao_v)) avisos.push(`Tensão ${campos.tensao_v} V fora dos valores típicos`);
        if (confianca < 0.80) avisos.push('Confiança OCR baixa — confirme manualmente');
        const cc = confianca >= 0.90 ? cssVar('--fz-ok') : confianca >= 0.80 ? cssVar('--fz-warn') : cssVar('--fz-bad');

        el('ocrRes').innerHTML = `
          <div class="fz-card" style="background:var(--field)">
            <div style="display:flex;justify-content:space-between;margin-bottom:10px"><b>Campos Extraídos</b><span style="color:${cc};font-weight:700">Confiança: ${(confianca * 100).toFixed(0)}%</span></div>
            <div class="ocr-grid">
              ${ocrField('Fabricante', campos.fabricante)}${ocrField('Potência', campos.potencia_kw != null ? campos.potencia_kw + ' kW' : null)}
              ${ocrField('Tensão', campos.tensao_v != null ? campos.tensao_v + ' V' : null)}${ocrField('Corrente', campos.corrente_nom != null ? campos.corrente_nom + ' A' : null)}
              ${ocrField('Proteção', campos.ip_rating)}${ocrField('RPM', campos.rpm)}
            </div>
          </div>
          ${avisos.map(a => `<div class="fz-feedback bad" style="margin-top:8px">${esc(a)}</div>`).join('')}
          <p class="fz-section-label" style="margin-top:10px">Aplicar a ativo</p>
          <div class="fz-form"><div class="fld col2"><select class="fz-select" id="ocrAlvo">${cods.map(c => `<option>${esc(c)}</option>`).join('')}</select></div></div>
          <button class="fz-btn fz-btn-save" id="ocrApply" style="margin-top:10px">Aplicar dados ao ativo</button>
          <div id="ocrApplyRes"></div>`;
        el('ocrApply').addEventListener('click', () => {
          const alvo = el('ocrAlvo').value;
          S.editarAtivoIndustrial(alvo, { fabricante: campos.fabricante, potencia_kw: campos.potencia_kw, tensao_v: campos.tensao_v, corrente_nom: campos.corrente_nom, ip_rating: campos.ip_rating });
          S.logExecucao('OCR Pipeline', 'sucesso', 1, 0, `Dados da plaqueta aplicados ao ativo ${alvo}`);
          el('ocrApplyRes').innerHTML = `<div class="fz-feedback ok" style="margin-top:10px">Dados aplicados ao ativo ${esc(alvo)}.</div>`;
        });
      } catch (e) {
        el('ocrRes').innerHTML = `<div class="fz-feedback bad">Erro no OCR: ${esc(e.message)}</div>`;
      }
    });
  }
  const ocrField = (l, v) => `<div><span style="color:var(--text-2)">${l}:</span> <span style="color:var(--text);font-weight:600">${v == null ? '—' : esc(v)}</span></div>`;
  function nameplateSVG() {
    return `<svg xmlns="http://www.w3.org/2000/svg" class="fz-nameplate" viewBox="0 0 520 300" preserveAspectRatio="xMidYMid meet">
      <rect x="0" y="0" width="520" height="300" rx="8" fill="#1e2d46"/>
      <rect x="4" y="4" width="512" height="292" rx="6" fill="none" stroke="#50a0dc" stroke-width="2"/>
      <rect x="10" y="10" width="500" height="40" fill="#14233" opacity="0.6"/>
      <rect x="10" y="10" width="500" height="40" fill="#142337"/>
      <text x="260" y="35" text-anchor="middle" fill="#b4dcff" font-family="monospace" font-size="18" font-weight="700">MOTOR ELÉTRICO TRIFÁSICO</text>
      <g fill="#c8e6ff" font-family="monospace" font-size="17">
        <text x="30" y="92">Fabricante : WEG</text>
        <text x="30" y="128">Potência   : 75 kW</text>
        <text x="30" y="164">Tensão     : 380 V    Corrente: 140 A</text>
        <text x="30" y="200">Rot        : 1780 rpm   cos phi: 0.88</text>
        <text x="30" y="236">Prot       : IP55     Cl.Iso: F</text>
      </g>
      <text x="260" y="284" text-anchor="middle" fill="#5082b4" font-family="monospace" font-size="13">SN: FZY-2024-00001</text>
    </svg>`;
  }

  function initPipe() {
    const t = el('pipeTabs'); if (!t) return;
    t.querySelectorAll('.fz-tab').forEach(b => b.addEventListener('click', () => pipeSwitch(b.dataset.ptab)));
    pipeExec();
  }

  /* ----------  init  ---------- */
  function init() { initNav(); initRpa(); initPipe(); if (window.lucide) lucide.createIcons(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
