/* ===================================================================
   FORZY · AUDIT — trilha de auditoria append-only
   localStorage['forzy-audit'] (cap 500). Exposto: window.FZAudit.
   Portado de forzy-notify.js (só a metade da trilha; a parte de
   pop-up/toast do original ficou de fora — o CLONE já tem
   alerta-critico.js / alert-rail.js pra isso). Sem libs.
   =================================================================== */
(function () {
  const K = 'forzy-audit';
  const CAP = 500;

  function load() { try { return JSON.parse(localStorage.getItem(K) || '[]'); } catch (e) { return []; } }
  function persist(l) { try { localStorage.setItem(K, JSON.stringify(l.slice(0, CAP))); } catch (e) { /* noop */ } }

  function sessao() {
    try {
      const u = (window.FZAuth && (typeof window.FZAuth.usuarioAtual === 'function'
        ? window.FZAuth.usuarioAtual() : window.FZAuth.usuarioAtual)) || {};
      return { email: u.usuario || u.email, papel: u.perfil || u.papel };
    } catch (e) { return {}; }
  }
  function traceId() { return 'TRC-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  const _subs = [];
  function push(entry) {
    entry = entry || {};
    const s = sessao();
    const rec = {
      ts: new Date().toISOString(),
      trace: entry.trace || traceId(),
      tipo: entry.tipo || 'evento',
      ator: entry.ator || s.email || 'sistema',
      papel: entry.papel || s.papel || '—',
      ativo: entry.ativo || '—',
      detalhe: entry.detalhe || '',
      resultado: entry.resultado || '',
    };
    const l = load(); l.unshift(rec); persist(l);
    _subs.forEach(cb => { try { cb(rec); } catch (e) { /* noop */ } });
    return rec;
  }

  window.FZAudit = {
    push, list: () => load(),
    onEntry: cb => { if (typeof cb === 'function') _subs.push(cb); },
    exportCSV() {
      const l = load();
      let csv = 'timestamp,trace,tipo,ator,papel,ativo,detalhe,resultado\n';
      l.forEach(e => {
        csv += [e.ts, e.trace, e.tipo, e.ator, e.papel, e.ativo,
          '"' + String(e.detalhe).replace(/"/g, '""') + '"',
          '"' + String(e.resultado).replace(/"/g, '""') + '"'].join(',') + '\n';
      });
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'trilha_forzy_' + new Date().toISOString().slice(0, 10) + '.csv';
      a.click(); URL.revokeObjectURL(a.href);
    },
  };
})();
