/* fabrica.js: Fabrica Forzy simulada (setores e motores), ativo selecionado e seletor Fabrica > Setor > Motor */

(function () {
  const S = window.FZStore;
  if (!S) { console.error('fabrica.js: FZStore ausente'); return; }

  const KEY_SEL = 'fz-selecao-v1';
  const LIM = { velA: 1.8, velAl: 4.5, acelA: 0.25, acelAl: 0.45, tempA: 35, tempAl: 42 };
  const INTERVALO = 2000;   // um ponto novo a cada 2 s, sempre (a tela so desenha)
  const SEMENTES = 240;     // pontos de historico ja prontos ao abrir o site
  const MAX_HIST = 400;
  const NOME = ['NORMAL', 'ALERTA', 'ALARME'];

  // perfil de cada motor: [vel eixo1, vel eixo2, acel eixo1, acel eixo2, temp eixo1, temp eixo2, deriva por ponto]
  // deriva > 0 = o motor vai piorando devagar (alimenta a Projecao de Falha). Alguns ja nascem em alerta/alarme de proposito.
  // REVISAR (Vitor): ajustar os perfis se quiserem mostrar outro cenario na apresentacao
  const PERFIL = {
    'UTL-M1': [0.8, 0.9, 0.07, 0.08, 31, 32, 0],      'UTL-M2': [1.0, 1.1, 0.09, 0.09, 33, 33, 0],
    'UTL-M3': [1.4, 1.3, 0.10, 0.10, 34, 33, 0],
    'USI-M1': [2.9, 2.4, 0.19, 0.17, 37, 36, 0.0005], 'USI-M2': [0.7, 0.8, 0.06, 0.07, 30, 31, 0],
    'USI-M3': [0.9, 1.0, 0.08, 0.08, 32, 31, 0],
    'PIN-M1': [0.8, 0.7, 0.06, 0.06, 30, 30, 0],      'PIN-M2': [1.1, 1.0, 0.08, 0.09, 38.5, 37, 0.0003],
    'PIN-M3': [0.9, 0.9, 0.07, 0.07, 31, 31, 0],
    'MON-M1': [0.7, 0.8, 0.06, 0.07, 30, 30, 0],      'MON-M2': [1.9, 1.6, 0.31, 0.27, 34, 33, 0.0004],
    'MON-M3': [1.0, 1.1, 0.08, 0.09, 32, 32, 0],
    'EFL-M1': [0.9, 1.0, 0.07, 0.08, 31, 31, 0],      'EFL-M2': [5.2, 4.1, 0.52, 0.41, 44, 41, 0.0003],
    'EFL-M3': [1.2, 1.3, 0.10, 0.10, 33, 33, 0],
    'LOG-M1': [0.8, 0.9, 0.07, 0.07, 30, 30, 0],      'LOG-M2': [1.6, 1.5, 0.11, 0.11, 34, 33, 0],
    'LOG-M3': [1.0, 0.9, 0.08, 0.08, 31, 31, 0],
  };
  const PERFIL_PADRAO = [1, 1, 0.08, 0.08, 31, 31, 0];

  // ---------------------------------------------------------------- numeros aleatorios
  // gerador com semente (a mesma fabrica sempre abre igual)
  function rng(s) { return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  function gauss(r) { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  const rand = rng(777);

  // ---------------------------------------------------------------- cadastro (vem do FZStore)
  // setores e motores da Fabrica Forzy, na ordem do cadastro
  function setores() {
    const at = S.getAtivosIndustrial().filter(a => a.origem === 'demo');
    const nomes = [];
    at.forEach(a => { if (nomes.indexOf(a.area_nome) < 0) nomes.push(a.area_nome); });
    return nomes.map(n => ({
      nome: n,
      motores: at.filter(a => a.area_nome === n).sort((a, b) => a.codigo.localeCompare(b.codigo)),
    }));
  }
  const motoresDe = setor => setores().filter(s => !setor || s.nome === setor).flatMap(s => s.motores);
  const motorPorCodigo = cod => motoresDe().find(m => m.codigo === cod) || null;

  // ---------------------------------------------------------------- simulacao (roda sempre, em segundo plano)
  const hist = {};     // codigo -> lista de leituras (as mais novas no fim)
  const ultStatus = {};// codigo -> ultimo status, pra detectar mudanca
  const eventos = [];  // alertas e alarmes que aconteceram (mais novos primeiro)
  const ouvintes = [];
  let pontos = 0;

  const perfilDe = cod => PERFIL[cod] || PERFIL_PADRAO;
  // classifica: 0 normal, 1 alerta, 2 alarme
  const flag = (v, a, al) => (v >= al ? 2 : v >= a ? 1 : 0);
  // status de um eixo = o pior entre vibracao, aceleracao e temperatura
  function statusEixo(vel, acel, temp) {
    return Math.max(flag(vel, LIM.velA, LIM.velAl), flag(acel, LIM.acelA, LIM.acelAl), flag(temp, LIM.tempA, LIM.tempAl));
  }
  // status do motor = o pior dos 2 eixos
  function statusDe(r) {
    if (!r) return 0;
    return Math.max(statusEixo(r.m1_vel, r.m1_acel, r.m1_temp), statusEixo(r.m2_vel, r.m2_acel, r.m2_temp));
  }
  // saude de 0 a 100 (100 = sem desvio nenhum)
  function saudeDe(r) {
    if (!r) return 100;
    const tempRef = 28; // abaixo disso a temperatura nao pesa
    const sev = Math.max(r.m1_vel / LIM.velAl, r.m2_vel / LIM.velAl, r.m1_acel / LIM.acelAl, r.m2_acel / LIM.acelAl,
      (r.m1_temp - tempRef) / (LIM.tempAl - tempRef), (r.m2_temp - tempRef) / (LIM.tempAl - tempRef));
    return Math.round(100 - 92 * Math.min(1, Math.max(0, sev)) ** 1.6);
  }

  // gera uma leitura (2 eixos) do motor no ponto k da sua historia
  // quanto mais velho o ponto, menor a vibracao (so nos motores com deriva)
  function gerar(m, k, ts) {
    const p = perfilDe(m.codigo), nuvem = Date.now() / 20000;
    const fator = p[6] ? Math.min(1.35, Math.max(0.5, 1 + p[6] * (k - SEMENTES))) : 1;
    const eixo = (e) => {
      const base = p[e] * fator;
      const vel = Math.max(0.05, base * (1 + 0.06 * Math.sin(nuvem + e)) + gauss(rand) * 0.07 * Math.max(1, base / 2));
      const acel = Math.max(0.01, p[2 + e] * fator * (1 + 0.04 * Math.sin(nuvem * 1.3 + e)) + gauss(rand) * 0.006);
      const temp = p[4 + e] * (p[6] ? 0.9 + 0.1 * fator : 1) + gauss(rand) * 0.4;
      return { vel, acel, temp };
    };
    const a = eixo(0), b = eixo(1);
    const carga = Math.min(105, Math.max(20, 68 + 9 * Math.sin(nuvem * 0.6 + m.potencia_kw) + gauss(rand) * 2 + (fator - 1) * 30));
    return {
      ts, m1_vel: a.vel, m1_acel: a.acel, m1_temp: a.temp, m2_vel: b.vel, m2_acel: b.acel, m2_temp: b.temp,
      rpm: Math.round(1780 - carga * 0.45 + gauss(rand) * 3), carga: Math.round(carga),
      corrente: +((m.corrente_nom || 10) * carga / 100 * 0.93 + gauss(rand) * 0.1).toFixed(1),
    };
  }
  // registra mudanca de status no log de eventos
  function registrar(m, r, ts) {
    const f = statusDe(r), antes = ultStatus[m.codigo];
    ultStatus[m.codigo] = f;
    if (antes === undefined ? f === 0 : f === antes) return;
    const eixo = statusEixo(r.m2_vel, r.m2_acel, r.m2_temp) > statusEixo(r.m1_vel, r.m1_acel, r.m1_temp) ? 2 : 1;
    eventos.unshift({ ts, codigo: m.codigo, setor: m.area_nome, f, eixo,
      vel: r['m' + eixo + '_vel'], temp: r['m' + eixo + '_temp'], desc: m.descricao.replace(' · 2 eixos', '') });
    if (eventos.length > 60) eventos.pop();
  }
  // adiciona um ponto novo em todos os motores
  function passo(ts) {
    ts = ts || Date.now(); pontos++;
    motoresDe().forEach(m => {
      const h = hist[m.codigo] || (hist[m.codigo] = []);
      const r = gerar(m, SEMENTES + pontos, ts);
      h.push(r); if (h.length > MAX_HIST) h.shift();
      registrar(m, r, ts);
    });
    ouvintes.forEach(f => { try { f(); } catch (e) { console.error(e); } });
  }
  // historico inicial: o motor "ja estava rodando" quando o site abriu
  function semear() {
    const agora = Date.now();
    motoresDe().forEach(m => { hist[m.codigo] = []; });
    for (let k = 0; k < SEMENTES; k++) {
      const ts = agora - (SEMENTES - 1 - k) * INTERVALO;
      motoresDe().forEach(m => { const r = gerar(m, k, ts); hist[m.codigo].push(r); if (k === SEMENTES - 1) registrar(m, r, ts); });
    }
    // motores que ja abrem em alerta/alarme entram no log com um horario antigo
    eventos.forEach((e, i) => { e.ts = agora - (4 + i * 7) * 60000; });
  }
  semear();
  setInterval(() => passo(), INTERVALO);

  // leitura mais nova de um motor
  const leitura = cod => { const h = hist[cod]; return h && h.length ? h[h.length - 1] : null; };
  const historico = cod => (hist[cod] || []).slice();
  // lista de motores com leitura, status e saude (o que as telas precisam)
  function motoresComLeitura(setor) {
    return motoresDe(setor).map(m => {
      const r = leitura(m.codigo);
      return { ...m, setor: m.area_nome, piso: m.area_nome, r, hist: historico(m.codigo), f: statusDe(r), saude: saudeDe(r) };
    });
  }
  // o motor em pior estado (desempata pela saude)
  function piorMotor(setor) {
    const l = motoresComLeitura(setor);
    return l.length ? l.reduce((p, m) => (m.f > p.f || (m.f === p.f && m.saude < p.saude) ? m : p)) : null;
  }
  // resumo de um grupo de motores: quantos em cada status
  function resumo(setor) {
    const c = [0, 0, 0]; motoresComLeitura(setor).forEach(m => c[m.f]++);
    return { normal: c[0], alerta: c[1], alarme: c[2], total: c[0] + c[1] + c[2] };
  }
  // tendencia da vibracao do motor (mm/s por minuto), olhando os ultimos pontos
  function tendencia(cod) {
    const h = hist[cod] || [], n = Math.min(h.length, 120); if (n < 10) return 0;
    const seg = h.slice(-n).map(r => Math.max(r.m1_vel, r.m2_vel));
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    seg.forEach((y, x) => { sx += x; sy += y; sxy += x * y; sxx += x * x; });
    const den = (n * sxx - sx * sx) || 1;
    return (n * sxy - sx * sy) / den * (60000 / INTERVALO);
  }

  // ---------------------------------------------------------------- dados no formato do dataset (pro Diagnostico)
  // o Diagnostico le o dataset real (window.FORZY). Quando o ativo escolhido e um motor da fabrica,
  // montamos um objeto igual a partir do historico dele, e as telas de Diagnostico nao precisam saber a diferenca.
  const cacheDS = {};
  function datasetDe(cod) {
    const h = hist[cod]; if (!h || !h.length) return window.FORZY;
    const c = cacheDS[cod];
    if (c && c.ultimo === h[h.length - 1]) return c.ds;
    const t0 = h[0].ts, col = k => h.map(r => r[k]);
    const stats = (arr, label, unit, mean, std) => ({ mean, std, p5: Math.min(...arr), p95: Math.max(...arr), min: Math.min(...arr), max: Math.max(...arr), n: arr.length, label, unit });
    // referencia do "motor saudavel": media e desvio tipicos de um motor da fabrica sem defeito
    const ref = { vel: [0.9, 0.3, 'mm/s', 'Velocidade'], acel: [0.08, 0.025, 'g', 'Aceleracao'], temp: [31.5, 2.2, 'C', 'Temperatura'] };
    const baseline = {};
    ['m1', 'm2'].forEach(e => ['vel', 'acel', 'temp'].forEach(g => {
      const r = ref[g]; baseline[e + '_' + g] = stats(col(e + '_' + g), 'Eixo ' + e[1] + ' - ' + r[3], r[2], r[0], r[1]);
    }));
    const ds = {
      meta: { n: h.length, t0: new Date(t0).toISOString(), t_end: new Date(h[h.length - 1].ts).toISOString(),
        dur_s: (h[h.length - 1].ts - t0) / 1000, cols: ['m1_vel', 'm1_acel', 'm1_temp', 'm2_vel', 'm2_acel', 'm2_temp'] },
      t: h.map(r => (r.ts - t0) / 1000),
      m1: { vel: col('m1_vel'), acel: col('m1_acel'), temp: col('m1_temp') },
      m2: { vel: col('m2_vel'), acel: col('m2_acel'), temp: col('m2_temp') },
      baseline,
    };
    cacheDS[cod] = { ultimo: h[h.length - 1], ds };
    return ds;
  }
  // dados que o Diagnostico deve usar agora: o motor escolhido ou, sem motor, o dataset real
  function dados() {
    const s = sel;
    if (s.fabrica === 'forzy' && s.motor && hist[s.motor]) return datasetDe(s.motor);
    return window.FORZY;
  }

  // ---------------------------------------------------------------- ativo selecionado (compartilhado entre as telas)
  const FABRICAS = [['forzy', 'Fábrica Forzy'], ['bancada', 'Bancada Forzy (dados reais)']];
  let sel = (function () {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(KEY_SEL) || 'null'); } catch (_) {}
    s = Object.assign({ fabrica: 'forzy', setor: null, motor: null }, s || {});
    if (!FABRICAS.some(f => f[0] === s.fabrica)) s.fabrica = 'forzy';
    if (s.motor && !motorPorCodigo(s.motor)) s.motor = null;
    if (s.setor && !setores().some(x => x.nome === s.setor)) s.setor = null;
    return s;
  })();
  const aoMudar = [];
  let auto = false; // motor escolhido sozinho pelo Diagnostico (nao pela pessoa)
  const getSel = () => ({ ...sel });
  // muda a selecao (troca de fabrica zera setor/motor; escolher motor acerta o setor)
  function setSel(p) {
    auto = false;
    const novo = { ...sel, ...p };
    if (p.fabrica && p.fabrica !== sel.fabrica) { novo.setor = p.setor || null; novo.motor = p.motor || null; }
    if (novo.fabrica !== 'forzy') { novo.setor = null; novo.motor = null; }
    if (p.setor !== undefined && p.motor === undefined && novo.motor) {
      const m = motorPorCodigo(novo.motor);
      if (!p.setor || !m || m.area_nome !== p.setor) novo.motor = null;
    }
    if (novo.motor) { const m = motorPorCodigo(novo.motor); if (m) novo.setor = m.area_nome; else novo.motor = null; }
    const mudou = ['fabrica', 'setor', 'motor'].some(k => novo[k] !== sel[k]);
    sel = novo;
    try { localStorage.setItem(KEY_SEL, JSON.stringify(sel)); } catch (_) {}
    if (mudou) {
      aoMudar.forEach(f => { try { f(getSel()); } catch (e) { console.error(e); } });
      document.dispatchEvent(new CustomEvent('fz-selecao-change', { detail: getSel() }));
    }
  }

  // ---------------------------------------------------------------- seletor (Fabrica > Setor > Motor)
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const seletores = [];

  // desenha o seletor dentro de "host". opcoes.exigeMotor: sem a opcao "todos os motores" (Diagnostico)
  function montar(host, opcoes) {
    if (!host) return;
    const op = opcoes || {};
    const ref = { host, op };
    for (let i = seletores.length - 1; i >= 0; i--) if (!seletores[i].host.isConnected || seletores[i].host === host) seletores.splice(i, 1);
    seletores.push(ref);
    desenhar(ref, true);
  }
  // forcar = false no refresh automatico: nao mexe enquanto a pessoa esta com uma lista aberta
  function desenhar(ref, forcar) {
    const { host, op } = ref;
    if (op.exigeMotor && !host.offsetParent) return; // tela escondida: nao mexe na selecao dos outros
    if (op.exigeMotor && sel.fabrica === 'forzy' && !sel.motor) {
      const p = piorMotor(sel.setor); if (p) { setSel({ motor: p.codigo }); auto = true; if (!forcar) return; }
    }
    const foco = host.contains(document.activeElement) && document.activeElement.tagName === 'SELECT';
    if (foco && !forcar) return;
    let h = `<div class="fz-sel"><div class="fz-field"><span>Fábrica</span><select class="fz-select" data-k="fabrica">` +
      FABRICAS.map(([v, l]) => `<option value="${v}" ${v === sel.fabrica ? 'selected' : ''}>${l}</option>`).join('') + '</select></div>';
    if (sel.fabrica === 'forzy') {
      const ss = setores();
      h += `<div class="fz-field"><span>Setor</span><div class="fz-seg" data-k="setor">` +
        (op.exigeMotor ? '' : `<button data-v="" class="${!sel.setor ? 'active' : ''}">Todos</button>`) +
        ss.map(s => `<button data-v="${esc(s.nome)}" class="${sel.setor === s.nome ? 'active' : ''}">${esc(s.nome)}</button>`).join('') + '</div></div>';
      const ms = motoresComLeitura(sel.setor);
      h += `<div class="fz-field"><span>Motor</span><select class="fz-select" data-k="motor">` +
        (op.exigeMotor ? '' : `<option value="">${sel.setor ? 'Todos do setor' : 'Todos os motores'}</option>`) +
        ms.map(m => `<option value="${m.codigo}" ${m.codigo === sel.motor ? 'selected' : ''}>${m.codigo} · ${esc(m.descricao.replace(' · 2 eixos', ''))}${m.f ? ' — ' + NOME[m.f] : ''}</option>`).join('') + '</select></div>';
    } else {
      h += '<div class="fz-sel-nota">1 motor · 2 eixos · dados reais coletados pelo sensor</div>';
    }
    h += '</div>';
    host.innerHTML = h;
    host.querySelector('[data-k="fabrica"]').addEventListener('change', e => setSel({ fabrica: e.target.value }));
    host.querySelectorAll('[data-k="setor"] button').forEach(b => b.addEventListener('click', () => setSel({ setor: b.dataset.v || null })));
    const mo = host.querySelector('select[data-k="motor"]');
    if (mo) mo.addEventListener('change', e => setSel({ motor: e.target.value || null }));
  }
  // ---------------------------------------------------------------- quadradinhos dos motores (visao geral clicavel)
  const COR = ['var(--fz-ok)', 'var(--fz-warn)', 'var(--fz-bad)'];
  const CLASSE = ['fz-asset-ok', 'fz-asset-warn', 'fz-asset-bad'];
  const fx = (v, d) => (v == null || v !== v) ? '—' : Number(v).toFixed(d);
  function tile(m) {
    const r = m.r;
    return `<div class="fz-asset fz-tile fz-tile-click ${CLASSE[m.f]}" data-cod="${m.codigo}" role="button" tabindex="0" title="Abrir ${esc(m.codigo)}">
      <div class="a-name">${m.codigo}</div>
      <div class="a-desc">${esc(m.descricao.replace(' · 2 eixos', ''))}</div>
      <div class="a-status" style="color:${COR[m.f]}">${NOME[m.f]}</div>
      <div class="a-read"><b>${fx(Math.max(r.m1_vel, r.m2_vel), 2)}</b> mm/s · <b>${fx(Math.max(r.m1_temp, r.m2_temp), 0)}</b> °C</div></div>`;
  }
  // desenha os motores agrupados por setor (so um setor, se "setor" vier preenchido) e liga o clique
  function tiles(host, setor) {
    if (!host) return;
    const foco = host.contains(document.activeElement) && document.activeElement.dataset ? document.activeElement.dataset.cod : null;
    host.innerHTML = setores().filter(s => !setor || s.nome === setor).map(s => {
      const ms = motoresComLeitura(s.nome), c = [0, 0, 0]; ms.forEach(m => c[m.f]++);
      return `<div class="fz-piso-grupo"><div class="fz-piso-tit">${esc(s.nome)} <span class="fz-piso-cont">${c[2] ? `<b style="color:var(--fz-bad)">${c[2]} alarme</b>` : ''}${c[1] ? `<b style="color:var(--fz-warn)">${c[1]} alerta</b>` : ''}${!c[1] && !c[2] ? 'tudo normal' : ''}</span></div>
        <div class="fz-piso-grid">${ms.map(tile).join('')}</div></div>`;
    }).join('');
    if (foco) { const t = host.querySelector('[data-cod="' + foco + '"]'); if (t) t.focus(); }
    const abrir = el => { const t = el.closest('.fz-tile-click'); if (t) setSel({ fabrica: 'forzy', motor: t.dataset.cod }); };
    host.onclick = e => abrir(e.target);
    host.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(e.target); } };
  }

  // faixa de resumo do ativo escolhido (Diagnostico): quem e, saude e as metricas dos 2 eixos
  function faixa(host) {
    if (!host) return;
    const m = sel.fabrica === 'forzy' && sel.motor ? motoresComLeitura().find(x => x.codigo === sel.motor) : null;
    const dm = (t, v) => `<div class="dg-m"><span>${t}</span><b>${v}</b></div>`;
    if (m) {
      const r = m.r;
      host.innerHTML = `<div class="fz-diag-faixa"><div><div class="dg-tit" style="color:${COR[m.f]}">${esc(m.codigo)} · ${NOME[m.f]}</div>
        <div class="dg-sub">${esc(m.descricao.replace(' · 2 eixos', ''))} · ${esc(m.setor)} · ${m.potencia_kw} kW</div></div>
        ${dm('Saúde', m.saude + '/100')}
        ${dm('Eixo 1', `${fx(r.m1_vel, 2)} mm/s · ${fx(r.m1_acel, 2)} g · ${fx(r.m1_temp, 0)} °C`)}
        ${dm('Eixo 2', `${fx(r.m2_vel, 2)} mm/s · ${fx(r.m2_acel, 2)} g · ${fx(r.m2_temp, 0)} °C`)}</div>`;
    } else {
      host.innerHTML = '<div class="fz-diag-faixa"><div><div class="dg-tit">Bancada Forzy</div><div class="dg-sub">Dataset real · 1 motor · 2 eixos</div></div></div>';
    }
  }

  aoMudar.push(() => seletores.slice().forEach(r => desenhar(r, true)));
  // atualiza o aviso de status das opcoes (motor muda de status com o tempo)
  setInterval(() => seletores.slice().forEach(r => { if (r.host.isConnected && r.host.offsetParent) desenhar(r, false); }), 10000);

  window.FZFabrica = {
    LIM, NOME, setores, motores: motoresComLeitura, motor: motorPorCodigo, leitura, historico, statusDe, statusEixo, saudeDe,
    piorMotor, resumo, tendencia, tiles, faixa, eventos: () => eventos.slice(), onPasso: f => ouvintes.push(f), passo, dataset: datasetDe,
  };
  // codigo do ativo em analise: o motor da fabrica ou, na bancada, o eixo 1 do cadastro
  const ativoCodigo = () => (sel.fabrica === 'forzy' && sel.motor ? sel.motor : 'BBA-001');
  window.FZSelecao = { get: getSel, set: setSel, onChange: f => aoMudar.push(f), dados, ativoCodigo,
    // ao sair do Diagnostico: desfaz o motor que ele escolheu sozinho
    soltarAuto: () => { if (auto) setSel({ motor: null }); } };
  window.FZSeletor = { montar };
  // dados que o Diagnostico usa agora (motor da fabrica ou dataset real)
  window.FZDados = dados;
})();
