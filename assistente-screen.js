/* assistente-screen.js — workspace do Assistente IA (sidebar de projetos/histórico + chat) */
(function () {
  let iniciado = false;

  const STORAGE_KEY = 'forzy-chat-sessions-v1';
  const MAX_SESSOES = 100;

  const PROJETOS = [
    { id: 'vibracao',    nome: 'Análise de Vibração',       icon: 'activity' },
    { id: 'manutencao',  nome: 'Relatórios de Manutenção',  icon: 'wrench' },
    { id: 'diagnostico', nome: 'Diagnósticos de Motores',   icon: 'stethoscope' },
  ];

  const SUGESTOES = [
    { icon: 'stethoscope', titulo: 'Diagnóstico de Equipamento', sub: 'Analise sintomas e receba causa provável', q: 'Qual o status atual do motor?' },
    { icon: 'brain-circuit', titulo: 'Explicar Baseline ML',      sub: 'Como funciona a detecção por z-score',    q: 'Explique o baseline ML' },
    { icon: 'book-open',   titulo: 'Norma ISO 10816',            sub: 'Limites de severidade de vibração',       q: 'O que é ISO 10816?' },
    { icon: 'activity',    titulo: 'Interpretar Vibração',       sub: 'Entenda os sinais de alta vibração',      q: 'Como interpretar vibração alta?' },
  ];

  let sessions = [];
  let currentId = null;
  let projetoAtivo = null;    // filtro do histórico
  let anexoPendente = null;   // { nome, conteudo }

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

  /* ----------  persistência  ---------- */
  function carregar() {
    try {
      const d = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (d && Array.isArray(d.sessions)) { sessions = d.sessions; currentId = d.currentId || null; }
    } catch (_) {}
    if (!sessions.length) novaSessao();
    else if (!sessions.some(s => s.id === currentId)) currentId = sessions[0].id;
  }
  function salvar() {
    if (sessions.length > MAX_SESSOES) sessions = sessions.slice(0, MAX_SESSOES);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessions, currentId })); } catch (_) {}
  }
  function sessaoAtual() { return sessions.find(s => s.id === currentId); }
  function sessaoPorOrigem(origem) { return sessions.find(s => s.origem === origem); }

  // origem = chave estável da fonte do alerta ('esp32', 'dataset-forzy', 'ativo:BBA-001', ...).
  // Conversas criadas manualmente (Novo Chat) não têm origem — nunca colidem com as de alerta.
  function novaSessao(projectId, origem) {
    const s = {
      id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: null,
      projectId: projectId || null,
      origem: origem || null,
      criadoEm: new Date().toISOString(),
      atualizadoEm: new Date().toISOString(),
      bubbles: [],
      historico: [],
    };
    sessions.unshift(s);
    currentId = s.id;
    return s;
  }

  function tocar(s) { s.atualizadoEm = new Date().toISOString(); }

  function tituloTruncado(t) {
    if (!t) return 'Nova conversa';
    return t.length > 34 ? t.slice(0, 34) + '…' : t;
  }

  function grupoDe(iso) {
    const d = new Date(iso), now = new Date();
    if (d.toDateString() === now.toDateString()) return 'Hoje';
    const dias = Math.floor((now - d) / 86400000);
    if (dias <= 7) return 'Últimos 7 dias';
    if (dias <= 30) return 'Mês passado';
    return 'Mais antigo';
  }

  /* ----------  sidebar secundária  ---------- */
  function renderSidebar() {
    const el = document.getElementById('fzChatSidebar');
    if (!el) return;
    const ORDEM = ['Hoje', 'Últimos 7 dias', 'Mês passado', 'Mais antigo'];
    const filtradas = sessions
      .filter(s => !projetoAtivo || s.projectId === projetoAtivo)
      .slice().sort((a, b) => new Date(b.atualizadoEm) - new Date(a.atualizadoEm));
    const porGrupo = {};
    filtradas.forEach(s => (porGrupo[grupoDe(s.atualizadoEm)] ||= []).push(s));

    const histHtml = filtradas.length
      ? ORDEM.filter(g => porGrupo[g]).map(g => `
        <div class="fz-chat-hist-group">
          <div class="fz-chat-hist-group-label">${g}</div>
          ${porGrupo[g].map(s => `
            <div class="fz-chat-hist-item ${s.id === currentId ? 'active' : ''}" data-id="${s.id}">
              <i data-lucide="message-square"></i><span>${esc(tituloTruncado(s.title))}</span>
              <button class="fz-chat-hist-del" data-del="${s.id}" title="Excluir"><i data-lucide="x"></i></button>
            </div>`).join('')}
        </div>`).join('')
      : '<div class="fz-chat-hist-empty">Nenhuma conversa ainda.</div>';

    el.innerHTML = `
      <button class="fz-chat-new" id="fzChatNew"><i data-lucide="plus"></i> Novo Chat</button>
      <div class="fz-chat-side-label">Projetos</div>
      <div class="fz-chat-projects">
        ${PROJETOS.map(p => `<button class="fz-chat-project ${projetoAtivo === p.id ? 'active' : ''}" data-pid="${p.id}"><i data-lucide="${p.icon}"></i><span>${esc(p.nome)}</span></button>`).join('')}
      </div>
      <div class="fz-chat-side-label">Histórico</div>
      <div class="fz-chat-history">${histHtml}</div>
    `;

    el.querySelector('#fzChatNew').addEventListener('click', () => { novaSessao(projetoAtivo); salvar(); renderTudo(); });
    el.querySelectorAll('.fz-chat-project').forEach(b => b.addEventListener('click', () => {
      projetoAtivo = projetoAtivo === b.dataset.pid ? null : b.dataset.pid;
      renderSidebar();
    }));
    el.querySelectorAll('.fz-chat-hist-item').forEach(b => b.addEventListener('click', e => {
      if (e.target.closest('.fz-chat-hist-del')) return;
      currentId = b.dataset.id;
      salvar(); renderTudo();
    }));
    el.querySelectorAll('.fz-chat-hist-del').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      excluirSessao(b.dataset.del);
    }));
    if (window.lucide) lucide.createIcons();
  }

  function excluirSessao(id) {
    sessions = sessions.filter(s => s.id !== id);
    if (currentId === id) {
      if (!sessions.length) novaSessao();
      else currentId = sessions[0].id;
    }
    salvar(); renderTudo();
  }

  /* ----------  área de mensagens  ---------- */
  function welcomeHtml() {
    return `
      <div class="fz-chat-welcome">
        <div class="fz-chat-welcome-icon"><i data-lucide="cpu"></i></div>
        <div class="fz-chat-welcome-title">Como posso ajudar?</div>
        <div class="fz-chat-welcome-sub">Faça perguntas sobre os equipamentos, dados de vibração, temperatura, anomalias ou manutenção.</div>
        <div class="fz-chat-suggest-grid" id="fzChatSuggest">
          ${SUGESTOES.map((s, i) => `
            <button class="fz-chat-suggest-card" data-i="${i}">
              <div class="fz-chat-suggest-icon"><i data-lucide="${s.icon}"></i></div>
              <div class="fz-chat-suggest-title">${esc(s.titulo)}</div>
              <div class="fz-chat-suggest-sub">${esc(s.sub)}</div>
            </button>`).join('')}
        </div>
      </div>
    `;
  }

  function ativarSuggest() {
    const grid = document.getElementById('fzChatSuggest');
    if (!grid) return;
    grid.addEventListener('click', e => {
      const card = e.target.closest('.fz-chat-suggest-card');
      if (card) enviar(SUGESTOES[+card.dataset.i].q);
    });
  }

  function redesenharMsgs() {
    const msgs = document.getElementById('fzChatMsgs');
    if (!msgs) return;
    const s = sessaoAtual();
    if (!s || !s.bubbles.length) {
      msgs.innerHTML = welcomeHtml();
      if (window.lucide) lucide.createIcons();
      ativarSuggest();
    } else {
      msgs.innerHTML = s.bubbles.map(b =>
        `<div class="fz-chat-bubble fz-chat-${b.role}"><div class="fz-chat-bubble-inner">${b.html}</div></div>`
      ).join('');
    }
    msgs.scrollTop = msgs.scrollHeight;
  }

  function redesenharHeader() {
    const t = document.getElementById('fzChatCurTitle');
    if (t) t.textContent = tituloTruncado(sessaoAtual()?.title);
  }

  function renderTudo() {
    redesenharHeader();
    redesenharMsgs();
    renderSidebar();
  }

  // a altura fixa via CSS não sabe quanto espaço a topbar/breadcrumb ocupam acima —
  // calcula com precisão o que sobra de viewport. Some/aparece com display:none,
  // então só recalcula quando a tela está realmente visível (top > 0).
  function ajustarAltura() {
    const ws = document.querySelector('.fz-chat-workspace');
    if (!ws) return;
    const top = ws.getBoundingClientRect().top;
    if (top <= 0) return;
    ws.style.height = Math.max(460, window.innerHeight - top - 24) + 'px';
  }

  /* ----------  montagem inicial  ---------- */
  function init() {
    if (iniciado) return;
    iniciado = true;
    const host = document.getElementById('fz-chat-screen');
    if (!host) return;
    carregar();

    host.innerHTML = `
      <div class="fz-chat-workspace">
        <aside class="fz-chat-sidebar" id="fzChatSidebar"></aside>
        <div class="fz-chat-wrap">
          <div class="fz-chat-header">
            <div class="fz-chat-header-info">
              <div class="fz-chat-avatar"><i data-lucide="bot"></i></div>
              <div>
                <div class="fz-chat-title" id="fzChatCurTitle">Nova conversa</div>
                <div class="fz-chat-sub">IA técnica · Manutenção preditiva · GPT-4o mini</div>
              </div>
            </div>
            <button class="fz-chat-clear" id="fzChatClear" title="Excluir esta conversa"><i data-lucide="trash-2"></i></button>
          </div>

          <div class="fz-chat-messages" id="fzChatMsgs"></div>

          <div class="fz-chat-input-area">
            <div id="fzChatAttachPreview"></div>
            <div class="fz-chat-input-row">
              <input type="file" id="fzChatFile" accept=".csv,.log,.txt,text/csv,text/plain" style="display:none">
              <button class="fz-chat-attach" id="fzChatAttachBtn" title="Anexar log ou CSV"><i data-lucide="paperclip"></i></button>
              <textarea class="fz-chat-textarea" id="fzChatInput" rows="1" placeholder="Pergunte sobre vibração, temperatura, falhas…"></textarea>
              <button class="fz-chat-send" id="fzChatSend"><i data-lucide="send"></i></button>
            </div>
            <div class="fz-chat-footnote">A IA pode cometer erros. Verifique os dados das máquinas.</div>
          </div>
        </div>
      </div>
    `;

    renderTudo();
    ajustarAltura();
    window.addEventListener('resize', ajustarAltura);

    const input = document.getElementById('fzChatInput');
    const sendBtn = document.getElementById('fzChatSend');
    const clearBtn = document.getElementById('fzChatClear');
    const attachBtn = document.getElementById('fzChatAttachBtn');
    const fileInput = document.getElementById('fzChatFile');

    sendBtn.addEventListener('click', () => enviar());
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); }
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 160) + 'px';
      sendBtn.classList.toggle('active', input.value.trim().length > 0);
    });
    clearBtn.addEventListener('click', () => excluirSessao(currentId));

    attachBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        let conteudo = String(ev.target.result || '');
        if (conteudo.length > 6000) conteudo = conteudo.slice(0, 6000) + '\n… (truncado)';
        anexoPendente = { nome: file.name, conteudo };
        mostrarAnexo();
      };
      reader.readAsText(file);
      fileInput.value = '';
    });
  }

  function mostrarAnexo() {
    const prev = document.getElementById('fzChatAttachPreview');
    if (!prev) return;
    if (!anexoPendente) { prev.innerHTML = ''; return; }
    prev.innerHTML = `<div class="fz-chat-attach-chip"><i data-lucide="file-text"></i><span>${esc(anexoPendente.nome)}</span><button id="fzChatAttachRm" title="Remover">✕</button></div>`;
    if (window.lucide) lucide.createIcons();
    document.getElementById('fzChatAttachRm').addEventListener('click', () => { anexoPendente = null; mostrarAnexo(); });
  }

  /* ----------  bolhas  ---------- */
  function addBubble(role, html, id) {
    const s = sessaoAtual();
    s.bubbles.push({ role, html, id });
    const msgs = document.getElementById('fzChatMsgs');
    if (!msgs) return;
    const welcome = msgs.querySelector('.fz-chat-welcome');
    if (welcome) welcome.remove();
    const div = document.createElement('div');
    div.className = `fz-chat-bubble fz-chat-${role}`;
    if (id) div.id = id;
    div.innerHTML = `<div class="fz-chat-bubble-inner">${html}</div>`;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }
  function atualizarBubble(id, html) {
    const s = sessaoAtual();
    const b = s.bubbles.find(x => x.id === id);
    if (b) b.html = html;
    const el = document.getElementById(id);
    if (el) el.querySelector('.fz-chat-bubble-inner').innerHTML = html;
  }

  // contexto técnico dos ativos cadastrados (fabricante/potência/placa) + última leitura de cada
  function contextoAtivos() {
    if (!window.FZStore) return '';
    const ativos = window.FZStore.getAtivosIndustrial?.() || [];
    if (!ativos.length) return '';
    const linhas = ativos.map(a => {
      const partes = [
        `[${a.codigo}]`,
        a.tag ? `Tag: ${a.tag}` : '',
        a.descricao ? a.descricao : '',
        a.fabricante ? `Fab: ${a.fabricante}` : '',
        a.potencia_kw ? `${a.potencia_kw} kW` : '',
        a.tensao_v ? `${a.tensao_v}V` : '',
        a.ip_rating ? `IP${a.ip_rating}` : '',
        a.status ? `Status: ${a.status}` : '',
      ].filter(Boolean).join(' | ');
      const leituras = window.FZStore.getLeituras?.(a.codigo, 1) || [];
      let leituraTxt = '';
      if (leituras.length) {
        const l = leituras[0];
        const flag = (l.vel_rms >= 4.5) ? 'ALARME' : (l.vel_rms >= 1.8) ? 'ALERTA' : 'Normal';
        leituraTxt = ` — Última leitura: Vel=${(l.vel_rms||0).toFixed(3)}mm/s (${flag}), Temp=${(l.temp_c||0).toFixed(1)}°C`;
      }
      return `  ${partes}${leituraTxt}`;
    });
    return `\n\n[ATIVOS CADASTRADOS — dados de placa]\n${linhas.join('\n')}`;
  }

  async function enviar(texto, opts) {
    const isAlerta = !!(opts && opts.isAlerta);
    const input = document.getElementById('fzChatInput');
    const msg = (texto || input?.value || '').trim();
    if (!msg) return;

    if (input) { input.value = ''; input.style.height = 'auto'; document.getElementById('fzChatSend')?.classList.remove('active'); }

    let bolhaTexto = esc(msg).replace(/\n/g, '<br>');
    let anexoCtx = '';
    if (anexoPendente) {
      bolhaTexto += `<div class="fz-chat-bubble-attach"><i data-lucide="file-text"></i> ${esc(anexoPendente.nome)}</div>`;
      anexoCtx = `\n\n[ARQUIVO ANEXADO: ${anexoPendente.nome}]\n${anexoPendente.conteudo}`;
      anexoPendente = null; mostrarAnexo();
    }
    addBubble(isAlerta ? 'alerta' : 'user', bolhaTexto);
    if (window.lucide) lucide.createIcons();

    const s = sessaoAtual();
    if (!s.title) s.title = msg.slice(0, 60);
    tocar(s);
    renderSidebar();

    const apiKey = window.FORZY_OPENAI_KEY;
    if (!apiKey) {
      addBubble('ai', '<span style="color:var(--fz-bad)">Chave de API não configurada em config.js</span>');
      return;
    }

    const ehOperador = !!(window.FZPerfil && window.FZPerfil.isOperador && window.FZPerfil.isOperador());
    const sysMsg = ehOperador
      ? `Você é o Assistente IA da plataforma IMS Forzy, falando com um OPERADOR de chão de fábrica.
Responda em no máximo 2 frases curtas. Veredito direto, linguagem simples, sem normas nem jargão técnico (nada de ISO, ISA, Z-score).
Diga o que está acontecendo e o que fazer agora.`
      : `Você é o Assistente IA da plataforma IMS Forzy, especializado em manutenção preditiva de bombas centrífugas industriais.
Responda de forma técnica, clara e objetiva. Use normas ISO 10816 e ISA-18.2 quando relevante.
Quando o assunto for um alerta ou falha, baseie o diagnóstico nos dados de placa (fabricante, potência, modelo) do ativo envolvido.
Seja direto: máximo 3-4 parágrafos por resposta. Use **negrito** para destacar termos técnicos importantes.`;

    s.historico.push({ role: 'user', content: msg + anexoCtx + contextoAtivos() });

    const thinkId = 'ai-think-' + Date.now();
    addBubble('ai', '<span class="fz-chat-thinking"><span></span><span></span><span></span></span>', thinkId);

    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [{ role: 'system', content: sysMsg }, ...s.historico],
          max_tokens: 1024,
          temperature: 0.5,
        }),
      });
      const data = await res.json();
      const resposta = data.choices?.[0]?.message?.content || '';
      if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);

      s.historico.push({ role: 'assistant', content: resposta });
      atualizarBubble(thinkId, renderMd(esc(resposta)));

    } catch (e) {
      atualizarBubble(thinkId, `<span style="color:var(--fz-bad)">Erro: ${esc(e.message)}</span>`);
    }

    tocar(s); salvar(); renderSidebar();
    const msgs = document.getElementById('fzChatMsgs');
    if (msgs) msgs.scrollTop = 99999;
  }

  // usado por assistant.js para empurrar alertas automáticos (IoT/ISA-18.2).
  // Cada FONTE (origem) tem uma única conversa que vai sendo atualizada — nunca cria
  // uma sessão nova pra cada alerta; ESP32 sempre no chat do ESP32, Dataset Forzy
  // sempre no chat do Dataset Forzy, etc. Só troca de tela se o usuário já estiver no
  // Assistente — senão processa em segundo plano (a análise já fica pronta no
  // histórico) e só acende a bolinha no menu.
  function enviarAlerta(msgIA, tituloSugerido, origem) {
    init();
    const jaEstaAberto = document.getElementById('screen-assistente')?.classList.contains('active');
    if (jaEstaAberto) {
      if (typeof window.showScreen === 'function') window.showScreen('assistente');
    } else {
      document.getElementById('navAssistenteDot')?.classList.add('show');
    }
    let s = origem ? sessaoPorOrigem(origem) : null;
    if (s) currentId = s.id;
    else s = novaSessao(null, origem);
    if (tituloSugerido) s.title = tituloSugerido.slice(0, 60);
    salvar(); renderTudo();
    // notifica 2x: assim que a bolha do alerta entra, e de novo quando a IA responde —
    // widgets embutidos (modal de eixo) acompanham sem precisar de polling.
    const p = enviar(msgIA, { isAlerta: true });
    notificarAlerta(origem, s);
    p.then(() => notificarAlerta(origem, s)).catch(() => {});
  }

  /* ----------  assinatura de alertas (pra widgets embutidos)  ---------- */
  const listenersAlerta = [];
  function onAlerta(cb) {
    listenersAlerta.push(cb);
    return () => { const i = listenersAlerta.indexOf(cb); if (i >= 0) listenersAlerta.splice(i, 1); };
  }
  function notificarAlerta(origem, sessao) {
    listenersAlerta.forEach(cb => { try { cb(origem, sessao); } catch (_) {} });
  }

  // ---- API usada por widgets embutidos fora desta tela (ex: modal de eixo em forzy.js) ----

  // leitura só-consulta da conversa "dona" de uma origem — pra widgets mostrarem um preview
  function getSessao(origem) { return origem ? sessaoPorOrigem(origem) : null; }

  // pergunta do usuário endereçada à conversa de uma origem específica (cria se não existir).
  // Mesma sessão que o Assistente IA usa — widget embutido e tela cheia sempre em sincronia.
  async function perguntar(origem, tituloSugerido, texto) {
    init();
    let s = origem ? sessaoPorOrigem(origem) : null;
    if (s) currentId = s.id;
    else s = novaSessao(null, origem);
    if (!s.title && tituloSugerido) s.title = tituloSugerido.slice(0, 60);
    salvar();
    await enviar(texto, {});
  }

  // troca a conversa ativa pra de uma origem (cria se não existir) sem enviar nada —
  // usado pelo botão "Abrir conversa completa" do modal de eixo antes de navegar pra tela.
  function abrirConversa(origem, tituloSugerido) {
    init();
    let s = origem ? sessaoPorOrigem(origem) : null;
    if (s) currentId = s.id;
    else { s = novaSessao(null, origem); if (tituloSugerido) s.title = tituloSugerido.slice(0, 60); }
    salvar(); renderTudo();
  }

  window.FZChatScreen = { init, enviarAlerta, ajustarAltura, getSessao, perguntar, abrirConversa, onAlerta };

  // ---- deep-link do modal de alerta crítico (alerta-critico.js) ----
  // Abre a tela unificada na aba "Conversa" já com o contexto do alerta carregado.
  function abrirComContexto(payload) {
    payload = payload || {};
    init();
    if (typeof window.showScreen === 'function') window.showScreen('assistente');
    // garante a aba "Conversa" ativa
    const abaConversa = document.querySelector('#fzAssistTabs .fz-tab[data-atab="conversa"]');
    if (abaConversa && !abaConversa.classList.contains('active')) abaConversa.click();

    const eixoNome = payload.eixo === 'm2' ? 'Eixo 2' : payload.eixo === 'm1' ? 'Eixo 1' : null;
    const origem = payload.origem || (eixoNome ? 'alerta:' + eixoNome : 'alerta:geral');
    const titulo = payload.titulo || (eixoNome ? eixoNome + ' — alerta' : 'Alerta');

    abrirConversa(origem, titulo);
    ajustarAltura();

    const partes = [
      payload.titulo || 'Alerta de manutenção',
      eixoNome ? `Eixo: ${eixoNome}` : '',
      payload.variavel ? `Variável: ${payload.variavel}` : '',
      (payload.valor != null) ? `Valor: ${payload.valor}${payload.unidade || ''}` : '',
      payload.msg || '',
    ].filter(Boolean).join(' · ');
    enviar(`${partes}\n\nO que devo fazer?`, { isAlerta: true });
  }

  window.FZAssistente = Object.assign(window.FZAssistente || {}, { abrirComContexto });
})();
