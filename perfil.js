/* perfil.js: troca entre o modo Operador e o modo Admin */

(function () {
  const KEY = 'fz-perfil';
  const VALIDOS = ['operador', 'admin'];
  const cbs = [];

  // perfil atual
  function get() {
    try {
      const v = localStorage.getItem(KEY);
      return VALIDOS.includes(v) ? v : 'admin';
    } catch (_) { return 'admin'; }
  }

  // poe a classe perfil-* no body
  function aplicarClasse(p) {
    const b = document.body;
    if (!b) return;
    b.classList.toggle('perfil-operador', p === 'operador');
    b.classList.toggle('perfil-admin', p === 'admin');
  }

  // define o perfil
  function set(p) {
    if (!VALIDOS.includes(p)) return;
    try { localStorage.setItem(KEY, p); } catch (_) {}
    aplicarClasse(p);
    cbs.forEach(fn => { try { fn(p); } catch (_) {} });
    document.dispatchEvent(new CustomEvent('fz-perfil-change', { detail: { perfil: p } }));
  }

  // alterna Operador e Analista
  function toggle() { set(get() === 'admin' ? 'operador' : 'admin'); }
  // avisa quando o perfil muda
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

  // atualiza a chavinha da topbar
  function sincronizarSwitch() {
    const atual = get();
    const sw = document.getElementById('fzVisaoToggle');
    if (!sw) return;
    sw.setAttribute('aria-checked', atual === 'admin' ? 'true' : 'false');
    sw.classList.toggle('is-operador', atual === 'operador');
    const txt = sw.querySelector('.fz-visao-txt');
    if (txt) txt.textContent = ROTULO[atual];
  }

  // liga a chavinha da topbar
  function wireSwitch() {
    const sw = document.getElementById('fzVisaoToggle');
    if (sw) sw.addEventListener('click', toggle);
    sincronizarSwitch();
    document.addEventListener('fz-perfil-change', sincronizarSwitch);
  }

  // inicia o perfil ao abrir o site
  function boot() { aplicarClasse(get()); wireSwitch(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
