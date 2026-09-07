/* ===================================================================
   FORZY · Login por usuário — nome.sobrenome + senha. Sem Google/OAuth:
   é sistema interno de fábrica, o acesso é dado pelo analista.

   Os usuários vivem no navegador (localStorage) — não há backend. A senha
   nunca fica em texto puro: guarda-se SHA-256 salgado (WebCrypto), com
   fallback FNV quando o contexto não tem crypto.subtle.

     window.FZAuth = {
       logado, usuarioAtual, usuarios, entrar, sair,
       criarUsuario, removerUsuario, redefinirSenha, alterarPropria,
       abrirEditarPerfil, abrirUsuarios, normalizar, sugerir, seedIntacto, esc
     }

   Chaves: 'fz-usuarios-v1' (tabela) · 'fz-sessao' (localStorage se
   "Manter conectado", senão sessionStorage) · 'fz-usuarios-seed' (existe
   enquanto ninguém mexeu na tabela — mostra a dica de primeiro acesso).

   Carregado DEPOIS de perfil.js e ANTES de topbar.js/app.js: o app.js
   decide na abertura se mostra o login com FZAuth.logado().
   =================================================================== */
(function () {
  const KEY_USUARIOS  = 'fz-usuarios-v1';
  const KEY_SESSAO    = 'fz-sessao';
  const KEY_SEED      = 'fz-usuarios-seed';
  const DIAS_SESSAO   = 30;
  const SENHA_INICIAL = 'forzy123';

  // primeiro acesso — um analista (cria os demais) e um operador de exemplo
  const SEED = [
    { usuario: 'joao.franco', nome: 'João Franco',       perfil: 'admin' },
    { usuario: 'operador',    nome: 'Operador de turno', perfil: 'operador' },
  ];

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const ROTULO = { admin: 'Analista', operador: 'Operador' };
  const rotuloPerfil = p => ROTULO[p] || ROTULO.admin;

  /* ------------------------------------------------------------------ */
  /* Usuário: "João Franco" → "joao.franco"                              */
  /* ------------------------------------------------------------------ */
  function normalizar(s) {
    return String(s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().trim()
      .replace(/\s+/g, '.')
      .replace(/[^a-z0-9._-]/g, '')
      .replace(/\.{2,}/g, '.')
      .replace(/^[._-]+|[._-]+$/g, '');
  }

  // sugestão a partir do nome: primeiro + último ("Maria da Silva" → "maria.silva")
  function sugerir(nome) {
    const partes = normalizar(nome).split('.').filter(Boolean);
    if (!partes.length) return '';
    return partes.length === 1 ? partes[0] : partes[0] + '.' + partes[partes.length - 1];
  }

  function iniciais(nome) {
    const p = String(nome || '').trim().split(/\s+/).filter(Boolean);
    if (!p.length) return '?';
    return ((p[0][0] || '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }

  /* ------------------------------------------------------------------ */
  /* Senha: SHA-256 salgado (fallback FNV-1a dupla sem WebCrypto)         */
  /* ------------------------------------------------------------------ */
  function salt() {
    const a = new Uint8Array(12);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
    else for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 256) | 0;
    return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
  }

  function fnv(txt) {
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < txt.length; i++) {
      const c = txt.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
      h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
    }
    return 'fnv:' + h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  }

  // algo: 'sha256' | 'fnv' — na verificação usa-se o mesmo algoritmo do hash guardado
  async function hash(senha, sal, algo) {
    const txt = sal + ':' + senha;
    if (algo !== 'fnv') {
      try {
        if (window.crypto && crypto.subtle) {
          const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
          return 'sha256:' + Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
        }
      } catch (_) { /* cai no fallback */ }
    }
    return fnv(txt);
  }

  /* ------------------------------------------------------------------ */
  /* Tabela de usuários                                                  */
  /* ------------------------------------------------------------------ */
  function ler() {
    try {
      const a = JSON.parse(localStorage.getItem(KEY_USUARIOS) || '[]');
      return Array.isArray(a) ? a : [];
    } catch (_) { return []; }
  }
  function gravar(lista) { try { localStorage.setItem(KEY_USUARIOS, JSON.stringify(lista)); } catch (_) {} }
  function mexeu()       { try { localStorage.removeItem(KEY_SEED); } catch (_) {} }
  function seedIntacto() { try { return localStorage.getItem(KEY_SEED) === '1'; } catch (_) { return false; } }
  function publico(u)    { return { usuario: u.usuario, nome: u.nome, perfil: u.perfil, criadoEm: u.criadoEm }; }

  async function novoRegistro(usuario, nome, perfil, senha) {
    const sal = salt();
    return {
      usuario, nome: String(nome || '').trim() || usuario,
      perfil: perfil === 'operador' ? 'operador' : 'admin',
      salt: sal, hash: await hash(senha, sal), criadoEm: new Date().toISOString(),
    };
  }

  // roda uma vez por navegador. Migra o usuário único da versão antiga
  // (e-mail + senha em texto puro em 'fz-user') se ele tinha sido personalizado.
  async function garantirSeed() {
    let existe = false;
    try { existe = !!localStorage.getItem(KEY_USUARIOS); } catch (_) { return; }
    if (existe) return;
    const lista = [];
    for (const u of SEED) lista.push(await novoRegistro(u.usuario, u.nome, u.perfil, SENHA_INICIAL));
    try {
      const antigo = JSON.parse(localStorage.getItem('fz-user') || 'null');
      if (antigo && antigo.email && antigo.email !== 'admin@forzy.com') {
        const usuario = normalizar(antigo.email.split('@')[0]) || 'admin';
        if (!lista.some(x => x.usuario === usuario)) {
          lista.push(await novoRegistro(usuario, antigo.nome, 'admin', antigo.senha || SENHA_INICIAL));
        }
      }
    } catch (_) {}
    try { localStorage.removeItem('fz-user'); localStorage.removeItem('fz-logged'); } catch (_) {}
    gravar(lista);
    try { localStorage.setItem(KEY_SEED, '1'); } catch (_) {}
  }

  /* ------------------------------------------------------------------ */
  /* Sessão                                                              */
  /* ------------------------------------------------------------------ */
  function lerSessao() {
    for (const st of [localStorage, sessionStorage]) {
      try {
        const s = JSON.parse(st.getItem(KEY_SESSAO) || 'null');
        if (s && s.usuario && (!s.exp || s.exp > Date.now())) return s;
      } catch (_) {}
    }
    return null;
  }
  function gravarSessao(usuario, manter) {
    limparSessao();
    const s = JSON.stringify({ usuario, exp: manter ? Date.now() + DIAS_SESSAO * 864e5 : null, desde: new Date().toISOString() });
    try { (manter ? localStorage : sessionStorage).setItem(KEY_SESSAO, s); } catch (_) {}
  }
  function limparSessao() {
    try { localStorage.removeItem(KEY_SESSAO); } catch (_) {}
    try { sessionStorage.removeItem(KEY_SESSAO); } catch (_) {}
  }

  function usuarioAtual() {
    const s = lerSessao();
    if (!s) return null;
    const u = ler().find(x => x.usuario === s.usuario);
    return u ? publico(u) : null;
  }
  const logado   = () => !!usuarioAtual();
  const souAdmin = () => { const u = usuarioAtual(); return !!u && u.perfil === 'admin'; };

  // conta Operador não escolhe visão: força o perfil e esconde a chavinha (CSS
  // em body.fz-conta-operador). Conta Analista mantém a visão que escolheu,
  // exceto no login (forcar=true), quando volta pra visão da própria conta.
  function aplicarConta(forcar) {
    const u = usuarioAtual();
    const op = !!u && u.perfil === 'operador';
    if (document.body) document.body.classList.toggle('fz-conta-operador', op);
    if (u && window.FZPerfil && (forcar || op) && window.FZPerfil.get() !== u.perfil) window.FZPerfil.set(u.perfil);
    if (u) document.documentElement.classList.remove('fz-sem-sessao');
  }
  function notificar() {
    document.dispatchEvent(new CustomEvent('fz-auth-change', { detail: { usuario: usuarioAtual() } }));
  }

  /* ------------------------------------------------------------------ */
  /* Entrar / sair                                                       */
  /* ------------------------------------------------------------------ */
  async function entrar(usuario, senha, manter) {
    await pronto;
    usuario = normalizar(usuario);
    const u = ler().find(x => x.usuario === usuario);
    // compara mesmo sem usuário e não diz qual dos dois errou
    const alvo = u || { salt: 'x', hash: 'sha256:' };
    const h = await hash(String(senha || ''), alvo.salt, alvo.hash.split(':')[0]);
    if (!u || h !== u.hash) return { ok: false, erro: 'Usuário ou senha incorretos.' };
    gravarSessao(u.usuario, !!manter);
    aplicarConta(true);
    return { ok: true, usuario: publico(u) };
  }

  function sair() {
    limparSessao();
    aplicarConta(false);
    if (window.showLogin) window.showLogin();
    const inUser  = document.getElementById('login-user');
    const inSenha = document.getElementById('login-password');
    if (inSenha) inSenha.value = '';
    if (inUser) { inUser.value = ''; setTimeout(() => inUser.focus(), 50); }
    notificar();
  }

  /* ------------------------------------------------------------------ */
  /* Gestão (só Analista) e perfil próprio                               */
  /* ------------------------------------------------------------------ */
  const SO_ADMIN = { ok: false, erro: 'Só um analista pode gerenciar usuários.' };

  async function criarUsuario({ usuario, nome, perfil, senha }) {
    if (!souAdmin()) return SO_ADMIN;
    usuario = normalizar(usuario) || sugerir(nome);   // campo vazio → deriva do nome
    if (usuario.length < 3) return { ok: false, erro: 'Usuário precisa de pelo menos 3 caracteres (ex.: joao.franco).' };
    if (!senha || senha.length < 4) return { ok: false, erro: 'Senha precisa de pelo menos 4 caracteres.' };
    const lista = ler();
    if (lista.some(x => x.usuario === usuario)) return { ok: false, erro: 'Já existe o usuário "' + usuario + '".' };
    lista.push(await novoRegistro(usuario, nome, perfil, senha));
    gravar(lista); mexeu(); notificar();
    return { ok: true, usuario };
  }

  function removerUsuario(usuario) {
    if (!souAdmin()) return SO_ADMIN;
    const eu = usuarioAtual();
    if (eu && eu.usuario === usuario) return { ok: false, erro: 'Você não pode remover o próprio usuário.' };
    const lista = ler();
    const i = lista.findIndex(x => x.usuario === usuario);
    if (i === -1) return { ok: false, erro: 'Usuário não encontrado.' };
    lista.splice(i, 1);
    gravar(lista); mexeu(); notificar();
    return { ok: true };
  }

  async function redefinirSenha(usuario, senha) {
    if (!souAdmin()) return SO_ADMIN;
    if (!senha || senha.length < 4) return { ok: false, erro: 'Senha precisa de pelo menos 4 caracteres.' };
    const lista = ler();
    const u = lista.find(x => x.usuario === usuario);
    if (!u) return { ok: false, erro: 'Usuário não encontrado.' };
    u.salt = salt(); u.hash = await hash(senha, u.salt);
    gravar(lista); mexeu(); notificar();
    return { ok: true };
  }

  async function alterarPropria({ nome, senhaAtual, novaSenha }) {
    const eu = usuarioAtual();
    if (!eu) return { ok: false, erro: 'Sessão expirada. Entre de novo.' };
    const lista = ler();
    const u = lista.find(x => x.usuario === eu.usuario);
    if (!u) return { ok: false, erro: 'Usuário não encontrado.' };
    if (nome != null && String(nome).trim()) u.nome = String(nome).trim();
    if (novaSenha) {
      if (novaSenha.length < 4) return { ok: false, erro: 'Nova senha precisa de pelo menos 4 caracteres.' };
      const h = await hash(String(senhaAtual || ''), u.salt, u.hash.split(':')[0]);
      if (h !== u.hash) return { ok: false, erro: 'Senha atual incorreta.' };
      u.salt = salt(); u.hash = await hash(novaSenha, u.salt);
    }
    gravar(lista); mexeu(); notificar();
    return { ok: true };
  }

  /* ------------------------------------------------------------------ */
  /* Modais (reaproveitam #fz-profile-modal / #fz-profile-box do topbar) */
  /* ------------------------------------------------------------------ */
  function modal(html, largo) {
    const velho = document.getElementById('fz-profile-modal');
    if (velho) velho.remove();
    const m = document.createElement('div');
    m.id = 'fz-profile-modal';
    m.innerHTML = '<div id="fz-profile-box" class="' + (largo ? 'fz-auth-wide' : '') + '">' + html + '</div>';
    document.body.appendChild(m);
    const x = m.querySelector('.fz-auth-close');
    if (x) x.addEventListener('click', () => m.remove());
    m.addEventListener('click', e => { if (e.target === m) m.remove(); });
    return m;
  }
  const cab = t => '<div class="fz-auth-head"><strong>' + esc(t) + '</strong><button class="fz-auth-close" title="Fechar">✕</button></div>';
  function setMsg(el, txt, tipo) {
    if (!el) return;
    el.textContent = txt || '';
    el.className = 'fz-auth-msg' + (tipo ? ' is-' + tipo : '');
  }

  function abrirEditarPerfil() {
    const eu = usuarioAtual();
    if (!eu) return;
    const m = modal(cab('Meu perfil') + `
      <div class="fz-auth-quem">
        <span class="fz-auth-avatar">${esc(iniciais(eu.nome))}</span>
        <div><b>${esc(eu.nome)}</b><small>@${esc(eu.usuario)} · ${esc(rotuloPerfil(eu.perfil))}</small></div>
      </div>
      <label class="fz-auth-lbl" for="fz-pf-nome">Nome</label>
      <input id="fz-pf-nome" value="${esc(eu.nome)}" placeholder="Seu nome">
      <label class="fz-auth-lbl" for="fz-pf-atual">Senha atual</label>
      <input id="fz-pf-atual" type="password" placeholder="Só para trocar a senha" autocomplete="current-password">
      <label class="fz-auth-lbl" for="fz-pf-nova">Nova senha</label>
      <input id="fz-pf-nova" type="password" placeholder="Deixe em branco para manter" autocomplete="new-password">
      <div class="fz-auth-msg" id="fz-pf-msg"></div>
      <button class="fz-auth-btn" id="fz-pf-save">Salvar</button>`);
    const btn = m.querySelector('#fz-pf-save');
    btn.onclick = async () => {
      btn.disabled = true;
      const r = await alterarPropria({
        nome:       m.querySelector('#fz-pf-nome').value,
        senhaAtual: m.querySelector('#fz-pf-atual').value,
        novaSenha:  m.querySelector('#fz-pf-nova').value,
      });
      btn.disabled = false;
      if (!r.ok) { setMsg(m.querySelector('#fz-pf-msg'), r.erro, 'erro'); return; }
      m.remove();
    };
  }

  function abrirUsuarios() {
    if (!souAdmin()) return;
    const m = modal(cab('Usuários') + `
      <div class="fz-auth-lista" id="fz-au-lista"></div>
      <div class="fz-auth-sub">Novo usuário</div>
      <div class="fz-auth-form">
        <div><label class="fz-auth-lbl" for="fz-au-nome">Nome</label><input id="fz-au-nome" placeholder="Maria Silva"></div>
        <div><label class="fz-auth-lbl" for="fz-au-usuario">Usuário</label><input id="fz-au-usuario" placeholder="maria.silva" autocapitalize="none" spellcheck="false"></div>
        <div><label class="fz-auth-lbl" for="fz-au-perfil">Perfil</label>
          <select id="fz-au-perfil"><option value="operador">Operador</option><option value="admin">Analista</option></select></div>
        <div><label class="fz-auth-lbl" for="fz-au-senha">Senha</label><input id="fz-au-senha" type="password" placeholder="mín. 4 caracteres" autocomplete="new-password"></div>
      </div>
      <div class="fz-auth-msg" id="fz-au-msg"></div>
      <button class="fz-auth-btn" id="fz-au-add">Adicionar usuário</button>`, true);

    const host = m.querySelector('#fz-au-lista');
    const msg  = m.querySelector('#fz-au-msg');
    const nome = m.querySelector('#fz-au-nome');
    const usu  = m.querySelector('#fz-au-usuario');

    // o campo Usuário se preenche sozinho a partir do nome até a pessoa mexer nele
    let usuarioEditado = false;
    usu.addEventListener('input', () => { usuarioEditado = !!usu.value; });
    usu.addEventListener('blur',  () => { usu.value = normalizar(usu.value); });
    nome.addEventListener('input', () => { if (!usuarioEditado) usu.value = sugerir(nome.value); });

    function render() {
      const eu = usuarioAtual();
      host.innerHTML = ler().map(u => `
        <div class="fz-auth-row" data-u="${esc(u.usuario)}">
          <span class="fz-auth-avatar">${esc(iniciais(u.nome))}</span>
          <div class="fz-auth-who"><b>${esc(u.nome)}</b><small>@${esc(u.usuario)}</small></div>
          <span class="fz-auth-badge ${esc(u.perfil)}">${esc(rotuloPerfil(u.perfil))}</span>
          <div class="fz-auth-acoes">
            <button data-act="senha" title="Definir nova senha">Senha</button>
            ${eu && eu.usuario === u.usuario
              ? '<span class="fz-auth-eu">você</span>'
              : '<button data-act="remover" title="Remover usuário">Remover</button>'}
          </div>
          <div class="fz-auth-inline" hidden>
            <input type="password" placeholder="Nova senha para @${esc(u.usuario)}" autocomplete="new-password">
            <button data-act="ok">Salvar</button><button data-act="cancel">Cancelar</button>
          </div>
        </div>`).join('') || '<div class="fz-auth-msg">Nenhum usuário.</div>';
    }

    host.addEventListener('click', async e => {
      const b = e.target.closest('button[data-act]');
      if (!b) return;
      const row = b.closest('.fz-auth-row');
      if (!row) return;
      const usuario = row.dataset.u;
      const inline  = row.querySelector('.fz-auth-inline');
      if (b.dataset.act === 'senha')  { inline.hidden = false; inline.querySelector('input').focus(); return; }
      if (b.dataset.act === 'cancel') { inline.hidden = true; return; }
      if (b.dataset.act === 'ok') {
        const r = await redefinirSenha(usuario, inline.querySelector('input').value);
        setMsg(msg, r.ok ? 'Senha de @' + usuario + ' redefinida.' : r.erro, r.ok ? 'ok' : 'erro');
        if (r.ok) inline.hidden = true;
        return;
      }
      if (b.dataset.act === 'remover') {
        if (!window.confirm('Remover o usuário @' + usuario + '?')) return;
        const r = removerUsuario(usuario);
        setMsg(msg, r.ok ? 'Usuário @' + usuario + ' removido.' : r.erro, r.ok ? 'ok' : 'erro');
        render();
      }
    });

    const add = m.querySelector('#fz-au-add');
    add.onclick = async () => {
      add.disabled = true;
      const r = await criarUsuario({
        nome: nome.value, usuario: usu.value,
        perfil: m.querySelector('#fz-au-perfil').value,
        senha: m.querySelector('#fz-au-senha').value,
      });
      add.disabled = false;
      if (!r.ok) { setMsg(msg, r.erro, 'erro'); return; }
      nome.value = ''; usu.value = ''; usuarioEditado = false;
      m.querySelector('#fz-au-senha').value = '';
      setMsg(msg, 'Usuário @' + r.usuario + ' criado.', 'ok');
      render();
    };

    render();
  }

  /* ------------------------------------------------------------------ */
  /* Tela de login                                                       */
  /* ------------------------------------------------------------------ */
  function wireLogin() {
    const btn = document.getElementById('doLogin');
    if (!btn) return;
    const inUser  = document.getElementById('login-user');
    const inSenha = document.getElementById('login-password');
    const erro    = document.getElementById('login-error');
    const hint    = document.getElementById('login-hint');

    const msg = (t, tipo) => {
      if (!erro) return;
      erro.textContent = t || '';
      erro.style.display = t ? 'block' : 'none';
      erro.classList.toggle('is-info', tipo === 'info');
    };

    // dica de primeiro acesso: só enquanto a tabela de usuários é a de fábrica
    function atualizarHint() { if (hint) hint.hidden = !seedIntacto(); }
    pronto.then(atualizarHint);
    document.addEventListener('fz-auth-change', atualizarHint);

    async function tentar() {
      const usuario = normalizar(inUser && inUser.value);
      const senha   = (inSenha && inSenha.value) || '';
      if (!usuario || !senha) { msg('Informe usuário e senha.'); return; }
      const rotulo = btn.textContent;
      btn.disabled = true; btn.textContent = 'Entrando…';
      let r;
      try { r = await entrar(usuario, senha, !!(document.getElementById('login-remember') || {}).checked); }
      catch (_) { r = { ok: false, erro: 'Erro ao autenticar.' }; }
      btn.disabled = false; btn.textContent = rotulo;
      if (!r.ok) {
        msg(r.erro);
        if (inSenha) { inSenha.value = ''; inSenha.focus(); }
        return;
      }
      msg('');
      if (inSenha) inSenha.value = '';
      if (window.showScreen) window.showScreen('inicio');
      notificar();   // depois da troca de tela: o modal P1 pendente volta a aparecer
    }

    btn.addEventListener('click', tentar);
    [inUser, inSenha].forEach(el => el && el.addEventListener('keydown', e => { if (e.key === 'Enter') tentar(); }));
    if (inUser) inUser.addEventListener('blur', () => { inUser.value = normalizar(inUser.value); });

    const forgot = document.getElementById('login-forgot');
    if (forgot) forgot.addEventListener('click', e => {
      e.preventDefault();
      msg('Não há e-mail de recuperação: peça a um analista para redefinir sua senha em Conta › Usuários.', 'info');
    });

    const loginAtivo = document.getElementById('screen-login');
    if (inUser && loginAtivo && loginAtivo.classList.contains('active')) setTimeout(() => inUser.focus(), 80);
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                */
  /* ------------------------------------------------------------------ */
  const pronto = garantirSeed();

  window.FZAuth = {
    logado, usuarioAtual, usuarios: () => ler().map(publico),
    entrar, sair, criarUsuario, removerUsuario, redefinirSenha, alterarPropria,
    abrirEditarPerfil, abrirUsuarios, normalizar, sugerir, seedIntacto, esc,
  };

  function boot() { aplicarConta(false); wireLogin(); }
  if (document.body && document.getElementById('doLogin')) boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
