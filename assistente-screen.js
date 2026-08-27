/* assistente-screen.js — tela dedicada do Assistente IA, com uma conversa por ativo */
(function () {
  let iniciado = false;
  const GERAL = 'geral';
  let convAtual = GERAL;
  const conversas = { [GERAL]: { historico: [], bubbles: [] } }; // bubbles: [{role, html}] p/ redesenhar ao trocar de aba

  const CHIPS = [
    'Qual o status atual do motor?',
    'Explique o baseline ML',
    'O que é ISO 10816?',
    'Como interpretar vibração alta?',
    'Quando devo fazer manutenção?',
  ];

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function renderMd(text) {
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`(.*?)`/g, '<code style="background:var(--field);padding:1px 5px;border-radius:4px;font-size:0.93em">$1</code>')
      .replace(/\n/g, '<br>');
  }

  function getConv(key) {
    if (!conversas[key]) conversas[key] = { historico: [], bubbles: [] };
    return conversas[key];
  }

  function welcomeHtml(ativoLabel) {
    return `
      <div class="fz-chat-welcome">
        <div class="fz-chat-welcome-icon"><i data-lucide="cpu"></i></div>
        <div class="fz-chat-welcome-title">Como posso ajudar?</div>
        <div class="fz-chat-welcome-sub">${ativoLabel
          ? `Conversa focada em <strong>${esc(ativoLabel)}</strong> — pergunte sobre vibração, temperatura, histórico ou manutenção desse ativo.`
          : 'Faça perguntas sobre os equipamentos, dados de vibração, temperatura, anomalias ou manutenção.'}</div>
        <div class="fz-chat-chips" id="fzChatChips">
          ${CHIPS.map(c => `<button class="fz-chat-chip">${esc(c)}</button>`).join('')}
        </div>
      </div>
    `;
  }

  function labelAtivo(codigo) {
    if (codigo === GERAL) return null;
    const a = window.FZStore?.getAtivoPorCodigo?.(codigo);
    return a ? `${a.codigo} — ${a.descricao || a.tag || ''}`.trim() : codigo;
  }

  function popularSelectAtivos(sel) {
    const ativos = window.FZStore?.getAtivosIndustrial?.() || [];
    sel.innerHTML = `<option value="${GERAL}">Conversa geral</option>` +
      ativos.map(a => `<option value="${esc(a.codigo)}">${esc(a.codigo)} — ${esc(a.descricao || a.tag || '')}</option>`).join('');
    sel.value = convAtual;
  }

  function ativarChips() {
    const chips = document.getElementById('fzChatChips');
    if (!chips) return;
    chips.addEventListener('click', e => {
      const chip = e.target.closest('.fz-chat-chip');
      if (chip) enviar(chip.textContent);
    });
  }

  function redesenhar(key) {
    const msgs = document.getElementById('fzChatMsgs');
    if (!msgs) return;
    const conv = getConv(key);
    if (!conv.bubbles.length) {
      msgs.innerHTML = welcomeHtml(labelAtivo(key));
    } else {
      msgs.innerHTML = conv.bubbles.map(b =>
        `<div class="fz-chat-bubble fz-chat-${b.role}"><div class="fz-chat-bubble-inner">${b.html}</div></div>`
      ).join('');
    }
    if (window.lucide) lucide.createIcons();
    ativarChips();
    msgs.scrollTop = msgs.scrollHeight;
  }

  function trocarConversa(key) {
    convAtual = key;
    redesenhar(key);
  }

  function init() {
    if (iniciado) {
      // se a tela já existe mas os ativos podem ter mudado (CRUD em cadastro.js), reabastece o select
      const sel = document.getElementById('fzChatAtivoSel');
      if (sel) popularSelectAtivos(sel);
      return;
    }
    iniciado = true;
    const host = document.getElementById('fz-chat-screen');
    if (!host) return;
    host.innerHTML = `
      <div class="fz-chat-wrap">
        <div class="fz-chat-header">
          <div class="fz-chat-header-info">
            <div class="fz-chat-avatar"><i data-lucide="bot"></i></div>
            <div>
              <div class="fz-chat-title">Assistente Forzy</div>
              <div class="fz-chat-sub">IA técnica · Manutenção preditiva · GPT-4o mini</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <select id="fzChatAtivoSel" class="fz-chat-ativo-sel" title="Conversar sobre um ativo específico"></select>
            <button class="fz-chat-clear" id="fzChatClear" title="Limpar todas as conversas"><i data-lucide="trash-2"></i></button>
          </div>
        </div>

        <div class="fz-chat-messages" id="fzChatMsgs"></div>

        <div class="fz-chat-input-area">
          <div class="fz-chat-input-row">
            <textarea class="fz-chat-textarea" id="fzChatInput" rows="1" placeholder="Pergunte sobre vibração, temperatura, falhas…"></textarea>
            <button class="fz-chat-send" id="fzChatSend"><i data-lucide="send"></i></button>
          </div>
        </div>
      </div>
    `;

    const sel = document.getElementById('fzChatAtivoSel');
    popularSelectAtivos(sel);
    redesenhar(convAtual);

    const input = document.getElementById('fzChatInput');
    const sendBtn = document.getElementById('fzChatSend');
    const clearBtn = document.getElementById('fzChatClear');

    sel.addEventListener('change', () => trocarConversa(sel.value));

    sendBtn.addEventListener('click', () => enviar());
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); }
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 140) + 'px';
    });
    clearBtn.addEventListener('click', limparTudo);
  }

  function addBubble(key, role, html, id) {
    getConv(key).bubbles.push({ role, html, id });
    if (key !== convAtual) return; // só desenha se for a conversa visível
    const msgs = document.getElementById('fzChatMsgs');
    const welcome = msgs.querySelector('.fz-chat-welcome');
    if (welcome) welcome.remove();
    const div = document.createElement('div');
    div.className = `fz-chat-bubble fz-chat-${role}`;
    if (id) div.id = id;
    div.innerHTML = `<div class="fz-chat-bubble-inner">${html}</div>`;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  }

  function atualizarBubble(key, id, html) {
    const conv = getConv(key);
    const b = conv.bubbles.find(x => x.id === id);
    if (b) b.html = html;
    if (key !== convAtual) return;
    const el = document.getElementById(id);
    if (el) el.querySelector('.fz-chat-bubble-inner').innerHTML = html;
  }

  // contexto técnico do ativo selecionado — permite a IA "trabalhar dentro" dele
  function contextoAtivo(codigo) {
    if (codigo === GERAL || !window.FZStore) return '';
    const a = window.FZStore.getAtivoPorCodigo?.(codigo);
    if (!a) return '';
    const partes = [
      `Código: ${a.codigo}`,
      a.tag ? `Tag: ${a.tag}` : '',
      a.descricao ? `Descrição: ${a.descricao}` : '',
      a.fabricante ? `Fabricante: ${a.fabricante}` : '',
      a.potencia_kw ? `Potência: ${a.potencia_kw} kW` : '',
      a.tensao_v ? `Tensão: ${a.tensao_v} V` : '',
      a.status ? `Status: ${a.status}` : '',
      a.localizacao_descricao ? `Local: ${a.localizacao_descricao}` : '',
    ].filter(Boolean).join(' | ');

    let leituraTxt = '';
    const leituras = window.FZStore.getLeituras?.(codigo, 1) || [];
    if (leituras.length) {
      const l = leituras[0];
      const flag = (l.vel_rms >= 4.5) ? 'ALARME' : (l.vel_rms >= 1.8) ? 'ALERTA' : 'Normal';
      leituraTxt = `\nÚltima leitura: Vel=${(l.vel_rms||0).toFixed(3)}mm/s (${flag}), Acel=${(l.acel_rms||0).toFixed(4)}g, Temp=${(l.temp_c||0).toFixed(1)}°C — ${l.coletado_em||''}`;
    }
    return `\n\n[CONTEXTO DO ATIVO EM FOCO]\n${partes}${leituraTxt}\nEssa conversa é especificamente sobre este ativo — responda sempre considerando os dados acima.`;
  }

  async function enviar(texto, opts) {
    const key = convAtual;
    const isAlerta = !!(opts && opts.isAlerta);
    const input = document.getElementById('fzChatInput');
    const msg = (texto || input?.value || '').trim();
    if (!msg) return;

    if (input && key === convAtual) { input.value = ''; input.style.height = 'auto'; }
    addBubble(key, isAlerta ? 'alerta' : 'user', esc(msg).replace(/\n/g, '<br>'));

    const apiKey = window.FORZY_OPENAI_KEY;
    if (!apiKey) {
      addBubble(key, 'ai', '<span style="color:var(--fz-bad)">Chave de API não configurada em config.js</span>');
      return;
    }

    const sysMsg = `Você é o Assistente IA da plataforma IMS Forzy, especializado em manutenção preditiva de bombas centrífugas industriais.
Responda de forma técnica, clara e objetiva. Use normas ISO 10816 e ISA-18.2 quando relevante.
Seja direto: máximo 3-4 parágrafos por resposta. Use **negrito** para destacar termos técnicos importantes.`;

    const conv = getConv(key);
    conv.historico.push({ role: 'user', content: msg + contextoAtivo(key) });

    const thinkId = 'ai-think-' + Date.now();
    addBubble(key, 'ai', '<span class="fz-chat-thinking"><span></span><span></span><span></span></span>', thinkId);

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'system', content: sysMsg }, ...conv.historico],
          max_tokens: 1024,
          temperature: 0.5,
        }),
      });
      const data = await res.json();
      const resposta = data.choices?.[0]?.message?.content || '';
      if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);

      conv.historico.push({ role: 'assistant', content: resposta });
      atualizarBubble(key, thinkId, renderMd(esc(resposta)));

    } catch (e) {
      atualizarBubble(key, thinkId, `<span style="color:var(--fz-bad)">Erro: ${esc(e.message)}</span>`);
    }

    const msgs = document.getElementById('fzChatMsgs');
    if (msgs) msgs.scrollTop = 99999;
  }

  // usado por assistant.js para empurrar alertas automáticos (IoT/ISA-18.2) — sempre na conversa geral
  function enviarAlerta(msgIA) {
    init();
    if (typeof window.showScreen === 'function') window.showScreen('assistente');
    const sel = document.getElementById('fzChatAtivoSel');
    if (sel) { sel.value = GERAL; trocarConversa(GERAL); }
    enviar(msgIA, { isAlerta: true });
  }

  // limpa todas as conversas (geral + todos os ativos), não só a aba visível
  function limparTudo() {
    Object.keys(conversas).forEach(k => { conversas[k] = { historico: [], bubbles: [] }; });
    redesenhar(convAtual);
  }

  window.FZChatScreen = { init, enviarAlerta, limparTudo };
})();
