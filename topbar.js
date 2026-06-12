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
  }

  function processarLimite(chave, ativo, variavel, valor, limite) {
    const estado = estadoAlarme.get(chave) || { ativo: false };

    if (!estado.ativo) {
      // ISA-18.2: dispara alarme somente quando cruza threshold para CIMA
      if (valor >= limite.threshold) {
        estadoAlarme.set(chave, { ativo: true });
        registrarLogEvento(limite.prioridade, ativo, variavel, valor, limite.unidade, 'ATIVADO');
        adicionarAlerta(limite.prioridade, limite.titulo, `${ativo}: ${limite.variavel === 'vel' ? 'Vibração' : 'Temperatura'} ${valor.toFixed(limite.variavel === 'vel' ? 2 : 1)} ${limite.unidade}`, limite.nivel, valor, limite.unidade);
      }
    } else {
      // ISA-18.2: limpa somente quando cai abaixo do deadband (90% do threshold)
      if (valor < limite.deadband) {
        estadoAlarme.set(chave, { ativo: false });
        registrarLogEvento(limite.prioridade, ativo, variavel, valor, limite.unidade, 'NORMALIZADO');
        // remove alerta correspondente da lista ativa
        const idx = alertas.findIndex(a => a.chave === chave);
        if (idx !== -1) { alertas.splice(idx, 1); renderSininho(); }
      }
    }
  }

  function checarAlertas() {
    try {
      // ESP32 ao vivo
      if (window.FZIoT && window.FZIoT.isConnected()) {
        const last = window.FZIoT.getLast();
        if (last) {
          // P1 Crítico tem precedência: verificar P1 antes de P2 para a mesma variável
          processarLimite('esp32_vel_p1',  'ESP32', 'vel',  last.vel  || 0, LIMITES_ISA[0]);
          processarLimite('esp32_vel_p2',  'ESP32', 'vel',  last.vel  || 0, LIMITES_ISA[1]);
          processarLimite('esp32_temp_p1', 'ESP32', 'temp', last.temp || 0, LIMITES_ISA[2]);
          processarLimite('esp32_temp_p2', 'ESP32', 'temp', last.temp || 0, LIMITES_ISA[3]);
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
          processarLimite(`${a.codigo}_vel_p1`,  a.codigo, 'vel', vel, LIMITES_ISA[0]);
          processarLimite(`${a.codigo}_vel_p2`,  a.codigo, 'vel', vel, LIMITES_ISA[1]);
        });
      }
    } catch(_) {}
  }

  let _topbarInicializado = false; // flag pra não disparar IA na 1ª checagem (baseline)

  function adicionarAlerta(prioridade, titulo, msg, nivel, valor, unidade) {
    // chave baseada em msg para deduplicação estável
    const chave = prioridade + '|' + msg;
    if (alertas.some(a => a.chave === chave)) return;

    const hora = new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
    alertas.unshift({ prioridade, titulo, msg, nivel, hora, chave, valor, unidade });
    if (alertas.length > 20) alertas.pop();
    renderSininho();

    // só dispara IA após a 1ª checagem (evita falso positivo no carregamento da página)
    if (_topbarInicializado && window.FZAssistant && typeof window.FZAssistant.alertarNotificacao === 'function') {
      window.FZAssistant.alertarNotificacao({ prioridade, titulo, msg, nivel, valor, unidade });
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
  }

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

    function atualizarInfo() {
      try {
        const user = JSON.parse(localStorage.getItem('fz-user') || '{}');
        if (info) info.innerHTML = user.email
          ? `<div style="font-weight:600;font-size:13px;color:#fff">${user.nome || 'Usuário'}</div>
             <div style="font-size:11px;color:rgba(255,255,255,.45)">${user.email}</div>`
          : `<div style="font-size:12px;color:rgba(255,255,255,.4)">Não autenticado</div>`;
      } catch(_) {}
    }

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
      localStorage.removeItem('fz-logged');
      menu.classList.remove('visible');
      if (window.showLogin) window.showLogin();
    });

    document.getElementById('topbar-edit-profile')?.addEventListener('click', () => {
      menu.classList.remove('visible');
      abrirEditarPerfil();
    });
  }

  function abrirEditarPerfil() {
    const user = JSON.parse(localStorage.getItem('fz-user') || '{}');
    const modal = document.createElement('div');
    modal.id = 'fz-profile-modal';
    modal.innerHTML = `
      <div id="fz-profile-box">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <strong style="font-size:15px">Editar Perfil</strong>
          <button id="fz-profile-close" style="background:none;border:none;color:#aaa;font-size:18px;cursor:pointer">✕</button>
        </div>
        <label style="font-size:12px;color:#aaa">Nome</label>
        <input id="fz-pf-nome" value="${user.nome||''}" placeholder="Seu nome">
        <label style="font-size:12px;color:#aaa;margin-top:10px;display:block">E-mail</label>
        <input id="fz-pf-email" value="${user.email||''}" placeholder="seu@email.com">
        <label style="font-size:12px;color:#aaa;margin-top:10px;display:block">Nova senha (opcional)</label>
        <input id="fz-pf-senha" type="password" placeholder="••••••••">
        <button id="fz-pf-save" style="margin-top:16px;width:100%;padding:10px;background:var(--teal,#8aa9c9);border:none;border-radius:8px;color:#fff;font-size:14px;cursor:pointer;font-weight:600">Salvar</button>
      </div>`;
    document.body.appendChild(modal);

    modal.querySelector('#fz-profile-close').onclick = () => modal.remove();
    modal.onclick = e => { if (e.target === modal) modal.remove(); };
    modal.querySelector('#fz-pf-save').onclick = () => {
      const novo = {
        nome:  modal.querySelector('#fz-pf-nome').value.trim(),
        email: modal.querySelector('#fz-pf-email').value.trim(),
        senha: modal.querySelector('#fz-pf-senha').value || user.senha || ''
      };
      localStorage.setItem('fz-user', JSON.stringify(novo));
      modal.remove();
    };
  }

  /* ------------------------------------------------------------------ */
  /* 5. LOGIN — email + senha local                                      */
  /* ------------------------------------------------------------------ */
  function iniciarLogin() {
    const btn = document.getElementById('doLogin');
    if (!btn) return;

    // seed padrão se não houver usuário
    if (!localStorage.getItem('fz-user')) {
      localStorage.setItem('fz-user', JSON.stringify({ nome: 'Admin', email: 'admin@forzy.com', senha: 'forzy123' }));
    }

    btn._tbHandled = true;
    btn.addEventListener('click', fazerLogin);
    document.getElementById('login-password')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') fazerLogin();
    });

    document.getElementById('login-forgot')?.addEventListener('click', e => {
      e.preventDefault();
      alert('Entre em contato com o administrador do sistema para redefinir sua senha.');
    });
  }

  function fazerLogin() {
    const email = document.getElementById('login-email')?.value.trim();
    const senha = document.getElementById('login-password')?.value;
    const erro  = document.getElementById('login-error');

    try {
      const user = JSON.parse(localStorage.getItem('fz-user') || '{}');
      if (email === user.email && senha === user.senha) {
        localStorage.setItem('fz-logged', '1');
        if (erro) erro.style.display = 'none';
        const shell = document.getElementById('app-shell');
        if (shell) shell.style.display = 'grid';
        const login = document.getElementById('screen-login');
        if (login) login.classList.remove('active');
        if (window.showScreen) window.showScreen('screen-inicio');
      } else {
        if (erro) { erro.textContent = 'E-mail ou senha incorretos.'; erro.style.display = 'block'; }
      }
    } catch(_) {
      if (erro) { erro.textContent = 'Erro ao autenticar.'; erro.style.display = 'block'; }
    }
  }

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
      #fz-profile-box input {
        display:block; width:100%; box-sizing:border-box;
        background:#1e1e24; border:1px solid rgba(255,255,255,.12);
        border-radius:8px; padding:9px 12px; color:#fff; font-size:13px;
        margin-top:4px; outline:none;
      }
      #fz-profile-box input:focus { border-color:rgba(138,169,201,.5); }
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
    iniciarLogin();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
