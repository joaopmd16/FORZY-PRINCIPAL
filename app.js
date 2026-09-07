/* ===================================================================
   Vision Dashboard — interactions
   =================================================================== */
(function () {
  const root = document.documentElement;
  const appShell = document.getElementById('app-shell');
  const loginScreen = document.getElementById('screen-login');

  /* ----------  THEME  ---------- */
  const saved = localStorage.getItem('vision-theme');
  if (saved) root.setAttribute('data-theme', saved);
  document.getElementById('themeToggle').addEventListener('click', () => {
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('vision-theme', next);
  });

  /* ----------  SCREEN NAV  ---------- */
  const sections = {
    inicio: document.getElementById('screen-inicio'),
    navegacao: document.getElementById('screen-navegacao'),
    cadastro: document.getElementById('screen-cadastro'),
    rpa: document.getElementById('screen-rpa'),
    pipeline: document.getElementById('screen-pipeline'),
    dashboard: document.getElementById('screen-dashboard'),
    scada: document.getElementById('screen-scada'),
    iot: document.getElementById('screen-iot'),
    assistente: document.getElementById('screen-assistente'),
    diagnostico: document.getElementById('screen-diagnostico'),
    governanca: document.getElementById('screen-governanca'),
  };
  const navItems = document.querySelectorAll('.nav-item[data-screen]');

  /* ----------  PERFIL (operador × admin)  ---------- */
  // telas/itens marcados data-perfil="admin" somem no modo operador.
  const ADMIN_ONLY = new Set();
  document.querySelectorAll('.nav-item[data-perfil="admin"]').forEach(b => ADMIN_ONLY.add(b.dataset.screen));

  function ehOperador() { return !!(window.FZPerfil && window.FZPerfil.isOperador()); }

  function aplicarPerfilNav() {
    const op = ehOperador();
    document.querySelectorAll('[data-perfil="admin"]').forEach(elm => {
      elm.hidden = op;
      elm.style.display = op ? 'none' : '';
    });
    // se o operador está numa tela restrita, joga pro Início
    if (op) {
      const atual = document.querySelector('.nav-item.active');
      if (atual && ADMIN_ONLY.has(atual.dataset.screen)) showScreen('inicio');
    }
  }
  document.addEventListener('fz-perfil-change', aplicarPerfilNav);

  function showScreen(name) {
    // aceita tanto 'inicio' quanto 'screen-inicio'
    const key = name.replace('screen-', '');
    if (key === 'login') { showLogin(); return; }
    if (!sections[key]) return;
    // operador não acessa telas só-admin
    if (ehOperador() && ADMIN_ONLY.has(key)) return;
    appShell.style.display = 'grid';
    loginScreen.classList.remove('active');
    Object.entries(sections).forEach(([k, el]) =>
      el && el.classList.toggle('active', k === key));
    navItems.forEach(b =>
      b.classList.toggle('active', b.dataset.screen === key));
    window.scrollTo({ top: 0 });
    if (key === 'assistente') {
      window.FZChatScreen?.init();
      document.getElementById('navAssistenteDot')?.classList.remove('show');
    }
    if (key === 'diagnostico') {
      const atual = document.querySelector('#fzDiagTabs .fz-tab.active');
      ativarAbaDiag(atual ? atual.dataset.dtab : 'investigacao');
    }
    if (key === 'governanca') window.FZGovernanca?.init();
  }
  window.showScreen = showScreen;   // expõe globalmente para topbar.js e assistant.js

  navItems.forEach(b => b.addEventListener('click', () => showScreen(b.dataset.screen)));

  /* sidebar sub-items (Dashboard → tab) */
  document.querySelectorAll('.nav-subitem[data-screen]').forEach(b => {
    b.addEventListener('click', () => {
      showScreen(b.dataset.screen);
      const tab = b.dataset.tab;
      if (tab) {
        const fzTab = document.querySelector(`#fzTabs .fz-tab[data-tab="${tab}"]`);
        if (fzTab) fzTab.click();
      }
    });
  });

  /* in-page navigation buttons (e.g. Início quick actions) */
  document.querySelectorAll('[data-goto]').forEach(b =>
    b.addEventListener('click', () => showScreen(b.dataset.goto)));

  /* Assistente IA sidebar button */
  const navAssistente = document.getElementById('navAssistente');
  if (navAssistente) navAssistente.addEventListener('click', () => window.FZAssistant?.togglePanel());

  function showLogin() {
    appShell.style.display = 'none';
    loginScreen.classList.add('active');
    window.scrollTo({ top: 0 });
  }

  window.showLogin = showLogin;

  /* Diagnóstico — sub-abas internas (Investigação / Causa Raiz / Projeção / OS) */
  // consulta o DOM a cada chamada em vez de fechar sobre um NodeList: showScreen()
  // usa esta funcao e pode rodar antes desta linha ser executada.
  function ativarAbaDiag(alvo) {
    const abas = document.querySelectorAll('#fzDiagTabs .fz-tab[data-dtab]');
    if (!abas.length) return;
    if (!alvo || ![...abas].some(x => x.dataset.dtab === alvo)) alvo = 'investigacao';
    abas.forEach(x => x.classList.toggle('active', x.dataset.dtab === alvo));
    document.querySelectorAll('#screen-diagnostico .fz-panel[data-dpanel]').forEach(p =>
      p.classList.toggle('active', p.dataset.dpanel === alvo));
    if (alvo === 'investigacao') window.FZInvestigacao?.init();
    else if (alvo === 'rca') window.FZRCA?.init();
    else if (alvo === 'preditivo') window.FZPreditivo?.init();
    else if (alvo === 'os') window.FZCopiloto?.init();
  }
  document.querySelectorAll('#fzDiagTabs .fz-tab[data-dtab]').forEach(b =>
    b.addEventListener('click', () => ativarAbaDiag(b.dataset.dtab)));

  /* coligação entre as áreas: mudança de alarme ou de perfil re-renderiza a
     sub-aba de Diagnóstico aberta, para ela refletir o estado atual do sistema */
  function reagirDiag() {
    const tela = document.getElementById('screen-diagnostico');
    if (!tela || !tela.classList.contains('active')) return;
    const atual = document.querySelector('#fzDiagTabs .fz-tab.active');
    ativarAbaDiag(atual ? atual.dataset.dtab : 'investigacao');
  }
  if (window.FZAlertas && typeof window.FZAlertas.onChange === 'function') {
    let _1a = true;
    window.FZAlertas.onChange(() => { if (_1a) { _1a = false; return; } reagirDiag(); });
  }
  document.addEventListener('fz-perfil-change', reagirDiag);

  /* ----------  ESTADO INICIAL  ---------- */
  // sessão válida (auth.js) → entra direto; sem sessão → tela de login
  if (window.FZAuth && !window.FZAuth.logado()) showLogin();
  else appShell.style.display = 'grid';
  aplicarPerfilNav();

  /* ----------  ICONS  ---------- */
  if (window.lucide) lucide.createIcons();
})();
