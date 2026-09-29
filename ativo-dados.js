/* ativo-dados.js: liga os dados de um motor real ao ativo (endpoint + CSV) e treina o modelo dele no navegador */

(function () {
  const S = window.FZStore;
  if (!S) return;

  const KEY_CFG = 'fz-ativo-dados-v1';      // endpoint e intervalo de cada ativo
  const KEY_MODELO = 'fz-ativo-modelo-v1';  // modelo treinado de cada ativo
  const MIN_TREINO = 200;                   // minimo de leituras pra treinar
  const MAX_IMPORT = 5000;                  // limite de linhas de um CSV (o localStorage e pequeno)

  // protege o texto contra HTML/XSS antes de ir pro innerHTML
  const esc = s => (s == null ? '' : String(s)).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // le um JSON guardado no navegador
  const ler = (k) => { try { return JSON.parse(localStorage.getItem(k) || '{}') || {}; } catch (_) { return {}; } };
  // grava um JSON no navegador
  const gravar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (_) { return false; } };
  const cfgDe = cod => ler(KEY_CFG)[cod] || {};
  const salvaCfg = (cod, dados) => { const t = ler(KEY_CFG); t[cod] = { ...(t[cod] || {}), ...dados }; gravar(KEY_CFG, t); };
  const modeloDe = cod => ler(KEY_MODELO)[cod] || null;

  // ------------------------------------------------------------------ leitura dos campos
  // acha o valor de velocidade / aceleracao / temperatura em um objeto, aceitando varios nomes
  const NOMES = {
    vel:  /^(vel|velocidade|vibracao|vibracao_mm_s|vel_rms|velocity|m1_vel)/,
    acel: /^(acel|aceleracao|accel|apeak|apeak_g|mag_rms|arms|m1_acel)/,
    temp: /^(temp|temperatura|temperature|temp_c|temperatura_c|m1_temp)/,
    ts:   /^(time|timestamp|data|datahora|coletado)/,
  };
  const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9_]/g, '_');
  const num = v => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : NaN; };

  // procura, num JSON qualquer, o primeiro objeto que tenha vibracao/aceleracao/temperatura
  function achaLeitura(o, prof = 0) {
    if (o == null || prof > 4) return null;
    if (Array.isArray(o)) { for (let i = o.length - 1; i >= 0; i--) { const r = achaLeitura(o[i], prof + 1); if (r) return r; } return null; }
    if (typeof o !== 'object') return null;
    const r = {};
    Object.keys(o).forEach(k => { const nk = norm(k);
      for (const c of ['vel', 'acel', 'temp', 'ts']) if (r[c] == null && NOMES[c].test(nk)) r[c] = o[k]; });
    if (r.vel != null || r.temp != null) return r;
    for (const k of Object.keys(o)) { const s = achaLeitura(o[k], prof + 1); if (s) return s; }
    return null;
  }

  // grava uma leitura no formato que o resto do site entende (Monitoramento e alarmes)
  function gravaLeitura(cod, vel, acel, temp, quando, fonte) {
    return { fonte, coletado_em: quando, vibracao_mm_s: vel, vel_rms: vel, mag_rms: acel, apeak_g: acel,
             temperatura_c: temp, temp_c: temp, flag_anomalia: vel >= 4.5 ? 2 : vel >= 1.8 ? 1 : 0 };
  }

  // ------------------------------------------------------------------ CSV
  // converte o texto do CSV em leituras {vel, acel, temp, ts}
  function lerCsv(texto) {
    const linhas = texto.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    if (linhas.length < 2) return { erro: 'O arquivo precisa ter um cabeçalho e ao menos uma linha de dados.' };
    const sep = (linhas[0].match(/;/g) || []).length >= (linhas[0].match(/,/g) || []).length ? ';' : ',';
    const cab = linhas[0].split(sep).map(norm);
    const col = re => cab.findIndex(c => re.test(c));
    const iVel = col(NOMES.vel), iAcel = col(NOMES.acel), iTemp = col(NOMES.temp), iTs = col(NOMES.ts);
    const iSensor = cab.indexOf('sensor');
    if (iVel < 0 || iTemp < 0) return { erro: 'Não achei as colunas de velocidade e temperatura. Cabeçalhos aceitos: velocidade (ou vel, vibracao), aceleracao (opcional), temperatura (ou temp).' };
    let sensor = null;
    const out = [];
    for (let i = 1; i < linhas.length; i++) {
      const c = linhas[i].split(sep);
      if (iSensor >= 0) { if (sensor == null) sensor = c[iSensor]; if (c[iSensor] !== sensor) continue; }
      const vel = num(c[iVel]), temp = num(c[iTemp]);
      const acel = iAcel >= 0 ? num(c[iAcel]) : NaN;
      if (!Number.isFinite(vel) || !Number.isFinite(temp)) continue;
      let ts = iTs >= 0 ? new Date(c[iTs]).getTime() : NaN;
      out.push({ vel, acel: Number.isFinite(acel) ? acel : vel * 0.035, temp, ts });
    }
    if (!out.length) return { erro: 'Nenhuma linha válida (velocidade e temperatura numéricas).' };
    let dados = out;
    if (dados.length > MAX_IMPORT) { const passo = dados.length / MAX_IMPORT; dados = Array.from({ length: MAX_IMPORT }, (_, k) => out[Math.floor(k * passo)]); }
    // sem data no arquivo: espaca 1 s e termina agora
    const agora = Date.now();
    dados.forEach((d, i) => { if (!Number.isFinite(d.ts)) d.ts = agora - (dados.length - 1 - i) * 1000; });
    return { dados, total: out.length, sensor, semAcel: iAcel < 0 };
  }

  // ------------------------------------------------------------------ rede neural (treina no navegador)
  // mesma ideia do treinar_modelo.py: autoencoder que aprende o "normal" do motor
  // entradas: velocidade, aceleracao, temperatura  ->  3 - 6 - 2 - 6 - 3
  const DIMS = [3, 6, 2, 6, 3];
  const sig = x => 1 / (1 + Math.exp(-x));

  // gerador pseudo-aleatorio com semente (resultado repetivel)
  function semente(s) { return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  // percentil de uma lista
  function pct(arr, p) { const a = arr.slice().sort((x, y) => x - y); const i = (a.length - 1) * p; const lo = Math.floor(i), hi = Math.ceil(i); return a[lo] + (a[hi] - a[lo]) * (i - lo); }

  function novaRede() {
    const r = semente(42), W = [], b = [];
    for (let l = 0; l < DIMS.length - 1; l++) {
      const i = DIMS[l], o = DIMS[l + 1], lim = Math.sqrt(6 / (i + o));
      W.push(Array.from({ length: o * i }, () => (r() * 2 - 1) * lim));
      b.push(new Array(o).fill(0));
    }
    return { W, b };
  }
  // passa uma entrada pela rede; guarda as ativacoes de cada camada
  function frente(m, x, acts) {
    let a = x; acts[0] = a;
    for (let l = 0; l < m.W.length; l++) {
      const i = DIMS[l], o = DIMS[l + 1], z = new Array(o);
      for (let j = 0; j < o; j++) { let s = m.b[l][j]; for (let k = 0; k < i; k++) s += m.W[l][j * i + k] * a[k]; z[j] = l === m.W.length - 1 ? sig(s) : Math.tanh(s); }
      a = z; acts[l + 1] = a;
    }
    return a;
  }
  const erroDe = (m, x) => { const y = frente(m, x, []); let e = 0; for (let k = 0; k < x.length; k++) e += (y[k] - x[k]) ** 2; return e / x.length; };

  // treina em pedacos (nao trava a tela) e avisa o progresso
  function treinar(brutos, onProg) {
    return new Promise(resolve => {
      const lo = [0, 1, 2].map(c => pct(brutos.map(x => x[c]), 0.005));
      const hi = [0, 1, 2].map((c, i) => Math.max(pct(brutos.map(x => x[c]), 0.995), lo[i] + 1e-9));
      const N = brutos.map(x => x.map((v, c) => (v - lo[c]) / (hi[c] - lo[c])));
      const r = semente(7), tr = [], va = [];
      N.forEach(x => (r() < 0.15 ? va : tr).push(x));
      const m = novaRede();
      const mA = m.W.map(w => new Array(w.length).fill(0)), vA = m.W.map(w => new Array(w.length).fill(0));
      const mB = m.b.map(w => new Array(w.length).fill(0)), vB = m.b.map(w => new Array(w.length).fill(0));
      const EPOCAS = 600, LR = 0.02; let ep = 0;
      const curva = [];   // erro de treino e de validacao ao longo das epocas (o grafico do processo)
      const amostra = (arr) => { const p = Math.max(1, Math.floor(arr.length / 300)); return arr.filter((_, i) => i % p === 0); };
      const msErro = (arr) => arr.reduce((t, x) => t + erroDe(m, x), 0) / Math.max(arr.length, 1);
      if (onProg) onProg({ fase: 'prep', n: brutos.length, treino: tr.length, val: va.length, lo, hi });
      const passo = () => {
        const fim = Math.min(ep + 30, EPOCAS);
        for (; ep < fim; ep++) {
          const gW = m.W.map(w => new Array(w.length).fill(0)), gB = m.b.map(w => new Array(w.length).fill(0));
          for (const x of tr) {
            const acts = []; const y = frente(m, x, acts);
            let d = y.map((v, k) => 2 * (v - x[k]) * v * (1 - v) / (tr.length * x.length));
            for (let l = m.W.length - 1; l >= 0; l--) {
              const i = DIMS[l], o = DIMS[l + 1], prev = acts[l], nd = new Array(i).fill(0);
              for (let j = 0; j < o; j++) { gB[l][j] += d[j]; for (let k = 0; k < i; k++) { gW[l][j * i + k] += d[j] * prev[k]; nd[k] += d[j] * m.W[l][j * i + k]; } }
              if (l > 0) d = nd.map((v, k) => v * (1 - prev[k] * prev[k]));
            }
          }
          const t = ep + 1, c1 = 1 - Math.pow(0.9, t), c2 = 1 - Math.pow(0.999, t);
          for (let l = 0; l < m.W.length; l++) {
            for (let k = 0; k < m.W[l].length; k++) { mA[l][k] = 0.9 * mA[l][k] + 0.1 * gW[l][k]; vA[l][k] = 0.999 * vA[l][k] + 0.001 * gW[l][k] ** 2; m.W[l][k] -= LR * (mA[l][k] / c1) / (Math.sqrt(vA[l][k] / c2) + 1e-8); }
            for (let k = 0; k < m.b[l].length; k++) { mB[l][k] = 0.9 * mB[l][k] + 0.1 * gB[l][k]; vB[l][k] = 0.999 * vB[l][k] + 0.001 * gB[l][k] ** 2; m.b[l][k] -= LR * (mB[l][k] / c1) / (Math.sqrt(vB[l][k] / c2) + 1e-8); }
          }
        }
        curva.push([ep, msErro(amostra(tr)), msErro(amostra(va))]);
        if (onProg) onProg({ fase: 'treino', ep, total: EPOCAS, tr: curva[curva.length - 1][1], va: curva[curva.length - 1][2], curva });
        if (ep < EPOCAS) return setTimeout(passo, 0);
        if (onProg) onProg({ fase: 'calibra' });
        const erros = N.map(x => erroDe(m, x));
        const p95 = Math.max(pct(erros, 0.95), 1e-9), p995 = Math.max(pct(erros, 0.995), p95 * 1.01);
        const mse = a => a.reduce((s, x) => s + erroDe(m, x), 0) / Math.max(a.length, 1);
        resolve({ W: m.W, b: m.b, lo, hi, p95, p995, n: brutos.length, mseTreino: mse(tr), mseVal: mse(va), em: new Date().toISOString(),
          epocas: EPOCAS, nTreino: tr.length, nVal: va.length, curva });
      };
      passo();
    });
  }

  // grafico da curva de erro (treino x validacao) em SVG; eixo Y em escala log pra enxergar a queda
  function curvaSvg(curva) {
    if (!curva || curva.length < 2) return '';
    const W = 520, H = 130, pad = 6;
    const ys = curva.flatMap(c => [c[1], c[2]]).filter(v => v > 0).map(Math.log10);
    const mn = Math.min(...ys), mx = Math.max(...ys), fim = curva[curva.length - 1][0] || 1;
    const X = e => pad + (e / fim) * (W - 2 * pad);
    const Y = v => pad + (1 - (Math.log10(Math.max(v, 1e-12)) - mn) / Math.max(mx - mn, 1e-9)) * (H - 2 * pad);
    const linha = (i, cor) => '<path fill="none" stroke="' + cor + '" stroke-width="2" d="' + curva.map((c, k) => (k ? 'L' : 'M') + X(c[0]).toFixed(1) + ',' + Y(c[i]).toFixed(1)).join(' ') + '"/>';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:130px;background:var(--field);border-radius:10px" preserveAspectRatio="none">' + linha(1, 'var(--teal)') + linha(2, 'var(--fz-warn)') + '</svg>'
      + '<div style="display:flex;gap:16px;font-size:11px;color:var(--text-2);margin-top:4px"><span style="color:var(--teal)">— erro de treino</span><span style="color:var(--fz-warn)">— erro de validação</span><span style="margin-left:auto">épocas 0 → ' + fim + ' (escala log: quanto mais baixo, melhor)</span></div>';
  }

  // avalia uma leitura {vel, acel, temp} com o modelo treinado do ativo
  // devolve o indice de anomalia (1,00 = limite de atencao) e o nivel; o piso da norma ISO nunca e rebaixado
  function avaliar(cod, leitura) {
    const md = modeloDe(cod);
    const vel = +leitura.vel, temp = +leitura.temp, acel = Number.isFinite(+leitura.acel) ? +leitura.acel : vel * 0.035;
    const norma = vel >= 4.5 || temp >= 42 ? 2 : vel >= 1.8 || temp >= 35 ? 1 : 0;
    if (!md || !Number.isFinite(vel) || !Number.isFinite(temp)) return { ok: false, nivel: norma, nivelNorma: norma };
    const x = [vel, acel, temp].map((v, c) => (v - md.lo[c]) / (md.hi[c] - md.lo[c]));
    const indice = erroDe({ W: md.W, b: md.b }, x) / md.p95;
    const rede = indice >= md.p995 / md.p95 ? 2 : indice >= 1 ? 1 : 0;
    return { ok: true, indice, nivelRede: rede, nivelNorma: norma, nivel: Math.max(rede, norma) };
  }

  // ------------------------------------------------------------------ endpoint
  const timers = {};   // uma coleta automatica por ativo (enquanto o site estiver aberto)
  // busca uma leitura no endpoint (falha com CORS = erro de rede do navegador)
  async function buscaEndpoint(url) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    try {
      const r = await fetch(url, { signal: ctl.signal, headers: { 'ngrok-skip-browser-warning': '1' } });
      if (!r.ok) return { erro: 'O endpoint respondeu HTTP ' + r.status + '.' };
      let j; try { j = await r.json(); } catch (_) { return { erro: 'A resposta não é JSON.' }; }
      const l = achaLeitura(j);
      if (!l) return { erro: 'Não achei velocidade/temperatura no JSON recebido.' };
      const vel = num(l.vel), temp = num(l.temp), acel = num(l.acel);
      if (!Number.isFinite(vel) || !Number.isFinite(temp)) return { erro: 'Os valores de velocidade/temperatura não são numéricos.' };
      return { vel, temp, acel: Number.isFinite(acel) ? acel : vel * 0.035, bruto: j };
    } catch (e) {
      return { bloqueado: true, erro: e && e.name === 'AbortError' ? 'O endpoint não respondeu em 8 segundos.' : 'O navegador não conseguiu ler o endpoint (provavelmente bloqueio de CORS, ou o endereço está fora do ar).' };
    } finally { clearTimeout(t); }
  }
  // liga ou desliga a gravacao automatica de um ativo
  function coleta(cod, ligar) {
    if (timers[cod]) { clearInterval(timers[cod]); delete timers[cod]; }
    salvaCfg(cod, { auto: !!ligar });
    if (!ligar) return;
    const cfg = cfgDe(cod); if (!cfg.endpoint) return;
    const tick = async () => {
      const r = await buscaEndpoint(cfg.endpoint);
      if (r.vel != null) S.insertLeitura(cod, gravaLeitura(cod, r.vel, r.acel, r.temp, new Date().toISOString(), 'endpoint'));
    };
    tick();
    timers[cod] = setInterval(tick, Math.max(2, +cfg.intervalo || 10) * 1000);
  }

  // ------------------------------------------------------------------ tela (card no cadastro do ativo)
  function montar(host, cod) {
    if (!host) return;
    const a = S.getAtivoPorCodigo(cod); if (!a) { host.innerHTML = ''; return; }
    const cfg = cfgDe(cod), md = modeloDe(cod);
    const n = S.getLeituras(cod, 6000).length;
    const ultima = S.getLeituras(cod, 1)[0];
    const av = ultima && md ? avaliar(cod, { vel: ultima.vibracao_mm_s, acel: ultima.mag_rms, temp: ultima.temperatura_c }) : null;
    const ROT = ['Normal', 'Atenção', 'Crítico'], COR = ['var(--fz-ok)', 'var(--fz-warn)', 'var(--fz-bad)'];

    host.innerHTML = `<div class="fz-card" style="margin-top:16px">
      <div class="fz-card-title">Dados do motor e aprendizado do modelo</div>
      <div class="fz-card-sub">Siga os 3 passos: conecte a fonte de dados, envie o histórico e treine o modelo deste motor (${esc(cod)}).</div>

      <div class="fz-section-label">1 · Endpoint de dados (leitura contínua)</div>
      <div class="fz-form">
        <div class="fld col2"><label>URL do endpoint (GET, resposta em JSON)</label>
          <input class="fz-input" id="adUrl" value="${esc(cfg.endpoint || '')}" placeholder="https://servidor-da-forzy/get_s1"></div>
        <div class="fld"><label>Gravar a cada (segundos)</label><input class="fz-input" id="adInt" type="number" min="2" value="${+cfg.intervalo || 10}"></div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;align-items:center">
        <button class="fz-btn" id="adTestar">Testar conexão</button>
        <label class="fz-toggle ${timers[cod] ? 'on' : ''}" id="adAuto"><span class="sw"></span><span>Gravar automaticamente (com o site aberto)</span></label>
      </div>
      <div id="adMsgUrl" style="margin-top:10px"></div>

      <div class="fz-section-label" style="margin-top:20px">2 · Histórico em CSV (para o modelo aprender)</div>
      <div class="fz-card-sub">Envie um período em que o motor estava <b>funcionando bem</b>: o modelo aprende esse comportamento como o normal. Colunas aceitas: timestamp (opcional), velocidade, aceleracao (opcional) e temperatura.</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <button class="fz-btn ghost" id="adCsvBtn">Enviar CSV do motor</button>
        <input type="file" id="adCsv" accept=".csv,text/csv,.txt" style="display:none">
        <button class="fz-btn ghost" id="adModelo">Baixar CSV de exemplo</button>
        <span style="font-size:12px;color:var(--text-2)">${n} leitura(s) deste ativo já gravada(s)</span>
      </div>
      <div id="adMsgCsv" style="margin-top:10px"></div>

      <div class="fz-section-label" style="margin-top:20px">3 · Modelo do motor</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
        <button class="fz-btn" id="adTreinar" ${n < MIN_TREINO ? 'disabled' : ''}>${md ? 'Treinar de novo' : 'Treinar modelo'}</button>
        <span style="font-size:12px;color:var(--text-2)">${n < MIN_TREINO ? 'Precisa de pelo menos ' + MIN_TREINO + ' leituras (faltam ' + (MIN_TREINO - n) + ').' : 'Usa as ' + Math.min(n, 6000) + ' leituras gravadas deste ativo.'}</span>
      </div>
      <div id="adProc" style="display:none;margin-top:14px"></div>
      <div id="adMsgModelo" style="margin-top:10px">${md ? statusModelo(md, av, ROT, COR) : '<span style="color:var(--text-2);font-size:13px">Ainda sem modelo treinado para este ativo.</span>'}</div>
    </div>`;

    const $ = id => host.querySelector('#' + id);
    const msg = (id, txt, ok) => { $(id).innerHTML = `<div class="fz-feedback ${ok ? 'ok' : 'bad'}">${txt}</div>`; };
    const salvaUrl = () => salvaCfg(cod, { endpoint: $('adUrl').value.trim(), intervalo: +$('adInt').value || 10 });

    // testa o endpoint; se o navegador bloquear, mostra as alternativas
    $('adTestar').addEventListener('click', async () => {
      salvaUrl(); const url = $('adUrl').value.trim();
      if (!/^https?:\/\//i.test(url)) return msg('adMsgUrl', 'Informe uma URL começando com http:// ou https://', false);
      $('adMsgUrl').innerHTML = '<span style="font-size:13px;color:var(--text-2)">Testando…</span>';
      const r = await buscaEndpoint(url);
      if (r.vel != null) return msg('adMsgUrl', `Conectado. Leitura recebida: velocidade <b>${r.vel.toFixed(3)}</b> mm/s · temperatura <b>${r.temp.toFixed(1)}</b> °C. Ligue “Gravar automaticamente” para guardar as leituras.`, true);
      if (!r.bloqueado) return msg('adMsgUrl', esc(r.erro), false);
      $('adMsgUrl').innerHTML = `<div class="fz-feedback bad">${esc(r.erro)}</div>
        <div class="fz-card-sub" style="margin-top:10px"><b>Alternativas (escolha uma):</b><br>
        <b>A) Liberar o acesso no servidor</b> — peça à Forzy para responder com o cabeçalho <code>Access-Control-Allow-Origin: *</code> (no Flask: <code>pip install flask-cors</code> e <code>CORS(app)</code>). Depois é só testar de novo.<br>
        <b>B) Usar o coletor do projeto</b> — no <code>daily_bridge.py</code>, coloque esta URL em <code>BASE_URL</code> e rode o script; ele grava <code>dados/forzy_cloud_log.csv</code>. Depois envie esse arquivo no passo 2.<br>
        <b>C) Exportar o CSV do sistema deles</b> e enviar no passo 2, repetindo de tempos em tempos.</div>`;
    });
    $('adAuto').addEventListener('click', () => {
      salvaUrl(); if (!cfgDe(cod).endpoint) return msg('adMsgUrl', 'Informe e teste a URL antes de gravar.', false);
      coleta(cod, !timers[cod]); montar(host, cod);
    });

    $('adModelo').addEventListener('click', () => {
      const csv = 'timestamp;velocidade_mm_s;aceleracao_g;temperatura_c\n2026-01-01T08:00:00;0.82;0.029;31.4\n2026-01-01T08:00:10;0.85;0.030;31.5\n2026-01-01T08:00:20;0.80;0.028;31.5\n';
      const l = document.createElement('a'); l.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
      l.download = 'exemplo_dados_motor.csv'; l.click(); URL.revokeObjectURL(l.href);
    });
    $('adCsvBtn').addEventListener('click', () => $('adCsv').click());
    $('adCsv').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      const r = lerCsv(await f.text());
      if (r.erro) return msg('adMsgCsv', esc(r.erro), false);
      const lote = r.dados.map(d => gravaLeitura(cod, d.vel, d.acel, d.temp, new Date(d.ts).toISOString(), 'csv'));
      S.insertLeituras(cod, lote);
      msg('adMsgCsv', `${lote.length} leituras importadas${r.total > lote.length ? ' (de ' + r.total + ', reduzidas para caber no navegador)' : ''}${r.sensor ? ' · sensor ' + esc(r.sensor) : ''}${r.semAcel ? ' · sem coluna de aceleração (estimada pela velocidade)' : ''}. Agora treine o modelo no passo 3.`, true);
      setTimeout(() => montar(host, cod), 1500);
    });

    $('adTreinar').addEventListener('click', async () => {
      const ls = S.getLeituras(cod, 6000).slice().reverse();
      const X = ls.map(l => [+l.vibracao_mm_s, Number.isFinite(+l.mag_rms) ? +l.mag_rms : +l.vibracao_mm_s * 0.035, +l.temperatura_c]).filter(x => x.every(Number.isFinite));
      if (X.length < MIN_TREINO) return msg('adMsgModelo', 'Leituras insuficientes.', false);
      $('adTreinar').disabled = true; $('adProc').style.display = 'block';
      const ET = ['Preparar os dados', 'Treinar a rede', 'Calibrar os limites de alerta'];
      const etapas = (atual, extra) => ET.map((t, i) => '<div style="display:flex;gap:8px;align-items:center;font-size:13px;color:' + (i < atual ? 'var(--fz-ok)' : i === atual ? 'var(--text)' : 'var(--text-3)') + '"><span style="width:16px">' + (i < atual ? '✓' : i === atual ? '●' : '○') + '</span>' + t + (i === atual && extra ? ' <span style="color:var(--text-2)">— ' + extra + '</span>' : '') + '</div>').join('');
      let ultima = null;
      const res = await treinar(X, p => {
        if (p.fase === 'prep') { ultima = p; $('adProc').innerHTML = etapas(0, p.n + ' leituras · ' + p.treino + ' treino / ' + p.val + ' validação'); }
        else if (p.fase === 'treino') {
          const pc = (p.ep / p.total * 100).toFixed(0);
          $('adProc').innerHTML = etapas(1, 'época ' + p.ep + '/' + p.total + ' · erro treino ' + p.tr.toFixed(5) + ' · validação ' + p.va.toFixed(5))
            + '<div style="height:8px;background:var(--field);border-radius:6px;overflow:hidden;margin:10px 0"><div style="height:100%;width:' + pc + '%;background:var(--teal)"></div></div>' + curvaSvg(p.curva);
        } else if (p.fase === 'calibra') { $('adProc').insertAdjacentHTML('afterbegin', '<div style="font-size:12px;color:var(--text-2);margin-bottom:6px">Calibrando os limites…</div>'); }
      });
      const t = ler(KEY_MODELO); t[cod] = res;
      if (!gravar(KEY_MODELO, t)) return msg('adMsgModelo', 'Não consegui salvar o modelo (armazenamento do navegador cheio).', false);
      if (window.FZAudit && window.FZAudit.push) { try { window.FZAudit.push({ acao: 'Treino de modelo', alvo: cod, detalhe: X.length + ' leituras' }); } catch (_) {} }
      montar(host, cod);
    });
  }

  // texto do estado do modelo treinado
  function statusModelo(md, av, ROT, COR) {
    const quando = new Date(md.em).toLocaleString('pt-BR');
    const linha = av && av.ok
      ? `<div style="margin-top:8px">Última leitura do motor: <b style="color:${COR[av.nivel]}">${ROT[av.nivel]}</b> · índice de anomalia ${av.indice.toFixed(2)} (1,00 = limite de atenção)</div>` : '';
    const nomes = ['Velocidade (mm/s)', 'Aceleração (g)', 'Temperatura (°C)'];
    const faixa = nomes.map((n, i) => '<tr><td>' + n + '</td><td>' + md.lo[i].toFixed(3) + '</td><td>' + md.hi[i].toFixed(3) + '</td></tr>').join('');
    return `<div class="fz-feedback ok">Modelo treinado em ${quando} com ${md.n} leituras · erro de treino ${md.mseTreino.toFixed(5)} · validação ${md.mseVal.toFixed(5)}${linha}</div>
      <details class="fz-details" open><summary>Como o modelo foi treinado</summary>
        <div class="fz-card-sub" style="margin-top:10px">
          <b>1. Dados:</b> ${md.n} leituras do motor, ${md.nTreino || '—'} para treinar e ${md.nVal || '—'} separadas para validar (a rede nunca vê essas).<br>
          <b>2. Normalização:</b> cada variável é colocada numa escala de 0 a 1 usando a faixa normal do motor:
          <table class="fz-table" style="margin:6px 0"><thead><tr><th>Variável</th><th>Mínimo normal</th><th>Máximo normal</th></tr></thead><tbody>${faixa}</tbody></table>
          <b>3. Rede:</b> autoencoder 3 → 6 → 2 → 6 → 3 (${DIMS.slice(0, -1).reduce((t, d, i) => t + d * DIMS[i + 1] + DIMS[i + 1], 0)} parâmetros), treinado por ${md.epocas || 600} épocas. Ela aprende a <i>reconstruir</i> o comportamento normal do motor.<br>
          <b>4. Limites:</b> o erro de reconstrução de cada leitura é comparado ao que a rede errou nos dados de treino. Índice 1,00 = atenção (percentil 95) e ${(md.p995 / md.p95).toFixed(2)} = crítico (percentil 99,5).<br>
          <b>5. Uso:</b> leitura que a rede não consegue reconstruir = combinação que nunca aconteceu nesse motor = anomalia.
        </div>
        ${md.curva ? curvaSvg(md.curva) : ''}
      </details>`;
  }

  // ao abrir o site, retoma a gravacao automatica dos ativos que estavam ligados
  function retomar() {
    const t = ler(KEY_CFG);
    Object.keys(t).forEach(cod => { if (t[cod].auto && t[cod].endpoint && S.getAtivoPorCodigo(cod)) coleta(cod, true); });
  }
  retomar();

  window.FZAtivoDados = { montar, avaliar, temModelo: cod => !!modeloDe(cod) };
})();
