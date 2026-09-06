/* ===================================================================
   FORZY · Alerta "na cara" — modal crítico persistente + faixa de alerta
   Disparado por topbar.js quando o modelo aponta P1 (vermelho) ou P2 (amarelo).

   ISA-18.2: só o alarme crítico (P1) exige RECONHECIMENTO do operador →
   modal full-viewport que NÃO some sozinho (mesmo que o dataset volte ao
   normal no frame seguinte). P2 (amarelo) → faixa fixa no topo, não bloqueante.

     window.FZAlertaCritico = { disparar(payload), faixa(payload), limpar(chave?) }
     payload = { prioridade, titulo, msg, nivel, valor, unidade, origem, eixo, variavel }
   =================================================================== */
(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const perfilOperador = () => !!(window.FZPerfil && window.FZPerfil.isOperador());

  // eixo 'm1'/'m2' (ou texto) → índice 1/2 e código do ativo do seed
  function eixoInfo(eixo) {
    const s = String(eixo || '').toLowerCase();
    if (s.includes('m2') || s.includes('2') || s.includes('eixo 2')) return { idx: 2, nome: 'Eixo 2', cod: 'BBA-002' };
    if (s.includes('m1') || s.includes('1') || s.includes('eixo 1')) return { idx: 1, nome: 'Eixo 1', cod: 'BBA-001' };
    return { idx: 1, nome: 'Eixo', cod: null };
  }

  // fallback textual (não é RAG — a versão em camadas é item de média prioridade)
  const CONHECIMENTO = {
    vel: {
      norma: 'ISO 10816: até 1,8 mm/s = normal · 1,8–4,5 mm/s = alerta · acima de 4,5 mm/s = dano iminente.',
      manual: 'Manual do motor (WEG): vibração acima da faixa indica desbalanceamento, desalinhamento ou folga em mancal. Parar e inspecionar acoplamento e fixação da base.',
      datasheet: 'Sensor MPU6050: acelerômetro ±2 g, faixa de vibração medida por RMS convertido em mm/s a 50 Hz. Ruído típico 400 µg/√Hz.',
    },
    temp: {
      norma: 'Alerta a partir de 35 °C acima do ambiente · crítico a partir de 42 °C — risco de degradar o isolamento do enrolamento e o lubrificante do mancal.',
      manual: 'Manual do motor (WEG): sobretemperatura pede verificar carga, ventilação, tensão de alimentação e estado do rolamento. Classe de isolamento F (155 °C máx).',
      datasheet: 'Sensor MPU6050: sensor de temperatura interno, faixa -40 a 85 °C, precisão ±1 °C — leitura reflete a temperatura do corpo do sensor junto à carcaça.',
    },
  };

  function verVar(variavel) {
    const v = String(variavel || '').toLowerCase();
    if (v.includes('temp')) return 'temp';
    return 'vel';
  }

  // frase curta pro operador
  function veredito(p) {
    const e = eixoInfo(p.eixo);
    const val = (p.valor != null && !isNaN(p.valor))
      ? `${Number(p.valor).toFixed(verVar(p.variavel) === 'temp' ? 1 : 2)} ${esc(p.unidade || '')}`.trim()
      : '';
    if (verVar(p.variavel) === 'temp') {
      return `${e.nome}: temperatura alta${val ? ' (' + val + ')' : ''}. Motor esquentando — reduza a carga e chame a manutenção.`;
    }
    return `${e.nome}: vibração alta${val ? ' (' + val + ')' : ''}. O motor está vibrando fora do normal — pare a bomba e chame a manutenção.`;
  }

  /* -------------------- estado -------------------- */
  const pendentes = [];        // fila de alertas P1 não reconhecidos
  const reconhecidas = new Set();
  let idxAtual = 0;

  function chaveDe(p) { return (p.prioridade || '') + '|' + (p.msg || ''); }

  /* -------------------- MODAL P1 -------------------- */
  function disparar(payload) {
    if (!payload) return;
    const chave = chaveDe(payload);
    if (reconhecidas.has(chave)) return;
    if (pendentes.some(p => p._chave === chave)) { render(); return; }
    pendentes.push({ ...payload, _chave: chave, _hora: new Date() });
    idxAtual = pendentes.length - 1;
    render();
  }

  function fecharAtual() {
    const p = pendentes[idxAtual];
    if (p) { reconhecidas.add(p._chave); pendentes.splice(idxAtual, 1); }
    idxAtual = Math.max(0, Math.min(idxAtual, pendentes.length - 1));
    render();
  }

  function irPara(scada) {
    const p = pendentes[idxAtual];
    fecharAtual();
    if (!p) return;
    const e = eixoInfo(p.eixo);
    if (scada) {
      if (window.showScreen) window.showScreen('scada');
      setTimeout(() => {
        const tab = document.querySelector('#scadaTabs .fz-tab[data-stab="p3d"]');
        if (tab) tab.click();
        if (window.FZScada && window.FZScada.show3D) window.FZScada.show3D(e.idx);
      }, 60);
    } else {
      if (window.showScreen) window.showScreen('assistente');
      setTimeout(() => {
        if (window.FZAssistente && window.FZAssistente.abrirComContexto) window.FZAssistente.abrirComContexto(p);
      }, 80);
    }
  }

  function render() {
    let host = document.getElementById('fz-alerta-critico');
    if (!pendentes.length) { if (host) host.remove(); return; }
    const p = pendentes[idxAtual] || pendentes[0];
    const e = eixoInfo(p.eixo);
    const vv = verVar(p.variavel);
    const conh = CONHECIMENTO[vv] || CONHECIMENTO.vel;
    const hora = p._hora.toLocaleString('pt-BR');
    const val = (p.valor != null && !isNaN(p.valor))
      ? `${Number(p.valor).toFixed(vv === 'temp' ? 1 : 2)} ${esc(p.unidade || '')}`.trim() : '—';

    const corpo = perfilOperador()
      ? `<p class="fz-ac-verdito">${esc(veredito(p))}</p>
         <p class="fz-ac-sub">Detectado às ${esc(hora)}.</p>`
      : `<div class="fz-ac-grid">
           <div><span>Equipamento</span><b>${esc(e.nome)}${p.origem ? ' · ' + esc(String(p.origem)) : ''}</b></div>
           <div><span>Variável</span><b>${vv === 'temp' ? 'Temperatura' : 'Vibração (vel. RMS)'}</b></div>
           <div><span>Valor medido</span><b>${val}</b></div>
           <div><span>Momento</span><b>${esc(hora)}</b></div>
         </div>
         <p class="fz-ac-linha"><b>Norma:</b> ${esc(conh.norma)}</p>
         <p class="fz-ac-linha"><b>${esc(conh.manual.split(':')[0])}:</b> ${esc(conh.manual.split(':').slice(1).join(':').trim())}</p>
         <p class="fz-ac-linha"><b>${esc(conh.datasheet.split(':')[0])}:</b> ${esc(conh.datasheet.split(':').slice(1).join(':').trim())}</p>`;

    const nav = pendentes.length > 1
      ? `<div class="fz-ac-nav">Alerta ${idxAtual + 1} de ${pendentes.length}
           <button data-act="prev" ${idxAtual === 0 ? 'disabled' : ''}>‹</button>
           <button data-act="next" ${idxAtual === pendentes.length - 1 ? 'disabled' : ''}>›</button></div>`
      : '';

    const html = `
      <div class="fz-ac-box" role="alertdialog" aria-modal="true">
        <div class="fz-ac-head">
          <span class="fz-ac-badge">${esc(p.prioridade || 'P1 - Crítico')}</span>
          <strong>${esc(p.titulo || 'Alerta crítico')}</strong>
        </div>
        <div class="fz-ac-body">${corpo}</div>
        ${nav}
        <div class="fz-ac-actions">
          <button class="fz-ac-btn ghost" data-act="scada">Ver na Vista 3D</button>
          <button class="fz-ac-btn ghost" data-act="assistente">Abrir Assistente</button>
          <button class="fz-ac-btn primary" data-act="ok">Reconhecer</button>
        </div>
      </div>`;

    if (!host) {
      host = document.createElement('div');
      host.id = 'fz-alerta-critico';
      document.body.appendChild(host);
    }
    host.innerHTML = html;
    host.querySelector('[data-act="ok"]').onclick = fecharAtual;
    host.querySelector('[data-act="scada"]').onclick = () => irPara(true);
    host.querySelector('[data-act="assistente"]').onclick = () => irPara(false);
    const prev = host.querySelector('[data-act="prev"]');
    const next = host.querySelector('[data-act="next"]');
    if (prev) prev.onclick = () => { idxAtual = Math.max(0, idxAtual - 1); render(); };
    if (next) next.onclick = () => { idxAtual = Math.min(pendentes.length - 1, idxAtual + 1); render(); };
  }

  /* -------------------- FAIXA P2 -------------------- */
  const faixas = [];   // { chave, texto }
  function faixa(payload) {
    if (!payload) return;
    const chave = chaveDe(payload);
    if (faixas.some(f => f.chave === chave)) return;
    faixas.push({ chave, texto: `${payload.titulo || 'Alerta'} — ${payload.msg || ''}` });
    renderFaixa();
  }

  function limpar(chave) {
    if (chave == null) { faixas.length = 0; }
    else {
      const i = faixas.findIndex(f => f.chave === chave);
      if (i !== -1) faixas.splice(i, 1);
    }
    renderFaixa();
  }

  function renderFaixa() {
    let host = document.getElementById('fz-alerta-faixa');
    if (!faixas.length) { if (host) host.remove(); return; }
    if (!host) {
      host = document.createElement('div');
      host.id = 'fz-alerta-faixa';
      document.body.appendChild(host);
    }
    const f = faixas[faixas.length - 1];
    host.innerHTML = `
      <span class="fz-af-dot"></span>
      <span class="fz-af-txt">${esc(f.texto)}</span>
      ${faixas.length > 1 ? `<span class="fz-af-mais">+${faixas.length - 1}</span>` : ''}
      <button class="fz-af-x" title="Dispensar">✕</button>`;
    host.querySelector('.fz-af-x').onclick = () => limpar(f.chave);
  }

  window.FZAlertaCritico = { disparar, faixa, limpar };
})();
