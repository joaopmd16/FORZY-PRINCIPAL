/* ===================================================================
   PROJETO FORZY - Sistema de Monitoramento Industrial
   Trabalho academico FIAP + Forzy-Promon

   Integrantes:
   - Arthur Baptista dos Santos       (RM 565346)
   - Joao Pedro de Moura Dutra Franco (RM 561738)
   - Nelson Felix Neto                (RM 565603)
   - Pietro Boroto Rodrigues          (RM 562407)
   - Vitor Soares Goncalves           (RM 566181)

   Arquivo: nav-v2.js
   O que faz: menu lateral (sidebar) e realce do item ativo
   =================================================================== */

(function () {

  const NAV_DO_GRUPO = { navegacao: 'cadastro', rpa: 'iot', pipeline: 'iot' };

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

  const gear = document.getElementById('inicioSettingsBtn');
  const drop = document.getElementById('inicioControlsDrop');
  if (gear && drop) {
    gear.addEventListener('click', () => {
      const open = drop.classList.toggle('open');
      gear.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
})();
