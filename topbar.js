/* ===================================================================
   FORZY · Topbar — Relógio, Busca, Alertas, Conta
   =================================================================== */
(function () {

  /* ------------------------------------------------------------------ */
  /* 1. RELÓGIO AO VIVO                                                  */
  /* ------------------------------------------------------------------ */
  function iniciarRelogio() {
    const el = document.getElementById('topbar-clock');
    if (!el) return;
    function atualizar() {
      const now = new Date();
      const dia  = now.toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric' });
      const hora = now.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
      el.textContent = `${dia}  ${hora}`;
    }
    atualizar();
    setInterval(atualizar, 1000);
  }

  /* ------------------------------------------------------------------ */
  /* 2. BUSCA                                                            */
  /* ------------------------------------------------------------------ */
  const TELAS = [
    { label: 'Início',           id: 'screen-inicio',    icon: '·', keywords: ['inicio','home','kpi','ao vivo'] },
    { label: 'Dashboard',        id: 'screen-dashboard', icon: '·', keywords: ['dashboard','motor','monitoramento','vibração','espectral','operacional','historico','baseline','ml'] },
    { label: 'Cadastro',         id: 'screen-cadastro',  icon: '·', keywords: ['cadastro','ativo','planta','area','ficha'] },
    { label: 'Gestão',           id: 'screen-gestao',    icon: '·', keywords: ['gestao','pipeline','rpa','ocr','navegacao'] },
    { label: 'SCADA',            id: 'screen-scada',     icon: '·', keywords: ['scada','planta','2d','3d','canvas'] },
    { label: 'IoT ESP32',        id: 'screen-iot',       icon: '·', keywords: ['iot','esp32','serial','sensor','vibração'] },
  ];

  function buscarOpcoes(q) {
    q = q.toLowerCase().trim();
    if (!q) return [];
    const resultados = [];

    // telas
    TELAS.forEach(t => {
      if (t.label.toLowerCase().includes(q) || t.keywords.some(k => k.includes(q))) {
        resultados.push({ tipo: 'tela', label: t.label, id: t.id, icon: t.icon });
      }
    });

    // ativos do store
    try {
      if (window.FZStore) {
        const ativos = window.FZStore.getAtivosIndustrial ? window.FZStore.getAtivosIndustrial() : [];
        ativos.forEach(a => {
          const haystack = [a.codigo, a.tag, a.descricao, a.fabricante, a.localizacao_descricao].join(' ').toLowerCase();
          if (haystack.includes(q)) {
            resultados.push({ tipo: 'ativo', label: `${a.codigo} — ${a.descricao || a.tag || ''}`, id: 'screen-cadastro', icon: '·', ativo: a.codigo });
          }
        });
      }
    } catch(_) {}

    return resultados.slice(0, 8);
  }

  function iniciarBusca() {
    const inp = document.getElementById('topbar-search');
    const res = document.getElementById('topbar-search-results');
    if (!inp || !res) return;

    inp.addEventListener('input', () => renderResultados(inp.value));
    inp.addEventListener('keydown', e => {
      if (e.key === 'Escape') { res.style.display = 'none'; inp.value = ''; }
      if (e.key === 'Enter') {
        const primeiro = res.querySelector('.tsri');
        if (primeiro) primeiro.click();
      }
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('.search')) res.style.display = 'none';
    });
  }

  function renderResultados(q) {
    const res = document.getElementById('topbar-search-results');
    const opts = buscarOpcoes(q);
    if (!opts.length) { res.style.display = 'none'; return; }

    res.innerHTML = opts.map((o, i) => `
      <div class="tsri" data-idx="${i}" data-id="${o.id}" data-ativo="${o.ativo||''}">
        <span class="tsri-icon">${o.icon}</span>
        <span class="tsri-label">${o.label}</span>
        <span class="tsri-tipo">${o.tipo}</span>
      </div>`).join('');
    res.style.display = 'block';

    res.querySelectorAll('.tsri').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        if (window.showScreen) window.showScreen(id);
        document.getElementById('topbar-search').value = '';
        res.style.display = 'none';
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* 3. SININHO — ALERTAS DE MOTOR (ISA-18.2 com histerese e log)       */
  /* ------------------------------------------------------------------ */

  /*
   * ISA-18.2:2016 — Management of Alarm Systems for the Process Industries
   * Prioridades: P1 Crítico (requer intervenção imediata) / P2 Alto (verificar)
   * Histerese (deadband): alarme só limpa quando valor cai abaixo de 90% do threshold
   * Isso evita flickering (proibido pela norma ISA-18.2).
   */

  const alertas   = [];   // alertas ativos (para exibição no sininho)
  const logAlarmes = [];  // log persistente de eventos (ATIVADO / NORMALIZADO)

  // Map de estado de histerese: chave → { nivel, valor, threshold, ativo }
  const estadoAlarme = new Map();

  // Definições de limites ISA-18.2
  const LIMITES_ISA = [
    { variavel: 'vel',     threshold: 4.5, deadband: 4.5 * 0.90, prioridade: 'P1 - Crítico', nivel: 'bad',  unidade: 'mm/s', titulo: 'Vibração Crítica' },
    { variavel: 'vel',     threshold: 1.8, deadband: 1.8 * 0.90, prioridade: 'P2 - Alto',    nivel: 'warn', unidade: 'mm/s', titulo: 'Vibração Alta'    },
    { variavel: 'temp',    threshold: 42,  deadband: 42  * 0.90, prioridade: 'P1 - Crítico', nivel: 'bad',  unidade: '°C',   titulo: 'Temperatura Crítica' },
    { variavel: 'temp',    threshold: 35,  deadband: 35  * 0.90, prioridade: 'P2 - Alto',    nivel: 'warn', unidade: '°C',   titulo: 'Temperatura Alta'    },
  ];

  function registrarLogEvento(prioridade, ativo, variavel, valor, unidade, status) {
    logAlarmes.unshift({
      timestamp: new Date().toISOString(),
      prioridade, ativo, variavel, valor, unidade, status
    });
    if (logAlarmes.length > 200) logAlarmes.pop();
    notificarAlertas();
  }

  // atualiza o estado de histerese; devolve true só no instante em que ACABA de cruzar
  // pra cima (edge de ativação) — usado pra decidir se dispara notificação agora.
  function cruzouAgora(chave, ativo, variavel, valor, limite) {
    const estado = estadoAlarme.get(chave) || { ativo: false };
    if (!estado.ativo) {
      // ISA-18.2: dispara alarme somente quando cruza threshold para CIMA
      if (valor >= limite.threshold) {
        estadoAlarme.set(chave, { ativo: true });
        registrarLogEvento(limite.prioridade, ativo, variavel, valor, limite.unidade, 'ATIVADO');
        return true;
      }
    } else {
      // ISA-18.2: limpa somente quando cai abaixo do deadband (90% do threshold)
      if (valor < limite.deadband) {
        estadoAlarme.set(chave, { ativo: false });
        registrarLogEvento(limite.prioridade, ativo, variavel, valor, limite.unidade, 'NORMALIZADO');
        const idx = alertas.findIndex(a => a.chave === chave);
        if (idx !== -1) { alertas.splice(idx, 1); renderSininho(); }
        // tira a faixa amarela (P2) da tela ao normalizar. O modal vermelho (P1)
        // continua até o operador Reconhecer — de propósito (ISA-18.2).
        if (window.FZAlertaCritico) window.FZAlertaCritico.limpar();
      }
    }
    return false;
  }

  function processarLimite(chave, ativo, variavel, valor, limite, origem) {
    if (cruzouAgora(chave, ativo, variavel, valor, limite)) {
      adicionarAlerta(limite.prioridade, limite.titulo, `${ativo}: ${variavel === 'vel' ? 'Vibração' : 'Temperatura'} ${valor.toFixed(variavel === 'vel' ? 2 : 1)} ${limite.unidade}`, limite.nivel, valor, limite.unidade, origem, null, variavel);
    }
  }

  // variante pra fontes com múltiplos eixos do MESMO equipamento (Dataset Forzy/Simulado/
  // Forzy Cloud) — se mais de um eixo cruzar o limite junto, manda um único alerta
  // combinado em vez de um por eixo.
  function processarLimiteMultiEixo(rotulo, origem, eixos, campo, limite, sufixo) {
    const cruzaram = [];
    eixos.forEach(e => {
      const chave = `${e.pfx}_${campo}_${sufixo}`;
      if (cruzouAgora(chave, `${rotulo} · ${e.nome}`, campo, e.valor, limite)) cruzaram.push(e);
    });
    if (!cruzaram.length) return;
    const partes = cruzaram.map(e => `${e.nome}: ${campo === 'vel' ? 'Vibração' : 'Temperatura'} ${e.valor.toFixed(campo === 'vel' ? 2 : 1)} ${limite.unidade}`).join(' · ');
    // Um eixo só → vai direto pra conversa daquele eixo (a mesma que o modal do card
    // mostra). Os dois juntos → um único alerta na conversa da fonte, que o modal
    // aberto espelha via FZChatScreen.onAlerta.
    const destino = cruzaram.length === 1 ? `${origem}:${cruzaram[0].id}` : origem;
    const eixoAlvo = cruzaram.length === 1 ? cruzaram[0].id : null;
    adicionarAlerta(limite.prioridade, limite.titulo, `${rotulo} — ${partes}`, limite.nivel, cruzaram[0].valor, limite.unidade, destino, eixoAlvo, campo);
  }

  /*
   * Alarme vindo da REDE NEURAL (modelo.js). É um caminho separado dos limites
   * acima de propósito: os limites olham cada variável isolada, a rede olha a
   * COMBINAÇÃO das seis. Ela pega o que nenhum limite pega — por exemplo o eixo 1
   * a 7 mm/s com o eixo 2 parado, onde cada valor sozinho passa em qualquer regra.
   *
   * Só entra em fontes com os dois eixos (Dataset Forzy / Simulado / Forzy Cloud).
   * ESP32 e ativo cadastrado mandam um eixo só, com NaN no outro — nesse caso
   * FZModelo.avaliar() devolve ok:false e nada dispara, que é o correto: a rede
   * foi treinada no conjunto de dois eixos e não tem como julgar meia leitura.
   *
   * Limiar: usa nivelAlarmeRede (p99,9 e máximo do histórico), não o limiar de
   * análise da aba ML. Assim o replay do dataset não vira uma metralhadora de alarmes.
   */
  const LIMITE_REDE = {
    2: { threshold: 1, deadband: 0.9, prioridade: 'P1 - Crítico', nivel: 'bad',  titulo: 'Anomalia Crítica (rede neural)' },
    1: { threshold: 1, deadband: 0.9, prioridade: 'P2 - Alto',    nivel: 'warn', titulo: 'Anomalia Detectada (rede neural)' },
  };

  function processarRede(rotulo, origem, leitura) {
    const M = window.FZModelo;
    if (!M || !M.pronto() || !leitura) return;

    const r = M.avaliar(leitura);
    // ok:false = leitura incompleta (fonte de um eixo só). Não alarma nem normaliza.
    if (!r || !r.ok) return;

    const n = r.nivelAlarmeRede;
    const f = r.fora[0];
    // eixos que sempre andaram juntos e divergiram: é a história que o operador entende
    // na hora — vale mais que "aceleração 0,4 g, a rede esperava 0,1"
    const as = r.assimetria;
    const eixo = as ? as.eixoMaior : (f ? f.eixo : null);

    // Uma chave por prioridade, pra P1 e P2 terem histerese independente — mesmo
    // padrão dos limites ISA. O "valor" que entra na histerese é o próprio índice.
    [2, 1].forEach(prio => {
      const lim = LIMITE_REDE[prio];
      const chave = 'rede_' + origem + '_p' + (prio === 2 ? '1' : '2');
      const valor = n >= prio ? 1 : 0;   // 1 = acima do limiar daquela prioridade
      if (cruzouAgora(chave, `${rotulo} · rede neural`, 'anomalia',
                      valor, { ...lim, unidade: 'índice' })) {
        const detalhe = as
          ? `Eixo ${as.eixoMaior === 'm1' ? 1 : 2} a ${as.maior.toFixed(2)} mm/s com Eixo ${as.eixoMenor === 'm1' ? 1 : 2} a ${as.menor.toFixed(2)} mm/s — no histórico os dois eixos sempre vibraram juntos`
          : f
            ? `${f.rotulo}: ${f.medido.toFixed(f.dec)} ${f.unidade} (a rede esperava ${f.esperado.toFixed(f.dec)} ${f.unidade})`
            : 'combinação de leituras fora do padrão aprendido';
        adicionarAlerta(lim.prioridade, lim.titulo,
          `${rotulo} — índice de anomalia ${r.indice.toFixed(2)}. ${detalhe}`,
          lim.nivel, r.indice, 'índice', origem, eixo, as ? 'vel' : (f ? f.variavel : null));
      }
    });
  }

  function checarAlertas() {
    try {
      // ESP32 ao vivo
      if (window.FZIoT && window.FZIoT.isConnected()) {
        const last = window.FZIoT.getLast();
        if (last) {
          _leituraEmCheque = { m1_vel: last.vel, m1_acel: last.arms, m1_temp: last.temp };
          // P1 Crítico tem precedência: verificar P1 antes de P2 para a mesma variável
          processarLimite('esp32_vel_p1',  'ESP32', 'vel',  last.vel  || 0, LIMITES_ISA[0], 'esp32');
          processarLimite('esp32_vel_p2',  'ESP32', 'vel',  last.vel  || 0, LIMITES_ISA[1], 'esp32');
          processarLimite('esp32_temp_p1', 'ESP32', 'temp', last.temp || 0, LIMITES_ISA[2], 'esp32');
          processarLimite('esp32_temp_p2', 'ESP32', 'temp', last.temp || 0, LIMITES_ISA[3], 'esp32');
        }
      }

      // ativos do store
      if (window.FZStore) {
        const ativos = window.FZStore.getAtivosIndustrial ? window.FZStore.getAtivosIndustrial() : [];
        ativos.forEach(a => {
          const leituras = window.FZStore.getLeituras(a.codigo, 1);
          if (!leituras.length) return;
          const l = leituras[0];
          const vel = l.vel_rms || 0;
          const origem = 'ativo:' + a.codigo;
          _leituraEmCheque = { m1_vel: vel, m1_temp: l.temp_c };
          processarLimite(`${a.codigo}_vel_p1`,  a.codigo, 'vel', vel, LIMITES_ISA[0], origem);
          processarLimite(`${a.codigo}_vel_p2`,  a.codigo, 'vel', vel, LIMITES_ISA[1], origem);
        });
      }

      // Dashboard (Monitoramento) — cobre as fontes que os blocos acima não veem
      // (Dataset Forzy / Simulado / Forzy Cloud). 'ativo' e 'esp32' já estão cobertos
      // acima via FZStore/FZIoT, então ficam de fora aqui pra não duplicar o alerta.
      // Motor 1 e Motor 2 são os 2 eixos do MESMO equipamento — se cruzarem juntos,
      // processarLimiteMultiEixo manda um único alerta combinado.
      if (window.FZDashboard) {
        const fonte = window.FZDashboard.getFonte();
        if (fonte !== 'ativo' && fonte !== 'esp32') {
          const r = window.FZDashboard.getCurrentReading();
          const rotulo = fonte === 'forzy' ? 'Dataset Forzy' : fonte === 'sim' ? 'Simulado' : fonte === 'cloud' ? 'Forzy Cloud' : 'Dashboard';
          const origem = fonte === 'forzy' ? 'dataset-forzy' : fonte === 'sim' ? 'simulado' : fonte === 'cloud' ? 'forzy-cloud' : 'dashboard';
          if (r) {
            _leituraEmCheque = r;
            const eixos = [];
            if (r.m1_vel === r.m1_vel) eixos.push({ nome: 'Eixo 1', id: 'm1', pfx: 'dash_m1', vel: r.m1_vel || 0, temp: r.m1_temp || 0 });
            if (r.m2_vel === r.m2_vel) eixos.push({ nome: 'Eixo 2', id: 'm2', pfx: 'dash_m2', vel: r.m2_vel || 0, temp: r.m2_temp || 0 });
            if (eixos.length) {
              // P1 antes de P2 pra mesma variável (precedência)
              processarLimiteMultiEixo(rotulo, origem, eixos.map(e => ({ ...e, valor: e.vel  })), 'vel',  LIMITES_ISA[0], 'p1');
              processarLimiteMultiEixo(rotulo, origem, eixos.map(e => ({ ...e, valor: e.vel  })), 'vel',  LIMITES_ISA[1], 'p2');
              processarLimiteMultiEixo(rotulo, origem, eixos.map(e => ({ ...e, valor: e.temp })), 'temp', LIMITES_ISA[2], 'p1');
              processarLimiteMultiEixo(rotulo, origem, eixos.map(e => ({ ...e, valor: e.temp })), 'temp', LIMITES_ISA[3], 'p2');
            }
            // depois dos limites: a rede neural, que olha as 6 variáveis juntas
            processarRede(rotulo, origem, r);
          }
        }
      }
    } catch(_) {}
  }

  let _topbarInicializado = false; // flag pra não disparar IA na 1ª checagem (baseline)

  // Leitura completa da fonte que está sendo checada neste instante. Vai grudada no
  // alerta (campo `leitura`) pra IA analisar os valores DO MOMENTO DO ALARME quando o
  // operador pedir — e não o frame que estiver na tela quando ele clicar.
  let _leituraEmCheque = null;

  function adicionarAlerta(prioridade, titulo, msg, nivel, valor, unidade, origem, eixo, variavel) {
    // chave baseada em msg para deduplicação estável
    const chave = prioridade + '|' + msg;
    if (alertas.some(a => a.chave === chave)) return;

    const hora = new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
    // origem/eixo/variavel viajam junto: são o que permite o rail de alertas fazer
    // deep-link pra Vista 3D, Assistente e OS sem recalcular nada.
    const alerta = { prioridade, titulo, msg, nivel, hora, chave, valor, unidade,
                     origem, eixo, variavel, ts: new Date().toISOString(),
                     leitura: _leituraEmCheque ? { ..._leituraEmCheque } : null };
    alertas.unshift(alerta);
    if (alertas.length > 20) alertas.pop();
    renderSininho();

    // A IA NÃO é acionada aqui. O alarme chega ao operador "na cara" (modal P1 / faixa
    // P2), no sininho e no rail; a análise da IA só acontece quando ELE pede — botão
    // "Analisar com IA" do modal ou "Perguntar ao Assistente" do rail
    // (FZAssistente.abrirComContexto). Antes cada alarme virava uma pergunta automática
    // e o replay do dataset enchia o chat sem ninguém ter perguntado nada.
    if (_topbarInicializado && window.FZAlertaCritico) {
      if (String(prioridade).indexOf('P1') === 0) window.FZAlertaCritico.disparar(alerta);
      else                                        window.FZAlertaCritico.faixa(alerta);
    }
  }

  function exportarLogCSV() {
    const hoje = new Date().toISOString().slice(0, 10);
    let csv = 'timestamp,prioridade,ativo,variavel,valor,unidade,status\n';
    logAlarmes.forEach(e => {
      csv += `${e.timestamp},${e.prioridade},${e.ativo},${e.variavel},${e.valor},${e.unidade},${e.status}\n`;
    });
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `alarmes_${hoje}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function renderSininho() {
    const dot   = document.getElementById('topbar-bell-dot');
    const panel = document.getElementById('topbar-bell-panel');
    if (!dot || !panel) return;

    const naoLidos = alertas.filter(a => !a.lido).length;
    dot.textContent = naoLidos > 9 ? '9+' : naoLidos || '';
    dot.style.display = naoLidos > 0 ? 'flex' : 'none';

    const badgeCor = { 'P1 - Crítico': '#e74c3c', 'P2 - Alto': '#f39c12' };

    if (!alertas.length) {
      panel.innerHTML = `
        <div class="tbp-header">Alertas <button id="tbp-export-csv">Exportar CSV</button></div>
        <div class="tbp-empty">Nenhum alerta ativo</div>
        <div class="tbp-footer-isa">ISA-18.2 · Histerese 10% aplicada</div>`;
    } else {
      panel.innerHTML = `
        <div class="tbp-header">Alertas <span style="display:flex;gap:6px"><button id="tbp-export-csv">Exportar CSV</button><button id="tbp-clear">Limpar</button></span></div>
        ${alertas.map(a => {
          const cor = badgeCor[a.prioridade] || '#aaa';
          return `
          <div class="tbp-item tbp-${a.nivel}">
            <div class="tbp-title"><span class="tbp-pri-badge" style="background:${cor}22;color:${cor};border:1px solid ${cor}">${a.prioridade}</span> ${a.titulo}</div>
            <div class="tbp-msg">${a.msg}</div>
            <div class="tbp-hora">${a.hora}</div>
          </div>`;
        }).join('')}
        <div class="tbp-footer-isa">ISA-18.2:2016 · Histerese 10% · P1=Crítico P2=Alto</div>`;
      panel.querySelector('#tbp-clear')?.addEventListener('click', e => {
        e.stopPropagation(); alertas.length = 0; renderSininho();
      });
    }
    panel.querySelector('#tbp-export-csv')?.addEventListener('click', e => {
      e.stopPropagation(); exportarLogCSV();
    });
    notificarAlertas();
  }

  /* ---- API pública dos alertas (consumida pelo rail lateral) ---- */
  const _obsAlertas = [];
  function notificarAlertas() {
    _obsAlertas.forEach(fn => { try { fn(alertas, logAlarmes); } catch (_) {} });
  }
  window.FZAlertas = {
    ativos:    () => alertas.slice(),
    // botão de teste da tela IoT: injeta um alarme pelo MESMO caminho de um real — log,
    // sininho, rail e alerta "na cara". Não passa pela histerese: só sai ao Reconhecer.
    simular(p) {
      if (!p) return;
      _leituraEmCheque = p.leitura || null;
      registrarLogEvento(p.prioridade, p.ativo || 'Teste', p.variavel || 'vel', p.valor, p.unidade, 'ATIVADO');
      adicionarAlerta(p.prioridade, p.titulo, p.msg, p.nivel, p.valor, p.unidade, p.origem, p.eixo, p.variavel);
      _leituraEmCheque = null;
    },
    historico: () => logAlarmes.slice(),
    onChange(fn) { if (typeof fn === 'function') { _obsAlertas.push(fn); fn(alertas, logAlarmes); } },
    reconhecer(chave) {
      const i = alertas.findIndex(a => a.chave === chave);
      if (i !== -1) { alertas.splice(i, 1); renderSininho(); }
      if (window.FZAlertaCritico) window.FZAlertaCritico.limpar(chave);
    },
    limparTodos() { alertas.length = 0; renderSininho(); if (window.FZAlertaCritico) window.FZAlertaCritico.limpar(); },
    exportarCSV: exportarLogCSV,
  };

  function iniciarSininho() {
    const bell = document.getElementById('topbar-bell');
    if (!bell) return;
    renderSininho();

    bell.addEventListener('click', e => {
      e.stopPropagation();
      const panel = document.getElementById('topbar-bell-panel');
      const aberto = panel.classList.toggle('visible');
      if (aberto) {
        alertas.forEach(a => a.lido = true);
        renderSininho();
        document.getElementById('topbar-account-menu')?.classList.remove('visible');
      }
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('#topbar-bell'))
        document.getElementById('topbar-bell-panel')?.classList.remove('visible');
    });

    // checa alertas a cada 5s
    // 1ª checagem: só estabelece baseline (sem disparar IA)
    checarAlertas();
    _topbarInicializado = true;
    setInterval(checarAlertas, 2000); // 2s: detecta transição rapidamente
  }

  /* ------------------------------------------------------------------ */
  /* 4. MENU DE CONTA                                                    */
  /* ------------------------------------------------------------------ */
  function iniciarConta() {
    const btn  = document.getElementById('topbar-account');
    const menu = document.getElementById('topbar-account-menu');
    const info = document.getElementById('topbar-user-info');
    if (!btn || !menu) return;

    const perfilBtn = document.getElementById('topbar-perfil-toggle');

    function perfilAtual() { return (window.FZPerfil && window.FZPerfil.get()) || 'admin'; }
    function atualizarPerfilBtn() {
      if (!perfilBtn) return;
      const p = perfilAtual();
      perfilBtn.innerHTML = 'Visão: <b>' + (p === 'operador' ? 'Operador' : 'Analista') + '</b>';
    }

    function atualizarInfo() {
      try {
        const auth = window.FZAuth;
        const user = auth ? auth.usuarioAtual() : null;
        const e = auth ? auth.esc : (x => String(x == null ? '' : x));
        const p = perfilAtual();
        const perfilLbl = `<div style="font-size:10px;color:var(--teal,#8aa9c9);text-transform:uppercase;letter-spacing:.5px;margin-top:2px">Visão ${p === 'operador' ? 'Operador' : 'Analista'}</div>`;
        if (info) info.innerHTML = (user
          ? `<div style="font-weight:600;font-size:13px;color:#fff">${e(user.nome || user.usuario)}</div>
             <div style="font-size:11px;color:rgba(255,255,255,.45)">@${e(user.usuario)} · ${user.perfil === 'operador' ? 'Operador' : 'Analista'}</div>`
          : `<div style="font-size:12px;color:rgba(255,255,255,.4)">Não autenticado</div>`) + perfilLbl;
      } catch(_) {}
      atualizarPerfilBtn();
    }

    if (perfilBtn) {
      perfilBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (window.FZPerfil) window.FZPerfil.toggle();
        atualizarInfo();
      });
    }
    document.addEventListener('fz-perfil-change', atualizarInfo);
    document.addEventListener('fz-auth-change', atualizarInfo);

    btn.addEventListener('click', e => {
      e.stopPropagation();
      const visivel = menu.classList.contains('visible');
      menu.classList.toggle('visible', !visivel);
      if (!visivel) {
        atualizarInfo();
        document.getElementById('topbar-bell-panel')?.classList.remove('visible');
      }
    });

    document.addEventListener('click', e => {
      if (!e.target.closest('#topbar-account')) menu.classList.remove('visible');
    });

    document.getElementById('topbar-signout')?.addEventListener('click', () => {
      menu.classList.remove('visible');
      if (window.FZAuth) window.FZAuth.sair();
      else if (window.showLogin) window.showLogin();
    });

    document.getElementById('topbar-edit-profile')?.addEventListener('click', () => {
      menu.classList.remove('visible');
      window.FZAuth?.abrirEditarPerfil();
    });

    // só conta Analista (o botão some via body.fz-conta-operador)
    document.getElementById('topbar-users')?.addEventListener('click', () => {
      menu.classList.remove('visible');
      window.FZAuth?.abrirUsuarios();
    });
  }

  /* ------------------------------------------------------------------ */
  /* 5. LOGIN / PERFIL — vivem em auth.js (FZAuth). O topbar só chama.     */
  /* ------------------------------------------------------------------ */

  /* ------------------------------------------------------------------ */
  /* CSS                                                                 */
  /* ------------------------------------------------------------------ */
  function injectCSS() {
    const s = document.createElement('style');
    s.textContent = `
      /* Resultados de busca */
      #topbar-search-results {
        display:none; position:absolute; top:calc(100% + 6px); left:0; right:0;
        background:#26262c; border:1px solid rgba(255,255,255,.1);
        border-radius:12px; z-index:9990; overflow:hidden;
        box-shadow:0 8px 32px rgba(0,0,0,.5);
      }
      .tsri {
        display:flex; align-items:center; gap:10px; padding:10px 14px;
        cursor:pointer; font-size:13px; color:#e0e0e0; transition:background .12s;
      }
      .tsri:hover { background:rgba(255,255,255,.07); }
      .tsri-icon { font-size:16px; width:22px; text-align:center; flex:none; }
      .tsri-label { flex:1; }
      .tsri-tipo { font-size:10px; color:rgba(255,255,255,.3); text-transform:uppercase; }

      /* Sininho — dot */
      #topbar-bell-dot {
        position:absolute; top:4px; right:4px;
        min-width:16px; height:16px; border-radius:8px;
        background:#e74c3c; color:#fff; font-size:9px; font-weight:700;
        display:none; align-items:center; justify-content:center;
        border:2px solid var(--bg,#141417);
      }

      /* Sininho — painel */
      #topbar-bell-panel {
        position:absolute; top:calc(100% + 10px); right:0;
        width:300px; background:#1e1e24; border:1px solid rgba(255,255,255,.1);
        border-radius:14px; z-index:9990; overflow:hidden;
        box-shadow:0 8px 32px rgba(0,0,0,.5);
        opacity:0; visibility:hidden; transform:translateY(-8px);
        transition:opacity .18s ease, transform .18s ease, visibility .18s;
        pointer-events:none;
      }
      #topbar-bell-panel.visible {
        opacity:1; visibility:visible; transform:translateY(0);
        pointer-events:auto;
      }
      .tbp-header {
        display:flex; justify-content:space-between; align-items:center;
        padding:12px 14px 8px; font-size:13px; font-weight:600; color:#fff;
        border-bottom:1px solid rgba(255,255,255,.07);
      }
      .tbp-header button {
        background:none; border:none; color:rgba(255,255,255,.4);
        font-size:11px; cursor:pointer; padding:2px 6px; border-radius:4px;
      }
      .tbp-header button:hover { background:rgba(255,255,255,.08); color:#fff; }
      .tbp-item { padding:10px 14px; border-bottom:1px solid rgba(255,255,255,.05); }
      .tbp-title { font-size:12px; font-weight:600; margin-bottom:2px; }
      .tbp-msg { font-size:11px; color:rgba(255,255,255,.6); }
      .tbp-hora { font-size:10px; color:rgba(255,255,255,.3); margin-top:2px; }
      .tbp-bad .tbp-title { color:#e74c3c; }
      .tbp-warn .tbp-title { color:#f39c12; }
      .tbp-ok .tbp-title { color:#2ecc71; }
      .tbp-empty { padding:20px; text-align:center; color:rgba(255,255,255,.3); font-size:13px; }
      .tbp-pri-badge { display:inline-block; font-size:9px; font-weight:700; padding:1px 5px; border-radius:4px; margin-right:4px; text-transform:uppercase; vertical-align:middle; }
      .tbp-footer-isa { padding:6px 14px; font-size:9px; color:rgba(255,255,255,.25); text-align:right; border-top:1px solid rgba(255,255,255,.05); }

      /* Menu de conta */
      #topbar-account { position:relative; }
      #topbar-account-menu {
        position:absolute; top:calc(100% + 10px); right:0;
        width:200px; background:#1e1e24; border:1px solid rgba(255,255,255,.1);
        border-radius:14px; z-index:9990; overflow:hidden;
        box-shadow:0 8px 32px rgba(0,0,0,.5); padding:12px;
        opacity:0; visibility:hidden; transform:translateY(-8px);
        transition:opacity .18s ease, transform .18s ease, visibility .18s;
        pointer-events:none;
      }
      #topbar-account-menu.visible {
        opacity:1; visibility:visible; transform:translateY(0);
        pointer-events:auto;
      }
      #topbar-account-menu button {
        display:block; width:100%; text-align:left;
        background:none; border:none; color:#e0e0e0;
        font-size:13px; padding:9px 10px; border-radius:8px;
        cursor:pointer; transition:background .12s;
      }
      #topbar-account-menu button:hover { background:rgba(255,255,255,.07); }
      #topbar-user-info { padding:4px 4px 8px; }

      /* Modal editar perfil */
      #fz-profile-modal {
        position:fixed; inset:0; background:rgba(0,0,0,.6);
        display:flex; align-items:center; justify-content:center; z-index:99999;
      }
      #fz-profile-box {
        background:#26262c; border:1px solid rgba(255,255,255,.1);
        border-radius:16px; padding:24px; width:320px;
        box-shadow:0 16px 48px rgba(0,0,0,.6);
      }
      #fz-profile-box input, #fz-profile-box select {
        display:block; width:100%; box-sizing:border-box;
        background:#1e1e24; border:1px solid rgba(255,255,255,.12);
        border-radius:8px; padding:9px 12px; color:#fff; font-size:13px;
        margin-top:4px; outline:none; font-family:inherit;
      }
      #fz-profile-box input:focus, #fz-profile-box select:focus { border-color:rgba(138,169,201,.5); }
    `;
    document.head.appendChild(s);
  }

  /* ------------------------------------------------------------------ */
  /* INIT                                                                */
  /* ------------------------------------------------------------------ */
  function init() {
    injectCSS();
    iniciarRelogio();
    iniciarBusca();
    iniciarSininho();
    iniciarConta();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
