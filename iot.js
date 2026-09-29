/* iot.js: tela de Sensores (conexao com o ESP32) */

(function () {
  const S = window.FZStore;
  // le o valor de uma variavel CSS (cor do tema)
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  // atalho pra pegar um elemento pelo id
  const el = id => document.getElementById(id);
  // protege o texto contra HTML/XSS antes de ir pro innerHTML
  const esc = s => (s == null ? '' : String(s)).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // cores por nivel de status
  const COR = () => [cssVar('--fz-ok'), cssVar('--fz-warn'), cssVar('--fz-bad')];
  const NOME = ['NORMAL', 'ALERTA', 'ALARME'];
  // 0 = normal, 1 = alerta, 2 = alarme (ISO 10816)
  // REVISAR (Arthur): esses limites servem so pra motor < 15 kW, ver se bomba grande precisa de outros
  const flagV = v => (v >= 4.5 ? 2 : v >= 1.8 ? 1 : 0);
  // numero aleatorio com distribuicao normal (usado na simulacao)
  function gauss(mu, sd) { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  // true se o ativo e do Forzy (IoT nao grava nele)
  const isForzyAsset = a => !!a && ((a.origem === 'forzy' || a.origem === 'demo') || ['FZ-M1', 'FZ-M2', 'FZ-M3'].includes(a.tag));
  // ativo onde o IoT pode gravar
  const ativoGravavel = cod => { if (!cod || !S) return false; return !isForzyAsset(S.getAtivoPorCodigo(cod)); };

  // endereco do bridge Python (serial_bridge.py) que le a porta do ESP32
  // REVISAR (Vitor): se o bridge nao estiver rodando, mostrar um aviso claro na tela IoT?
  const BRIDGE_URL = 'http://localhost:8766/data';
  const CLOUD_LOG_URL = 'dados/forzy_cloud_log.csv';
  const st = { modo: 'sim', porta: 'COM5', baud: 115200, hist: [], simT: 0, timer: null,
    serial: { supported: ('serial' in navigator), port: null, reader: null, connected: false, buf: [], status: 'idle' },
    bridge: { timer: null, connected: false, lastTs: 0 },
    cloud: { rows: [], lastTs: 0, lastFetch: 0, erro: '' },
    ativo: null };
  // ultima leitura recebida
  const last = () => st.hist.length ? st.hist[st.hist.length - 1] : { vel: 0, apeak: 0, arms: 0, temp: 0, flag: 0 };

  // painel de configuracao
  function renderConfig() {
    const c = el('iotConfig'); if (!c) return;
    const ativos = S ? S.getAtivosIndustrial() : [];
    c.innerHTML = `
      <div class="fz-field"><span>Fonte de dados</span>
        <div class="fz-seg" data-act="modo">
          <button class="${st.modo === 'sim' ? 'active' : ''}" data-v="sim">Simulação</button>
          <button class="${st.modo === 'real' ? 'active' : ''}" data-v="real">ESP32 Real (USB)</button>
          <button class="${st.modo === 'cloud' ? 'active' : ''}" data-v="cloud">Forzy Cloud (S1/S2)</button>
        </div></div>
      ${st.modo === 'real' ? `
      <div class="fz-field"><span>Porta Serial</span>
        <select class="fz-select" data-act="porta">${['COM5', 'COM3', 'COM4', 'COM6', 'COM7', 'AUTO'].map(p => `<option ${p === st.porta ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
      <div class="fz-field"><span>Baud Rate</span>
        <select class="fz-select" data-act="baud">${[115200, 9600, 57600].map(b => `<option ${b === st.baud ? 'selected' : ''}>${b}</option>`).join('')}</select></div>
      <div class="fz-field"><span>Ativo (gravar)</span>
        <select class="fz-select" data-act="ativo">
          <option value="">— Não gravar (apenas visualizar) —</option>
          ${ativos.map(a => `<option value="${esc(a.codigo)}" ${isForzyAsset(a) ? 'disabled' : ''}>${esc(a.codigo)}${a.tag ? ' · ' + esc(a.tag) : ''}${isForzyAsset(a) ? ' — Forzy (dataset · só leitura)' : ''}</option>`).join('')}
        </select></div>
      <div class="fz-field"><span>&nbsp;</span><button class="fz-btn" data-act="conn">${st.serial.connected ? 'Desconectar ESP32 (Web Serial)' : 'Conectar ESP32 (Web Serial)'}</button></div>
      <div class="fz-field"><span>&nbsp;</span><button class="fz-btn" data-act="bridge">${st.bridge.connected ? 'Desconectar Bridge' : 'Conectar via Bridge'}</button></div>` : ''}
      ${st.modo === 'cloud' ? `
      <div class="fz-field"><span>Coleta em background</span>
        <div style="font-size:12px;color:var(--text-2);padding-top:6px">daily_bridge.py · agendado de hora em hora · grava em dados/forzy_cloud_log.csv</div></div>
      <div class="fz-field"><span>&nbsp;</span><button class="fz-btn" data-act="cloud-refresh">Atualizar agora</button></div>` : ''}`;
    c.querySelector('[data-act="modo"]').querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      if (st.modo !== b.dataset.v) {
        st.modo = b.dataset.v; st.hist = []; st.simT = 0;
        for (let i = 0; i < 30 && st.modo === 'sim'; i++) stepSim();
        if (st.modo === 'cloud') loadCloudLog();
      }
      renderConfig(); renderCards(); renderLive();
    }));
    const por = c.querySelector('[data-act="porta"]'); if (por) por.addEventListener('change', e => st.porta = e.target.value);
    const bd = c.querySelector('[data-act="baud"]'); if (bd) bd.addEventListener('change', e => st.baud = +e.target.value);
    const at = c.querySelector('[data-act="ativo"]'); if (at) {
      const gravaveis = ativos.filter(a => !isForzyAsset(a));

      if (st.ativo === null) st.ativo = gravaveis.length ? gravaveis[0].codigo : '';
      else if (st.ativo && !gravaveis.some(a => a.codigo === st.ativo)) st.ativo = '';
      at.value = st.ativo;
      at.addEventListener('change', e => { st.ativo = e.target.value; renderCards(); });
    }
    const cn = c.querySelector('[data-act="conn"]'); if (cn) cn.addEventListener('click', toggleSerial);
    const br = c.querySelector('[data-act="bridge"]'); if (br) br.addEventListener('click', toggleBridge);
    const cr = c.querySelector('[data-act="cloud-refresh"]'); if (cr) cr.addEventListener('click', loadCloudLog);
  }

  // cartoes de leitura
  function renderCards() {
    const c = el('iotCards'); if (!c) return;
    let dot, txt, cor, sub;
    if (st.modo === 'sim') { dot = 'dot-waiting'; txt = 'SIMULAÇÃO'; cor = cssVar('--fz-warn'); sub = 'Modo demonstração ativo'; }
    else if (st.modo === 'cloud') {
      if (st.cloud.erro) { dot = 'dot-offline'; txt = 'ERRO'; cor = cssVar('--fz-bad'); sub = st.cloud.erro; }
      else if (!st.cloud.rows.length) { dot = 'dot-waiting'; txt = 'AGUARDANDO COLETA'; cor = cssVar('--fz-warn'); sub = 'Nenhuma leitura ainda — rode daily_bridge.py 1x pra testar'; }
      else { dot = 'dot-online'; txt = 'ONLINE (Forzy Cloud)'; cor = cssVar('--fz-ok');
        sub = `Última coleta: ${new Date(st.cloud.lastTs).toLocaleString('pt-BR')} · ${st.cloud.rows.length} leituras no log`; }
    }
    else if (st.bridge.connected) { dot = 'dot-online'; txt = 'ONLINE (Bridge)'; cor = cssVar('--fz-ok');
      sub = `Bridge Python ativo · ${st.bridge.rxCount || 0} leituras · rode serial_bridge.py`; }
    else if (st.serial.connected) { dot = 'dot-online'; txt = 'ONLINE'; cor = cssVar('--fz-ok');
      sub = (st.ativo ? `Porta ${st.porta} · gravando em ${st.ativo}` : `Porta ${st.porta} · apenas visualizando`); }
    else { dot = 'dot-offline'; txt = 'DESCONECTADO'; cor = cssVar('--fz-bad');
      sub = 'Rode serial_bridge.py e clique "Conectar via Bridge"'; }
    c.innerHTML = `
      <div class="fz-card"><div class="i-lbl">Status da Conexão</div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:6px"><span class="iot-dot ${dot}"></span><span style="font-weight:700;color:${cor}">${txt}</span></div>
        <div style="font-size:13px;color:var(--text-2);margin-top:8px">${esc(sub)}</div></div>
      <div class="fz-card"><div class="i-lbl">Protocolo IO-Link</div>
        ${[['Canal 1', 'Velocidade RMS (mm/s)'], ['Canal 2', 'Aceleração Pico (g)'], ['Canal 3', 'Aceleração RMS (g)'], ['Canal 4', 'Temperatura (°C)']].map(([k, v]) =>
          `<div class="iot-chan"><span style="color:var(--text-2)">${k}</span><span style="color:var(--text)">${v}</span></div>`).join('')}</div>
      <div class="fz-card"><div class="i-lbl">Hardware Requerido</div>
        <div style="font-size:13px;color:var(--text-2);line-height:2;margin-top:6px">Sensor VIM32PL-E1AC8<br>ESP32 Dev Module<br>Cabo USB-Serial (CP210x)<br>Driver CP210x / CH340</div>
        <div style="margin-top:12px;border-top:1px solid var(--border,#333);padding-top:10px">
          <div class="i-lbl" style="margin-bottom:6px">Simular alarme (modal · sininho · rail)</div>
          <button id="iot-test-p2" style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid var(--fz-warn);color:var(--fz-warn);background:transparent;cursor:pointer;margin-right:6px">⚠ Simular Alerta P2</button>
          <button id="iot-test-p1" style="font-size:11px;padding:4px 10px;border-radius:6px;border:1px solid var(--fz-bad);color:var(--fz-bad);background:transparent;cursor:pointer">🔴 Simular Alarme P1</button>
        </div></div>`;

    const simular = (p1, vel, temp, arms) => window.FZAlertas?.simular?.({
      prioridade: p1 ? 'P1 - Crítico' : 'P2 - Alto',
      titulo: p1 ? 'Vibração Crítica' : 'Vibração Alta',
      msg: `ESP32 · teste ${new Date().toLocaleTimeString('pt-BR')}: Vibração ${vel.toFixed(2)} mm/s`,
      nivel: p1 ? 'bad' : 'warn', valor: vel, unidade: 'mm/s',
      origem: 'esp32', eixo: 'm1', variavel: 'vel', ativo: 'ESP32',
      leitura: { m1_vel: vel, m1_acel: arms, m1_temp: temp },
    });
    document.getElementById('iot-test-p2')?.addEventListener('click', () => simular(false, 2.3, 37, 0.018));
    document.getElementById('iot-test-p1')?.addEventListener('click', () => simular(true, 6.8, 44, 0.052));
  }

  // le o CSV do Forzy Cloud
  function parseCloudCsv(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const header = lines[0].split(',');
    return lines.slice(1).filter(Boolean).map(line => {
      const cols = line.split(',');
      const row = {}; header.forEach((h, i) => row[h] = cols[i]);
      return {
        timestamp: row.timestamp,
        sensor: row.sensor,
        velocidade: row.velocidade !== '' && row.velocidade != null ? +row.velocidade : null,
        aceleracao: row.aceleracao !== '' && row.aceleracao != null ? +row.aceleracao : null,
        temperatura: row.temperatura !== '' && row.temperatura != null ? +row.temperatura : null,
        erro: row.erro || ''
      };
    }).filter(r => !r.erro && r.velocidade != null);
  }
  // busca o CSV do Forzy Cloud
  async function loadCloudLog() {
    try {
      const res = await fetch(CLOUD_LOG_URL + '?_=' + Date.now());
      if (!res.ok) throw new Error('Log ainda não existe — rode daily_bridge.py pelo menos 1x');
      const text = await res.text();
      st.cloud.rows = parseCloudCsv(text);
      st.cloud.lastTs = st.cloud.rows.length ? Date.parse(st.cloud.rows[st.cloud.rows.length - 1].timestamp) : 0;
      st.cloud.erro = '';
    } catch (e) { st.cloud.erro = e.message; }
    if (st.modo === 'cloud') { renderCards(); renderLive(); }
  }
  // grafico com dois sensores
  function dualLineChart(arr1, arr2, color1, color2) {
    color1 = color1 || '#3498db'; color2 = color2 || '#e67e22';
    const W = 700, H = 160, padL = 40, padR = 12, padT = 10, padB = 18;
    const n = Math.max(arr1.length, arr2.length);
    const [mn, mx] = scaleY(arr1, arr2);
    const X = i => padL + (n < 2 ? 0 : i * (W - padL - padR) / (n - 1));
    const Y = v => padT + (1 - (v - mn) / (mx - mn)) * (H - padT - padB);
    let grid = ''; for (let g = 0; g <= 3; g++) { const v = mn + (mx - mn) * g / 3, y = Y(v); grid += `<line class="fz-grid-line" x1="${padL}" x2="${W - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/><text class="fz-axis-label" x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end">${v.toFixed(2)}</text>`; }
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:auto">${grid}
      <path d="${pathOf(arr1, X, Y)}" fill="none" stroke="${color1}" stroke-width="1.8"/>
      <path d="${pathOf(arr2, X, Y)}" fill="none" stroke="${color2}" stroke-width="1.8"/></svg>`;
  }
  // tela do Forzy Cloud (S1 e S2)
  function renderCloudLive() {
    const s1 = st.cloud.rows.filter(r => r.sensor === 's1');
    const s2 = st.cloud.rows.filter(r => r.sensor === 's2');
    const lastOf = arr => arr.length ? arr[arr.length - 1] : null;
    const l1 = lastOf(s1), l2 = lastOf(s2);
    const k = el('iotKpis');
    if (k) {
      const cell = (lbl, v, c) => `<div class="fz-kpi-cell"><div class="k-lbl">${lbl}</div><div class="k-val" style="color:${c}">${v}</div></div>`;
      const cellsFor = (nome, l) => l
        ? [cell(`${nome} · Vel.`, l.velocidade.toFixed(3) + ' mm/s', cssVar('--text')),
           cell(`${nome} · Acel.`, l.aceleracao.toFixed(4) + ' g', cssVar('--text')),
           cell(`${nome} · Temp.`, l.temperatura.toFixed(1) + ' °C', cssVar('--text'))]
        : [cell(nome, '—', cssVar('--text-2'))];
      k.innerHTML = [...cellsFor('S1', l1), ...cellsFor('S2', l2)].join('');
    }
    const vel = el('iotChartVel');
    if (vel) vel.innerHTML = `<div class="fz-card-title">Velocidade RMS — Forzy Cloud (S1 azul · S2 laranja)</div>
      <div class="fz-chart">${dualLineChart(s1.map(r => r.velocidade), s2.map(r => r.velocidade))}</div>`;
    const ac = el('iotChartAcel');
    if (ac) ac.innerHTML = `<div class="fz-card-title">Aceleração — Forzy Cloud (S1 roxo · S2 laranja)</div>
      <div class="fz-chart">${dualLineChart(s1.map(r => r.aceleracao), s2.map(r => r.aceleracao), '#9b59b6', '#e67e22')}</div>`;
    const tp = el('iotChartTemp');
    if (tp) tp.innerHTML = `<div class="fz-card-title">Temperatura — Forzy Cloud (S1 azul · S2 laranja)</div>
      <div class="fz-chart">${dualLineChart(s1.map(r => r.temperatura), s2.map(r => r.temperatura), '#3498db', '#e67e22')}</div>`;
    const xyz = el('iotXyz'); if (xyz) xyz.innerHTML = '';
  }

  // tela ao vivo do ESP32
  function renderLive() {
    if (st.modo === 'cloud') { renderCloudLive(); return; }
    const [cOk, cW, cB] = COR(); const cols = [cOk, cW, cB];
    const L = last(); const hasXYZ = st.modo === 'real' && L.AX != null;
    const k = el('iotKpis');
    if (k) {
      const cells = hasXYZ
        ? [['Vel. RMS', L.vel.toFixed(3) + ' mm/s', cols[L.flag]], ['Acel. Mag', L.apeak.toFixed(4) + ' g', cssVar('--text')],
           ['AX', (L.AX || 0).toFixed(4) + ' g', cssVar('--text')], ['AY', (L.AY || 0).toFixed(4) + ' g', cssVar('--text')], ['AZ', (L.AZ || 0).toFixed(4) + ' g', cssVar('--text')]]
        : [['Vel. RMS', L.vel.toFixed(3) + ' mm/s', cols[L.flag]], ['Acel. Mag', L.apeak.toFixed(4) + ' g', cssVar('--text')],
           ['Acel. RMS', L.arms.toFixed(4) + ' g', cssVar('--text')], ['Temperatura', L.temp.toFixed(1) + ' °C', cssVar('--text')], ['Status ISO', NOME[L.flag], cols[L.flag]]];
      k.innerHTML = cells.map(([l, v, c]) => `<div class="fz-kpi-cell"><div class="k-lbl">${l}</div><div class="k-val" style="color:${c}">${v}</div></div>`).join('');
    }
    const vel = el('iotChartVel');
    if (vel) vel.innerHTML = `<div class="fz-card-title">Velocidade de Vibração RMS — VIM32PL (ao vivo)</div>
      <div class="fz-chart">${velChart(smooth(st.hist.map(h => h.vel), 6))}</div>`;
    const ac = el('iotChartAcel');
    if (ac) ac.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
        <div class="fz-card-title" style="margin:0">Aceleração de Pico (g)</div>
        <div style="font-size:22px;font-weight:700;color:#9b59b6;letter-spacing:-0.5px">${L.apeak.toFixed(4)} <span style="font-size:12px;font-weight:400;color:var(--muted,#888)">g</span></div>
      </div>
      <div class="fz-chart">${lineChart(smooth(st.hist.map(h => h.apeak), 6), '#9b59b6')}</div>`;
    const tempCor = L.temp >= 42 ? cB : L.temp >= 35 ? cW : '#e67e22';
    const tp = el('iotChartTemp');
    if (tp) tp.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
        <div class="fz-card-title" style="margin:0">Temperatura do Sensor (°C)</div>
        <div style="font-size:22px;font-weight:700;color:${tempCor};letter-spacing:-0.5px">${L.temp.toFixed(1)} <span style="font-size:12px;font-weight:400;color:var(--muted,#888)">°C</span></div>
      </div>
      <div class="fz-chart">${lineChart(smooth(st.hist.map(h => h.temp), 4), '#e67e22')}</div>`;
    const xyz = el('iotXyz');
    if (xyz) xyz.innerHTML = hasXYZ ? `<div class="fz-card" style="margin-top:16px"><div class="fz-card-title">Aceleração XYZ — MPU6050 (g)</div>
      <div class="fz-legend"><span><i style="background:#e74c3c"></i>AX</span><span><i style="background:#2ecc71"></i>AY</span><span><i style="background:#3498db"></i>AZ</span></div>
      <div class="fz-chart">${xyzChart()}</div></div>` : '';
  }

  // media movel pra suavizar o grafico
  function smooth(arr, w = 5) {
    if (arr.length < 2) return arr;
    return arr.map((_, i) => {
      const s = Math.max(0, i - w + 1);
      const slice = arr.slice(s, i + 1);
      return slice.reduce((a, b) => a + b, 0) / slice.length;
    });
  }

  // escala vertical do grafico
  function scaleY(arr, extra) {
    let mn = Infinity, mx = -Infinity; for (const v of arr.concat(extra || [])) { if (v < mn) mn = v; if (v > mx) mx = v; }
    if (!isFinite(mn)) { mn = 0; mx = 1; } if (mx - mn < 1e-6) { mn -= 1; mx += 1; } mn = Math.min(mn, 0); return [mn, mx];
  }
  // caminho SVG de uma serie
  function pathOf(arr, X, Y) { if (arr.length < 2) return ''; let d = 'M' + X(0).toFixed(1) + ',' + Y(arr[0]).toFixed(1); for (let i = 1; i < arr.length; i++) d += ' L' + X(i).toFixed(1) + ',' + Y(arr[i]).toFixed(1); return d; }
  // grafico de linha
  function lineChart(arr, color) {
    const W = 700, H = 160, padL = 40, padR = 12, padT = 10, padB = 18;
    const [mn, mx] = scaleY(arr);
    const X = i => padL + (arr.length < 2 ? 0 : i * (W - padL - padR) / (arr.length - 1));
    const Y = v => padT + (1 - (v - mn) / (mx - mn)) * (H - padT - padB);
    let grid = ''; for (let g = 0; g <= 3; g++) { const v = mn + (mx - mn) * g / 3, y = Y(v); grid += `<line class="fz-grid-line" x1="${padL}" x2="${W - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/><text class="fz-axis-label" x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end">${v.toFixed(2)}</text>`; }
    const d = pathOf(arr, X, Y); const area = d ? `${d} L${X(arr.length - 1)},${Y(mn)} L${X(0)},${Y(mn)} Z` : '';
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:auto">${grid}<path d="${area}" fill="${color}22"/><path d="${d}" fill="none" stroke="${color}" stroke-width="1.8"/></svg>`;
  }
  // grafico de velocidade com faixas ISO
  function velChart(arr) {
    const W = 700, H = 220, padL = 40, padR = 12, padT = 10, padB = 18;
    const mx = Math.max(6, ...arr, 6); const mn = 0;
    const X = i => padL + (arr.length < 2 ? 0 : i * (W - padL - padR) / (arr.length - 1));
    const Y = v => padT + (1 - (v - mn) / (mx - mn)) * (H - padT - padB);
    const band = (y0, y1, c) => `<rect x="${padL}" y="${Y(y1).toFixed(1)}" width="${W - padL - padR}" height="${(Y(y0) - Y(y1)).toFixed(1)}" fill="${c}" opacity="0.07"/>`;
    let grid = ''; for (let g = 0; g <= 4; g++) { const v = mn + (mx - mn) * g / 4, y = Y(v); grid += `<line class="fz-grid-line" x1="${padL}" x2="${W - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/><text class="fz-axis-label" x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end">${v.toFixed(0)}</text>`; }
    const [cOk, cW, cB] = COR();
    const thr = (v, c) => `<line x1="${padL}" x2="${W - padR}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="${c}" stroke-width="1" stroke-dasharray="3 3"/>`;
    const d = pathOf(arr, X, Y); const area = d ? `${d} L${X(arr.length - 1)},${Y(0)} L${X(0)},${Y(0)} Z` : '';
    const lastPt = arr.length ? `<circle cx="${X(arr.length - 1).toFixed(1)}" cy="${Y(arr[arr.length - 1]).toFixed(1)}" r="4" fill="${cols()[flagV(arr[arr.length - 1])]}" stroke="#fff" stroke-width="1.5"/>` : '';
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:auto">
      ${band(0, 1.8, cOk)}${band(1.8, 4.5, cW)}${band(4.5, mx, cB)}${grid}
      ${thr(1.8, cW)}${thr(4.5, cB)}
      <path d="${area}" fill="#3498db22"/><path d="${d}" fill="none" stroke="#3498db" stroke-width="2"/>${lastPt}</svg>`;
  }
  // colunas de dados do grafico
  const cols = () => COR();
  // grafico dos tres eixos
  function xyzChart() {
    const W = 700, H = 180, padL = 40, padR = 12, padT = 10, padB = 18;
    const ax = smooth(st.hist.map(h => h.AX || 0), 5), ay = smooth(st.hist.map(h => h.AY || 0), 5), az = smooth(st.hist.map(h => h.AZ || 0), 5);
    const [mn, mx] = scaleY(ax.concat(ay, az));
    const X = i => padL + (ax.length < 2 ? 0 : i * (W - padL - padR) / (ax.length - 1));
    const Y = v => padT + (1 - (v - mn) / (mx - mn)) * (H - padT - padB);
    let grid = ''; for (let g = 0; g <= 3; g++) { const v = mn + (mx - mn) * g / 3, y = Y(v); grid += `<line class="fz-grid-line" x1="${padL}" x2="${W - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`; }
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:auto">${grid}
      <path d="${pathOf(ax, X, Y)}" fill="none" stroke="#e74c3c" stroke-width="1.4"/>
      <path d="${pathOf(ay, X, Y)}" fill="none" stroke="#2ecc71" stroke-width="1.4"/>
      <path d="${pathOf(az, X, Y)}" fill="none" stroke="#3498db" stroke-width="1.4"/></svg>`;
  }

  // liga ou desliga o bridge
  function toggleBridge() {
    if (st.bridge.connected) { stopBridge(); renderConfig(); renderCards(); return; }
    startBridge();
  }
  // conecta ao bridge Python
  function startBridge() {
    if (st.bridge.timer) clearInterval(st.bridge.timer);
    st.bridge.connected = false; st.bridge.rxCount = 0;
    st.hist = []; st.modo = 'real';
    renderConfig(); renderCards(); renderLive();
    st.bridge.timer = setInterval(pollBridge, 1000);
    pollBridge();
  }
  // desconecta do bridge
  function stopBridge() {
    if (st.bridge.timer) { clearInterval(st.bridge.timer); st.bridge.timer = null; }
    st.bridge.connected = false;
  }
  // busca a ultima leitura no bridge
  async function pollBridge() {
    try {
      const r = await fetch(BRIDGE_URL, { signal: AbortSignal.timeout(2000) });
      const j = await r.json();
      if (j.status !== 'online' || !j.data || !j.ts) {
        if (st.bridge.connected) { st.bridge.connected = false; renderCards(); }
        return;
      }
      if (j.ts === st.bridge.lastTs) return;
      st.bridge.lastTs = j.ts;
      st.bridge.connected = true;
      st.bridge.rxCount = (st.bridge.rxCount || 0) + 1;
      const d = j.data;
      const AX = +d.ax_rms, AY = +d.ay_rms, AZ = +d.az_rms;
      const arms = d.mag_rms != null ? +d.mag_rms : Math.sqrt(AX*AX + AY*AY + AZ*AZ);
      const freq = (d.freq_hz && d.freq_hz > 0.5) ? +d.freq_hz : 50.0;
      const vel  = arms * 9806.65 / (2 * Math.PI * freq);
      const apeak = Math.sqrt(AX*AX + AY*AY + AZ*AZ);
      const temp  = d.temp_c != null ? +d.temp_c : 0;
      push({ vel: +vel.toFixed(4), apeak: +apeak.toFixed(4), arms: +arms.toFixed(4), temp: +temp.toFixed(2), flag: flagV(vel), AX, AY, AZ });
      if (S && ativoGravavel(st.ativo)) {
        S.insertLeitura(st.ativo, { fonte: 'esp32', vibracao_mm_s: +vel.toFixed(4), apeak_g: +apeak.toFixed(4), ax_rms: AX, ay_rms: AY, az_rms: AZ, mag_rms: +arms.toFixed(4), flag_anomalia: flagV(vel), coletado_em: new Date().toISOString() });
        st.savedCount = (st.savedCount || 0) + 1;
      }
      renderCards();
    } catch (e) {
      if (st.bridge.connected) { st.bridge.connected = false; renderCards(); }
    }
  }

  // gera leitura simulada
  function stepSim() {
    st.simT += 2;
    const base = 1.1 + 0.9 * Math.sin(st.simT / 30);
    const vel = Math.max(0.02, base + gauss(0, 0.12));
    const apeak = vel * 0.085 + gauss(0, 0.003);
    const arms = apeak * 0.63;
    const temp = 38 + vel * 1.5 + gauss(0, 0.8);
    push({ vel, apeak, arms, temp, flag: flagV(vel) });
  }
  let _flagAnterior = 0;
  // toda leitura passa por aqui (grava e checa alarme)
  function push(r) {
    st.hist.push(r);
    if (st.hist.length > 150) st.hist = st.hist.slice(-150);

    if (r.flag > _flagAnterior) {
      if (window.FZAssistant && typeof window.FZAssistant.alertarIoT === 'function') {
        window.FZAssistant.alertarIoT({ vel: r.vel, temp: r.temp, flag: r.flag, arms: r.arms });
      }
    }

    if (r.flag === 0 && _flagAnterior > 0) {
      if (window.FZAssistant) window.FZAssistant.resetarAlertaIoT();
    }
    _flagAnterior = r.flag;
  }

  // abre a porta serial
  async function openPort(port, autoReconnect = false) {
    if (st.serial.connected) return true;
    try {
      st.serial.port = port;
      try {
        await port.open({ baudRate: st.baud, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
      } catch (e1) {
        if (e1 && e1.message && e1.message.includes('already open')) {
          console.warn('[IoT ESP32] porta já aberta — fechando e reabrindo...');
          try { await port.close(); } catch (_) {}
          await new Promise(r => setTimeout(r, 400));
          await port.open({ baudRate: st.baud, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
        } else { throw e1; }
      }

      // evita que abrir a porta serial reinicie o ESP32-CAM
      // REVISAR (Joao): testar na placa real se ainda reinicia
      try { await port.setSignals({ dataTerminalReady: false, requestToSend: false }); } catch (_) {}
      await new Promise(r => setTimeout(r, 300));

      if (!port.readable) {
        console.log('[IoT ESP32] porta fechou após open — aguardando connect event...');
        return true;
      }

      console.log('[IoT ESP32] porta aberta sem reset — iniciando leitura...');
      st.serial.connected = true; st.serial.status = 'online'; st.serial.buf = []; st.serial.lastError = null;
      st.serial.rxCount = 0; st.serial.rxBad = 0;
      if (st.modo !== 'real') st.hist = [];
      st.modo = 'real';
      renderConfig(); renderCards(); renderLive();
      readLoop();
      return true;
    } catch (e) {
      console.error('[IoT ESP32] falha ao abrir a porta serial:', e);
      st.serial.status = 'idle'; st.serial.lastError = (e && e.message) || String(e);
      st.serial.port = null;
      renderCards();
      return false;
    }
  }
  // conecta ou desconecta a serial
  async function toggleSerial() {
    if (st.serial.connected) { await disconnectSerial(); renderConfig(); renderCards(); return; }
    if (!st.serial.supported) { st.serial.status = 'unsupported'; renderCards(); return; }
    st.serial.lastError = null;
    let port;
    try { port = await navigator.serial.requestPort(); }
    catch (e) {
      console.error('[IoT ESP32] seleção de porta cancelada/negada:', e);
      st.serial.status = 'idle'; st.serial.lastError = (e && e.message) || String(e);
      renderCards(); return;
    }
    await openPort(port);
  }

  // tenta reconectar a porta ja autorizada
  async function autoConnect() {
    if (!st.serial.supported || st.serial.connected) return;
    try {
      const ports = await navigator.serial.getPorts();
      if (ports.length) await openPort(ports[0]);
    } catch (e) { console.error('[IoT ESP32] autoConnect falhou:', e); }
  }
  // desconecta a serial
  async function disconnectSerial() {
    st.serial.connected = false;
    try { if (st.serial.reader) await st.serial.reader.cancel(); } catch (e) {}

    try { if (st.serial.port && st.serial.port.readable && !st.serial.port.readable.locked)
      st.serial.reader && st.serial.reader.releaseLock(); } catch (e) {}
    try { if (st.serial.port) await st.serial.port.close(); } catch (e) {}
    st.serial.port = null; st.serial.reader = null;
  }
  // le a serial em loop
  async function readLoop() {
    const decoder = new TextDecoder();
    const readable = st.serial.port.readable;
    console.log('[IoT ESP32] port.readable:', readable ? (readable.locked ? 'LOCKED (travado!)' : 'ok, livre') : 'NULL (erro!)');
    let reader;
    try {
      reader = readable.getReader();
    } catch (e) {
      console.error('[IoT ESP32] não foi possível obter reader:', e);
      st.serial.connected = false; st.serial.lastError = e.message; renderCards();
      return;
    }
    st.serial.reader = reader;
    console.log('[IoT ESP32] readLoop iniciado, aguardando dados...');
    let line = '';
    let needsReconnect = false;
    try {
      while (st.serial.connected) {
        const { value, done } = await reader.read();
        if (done) {

          needsReconnect = true;
          console.log('[IoT ESP32] stream encerrado (done=true) — aguardando boot ESP32 e reconectando...');
          break;
        }
        const chunk = decoder.decode(value, { stream: true });
        line += chunk;
        let nl;
        while ((nl = line.indexOf('\n')) >= 0) {
          parseLine(line.slice(0, nl));
          line = line.slice(nl + 1);
        }
      }
    } catch (e) {
      if (e && e.message && (e.message.includes('device has been lost') || e.message.includes('device disconnected'))) {
        needsReconnect = true;
        console.log('[IoT ESP32] device lost — aguardando boot ESP32 e reconectando...');
      } else if (st.serial.connected) {
        console.error('[IoT ESP32] erro na leitura:', e);
      }
    } finally {
      try { reader.releaseLock(); } catch (_) {}
      st.serial.reader = null;

      if (st.serial.connected) { st.serial.connected = false; renderCards(); }
      if (needsReconnect) console.log('[IoT ESP32] aguardando ESP32 reconectar (connect event)...');
    }
  }
  // converte uma linha JSON da serial em leitura
  function parseLine(s) {
    s = s.trim();
    if (!s) return;
    st.serial.rxCount = (st.serial.rxCount || 0) + 1;
    if (st.serial.rxCount <= 20 || st.serial.rxCount % 25 === 0) console.log('[IoT ESP32] linha recebida #' + st.serial.rxCount + ':', s);
    if (!s.startsWith('{')) { st.serial.rxBad = (st.serial.rxBad || 0) + 1; return; }
    let d; try { d = JSON.parse(s); } catch (e) { st.serial.rxBad = (st.serial.rxBad || 0) + 1; console.warn('[IoT ESP32] JSON inválido:', s, e.message); return; }
    if (d.error) { console.warn('[IoT ESP32] firmware reportou erro:', d.error); return; }
    if (d.ax_rms == null || d.ay_rms == null || d.az_rms == null) { st.serial.rxBad = (st.serial.rxBad || 0) + 1; console.warn('[IoT ESP32] JSON sem ax_rms/ay_rms/az_rms:', d); return; }
    const AX = +d.ax_rms, AY = +d.ay_rms, AZ = +d.az_rms;
    const arms = d.mag_rms != null ? +d.mag_rms : Math.sqrt(AX * AX + AY * AY + AZ * AZ);

    const freq = (d.freq_hz && d.freq_hz > 0.5) ? +d.freq_hz : 50.0;
    const vel = arms * 9806.65 / (2 * Math.PI * freq);
    const apeak = Math.sqrt(AX * AX + AY * AY + AZ * AZ);
    const temp = d.temp_c != null ? +d.temp_c : 0;
    push({ vel: +vel.toFixed(4), apeak: +apeak.toFixed(4), arms: +arms.toFixed(4), temp: +temp.toFixed(2), flag: flagV(vel), AX, AY, AZ });

    if (S && ativoGravavel(st.ativo)) {
      S.insertLeitura(st.ativo, { fonte: 'esp32', vibracao_mm_s: +vel.toFixed(4), apeak_g: +apeak.toFixed(4), ax_rms: AX, ay_rms: AY, az_rms: AZ, mag_rms: +arms.toFixed(4), flag_anomalia: flagV(vel), coletado_em: new Date().toISOString() });
      st.savedCount = (st.savedCount || 0) + 1;
      if (st.savedCount % 10 === 0) renderCards();
    }
  }

  // ajuda de conexao
  function renderHelp() {
    const h = el('iotHelp'); if (!h) return;
    h.innerHTML = `<summary>Como conectar o hardware real</summary>
      <div style="font-size:13px;color:var(--text-2);line-height:1.7;margin-top:8px">
        <b>1.</b> Instale o driver USB-Serial (CP210x ou CH340).<br>
        <b>2.</b> Grave o firmware <code>firmware/esp32_mpu6050_rms</code> no ESP32 (MPU6050 em I2C: SDA→GPIO21, SCL→GPIO22).<br>
        <b>3.</b> <b>Feche o Arduino IDE / Serial Monitor</b> (só um programa por vez pode usar a porta COM).<br>
        <b>4.</b> Selecione <b>ESP32 Real</b> e clique <b>Conectar ESP32</b> — o navegador pede a porta (só na 1ª vez).<br>
        <b>5.</b> A partir daí é <b>plug-and-play</b>: basta plugar o ESP (ou abrir a página com ele plugado) que ele reconecta e começa a contar sozinho — sem clique, sem Arduino IDE.<br>
        <span style="color:var(--text-3)">Requer Chrome/Edge em http://localhost. Em navegador sem Web Serial use o modo Simulação.</span>
      </div>`;
  }

  // tenta conectar ao bridge sozinho
  async function tryAutoBridge() {
    if (st.bridge.connected || st.bridge.timer) return;
    try {
      const r = await fetch(BRIDGE_URL, { signal: AbortSignal.timeout(1500) });
      const j = await r.json();
      if (j.status === 'online') {

        st.modo = 'real';
        startBridge();
      }
    } catch (_) {

    }
  }

  // true se a tela IoT esta aberta
  const iotOn = () => document.getElementById('screen-iot').classList.contains('active');
  // ciclo de atualizacao da tela
  function tick() {
    if (!iotOn()) return;
    if (st.modo === 'sim') stepSim();
    else if (st.modo === 'cloud') {
      if (Date.now() - (st.cloud.lastFetch || 0) > 60000) { st.cloud.lastFetch = Date.now(); loadCloudLog(); }
      return;
    }
    if (!st.bridge.connected || st.modo === 'sim') renderLive();
  }

  // liga a tela (roda so na primeira visita)
  function init() {
    if (!el('iotConfig')) return;
    renderConfig(); renderCards(); renderHelp();

    for (let i = 0; i < 30; i++) stepSim();
    renderLive();
    st.timer = setInterval(tick, 2000);

    tryAutoBridge();

    loadCloudLog();

    if (st.serial.supported) {
      navigator.serial.addEventListener('connect', e => { openPort(e.target, true); });
      navigator.serial.addEventListener('disconnect', async () => {
        if (!st.serial.connected && st.serial.port) { renderConfig(); renderCards(); }
      });
      autoConnect();
    }
  }

  window.FZIoT = {
    isConnected: () => st.serial.connected || st.bridge.connected,
    getHist:     () => st.hist,
    getLast:     () => st.hist.length ? st.hist[st.hist.length - 1] : null,
  };

  window.FZCloud = {
    isLoaded: () => !!st.cloud.rows.length,
    getRows:  sensor => sensor ? st.cloud.rows.filter(r => r.sensor === sensor) : st.cloud.rows,
    getLast:  sensor => { const rs = st.cloud.rows.filter(r => r.sensor === sensor); return rs.length ? rs[rs.length - 1] : null; },
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
