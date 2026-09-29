/* investigacao.js: sub-aba de Investigacao (vista explodida do motor) */

(function () {
  // protege o texto contra HTML/XSS antes de ir pro innerHTML
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v, d = 2) => (v == null || v !== v) ? '—' : Number(v).toFixed(d);

  let _root = null, _eixo = 'm1', _ativo = null, _explodido = false, _sel = null, _diag = null;
  let _momento = 'auto';

  // lista os ativos cadastrados
  function ativos() {
    try { return (window.FZStore && window.FZStore.getAtivosIndustrial()) || []; } catch (e) { return []; }
  }
  // hora do maior pico de vibracao
  function horaPico(idx) {
    const F = window.FORZY;
    try {
      const seg = (F.t && F.t[idx] != null) ? F.t[idx] : 0;
      return new Date(Date.parse(F.meta.t0) + seg * 1000).toLocaleString('pt-BR');
    } catch (e) { return null; }
  }
  // leitura no instante escolhido
  function leituraDoMomento() {
    let now = null;
    try { now = window.FZCopiloto.leituraAtual(); } catch (e) {  }
    const bad = window.FZCopiloto.piorLeitura(_eixo);
    if (_momento === 'atual') return { r: now, tag: 'leitura atual', idx: null };
    if (_momento === 'pior') return { r: bad, tag: 'pior momento da série', idx: bad ? bad.idx : null };
    if (now) {
      const d = window.FZCopiloto.diagnosticar(now, _eixo);
      if (d.key !== 'normal') return { r: now, tag: 'leitura atual', idx: null };
    }
    return bad ? { r: bad, tag: 'pior momento da série', idx: bad.idx } : { r: now, tag: 'leitura atual', idx: null };
  }
  // cor pela prioridade do alarme
  function corDaPrioridade(p) {
    return p === 'P1' ? 'var(--fz-bad)' : p === 'P2' ? 'var(--fz-warn)' : 'var(--fz-ok)';
  }

  const PARTS = [
    { id: 'ventilacao',  d: 'M6,38 h10 v24 h-10 z M8,34 h6 v32 h-6 z' },
    { id: 'rolamento_ld',d: 'M24,42 a6,8 0 1 0 0.01,0 z' },
    { id: 'carcaca',     d: 'M28,30 h44 a6,6 0 0 1 6,6 v28 a6,6 0 0 1 -6,6 h-44 a6,6 0 0 1 -6,-6 v-28 a6,6 0 0 1 6,-6 z' },
    { id: 'estator',     d: 'M31,33 h38 v8 h-38 z M31,59 h38 v8 h-38 z' },
    { id: 'rotor',       d: 'M50,50 m-13,0 a13,10 0 1 0 26,0 a13,10 0 1 0 -26,0 z' },
    { id: 'eixo',        d: 'M18,47 h74 v6 h-74 z' },
    { id: 'rolamento_la',d: 'M76,42 a6,8 0 1 0 0.01,0 z' },
  ];

  // vista explodida do motor em SVG
  function svgMotor() {
    const suspeitos = (window.FZFMEA && _diag) ? window.FZFMEA.componentesDoModo(_diag.key) : [];
    const sev = _diag ? _diag.prioridade : 'P3';
    const parts = PARTS.map(p => {
      const c = (window.FZFMEA.COMPONENTES.find(x => x.id === p.id)) || { dx: 0, dy: 0 };
      const off = _explodido ? `translate(${(c.dx * 0.7).toFixed(1)} ${(c.dy * 0.7).toFixed(1)})` : 'translate(0 0)';
      const rank = suspeitos.indexOf(p.id);
      let cls = 'fz-xv-part';
      if (rank === 0) cls += ' fz-xv-sev-' + sev + ' fz-xv-primario';
      else if (rank > 0) cls += ' fz-xv-sev-' + sev;
      if (_sel === p.id) cls += ' fz-xv-sel';
      return `<g class="fz-xv-g" data-part="${p.id}" transform="${off}">
        <path class="${cls}" d="${p.d}"/>
      </g>`;
    }).join('');
    return `<svg class="fz-xv-svg ${_explodido ? 'exploded' : ''}" viewBox="0 0 100 100" role="img"
      aria-label="Corte do motor — componentes selecionáveis">
      <line x1="8" y1="82" x2="92" y2="82" class="fz-xv-ground"/>
      ${parts}
    </svg>`;
  }

  // mini grafico de uma grandeza
  function sparkGrandeza(col) {
    const F = window.FORZY; if (!F) return '';
    const src = F[_eixo] && F[_eixo][col]; if (!src) return '';
    const arr = src.slice(-140);
    const lim = window.FZCopiloto.LIM[col] || { a: 0, al: 0 };
    const mx = Math.max(lim.al * 1.1, ...arr) || 1;
    const w = 260, h = 54;
    const pts = arr.map((v, i) => `${(i / (arr.length - 1) * w).toFixed(1)},${(h - v / mx * h).toFixed(1)}`).join(' ');
    const yA = h - lim.a / mx * h, yAl = h - lim.al / mx * h;
    return `<svg class="fz-xv-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <line x1="0" x2="${w}" y1="${yA.toFixed(1)}" y2="${yA.toFixed(1)}" class="fz-xv-lim-a"/>
      <line x1="0" x2="${w}" y1="${yAl.toFixed(1)}" y2="${yAl.toFixed(1)}" class="fz-xv-lim-al"/>
      <polyline points="${pts}" class="fz-xv-spark-line"/>
    </svg>`;
  }

  // painel de detalhe do componente
  function painel() {
    if (!_sel) {
      return `<div class="fz-card fz-xv-panel">
        <div class="fz-card-title">Componente</div>
        <p class="fz-cop-sub">Selecione um componente no corte ao lado. Os componentes destacados
        são os associados ao modo de falha atual do Copiloto.</p>
      </div>`;
    }
    const nome = window.FZFMEA.nomeComponente(_sel);
    const suspeitos = _diag ? window.FZFMEA.componentesDoModo(_diag.key) : [];
    const rank = suspeitos.indexOf(_sel);
    const estado = rank === 0 ? 'Componente mais provável da falha'
      : rank > 0 ? 'Componente possivelmente envolvido'
      : 'Sem indício direto de falha neste componente';
    const cor = rank >= 0 ? corDaPrioridade(_diag.prioridade) : 'var(--fz-ok)';

    const evRows = _diag.evidencias.map(e => {
      const st = e.v >= e.lim.al ? 'bad' : e.v >= e.lim.a ? 'warn' : 'ok';
      return `<tr><td>${esc(e.k)}</td><td><b>${fmt(e.v)}</b> ${esc(e.unit)}</td>
        <td>Z ${fmt(e.z, 1)}</td>
        <td><span class="fz-cop-tag fz-cop-${st}">${st === 'bad' ? 'ALARME' : st === 'warn' ? 'ALERTA' : 'normal'}</span></td></tr>`;
    }).join('');

    const rep = window.FZFMEA.reparo(_diag.key);
    const acoes = rank >= 0 ? _diag.acoes : ['Manter inspeção sensitiva na periodicidade padrão.'];
    const grandeza = _sel.startsWith('rolamento') ? 'acel' : _sel === 'ventilacao' || _sel === 'estator' ? 'temp' : 'vel';

    return `<div class="fz-card fz-xv-panel">
      <div class="fz-xv-panel-head">
        <div>
          <div class="fz-eyebrow">Componente</div>
          <div class="fz-xv-panel-nome">${esc(nome)}</div>
        </div>
        <span class="fz-cop-tag" style="background:${cor}22;color:${cor};border:1px solid ${cor}">
          ${rank === 0 ? 'SUSPEITO PRINCIPAL' : rank > 0 ? 'SUSPEITO' : 'OK'}</span>
      </div>
      <p class="fz-xv-estado">${esc(estado)}</p>

      <div class="fz-card-title">Evidências (eixo ${_eixo === 'm2' ? '2' : '1'})</div>
      <table class="fz-cop-table"><tbody>${evRows}</tbody></table>

      <div class="fz-card-title">Histórico — ${grandeza === 'acel' ? 'Aceleração' : grandeza === 'temp' ? 'Temperatura' : 'Velocidade'} RMS</div>
      ${sparkGrandeza(grandeza)}

      <div class="fz-card-title">Risco</div>
      <p class="fz-xv-estado">${esc(_diag.prioridade)} — ${esc(_diag.prioridadeLabel)} · confiança do diagnóstico ${_diag.confianca}%</p>

      <div class="fz-card-title">Diagnóstico associado</div>
      <p class="fz-xv-estado">${esc(_diag.modo)}</p>
      <p class="fz-cop-sub">${esc(_diag.causa)}</p>

      <div class="fz-card-title">Recomendação</div>
      <ol class="fz-xv-acoes">${acoes.map(a => `<li>${esc(a)}</li>`).join('')}</ol>
      <p class="fz-cop-sub"><b>Tem conserto?</b> ${esc(rep.reparavel)}</p>

      <div class="fz-xv-panel-cta">
        <button class="fz-btn" data-dtab-goto="rca">Abrir análise de causa raiz</button>
        <button class="fz-btn ghost" data-dtab-goto="os">Gerar Ordem de Serviço</button>
      </div>
    </div>`;
  }

  // desenha a tela
  function render() {
    if (!_root) return;
    const mom = leituraDoMomento();
    if (!mom.r) { _root.innerHTML = '<div class="fz-card">Dataset não carregado.</div>'; return; }
    _diag = window.FZCopiloto.diagnosticar(mom.r, _eixo);

    const list = ativos();
    if (!_ativo && list.length) _ativo = list[0].codigo;
    const cor = corDaPrioridade(_diag.prioridade);
    const momTxt = mom.tag + (mom.idx != null && horaPico(mom.idx) ? ' · ' + horaPico(mom.idx) : '');

    _root.innerHTML = `
      <div class="fz-cop-controls fz-card">
        <label>Ativo
          <select id="xvAtivo">
            ${list.length ? list.map(a => `<option value="${esc(a.codigo)}" ${a.codigo === _ativo ? 'selected' : ''}>${esc(a.codigo)} — ${esc(a.descricao || '')}</option>`).join('')
              : '<option value="">(nenhum ativo cadastrado)</option>'}
          </select>
        </label>
        <label>Eixo
          <select id="xvEixo">
            <option value="m1" ${_eixo === 'm1' ? 'selected' : ''}>Eixo 1</option>
            <option value="m2" ${_eixo === 'm2' ? 'selected' : ''}>Eixo 2</option>
          </select>
        </label>
        <label>Momento
          <select id="xvMomento">
            <option value="auto"  ${_momento === 'auto' ? 'selected' : ''}>Automático</option>
            <option value="atual" ${_momento === 'atual' ? 'selected' : ''}>Leitura atual</option>
            <option value="pior"  ${_momento === 'pior' ? 'selected' : ''}>Pior momento da série</option>
          </select>
        </label>
        <button class="fz-btn" id="xvExplode">${_explodido ? 'Recolher modelo' : 'Explodir modelo'}</button>
        <button class="fz-btn ghost" id="xvRefresh">Recalcular</button>
      </div>

      <div class="fz-xv-diagbar" style="border-left:3px solid ${cor}">
        <b>${esc(_diag.modo)}</b>
        <span class="fz-cop-tag" style="background:${cor}22;color:${cor};border:1px solid ${cor}">${_diag.prioridade} · ${esc(_diag.prioridadeLabel)}</span>
        <span class="fz-cop-conf">Confiança ${_diag.confianca}%</span>
        <span class="fz-cop-sub">Base: ${esc(momTxt)}</span>
      </div>

      <div class="fz-xv-grid">
        <div class="fz-card fz-xv-stage">
          ${svgMotor()}
          <div class="fz-xv-legend">
            ${window.FZFMEA.COMPONENTES.map(c => `<button class="fz-xv-legrow" data-part="${c.id}">
              <span class="fz-xv-dot" data-part="${c.id}"></span>${esc(c.nome)}</button>`).join('')}
          </div>
        </div>
        <div id="xvPanel">${painel()}</div>
      </div>
    `;

    _root.querySelector('#xvAtivo').addEventListener('change', e => { _ativo = e.target.value; render(); });
    _root.querySelector('#xvEixo').addEventListener('change', e => { _eixo = e.target.value; _sel = null; render(); });
    _root.querySelector('#xvMomento').addEventListener('change', e => { _momento = e.target.value; render(); });
    _root.querySelector('#xvExplode').addEventListener('click', () => { _explodido = !_explodido; render(); });
    _root.querySelector('#xvRefresh').addEventListener('click', render);
    _root.querySelectorAll('[data-part]').forEach(elp => {
      elp.addEventListener('click', () => { _sel = elp.dataset.part; render(); });
    });
    _root.querySelectorAll('[data-dtab-goto]').forEach(b =>
      b.addEventListener('click', () => {
        const t = document.querySelector('#fzDiagTabs .fz-tab[data-dtab="' + b.dataset.dtabGoto + '"]');
        if (t) t.click();
      }));

    if (window.lucide) lucide.createIcons();
  }

  // liga a tela (roda so na primeira visita)
  function init() {
    _root = document.getElementById('investigacaoRoot');
    if (!_root) return;
    render();
  }

  // abre ja no ativo do alarme
  function abrirPara(eixo, ativoCod) {
    if (eixo === 'm1' || eixo === 'm2') _eixo = eixo;
    if (ativoCod) _ativo = ativoCod;
    _sel = null;
    _explodido = true;
    if (typeof window.showScreen === 'function') window.showScreen('diagnostico');
    const aba = document.querySelector('#fzDiagTabs .fz-tab[data-dtab="investigacao"]');
    if (aba) aba.click();
    init();
    render();
  }

  window.FZInvestigacao = { init, render, abrirPara };
})();
