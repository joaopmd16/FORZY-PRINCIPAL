/* cadastro.js: tela de Cadastro de Ativos (criar, editar, listar motores) */

(function () {
  const S = window.FZStore;
  const F = window.FORZY;
  if (!S) { console.error('cadastro.js: FZStore ausente'); return; }

  const COLS = ['m1_vel', 'm1_acel', 'm1_temp', 'm2_vel', 'm2_acel', 'm2_temp'];
  const STATUS = ['ativo', 'manutencao', 'inativo'];
  const IP = ['IP44', 'IP54', 'IP55', 'IP65', 'IP66', 'IP67'];
  // le o valor de uma variavel CSS (cor do tema)
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  // atalho pra pegar um elemento pelo id
  const el = id => document.getElementById(id);
  // protege o texto contra HTML/XSS antes de ir pro innerHTML
  const esc = s => (s == null ? '' : String(s)).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (v, d = 2) => (v == null || v === '' || v !== v) ? '—' : Number(v).toFixed(d);

  const state = { selEditar: null, selDash: null, dashTimer: null };

  // troca a aba da tela
  function switchTab(name) {
    if (state.dashTimer) { clearInterval(state.dashTimer); state.dashTimer = null; }
    document.querySelectorAll('#cadTabs .fz-tab').forEach(b => b.classList.toggle('active', b.dataset.ctab === name));
    document.querySelectorAll('#screen-cadastro .fz-cpanel').forEach(p => p.classList.toggle('active', p.dataset.cpanel === name));
    if (name === 'lista') renderLista();
    if (name === 'novo') renderNovo();
    if (name === 'editar') renderEditar();
    if (name === 'locais') renderLocais();
    if (name === 'dash') renderDash();
    if (window.lucide) lucide.createIcons();
  }

  // mensagem rapida de sucesso ou erro
  function feedback(msg, ok = true) {
    return `<div class="fz-feedback ${ok ? 'ok' : 'bad'}">${esc(msg)}</div>`;
  }

  // status do ativo pela ultima leitura
  function statusOf(o) { return o.status || 'ativo'; }
  // etiqueta de status do ativo
  function statusBadge(st) {
    const c = S.statusColor(st);
    return `<span class="lc-badge" style="background:${c}22;border:1px solid ${c};color:${c}">${S.statusLabel(st)}</span>`;
  }
  // desenha plantas e areas
  function renderLocais(msg) {
    const p = el('cadLocais'); if (!p) return;
    const plantas = S.getPlantas();
    const areas = S.getAreas();
    p.innerHTML = `
      ${msg || ''}
      <div class="fz-card">
        <div class="fz-card-title">Plantas</div>
        <div class="fz-card-sub">Edite, inative ou exclua plantas. (Crie novas na aba "Novo Ativo".)</div>
        ${plantas.length ? plantas.map(pl => { const st = statusOf(pl); return `
          <div class="lc-item lc-prow" data-pid="${pl.id}">
            <div class="lc-head"><span class="lc-name">${esc(pl.nome)}</span>${statusBadge(st)}</div>
            <div class="fz-form">
              <div class="fld"><label>Nome *</label><input class="fz-input" data-f="nome" value="${esc(pl.nome)}"></div>
              <div class="fld"><label>Descrição</label><input class="fz-input" data-f="desc" value="${esc(pl.descricao || '')}"></div>
            </div>
            <div class="lc-actions">
              <button class="fz-btn ghost" data-act="savePlanta">Salvar</button>
              <button class="fz-btn ghost" data-act="togglePlanta">${st === 'inativo' ? 'Reativar' : 'Deixar inativo'}</button>
              <button class="fz-btn danger" data-act="delPlanta">Excluir</button>
            </div>
          </div>`; }).join('') : '<div class="fz-empty" style="margin-top:10px">Nenhuma planta cadastrada.</div>'}
      </div>
      <div class="fz-card" style="margin-top:16px">
        <div class="fz-card-title">Áreas</div>
        <div class="fz-card-sub">Edite, mova de planta, inative ou exclua áreas.</div>
        ${areas.length ? areas.map(ar => { const st = statusOf(ar); return `
          <div class="lc-item lc-arow" data-aid="${ar.id}">
            <div class="lc-head"><span class="lc-name">${esc(ar.nome)}</span>${statusBadge(st)}
              <span class="lc-sub">· ${esc(S.getPlantas().find(x => x.id === ar.planta_id)?.nome || '—')}</span></div>
            <div class="fz-form">
              <div class="fld"><label>Nome *</label><input class="fz-input" data-f="nome" value="${esc(ar.nome)}"></div>
              <div class="fld"><label>Planta</label><select class="fz-select" data-f="planta">${plantas.map(pl => `<option value="${pl.id}" ${pl.id === ar.planta_id ? 'selected' : ''}>${esc(pl.nome)}</option>`).join('')}</select></div>
              <div class="fld col2"><label>Descrição</label><input class="fz-input" data-f="desc" value="${esc(ar.descricao || '')}"></div>
            </div>
            <div class="lc-actions">
              <button class="fz-btn ghost" data-act="saveArea">Salvar</button>
              <button class="fz-btn ghost" data-act="toggleArea">${st === 'inativo' ? 'Reativar' : 'Deixar inativo'}</button>
              <button class="fz-btn danger" data-act="delArea">Excluir</button>
            </div>
          </div>`; }).join('') : '<div class="fz-empty" style="margin-top:10px">Nenhuma área cadastrada.</div>'}
      </div>`;

    if (msg) p.querySelector('.fz-feedback')?.scrollIntoView({ block: 'center' });

    const pRow = b => b.closest('.lc-prow');
    const aRow = b => b.closest('.lc-arow');

    p.querySelectorAll('[data-act="savePlanta"]').forEach(b => b.addEventListener('click', () => {
      const row = pRow(b), id = +row.dataset.pid;
      const nome = row.querySelector('[data-f="nome"]').value.trim();
      if (!nome) return renderLocais(feedback('Nome da planta é obrigatório.', false));
      const ok = S.editarPlanta(id, { nome, descricao: row.querySelector('[data-f="desc"]').value.trim() });
      renderLocais(feedback(ok ? `Planta "${nome}" atualizada.` : `Já existe outra planta com esse nome.`, ok));
    }));
    p.querySelectorAll('[data-act="togglePlanta"]').forEach(b => b.addEventListener('click', () => {
      const row = pRow(b), id = +row.dataset.pid;
      const atual = statusOf(S.getPlantas().find(x => x.id === id));
      const novo = atual === 'inativo' ? 'ativo' : 'inativo';
      S.editarPlanta(id, { status: novo });
      renderLocais(feedback(`Planta ${novo === 'inativo' ? 'inativada' : 'reativada'}.`));
    }));
    p.querySelectorAll('[data-act="delPlanta"]').forEach(b => b.addEventListener('click', () => {
      const row = pRow(b), id = +row.dataset.pid;
      const nome = S.getPlantas().find(x => x.id === id)?.nome || '';
      if (!confirm(`Excluir a planta "${nome}"? Esta ação não pode ser desfeita.`)) return;
      const r = S.excluirPlanta(id);
      renderLocais(feedback(r.ok ? `Planta "${nome}" excluída.` : r.motivo, r.ok));
    }));

    p.querySelectorAll('[data-act="saveArea"]').forEach(b => b.addEventListener('click', () => {
      const row = aRow(b), id = +row.dataset.aid;
      const nome = row.querySelector('[data-f="nome"]').value.trim();
      if (!nome) return renderLocais(feedback('Nome da área é obrigatório.', false));
      const ok = S.editarArea(id, { nome, descricao: row.querySelector('[data-f="desc"]').value.trim(), planta_id: +row.querySelector('[data-f="planta"]').value });
      renderLocais(feedback(ok ? `Área "${nome}" atualizada.` : `Falha ao atualizar a área.`, ok));
    }));
    p.querySelectorAll('[data-act="toggleArea"]').forEach(b => b.addEventListener('click', () => {
      const row = aRow(b), id = +row.dataset.aid;
      const atual = statusOf(S.getAreas().find(x => x.id === id));
      const novo = atual === 'inativo' ? 'ativo' : 'inativo';
      S.editarArea(id, { status: novo });
      renderLocais(feedback(`Área ${novo === 'inativo' ? 'inativada' : 'reativada'}.`));
    }));
    p.querySelectorAll('[data-act="delArea"]').forEach(b => b.addEventListener('click', () => {
      const row = aRow(b), id = +row.dataset.aid;
      const nome = S.getAreas().find(x => x.id === id)?.nome || '';
      if (!confirm(`Excluir a área "${nome}"? Esta ação não pode ser desfeita.`)) return;
      const r = S.excluirArea(id);
      renderLocais(feedback(r.ok ? `Área "${nome}" excluída.` : r.motivo, r.ok));
    }));
  }

  // desenha a lista de ativos
  function renderLista() {
    const p = el('cadLista'); if (!p) return;
    const plantas = S.getPlantas();
    p.innerHTML = `
      <div class="fz-card">
        <div class="fz-controls" style="margin-bottom:14px">
          <div class="fz-field"><span>Planta</span>
            <select class="fz-select" id="lstPlanta">
              <option value="">Todas</option>
              ${plantas.map(pl => `<option value="${pl.id}">${esc(pl.nome)}</option>`).join('')}
            </select></div>
          <div class="fz-field"><span>Status</span>
            <select class="fz-select" id="lstStatus">
              <option value="">Todos</option>
              ${STATUS.map(s => `<option value="${s}">${S.statusLabel(s)}</option>`).join('')}
            </select></div>
          <div class="fz-field" style="flex:1;min-width:160px"><span>Busca</span>
            <input class="fz-input" id="lstBusca" placeholder="Código ou descrição"></div>
          <button class="fz-btn ghost" id="lstExport">Exportar CSV</button>
        </div>
        <div id="lstTable"></div>
      </div>`;

    const draw = () => {
      const pid = el('lstPlanta').value ? +el('lstPlanta').value : null;
      const stf = el('lstStatus').value || null;
      const q = el('lstBusca').value.trim().toLowerCase();
      let rows = S.getAtivosIndustrial();
      if (pid) rows = rows.filter(a => a.planta_id === pid);
      if (stf) rows = rows.filter(a => a.status === stf);
      if (q) rows = rows.filter(a => (a.codigo || '').toLowerCase().includes(q) || (a.descricao || '').toLowerCase().includes(q));
      el('lstTable').innerHTML = tableHTML(rows);
    };
    el('lstPlanta').addEventListener('change', draw);
    el('lstStatus').addEventListener('change', draw);
    el('lstBusca').addEventListener('input', draw);
    el('lstExport').addEventListener('click', () => exportLista());
    draw();
  }

  // monta a tabela de ativos
  function tableHTML(rows) {
    if (!rows.length) return `<div class="fz-empty">Nenhum ativo encontrado.</div>`;
    const sc = s => S.statusColor(s);
    return `<div style="overflow:auto"><table class="fz-table">
      <thead><tr>
        <th>Código</th><th>TAG</th><th>Descrição</th><th>Fabricante</th>
        <th>kW</th><th>V</th><th>A nom</th><th>IP</th><th>Status</th><th>Área</th><th>Planta</th>
      </tr></thead><tbody>
      ${rows.map(a => `<tr>
        <td><b>${esc(a.codigo)}</b></td><td>${esc(a.tag) || '—'}</td><td style="font-family:var(--font)">${esc(a.descricao) || '—'}</td>
        <td>${esc(a.fabricante) || '—'}</td><td>${fmt(a.potencia_kw, 1)}</td><td>${fmt(a.tensao_v, 0)}</td>
        <td>${fmt(a.corrente_nom, 1)}</td><td>${esc(a.ip_rating) || '—'}</td>
        <td><span style="color:${sc(a.status)};font-weight:700;font-family:var(--font)">${S.statusLabel(a.status)}</span></td>
        <td style="font-family:var(--font)">${esc(a.area_nome) || '—'}</td><td style="font-family:var(--font)">${esc(a.planta_nome) || '—'}</td>
      </tr>`).join('')}
      </tbody></table></div>`;
  }

  // exporta a lista em CSV
  function exportLista() {
    const rows = S.getAtivosIndustrial();
    const head = ['Codigo', 'TAG', 'Descricao', 'Fabricante', 'kW', 'V', 'A_nom', 'IP', 'Status', 'Area', 'Planta'];
    let csv = head.join(';') + '\n';
    for (const a of rows) csv += [a.codigo, a.tag, a.descricao, a.fabricante, a.potencia_kw, a.tensao_v, a.corrente_nom, a.ip_rating, a.status, a.area_nome, a.planta_nome].map(v => v == null ? '' : v).join(';') + '\n';
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ativos.csv'; a.click(); URL.revokeObjectURL(a.href);
  }

  const SUGESTAO_CAMPO = {
    tag:          { el: 'nTag',  rot: 'TAG',              dica: 'código do equipamento — ex: MTR-001' },
    descricao:    { el: 'nDesc', rot: 'Descrição',        dica: 'ex: Motor de Indução Trifásico' },
    fabricante:   { el: 'nFab',  rot: 'Fabricante',       dica: 'ex: WEG, Siemens, ABB' },
    potencia_kw:  { el: 'nKw',   rot: 'Potência (kW)',    dica: 'se a placa só tem HP, multiplique por 0,746' },
    tensao_v:     { el: 'nV',    rot: 'Tensão (V)',       dica: 'ex: 220 / 380 / 440' },
    corrente_nom: { el: 'nA',    rot: 'Corrente (A)',     dica: 'corrente nominal de placa' },
    ip_rating:    { el: 'nIp',   rot: 'IP Rating',        dica: 'ex: IP55' },
  };

  // le a plaqueta do motor pela foto usando a IA de visao
  // REVISAR (Joao): conferir se os campos lidos batem com a plaqueta antes de salvar o ativo
  async function lerPlacaComIA(base64, mime) {
    const key = window.FORZY_OPENAI_KEY;
    if (!key) return { dados: null, erro: 'Chave de API não configurada em config.js' };

    const prompt = `Você extrai dados de PLACAS DE IDENTIFICAÇÃO (nameplates) de MOTORES ELÉTRICOS INDUSTRIAIS.

REGRAS OBRIGATÓRIAS — siga à risca:
1. Só preencha um campo se o valor estiver LITERALMENTE IMPRESSO na placa E pertencer àquele campo.
2. NUNCA invente, estime, converta de memória ou deduza um valor que não está escrito.
3. NUNCA mova um dado para um campo que não é dele. Se um dado da placa não couber em
   nenhum campo, ele vai em "observacoes" — e só se for tecnicamente relevante ao motor.
4. Campo não impresso, ilegível ou duvidoso = null. É correto e esperado retornar vários null.
5. Se a imagem NÃO for a placa de um motor elétrico industrial (ex: placa de veículo,
   equipamento não-elétrico, foto qualquer), retorne "eh_placa_motor": false, descreva o
   que você viu em "tipo_detectado", e deixe TODOS os demais campos null.

Responda SOMENTE com um objeto json neste formato:
{
  "eh_placa_motor": true ou false,
  "tipo_detectado": "o que a imagem realmente é, quando não for placa de motor (senão null)",
  "tag": "código de instalação/patrimônio impresso (padrão tipo MTR-001, BBA-002). NÃO é o fabricante, NÃO é o modelo, NÃO é o número de série. Se não houver um código assim, null",
  "fabricante": "fabricante impresso, ou null",
  "descricao": "tipo do motor impresso (ex: Motor de Indução Trifásico), ou null",
  "potencia_kw": número em kW ou null,
  "tensao_v": número em volts ou null,
  "corrente_nom": número em ampères ou null,
  "rpm": número ou null,
  "ip_rating": "ex: IP55, ou null",
  "frequencia_hz": número ou null,
  "ligacao": "ex: Y/D, ou null",
  "fator_potencia": número ou null,
  "classe_isolamento": "letra (F, B, H), ou null",
  "observacoes": "outros dados TÉCNICOS DO MOTOR presentes na placa, ou null",
  "confianca": "alta" | "media" | "baixa"
}

Não inclua o campo de localização/endereço: essa informação nunca vem da placa.`;

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'user', content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}`, detail: 'high' } }
          ]}],
          max_tokens: 700,
          temperature: 0,
          response_format: { type: 'json_object' },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data.error?.message || `HTTP ${res.status}`;
        return { dados: null, erro: msg };
      }
      const text = data.choices?.[0]?.message?.content || '';
      let dados;
      try { dados = JSON.parse(text); }
      catch (_) {
        const m = text.match(/\{[\s\S]*\}/);
        if (!m) return { dados: null, erro: 'IA não retornou JSON válido. Tente outra imagem.' };
        try { dados = JSON.parse(m[0]); } catch (_) { return { dados: null, erro: 'IA não retornou JSON válido. Tente outra imagem.' }; }
      }
      return { dados, erro: null };
    } catch (e) { return { dados: null, erro: e.message || 'Erro de rede' }; }
  }

  // liga o envio da foto da plaqueta
  function setupOCRPlaca() {
    const btn = el('ocrBtn'); if (!btn) return;
    const inp = el('ocrInput');
    const prev = el('ocrPreview');
    const status = el('ocrStatus');

    btn.addEventListener('click', () => inp.click());

    inp.addEventListener('change', async () => {
      const file = inp.files[0]; if (!file) return;
      if (!file.type.startsWith('image/')) { status.textContent = 'Arquivo inválido. Envie uma imagem.'; status.style.color = 'var(--fz-bad)'; return; }

      const reader = new FileReader();
      reader.onload = async ev => {
        const dataUrl = ev.target.result;
        prev.innerHTML = `<img src="${dataUrl}" style="max-width:100%;max-height:220px;border-radius:6px;border:1px solid var(--hairline)">`;
        prev.style.display = 'block';

        const [meta, base64] = dataUrl.split(',');
        const mime = meta.replace('data:', '').replace(';base64', '');

        status.textContent = 'Analisando placa com IA…';
        status.style.color = 'var(--teal)';
        btn.disabled = true;

        const resultado = await lerPlacaComIA(base64, mime);
        btn.disabled = false;

        if (!resultado || !resultado.dados) {
          status.textContent = resultado?.erro || 'Erro desconhecido ao chamar a IA.';
          status.style.color = 'var(--fz-bad)';
          return;
        }
        const dados = resultado.dados;

        if (dados.eh_placa_motor === false) {
          status.innerHTML = `<span style="color:var(--fz-bad)">⚠ Isto não parece a placa de um motor elétrico.</span>`
            + (dados.tipo_detectado ? `<br><small style="color:var(--text-2)">Detectado: ${esc(dados.tipo_detectado)}</small>` : '')
            + `<br><small style="color:var(--text-2)">Nenhum campo foi preenchido. Envie a foto da placa do motor ou preencha manualmente.</small>`;
          return;
        }

        if (dados.tag) {
          const t = String(dados.tag).trim();
          const igualOutroCampo = [dados.fabricante, dados.descricao]
            .some(v => v && String(v).trim().toLowerCase() === t.toLowerCase());
          if (igualOutroCampo || !/\d/.test(t)) dados.tag = null;
        }

        const lidos = [], faltando = [];
        const setSe = (chave, valor, aplicar) => {
          if (valor != null && valor !== '') { aplicar(valor); lidos.push(chave); }
          else if (SUGESTAO_CAMPO[chave]) faltando.push(chave);
        };

        setSe('tag',          dados.tag,          v => { el('nTag').value = v; el('nCod').value = v; });
        setSe('descricao',    dados.descricao,    v => el('nDesc').value = v);
        setSe('fabricante',   dados.fabricante,   v => el('nFab').value = v);
        setSe('potencia_kw',  dados.potencia_kw,  v => el('nKw').value = v);
        setSe('tensao_v',     dados.tensao_v,     v => el('nV').value = v);
        setSe('corrente_nom', dados.corrente_nom, v => el('nA').value = v);
        setSe('ip_rating',    dados.ip_rating,    v => {
          const ipSel = el('nIp');
          const opt = [...ipSel.options].find(o => o.value === v);
          if (opt) ipSel.value = v;
        });

        const extras = [];
        if (dados.rpm)               extras.push(`${dados.rpm} RPM`);
        if (dados.frequencia_hz)     extras.push(`${dados.frequencia_hz} Hz`);
        if (dados.ligacao)           extras.push(`Ligação: ${dados.ligacao}`);
        if (dados.fator_potencia)    extras.push(`FP: ${dados.fator_potencia}`);
        if (dados.classe_isolamento) extras.push(`Classe ${dados.classe_isolamento}`);
        if (dados.observacoes)       extras.push(dados.observacoes);
        const obsEl = el('nObs');
        if (extras.length && obsEl) obsEl.value = extras.join(' · ');

        faltando.forEach(k => {
          const cfg = SUGESTAO_CAMPO[k];
          const campo = el(cfg.el);
          if (campo && campo.tagName === 'INPUT') {
            campo.placeholder = cfg.dica;
            campo.classList.add('fz-input-sugerido');
          }
        });

        const conf = dados.confianca || 'media';
        const corConf = conf === 'alta' ? 'var(--fz-ok)' : conf === 'baixa' ? 'var(--fz-bad)' : 'var(--fz-warn)';
        let html = `<span style="color:var(--fz-ok)">✓ ${lidos.length} campo(s) lido(s) da placa.</span>`
          + ` <small style="color:${corConf}">confiança ${esc(conf)}</small>`
          + `<br><small style="color:var(--text-2)">Revise antes de cadastrar — a IA pode errar leitura de placa.</small>`;

        if (faltando.length) {
          html += `<div class="fz-ocr-pendencias"><b>Não identificado na placa (${faltando.length}) — preencha manualmente:</b><ul>`
            + faltando.map(k => `<li><b>${esc(SUGESTAO_CAMPO[k].rot)}</b> — ${esc(SUGESTAO_CAMPO[k].dica)}</li>`).join('')
            + `</ul></div>`;
        }
        status.innerHTML = html;
      };
      reader.readAsDataURL(file);
    });
  }

  // formulario de ativo novo
  function renderNovo(msg) {
    const p = el('cadNovo'); if (!p) return;
    const plantas = S.getPlantas();

    if (!plantas.length) {
      p.innerHTML = `<div class="fz-card">
        ${msg || ''}
        <div class="fz-card-title">Criar Planta</div>
        <div class="fz-card-sub">Nenhuma planta cadastrada. Crie uma planta antes de adicionar ativos.</div>
        <div class="fz-form">
          <div class="fld col2"><label>Nome da Planta *</label><input class="fz-input" id="npNome" placeholder="Planta São Paulo A1"></div>
          <div class="fld col2"><label>Descrição</label><input class="fz-input" id="npDesc" placeholder="Unidade principal"></div>
        </div>
        <button class="fz-btn" id="npCriar" style="margin-top:12px">Criar Planta</button>
      </div>`;
      el('npCriar').addEventListener('click', () => {
        const nome = el('npNome').value.trim();
        if (!nome) return renderNovo(feedback('Nome obrigatório.', false));
        S.criarPlanta(nome, el('npDesc').value.trim());
        renderNovo(feedback(`Planta "${nome}" criada.`));
      });
      return;
    }

    p.innerHTML = `<div class="fz-card ocr-card" style="margin-bottom:16px">
      <div class="fz-card-title" style="display:flex;align-items:center;gap:10px">
        <span style="font-size:18px">📷</span> Leitura de Placa por IA
      </div>
      <div class="fz-card-sub">Fotografe ou envie a placa do motor — a IA extrai os dados automaticamente e preenche o formulário abaixo.</div>
      <div style="display:flex;align-items:center;gap:12px;margin-top:12px;flex-wrap:wrap">
        <button class="fz-btn" id="ocrBtn" style="display:flex;align-items:center;gap:6px">
          <i data-lucide="scan-line" style="width:15px;height:15px"></i> Enviar Foto da Placa
        </button>
        <input type="file" id="ocrInput" accept="image/*" style="display:none">
        <span style="font-size:11px;color:var(--text-2)">JPG, PNG, WEBP · usa GPT-4o mini via OpenAI</span>
      </div>
      <div id="ocrPreview" style="margin-top:12px;display:none"></div>
      <div id="ocrStatus" style="margin-top:8px;font-size:12px;min-height:18px"></div>
    </div>

    <div class="fz-card">
      ${msg || ''}
      <div class="fz-card-title">Cadastrar Novo Ativo</div>
      <div class="fz-form">
        <div class="fld"><label>Planta</label><select class="fz-select" id="nPlanta">${plantas.map(pl => `<option value="${pl.id}">${esc(pl.nome)}</option>`).join('')}</select></div>
        <div class="fld"><label>Área</label><select class="fz-select" id="nArea"></select></div>
      </div>
      <details class="fz-details"><summary>Criar nova Planta</summary>
        <div class="fz-form" style="margin-top:10px">
          <div class="fld"><label>Nome da Planta *</label><input class="fz-input" id="npNome2" placeholder="Planta São Paulo A1"></div>
          <div class="fld"><label>Descrição</label><input class="fz-input" id="npDesc2" placeholder="Unidade principal"></div>
        </div>
        <button class="fz-btn ghost" id="npCriar2" style="margin-top:10px">Criar Planta</button>
      </details>
      <details class="fz-details"><summary>Criar nova Área nesta planta</summary>
        <div class="fz-form" style="margin-top:10px">
          <div class="fld"><label>Nome da Área *</label><input class="fz-input" id="naNome" placeholder="Sala de Máquinas"></div>
          <div class="fld"><label>Descrição</label><input class="fz-input" id="naDesc" placeholder="Piso 1 — Bloco B"></div>
        </div>
        <button class="fz-btn ghost" id="naCriar" style="margin-top:10px">Criar Área</button>
      </details>

      <div class="fz-form" style="margin-top:14px">
        <div class="fld"><label>Código *</label><input class="fz-input" id="nCod" placeholder="MTR-001"></div>
        <div class="fld"><label>TAG</label><input class="fz-input" id="nTag" placeholder="MTR-001"></div>
        <div class="fld col2"><label>Descrição *</label><input class="fz-input" id="nDesc" placeholder="Motor Bomba Secundária"></div>
        <div class="fld"><label>Fabricante</label><input class="fz-input" id="nFab" placeholder="WEG"></div>
        <div class="fld"><label>IP Rating</label><select class="fz-select" id="nIp">${IP.map((x, i) => `<option ${i === 1 ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
        <div class="fld"><label>Status</label><select class="fz-select" id="nStatus">${STATUS.map(s => `<option value="${s}">${S.statusLabel(s)}</option>`).join('')}</select></div>
        <div class="fld"><label>Potência (kW)</label><input class="fz-input" id="nKw" type="number" step="0.5" value="0"></div>
        <div class="fld"><label>Tensão (V)</label><input class="fz-input" id="nV" type="number" step="10" value="380"></div>
        <div class="fld"><label>Corrente Nominal (A)</label><input class="fz-input" id="nA" type="number" step="1" value="0"></div>
        <div class="fld col2"><label>Localização</label><input class="fz-input" id="nLoc" placeholder="Bloco 1 — Sala de Máquinas"></div>
        <div class="fld"><label>Data de Instalação</label><input class="fz-input" id="nData" type="date"></div>
        <div class="fld col2"><label>Observações Técnicas</label><input class="fz-input" id="nObs" placeholder="RPM, frequência, ligação, classe de isolamento…"></div>
      </div>
      <details class="fz-details"><summary>Coordenadas GPS (opcional)</summary>
        <div class="fz-form" style="margin-top:10px">
          <div class="fld"><label>Latitude</label><input class="fz-input" id="nLat" type="number" step="0.000001" value="-23.5505"></div>
          <div class="fld"><label>Longitude</label><input class="fz-input" id="nLon" type="number" step="0.000001" value="-46.6333"></div>
        </div>
      </details>
      <button class="fz-btn fz-btn-cad" id="nCriar" style="margin-top:14px">Cadastrar Ativo</button>
    </div>`;

    const fillAreas = () => {
      const pid = +el('nPlanta').value;
      const areas = S.getAreas(pid);
      el('nArea').innerHTML = areas.length
        ? areas.map(a => `<option value="${a.id}">${esc(a.nome)}</option>`).join('')
        : `<option value="">— nenhuma área —</option>`;
    };
    el('nPlanta').addEventListener('change', fillAreas);
    fillAreas();
    setupOCRPlaca();

    el('npCriar2').addEventListener('click', () => {
      const nome = el('npNome2').value.trim();
      if (!nome) return renderNovo(feedback('Nome da planta obrigatório.', false));
      const ok = S.criarPlanta(nome, el('npDesc2').value.trim());
      renderNovo(feedback(ok ? `Planta "${nome}" criada.` : `Planta "${nome}" já existe.`, ok));
    });

    el('naCriar').addEventListener('click', () => {
      const nome = el('naNome').value.trim(); const pid = +el('nPlanta').value;
      if (!nome) return renderNovo(feedback('Nome da área obrigatório.', false));
      S.criarArea(pid, nome, el('naDesc').value.trim());
      renderNovo(feedback(`Área "${nome}" criada.`));
    });

    el('nCriar').addEventListener('click', () => {
      const codigo = el('nCod').value.trim();
      const descricao = el('nDesc').value.trim();
      const area_id = el('nArea').value ? +el('nArea').value : null;
      if (!codigo) return renderNovo(feedback('Código é obrigatório.', false));
      if (!descricao) return renderNovo(feedback('Descrição é obrigatória.', false));
      if (!area_id) return renderNovo(feedback('Crie/selecione uma Área antes de cadastrar.', false));
      const ok = S.criarAtivoIndustrial({
        codigo, tag: el('nTag').value.trim() || codigo, area_id, descricao,
        fabricante: el('nFab').value.trim(), ip_rating: el('nIp').value, status: el('nStatus').value,
        potencia_kw: +el('nKw').value, tensao_v: +el('nV').value, corrente_nom: +el('nA').value,
        latitude: +el('nLat').value, longitude: +el('nLon').value,
        localizacao_descricao: el('nLoc').value.trim(), data_install: el('nData').value || null,
        observacoes: el('nObs')?.value.trim() || '',
      });
      if (!ok) return renderNovo(feedback(`Código "${codigo}" já existe.`, false));
      // proximo passo: conectar o endpoint / CSV do motor (fica na aba Editar Ativo)
      state.selEditar = codigo;
      switchTab('editar');
      renderEditar(feedback('Ativo ' + codigo + ' cadastrado. Agora conecte os dados do motor logo abaixo (endpoint, CSV e treino do modelo).'));
    });
  }

  // formulario de editar ativo
  function renderEditar(msg) {
    const p = el('cadEditar'); if (!p) return;
    const ativos = S.getAtivosIndustrial();
    if (!ativos.length) { p.innerHTML = `<div class="fz-card"><div class="fz-empty">Nenhum ativo cadastrado ainda.</div></div>`; return; }
    if (!state.selEditar || !ativos.some(a => a.codigo === state.selEditar)) state.selEditar = ativos[0].codigo;
    const a = S.getAtivoPorCodigo(state.selEditar);
    const plantas = S.getPlantas();
    const areas = S.getAreas(a.planta_id);

    p.innerHTML = `<div class="fz-card">
      ${msg || ''}
      <div class="fz-form" style="margin-bottom:6px">
        <div class="fld col2"><label>Selecione o ativo</label>
          <select class="fz-select" id="eSel">${ativos.map(x => `<option value="${esc(x.codigo)}" ${x.codigo === state.selEditar ? 'selected' : ''}>${esc(x.codigo)} — ${esc(x.descricao)}</option>`).join('')}</select></div>
      </div>
      <div class="fz-card-title">Editar — ${esc(a.codigo)}</div>
      <div class="fz-form">
        <div class="fld"><label>Planta</label><select class="fz-select" id="ePlanta">${plantas.map(pl => `<option value="${pl.id}" ${pl.id === a.planta_id ? 'selected' : ''}>${esc(pl.nome)}</option>`).join('')}</select></div>
        <div class="fld"><label>Área</label><select class="fz-select" id="eArea">${areas.map(ar => `<option value="${ar.id}" ${ar.id === a.area_id ? 'selected' : ''}>${esc(ar.nome)}</option>`).join('')}</select></div>
        <div class="fld"><label>Código</label><input class="fz-input" value="${esc(a.codigo)}" disabled></div>
        <div class="fld"><label>TAG</label><input class="fz-input" id="eTag" value="${esc(a.tag)}"></div>
        <div class="fld col2"><label>Descrição</label><input class="fz-input" id="eDesc" value="${esc(a.descricao)}"></div>
        <div class="fld"><label>Fabricante</label><input class="fz-input" id="eFab" value="${esc(a.fabricante)}"></div>
        <div class="fld"><label>IP Rating</label><select class="fz-select" id="eIp">${IP.map(x => `<option ${x === a.ip_rating ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
        <div class="fld"><label>Status</label><select class="fz-select" id="eStatus">${STATUS.map(s => `<option value="${s}" ${s === a.status ? 'selected' : ''}>${S.statusLabel(s)}</option>`).join('')}</select></div>
        <div class="fld"><label>Potência (kW)</label><input class="fz-input" id="eKw" type="number" step="0.5" value="${a.potencia_kw ?? 0}"></div>
        <div class="fld"><label>Tensão (V)</label><input class="fz-input" id="eV" type="number" step="10" value="${a.tensao_v ?? 0}"></div>
        <div class="fld"><label>Corrente Nom (A)</label><input class="fz-input" id="eA" type="number" step="1" value="${a.corrente_nom ?? 0}"></div>
        <div class="fld col2"><label>Localização</label><input class="fz-input" id="eLoc" value="${esc(a.localizacao_descricao)}"></div>
        <div class="fld col2"><label>Observações Técnicas</label><input class="fz-input" id="eObs" value="${esc(a.observacoes || '')}" placeholder="RPM, frequência, ligação, classe de isolamento…"></div>
      </div>
      <details class="fz-details"><summary>Coordenadas GPS</summary>
        <div class="fz-form" style="margin-top:10px">
          <div class="fld"><label>Latitude</label><input class="fz-input" id="eLat" type="number" step="0.000001" value="${a.latitude ?? -23.5505}"></div>
          <div class="fld"><label>Longitude</label><input class="fz-input" id="eLon" type="number" step="0.000001" value="${a.longitude ?? -46.6333}"></div>
        </div>
      </details>
      <div class="lc-actions" style="margin-top:14px">
        <button class="fz-btn fz-btn-save" id="eSalvar">Salvar Alterações</button>
        ${a.origem === 'forzy' ? '' : '<button class="fz-btn danger" id="eExcluir">Excluir Ativo</button>'}
      </div>
    </div>
    <div id="ativoDadosHost"></div>`;

    // endpoint + CSV + treino do modelo do ativo (ativo-dados.js)
    if (window.FZAtivoDados) window.FZAtivoDados.montar(el('ativoDadosHost'), state.selEditar);
    if (msg) p.querySelector('.fz-feedback')?.scrollIntoView({ block: 'center' });

    el('eSel').addEventListener('change', e => { state.selEditar = e.target.value; renderEditar(); });
    el('ePlanta').addEventListener('change', () => {
      const pid = +el('ePlanta').value; const ars = S.getAreas(pid);
      el('eArea').innerHTML = ars.map(ar => `<option value="${ar.id}">${esc(ar.nome)}</option>`).join('');
    });
    el('eSalvar').addEventListener('click', () => {
      S.editarAtivoIndustrial(state.selEditar, {
        tag: el('eTag').value.trim(), area_id: el('eArea').value ? +el('eArea').value : null,
        descricao: el('eDesc').value.trim(), fabricante: el('eFab').value.trim(),
        ip_rating: el('eIp').value, status: el('eStatus').value,
        potencia_kw: +el('eKw').value, tensao_v: +el('eV').value, corrente_nom: +el('eA').value,
        latitude: +el('eLat').value, longitude: +el('eLon').value,
        localizacao_descricao: el('eLoc').value.trim(),
        observacoes: el('eObs')?.value.trim() || '',
      });
      renderEditar(feedback(`Ativo ${state.selEditar} atualizado.`));
    });
    el('eExcluir')?.addEventListener('click', () => {
      const codigo = state.selEditar;
      if (!confirm(`Excluir o ativo "${codigo}"? Esta ação não pode ser desfeita.`)) return;
      const r = S.excluirAtivoIndustrial(codigo);
      if (r.ok) state.selEditar = null;
      renderEditar(feedback(r.ok ? `Ativo ${codigo} excluído.` : r.motivo, r.ok));
    });
  }

  // ultima leitura do ativo
  function lastReading() {
    if (!F) return null;
    const i = F.meta.n - 1; const o = {};
    for (const c of COLS) o[c] = F[c.slice(0, 2)][c.slice(3)][i];
    return o;
  }
  // calcula o Z-score de cada variavel
  function zscores(r) { const z = {}; for (const c of COLS) { const b = F.baseline[c]; z[c] = (b && b.std) ? Math.abs(r[c] - b.mean) / b.std : 0; } return z; }
  // classifica o Z-score em Normal/Atencao/Critico
  function classify(score) { if (score < 2) return ['Normal', cssVar('--fz-ok')]; if (score < 3) return ['Alerta', cssVar('--fz-warn')]; return ['Anomalia', cssVar('--fz-bad')]; }

  // classifica pela ISO 10816
  const flagISO = v => (v >= 4.5 ? 2 : v >= 1.8 ? 1 : 0);
  // grafico de vibracao do ativo
  function vibChart(vals) {
    const W = 720, H = 200, padL = 40, padR = 12, padT = 12, padB = 22;
    const mx = Math.max(6, ...vals), mn = 0;
    const X = i => padL + (vals.length < 2 ? 0 : i * (W - padL - padR) / (vals.length - 1));
    const Y = v => padT + (1 - (v - mn) / (mx - mn)) * (H - padT - padB);
    const band = (y0, y1, c) => `<rect x="${padL}" y="${Y(y1).toFixed(1)}" width="${W - padL - padR}" height="${(Y(y0) - Y(y1)).toFixed(1)}" fill="${c}" opacity="0.07"/>`;
    let d = ''; vals.forEach((v, i) => { d += (i ? ' L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1); });
    const ok = cssVar('--fz-ok'), wn = cssVar('--fz-warn'), bd = cssVar('--fz-bad'), ac = cssVar('--teal');
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:auto">
      ${band(0, 1.8, ok)}${band(1.8, 4.5, wn)}${band(4.5, mx, bd)}
      <line x1="${padL}" x2="${W - padR}" y1="${Y(1.8).toFixed(1)}" y2="${Y(1.8).toFixed(1)}" stroke="${wn}" stroke-width="1" stroke-dasharray="3 3"/>
      <line x1="${padL}" x2="${W - padR}" y1="${Y(4.5).toFixed(1)}" y2="${Y(4.5).toFixed(1)}" stroke="${bd}" stroke-width="1" stroke-dasharray="3 3"/>
      <path d="${d}" fill="none" stroke="${ac}" stroke-width="2"/></svg>`;
  }
  // bloco de leitura ao vivo do IoT
  function iotLiveBlock(leituras) {
    const rec = leituras.slice(0, 300).reverse();
    const vib = rec.map(l => +l.vibracao_mm_s || 0);
    const last = leituras[0];
    const v = +last.vibracao_mm_s || 0; const fl = flagISO(v);
    const cor = [cssVar('--fz-ok'), cssVar('--fz-warn'), cssVar('--fz-bad')][fl];
    const nome = ['NORMAL', 'ALERTA', 'ALARME'][fl];
    const ts = new Date(last.coletado_em).toLocaleString('pt-BR');
    return `<div class="fz-card" style="margin-top:16px">
      <div class="fz-card-title">Leituras IoT — ao vivo <span class="fz-badge" style="background:${cor}22;border:1px solid ${cor};color:${cor};margin-left:8px">${nome}</span></div>
      <div class="fz-card-sub">${leituras.length} leituras gravadas neste ativo · última: ${ts}</div>
      <div style="display:flex;gap:14px;flex-wrap:wrap;margin:12px 0">
        <div class="fz-kpi-cell"><div class="k-lbl">Vibração RMS</div><div class="k-val" style="color:${cor}">${v.toFixed(3)} mm/s</div></div>
        <div class="fz-kpi-cell"><div class="k-lbl">Aceleração Mag</div><div class="k-val">${fmt(last.mag_rms, 4)} g</div></div>
        <div class="fz-kpi-cell"><div class="k-lbl">AX / AY / AZ</div><div class="k-val">${fmt(last.ax_rms, 3)} / ${fmt(last.ay_rms, 3)} / ${fmt(last.az_rms, 3)}</div></div>
        <div class="fz-kpi-cell"><div class="k-lbl">Status ISO 10816</div><div class="k-val" style="color:${cor}">${nome}</div></div>
      </div>
      <div class="fz-legend"><span><i style="background:var(--teal)"></i>Vibração RMS (mm/s)</span></div>
      <div class="fz-chart">${vibChart(vib)}</div>
    </div>`;
  }

  // Dashboard do Ativo
  function renderDash() {
    const p = el('cadDash'); if (!p) return;
    const ativos = S.getAtivosIndustrial();
    if (!ativos.length) { p.innerHTML = `<div class="fz-card"><div class="fz-empty">Nenhum ativo cadastrado. Crie um na aba "Novo Ativo".</div></div>`; return; }
    if (!state.selDash || !ativos.some(a => a.codigo === state.selDash)) state.selDash = ativos[0].codigo;
    const a = S.getAtivoPorCodigo(state.selDash);
    const sc = S.statusColor(a.status);
    const leituras = S.getLeituras(a.codigo, 400);
    const temIoT = leituras.length > 0;

    const isForzy = a.origem === 'forzy';
    const r = (temIoT || isForzy) ? lastReading() : null;
    const z = r ? zscores(r) : {};
    const score = r ? Math.max(...Object.values(z)) : 0;
    const [classe, cor] = classify(score);

    const zLabels = {
      m1_vel: 'M1 Velocidade', m1_acel: 'M1 Aceleração', m1_temp: 'M1 Temperatura',
      m2_vel: 'M2 Velocidade', m2_acel: 'M2 Aceleração', m2_temp: 'M2 Temperatura',
    };

    p.innerHTML = `
      <div class="fz-form" style="margin-bottom:12px">
        <div class="fld col2"><label>Ativo</label>
          <select class="fz-select" id="daSel">${ativos.map(x => `<option value="${esc(x.codigo)}" ${x.codigo === state.selDash ? 'selected' : ''}>${esc(x.codigo)} — ${esc(x.descricao)}</option>`).join('')}</select></div>
      </div>

      <div class="fz-card" style="border-left:4px solid ${sc};margin-bottom:16px">
        <div class="da-head">
          <div>
            <div class="da-cod">${esc(a.codigo)}</div>
            <div class="da-desc">${esc(a.descricao)}</div>
            <div class="da-loc">${esc(a.area_nome) || '—'} · ${esc(a.planta_nome) || '—'}</div>
          </div>
          <div class="da-specs">
            ${spec('TAG', a.tag)}${spec('Fabricante', a.fabricante)}${spec('Potência', (a.potencia_kw ?? '—') + ' kW')}
            ${spec('Tensão', (a.tensao_v ?? '—') + ' V')}${spec('IP', a.ip_rating)}
            <span class="fz-badge" style="background:${sc}22;border:1px solid ${sc};color:${sc};align-self:center">${S.statusLabel(a.status)}</span>
          </div>
        </div>
        <div class="da-nav-links" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
          <button class="fz-btn ghost" id="daIrMonitoramento">📊 Ver no Monitoramento</button>
          <button class="fz-btn ghost" id="daIrDiagnostico">🩺 Abrir Diagnóstico (OS)</button>
          <button class="fz-btn ghost" id="daIrAssistente">💬 Falar com o Assistente</button>
        </div>
      </div>

      <!-- Ficha Técnica completa -->
      <div class="fz-card da-ficha" style="margin-bottom:16px">
        <div class="fz-card-title" style="margin-bottom:14px">⚙ Ficha Técnica</div>
        <div class="da-ficha-grid">
          <div class="da-ficha-group">
            <div class="da-ficha-label">Identificação</div>
            <div class="da-ficha-row"><span>Código</span><strong>${esc(a.codigo||'—')}</strong></div>
            <div class="da-ficha-row"><span>Tag</span><strong>${esc(a.tag||'—')}</strong></div>
            <div class="da-ficha-row"><span>Descrição</span><strong>${esc(a.descricao||'—')}</strong></div>
            <div class="da-ficha-row"><span>Fabricante</span><strong>${esc(a.fabricante||'—')}</strong></div>
            <div class="da-ficha-row"><span>Status</span><strong style="color:${sc}">${S.statusLabel(a.status)}</strong></div>
          </div>
          <div class="da-ficha-group">
            <div class="da-ficha-label">Dados Elétricos</div>
            <div class="da-ficha-row"><span>Potência</span><strong>${a.potencia_kw != null ? a.potencia_kw + ' kW' : '—'}</strong></div>
            <div class="da-ficha-row"><span>Tensão nominal</span><strong>${a.tensao_v != null ? a.tensao_v + ' V' : '—'}</strong></div>
            <div class="da-ficha-row"><span>Corrente nominal</span><strong>${a.corrente_nom != null ? a.corrente_nom + ' A' : '—'}</strong></div>
            <div class="da-ficha-row"><span>Grau proteção</span><strong>${esc(a.ip_rating||'—')}</strong></div>
          </div>
          <div class="da-ficha-group">
            <div class="da-ficha-label">Localização</div>
            <div class="da-ficha-row"><span>Planta</span><strong>${esc(a.planta_nome||'—')}</strong></div>
            <div class="da-ficha-row"><span>Área</span><strong>${esc(a.area_nome||'—')}</strong></div>
            <div class="da-ficha-row"><span>Posição</span><strong>${esc(a.localizacao_descricao||'—')}</strong></div>
            <div class="da-ficha-row"><span>Instalação</span><strong>${a.data_install ? new Date(a.data_install).toLocaleDateString('pt-BR') : '—'}</strong></div>
            ${a.latitude != null ? `<div class="da-ficha-row"><span>GPS</span><strong>${(+a.latitude).toFixed(4)}, ${(+a.longitude).toFixed(4)}</strong></div>` : ''}
          </div>
        </div>
        ${leituras.length ? `
        <div class="da-ficha-kpis" style="margin-top:16px;padding-top:14px;border-top:1px solid var(--hairline)">
          <div class="da-ficha-kpi"><div class="da-kpi-lbl">Total de Leituras IoT</div><div class="da-kpi-val">${leituras.length}</div></div>
          <div class="da-ficha-kpi"><div class="da-kpi-lbl">Última Leitura</div><div class="da-kpi-val">${leituras.length ? new Date(leituras[leituras.length-1].coletado_em).toLocaleString('pt-BR') : '—'}</div></div>
          <div class="da-ficha-kpi"><div class="da-kpi-lbl">Vel. RMS Atual</div><div class="da-kpi-val" style="color:var(--teal)">${r ? (+r.m1_vel).toFixed(3)+' mm/s' : '—'}</div></div>
          <div class="da-ficha-kpi"><div class="da-kpi-lbl">Temperatura Atual</div><div class="da-kpi-val">${r ? (+r.m1_temp).toFixed(1)+' °C' : '—'}</div></div>
        </div>` : ''}
      </div>

      ${(temIoT || isForzy) ? `
      <div class="fz-row2">
        <div class="fz-card">
          <div class="fz-card-title">Score de Anomalia — Baseline ML</div>
          <div class="fz-card-sub">Z-score multivariado sobre o Dataset Forzy (última leitura de referência)</div>
          <div style="display:flex;align-items:center;gap:18px;flex-wrap:wrap">
            ${gaugeSVG(score, cor)}
            <div>
              <div class="fz-badge" style="background:${cor}22;border:1px solid ${cor};color:${cor};font-size:13px">${classe.toUpperCase()}</div>
              <div style="font-size:12px;color:var(--text-2);margin-top:8px;line-height:1.7">
                Z &lt; 2 · Normal<br>2 – 3 · Alerta<br>&gt; 3 · Anomalia</div>
            </div>
          </div>
        </div>
        <div class="fz-card">
          <div class="fz-card-title">Z-scores por variável</div>
          <div class="fz-zgrid" style="margin-top:10px">
            ${COLS.map(c => { const [, cr] = classify(z[c] || 0); return `
              <div class="fz-zcard" style="border-left-color:${cr}">
                <div class="z-lbl">${zLabels[c]}</div>
                <div class="z-top"><span class="z-val">${fmt(r ? r[c] : null, 2)}</span><span class="z-z" style="color:${cr}">Z=${fmt(z[c] || 0, 2)}</span></div>
              </div>`; }).join('')}
          </div>
        </div>
      </div>` : ''}

      ${temIoT ? iotLiveBlock(leituras) : isForzy ? `
      <div class="fz-card" style="margin-top:16px">
        <div class="fz-card-title">Referência Operacional — Dataset Forzy</div>
        <div class="fz-card-sub">Exibindo histórico do dataset Forzy como referência operacional.</div>
        <div class="fz-legend"><span><i style="background:var(--fz-m1)"></i>Eixo 1 — Vel</span><span><i style="background:var(--fz-m2)"></i>Eixo 2 — Vel</span></div>
        <div class="fz-chart">${refChart()}</div>
      </div>` : `
      <div class="fz-card" style="margin-top:16px">
        <div class="fz-card-title">Sem dados de monitoramento</div>
        <div class="fz-card-sub">Nenhuma leitura IoT vinculada a este ativo. Conecte o ESP32 na aba IoT e selecione este ativo para iniciar o monitoramento.</div>
        <div class="fz-empty" style="padding:32px 0;color:var(--text-2)">Aguardando primeiras leituras…</div>
      </div>`}

      <div class="fz-card" style="margin-top:16px">
        <div class="fz-card-title">Histórico de Atualizações</div>
        <div id="daHist" style="margin-top:8px"></div>
      </div>`;

    el('daSel').addEventListener('change', e => { state.selDash = e.target.value; renderDash(); });
    el('daIrMonitoramento')?.addEventListener('click', () => window.FZDashboard?.abrirAtivo?.(a.codigo));
    el('daIrDiagnostico')?.addEventListener('click', () => window.FZCopiloto?.abrirPara?.('m1', a.codigo));
    el('daIrAssistente')?.addEventListener('click', () => {
      window.FZChatScreen?.abrirAtivo?.(a.codigo);
      if (typeof window.showScreen === 'function') window.showScreen('assistente');
    });

    if (state.dashTimer) { clearInterval(state.dashTimer); state.dashTimer = null; }
    if (temIoT) {
      state.dashTimer = setInterval(() => {
        const telaOk = document.getElementById('screen-cadastro')?.classList.contains('active');
        const painelOk = document.querySelector('.fz-cpanel[data-cpanel="dash"]')?.classList.contains('active');
        if (!telaOk || !painelOk) { clearInterval(state.dashTimer); state.dashTimer = null; return; }
        renderDash();
      }, 2000);
    }

    const hist = S.getHistorico(100).filter(h =>
      (h.dados_antes || '').includes(a.codigo) || (h.dados_depois || '').includes(a.codigo)).slice(0, 10);
    el('daHist').innerHTML = hist.length ? `<div style="overflow:auto"><table class="fz-table">
      <thead><tr><th>Data</th><th>Tabela</th><th>Operação</th></tr></thead><tbody>
      ${hist.map(h => `<tr><td style="font-family:var(--font)">${new Date(h.ts).toLocaleString('pt-BR')}</td><td style="font-family:var(--font)">${esc(h.tabela)}</td><td style="font-family:var(--font)">${esc(h.operacao)}</td></tr>`).join('')}
      </tbody></table></div>` : `<div class="fz-empty">Sem alterações registradas para este ativo.</div>`;
  }

  // linha de especificacao tecnica
  function spec(label, val) {
    return `<div class="da-spec"><div class="s-lbl">${label}</div><div class="s-val">${esc(val) || '—'}</div></div>`;
  }

  // mostrador circular em SVG
  function gaugeSVG(score, cor) {
    const W = 180, H = 110, cx = W / 2, cy = H - 10, R = 74;
    const frac = Math.max(0, Math.min(1, score / 5));
    const polar = (ang) => [cx + R * Math.cos(ang), cy + R * Math.sin(ang)];
    const arc = (a0, a1) => { const [x0, y0] = polar(a0), [x1, y1] = polar(a1); const large = (a1 - a0) > Math.PI ? 1 : 0; return `M${x0.toFixed(1)},${y0.toFixed(1)} A${R},${R} 0 ${large} 1 ${x1.toFixed(1)},${y1.toFixed(1)}`; };
    const A0 = Math.PI, A1 = 2 * Math.PI;
    const aVal = A0 + (A1 - A0) * frac;
    return `<svg viewBox="0 0 ${W} ${H}" style="width:180px;height:auto">
      <path d="${arc(A0, A1)}" fill="none" stroke="var(--field)" stroke-width="12" stroke-linecap="round"/>
      <path d="${arc(A0, aVal)}" fill="none" stroke="${cor}" stroke-width="12" stroke-linecap="round"/>
      <text x="${cx}" y="${cy - 18}" text-anchor="middle" style="fill:${cor};font-family:var(--font-num);font-size:26px;font-weight:700">${score.toFixed(2)}</text>
      <text x="${cx}" y="${cy - 2}" text-anchor="middle" style="fill:var(--text-2);font-family:var(--font-num);font-size:10px">Score Z-máx</text>
    </svg>`;
  }

  // grafico de referencia com limites
  function refChart() {
    if (!F) return '';
    const N = F.meta.n, K = 120, W = 720, H = 240, padL = 40, padR = 12, padT = 12, padB = 24;
    const idx = []; for (let i = 0; i < K; i++) idx.push(Math.round(i * (N - 1) / (K - 1)));
    const s1 = idx.map(i => F.m1.vel[i]), s2 = idx.map(i => F.m2.vel[i]);
    let mn = Infinity, mx = -Infinity; for (const v of s1.concat(s2)) { if (v < mn) mn = v; if (v > mx) mx = v; }
    if (mx - mn < 1e-6) { mn -= 1; mx += 1; }
    const X = i => padL + i * (W - padL - padR) / (K - 1);
    const Y = v => padT + (1 - (v - mn) / (mx - mn)) * (H - padT - padB);
    const path = s => { let d = 'M' + X(0).toFixed(1) + ',' + Y(s[0]).toFixed(1); for (let i = 1; i < s.length; i++) d += ' L' + X(i).toFixed(1) + ',' + Y(s[i]).toFixed(1); return d; };
    let grid = '';
    for (let g = 0; g <= 4; g++) { const v = mn + (mx - mn) * g / 4, y = Y(v); grid += `<line class="fz-grid-line" x1="${padL}" x2="${W - padR}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/><text class="fz-axis-label" x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end">${v.toFixed(1)}</text>`; }
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:auto">
      ${grid}
      <path d="${path(s1)}" fill="none" stroke="var(--fz-m1)" stroke-width="1.6"/>
      <path d="${path(s2)}" fill="none" stroke="var(--fz-m2)" stroke-width="1.6"/>
    </svg>`;
  }

  // liga a tela (roda so na primeira visita)
  function init() {
    const tabs = el('cadTabs'); if (!tabs) return;
    tabs.querySelectorAll('.fz-tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.ctab)));
    renderLista();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.FZCadastro = { switchTab };
})();
