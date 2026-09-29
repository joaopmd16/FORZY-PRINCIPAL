/* scada.js: tela SCADA com planta 2D e modelo 3D da bomba */

(function () {
  const F = window.FORZY;
  if (!F) { console.error('scada.js: FORZY ausente'); return; }

  // le o valor de uma variavel CSS (cor do tema)
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  // atalho pra pegar um elemento pelo id
  const el = id => document.getElementById(id);
  // cores por nivel de status
  const COR = () => [cssVar('--fz-ok'), cssVar('--fz-warn'), cssVar('--fz-bad')];
  const NOME = ['OK', 'ALERTA', 'ALARME'];
  const T0 = new Date(F.meta.t0).getTime();
  // classifica o valor: 0 normal, 1 alerta, 2 alarme
  const flag = (v, a, al) => (v >= al ? 2 : v >= a ? 1 : 0);
  const TH = { tempA: 35, tempAl: 42, velA: 1.8, velAl: 4.5, acelA: 0.25, acelAl: 0.45 };

  const DS = (function () {
    const N = F.meta.n, K = Math.min(400, N);
    const idx = []; for (let i = 0; i < K; i++) idx.push(Math.round(i * (N - 1) / (K - 1)));
    const pick = arr => idx.map(i => arr[i]);
    return { n: K, t: pick(F.t), m1v: pick(F.m1.vel), m1a: pick(F.m1.acel), m1t: pick(F.m1.temp),
      m2v: pick(F.m2.vel), m2a: pick(F.m2.acel), m2t: pick(F.m2.temp) };
  })();

  const st = { fidx: 0, playing: false, speed: 200, timer: null, yaw1: 0.6, pitch1: -0.5, yaw2: 0.6, pitch2: -0.5, drag: null, drawReq: false, live: false, liveTimer: null };
  // formata o tempo pra mostrar na tela
  function tlabel(i) { return new Date(T0 + DS.t[i] * 1000).toLocaleTimeString('pt-BR', { hour12: false }); }
  // linha do dataset em um frame
  function rowAt(i) { return { v1: DS.m1v[i], a1: DS.m1a[i], t1: DS.m1t[i], v2: DS.m2v[i], a2: DS.m2a[i], t2: DS.m2t[i] }; }

  // converte pra numero
  const num = (v, d) => (v == null || isNaN(v)) ? (d || 0) : +v;
  // leitura ao vivo mais recente
  function liveRow() {
    const d = window.FZDashboard;
    if (!st.live || !d || typeof d.getCurrentReading !== 'function') return rowAt(st.fidx);
    const r = d.getCurrentReading() || {};

    return {
      v1: num(r.m1_vel), a1: num(r.m1_acel), t1: num(r.m1_temp, 25),
      v2: num(r.m2_vel, num(r.m1_vel)), a2: num(r.m2_acel, num(r.m1_acel)), t2: num(r.m2_temp, num(r.m1_temp, 25)),
    };
  }
  // nome da fonte ao vivo
  const liveFonteLbl = () => {
    const f = window.FZDashboard && window.FZDashboard.getFonte && window.FZDashboard.getFonte();
    return ({ esp32: 'ESP32 ao vivo', ativo: 'Ativo cadastrado', sim: 'Simulado', cloud: 'Forzy Cloud', forzy: 'Dataset Forzy (rede neural)' })[f] || '—';
  };
  // true se a fonte ao vivo esta ativa
  const fonteAoVivoOk = () => {
    const f = window.FZDashboard && window.FZDashboard.getFonte && window.FZDashboard.getFonte();
    return f === 'esp32' || f === 'ativo' || f === 'sim' || f === 'cloud';
  };

  // controles de reproducao
  function renderPlayer() {
    const p = el('scadaPlayer'); if (!p) return;
    const liveCtrls = `
      <button class="fz-btn ${st.live ? '' : 'ghost'} sp-btn" data-act="live" title="Seguir a fonte ao vivo do Monitoramento" style="${st.live ? 'background:var(--fz-ok);color:#0b1f14' : ''}">${st.live ? '● AO VIVO' : 'Ao vivo'}</button>`;
    if (st.live) {
      const ok = fonteAoVivoOk();
      p.innerHTML = `<div class="scada-player">
        ${liveCtrls}
        <span class="sp-time" style="flex:1;${ok ? '' : 'color:var(--fz-warn)'}">
          ${ok ? 'Fonte: ' + liveFonteLbl() : 'Selecione uma fonte ao vivo no Monitoramento (ESP32 / Ativo / Simulado / Cloud)'}
        </span>
        <span class="sp-time" id="spTime">${new Date().toLocaleTimeString('pt-BR', { hour12: false })}</span>
      </div>`;
    } else {
      p.innerHTML = `<div class="scada-player">
        ${liveCtrls}
        <button class="fz-btn ghost sp-btn" data-act="reset" title="Reiniciar">⏮</button>
        <button class="fz-btn sp-btn" data-act="play" title="Play">▶</button>
        <button class="fz-btn ghost sp-btn" data-act="pause" title="Pause">⏸</button>
        <select class="fz-select" data-act="speed">
          ${[50, 100, 200, 300, 500].map(s => `<option value="${s}" ${s === st.speed ? 'selected' : ''}>${s} ms</option>`).join('')}
        </select>
        <input class="fz-range" type="range" min="0" max="${DS.n - 1}" value="${st.fidx}" data-act="scrub" style="flex:1">
        <span class="sp-time" id="spTime">${tlabel(st.fidx)}</span>
      </div>`;
      p.querySelector('[data-act="reset"]').addEventListener('click', () => { st.fidx = 0; st.playing = false; sync(); render(); });
      p.querySelector('[data-act="play"]').addEventListener('click', () => { if (st.fidx >= DS.n - 1) st.fidx = 0; st.playing = true; startTimer(); });
      p.querySelector('[data-act="pause"]').addEventListener('click', () => { st.playing = false; });
      p.querySelector('[data-act="speed"]').addEventListener('change', e => { st.speed = +e.target.value; startTimer(); });
      p.querySelector('[data-act="scrub"]').addEventListener('input', e => { st.fidx = +e.target.value; st.playing = false; render(); });
    }
    p.querySelector('[data-act="live"]').addEventListener('click', () => {
      st.live = !st.live; st.playing = false;
      renderPlayer(); startTimer(); render();
    });
  }
  // sincroniza os elementos com o frame atual
  function sync() { const s = el('scadaPlayer'); if (!s) return; const r = s.querySelector('[data-act="scrub"]'); if (r) r.value = st.fidx; const t = el('spTime'); if (t) t.textContent = tlabel(st.fidx); }

  // lista de alertas da planta
  function renderAlerts() {
    const box = el('scadaAlerts'); if (!box) return;
    const r = liveRow();
    const [cOk, cW, cB] = COR();
    const banner = (nome, temp, vel, acel) => {
      const ft = flag(temp, TH.tempA, TH.tempAl), fv = flag(vel, TH.velA, TH.velAl);
      const f = Math.max(ft, fv);
      const cls = f === 2 ? 'al-red' : f === 1 ? 'al-yellow' : 'al-ok';
      return `<div class="scada-alert ${cls}">${nome} — Temp ${temp.toFixed(1)}°C | Vel ${vel.toFixed(2)} mm/s — ${NOME[f]}</div>`;
    };
    box.innerHTML = banner('EIXO 1', r.t1, r.v1, r.a1) + banner('EIXO 2', r.t2, r.v2, r.a2);
  }

  // planta 2D em SVG
  function render2D() {
    const p = el('scada2d'); if (!p) return;
    const r = liveRow();
    const [cOk, cW, cB] = COR();
    const cols = [cOk, cW, cB];
    const f1 = Math.max(flag(r.t1, TH.tempA, TH.tempAl), flag(r.v1, TH.velA, TH.velAl));
    const f2 = Math.max(flag(r.t2, TH.tempA, TH.tempAl), flag(r.v2, TH.velA, TH.velAl));
    const blink = (st.fidx % 3) < 2;
    const card = cssVar('--card'), txt2 = cssVar('--text-2');
    const tint = (x, w, f) => f === 0 ? '' : `<rect x="${x}" y="70" width="${w}" height="178" fill="${cols[f]}" opacity="${blink ? 0.22 : 0.05}"/>`;
    const bench = () => `
      <image href="assets/bomba.png" x="230" y="70" width="440" height="178" preserveAspectRatio="xMidYMid meet" opacity="0.96"/>
      ${tint(230, 220, f1)}${tint(450, 220, f2)}`;
    const panel = (x, nome, port, vel, acel, temp, fv, ft, f) => `
      <g font-family="var(--font-num)">
        <rect x="${x}" y="40" width="190" height="200" rx="10" fill="${card}" stroke="${cols[f]}" stroke-width="2"/>
        <text x="${x + 95}" y="68" text-anchor="middle" fill="${cols[f]}" font-size="15" font-weight="700">${nome}</text>
        <text x="${x + 95}" y="88" text-anchor="middle" fill="${cssVar('--teal')}" font-size="10">VIM32PL · ${port}</text>
        <text x="${x + 95}" y="120" text-anchor="middle" fill="${cols[fv]}" font-size="13" font-weight="700">Vel: ${vel.toFixed(3)} mm/s</text>
        <text x="${x + 95}" y="144" text-anchor="middle" fill="${txt2}" font-size="12">Acel: ${acel.toFixed(3)} g</text>
        <text x="${x + 95}" y="168" text-anchor="middle" fill="${cols[ft]}" font-size="12">Temp: ${temp.toFixed(1)} °C</text>
        <rect x="${x + 45}" y="186" width="100" height="26" rx="13" fill="${cols[f]}22" stroke="${cols[f]}"/>
        <text x="${x + 95}" y="204" text-anchor="middle" fill="${cols[f]}" font-size="12" font-weight="700">● ${NOME[f]}</text>
        <text x="${x + 95}" y="230" text-anchor="middle" fill="${cssVar('--text-3')}" font-size="9">${tlabel(st.fidx)}</text>
      </g>`;
    const wire = (x0, y0, x1, y1) => `<path d="M${x0},${y0} C${(x0 + x1) / 2},${y0} ${(x0 + x1) / 2},${y1} ${x1},${y1}" fill="none" stroke="#8e44ad" stroke-width="2"/>`;
    const sensor = (x, y) => `<circle cx="${x}" cy="${y}" r="11" fill="#8e44ad" stroke="#d7bde2" stroke-width="2"/><text x="${x}" y="${y - 16}" text-anchor="middle" fill="#b07cd0" font-size="9" font-family="var(--font-num)">VIM32PL</text>`;
    p.innerHTML = `<div class="fz-card"><div class="scada-2d">
      <svg viewBox="0 0 900 300" preserveAspectRatio="xMidYMid meet">
        ${panel(10, 'EIXO 1', 'Port 1', r.v1, r.a1, r.t1, flag(r.v1, TH.velA, TH.velAl), flag(r.t1, TH.tempA, TH.tempAl), f1)}
        ${panel(700, 'EIXO 2', 'Port 2', r.v2, r.a2, r.t2, flag(r.v2, TH.velA, TH.velAl), flag(r.t2, TH.tempA, TH.tempAl), f2)}
        ${bench()}
        ${wire(200, 140, 360, 140)}${sensor(360, 140)}
        ${wire(700, 140, 540, 140)}${sensor(540, 140)}
        <text x="450" y="278" text-anchor="middle" fill="${cssVar('--teal')}" font-size="12" font-weight="700" font-family="var(--font-num)">BANCADA DE TESTES — FORZY · Sensor VIM32PL IO-Link</text>
      </svg>
      <div class="fz-legend" style="justify-content:center;margin-top:6px">
        <span><i style="background:${cOk}"></i>OK</span><span><i style="background:${cW}"></i>Alerta</span>
        <span><i style="background:${cB}"></i>Alarme</span><span><i style="background:#8e44ad"></i>Sensor VIM32PL</span>
      </div>
    </div></div>`;
  }

  const MESH = buildMesh();
  let activeMesh = MESH;

  // le um arquivo .npy (mesh 3D)
  async function loadNpy(url) {
    const buf = await (await fetch(url)).arrayBuffer();
    const head = new Uint8Array(buf, 8, 2);
    const hlen = head[0] | (head[1] << 8);
    const txt = new TextDecoder().decode(new Uint8Array(buf, 10, hlen));
    const descr = /'descr':\s*'([^']+)'/.exec(txt)[1];
    const off = 10 + hlen;
    const slice = buf.slice(off);
    if (descr === '<f4') return new Float32Array(slice);
    if (descr === '<i4') return new Int32Array(slice);
    throw new Error('descr não suportado: ' + descr);
  }
  // carrega o modelo 3D real da bomba (se falhar usa o desenho simples)
  // REVISAR (Joao): testar a Vista 3D em PC mais fraco, sao ~21 mil triangulos
  async function loadRealMesh() {
    try {
      const [vd, fd] = await Promise.all([loadNpy('data/bomba_verts.npy'), loadNpy('data/bomba_faces.npy')]);
      const verts = [];
      for (let i = 0; i < vd.length; i += 3) verts.push([vd[i], vd[i + 1], vd[i + 2]]);

      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (const v of verts) for (let k = 0; k < 3; k++) { if (v[k] < mn[k]) mn[k] = v[k]; if (v[k] > mx[k]) mx[k] = v[k]; }
      const c = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
      const span = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) || 1;
      const s = 8 / span;
      for (const v of verts) { v[0] = (v[0] - c[0]) * s; v[1] = (v[1] - c[1]) * s; v[2] = (v[2] - c[2]) * s; }

      const zsCentered = verts.map(v => v[2]);
      const zMinC = Math.min(...zsCentered), zMaxC = Math.max(...zsCentered);
      const baseThresh = zMinC + (zMaxC - zMinC) * 0.20;
      const faces = [];
      for (let i = 0; i < fd.length; i += 3) {
        const i0 = fd[i], i1 = fd[i + 1], i2 = fd[i + 2];
        const avgZ = (verts[i0][2] + verts[i1][2] + verts[i2][2]) / 3;
        faces.push({ idx: [i0, i1, i2], group: avgZ < baseThresh ? 'base' : 'machine' });
      }
      activeMesh = { verts, faces };
      if (el('scadaCanvas')) draw3D();
    } catch (e) {  console.warn('Mesh real não carregou:', e.message); }
  }
  // monta os triangulos do modelo 3D
  function buildMesh() {
    const verts = [], faces = [];
    const add = v => (verts.push(v), verts.length - 1);
    function box(cx, cy, cz, sx, sy, sz, group) {
      const h = [sx / 2, sy / 2, sz / 2];
      const p = [];
      for (const dz of [-1, 1]) for (const dy of [-1, 1]) for (const dx of [-1, 1])
        p.push(add([cx + dx * h[0], cy + dy * h[1], cz + dz * h[2]]));

      const q = (a, b, c, d) => faces.push({ idx: [p[a], p[b], p[c], p[d]], group });
      q(0, 1, 3, 2); q(4, 6, 7, 5); q(0, 4, 5, 1); q(2, 3, 7, 6); q(0, 2, 6, 4); q(1, 5, 7, 3);
    }
    function cyl(cx, cy, cz, r, len, seg, group) {
      const a = [], b = [];
      for (let i = 0; i < seg; i++) { const t = i / seg * Math.PI * 2; const y = cy + r * Math.cos(t), z = cz + r * Math.sin(t); a.push(add([cx - len / 2, y, z])); b.push(add([cx + len / 2, y, z])); }
      for (let i = 0; i < seg; i++) { const j = (i + 1) % seg; faces.push({ idx: [a[i], a[j], b[j], b[i]], group }); }
      const ca = add([cx - len / 2, cy, cz]), cb = add([cx + len / 2, cy, cz]);
      for (let i = 0; i < seg; i++) { const j = (i + 1) % seg; faces.push({ idx: [ca, a[j], a[i]], group }); faces.push({ idx: [cb, b[i], b[j]], group }); }
    }
    box(0, 0, -1.6, 7.5, 4.0, 1.2, 'base');
    cyl(-0.4, 0, 0.4, 1.5, 4.6, 26, 'machine');
    cyl(2.9, 0, 0.2, 1.1, 1.4, 22, 'machine');
    box(2.9, 0, 1.6, 0.5, 0.5, 1.6, 'machine');
    return { verts, faces };
  }
  // escurece ou clareia uma cor pela luz
  function shade(hex, b) {
    const n = hex.replace('#', ''); let r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), bl = parseInt(n.slice(4, 6), 16);
    r = Math.round(r * b); g = Math.round(g * b); bl = Math.round(bl * b);
    return `rgb(${r},${g},${bl})`;
  }
  // pede o proximo desenho do 3D
  function requestDraw() {
    if (st.drawReq) return;
    st.drawReq = true;
    requestAnimationFrame(() => { st.drawReq = false; draw3D(); });
  }

  // aba Vista 3D
  function render3D(forceInit) {
    const host = el('scada3d'); if (!host) return;
    if (forceInit || !el('scadaCanvas')) {
      host.innerHTML = `
        <div class="fz-card">
          <div class="fz-card-title">Vista 3D — Modelo da Bomba</div>
          <div class="fz-card-sub">Arraste cada motor para girar independentemente · clique para ver informações · ◆ = sensor VIM32PL</div>
          <canvas id="scadaCanvas" style="width:100%;height:auto;display:block;background:var(--field);border-radius:12px;cursor:grab;touch-action:none"></canvas>
          <div id="scada3d-info" style="display:flex;gap:12px;margin-top:10px"></div>
        </div>`;
      attachDrag(el('scadaCanvas'));
    }
    draw3D();
  }

  // liga o arrastar pra girar o motor
  function attachDrag(cv) {
    if (!cv) return;
    cv.addEventListener('pointerdown', e => {
      const rect = cv.getBoundingClientRect();
      const motor = (e.clientX - rect.left) / rect.width < 0.5 ? 1 : 2;
      st.drag = { x: e.clientX, y: e.clientY, motor, moved: false, startX: e.clientX, startY: e.clientY };
      cv.style.cursor = 'grabbing'; cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', e => {
      if (!st.drag) return;
      const dx = e.clientX - st.drag.x, dy = e.clientY - st.drag.y;
      if (Math.abs(e.clientX - st.drag.startX) > 4 || Math.abs(e.clientY - st.drag.startY) > 4) st.drag.moved = true;
      st.drag.x = e.clientX; st.drag.y = e.clientY;
      if (st.drag.motor === 1) {
        st.yaw1 += dx * 0.01;
        st.pitch1 = Math.max(-1.5, Math.min(1.5, st.pitch1 + dy * 0.01));
      } else {
        st.yaw2 += dx * 0.01;
        st.pitch2 = Math.max(-1.5, Math.min(1.5, st.pitch2 + dy * 0.01));
      }
      requestDraw();
    });
    const end = e => {
      if (st.drag && !st.drag.moved) showMotorInfo(st.drag.motor);
      st.drag = null; cv.style.cursor = 'grab';
      try { cv.releasePointerCapture(e.pointerId); } catch (_) {}
      draw3D();
    };
    cv.addEventListener('pointerup', end);
    cv.addEventListener('pointercancel', end);
  }

  // painel com os dados do motor clicado
  function showMotorInfo(motorIdx) {
    const r = liveRow();
    const [cOk, cW, cB] = COR();
    const SLABEL = ['Normal', 'Alerta', 'Alarme'];
    const SCOL = [cOk, cW, cB];
    const motors = [
      { name: 'Eixo 1 — BBA-001', v: r.v1, a: r.a1, t: r.t1 },
      { name: 'Eixo 2 — BBA-002', v: r.v2, a: r.a2, t: r.t2 },
    ];
    const m = motors[motorIdx - 1];
    const sv = Math.max(flag(m.v, TH.velA, TH.velAl), flag(m.t, TH.tempA, TH.tempAl));
    const col = SCOL[sv];
    const info = el('scada3d-info');
    if (!info) return;
    info.innerHTML = `
      <div style="flex:1;background:var(--field);border-radius:8px;padding:12px;border-left:3px solid ${col}">
        <div style="font-weight:700;color:${col};margin-bottom:8px">${m.name} &nbsp;·&nbsp; ${SLABEL[sv]}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;font-size:13px">
          <div><div style="color:var(--muted,#888);font-size:11px">Vel. RMS</div><b>${m.v.toFixed(2)} mm/s</b></div>
          <div><div style="color:var(--muted,#888);font-size:11px">Aceleração</div><b>${(m.a||0).toFixed(3)} g</b></div>
          <div><div style="color:var(--muted,#888);font-size:11px">Temperatura</div><b>${m.t.toFixed(1)} °C</b></div>
        </div>
        <button class="fz-btn ghost" id="scada3dDiag" style="margin-top:10px">🔍 Ver Diagnóstico deste Motor</button>
      </div>`;
    document.getElementById('scada3dDiag')?.addEventListener('click', () => {
      window.FZInvestigacao?.abrirPara?.(motorIdx === 2 ? 'm2' : 'm1');
    });
  }

  // ordena as faces pra desenhar (fundo primeiro)
  function buildSorted(yaw, pitch, isDragging) {
    const cya = Math.cos(yaw), sya = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const rot = v => {
      const x = v[0] * cya - v[1] * sya, y = v[0] * sya + v[1] * cya;
      const y2 = y * cp - v[2] * sp, z2 = y * sp + v[2] * cp;
      return [x, y2, z2];
    };
    const light = [0.4, -0.5, 0.75];
    const R = activeMesh.verts.map(rot);
    const step = 1;
    const faces = [];
    for (let fi = 0; fi < activeMesh.faces.length; fi += step) {
      const f = activeMesh.faces[fi];
      const vs = f.idx.map(i => R[i]);
      const n = normal(vs);
      if (n[1] > 0) continue;
      let depth = 0; for (const v of vs) depth += v[1]; depth /= vs.length;

      const brRaw = 0.45 + 0.55 * Math.max(0, n[0] * light[0] + n[1] * light[1] + n[2] * light[2]);
      const br = Math.round(Math.min(1, brRaw) * 48) / 48;
      faces.push({ vs, depth, br, isBase: f.group === 'base' });
    }
    faces.sort((a, b) => b.depth - a.depth);
    return { faces, rot };
  }

  // desenha o 3D no canvas
  function draw3D() {
    const cv = el('scadaCanvas'); if (!cv) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = cv.clientWidth || 760, cssH = Math.round(cssW * 400 / 760);
    if (cv.width !== Math.round(cssW * dpr) || cv.height !== Math.round(cssH * dpr)) {
      cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
      cv.style.height = cssH + 'px';
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = cssW, H = cssH;
    ctx.clearRect(0, 0, W, H);
    const r = liveRow();
    const [cOk, cW, cB] = COR();
    const status1 = Math.max(flag(r.t1, TH.tempA, TH.tempAl), flag(r.v1, TH.velA, TH.velAl));
    const status2 = Math.max(flag(r.t2, TH.tempA, TH.tempAl), flag(r.v2, TH.velA, TH.velAl));
    const SLABEL = ['OK', 'Alerta', 'Alarme'];
    const scale = 26, cy0 = H / 2 + 20;

    const drag1 = st.drag?.motor === 1, drag2 = st.drag?.motor === 2;
    const { faces: f1, rot: rot1 } = buildSorted(st.yaw1, st.pitch1, drag1);
    const { faces: f2, rot: rot2 } = buildSorted(st.yaw2, st.pitch2, drag2);

    function drawMotor(cx0, faces, rot, statusIdx, label) {
      const col = [cOk, cW, cB][statusIdx];

      const buckets = new Map();
      for (const f of faces) {
        const c = shade(f.isBase ? '#4a5060' : col, f.br);
        if (!buckets.has(c)) buckets.set(c, []);
        buckets.get(c).push(f);
      }

      const sorted2 = [...buckets.entries()].sort((a, b) => {
        const da = a[1].reduce((s, f) => s + f.depth, 0) / a[1].length;
        const db = b[1].reduce((s, f) => s + f.depth, 0) / b[1].length;
        return db - da;
      });
      for (const [color, group] of sorted2) {
        ctx.beginPath();
        for (const f of group) {
          ctx.moveTo(cx0 + f.vs[0][0] * scale, cy0 - f.vs[0][2] * scale);
          for (let i = 1; i < f.vs.length; i++) ctx.lineTo(cx0 + f.vs[i][0] * scale, cy0 - f.vs[i][2] * scale);
          ctx.closePath();
        }
        ctx.fillStyle = color; ctx.fill();
      }

      for (const sx of [-1.4, 1.4]) {
        const v = rot([sx, 0, 2.1]);
        const px = cx0 + v[0] * scale, py = cy0 - v[2] * scale;
        ctx.fillStyle = '#8e44ad'; ctx.strokeStyle = '#d7bde2'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(px, py - 6); ctx.lineTo(px + 5, py); ctx.lineTo(px, py + 6); ctx.lineTo(px - 5, py); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      ctx.fillStyle = col; ctx.font = 'bold 13px system-ui,sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(`${label} · ${SLABEL[statusIdx]}`, cx0, H - 10);

      ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.font = '11px system-ui,sans-serif';
      ctx.fillText('clique para info', cx0, H + 4);
    }

    drawMotor(W * 0.27, f1, rot1, status1, 'Eixo 1');
    drawMotor(W * 0.73, f2, rot2, status2, 'Eixo 2');
  }
  // vetor normal de uma face
  function normal(vs) {
    const a = vs[0], b = vs[1], c = vs[2];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const L = Math.hypot(n[0], n[1], n[2]) || 1; return [n[0] / L, n[1] / L, n[2] / L];
  }

  // aba Historico
  function renderHist() {
    const p = el('scadaHist'); if (!p) return;
    const upto = st.fidx + 1;
    const chart = (m1, m2, la, lal, titulo, unit) => {
      const s1 = m1.slice(0, upto), s2 = m2.slice(0, upto);
      return `<div class="fz-card"><div class="fz-card-title">${titulo}</div>
        <div class="fz-legend"><span><i style="background:#3498db"></i>Eixo 1</span><span><i style="background:#e74c3c"></i>Eixo 2</span></div>
        <div class="fz-chart">${multiLine(s1, s2, la, lal, unit)}</div></div>`;
    };
    p.innerHTML = chart(DS.m1v, DS.m2v, TH.velA, TH.velAl, 'Velocidade (mm/s)', 'mm/s')
      + chart(DS.m1a, DS.m2a, TH.acelA, TH.acelAl, 'Aceleração (g)', 'g')
      + chart(DS.m1t, DS.m2t, TH.tempA, TH.tempAl, 'Temperatura (°C)', '°C');
  }
  // grafico com varias linhas
  function multiLine(s1, s2, la, lal, unit) {
    const W = 720, H = 180, padL = 42, padR = 12, padT = 10, padB = 22;
    const n = Math.max(s1.length, 2);
    let mn = Infinity, mx = -Infinity;
    for (const v of s1.concat(s2, [la, lal])) { if (v < mn) mn = v; if (v > mx) mx = v; }
    if (mx - mn < 1e-6) { mn -= 1; mx += 1; } mn = Math.min(mn, 0);
    const X = i => padL + (s1.length < 2 ? 0 : i * (W - padL - padR) / (s1.length - 1));
    const Y = v => padT + (1 - (v - mn) / (mx - mn)) * (H - padT - padB);
    const path = s => { if (s.length < 2) return ''; let d = 'M' + X(0).toFixed(1) + ',' + Y(s[0]).toFixed(1); for (let i = 1; i < s.length; i++) d += ' L' + X(i).toFixed(1) + ',' + Y(s[i]).toFixed(1); return d; };
    let grid = '';
    for (let g = 0; g <= 4; g++) { const v = mn + (mx - mn) * g / 4, y = Y(v); grid += `<line class="fz-grid-line" x1="${padL}" x2="${W - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/><text class="fz-axis-label" x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end">${v.toFixed(1)}</text>`; }
    const thr = (v, c) => `<line x1="${padL}" x2="${W - padR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="${c}" stroke-width="1" stroke-dasharray="4 3"/>`;
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:auto">
      ${grid}${thr(la, cssVar('--fz-warn'))}${thr(lal, cssVar('--fz-bad'))}
      <path d="${path(s1)}" fill="none" stroke="#3498db" stroke-width="1.6"/>
      <path d="${path(s2)}" fill="none" stroke="#e74c3c" stroke-width="1.6"/>
    </svg>`;
  }

  // aba aberta agora
  const activeTab = () => { const t = document.querySelector('#scadaTabs .fz-tab.active'); return t ? t.dataset.stab : 'p2d'; };
  // true se a tela SCADA esta aberta
  const scadaOn = () => document.getElementById('screen-scada').classList.contains('active');
  // desenha a tela
  function render() {
    renderAlerts();
    const tab = activeTab();
    if (tab === 'p2d') render2D();
    if (tab === 'p3d') render3D();
    if (tab === 'hist') renderHist();
    sync();
  }
  // liga o timer da tela
  function startTimer() {
    if (st.timer) clearInterval(st.timer);
    if (st.liveTimer) { clearInterval(st.liveTimer); st.liveTimer = null; }
    if (st.live) {

      st.liveTimer = setInterval(() => {
        if (!scadaOn() || !st.live) return;
        const t = el('spTime');
        if (t) t.textContent = new Date().toLocaleTimeString('pt-BR', { hour12: false });
        render();
      }, 1000);
      return;
    }
    st.timer = setInterval(() => {
      if (!st.playing || !scadaOn()) return;
      st.fidx = Math.min(st.fidx + 1, DS.n - 1);
      if (st.fidx >= DS.n - 1) st.playing = false;
      render();
    }, st.speed);
  }

  // troca a aba do SCADA
  function switchTab(name) {
    document.querySelectorAll('#scadaTabs .fz-tab').forEach(b => b.classList.toggle('active', b.dataset.stab === name));
    document.querySelectorAll('#screen-scada .fz-cpanel').forEach(p => p.classList.toggle('active', p.dataset.spanel === name));
    if (name === 'p3d') render3D(true); else render();
  }

  // liga a tela (roda so na primeira visita)
  function init() {
    if (!el('scadaTabs')) return;
    document.querySelectorAll('#scadaTabs .fz-tab[data-stab]').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.stab)));
    renderPlayer(); render(); startTimer(); loadRealMesh();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.FZScada = {
    show3D(eixoIdx) {
      if (typeof window.showScreen === 'function') window.showScreen('scada');
      switchTab('p3d');

      const s = String(eixoIdx).toLowerCase();
      const motor = (s === '2' || s === 'm2') ? 2 : 1;
      try { showMotorInfo(motor); } catch (_) {}
    }
  };
})();
