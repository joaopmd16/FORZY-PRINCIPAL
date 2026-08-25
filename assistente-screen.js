/* assistente-screen.js — tela dedicada do Assistente IA */
(function () {
  let iniciado = false;
  let historico = [];

  const CHIPS = [
    'Qual o status atual dos motores?',
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

  function init() {
    if (iniciado) return;
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
          <button class="fz-chat-clear" id="fzChatClear" title="Limpar conversa"><i data-lucide="trash-2"></i></button>
        </div>

        <div class="fz-chat-messages" id="fzChatMsgs">
          <div class="fz-chat-welcome">
            <div class="fz-chat-welcome-icon"><i data-lucide="cpu"></i></div>
            <div class="fz-chat-welcome-title">Como posso ajudar?</div>
            <div class="fz-chat-welcome-sub">Faça perguntas sobre os equipamentos, dados de vibração, temperatura, anomalias ou manutenção.</div>
            <div class="fz-chat-chips" id="fzChatChips">
              ${CHIPS.map(c => `<button class="fz-chat-chip">${esc(c)}</button>`).join('')}
            </div>
          </div>
        </div>

        <div class="fz-chat-input-area">
          <div class="fz-chat-input-row">
            <textarea class="fz-chat-textarea" id="fzChatInput" rows="1" placeholder="Pergunte sobre vibração, temperatura, falhas…"></textarea>
            <button class="fz-chat-send" id="fzChatSend"><i data-lucide="send"></i></button>
          </div>
        </div>
      </div>
    `;
    if (window.lucide) lucide.createIcons();

    const msgs = document.getElementById('fzChatMsgs');
    const input = document.getElementById('fzChatInput');
    const sendBtn = document.getElementById('fzChatSend');
    const clearBtn = document.getElementById('fzChatClear');

    document.getElementById('fzChatChips').addEventListener('click', e => {
      const chip = e.target.closest('.fz-chat-chip');
      if (chip) enviar(chip.textContent);
    });

    sendBtn.addEventListener('click', () => enviar());
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); }
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 140) + 'px';
    });
    clearBtn.addEventListener('click', () => {
      historico = [];
      msgs.innerHTML = '';
      document.getElementById('fzChatChips') && (msgs.innerHTML = `
        <div class="fz-chat-welcome">
          <div class="fz-chat-welcome-icon"><i data-lucide="cpu"></i></div>
          <div class="fz-chat-welcome-title">Como posso ajudar?</div>
          <div class="fz-chat-welcome-sub">Faça perguntas sobre os equipamentos, dados de vibração, temperatura, anomalias ou manutenção.</div>
          <div class="fz-chat-chips" id="fzChatChips">
            ${CHIPS.map(c => `<button class="fz-chat-chip">${esc(c)}</button>`).join('')}
          </div>
        </div>
      `);
      if (window.lucide) lucide.createIcons();
      document.getElementById('fzChatChips').addEventListener('click', e => {
        const chip = e.target.closest('.fz-chat-chip');
        if (chip) enviar(chip.textContent);
      });
    });
  }

  function addBubble(role, html, id) {
    const msgs = document.getElementById('fzChatMsgs');
    // remove welcome se existir
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

  async function enviar(texto) {
    const input = document.getElementById('fzChatInput');
    const msg = (texto || input.value).trim();
    if (!msg) return;

    input.value = '';
    input.style.height = 'auto';
    addBubble('user', esc(msg).replace(/\n/g, '<br>'));

    const key = window.FORZY_OPENAI_KEY;
    if (!key) {
      addBubble('ai', '<span style="color:var(--fz-bad)">Chave de API não configurada em config.js</span>');
      return;
    }

    // sistema com contexto dos motores
    const sysMsg = `Você é o Assistente IA da plataforma IMS Forzy, especializado em manutenção preditiva de bombas centrífugas industriais.
Responda de forma técnica, clara e objetiva. Use normas ISO 10816 e ISA-18.2 quando relevante.
Seja direto: máximo 3-4 parágrafos por resposta. Use **negrito** para destacar termos técnicos importantes.`;

    historico.push({ role: 'user', content: msg });

    const thinkId = 'ai-think-' + Date.now();
    addBubble('ai', '<span class="fz-chat-thinking"><span></span><span></span><span></span></span>', thinkId);

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'system', content: sysMsg }, ...historico],
          max_tokens: 1024,
          temperature: 0.5,
        }),
      });
      const data = await res.json();
      const resposta = data.choices?.[0]?.message?.content || '';
      if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);

      historico.push({ role: 'assistant', content: resposta });

      const el = document.getElementById(thinkId);
      if (el) el.querySelector('.fz-chat-bubble-inner').innerHTML = renderMd(esc(resposta));

    } catch (e) {
      const el = document.getElementById(thinkId);
      if (el) el.querySelector('.fz-chat-bubble-inner').innerHTML =
        `<span style="color:var(--fz-bad)">Erro: ${esc(e.message)}</span>`;
    }

    document.getElementById('fzChatMsgs').scrollTop = 99999;
  }

  window.FZChatScreen = { init };
})();
