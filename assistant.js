/* ===================================================================
   FORZY · Assistente IA — OpenAI (gpt-4o-mini)
   Bolinha flutuante no canto inferior direito.
   Entende o projeto, os motores, as métricas e responde em PT-BR.
   =================================================================== */
(function () {

  const OPENAI_KEY = window.FORZY_OPENAI_KEY || '';
  const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

  /* ----------  System Prompt — contexto completo do projeto  ---------- */
  const SYSTEM = `Você é o **Assistente Técnico Forzy**, especialista em manutenção preditiva de bombas centrífugas e motores elétricos.
Você faz parte do sistema IMS · Forzy — um dashboard industrial de monitoramento em tempo real.

## Sobre o sistema
- Monitora bombas centrífugas via sensor MPU6050 acoplado a ESP32
- Mede vibração (aceleração RMS e velocidade RMS), temperatura e frequência
- Usa a norma ISO 10816 para classificação de severidade
- Possui um motor do dataset histórico monitorado em dois eixos: BBA-001 (Eixo 1) e BBA-002 (Eixo 2)
- Fabricante: WEG · Tensão: 380V · IP55

## Norma ISO 10816 — Limites (motores < 15 kW, Classe I)
| Condição  | Velocidade RMS |
|-----------|---------------|
| ✅ Normal  | < 1,8 mm/s    |
| ⚠ Alerta  | 1,8 – 4,5 mm/s|
| 🚨 Alarme | > 4,5 mm/s    |

## Interpretação de métricas
- **Velocidade RMS (mm/s)**: principal indicador de severidade de vibração — quanto maior, pior
- **Aceleração RMS (g)**: detecta impactos e defeitos de rolamentos em alta frequência
- **Temperatura (°C)**: alerta > 35°C, alarme > 42°C — indica sobrecarga ou falta de lubrificação
- **Freq. dominante (Hz)**: frequência de rotação; harmônicas indicam desbalanceamento (1x), desalinhamento (2x), folga (3x+)

## Diagnóstico de falhas comuns
| Sintoma                          | Causa provável                  | Solução                            |
|----------------------------------|---------------------------------|------------------------------------|
| Vibração alta 1x RPM             | Desbalanceamento do rotor       | Balanceamento dinâmico             |
| Vibração alta 2x RPM             | Desalinhamento de acoplamento   | Realinhamento laser                |
| Vibração alta 3x+ RPM            | Folga mecânica                  | Inspeção de mancais e fixações     |
| Vibração aleatória de alta freq. | Defeito em rolamento            | Substituir rolamento                |
| Ruído + vibração + cavitação     | Sucção insuficiente / NPSH baixo| Aumentar pressão de sucção         |
| Temperatura crescente            | Sobrecarga ou falta de lubrif.  | Verificar carga e lubrificação     |
| Vibração + temperatura alta      | Defeito múltiplo                | Parada imediata para inspeção      |

## Sobre o dashboard
- **Início**: KPIs ao vivo, log de eventos, sparklines
- **Dashboard**: Monitoramento (gauges, histórico), Espectral (FFT), Operacional, Histórico, Baseline ML
- **SCADA**: Planta 2D e Vista 3D da bomba
- **IoT ESP32**: Leituras ao vivo via Web Serial API ou Bridge Python
- **Cadastro**: CRUD de ativos, plantas e áreas; Dashboard do Ativo com ficha técnica
- **Gestão**: Navegação de ativos, RPA (OCR de nameplates), Pipeline

## Como usar o contexto injetado
Cada mensagem do usuário vem com um bloco [CONTEXTO DO SISTEMA] contendo:
- **TELA ATUAL**: qual tela/página o usuário está vendo agora
- **Aba ativa**: sub-aba dentro da tela (Pipeline, Monitoramento, etc.)
- **Motor selecionado / Ativo aberto**: o que está em foco
- **KPIs, leituras ESP32, ativos cadastrados**

Use SEMPRE esse contexto. Se o usuário perguntar "onde estou?" ou "o que é isso aqui?", responda com base na tela atual. NUNCA invente uma tela diferente da que está no contexto.

## Regras de resposta
- Responda SEMPRE em português do Brasil
- Seja direto e técnico, como um colega de trabalho experiente
- Quando o usuário descrever um sintoma, sugira causa + solução
- Se houver leitura ESP32, comente o status (Normal/Alerta/Alarme)
- Use emojis com moderação
- Máximo de 3 parágrafos por resposta
- Nunca responda sobre telas/abas que não estejam no contexto injetado`;

  /* ----------  Estado do chat  ---------- */
  let historico = [];   // { role, parts }
  let aberto = false;
  let carregando = false;

  // vision.html tem uma tela dedicada de chat (assistente-screen.js) — nesse caso
  // não criamos a bolinha flutuante duplicada, e os alertas automáticos são
  // empurrados pra lá em vez do painel flutuante.
  function telaDedicada() {
    return document.getElementById('fz-chat-screen') ? window.FZChatScreen : null;
  }

  /* ----------  Lê contexto ao vivo do sistema  ---------- */
  function contextoAtual() {
    const ctx = [];

    // --- 1. Qual tela está ativa ---
    const telaMap = {
      'screen-inicio':   'Início (KPIs ao vivo)',
      'screen-forzy':    'Dashboard do Motor',
      'screen-cadastro': 'Cadastro de Ativos',
      'screen-gestao':   'Gestão',
      'screen-scada':    'SCADA (Planta 2D / Vista 3D)',
      'screen-iot':      'IoT ESP32'
    };
    const telaAtiva = document.querySelector('.screen.active');
    const telaId    = telaAtiva ? telaAtiva.id : null;
    const telaNome  = telaMap[telaId] || telaId || 'desconhecida';
    ctx.push(`TELA ATUAL: ${telaNome}`);

    // --- 2. Sub-aba ativa dentro da tela (tabs com .active, .fz-tab-active etc) ---
    if (telaAtiva) {
      const tabAtiva = telaAtiva.querySelector('.fz-tab.active, .fz-tab-active, [data-tab].active, .tab-btn.active');
      if (tabAtiva) ctx.push(`Aba ativa: ${tabAtiva.textContent.trim()}`);

      // sub-aba de gestão (Pipeline / RPA / Navegação)
      const gestaoTab = telaAtiva.querySelector('.fz-nav-item.active, .fz-sidebar-item.active');
      if (gestaoTab) ctx.push(`Seção: ${gestaoTab.textContent.trim()}`);
    }

    // --- 3. Motor / ativo selecionado no Dashboard ---
    try {
      const motorSel = document.querySelector('#forzy-motor-select, #fz-motor-sel, [id*="motor"][id*="sel"]');
      if (motorSel && motorSel.value) ctx.push(`Motor selecionado: ${motorSel.options[motorSel.selectedIndex]?.text || motorSel.value}`);

      const fonteSel = document.querySelector('[data-v].active, .fz-fonte-btn.active');
      if (fonteSel) ctx.push(`Fonte de dados: ${fonteSel.textContent.trim()}`);
    } catch(_) {}

    // --- 4. Ativo aberto no Cadastro ---
    try {
      const ativoNome = document.querySelector('#da-titulo, .da-nome, #fz-da-titulo');
      if (ativoNome && ativoNome.textContent.trim()) ctx.push(`Ativo aberto: ${ativoNome.textContent.trim()}`);
    } catch(_) {}

    // --- 5. KPIs visíveis na tela Início ---
    try {
      if (telaId === 'screen-inicio') {
        const kpis = [...document.querySelectorAll('.fz-kpi-val, .kpi-val')].slice(0,6)
          .map(el => el.closest('[data-label], .fz-kpi')?.dataset?.label
               ? `${el.closest('[data-label]').dataset.label}=${el.textContent.trim()}`
               : el.textContent.trim())
          .filter(Boolean);
        if (kpis.length) ctx.push(`KPIs: ${kpis.join(' | ')}`);
      }
    } catch(_) {}

    // --- 6. ESP32 ao vivo ---
    try {
      if (window.FZIoT) {
        const last = window.FZIoT.getLast();
        const on   = window.FZIoT.isConnected();
        ctx.push(`ESP32: ${on ? 'CONECTADO' : 'desconectado'}`);
        if (last) {
          const flag = last.vel >= 4.5 ? 'ALARME' : last.vel >= 1.8 ? 'ALERTA' : 'Normal';
          ctx.push(`Leitura ESP32: Vel=${last.vel.toFixed(3)}mm/s (${flag}), Acel=${last.apeak.toFixed(4)}g, Temp=${last.temp.toFixed(1)}°C`);
        }
      }
    } catch(_) {}

    // --- 7. Ativos cadastrados + specs completas ---
    try {
      if (window.FZStore) {
        const ativos = window.FZStore.getAtivosIndustrial ? window.FZStore.getAtivosIndustrial() : [];
        if (ativos.length) {
          ctx.push(`Ativos cadastrados (${ativos.length}):`);
          ativos.forEach(a => {
            const partes = [
              `[${a.codigo}]`,
              a.tag         ? `Tag: ${a.tag}`            : '',
              a.descricao   ? a.descricao                : '',
              a.fabricante  ? `Fab: ${a.fabricante}`     : '',
              a.potencia_kw ? `${a.potencia_kw} kW`      : '',
              a.tensao_v    ? `${a.tensao_v}V`            : '',
              a.corrente_nom? `${a.corrente_nom}A`        : '',
              a.ip_rating   ? `IP${a.ip_rating}`          : '',
              a.status      ? `Status: ${a.status}`       : '',
              a.localizacao_descricao ? `Local: ${a.localizacao_descricao}` : ''
            ].filter(Boolean);
            ctx.push('  ' + partes.join(' | '));

            // última leitura do ativo
            const leituras = window.FZStore.getLeituras(a.codigo, 1);
            if (leituras.length) {
              const l = leituras[0];
              const flag = (l.vel_rms >= 4.5) ? 'ALARME' : (l.vel_rms >= 1.8) ? 'ALERTA' : 'Normal';
              ctx.push(`    Última leitura: Vel=${(l.vel_rms||0).toFixed(3)}mm/s (${flag}), Acel=${(l.acel_rms||0).toFixed(4)}g, Temp=${(l.temp_c||0).toFixed(1)}°C — ${l.coletado_em||''}`);
            }
          });
        }

        // dataset histórico Forzy (BBA-001 / BBA-002)
        if (window.FORZY) {
          ctx.push('Dataset histórico Forzy: um motor (WEG, 380V, IP55) monitorado em dois eixos — BBA-001 (Eixo 1) e BBA-002 (Eixo 2)');
        }
      }
    } catch(_) {}

    return '\n\n[CONTEXTO DO SISTEMA]\n' + ctx.map(l => '• ' + l).join('\n');
  }

  /* ----------  Imagem pendente  ---------- */
  let imagemPendente = null;  // { base64, mime, nome }

  /* ----------  Chama Groq (texto ou visão)  ---------- */
  async function perguntarGemini(texto) {
    const ctx = contextoAtual();

    // monta conteúdo da mensagem do usuário
    let userContent;
    if (imagemPendente) {
      userContent = [
        { type: 'text', text: (texto || 'Analise esta imagem do sistema.') + ctx },
        { type: 'image_url', image_url: { url: `data:${imagemPendente.mime};base64,${imagemPendente.base64}` } }
      ];
      imagemPendente = null;
      removerPreviewImagem();
    } else {
      userContent = texto + ctx;
    }

    historico.push({ role: 'user', content: userContent });

    // gpt-4o-mini é multimodal — mesmo modelo atende texto e imagem
    const msgs = [{ role: 'system', content: SYSTEM }, ...historico];

    const res = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: msgs, temperature: 0.7, max_tokens: 768 })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${res.status}`);
    }
    const data = await res.json();
    const resposta = data.choices?.[0]?.message?.content || '(sem resposta)';
    historico.push({ role: 'assistant', content: resposta });
    if (historico.length > 20) historico = historico.slice(-20);
    return resposta;
  }

  /* ----------  Preview de imagem no chat  ---------- */
  function mostrarPreviewImagem(nome) {
    let prev = document.getElementById('fz-img-preview');
    if (!prev) {
      prev = document.createElement('div');
      prev.id = 'fz-img-preview';
      document.getElementById('fz-ai-footer').prepend(prev);
    }
    prev.innerHTML = `<span>📎 ${nome}</span><button id="fz-img-rm" title="Remover">✕</button>`;
    document.getElementById('fz-img-rm').onclick = () => { imagemPendente = null; removerPreviewImagem(); };
  }
  function removerPreviewImagem() {
    document.getElementById('fz-img-preview')?.remove();
  }

  /* ----------  Markdown simples → HTML  ---------- */
  function md(txt) {
    return txt
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
      .replace(/\*(.+?)\*/g,'<em>$1</em>')
      .replace(/`(.+?)`/g,'<code>$1</code>')
      .replace(/\n/g,'<br>');
  }

  /* ----------  Cria o HTML do assistente  ---------- */
  function montar() {
    const wrap = document.createElement('div');
    wrap.id = 'fz-ai-wrap';
    wrap.innerHTML = `
      <div id="fz-ai-panel">
        <div id="fz-ai-card2">
          <div id="fz-ai-header">
            <div style="display:flex;align-items:center;gap:10px">
              <div class="fz-loader fz-loader-sm">
                <svg width="100" height="100" viewBox="0 0 100 100">
                  <defs>
                    <mask id="fz-clipping-sm">
                      <polygon points="0,0 100,0 100,100 0,100" fill="black"></polygon>
                      <polygon points="25,25 75,25 50,75" fill="white"></polygon>
                      <polygon points="50,25 75,75 25,75" fill="white"></polygon>
                      <polygon points="35,35 65,35 50,65" fill="white"></polygon>
                      <polygon points="35,35 65,35 50,65" fill="white"></polygon>
                      <polygon points="35,35 65,35 50,65" fill="white"></polygon>
                      <polygon points="35,35 65,35 50,65" fill="white"></polygon>
                    </mask>
                  </defs>
                </svg>
                <div class="fz-box fz-box-sm"></div>
              </div>
              <div>
                <div style="font-weight:700;font-size:14px;color:#fff">Assistente Forzy</div>
                <div style="font-size:11px;color:rgba(255,255,255,.5)">IA técnica · Manutenção preditiva</div>
              </div>
            </div>
            <div style="display:flex;gap:4px;align-items:center">
              <button id="fz-ai-expand" title="Expandir lateral">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
                  <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
                </svg>
              </button>
              <button id="fz-ai-close" title="Fechar">✕</button>
            </div>
          </div>
          <div id="fz-ai-msgs">
            <div class="fz-ai-msg bot">
              <div class="fz-ai-bubble">👋 Olá! Sou o assistente técnico Forzy.<br>Pode me perguntar sobre <strong>vibração</strong>, <strong>temperatura</strong>, <strong>diagnóstico de falhas</strong> ou qualquer métrica do sistema.</div>
            </div>
          </div>
          <div id="fz-ai-footer">
            <div class="fz-chat-options">
              <div class="fz-chat-inner">
                <div class="fz-chat-bot">
                  <textarea id="fz-ai-input" name="chat_bot" placeholder="Pergunte sobre vibração, temperatura, falhas..."></textarea>
                </div>
                <div class="fz-chat-opts-row">
                  <input type="file" id="fz-img-input" accept="image/*" style="display:none">
                  <div class="fz-btns-add">
                    <button type="button" id="fz-img-btn" title="Anexar imagem (gráfico, screenshot)">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 8v8a5 5 0 1 0 10 0V6.5a3.5 3.5 0 1 0-7 0V15a2 2 0 0 0 4 0V8"/></svg>
                    </button>
                    <button type="button" title="Dados">
                      <svg viewBox="0 0 24 24" height="18" width="18" xmlns="http://www.w3.org/2000/svg"><path d="M4 5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zm0 10a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zm10 0a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1zm0-8h6m-3-3v6" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" stroke="currentColor" fill="none"/></svg>
                    </button>
                    <button type="button" title="Web">
                      <svg viewBox="0 0 24 24" height="18" width="18" xmlns="http://www.w3.org/2000/svg"><path d="M12 22C6.477 22 2 17.523 2 12S6.477 2 12 2s10 4.477 10 10s-4.477 10-10 10m-2.29-2.333A17.9 17.9 0 0 1 8.027 13H4.062a8.01 8.01 0 0 0 5.648 6.667M10.03 13c.151 2.439.848 4.73 1.97 6.752A15.9 15.9 0 0 0 13.97 13zm9.908 0h-3.965a17.9 17.9 0 0 1-1.683 6.667A8.01 8.01 0 0 0 19.938 13M4.062 11h3.965A17.9 17.9 0 0 1 9.71 4.333A8.01 8.01 0 0 0 4.062 11m5.969 0h3.938A15.9 15.9 0 0 0 12 4.248A15.9 15.9 0 0 0 10.03 11m4.259-6.667A17.9 17.9 0 0 1 15.973 11h3.965a8.01 8.01 0 0 0-5.648-6.667" fill="currentColor"/></svg>
                    </button>
                  </div>
                  <button id="fz-ai-send" class="fz-btn-submit" title="Enviar">
                    <i>
                      <svg viewBox="0 0 512 512" width="18" height="18"><path fill="currentColor" d="M473 39.05a24 24 0 0 0-25.5-5.46L47.47 185h-.08a24 24 0 0 0 1 45.16l.41.13l137.3 58.63a16 16 0 0 0 15.54-3.59L422 80a7.07 7.07 0 0 1 10 10L226.66 310.26a16 16 0 0 0-3.59 15.54l58.65 137.38c.06.2.12.38.19.57c3.2 9.27 11.3 15.81 21.09 16.25h1a24.63 24.63 0 0 0 23-15.46L478.39 64.62A24 24 0 0 0 473 39.05"/></svg>
                    </i>
                  </button>
                </div>
              </div>
            </div>
            <div class="fz-chat-tags">
              <span data-q="Vibração alta no motor, o que pode ser?">⚡ Vibração alta</span>
              <span data-q="Temperatura subindo, o que fazer?">🌡 Temperatura</span>
              <span data-q="Como interpretar os dados do ESP32?">📡 ESP32</span>
            </div>
          </div>
        </div>
      </div>
      <button id="fz-ai-fab" title="Assistente IA Forzy">
        <div class="fz-loader">
          <svg width="100" height="100" viewBox="0 0 100 100">
            <defs>
              <mask id="fz-clipping">
                <polygon points="0,0 100,0 100,100 0,100" fill="black"></polygon>
                <polygon points="25,25 75,25 50,75" fill="white"></polygon>
                <polygon points="50,25 75,75 25,75" fill="white"></polygon>
                <polygon points="35,35 65,35 50,65" fill="white"></polygon>
                <polygon points="35,35 65,35 50,65" fill="white"></polygon>
                <polygon points="35,35 65,35 50,65" fill="white"></polygon>
                <polygon points="35,35 65,35 50,65" fill="white"></polygon>
              </mask>
            </defs>
          </svg>
          <div class="fz-box"></div>
        </div>
        <span id="fz-ai-dot"></span>
      </button>`;
    document.body.appendChild(wrap);

    document.getElementById('fz-ai-fab').addEventListener('click', togglePanel);
    document.getElementById('fz-ai-close').addEventListener('click', () => fecharPanel());
    document.getElementById('fz-ai-expand').addEventListener('click', toggleExpand);
    document.getElementById('fz-ai-send').addEventListener('click', enviar);

    // Clipe → abre seletor de arquivo
    document.getElementById('fz-img-btn').addEventListener('click', () =>
      document.getElementById('fz-img-input').click()
    );
    document.getElementById('fz-img-input').addEventListener('change', e => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const dataUrl = ev.target.result;          // data:image/png;base64,...
        const [meta, base64] = dataUrl.split(',');
        const mime = meta.match(/:(.*?);/)[1];
        imagemPendente = { base64, mime, nome: file.name };
        mostrarPreviewImagem(file.name);
        document.getElementById('fz-ai-input').focus();
      };
      reader.readAsDataURL(file);
      e.target.value = '';   // reset para permitir selecionar o mesmo arquivo
    });
    document.getElementById('fz-ai-input').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } });
    document.querySelectorAll('.fz-chat-tags span').forEach(tag => {
      tag.addEventListener('click', () => {
        const inp = document.getElementById('fz-ai-input');
        inp.value = tag.dataset.q || tag.textContent;
        inp.focus(); enviar();
      });
    });
  }

  /* ----------  Abre / fecha / expande  ---------- */
  let expandido = false;

  function togglePanel() { aberto ? fecharPanel() : abrirPanel(); }

  function abrirPanel() {
    aberto = true;
    document.getElementById('fz-ai-panel').classList.add('visible');
    document.getElementById('fz-ai-fab').classList.add('open');
    document.getElementById('fz-ai-dot').style.display = 'none';
    setTimeout(() => document.getElementById('fz-ai-input').focus(), 200);
  }

  function fecharPanel() {
    aberto = false;
    expandido = false;
    const panel = document.getElementById('fz-ai-panel');
    panel.classList.remove('visible', 'side');
    document.getElementById('fz-ai-wrap').classList.remove('side-active');
    document.body.classList.remove('fz-side-open');
    document.getElementById('fz-ai-fab').classList.remove('open');
    atualizarIconeExpand();
  }

  function toggleExpand() {
    expandido = !expandido;
    const panel = document.getElementById('fz-ai-panel');
    const wrap  = document.getElementById('fz-ai-wrap');
    panel.classList.toggle('side', expandido);
    wrap.classList.toggle('side-active', expandido);
    document.body.classList.toggle('fz-side-open', expandido);
    atualizarIconeExpand();
    setTimeout(() => document.getElementById('fz-ai-msgs').scrollTop = 99999, 350);
  }

  function atualizarIconeExpand() {
    const btn = document.getElementById('fz-ai-expand');
    if (!btn) return;
    // expandido → ícone de colapsar; normal → ícone de expandir
    btn.innerHTML = expandido
      ? `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
           <polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/>
           <line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/>
         </svg>`
      : `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
           <polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/>
           <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
         </svg>`;
  }

  /* ----------  Adiciona mensagem na tela  ---------- */
  function addMsg(role, html) {
    const msgs = document.getElementById('fz-ai-msgs');
    const div = document.createElement('div');
    div.className = `fz-ai-msg ${role}`;
    div.innerHTML = `<div class="fz-ai-bubble">${html}</div>`;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  }

  /* ----------  Enviar mensagem  ---------- */
  async function enviar() {
    if (carregando) return;
    const inp = document.getElementById('fz-ai-input');
    const txt = inp.value.trim();
    if (!txt) return;
    inp.value = '';
    addMsg('user', md(txt));

    carregando = true;
    document.getElementById('fz-ai-send').disabled = true;
    const typing = addMsg('bot', '<span class="fz-ai-typing"><span></span><span></span><span></span></span>');

    try {
      const resp = await perguntarGemini(txt);
      typing.querySelector('.fz-ai-bubble').innerHTML = md(resp);
    } catch (e) {
      typing.querySelector('.fz-ai-bubble').innerHTML = `⚠ Erro ao contactar a IA: <em>${e.message}</em><br><small>Verifique sua chave OpenAI em config.js</small>`;
    } finally {
      carregando = false;
      document.getElementById('fz-ai-send').disabled = false;
      document.getElementById('fz-ai-msgs').scrollTop = 99999;
    }

    // notifica bolinha se painel estiver fechado
    if (!aberto) document.getElementById('fz-ai-dot').style.display = 'block';
  }

  /* ----------  API pública — alertas automáticos de IoT  ---------- */
  let _ultimoAlertaFlag = -1; // evita repetir o mesmo nível

  async function alertarIoT({ vel, temp, flag, arms }) {
    // só abre 1x por transição de nível (evita spam)
    if (flag <= 0 || flag === _ultimoAlertaFlag) return;
    _ultimoAlertaFlag = flag;

    const nivel = flag === 2 ? '🔴 ALARME — P1 Crítico' : '🟡 ALERTA — P2 Alto';
    const limiteVel = flag === 2 ? '4,5 mm/s' : '1,8 mm/s';

    // monta mensagem técnica automática
    const msg = `${nivel} detectado pelo sensor ESP32 / VIM32PL!

**Leituras atuais:**
- Velocidade RMS: **${vel.toFixed(3)} mm/s** (limite ISO 10816: ${limiteVel})
- Aceleração RMS: ${arms ? arms.toFixed(4) + ' g' : '—'}
- Temperatura: ${temp ? temp.toFixed(1) + ' °C' : '—'}

Por favor, analise esse desvio operacional seguindo a norma ISO 10816 e ISA-18.2. Responda com:
1. **Causa provável** do desvio
2. **Risco** se não tratado
3. **Ação corretiva recomendada**`;

    const dedicada = telaDedicada();
    if (dedicada) { dedicada.enviarAlerta(msg); return; }

    // abre o painel e envia automaticamente
    if (!aberto) abrirPanel();
    await new Promise(r => setTimeout(r, 400));

    // reseta estado de loading se travado
    carregando = false;
    document.getElementById('fz-ai-send').disabled = false;

    addMsg('user', md(msg));
    carregando = true;
    document.getElementById('fz-ai-send').disabled = true;
    const cor = flag === 2 ? '#e74c3c' : '#f39c12';
    const typing = addMsg('bot', `<span style="color:${cor};font-weight:700">${nivel}</span><br><span class="fz-ai-typing"><span></span><span></span><span></span></span>`);

    try {
      // perguntarGemini já gerencia historico internamente — não push manual
      const resp = await perguntarGemini(msg);
      typing.querySelector('.fz-ai-bubble').innerHTML = `<span style="color:${cor};font-weight:700">${nivel}</span><br>${md(resp)}`;
    } catch (e) {
      typing.querySelector('.fz-ai-bubble').innerHTML = `⚠ Erro ao contactar a IA: <em>${e.message}</em>`;
    } finally {
      carregando = false;
      document.getElementById('fz-ai-send').disabled = false;
      document.getElementById('fz-ai-msgs').scrollTop = 99999;
    }
  }

  // reseta quando volta ao normal
  function resetarAlertaIoT() { _ultimoAlertaFlag = -1; }

  // cooldown de notificações do sininho (evita spam se vários alarmes chegarem juntos)
  let _cooldownNotif = false;
  async function alertarNotificacao({ prioridade, titulo, msg, nivel, valor, unidade }) {
    if (_cooldownNotif) return;
    _cooldownNotif = true;
    setTimeout(() => { _cooldownNotif = false; }, 30000); // cooldown 30s

    const emoji = nivel === 'bad' ? '🔴' : '🟡';
    const valorFmt = valor != null ? `**${Number(valor).toFixed(unidade === '°C' ? 1 : 2)} ${unidade}**` : '';

    const msgIA = `${emoji} **${prioridade} — ${titulo}** detectado pelo sistema de monitoramento!

${msg}${valorFmt ? `\nValor medido: ${valorFmt}` : ''}

Seguindo as normas ISO 10816 e ISA-18.2, responda com:
1. **Causa provável** deste desvio operacional
2. **Risco** se não houver intervenção
3. **Ação corretiva recomendada** (imediata e preventiva)`;

    const dedicada = telaDedicada();
    if (dedicada) { dedicada.enviarAlerta(msgIA); return; }

    if (!aberto) abrirPanel();
    await new Promise(r => setTimeout(r, 400));

    carregando = false;
    document.getElementById('fz-ai-send').disabled = false;

    addMsg('user', md(msgIA));
    carregando = true;
    document.getElementById('fz-ai-send').disabled = true;
    const cor = nivel === 'bad' ? '#e74c3c' : '#f39c12';
    const typing = addMsg('bot', `<span style="color:${cor};font-weight:700">${emoji} ${prioridade} — Analisando...</span><br><span class="fz-ai-typing"><span></span><span></span><span></span></span>`);

    try {
      const resp = await perguntarGemini(msgIA);
      typing.querySelector('.fz-ai-bubble').innerHTML = `<span style="color:${cor};font-weight:700">${emoji} ${prioridade} — ${titulo}</span><br>${md(resp)}`;
    } catch (e) {
      typing.querySelector('.fz-ai-bubble').innerHTML = `⚠ Erro ao contactar a IA: <em>${e.message}</em>`;
    } finally {
      carregando = false;
      document.getElementById('fz-ai-send').disabled = false;
      document.getElementById('fz-ai-msgs').scrollTop = 99999;
    }
  }

  window.FZAssistant = { alertarIoT, resetarAlertaIoT, alertarNotificacao, togglePanel };

  /* ----------  Inicia  ---------- */
  function init() {
    // vision.html usa a tela dedicada (assistente-screen.js) — não duplica a bolinha
    if (document.getElementById('fz-chat-screen')) return;

    injectCSS();
    montar();
    // notifica se ESP32 conectar enquanto painel fechado
    setInterval(() => {
      if (!aberto && window.FZIoT && window.FZIoT.isConnected()) {
        document.getElementById('fz-ai-dot').style.display = 'block';
      }
    }, 5000);
  }

  /* ----------  CSS embutido  ---------- */
  function injectCSS() {
    const s = document.createElement('style');
    s.textContent = `
      /* Botão flutuante */
      #fz-ai-fab {
        position:fixed; bottom:28px; right:28px; z-index:9999;
        width:100px; height:100px; border-radius:50%;
        background:none; border:none; cursor:pointer; padding:0;
        display:flex; align-items:center; justify-content:center;
        transition:transform .25s;
      }
      #fz-ai-fab:hover { transform:scale(1.08); }
      #fz-ai-fab.open  { opacity:0; pointer-events:none; transform:scale(.7); }

      /* Loader original (uiverse.io by andrew-manzyk) */
      .fz-loader {
        --color-one: #ffffff;
        --color-two: #cccccc;
        --color-three: #ffffff80;
        --color-four: #cccccc80;
        --color-five: #ffffff40;
        --time-animation: 2s;
        position: relative;
        border-radius: 50%;
        box-shadow: 0 0 25px 0 var(--color-three), 0 20px 50px 0 var(--color-four);
      }
      .fz-loader::before {
        content: "";
        position: absolute;
        top: 0; left: 0;
        width: 100px; height: 100px;
        border-radius: 50%;
        border-top: solid 1px var(--color-one);
        border-bottom: solid 1px var(--color-two);
        background: linear-gradient(180deg, var(--color-five), var(--color-four));
        box-shadow: inset 0 10px 10px 0 var(--color-three), inset 0 -10px 10px 0 var(--color-four);
      }
      .fz-box {
        width: 100px; height: 100px;
        background: linear-gradient(180deg, var(--color-one) 30%, var(--color-two) 70%);
        mask: url(#fz-clipping);
        -webkit-mask: url(#fz-clipping);
      }
      .fz-loader svg { position: absolute; }
      .fz-loader svg #fz-clipping { filter: contrast(15); animation: fz-roundness calc(var(--time-animation) / 2) linear infinite; }
      .fz-loader svg #fz-clipping polygon { filter: blur(7px); }
      .fz-loader svg #fz-clipping polygon:nth-child(1) { transform-origin: 75% 25%; transform: rotate(90deg); }
      .fz-loader svg #fz-clipping polygon:nth-child(2) { transform-origin: 50% 50%; animation: fz-rotation var(--time-animation) linear infinite reverse; }
      .fz-loader svg #fz-clipping polygon:nth-child(3) { transform-origin: 50% 60%; animation: fz-rotation var(--time-animation) linear infinite; animation-delay: calc(var(--time-animation) / -3); }
      .fz-loader svg #fz-clipping polygon:nth-child(4) { transform-origin: 40% 40%; animation: fz-rotation var(--time-animation) linear infinite reverse; }
      .fz-loader svg #fz-clipping polygon:nth-child(5) { transform-origin: 40% 40%; animation: fz-rotation var(--time-animation) linear infinite reverse; animation-delay: calc(var(--time-animation) / -2); }
      .fz-loader svg #fz-clipping polygon:nth-child(6) { transform-origin: 60% 40%; animation: fz-rotation var(--time-animation) linear infinite; }
      .fz-loader svg #fz-clipping polygon:nth-child(7) { transform-origin: 60% 40%; animation: fz-rotation var(--time-animation) linear infinite; animation-delay: calc(var(--time-animation) / -1.5); }
      @keyframes fz-rotation { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }
      @keyframes fz-roundness { 0%{filter:contrast(15)} 20%{filter:contrast(3)} 40%{filter:contrast(3)} 60%{filter:contrast(15)} 100%{filter:contrast(15)} }
      @keyframes fz-colorize { 0%{filter:hue-rotate(0deg)} 20%{filter:hue-rotate(-30deg)} 40%{filter:hue-rotate(-60deg)} 60%{filter:hue-rotate(-90deg)} 80%{filter:hue-rotate(-45deg)} 100%{filter:hue-rotate(0deg)} }

      /* Loader pequeno no header */
      .fz-loader-sm { width:36px; height:36px; transform:scale(0.36); transform-origin:left top; flex:none; }
      .fz-loader-sm::before { width:100px; height:100px; }
      .fz-box-sm { mask:url(#fz-clipping-sm) !important; -webkit-mask:url(#fz-clipping-sm) !important; }
      .fz-loader-sm svg #fz-clipping-sm {
        filter:contrast(15);
        animation:fz-roundness calc(var(--time-animation)/2) linear infinite;
      }
      .fz-loader-sm svg #fz-clipping-sm polygon { filter:blur(7px); }
      .fz-loader-sm svg #fz-clipping-sm polygon:nth-child(1){ transform-origin:75% 25%; transform:rotate(90deg); }
      .fz-loader-sm svg #fz-clipping-sm polygon:nth-child(2){ transform-origin:50% 50%; animation:fz-rotation var(--time-animation) linear infinite reverse; }
      .fz-loader-sm svg #fz-clipping-sm polygon:nth-child(3){ transform-origin:50% 60%; animation:fz-rotation var(--time-animation) linear infinite; animation-delay:calc(var(--time-animation)/-3); }
      .fz-loader-sm svg #fz-clipping-sm polygon:nth-child(4){ transform-origin:40% 40%; animation:fz-rotation var(--time-animation) linear infinite reverse; }
      .fz-loader-sm svg #fz-clipping-sm polygon:nth-child(5){ transform-origin:40% 40%; animation:fz-rotation var(--time-animation) linear infinite reverse; animation-delay:calc(var(--time-animation)/-2); }
      .fz-loader-sm svg #fz-clipping-sm polygon:nth-child(6){ transform-origin:60% 40%; animation:fz-rotation var(--time-animation) linear infinite; }
      .fz-loader-sm svg #fz-clipping-sm polygon:nth-child(7){ transform-origin:60% 40%; animation:fz-rotation var(--time-animation) linear infinite; animation-delay:calc(var(--time-animation)/-1.5); }

      /* Ponto de notificação */
      #fz-ai-dot {
        display:none; position:absolute; top:6px; right:6px;
        width:11px; height:11px; border-radius:50%;
        background:#e74c3c; border:2px solid #141417;
        animation: fzAiPulse 1.5s infinite;
      }
      @keyframes fzAiPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.3)} }

      /* Painel — .card do uiverse (wrapper gradiente branco neon) */
      #fz-ai-panel {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 9998;
        width: 360px;
        height: 500px;
        background: #1a1a1a;
        border: 1px solid rgba(255,255,255,.1);
        border-radius: 20px;
        box-shadow: 0 8px 40px rgba(0,0,0,.6);
        transition: all .3s cubic-bezier(.4,0,.2,1);
        padding: 0;
        opacity: 0;
        transform: translateY(20px) scale(.96);
        pointer-events: none;
      }
      #fz-ai-panel.visible {
        opacity: 1;
        transform: translateY(0) scale(1);
        pointer-events: all;
      }
      /* .card2 do uiverse — fundo escuro interno */
      #fz-ai-card2 {
        width: 100%;
        height: 100%;
        background: transparent;
        border-radius: 20px;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      /* Header */
      #fz-ai-header {
        display:flex; align-items:center; justify-content:space-between;
        padding:14px 16px;
        background:linear-gradient(135deg,rgba(255,255,255,.06),rgba(200,200,200,.04));
        border-bottom:1px solid rgba(255,255,255,.07);
      }
      #fz-ai-avatar {
        width:40px; height:40px; border-radius:50%;
        display:flex; align-items:center; justify-content:center;
        overflow:visible; flex:none;
      }
      #fz-ai-close {
        background:none; border:none; color:var(--text-2,#aaa);
        font-size:16px; cursor:pointer; padding:4px 8px; border-radius:6px;
        transition:background .15s;
      }
      #fz-ai-close:hover { background:rgba(255,255,255,.08); }
      #fz-ai-expand {
        background:none; border:none; color:var(--text-2,#aaa);
        cursor:pointer; padding:4px 6px; border-radius:6px;
        display:flex; align-items:center; transition:background .15s, color .15s;
      }
      #fz-ai-expand:hover { background:rgba(255,255,255,.08); color:#fff; }

      /* Mensagens */
      #fz-ai-msgs {
        flex:1; overflow-y:auto; padding:14px 14px 8px;
        display:flex; flex-direction:column; gap:10px;
        scroll-behavior:smooth;
      }
      #fz-ai-msgs::-webkit-scrollbar { width:4px; }
      #fz-ai-msgs::-webkit-scrollbar-thumb { background:rgba(255,255,255,.1); border-radius:4px; }

      .fz-ai-msg { display:flex; }
      .fz-ai-msg.user { justify-content:flex-end; }
      .fz-ai-msg.bot  { justify-content:flex-start; }
      .fz-ai-bubble {
        max-width:82%; padding:10px 14px; border-radius:14px;
        font-size:13px; line-height:1.55; color:var(--text,#fff);
      }
      .fz-ai-msg.user .fz-ai-bubble {
        background:#3a3a42;
        color:#f0f0f0; border-bottom-right-radius:4px;
        border:1px solid rgba(255,255,255,.1);
      }
      .fz-ai-msg.bot .fz-ai-bubble {
        background:#26262c;
        color:#e8e8e8;
        border-bottom-left-radius:4px;
        border:1px solid rgba(255,255,255,.06);
      }
      .fz-ai-bubble code {
        background:rgba(255,255,255,.1); padding:1px 5px;
        border-radius:4px; font-family:monospace; font-size:12px;
      }

      /* Typing dots */
      .fz-ai-typing { display:inline-flex; gap:4px; align-items:center; padding:2px 0; }
      .fz-ai-typing span {
        width:7px; height:7px; border-radius:50%; background:var(--text-2,#aaa);
        animation:fzAiDot 1.2s infinite;
      }
      .fz-ai-typing span:nth-child(2){ animation-delay:.2s; }
      .fz-ai-typing span:nth-child(3){ animation-delay:.4s; }
      @keyframes fzAiDot { 0%,80%,100%{transform:scale(.6);opacity:.4} 40%{transform:scale(1);opacity:1} }

      /* Input — uiverse.io by Cobp */
      #fz-ai-footer { display:flex; flex-direction:column; padding:10px 12px 12px; border-top:1px solid rgba(255,255,255,.07); }
      .fz-chat-options { position:relative; display:flex; background:linear-gradient(to bottom right,#7e7e7e,#363636,#363636,#363636,#363636); border-radius:16px; padding:1.5px; overflow:hidden; }
      .fz-chat-options::after { position:absolute; content:""; top:-10px; left:-10px; background:radial-gradient(ellipse at center,#ffffff,rgba(255,255,255,.3),rgba(255,255,255,.1),transparent,transparent,transparent,transparent); width:30px; height:30px; filter:blur(1px); }
      .fz-chat-inner { display:flex; flex-direction:column; background-color:rgba(0,0,0,.5); border-radius:15px; width:100%; overflow:hidden; }
      .fz-chat-bot { position:relative; display:flex; }
      #fz-ai-input { background-color:transparent; border-radius:16px; border:none; width:100%; height:70px; color:#fff; font-family:sans-serif; font-size:12px; font-weight:400; padding:10px; resize:none; outline:none; }
      #fz-ai-input::-webkit-scrollbar { width:6px; }
      #fz-ai-input::-webkit-scrollbar-track { background:transparent; }
      #fz-ai-input::-webkit-scrollbar-thumb { background:#888; border-radius:5px; }
      #fz-ai-input::placeholder { color:#f3f6fd; transition:all .3s ease; }
      #fz-ai-input:focus::placeholder { color:#363636; }
      .fz-chat-opts-row { display:flex; justify-content:space-between; align-items:flex-end; padding:8px 10px; }
      .fz-btns-add { display:flex; gap:8px; }
      .fz-btns-add button { display:flex; color:rgba(255,255,255,.2); background-color:transparent; border:none; cursor:pointer; transition:all .3s ease; padding:2px; }
      .fz-btns-add button:hover { transform:translateY(-3px); color:#fff; }
      .fz-btn-submit { display:flex; padding:2px; background-image:linear-gradient(to top,#292929,#555555,#292929); border-radius:10px; box-shadow:inset 0 6px 2px -4px rgba(255,255,255,.5); cursor:pointer; border:none; outline:none; transition:all .15s ease; }
      .fz-btn-submit i { width:30px; height:30px; padding:6px; background:rgba(0,0,0,.1); border-radius:10px; backdrop-filter:blur(3px); color:#8b8b8b; display:flex; align-items:center; justify-content:center; }
      .fz-btn-submit:hover svg { color:#f3f6fd; filter:drop-shadow(0 0 5px #fff); }
      .fz-btn-submit:active { transform:scale(.92); }
      .fz-btn-submit:disabled { opacity:.4; cursor:not-allowed; }
      /* Tags */
      .fz-chat-tags { padding:10px 0 0; display:flex; flex-wrap:wrap; color:#fff; font-size:10px; gap:4px; }
      .fz-chat-tags span { padding:4px 8px; background-color:#1b1b1b; border:1.5px solid #363636; border-radius:10px; cursor:pointer; user-select:none; transition:border .2s; }
      .fz-chat-tags span:hover { border-color:#888; }

      /* Preview de imagem anexada */
      #fz-img-preview {
        display:flex; align-items:center; justify-content:space-between;
        background:#26262c; border:1px solid rgba(255,255,255,.1);
        border-radius:8px; padding:6px 10px; margin-bottom:6px;
        font-size:12px; color:#ccc;
      }
      #fz-img-preview button {
        background:none; border:none; color:#888; cursor:pointer;
        font-size:13px; padding:0 2px; line-height:1;
      }
      #fz-img-preview button:hover { color:#fff; }
      #fz-img-btn.has-img svg { color:#8aa9c9; }

      /* === MODO LATERAL (VS Code) === */
      #fz-ai-panel.side {
        top: 0 !important;
        bottom: 0 !important;
        right: 0 !important;
        width: 380px !important;
        height: 100vh !important;
        border-radius: 0 !important;
        border-left: 1px solid rgba(255,255,255,.12);
        box-shadow: -8px 0 40px rgba(0,0,0,.6) !important;
        transform: translateX(0) scale(1) !important;
      }
      #fz-ai-panel.side #fz-ai-card2 {
        border-radius: 0 !important;
      }
      /* empurra o conteúdo da página quando lateral ativo */
      body.fz-side-open { margin-right: 380px; transition: margin .35s cubic-bezier(.4,0,.2,1); }

      @media(max-width:420px){
        #fz-ai-panel{ width:calc(100vw - 24px); right:12px; bottom:88px; }
        #fz-ai-fab{ right:16px; bottom:16px; }
        #fz-ai-panel.side{ width:100vw !important; }
      }
    `;
    document.head.appendChild(s);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
