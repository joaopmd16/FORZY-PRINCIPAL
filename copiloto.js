/* ===================================================================
   FORZY · Copiloto de Manutenção
   Diagnóstico automático de modo de falha (baseado em regras, sem FFT)
   + geração de Ordem de Serviço (OS) exportável em PDF e refinável por IA.
   Tela dedicada #screen-copiloto. Consome window.FORZY / window.FZDashboard.
   Sem build, sem libs (jsPDF já vem no vision.html).
   =================================================================== */
(function () {
  const F = window.FORZY;

  /* ----------  limiares (espelham forzy.js / CLAUDE.md)  ---------- */
  const LIM = {
    vel:  { a: 1.8,  al: 4.5,  unit: 'mm/s' },
    acel: { a: 0.25, al: 0.45, unit: 'g'    },
    temp: { a: 35.0, al: 42.0, unit: '°C'   },
  };
  const OS_SEQ_KEY = 'forzy-os-seq';
  const OS_LOG_KEY = 'forzy-os-log';

  /* ----------  helpers  ---------- */
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v, d = 2) => (v == null || v !== v) ? '—' : Number(v).toFixed(d);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function el(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

  // leitura atual: usa o Dashboard se disponível, senão o último frame do dataset
  function leituraAtual() {
    let r = null;
    try { r = window.FZDashboard && window.FZDashboard.getCurrentReading(); } catch (e) { /* noop */ }
    if (r && r.m1_vel != null) return r;
    if (!F) return null;
    const i = F.meta.n - 1;
    return {
      m1_vel: F.m1.vel[i], m1_acel: F.m1.acel[i], m1_temp: F.m1.temp[i],
      m2_vel: F.m2.vel[i], m2_acel: F.m2.acel[i], m2_temp: F.m2.temp[i],
    };
  }
  function zscore(col, val) {
    const b = F && F.baseline && F.baseline[col];
    if (!b || !b.std) return 0;
    return Math.abs(val - b.mean) / b.std;
  }
  // tendência de vel: inclinação normalizada dos últimos ~180 frames
  function tendenciaVel(eixo) {
    if (!F) return 0;
    const arr = F[eixo].vel, n = arr.length, w = Math.min(180, n);
    const seg = arr.slice(n - w);
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (let k = 0; k < w; k++) { sx += k; sy += seg[k]; sxy += k * seg[k]; sxx += k * k; }
    const denom = (w * sxx - sx * sx) || 1;
    const slope = (w * sxy - sx * sy) / denom;         // mm/s por frame
    const med = sy / w || 1;
    return slope * w / med;                            // variação relativa na janela
  }

  /* ===================================================================
     MOTOR DE DIAGNÓSTICO — regras sobre a leitura do eixo
     =================================================================== */
  const MODOS = {
    balanceamento: {
      modo: 'Desbalanceamento / desalinhamento',
      causa: 'Massa desbalanceada no rotor, acoplamento desalinhado ou base de fixação frouxa. Vibração dominante em rotação síncrona com aceleração elevada e temperatura ainda controlada.',
      acoes: [
        'Inspecionar acoplamento e alinhamento a laser (tolerância do fabricante).',
        'Verificar aperto dos chumbadores e do berço da bomba.',
        'Balancear o conjunto rotativo em campo (planos 1 e 2).',
        'Reavaliar vibração RMS após correção — meta < 1,8 mm/s (ISO 10816).',
      ],
      pecas: ['Kit de calços de alinhamento', 'Elemento elástico do acoplamento', 'Parafusos/porcas de fixação grau 8.8'],
    },
    rolamento: {
      modo: 'Folga mecânica / rolamento com defeito incipiente',
      causa: 'Picos de aceleração (impactos) acima do normal com velocidade RMS moderada — típico de folga em mancal, desgaste de pista ou corpo rolante, ou fixação solta.',
      acoes: [
        'Escutar mancais com estetoscópio industrial / medir envelope de aceleração.',
        'Verificar folga axial e radial do eixo.',
        'Reapertar tampas de mancal e conferir pré-carga.',
        'Programar troca dos rolamentos se o padrão de impacto persistir.',
      ],
      pecas: ['Par de rolamentos (LD/LA) conforme placa', 'Graxa de alta temperatura', 'Retentores / vedações de mancal'],
    },
    termico: {
      modo: 'Superaquecimento localizado',
      causa: 'Temperatura acima do limite com vibração dentro da faixa normal — lubrificação deficiente/degradada, refrigeração obstruída, sobrecarga elétrica ou corrente de fuga.',
      acoes: [
        'Medir temperatura com termovisor em mancais, carcaça e terminais.',
        'Conferir nível/estado do lubrificante e trocar se contaminado.',
        'Limpar aletas de refrigeração e conferir ventilação forçada.',
        'Medir corrente nas 3 fases e comparar com a corrente nominal de placa.',
      ],
      pecas: ['Óleo/graxa lubrificante especificado', 'Elemento de ventilação / defletor', 'Terminais e conectores de força'],
    },
    cavitacao: {
      modo: 'Cavitação / fluxo instável na sucção',
      causa: 'Aceleração elevada e ruidosa com velocidade RMS abaixo do baseline e oscilante — indício de NPSH insuficiente, sucção estrangulada, filtro sujo ou ar arrastado.',
      acoes: [
        'Verificar pressão de sucção e NPSH disponível vs. requerido.',
        'Inspecionar/limpar filtro e válvula de pé da linha de sucção.',
        'Conferir nível do reservatório e vedação contra entrada de ar.',
        'Reduzir rotação ou estrangular o recalque (não a sucção) até estabilizar.',
      ],
      pecas: ['Elemento filtrante da sucção', 'Junta / vedação de flange', 'Manovacuômetro de sucção'],
    },
    severa: {
      modo: 'Falha severa multissintoma',
      causa: 'Velocidade RMS e/ou temperatura em nível de alarme com aceleração alta — degradação avançada com mais de uma causa simultânea. Risco de dano secundário.',
      acoes: [
        'PARADA PROGRAMADA IMEDIATA do ativo (ISA-18.2 P1).',
        'Isolar eletricamente e mecanicamente, aplicar bloqueio/etiquetagem.',
        'Desmontar e inspecionar rotor, mancais, eixo e acoplamento.',
        'Substituir componentes danificados e realinhar/balancear antes do retorno.',
      ],
      pecas: ['Par de rolamentos', 'Elemento do acoplamento', 'Kit de vedações', 'Lubrificante', 'Eixo (se empenado)'],
    },
    normal: {
      modo: 'Sem falha detectada',
      causa: 'Velocidade, aceleração e temperatura dentro da faixa normal da ISO 10816. Nenhuma assinatura de falha identificada nas regras atuais.',
      acoes: [
        'Manter plano de inspeção sensitiva na periodicidade padrão.',
        'Registrar a medição atual como referência de operação boa.',
      ],
      pecas: ['—'],
    },
  };

  function diagnosticar(reading, eixo) {
    const pfx = eixo === 'm2' ? 'm2' : 'm1';
    const vel = +reading[pfx + '_vel'] || 0;
    const acel = +reading[pfx + '_acel'] || 0;
    const temp = +reading[pfx + '_temp'] || 0;
    const zv = zscore(pfx + '_vel', vel);
    const za = zscore(pfx + '_acel', acel);
    const zt = zscore(pfx + '_temp', temp);
    const trend = tendenciaVel(pfx);

    const ev = [
      { k: 'Velocidade RMS', v: vel, unit: LIM.vel.unit, z: zv, lim: LIM.vel },
      { k: 'Aceleração RMS', v: acel, unit: LIM.acel.unit, z: za, lim: LIM.acel },
      { k: 'Temperatura',    v: temp, unit: LIM.temp.unit, z: zt, lim: LIM.temp },
    ];

    // ordem das regras: da mais crítica/específica para a mais branda
    let key, conf;
    if (vel >= LIM.vel.al || temp >= LIM.temp.al) {
      key = 'severa';
      conf = 0.9;
    } else if (temp >= LIM.temp.a && vel < LIM.vel.a && acel < LIM.acel.a) {
      key = 'termico';
      conf = 0.78;
    } else if (acel >= LIM.acel.al && vel < LIM.vel.al) {
      key = 'rolamento';
      conf = 0.72;
    } else if (vel >= LIM.vel.a && acel >= LIM.acel.a && temp < LIM.temp.a) {
      key = 'balanceamento';
      conf = 0.7;
    } else if (za >= 2 && zv < 1 && acel >= LIM.acel.a) {
      key = 'cavitacao';
      conf = 0.6;
    } else if (vel >= LIM.vel.a || acel >= LIM.acel.a || temp >= LIM.temp.a) {
      key = 'balanceamento';
      conf = 0.5;
    } else {
      key = 'normal';
      conf = 0.85;
    }

    // ajuste de confiança pela tendência de piora
    if (key !== 'normal' && trend > 0.15) conf = clamp(conf + 0.08, 0, 0.97);

    // prioridade ISA-18.2 / ISO 10816
    let prio, prioLbl;
    if (vel >= LIM.vel.al || temp >= LIM.temp.al) { prio = 'P1'; prioLbl = 'Crítica — intervenção imediata'; }
    else if (vel >= LIM.vel.a || temp >= LIM.temp.a || acel >= LIM.acel.al) { prio = 'P2'; prioLbl = 'Alta — verificar / planejar'; }
    else { prio = 'P3'; prioLbl = 'Planejada — rotina'; }

    /*
     * REDE NEURAL — entra depois das regras, nunca no lugar delas.
     * As regras acima decidem QUAL é o modo de falha (elas conhecem a física:
     * aceleração alta com velocidade baixa = rolamento, etc.). A rede não sabe
     * nomear modo de falha nenhum — ela só sabe dizer o quanto a combinação das
     * seis variáveis foge do que ela viu no dataset. Então o papel dela aqui é
     * de ESCALADA: se ela acusa anomalia que os limites fixos não pegaram, a
     * prioridade sobe um degrau e a confiança aumenta. Ela nunca rebaixa nada.
     */
    let rede = null;
    try {
      const M = window.FZModelo;
      if (M && M.pronto()) { const r = M.avaliar(reading); if (r && r.ok) rede = r; }
    } catch (e) { /* noop */ }

    if (rede && rede.nivelRede >= 1) {
      if (rede.nivelRede === 2 && prio !== 'P1') { prio = 'P1'; prioLbl = 'Crítica — intervenção imediata'; }
      else if (prio === 'P3')                    { prio = 'P2'; prioLbl = 'Alta — verificar / planejar'; }
      // "normal" + rede acusando = as duas leituras se contradizem; a confiança no
      // laudo cai, é exatamente o caso que o técnico precisa olhar com o olho dele.
      conf = key === 'normal' ? clamp(conf - 0.25, 0.1, 0.97) : clamp(conf + 0.05, 0, 0.97);
    }

    return { key, ...MODOS[key], confianca: Math.round(conf * 100), prioridade: prio, prioridadeLabel: prioLbl,
             evidencias: ev, tendencia: trend, eixo: pfx, rede };
  }

  /* ===================================================================
     ORDEM DE SERVIÇO
     =================================================================== */
  function proximoNumero() {
    let n = 0;
    try { n = parseInt(localStorage.getItem(OS_SEQ_KEY) || '0', 10) || 0; } catch (e) { /* noop */ }
    n += 1;
    try { localStorage.setItem(OS_SEQ_KEY, String(n)); } catch (e) { /* noop */ }
    const yy = new Date().getFullYear();
    return `OS-${yy}-${String(n).padStart(4, '0')}`;
  }
  function lerLog() {
    try { return JSON.parse(localStorage.getItem(OS_LOG_KEY) || '[]'); } catch (e) { return []; }
  }
  function gravarLog(os) {
    const log = lerLog();
    log.unshift(os);
    try { localStorage.setItem(OS_LOG_KEY, JSON.stringify(log.slice(0, 100))); } catch (e) { /* noop */ }
  }

  function montarOS(diag, ativoCod) {
    return {
      numero: proximoNumero(),
      criada_em: new Date().toISOString(),
      ativo: ativoCod || '—',
      eixo: diag.eixo === 'm2' ? 'Eixo 2' : 'Eixo 1',
      prioridade: diag.prioridade,
      prioridade_label: diag.prioridadeLabel,
      modo_falha: diag.modo,
      confianca: diag.confianca,
      causa_provavel: diag.causa,
      evidencias: diag.evidencias.map(e => ({
        grandeza: e.k, valor: +fmt(e.v), unidade: e.unit, zscore: +fmt(e.z, 1),
        faixa: e.v >= e.lim.al ? 'ALARME' : e.v >= e.lim.a ? 'ALERTA' : 'normal',
      })),
      acoes: diag.acoes.slice(),
      pecas: diag.pecas.slice(),
      norma: 'ISO 10816 (motores < 15 kW) · ISA-18.2:2016 (gestão de alarmes)',
      // parecer da rede neural — fica gravado na OS pra a auditoria saber que
      // a prioridade pode ter sido escalada pelo modelo, não só pelos limites
      rede: diag.rede ? {
        indice: +fmt(diag.rede.indice, 2),
        nivel: diag.rede.rotulo,
        limite_critico: +fmt(diag.rede.limCritico, 2),
        explicacao: diag.rede.explicacao,
      } : null,
      responsavel: '',
      prazo: '',
      status: 'Aberta',
      refino_ia: '',
    };
  }

  /* ===================================================================
     RENDER
     =================================================================== */
  let _root = null, _diag = null, _os = null, _eixo = 'm1', _ativo = null;

  function ativosDisponiveis() {
    try { return (window.FZStore && window.FZStore.getAtivosIndustrial()) || []; } catch (e) { return []; }
  }

  function render() {
    if (!_root) return;
    const reading = leituraAtual();
    if (!reading) { _root.innerHTML = '<div class="fz-card">Dataset não carregado.</div>'; return; }
    _diag = diagnosticar(reading, _eixo);

    const ativos = ativosDisponiveis();
    if (!_ativo && ativos.length) _ativo = ativos[0].codigo;

    const corPrio = _diag.prioridade === 'P1' ? 'var(--fz-bad)' : _diag.prioridade === 'P2' ? 'var(--fz-warn)' : 'var(--fz-ok)';

    const evRows = _diag.evidencias.map(e => {
      const st = e.v >= e.lim.al ? 'bad' : e.v >= e.lim.a ? 'warn' : 'ok';
      return `<tr>
        <td>${esc(e.k)}</td>
        <td><b>${fmt(e.v)}</b> ${esc(e.unit)}</td>
        <td>Z ${fmt(e.z, 1)}</td>
        <td><span class="fz-cop-tag fz-cop-${st}">${st === 'bad' ? 'ALARME' : st === 'warn' ? 'ALERTA' : 'normal'}</span></td>
      </tr>`;
    }).join('');

    const trendTxt = _diag.tendencia > 0.15 ? '↑ piorando' : _diag.tendencia < -0.15 ? '↓ melhorando' : '→ estável';

    // parecer da rede neural — só pro analista; o operador vê o veredito curto
    const _r = _diag.rede;
    const redeBloco = !_r ? '' : `
      <div class="fz-cop-rede">
        <b>Rede neural</b> — índice de anomalia
        <b style="color:${_r.cor}">${fmt(_r.indice, 2)}</b>
        (1,00 = atenção · ${fmt(_r.limCritico, 2)} = crítico) → <b style="color:${_r.cor}">${esc(_r.rotulo)}</b>
        <div>${esc(_r.explicacao)}</div>
      </div>`;

    const ehOperador = !!(window.FZPerfil && window.FZPerfil.isOperador && window.FZPerfil.isOperador());
    if (ehOperador) {
      const pior = _diag.evidencias.reduce((m, e) => (e.v >= e.lim.al ? 3 : e.v >= e.lim.a ? 2 : 1) > m.n
        ? { n: (e.v >= e.lim.al ? 3 : e.v >= e.lim.a ? 2 : 1), e } : m, { n: 0, e: null });
      const veredito = _diag.key === 'normal'
        ? 'Motor OK. Nada a fazer agora.'
        : `Motor com problema: ${esc(_diag.modo.toLowerCase())}.`;
      const acao = _diag.acoes[0] ? esc(_diag.acoes[0]) : 'Chamar a manutenção.';
      _root.innerHTML = `
        <div class="fz-cop-controls fz-card">
          <label>Eixo
            <select id="copEixo">
              <option value="m1" ${_eixo === 'm1' ? 'selected' : ''}>Eixo 1</option>
              <option value="m2" ${_eixo === 'm2' ? 'selected' : ''}>Eixo 2</option>
            </select>
          </label>
          <label>Ativo
            <select id="copAtivo">
              ${ativos.length
                ? ativos.map(a => `<option value="${esc(a.codigo)}" ${a.codigo === _ativo ? 'selected' : ''}>${esc(a.codigo)} — ${esc(a.descricao || '')}</option>`).join('')
                : '<option value="">(nenhum ativo cadastrado)</option>'}
            </select>
          </label>
          <button class="fz-btn" id="copRefresh">Recalcular</button>
        </div>
        <div class="fz-card fz-cop-diag">
          <div class="fz-cop-modo" style="color:${corPrio}">${veredito}</div>
          ${pior.e ? `<p class="fz-cop-causa">${esc(pior.e.k)}: <b>${fmt(pior.e.v)} ${esc(pior.e.unit)}</b> — ${pior.n === 3 ? 'muito alto' : pior.n === 2 ? 'acima do normal' : 'normal'}.</p>` : ''}
          <p class="fz-cop-causa"><b>O que fazer:</b> ${acao}</p>
        </div>
        <div class="fz-cop-cta">
          <button class="fz-btn fz-btn-primary" id="copGerar">Gerar Ordem de Serviço</button>
        </div>
        <div id="copOSHost"></div>
        <div class="fz-card fz-cop-hist">
          <div class="fz-card-title">Histórico de OS (${lerLog().length})</div>
          <div id="copHistBody"></div>
        </div>
      `;
      _root.querySelector('#copEixo').addEventListener('change', e => { _eixo = e.target.value; render(); });
      _root.querySelector('#copAtivo').addEventListener('change', e => { _ativo = e.target.value; });
      _root.querySelector('#copRefresh').addEventListener('click', render);
      _root.querySelector('#copGerar').addEventListener('click', gerarOS);
      renderHist();
      if (_os) renderOS();
      return;
    }

    _root.innerHTML = `
      <div class="fz-cop-controls fz-card">
        <label>Eixo
          <select id="copEixo">
            <option value="m1" ${_eixo === 'm1' ? 'selected' : ''}>Eixo 1</option>
            <option value="m2" ${_eixo === 'm2' ? 'selected' : ''}>Eixo 2</option>
          </select>
        </label>
        <label>Ativo
          <select id="copAtivo">
            ${ativos.length
              ? ativos.map(a => `<option value="${esc(a.codigo)}" ${a.codigo === _ativo ? 'selected' : ''}>${esc(a.codigo)} — ${esc(a.descricao || '')}</option>`).join('')
              : '<option value="">(nenhum ativo cadastrado)</option>'}
          </select>
        </label>
        <button class="fz-btn" id="copRefresh">Recalcular diagnóstico</button>
      </div>

      <div class="fz-cop-grid">
        <div class="fz-card fz-cop-diag">
          <div class="fz-card-title">Diagnóstico automático</div>
          <div class="fz-cop-modo">${esc(_diag.modo)}</div>
          <div class="fz-cop-meta">
            <span class="fz-cop-tag" style="background:${corPrio}22;color:${corPrio};border:1px solid ${corPrio}">${_diag.prioridade} · ${esc(_diag.prioridadeLabel)}</span>
            <span class="fz-cop-conf">Confiança ${_diag.confianca}%</span>
            <span class="fz-cop-trend">Tendência: ${trendTxt}</span>
          </div>
          <p class="fz-cop-causa">${esc(_diag.causa)}</p>
          <table class="fz-cop-table">
            <thead><tr><th>Grandeza</th><th>Valor</th><th>Z-score</th><th>Faixa</th></tr></thead>
            <tbody>${evRows}</tbody>
          </table>
          ${redeBloco}
          <div class="fz-cop-sub">Regras baseadas em ISO 10816 + Z-score sobre o baseline do Dataset Forzy. Sem análise espectral.</div>
        </div>

        <div class="fz-card fz-cop-actions">
          <div class="fz-card-title">Ações recomendadas</div>
          <ol>${_diag.acoes.map(a => `<li>${esc(a)}</li>`).join('')}</ol>
          <div class="fz-card-title" style="margin-top:14px">Peças / insumos prováveis</div>
          <ul>${_diag.pecas.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
        </div>
      </div>

      <div class="fz-cop-cta">
        <button class="fz-btn fz-btn-primary" id="copGerar">Gerar Ordem de Serviço</button>
      </div>

      <div id="copOSHost"></div>

      <div class="fz-card fz-cop-hist">
        <div class="fz-card-title">Histórico de OS (${lerLog().length})</div>
        <div id="copHistBody"></div>
      </div>
    `;

    _root.querySelector('#copEixo').addEventListener('change', e => { _eixo = e.target.value; render(); });
    _root.querySelector('#copAtivo').addEventListener('change', e => { _ativo = e.target.value; });
    _root.querySelector('#copRefresh').addEventListener('click', render);
    _root.querySelector('#copGerar').addEventListener('click', gerarOS);
    renderHist();
    if (_os) renderOS();  // mantém a OS aberta em re-render por troca de eixo
  }

  function renderHist() {
    const host = _root && _root.querySelector('#copHistBody');
    if (!host) return;
    const log = lerLog();
    if (!log.length) { host.innerHTML = '<div class="fz-cop-sub">Nenhuma OS gerada ainda.</div>'; return; }
    host.innerHTML = `<table class="fz-cop-table">
      <thead><tr><th>Nº</th><th>Data</th><th>Ativo</th><th>Prioridade</th><th>Modo de falha</th></tr></thead>
      <tbody>${log.map(o => `<tr>
        <td>${esc(o.numero)}</td>
        <td>${esc(new Date(o.criada_em).toLocaleString('pt-BR'))}</td>
        <td>${esc(o.ativo)} · ${esc(o.eixo)}</td>
        <td>${esc(o.prioridade)}</td>
        <td>${esc(o.modo_falha)}</td>
      </tr>`).join('')}</tbody></table>`;
  }

  function gerarOS() {
    _os = montarOS(_diag, _ativo);
    gravarLog(_os);
    renderOS();
    renderHist();
    _root.querySelector('#copOSHost').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderOS() {
    const host = _root && _root.querySelector('#copOSHost');
    if (!host || !_os) return;
    const evRows = _os.evidencias.map(e =>
      `<tr><td>${esc(e.grandeza)}</td><td>${fmt(e.valor)} ${esc(e.unidade)}</td><td>Z ${fmt(e.zscore, 1)}</td><td>${esc(e.faixa)}</td></tr>`).join('');
    const semChave = !window.FORZY_OPENAI_KEY;
    host.innerHTML = `
      <div class="fz-card fz-cop-os">
        <div class="fz-cop-os-head">
          <div>
            <div class="fz-eyebrow">Ordem de Serviço</div>
            <div class="fz-cop-os-num">${esc(_os.numero)}</div>
          </div>
          <span class="fz-cop-tag">${esc(_os.status)}</span>
        </div>
        <div class="fz-cop-os-grid">
          <div><span>Ativo</span><b>${esc(_os.ativo)} · ${esc(_os.eixo)}</b></div>
          <div><span>Aberta em</span><b>${esc(new Date(_os.criada_em).toLocaleString('pt-BR'))}</b></div>
          <div><span>Prioridade</span><b>${esc(_os.prioridade)} — ${esc(_os.prioridade_label)}</b></div>
          <div><span>Confiança do diagnóstico</span><b>${_os.confianca}%</b></div>
        </div>
        <div class="fz-cop-os-sec"><b>Modo de falha:</b> ${esc(_os.modo_falha)}</div>
        <div class="fz-cop-os-sec">${esc(_os.causa_provavel)}</div>
        <table class="fz-cop-table"><thead><tr><th>Grandeza</th><th>Valor</th><th>Z-score</th><th>Faixa</th></tr></thead><tbody>${evRows}</tbody></table>
        <div class="fz-cop-os-sec"><b>Ações recomendadas</b><ol>${_os.acoes.map(a => `<li>${esc(a)}</li>`).join('')}</ol></div>
        <div class="fz-cop-os-sec"><b>Peças / insumos</b><ul>${_os.pecas.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>
        <div class="fz-cop-os-sec fz-cop-sub"><b>Norma de referência:</b> ${esc(_os.norma)}</div>
        <div class="fz-cop-os-fields">
          <label>Responsável <input type="text" id="copResp" value="${esc(_os.responsavel)}" placeholder="Nome do técnico"></label>
          <label>Prazo <input type="date" id="copPrazo" value="${esc(_os.prazo)}"></label>
        </div>
        <div id="copRefinoBox" class="fz-cop-refino" ${_os.refino_ia ? '' : 'hidden'}></div>
        <div class="fz-cop-os-cta">
          <button class="fz-btn fz-btn-primary" id="copPdf">Exportar PDF</button>
          <button class="fz-btn" id="copIA" ${semChave ? 'disabled title="Configure config.js com a chave OpenAI"' : ''}>Refinar com IA</button>
          <button class="fz-btn ghost" id="copCopiar">Copiar texto</button>
        </div>
      </div>`;

    host.querySelector('#copResp').addEventListener('input', e => { _os.responsavel = e.target.value; });
    host.querySelector('#copPrazo').addEventListener('input', e => { _os.prazo = e.target.value; });
    host.querySelector('#copPdf').addEventListener('click', exportarPDF);
    host.querySelector('#copCopiar').addEventListener('click', copiarTexto);
    if (!semChave) host.querySelector('#copIA').addEventListener('click', refinarComIA);
    if (_os.refino_ia) mostrarRefino(_os.refino_ia);
  }

  /* ----------  texto plano da OS (copiar / prompt IA)  ---------- */
  function osTexto() {
    const L = [];
    L.push(`ORDEM DE SERVIÇO ${_os.numero}`);
    L.push(`Ativo: ${_os.ativo} · ${_os.eixo}`);
    L.push(`Aberta em: ${new Date(_os.criada_em).toLocaleString('pt-BR')}`);
    L.push(`Prioridade: ${_os.prioridade} — ${_os.prioridade_label}`);
    L.push(`Modo de falha: ${_os.modo_falha} (confiança ${_os.confianca}%)`);
    L.push(`Causa provável: ${_os.causa_provavel}`);
    L.push('Evidências:');
    _os.evidencias.forEach(e => L.push(`  - ${e.grandeza}: ${e.valor} ${e.unidade} (Z ${e.zscore}, ${e.faixa})`));
    if (_os.rede) {
      L.push(`Rede neural: índice ${_os.rede.indice} (crítico a partir de ${_os.rede.limite_critico}) — ${_os.rede.nivel}`);
      L.push(`  ${_os.rede.explicacao}`);
    }
    L.push('Ações recomendadas:');
    _os.acoes.forEach((a, i) => L.push(`  ${i + 1}. ${a}`));
    L.push('Peças / insumos: ' + _os.pecas.join(', '));
    L.push(`Norma: ${_os.norma}`);
    if (_os.responsavel) L.push(`Responsável: ${_os.responsavel}`);
    if (_os.prazo) L.push(`Prazo: ${_os.prazo}`);
    return L.join('\n');
  }

  function copiarTexto() {
    const t = osTexto();
    navigator.clipboard && navigator.clipboard.writeText(t).then(
      () => toast('OS copiada para a área de transferência'),
      () => toast('Não foi possível copiar'));
  }

  /* ----------  PDF (jsPDF UMD já carregado no vision.html)  ---------- */
  function exportarPDF() {
    const jsPDFctor = window.jspdf && window.jspdf.jsPDF;
    if (!jsPDFctor) { toast('jsPDF não carregou'); return; }
    const doc = new jsPDFctor({ unit: 'pt', format: 'a4' });
    const M = 48; let y = M;
    const W = doc.internal.pageSize.getWidth();
    const line = (txt, size = 10, style = 'normal', gap = 15) => {
      doc.setFont('helvetica', style); doc.setFontSize(size);
      const parts = doc.splitTextToSize(txt, W - M * 2);
      parts.forEach(p => { if (y > doc.internal.pageSize.getHeight() - M) { doc.addPage(); y = M; } doc.text(p, M, y); y += gap; });
    };
    doc.setFillColor(20, 20, 23); doc.rect(0, 0, W, 34, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text('IMS · Forzy — Ordem de Serviço', M, 22);
    doc.setTextColor(20, 20, 23); y = 60;

    line(_os.numero, 16, 'bold', 22);
    line(`Ativo: ${_os.ativo}  ·  ${_os.eixo}`, 10, 'normal', 14);
    line(`Aberta em: ${new Date(_os.criada_em).toLocaleString('pt-BR')}`, 10, 'normal', 14);
    line(`Prioridade: ${_os.prioridade} — ${_os.prioridade_label}`, 10, 'bold', 20);

    line('Diagnóstico', 12, 'bold', 18);
    line(`${_os.modo_falha}  (confiança ${_os.confianca}%)`, 10, 'normal', 14);
    line(_os.causa_provavel, 10, 'normal', 14);
    y += 6;

    if (doc.autoTable) {
      doc.autoTable({
        startY: y, margin: { left: M, right: M },
        head: [['Grandeza', 'Valor', 'Z-score', 'Faixa']],
        body: _os.evidencias.map(e => [e.grandeza, `${e.valor} ${e.unidade}`, `Z ${e.zscore}`, e.faixa]),
        styles: { fontSize: 9 }, headStyles: { fillColor: [40, 40, 46] },
      });
      y = doc.lastAutoTable.finalY + 20;
    }

    if (_os.rede) {
      line('Rede neural (autoencoder — dataset Forzy)', 12, 'bold', 18);
      line(`Índice de anomalia ${_os.rede.indice} (crítico a partir de ${_os.rede.limite_critico}) — ${_os.rede.nivel}`, 10, 'normal', 14);
      line(_os.rede.explicacao, 10, 'normal', 14);
      y += 6;
    }

    line('Ações recomendadas', 12, 'bold', 18);
    _os.acoes.forEach((a, i) => line(`${i + 1}. ${a}`, 10, 'normal', 14));
    y += 6;
    line('Peças / insumos', 12, 'bold', 18);
    line(_os.pecas.join(', '), 10, 'normal', 14);
    y += 6;
    line(`Norma de referência: ${_os.norma}`, 9, 'italic', 14);
    y += 10;
    if (_os.refino_ia) { line('Complemento (IA)', 12, 'bold', 18); line(_os.refino_ia, 10, 'normal', 14); y += 6; }
    line(`Responsável: ${_os.responsavel || '__________________________'}`, 10, 'normal', 16);
    line(`Prazo: ${_os.prazo || '____ / ____ / ______'}`, 10, 'normal', 16);
    line('Assinatura: __________________________', 10, 'normal', 16);

    doc.save(`${_os.numero}.pdf`);
  }

  /* ----------  Refino por IA (OpenAI gpt-4o-mini)  ---------- */
  async function refinarComIA() {
    const btn = _root.querySelector('#copIA');
    const key = window.FORZY_OPENAI_KEY;
    if (!key) { toast('Configure config.js'); return; }
    btn.disabled = true; btn.textContent = 'Consultando IA…';
    try {
      const ehOperador = !!(window.FZPerfil && window.FZPerfil.isOperador && window.FZPerfil.isOperador());
      const prompt = ehOperador
        ? `Você fala com um operador de chão de fábrica. A partir da Ordem de Serviço abaixo, responda em no máximo 3 frases curtas, ` +
          `sem jargão: o que fazer primeiro, o que checar e o risco de não agir. Não repita o texto da OS.\n\n${osTexto()}`
        : `Você é um engenheiro de manutenção preditiva de bombas centrífugas. ` +
          `A partir da Ordem de Serviço abaixo, gere um complemento técnico curto (máx. 180 palavras) em português: ` +
          `confirme ou ajuste o modo de falha, cite 2-3 verificações adicionais objetivas e o risco de não agir. ` +
          `Não repita o texto da OS.\n\n${osTexto()}`;
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.4, max_tokens: 400,
        }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const txt = (data.choices && data.choices[0] && data.choices[0].message.content || '').trim();
      _os.refino_ia = txt;
      // atualiza no log
      const log = lerLog();
      const idx = log.findIndex(o => o.numero === _os.numero);
      if (idx >= 0) { log[idx].refino_ia = txt; try { localStorage.setItem(OS_LOG_KEY, JSON.stringify(log)); } catch (e) { /* noop */ } }
      mostrarRefino(txt);
    } catch (e) {
      toast('Falha ao consultar a IA: ' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Refinar com IA';
    }
  }
  function mostrarRefino(txt) {
    const box = _root.querySelector('#copRefinoBox');
    if (!box) return;
    box.hidden = false;
    box.innerHTML = `<div class="fz-card-title">Complemento técnico (IA)</div><p>${esc(txt)}</p>`;
  }

  /* ----------  toast simples  ---------- */
  function toast(msg) {
    let t = document.getElementById('copToast');
    if (!t) { t = el('div', 'fz-cop-toast'); t.id = 'copToast'; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add('show');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /* ===================================================================
     INIT
     =================================================================== */
  function init() {
    _root = document.getElementById('copilotoRoot');
    if (!_root) return;
    render();
    if (window.lucide) lucide.createIcons();
  }

  // deep-link do rail de alertas: abre a tela Diagnóstico na sub-aba "Ordem de Serviço"
  // já com o eixo/ativo do alarme selecionado e o diagnóstico recalculado.
  function abrirPara(eixo, ativoCod) {
    if (eixo === 'm1' || eixo === 'm2') _eixo = eixo;
    if (ativoCod) _ativo = ativoCod;
    _os = null;
    if (typeof window.showScreen === 'function') window.showScreen('diagnostico');
    const aba = document.querySelector('#fzDiagTabs .fz-tab[data-dtab="os"]');
    if (aba) aba.click();
    init();
    render();
  }

  // pior leitura da série para um eixo — o frame que mais estoura os limites
  // combinados (vel/acel/temp normalizados pelo nível de alarme). Usado pelas
  // sub-abas Investigação / Causa Raiz / Projeção.
  function piorLeitura(eixo) {
    if (!F) return null;
    const pfx = eixo === 'm2' ? 'm2' : 'm1';
    const V = F[pfx].vel, A = F[pfx].acel, T = F[pfx].temp;
    let idx = 0, best = -Infinity;
    for (let i = 0; i < V.length; i++) {
      const s = V[i] / LIM.vel.al + A[i] / LIM.acel.al + T[i] / LIM.temp.al;
      if (s > best) { best = s; idx = i; }
    }
    return {
      idx,
      m1_vel: F.m1.vel[idx], m1_acel: F.m1.acel[idx], m1_temp: F.m1.temp[idx],
      m2_vel: F.m2.vel[idx], m2_acel: F.m2.acel[idx], m2_temp: F.m2.temp[idx],
    };
  }

  window.FZCopiloto = { init, render, abrirPara, diagnosticar, leituraAtual, zscore, MODOS, LIM, piorLeitura };
})();
