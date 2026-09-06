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
      window.FZChatScreen?.ajustarAltura();
      window.FZCopiloto?.init();
      document.getElementById('navAssistenteDot')?.classList.remove('show');
    }
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

  /* Assistente + Manutenção — abas internas (Conversa / Diagnóstico & OS) */
  const assistTabs = document.querySelectorAll('#fzAssistTabs .fz-tab[data-atab]');
  assistTabs.forEach(b => b.addEventListener('click', () => {
    const alvo = b.dataset.atab;
    assistTabs.forEach(x => x.classList.toggle('active', x === b));
    document.querySelectorAll('#screen-assistente .fz-panel[data-apanel]').forEach(p =>
      p.classList.toggle('active', p.dataset.apanel === alvo));
    if (alvo === 'os') window.FZCopiloto?.init();
    if (alvo === 'conversa') window.FZChatScreen?.ajustarAltura();
  }));

  /* ----------  ESTADO INICIAL  ---------- */
  appShell.style.display = 'grid';
  localStorage.setItem('fz-logged', '1');
  aplicarPerfilNav();

  /* ----------  ICONS  ---------- */
  if (window.lucide) lucide.createIcons();
})();
