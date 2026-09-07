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
    { icon: 'brain-circuit', titulo: 'Explicar a rede neural',    sub: 'Como o autoencoder acha anomalias',       q: 'Explique como a rede neural (autoencoder) detecta anomalias nas leituras e o que significa o índice de anomalia' },
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
  // markdown mínimo: negrito/itálico/código + títulos, listas e parágrafos. Recebe
  // texto JÁ escapado (esc) — só transforma marcação, nunca abre HTML. A IA responde
  // quase sempre em "1. Causa / 2. Risco / 3. Ação" com sub-itens; sem lista de
  // verdade isso virava um bloco de <br> difícil de ler.
  function renderMd(text) {
    const inline = t => t
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/`([^`]+?)`/g, '<code class="fz-md-code">$1</code>');
    const out = [];
    let lista = null;   // 'ul' | 'ol' aberta no momento
    const fechar = () => { if (lista) { out.push(`</${lista}>`); lista = null; } };
    String(text).split('\n').forEach(raw => {
      const l = raw.trim();
      let m;
      if ((m = l.match(/^#{1,4}\s+(.*)$/))) { fechar(); out.push(`<div class="fz-md-h">${inline(m[1])}</div>`); }
      else if ((m = l.match(/^[-*•]\s+(.*)$/))) {
        if (lista !== 'ul') { fechar(); out.push('<ul>'); lista = 'ul'; }
        out.push(`<li>${inline(m[1])}</li>`);
      } else if ((m = l.match(/^\d+[.)]\s+(.*)$/))) {
        if (lista !== 'ol') { fechar(); out.push('<ol>'); lista = 'ol'; }
        out.push(`<li>${inline(m[1])}</li>`);
      } else if (!l) { fechar(); out.push('<br>'); }
      else { fechar(); out.push(inline(l) + '<br>'); }
    });
    fechar();
    return out.join('')
      .replace(/<br>(<\/?(?:ul|ol|div)[^>]*>)/g, '$1')   // quebra antes de lista/título só abre buraco
      .replace(/(<br>){3,}/g, '<br><br>')
      .replace(/<br>$/, '');
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
        `<div class="fz-chat-bubble fz-chat-${b.role}${b.cls ? ' ' + b.cls : ''}"><div class="fz-chat-bubble-inner">${b.html}</div></div>`
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
  function addBubble(role, html, id, cls) {
    const s = sessaoAtual();
    s.bubbles.push({ role, html, id, cls: cls || undefined });
    const msgs = document.getElementById('fzChatMsgs');
    if (!msgs) return;
    const welcome = msgs.querySelector('.fz-chat-welcome');
    if (welcome) welcome.remove();
    const div = document.createElement('div');
    div.className = `fz-chat-bubble fz-chat-${role}${cls ? ' ' + cls : ''}`;
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

  /*
   * Veredito da REDE NEURAL sobre a leitura que está na tela agora.
   * Sem isso a IA responderia só com o que ela mesma sabe de bomba — e não com o
   * que o modelo treinado no dataset da Forzy achou desta leitura específica.
   * Manda o índice, o nível e qual variável puxou o erro de reconstrução, pra
   * resposta citar o mesmo número que o operador está vendo na aba Baseline ML.
   */
  function contextoRede(leituraFixa) {
    try {
      const M = window.FZModelo;
      if (!M || !M.pronto()) return '';
      // leituraFixa = a leitura gravada no alarme (a que disparou), quando a pergunta
      // vem de um alerta; senão, o que está na tela agora.
      const leitura = leituraFixa || window.FZDashboard?.getCurrentReading?.();
      if (!leitura) return '';
      const r = M.avaliar(leitura);
      if (!r || !r.ok) return '';
      const info = M.info() || {};
      const quando = leituraFixa ? 'leitura do momento do alarme' : 'leitura na tela agora';
      const fora = r.fora.slice(0, 3).map(f =>
        `  ${f.rotulo}: medido ${f.medido.toFixed(f.dec)} ${f.unidade}, ` +
        `a rede esperava ${f.esperado.toFixed(f.dec)} ${f.unidade} (${f.pct.toFixed(0)}% do erro)`
      ).join('\n');
      return `\n\n[REDE NEURAL — autoencoder ${info.arquitetura || ''} treinado em ${info.amostras || '?'} amostras do dataset Forzy · ${quando}]\n`
        + `Veredito: ${r.rotulo} · índice de anomalia ${r.indice.toFixed(2)} `
        + `(1,00 = limiar de atenção, ${r.limCritico.toFixed(2)} = crítico)\n`
        + `Origem do veredito: ${r.motivo}\n`
        + `Contribuição por variável:\n${fora}\n`
        + `Explicação do modelo: ${r.explicacao}`;
    } catch (_) { return ''; }
  }

  // opts: { isAlerta, html, prompt, leitura, critico }
  //   html    — o que a bolha mostra (default: o texto escapado). Alerta manda um card.
  //   prompt  — o que vai pra API (default: o próprio texto). Deixa a conversa só com
  //             os fatos e manda a instrução completa pra IA sem poluir a tela.
  //   leitura — leitura gravada no alarme, pra rede neural avaliar ELA, não a da tela.
  async function enviar(texto, opts) {
    opts = opts || {};
    const isAlerta = !!opts.isAlerta;
    const input = document.getElementById('fzChatInput');
    const msg = (texto || input?.value || '').trim();
    if (!msg) return;

    // só limpa o campo quando a mensagem saiu dele — um alerta chegando não pode
    // apagar o que o usuário está digitando
    if (input && !texto) { input.value = ''; input.style.height = 'auto'; document.getElementById('fzChatSend')?.classList.remove('active'); }

    let bolhaTexto = opts.html || (isAlerta ? renderMd(esc(msg)) : esc(msg).replace(/\n/g, '<br>'));
    let anexoCtx = '';
    if (anexoPendente && !isAlerta) {
      bolhaTexto += `<div class="fz-chat-bubble-attach"><i data-lucide="file-text"></i> ${esc(anexoPendente.nome)}</div>`;
      anexoCtx = `\n\n[ARQUIVO ANEXADO: ${anexoPendente.nome}]\n${anexoPendente.conteudo}`;
      anexoPendente = null; mostrarAnexo();
    }
    addBubble(isAlerta ? 'alerta' : 'user', bolhaTexto, null, opts.critico ? 'fz-chat-alerta-p1' : '');
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

    s.historico.push({ role: 'user', content: (opts.prompt || msg) + anexoCtx + contextoAtivos() + contextoRede(opts.leitura) });

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

  // Primitiva programática: empurra um texto como bolha de alerta na conversa da
  // origem e pede a análise. NADA chama isto automaticamente — o caminho normal de
  // um alarme é abrirComContexto(), acionado pelo operador no modal/rail. Cada FONTE
  // (origem) tem uma única conversa; só troca de tela se o usuário já estiver no
  // Assistente, senão processa em segundo plano e acende a bolinha no menu.
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

  // ---- deep-link do modal P1 (alerta-critico.js) e do rail (alert-rail.js) ----
  // É AQUI, e só aqui, que um alarme vira pergunta pra IA — quando o operador clicou
  // "Analisar com IA" / "Perguntar ao Assistente". Abre a tela unificada na aba
  // "Conversa", na conversa da origem do alarme, com um card dos fatos e a análise.
  // O mesmo alarme pedido duas vezes (modal e depois rail) não gera segunda análise:
  // só reabre a conversa onde ela já está.
  const alertasAnalisados = new Set();

  function rotuloOrigem(origem) {
    const o = String(origem || '').split(':')[0];
    const MAPA = { 'dataset-forzy': 'Dataset Forzy', simulado: 'Simulado', 'forzy-cloud': 'Forzy Cloud', esp32: 'ESP32', dashboard: 'Dashboard' };
    if (MAPA[o]) return MAPA[o];
    if (o === 'ativo') return 'Ativo ' + String(origem).slice(6);
    return '';
  }

  function abrirComContexto(payload) {
    payload = payload || {};
    init();
    if (typeof window.showScreen === 'function') window.showScreen('assistente');

    const eixoNome = payload.eixo === 'm2' ? 'Eixo 2' : payload.eixo === 'm1' ? 'Eixo 1' : null;
    const origem = payload.origem || (eixoNome ? 'alerta:' + eixoNome : 'alerta:geral');
    const critico = String(payload.prioridade || '').indexOf('P1') === 0;
    const titulo = (eixoNome ? eixoNome + ' — ' : '') + (payload.titulo || 'Alerta');

    abrirConversa(origem, titulo);
    ajustarAltura();

    const chave = payload.chave || ((payload.prioridade || '') + '|' + (payload.msg || ''));
    if (alertasAnalisados.has(chave)) return;
    alertasAnalisados.add(chave);

    const ehIndice = payload.unidade === 'índice';
    const valorFmt = (payload.valor != null && !isNaN(payload.valor))
      ? Number(payload.valor).toFixed(payload.unidade === '°C' ? 1 : 2) + (ehIndice ? '' : ' ' + (payload.unidade || ''))
      : null;
    const quando = new Date(payload.ts || Date.now()).toLocaleString('pt-BR');
    const variavel = ehIndice ? 'índice de anomalia (rede neural)'
      : String(payload.variavel || '').includes('temp') ? 'temperatura' : 'vibração (vel. RMS)';
    const fonte = rotuloOrigem(origem);
    const operador = !!(window.FZPerfil && window.FZPerfil.isOperador && window.FZPerfil.isOperador());

    // o card que fica na conversa: só os fatos do alarme
    const html = `
      <div class="fz-chat-alerta-card">
        <div class="fz-chat-alerta-head">
          <span class="fz-chat-alerta-badge ${critico ? 'p1' : 'p2'}">${esc(payload.prioridade || (critico ? 'P1' : 'P2'))}</span>
          <strong>${esc(payload.titulo || 'Alerta')}</strong>
        </div>
        <div class="fz-chat-alerta-grid">
          ${fonte ? `<div><span>Fonte</span><b>${esc(fonte)}</b></div>` : ''}
          ${eixoNome ? `<div><span>Eixo</span><b>${esc(eixoNome)}</b></div>` : ''}
          <div><span>Variável</span><b>${esc(variavel)}</b></div>
          ${valorFmt ? `<div><span>${ehIndice ? 'Índice' : 'Medido'}</span><b>${esc(valorFmt)}</b></div>` : ''}
          <div><span>Momento</span><b>${esc(quando)}</b></div>
        </div>
        ${payload.msg ? `<div class="fz-chat-alerta-msg">${esc(payload.msg)}</div>` : ''}
        <div class="fz-chat-alerta-pedido">${operador
          ? 'Pedido à IA: o que está acontecendo e o que fazer agora.'
          : 'Pedido à IA: causa provável · risco · ação corretiva (imediata e preventiva).'}</div>
      </div>`;

    // o que a IA recebe: os mesmos fatos + a instrução. O veredito da rede neural
    // (sobre a leitura gravada no alarme) e os dados de placa entram em enviar().
    const fatos = [
      `[ALARME ${payload.prioridade || ''}] ${payload.titulo || 'Alerta'}`,
      fonte ? `Fonte: ${fonte}` : '',
      eixoNome ? `Eixo: ${eixoNome}` : '',
      `Variável: ${variavel}`,
      valorFmt ? `Valor medido: ${valorFmt}` : '',
      `Momento: ${quando}`,
      payload.msg ? `Detalhe: ${payload.msg}` : '',
    ].filter(Boolean).join('\n');
    const prompt = operador
      ? `${fatos}\n\nO que está acontecendo e o que eu faço agora?`
      : `${fatos}\n\nSeguindo ISO 10816 e ISA-18.2 — e usando o veredito da rede neural e os dados de placa do ativo quando houver — responda em três blocos curtos:\n1. **Causa provável** deste desvio\n2. **Risco** se não houver intervenção\n3. **Ação corretiva recomendada** (imediata e preventiva)`;

    const s = sessaoAtual();
    const p = enviar(`${payload.prioridade || 'Alerta'} — ${payload.titulo || ''} ${eixoNome || ''}`.trim(),
                     { isAlerta: true, html, prompt, leitura: payload.leitura || null, critico });
    // widgets embutidos (modal de eixo em forzy.js) acompanham sem polling
    notificarAlerta(origem, s);
    p.then(() => notificarAlerta(origem, s)).catch(() => {});
  }

  window.FZAssistente = Object.assign(window.FZAssistente || {}, { abrirComContexto });
})();
