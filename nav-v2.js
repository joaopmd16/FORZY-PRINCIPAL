/* nav-v2.js: menu lateral (sidebar) e realce do item ativo */

(function () {

  // telas que acendem o item de outra tela na sidebar (a Planta/SCADA fica dentro do Monitoramento)
  const NAV_DO_GRUPO = { navegacao: 'cadastro', rpa: 'iot', pipeline: 'iot', scada: 'dashboard' };

  // marca o item ativo da sidebar e atualiza o breadcrumb
  function sincronizarNavItem(key) {
    const dono = NAV_DO_GRUPO[key];
    if (!dono) return;
    document.querySelectorAll('.nav-item[data-screen]').forEach(b => {
      if (b.dataset.screen === dono) b.classList.add('active');
    });
  }

  document.querySelectorAll('.fz-group-tabs .fz-tab[data-screen]').forEach(b => {
    b.addEventListener('click', () => {
      const key = b.dataset.screen;
      if (typeof window.showScreen === 'function') window.showScreen(key);
      sincronizarNavItem(key);
    });
  });

  if (typeof window.showScreen === 'function') {
    const _show = window.showScreen;
    window.showScreen = function (name) {
      const r = _show.apply(this, arguments);
      try { sincronizarNavItem(name); } catch (e) {  }
      return r;
    };
  }

  // Monitoramento -> Planta: abre a tela SCADA ja na aba escolhida (2D, Vista 3D, Historico)
  document.querySelectorAll('[data-goto-scada]').forEach(b => b.addEventListener('click', () => {
    if (typeof window.showScreen === 'function') window.showScreen('scada');
    document.querySelector('#scadaTabs .fz-tab[data-stab="' + b.dataset.gotoScada + '"]')?.click();
  }));
  // Planta -> Monitoramento: volta pro Dashboard ja na aba escolhida
  document.querySelectorAll('[data-goto-mon]').forEach(b => b.addEventListener('click', () => {
    if (typeof window.showScreen === 'function') window.showScreen('dashboard');
    document.querySelector('#fzTabs .fz-tab[data-tab="' + b.dataset.gotoMon + '"]')?.click();
  }));

  const gear = document.getElementById('inicioSettingsBtn');
  const drop = document.getElementById('inicioControlsDrop');
  if (gear && drop) {
    gear.addEventListener('click', () => {
      const open = drop.classList.toggle('open');
      gear.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
})();
