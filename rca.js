/* rca.js: sub-aba de Causa Raiz (RCA) do motor */

(function () {
  // protege o texto contra HTML/XSS antes de ir pro innerHTML
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v, d = 2) => (v == null || v !== v) ? '—' : Number(v).toFixed(d);
  const RCA_LOG = 'forzy-rca-log';

  let _root = null, _eixo = 'm1', _ativo = null, _rep = null;

  // lista os ativos cadastrados
  function ativos() {
    try { return (window.FZStore && window.FZStore.getAtivosIndustrial()) || []; } catch (e) { return []; }
  }
  // texto de quando o evento aconteceu
  function quando(F, i) {
    try {
      const base = Date.parse(F.meta.t0);
      const seg = (F.t && F.t[i] != null) ? F.t[i] : (i * (F.meta.dur_s || 0) / F.meta.n);
      return new Date(base + seg * 1000);
    } catch (e) { return null; }
  }
  // formata hora:min:seg
  const hhmmss = d => d ? d.toLocaleTimeString('pt-BR') : '—';
  // formata dia/mes
  const dm = d => d ? d.toLocaleString('pt-BR') : '—';

  // monta a linha do tempo ate o estopim
  function analisar(eixo) {
    const F = window.FORZY;
    if (!F || !F[eixo]) return null;
    const LIM = window.FZCopiloto.LIM;
    const vel = F[eixo].vel, acel = F[eixo].acel, temp = F[eixo].temp;
    const n = vel.length;
    const grand = [
      { col: 'vel',  arr: vel,  nome: 'Velocidade RMS', unit: LIM.vel.unit,  a: LIM.vel.a,  al: LIM.vel.al },
      { col: 'acel', arr: acel, nome: 'Aceleração RMS', unit: LIM.acel.unit, a: LIM.acel.a, al: LIM.acel.al },
      { col: 'temp', arr: temp, nome: 'Temperatura',    unit: LIM.temp.unit, a: LIM.temp.a, al: LIM.temp.al },
    ];

    const eventos = [];
    const primeiraSubida = {};
    const primeiroAlarme = {};
    const abruptas = [];

    for (const g of grand) {
      const w0 = Math.max(20, Math.floor(n * 0.1));
      let m = 0; for (let k = 0; k < w0; k++) m += g.arr[k]; m /= w0;
      let sd = 0; for (let k = 0; k < w0; k++) sd += (g.arr[k] - m) ** 2; sd = Math.sqrt(sd / w0) || 0.001;

      for (let i = 1; i < n; i++) {
        const x = g.arr[i], p = g.arr[i - 1];
        if (primeiraSubida[g.col] == null && x >= g.a) {
          primeiraSubida[g.col] = i;
          eventos.push({ i, txt: `${g.nome} cruza o nível de atenção (${fmt(x)} ${g.unit}, limite ${g.a})` });
        }
        if (primeiroAlarme[g.col] == null && x >= g.al) {
          primeiroAlarme[g.col] = i;
          eventos.push({ i, txt: `${g.nome} atinge nível de ALARME (${fmt(x)} ${g.unit}, limite ${g.al})`, hot: true });
        }
        if (Math.abs(x - p) > 4 * sd && Math.abs(x - p) > 0.05) {
          abruptas.push({ i, col: g.col, de: p, para: x, nome: g.nome, unit: g.unit });
        }
      }
    }

    const idxSubidas = Object.values(primeiraSubida).filter(v => v != null);
    const iPrimeiro = idxSubidas.length ? Math.min(...idxSubidas) : null;
    let iDeteccao = null;
    const alarmes = Object.values(primeiroAlarme).filter(v => v != null);
    if (alarmes.length) iDeteccao = Math.min(...alarmes);
    else {
      for (let i = 0; i < n && iDeteccao == null; i++) {
        let c = 0; for (const g of grand) if (g.arr[i] >= g.a) c++;
        if (c >= 2) iDeteccao = i;
      }
    }
    let estopim = null;
    if (abruptas.length) {
      const cand = iDeteccao != null ? abruptas.filter(a => a.i <= iDeteccao + 5) : abruptas;
      estopim = (cand[0] || abruptas[0]);
    }

    if (abruptas[0]) eventos.push({ i: abruptas[0].i,
      txt: `Mudança abrupta em ${abruptas[0].nome}: ${fmt(abruptas[0].de)} → ${fmt(abruptas[0].para)} ${abruptas[0].unit}` });

    if (iDeteccao != null) eventos.push({ i: iDeteccao, txt: 'Sistema classifica a condição como anormal', hot: true });

    const pior = window.FZCopiloto.piorLeitura(eixo) || {};
    const iPico = pior.idx != null ? pior.idx : n - 1;
    eventos.push({ i: iPico, txt: `Pico do evento — vel ${fmt(vel[iPico])} ${LIM.vel.unit}, acel ${fmt(acel[iPico])} ${LIM.acel.unit}, temp ${fmt(temp[iPico])} ${LIM.temp.unit}`, hot: true });

    const last = n - 1;
    eventos.push({ i: last, txt: `Última leitura da série — vel ${fmt(vel[last])} ${LIM.vel.unit}, acel ${fmt(acel[last])} ${LIM.acel.unit}, temp ${fmt(temp[last])} ${LIM.temp.unit}` });

    eventos.sort((a, b) => a.i - b.i);
    const timeline = [];
    for (const e of eventos) {
      if (timeline.length && timeline[timeline.length - 1].txt === e.txt) continue;
      timeline.push({ hora: hhmmss(quando(F, e.i)), data: quando(F, e.i), txt: e.txt, hot: !!e.hot });
    }

    const reading = {
      m1_vel: F.m1.vel[iPico], m1_acel: F.m1.acel[iPico], m1_temp: F.m1.temp[iPico],
      m2_vel: F.m2.vel[iPico], m2_acel: F.m2.acel[iPico], m2_temp: F.m2.temp[iPico],
    };
    const diag = window.FZCopiloto.diagnosticar(reading, eixo);

    const sintomas = grand.filter(g => g.arr[iPico] >= g.a)
      .map(g => `${g.nome} em ${fmt(g.arr[iPico])} ${g.unit} (limite ${g.arr[iPico] >= g.al ? 'de alarme ' + g.al : 'de atenção ' + g.a})`);

    const ALT = {
      balanceamento: ['Folga em mancal ainda incipiente', 'Ressonância estrutural da base'],
      rolamento: ['Desalinhamento leve do acoplamento', 'Contaminação do lubrificante'],
      termico: ['Sobrecarga elétrica intermitente', 'Refrigeração parcialmente obstruída'],
      cavitacao: ['Aeração por vedação de sucção', 'Recirculação interna no impelidor'],
      severa: ['Duas falhas simultâneas (mancal + desalinhamento)', 'Dano secundário já instalado'],
      normal: [],
    };

    return {
      eixo, diag,
      pico: quando(F, iPico),
      primeiro: iPrimeiro != null ? quando(F, iPrimeiro) : null,
      deteccao: iDeteccao != null ? quando(F, iDeteccao) : null,
      estopim: estopim ? { txt: `Mudança abrupta em ${estopim.nome} (${fmt(estopim.de)} → ${fmt(estopim.para)} ${estopim.unit})`, hora: hhmmss(quando(F, estopim.i)) }
        : (iPrimeiro != null ? { txt: 'Elevação gradual sem gatilho abrupto identificável', hora: hhmmss(quando(F, iPrimeiro)) } : null),
      timeline, sintomas,
      alternativas: ALT[diag.key] || [],
      componentes: (window.FZFMEA ? window.FZFMEA.componentesDoModo(diag.key).map(id => window.FZFMEA.nomeComponente(id)) : []),
      reparo: window.FZFMEA ? window.FZFMEA.reparo(diag.key) : null,
      janela: { de: dm(quando(F, 0)), ate: dm(quando(F, last)) },
    };
  }

  // objeto do relatorio de causa raiz
  function reportObj(a) {
    const at = _ativo ? (window.FZStore.getAtivoPorCodigo(_ativo) || {}) : {};
    return {
      gerado_em: new Date().toISOString(),
      ativo: _ativo || '—',
      ativo_desc: at.descricao || '',
      fabricante: at.fabricante || '—',
      eixo: a.eixo === 'm2' ? 'Eixo 2' : 'Eixo 1',
      evento: a.diag.modo,
      severidade: a.diag.prioridade + ' — ' + a.diag.prioridadeLabel,
      primeiro_sinal: dm(a.primeiro),
      deteccao: dm(a.deteccao),
      pico: dm(a.pico),
      duracao: (a.primeiro && a.deteccao) ? Math.round((a.deteccao - a.primeiro) / 60000) + ' min' : '—',
      sintomas: a.sintomas,
      evidencias: a.diag.evidencias.map(e => `${e.k}: ${fmt(e.v)} ${e.unit} (Z ${fmt(e.z, 1)})`),
      timeline: a.timeline.map(t => `${t.hora} — ${t.txt}`),
      componente_provavel: a.componentes.join(', ') || '—',
      causa_provavel: a.diag.causa,
      estopim: a.estopim ? `${a.estopim.hora} — ${a.estopim.txt}` : '—',
      alternativas: a.alternativas,
      confianca: a.diag.confianca + '% (confiança do motor de regras, não probabilidade estatística)',
      evidencia_faltante: [
        'Análise espectral (FFT) das bandas características de rolamento e de rotação',
        'Corrente nas 3 fases vs. corrente nominal de placa',
        'Histórico de manutenção e de intervenções anteriores no ativo',
        'Inspeção sensitiva / boroscopia dos mancais',
      ],
      validacao_recomendada: [
        'Confirmar o modo de falha com o técnico responsável antes de executar a OS',
        'Medição de vibração com coletor calibrado no ponto do mancal',
        a.diag.prioridade === 'P1' ? 'Aprovação obrigatória de parada pelo supervisor de operação' : 'Registrar a decisão no histórico do ativo',
      ],
      reparo: a.reparo,
      janela: a.janela,
    };
  }

  // desenha a tela
  function render() {
    if (!_root) return;
    if (!window.FORZY) { _root.innerHTML = '<div class="fz-card">Dataset não carregado.</div>'; return; }
    const list = ativos();
    if (!_ativo && list.length) _ativo = list[0].codigo;

    _root.innerHTML = `
      <div class="fz-cop-controls fz-card">
        <label>Ativo
          <select id="rcAtivo">
            ${list.length ? list.map(a => `<option value="${esc(a.codigo)}" ${a.codigo === _ativo ? 'selected' : ''}>${esc(a.codigo)} — ${esc(a.descricao || '')}</option>`).join('')
              : '<option value="">(nenhum ativo cadastrado)</option>'}
          </select>
        </label>
        <label>Eixo
          <select id="rcEixo">
            <option value="m1" ${_eixo === 'm1' ? 'selected' : ''}>Eixo 1</option>
            <option value="m2" ${_eixo === 'm2' ? 'selected' : ''}>Eixo 2</option>
          </select>
        </label>
        <button class="fz-btn fz-btn-primary" id="rcGerar">Gerar análise de causa raiz</button>
      </div>
      <div id="rcOut"></div>
      <div class="fz-card fz-cop-hist">
        <div class="fz-card-title">Histórico de análises (${lerLog().length})</div>
        <div id="rcHist"></div>
      </div>`;

    _root.querySelector('#rcAtivo').addEventListener('change', e => { _ativo = e.target.value; });
    _root.querySelector('#rcEixo').addEventListener('change', e => { _eixo = e.target.value; });
    _root.querySelector('#rcGerar').addEventListener('click', gerar);
    renderHist();
  }

  // gera o relatorio
  function gerar() {
    const a = analisar(_eixo);
    if (!a) { _root.querySelector('#rcOut').innerHTML = '<div class="fz-card">Sem dados para o eixo selecionado.</div>'; return; }
    _rep = reportObj(a);
    gravarLog({ gerado_em: _rep.gerado_em, ativo: _rep.ativo, eixo: _rep.eixo, evento: _rep.evento, severidade: _rep.severidade });
    renderReport(a);
    renderHist();
    _root.querySelector('#rcOut').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // desenha o relatorio
  function renderReport(a) {
    const host = _root.querySelector('#rcOut');
    const cor = a.diag.prioridade === 'P1' ? 'var(--fz-bad)' : a.diag.prioridade === 'P2' ? 'var(--fz-warn)' : 'var(--fz-ok)';
    const tl = a.timeline.map(t => `<li class="${t.hot ? 'hot' : ''}"><span class="rc-h">${esc(t.hora)}</span><span>${esc(t.txt)}</span></li>`).join('');
    const semChave = !window.FORZY_OPENAI_KEY;
    host.innerHTML = `
      <div class="fz-card fz-rc-report">
        <div class="fz-cop-os-head">
          <div><div class="fz-eyebrow">Análise de Causa Raiz</div>
            <div class="fz-cop-os-num">${esc(a.diag.modo)}</div></div>
          <span class="fz-cop-tag" style="background:${cor}22;color:${cor};border:1px solid ${cor}">${esc(a.diag.prioridade)} · ${esc(a.diag.prioridadeLabel)}</span>
        </div>

        <div class="fz-cop-os-grid">
          <div><span>Ativo</span><b>${esc(_rep.ativo)} · ${esc(_rep.eixo)}</b></div>
          <div><span>Janela analisada</span><b>${esc(a.janela.de)} → ${esc(a.janela.ate)}</b></div>
          <div><span>Primeiro sinal</span><b>${esc(_rep.primeiro_sinal)}</b></div>
          <div><span>Detecção</span><b>${esc(_rep.deteccao)} (${esc(_rep.duracao)} após o 1º sinal)</b></div>
          <div><span>Pico do evento</span><b>${esc(_rep.pico)}</b></div>
        </div>

        <div class="fz-cop-os-sec"><b>Sintomas</b>
          <ul>${a.sintomas.length ? a.sintomas.map(s => `<li>${esc(s)}</li>`).join('') : '<li>Nenhuma grandeza acima do nível de atenção na última leitura.</li>'}</ul></div>

        <div class="fz-cop-os-sec"><b>Linha do tempo</b>
          <ul class="fz-rc-timeline">${tl}</ul>
          <p class="fz-cop-sub">Reconstruída da série histórica do Dataset Forzy (horários reais do dataset).</p></div>

        <div class="fz-cop-os-sec"><b>Componente provável:</b> ${esc(_rep.componente_provavel)}</div>
        <div class="fz-cop-os-sec"><b>Causa provável:</b> ${esc(_rep.causa_provavel)}</div>
        <div class="fz-cop-os-sec"><b>Estopim provável:</b> ${esc(_rep.estopim)}</div>
        <div class="fz-cop-os-sec"><b>Causas alternativas:</b>
          <ul>${a.alternativas.length ? a.alternativas.map(x => `<li>${esc(x)}</li>`).join('') : '<li>—</li>'}</ul></div>
        <div class="fz-cop-os-sec"><b>Confiança:</b> ${esc(_rep.confianca)}</div>
        <div class="fz-cop-os-sec fz-cop-sub"><b>Causa raiz confirmada:</b> não. As relações acima são correlações temporais na série; a confirmação exige as evidências abaixo.</div>

        <div class="fz-cop-os-sec"><b>Evidência faltante</b>
          <ul>${_rep.evidencia_faltante.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
        <div class="fz-cop-os-sec"><b>Validação recomendada (human-in-the-loop)</b>
          <ul>${_rep.validacao_recomendada.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>

        <div class="fz-rc-manual">
          <div class="fz-card-title">Manual de conserto</div>
          <div class="fz-cop-os-sec"><b>Tem conserto?</b> ${esc(a.reparo.reparavel)}</div>
          <div class="fz-cop-os-grid">
            <div><span>Parada necessária</span><b>${esc(a.reparo.parada)}</b></div>
            <div><span>Tempo estimado</span><b>${esc(a.reparo.tempo)}</b></div>
          </div>
          <div class="fz-cop-os-sec"><b>Passo a passo</b><ol>${a.diag.acoes.map(x => `<li>${esc(x)}</li>`).join('')}</ol></div>
          <div class="fz-cop-os-sec"><b>Ferramentas</b><ul>${a.reparo.ferramentas.map(x => `<li>${esc(x)}</li>`).join('') || '<li>—</li>'}</ul></div>
          <div class="fz-cop-os-sec"><b>Peças / insumos prováveis</b><ul>${a.diag.pecas.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
        </div>

        <div id="rcRefino" class="fz-cop-refino" hidden></div>
        <div class="fz-cop-os-cta">
          <button class="fz-btn fz-btn-primary" id="rcPdf">Exportar PDF</button>
          <button class="fz-btn" id="rcIA" ${semChave ? 'disabled title="Configure config.js com a chave OpenAI"' : ''}>Refinar com IA</button>
          <button class="fz-btn ghost" data-dtab-goto="os">Gerar Ordem de Serviço</button>
        </div>
      </div>`;

    host.querySelector('#rcPdf').addEventListener('click', () => exportarPDF(a));
    if (!semChave) host.querySelector('#rcIA').addEventListener('click', () => refinarIA(host));
    host.querySelectorAll('[data-dtab-goto]').forEach(b => b.addEventListener('click', () => {
      const t = document.querySelector('#fzDiagTabs .fz-tab[data-dtab="' + b.dataset.dtabGoto + '"]');
      if (t) t.click();
    }));
  }

  // le o historico salvo no navegador
  function lerLog() { try { return JSON.parse(localStorage.getItem(RCA_LOG) || '[]'); } catch (e) { return []; } }
  // salva o historico no navegador
  function gravarLog(o) { const l = lerLog(); l.unshift(o); try { localStorage.setItem(RCA_LOG, JSON.stringify(l.slice(0, 80))); } catch (e) {  } }
  // lista de relatorios gerados
  function renderHist() {
    const host = _root && _root.querySelector('#rcHist'); if (!host) return;
    const l = lerLog();
    if (!l.length) { host.innerHTML = '<div class="fz-cop-sub">Nenhuma análise gerada ainda.</div>'; return; }
    host.innerHTML = `<table class="fz-cop-table"><thead><tr><th>Data</th><th>Ativo</th><th>Evento</th><th>Severidade</th></tr></thead>
      <tbody>${l.map(o => `<tr><td>${esc(new Date(o.gerado_em).toLocaleString('pt-BR'))}</td><td>${esc(o.ativo)} · ${esc(o.eixo)}</td><td>${esc(o.evento)}</td><td>${esc(o.severidade)}</td></tr>`).join('')}</tbody></table>`;
  }

  // relatorio em texto
  function texto(a) {
    const L = [];
    L.push(`ANÁLISE DE CAUSA RAIZ — ${_rep.ativo} · ${_rep.eixo}`);
    L.push(`Gerado em: ${new Date(_rep.gerado_em).toLocaleString('pt-BR')}`);
    L.push(`Evento: ${_rep.evento}  |  Severidade: ${_rep.severidade}`);
    L.push(`Janela analisada: ${a.janela.de} → ${a.janela.ate}`);
    L.push(`Primeiro sinal: ${_rep.primeiro_sinal}  |  Detecção: ${_rep.deteccao}  (${_rep.duracao})`);
    L.push(`Pico do evento: ${_rep.pico}`);
    L.push('Sintomas:'); (_rep.sintomas.length ? _rep.sintomas : ['—']).forEach(s => L.push('  - ' + s));
    L.push('Linha do tempo:'); _rep.timeline.forEach(t => L.push('  ' + t));
    L.push(`Componente provável: ${_rep.componente_provavel}`);
    L.push(`Causa provável: ${_rep.causa_provavel}`);
    L.push(`Estopim provável: ${_rep.estopim}`);
    L.push('Causas alternativas:'); (_rep.alternativas.length ? _rep.alternativas : ['—']).forEach(s => L.push('  - ' + s));
    L.push(`Confiança: ${_rep.confianca}`);
    L.push('Causa raiz confirmada: não (apenas correlação temporal).');
    L.push('Evidência faltante:'); _rep.evidencia_faltante.forEach(s => L.push('  - ' + s));
    L.push('Validação recomendada:'); _rep.validacao_recomendada.forEach(s => L.push('  - ' + s));
    L.push('');
    L.push('MANUAL DE CONSERTO');
    L.push(`Tem conserto? ${a.reparo.reparavel}`);
    L.push(`Parada necessária: ${a.reparo.parada}  |  Tempo estimado: ${a.reparo.tempo}`);
    L.push('Passo a passo:'); a.diag.acoes.forEach((s, i) => L.push(`  ${i + 1}. ${s}`));
    L.push('Ferramentas: ' + (a.reparo.ferramentas.join(', ') || '—'));
    L.push('Peças / insumos: ' + a.diag.pecas.join(', '));
    return L.join('\n');
  }

  // abre o relatorio pra imprimir em PDF
  function exportarPDF(a) {
    const ctor = window.jspdf && window.jspdf.jsPDF;
    if (!ctor) { alert('jsPDF não carregou'); return; }
    const doc = new ctor({ unit: 'pt', format: 'a4' });
    const M = 48; let y = 60;
    const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
    const line = (txt, size = 10, style = 'normal', gap = 14) => {
      doc.setFont('helvetica', style); doc.setFontSize(size);
      doc.splitTextToSize(txt, W - M * 2).forEach(p => {
        if (y > H - M) { doc.addPage(); y = M; }
        doc.text(p, M, y); y += gap;
      });
    };
    doc.setFillColor(20, 20, 23); doc.rect(0, 0, W, 34, 'F');
    doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text('IMS · Forzy — Análise de Causa Raiz', M, 22);
    doc.setTextColor(20, 20, 23);
    texto(a).split('\n').forEach(t => {
      const bold = /^[A-ZÁÉÍÓ]/.test(t) && t === t.toUpperCase() && t.length > 3;
      line(t, bold ? 11 : 10, bold ? 'bold' : 'normal', bold ? 18 : 13);
    });
    doc.save(`RCA-${_rep.ativo}-${new Date().toISOString().slice(0, 10)}.pdf`);
  }

  // pede parecer da IA (so no clique)
  async function refinarIA(host) {
    const btn = host.querySelector('#rcIA'); const key = window.FORZY_OPENAI_KEY;
    if (!key) return;
    btn.disabled = true; btn.textContent = 'Consultando IA…';
    try {
      const prompt = 'Você é um engenheiro de confiabilidade. A partir da análise de causa raiz abaixo, ' +
        'escreva um parecer curto (máx. 160 palavras) em português: avalie se o estopim identificado é plausível, ' +
        'aponte a hipótese alternativa mais forte e diga qual evidência resolveria a dúvida. Não repita o texto.\n\n' + texto(analisar(_eixo));
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], temperature: 0.4, max_tokens: 380 }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const txt = (data.choices && data.choices[0] && data.choices[0].message.content || '').trim();
      const box = host.querySelector('#rcRefino');
      box.hidden = false;
      box.innerHTML = `<div class="fz-card-title">Parecer de confiabilidade (IA)</div><p>${esc(txt)}</p>`;
    } catch (e) {
      alert('Falha ao consultar a IA: ' + e.message);
    } finally { btn.disabled = false; btn.textContent = 'Refinar com IA'; }
  }

  // liga a tela (roda so na primeira visita)
  function init() {
    _root = document.getElementById('rcaRoot');
    if (!_root) return;
    render();
  }

  window.FZRCA = { init, render };
})();
