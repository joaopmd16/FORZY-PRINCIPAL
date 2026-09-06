/* ===================================================================
   FORZY · Perfil de acesso — chavinha Operador ⇄ Admin
   Sem autenticação real: é modo de apresentação. Troca o layout,
   os textos e quais telas aparecem.
     window.FZPerfil = { get, set, isAdmin, isOperador, onChange, toggle }
   Grava em localStorage 'fz-perfil' ('operador' | 'admin', default 'admin').
   Carregado ANTES de app.js.
   =================================================================== */
(function () {
  const KEY = 'fz-perfil';
  const VALIDOS = ['operador', 'admin'];
  const cbs = [];

  function get() {
    try {
      const v = localStorage.getItem(KEY);
      return VALIDOS.includes(v) ? v : 'admin';
    } catch (_) { return 'admin'; }
  }

  function aplicarClasse(p) {
    const b = document.body;
    if (!b) return;
    b.classList.toggle('perfil-operador', p === 'operador');
    b.classList.toggle('perfil-admin', p === 'admin');
  }

  function set(p) {
    if (!VALIDOS.includes(p)) return;
    try { localStorage.setItem(KEY, p); } catch (_) {}
    aplicarClasse(p);
    cbs.forEach(fn => { try { fn(p); } catch (_) {} });
    document.dispatchEvent(new CustomEvent('fz-perfil-change', { detail: { perfil: p } }));
  }

  function toggle() { set(get() === 'admin' ? 'operador' : 'admin'); }
  function onChange(fn) { if (typeof fn === 'function') cbs.push(fn); }

  window.FZPerfil = {
    get,
    set,
    toggle,
    onChange,
    isAdmin: () => get() === 'admin',
    isOperador: () => get() === 'operador',
  };

  const ROTULO = { operador: 'Operador', admin: 'Analista' };

  // reflete o estado atual na chavinha da topbar (knob + rótulo)
  function sincronizarSwitch() {
    const atual = get();
    const sw = document.getElementById('fzVisaoToggle');
    if (!sw) return;
    sw.setAttribute('aria-checked', atual === 'admin' ? 'true' : 'false');
    sw.classList.toggle('is-operador', atual === 'operador');
    const txt = sw.querySelector('.fz-visao-txt');
    if (txt) txt.textContent = ROTULO[atual];
  }

  // chavinha Operador ⇄ Analista sempre visível na topbar.
  // Nunca é escondida pelo gating de perfil — senão o operador ficaria preso no modo.
  function wireSwitch() {
    const sw = document.getElementById('fzVisaoToggle');
    if (sw) sw.addEventListener('click', toggle);
    sincronizarSwitch();
    document.addEventListener('fz-perfil-change', sincronizarSwitch);
  }

  // fixa a classe inicial assim que o body existir
  function boot() { aplicarClasse(get()); wireSwitch(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
