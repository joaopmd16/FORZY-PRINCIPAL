/* ===================================================================
   FORZY · Navegação — sidebar enxuta (6 itens), grupos com aba
   interna (Ativos, Sensores & Automação).
   Usado por vision.html. Roda ao lado do app.js (roteamento base),
   sem alterá-lo — apenas registra listeners paralelos.
   =================================================================== */
(function () {
  // telas "órfãs" (sem item próprio na sidebar, vivem dentro de um grupo)
  // → data-screen da tela órfã : data-screen do nav-item que deve acender
  const NAV_DO_GRUPO = { navegacao: 'cadastro', rpa: 'iot', pipeline: 'iot' };

  /*
   * Não existe breadcrumb. A sidebar já acende o item da tela e cada tela tem a
   * própria barra de abas — uma faixa em cima repetindo isso era só ruído
   * ocupando altura útil. O que sobra aqui é o realce da sidebar para as telas
   * "órfãs", que não têm item próprio e vivem dentro de um grupo.
   */

  // acende na sidebar o nav-item "dono" de uma tela órfã (Plantas&Áreas, RPA, Pipeline)
  function sincronizarNavItem(key) {
    const dono = NAV_DO_GRUPO[key];
    if (!dono) return;
    document.querySelectorAll('.nav-item[data-screen]').forEach(b => {
      if (b.dataset.screen === dono) b.classList.add('active');
    });
  }

  // app.js registra seus próprios listeners de clique usando a closure interna
  // (não via window.showScreen), então em vez de empacotar a função global,
  // registramos listeners paralelos nos mesmos elementos.

  // barras de aba dos grupos mesclados (Ativos · Sensores & Automação)
  document.querySelectorAll('.fz-group-tabs .fz-tab[data-screen]').forEach(b => {
    b.addEventListener('click', () => {
      const key = b.dataset.screen;
      if (typeof window.showScreen === 'function') window.showScreen(key);
      sincronizarNavItem(key);
    });
  });

  // troca de tela por código (deep-link do rail de alertas, do modal P1…) não passa
  // pelos listeners de clique acima — sem isto a sidebar não acenderia o grupo certo
  // ao cair numa tela órfã vinda de um alerta.
  if (typeof window.showScreen === 'function') {
    const _show = window.showScreen;
    window.showScreen = function (name) {
      const r = _show.apply(this, arguments);
      try { sincronizarNavItem(name); } catch (e) { /* noop */ }
      return r;
    };
  }

  // Início v2 — engrenagem abre/fecha o painel de Fonte/Auto-refresh
  const gear = document.getElementById('inicioSettingsBtn');
  const drop = document.getElementById('inicioControlsDrop');
  if (gear && drop) {
    gear.addEventListener('click', () => {
      const open = drop.classList.toggle('open');
      gear.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
})();
