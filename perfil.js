/* ===================================================================
   PROJETO FORZY - Sistema de Monitoramento Industrial
   Trabalho academico FIAP + Forzy-Promon

   Integrantes:
   - Arthur Baptista dos Santos       (RM 565346)
   - Joao Pedro de Moura Dutra Franco (RM 561738)
   - Nelson Felix Neto                (RM 565603)
   - Pietro Boroto Rodrigues          (RM 562407)
   - Vitor Soares Goncalves           (RM 566181)

   Arquivo: perfil.js
   O que faz: troca entre o modo Operador e o modo Admin
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

  function sincronizarSwitch() {
    const atual = get();
    const sw = document.getElementById('fzVisaoToggle');
    if (!sw) return;
    sw.setAttribute('aria-checked', atual === 'admin' ? 'true' : 'false');
    sw.classList.toggle('is-operador', atual === 'operador');
    const txt = sw.querySelector('.fz-visao-txt');
    if (txt) txt.textContent = ROTULO[atual];
  }

  function wireSwitch() {
    const sw = document.getElementById('fzVisaoToggle');
    if (sw) sw.addEventListener('click', toggle);
    sincronizarSwitch();
    document.addEventListener('fz-perfil-change', sincronizarSwitch);
  }

  function boot() { aplicarClasse(get()); wireSwitch(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
