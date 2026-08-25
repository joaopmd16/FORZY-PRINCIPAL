/* ===================================================================
   FORZY · Navegação v2 — sidebar enxuta (6 itens), grupos com aba
   interna (Ativos, Sensores & Automação) e breadcrumb.
   Só usado por vision-v2.html. Não altera app.js (versão em produção).
   =================================================================== */
(function () {
  // telas "órfãs" (sem item próprio na sidebar, vivem dentro de um grupo)
  // → data-screen da tela órfã : data-screen do nav-item que deve acender
  const NAV_DO_GRUPO = { navegacao: 'cadastro', rpa: 'iot', pipeline: 'iot' };

  const ROTULOS = {
    inicio:     'Início',
    dashboard:  'Monitoramento',
    navegacao:  'Ativos › Plantas &amp; Áreas',
    cadastro:   'Ativos › Lista de Ativos',
    rpa:        'Sensores &amp; Automação › RPA',
    pipeline:   'Sensores &amp; Automação › Pipeline',
    iot:        'Sensores &amp; Automação › IoT ao Vivo',
    scada:      'SCADA',
    assistente: 'Assistente IA',
  };
  const ROTULOS_ABA = { esp: 'Espectral', oper: 'Operacional', hist: 'Histórico', ml: 'Baseline ML' };

  function atualizarBreadcrumb(key, aba) {
    const bc = document.getElementById('breadcrumb');
    if (!bc) return;
    const base = ROTULOS[key] || key;
    bc.innerHTML = aba && ROTULOS_ABA[aba] ? `${base} › <b>${ROTULOS_ABA[aba]}</b>` : `<b>${base}</b>`;
  }

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

  // nav-item de topo: app.js já cuida do realce (toggle nativo); só falta o breadcrumb
  document.querySelectorAll('.nav-item[data-screen]').forEach(b => {
    b.addEventListener('click', () => atualizarBreadcrumb(b.dataset.screen));
  });

  // sub-abas do Dashboard (Espectral/Operacional/...) — cada tela já tem sua própria
  // barra fz-tabs com o botão certo marcado .active no HTML estático
  document.querySelectorAll('#fzTabs .fz-tab[data-tab]').forEach(b => {
    b.addEventListener('click', () => atualizarBreadcrumb('dashboard', b.dataset.tab));
  });

  // barras de aba dos grupos mesclados (Ativos · Sensores & Automação)
  document.querySelectorAll('.fz-group-tabs .fz-tab[data-screen]').forEach(b => {
    b.addEventListener('click', () => {
      const key = b.dataset.screen;
      if (typeof window.showScreen === 'function') window.showScreen(key);
      sincronizarNavItem(key);
      atualizarBreadcrumb(key);
    });
  });

  atualizarBreadcrumb('inicio');
})();
