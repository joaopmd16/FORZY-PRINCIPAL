/* ===================================================================
   PROJETO FORZY - Sistema de Monitoramento Industrial
   Trabalho academico FIAP + Forzy-Promon

   Integrantes:
   - Arthur Baptista dos Santos       (RM 565346)
   - Joao Pedro de Moura Dutra Franco (RM 561738)
   - Nelson Felix Neto                (RM 565603)
   - Pietro Boroto Rodrigues          (RM 562407)
   - Vitor Soares Goncalves           (RM 566181)

   Arquivo: alert-rail.js
   O que faz: coluna de alertas do lado direito da tela
   =================================================================== */

(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const COLLAPSE_KEY = 'fz-rail-collapsed';
  let host = null;
  let abertoChave = null;
  let verHistorico = false;

  const ehOperador = () => !!(window.FZPerfil && window.FZPerfil.isOperador());

  function eixoInfo(a) {
    const s = String(a.eixo || a.msg || '').toLowerCase();
    if (s.includes('m2') || s.includes('eixo 2')) return { id: 'm2', nome: 'Eixo 2', cod: 'BBA-002' };
    if (s.includes('m1') || s.includes('eixo 1')) return { id: 'm1', nome: 'Eixo 1', cod: 'BBA-001' };
    return { id: 'm1', nome: 'Eixo 1', cod: 'BBA-001' };
  }

  function resumo(a) {
    const e = eixoInfo(a);
    const temp = String(a.variavel || a.titulo || '').toLowerCase().includes('temp');
    const critico = String(a.prioridade).indexOf('P1') === 0;
    if (temp) return `${e.nome} esquentando${critico ? ' demais' : ''}`;
    return `${e.nome} vibrando${critico ? ' muito' : ' acima do normal'}`;
  }

  const ACOES = [
    {
      id: 'scada', icone: 'box', rotulo: 'Ver na Vista 3D',
      dica: 'Abre o motor em 3D com os valores do alarme',
      run(a) {
        const e = eixoInfo(a);
        if (window.FZScada && window.FZScada.show3D) window.FZScada.show3D(e.id);
        else if (window.showScreen) window.showScreen('scada');
      },
    },
    {
      id: 'mon', icone: 'activity', rotulo: 'Abrir no Monitoramento',
      dica: 'Gráficos e gauges da fonte que gerou o alarme',
      soAdmin: true,
      run() {
        if (window.showScreen) window.showScreen('dashboard');
        document.querySelector('#fzTabs .fz-tab[data-tab="mon"]')?.click();
      },
    },
    {
      id: 'ia', icone: 'bot', rotulo: 'Perguntar ao Assistente',
      dica: 'Manda o alarme pra IA explicar a causa provável',
      run(a) {
        if (window.FZAssistente && window.FZAssistente.abrirComContexto) {
          window.FZAssistente.abrirComContexto(a);
        } else if (window.showScreen) window.showScreen('assistente');
      },
    },
    {
      id: 'os', icone: 'wrench', rotulo: 'Gerar Ordem de Serviço',
      dica: 'Diagnóstico do eixo + OS pronta pra imprimir',
      run(a) {
        const e = eixoInfo(a);
        if (window.FZCopiloto && window.FZCopiloto.abrirPara) window.FZCopiloto.abrirPara(e.id, e.cod);
        else if (window.showScreen) window.showScreen('assistente');
      },
    },
  ];

  function render(alertas, historico) {
    if (!host) return;
    alertas = alertas || [];
    historico = historico || [];

    const op = ehOperador();
    const ehP1 = a => String(a.prioridade).indexOf('P1') === 0;
    const criticos = alertas.filter(ehP1).length;

    const ordenados = alertas.slice().sort((a, b) => (ehP1(b) ? 1 : 0) - (ehP1(a) ? 1 : 0));

    const itens = ordenados.length ? ordenados.map(a => item(a, op)).join('') : `
      <div class="fz-rail-vazio">
        <span class="fz-rail-vazio-ic">✓</span>
        <b>Tudo normal</b>
        <span>Nenhum alarme ativo agora.</span>
      </div>`;

    const hist = !op ? `
      <div class="fz-rail-hist">
        <button class="fz-rail-hist-h" data-act="toggle-hist">
          <span>Histórico de eventos</span>
          <span class="fz-rail-chev ${verHistorico ? 'open' : ''}">▾</span>
        </button>
        ${verHistorico ? (historico.length ? `
          <div class="fz-rail-hist-body">
            ${historico.slice(0, 25).map(h => `
              <div class="fz-rail-hev ${h.status === 'ATIVADO' ? 'on' : 'off'}">
                <span class="fz-rail-hev-t">${esc(new Date(h.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))}</span>
                <span class="fz-rail-hev-m">${esc(h.ativo)} · ${esc(h.variavel === 'vel' ? 'vibração' : 'temp.')} ${esc(Number(h.valor).toFixed(h.variavel === 'vel' ? 2 : 1))} ${esc(h.unidade)}</span>
                <span class="fz-rail-hev-s">${h.status === 'ATIVADO' ? 'disparou' : 'normalizou'}</span>
              </div>`).join('')}
          </div>
          <button class="fz-rail-csv" data-act="csv">Exportar CSV do log</button>`
          : '<div class="fz-rail-hist-body fz-rail-sub">Nenhum evento registrado ainda.</div>') : ''}
      </div>` : '';

    host.innerHTML = `
      <div class="fz-rail-head">
        <div class="fz-rail-tit">
          <span class="fz-rail-ic ${criticos ? 'crit' : alertas.length ? 'warn' : 'ok'}"></span>
          <b>Alertas</b>
          ${alertas.length ? `<span class="fz-rail-count ${criticos ? 'crit' : 'warn'}">${alertas.length}</span>` : ''}
        </div>
        ${alertas.length ? '<button class="fz-rail-limpar" data-act="limpar" title="Reconhecer todos">Limpar</button>' : ''}
      </div>
      <div class="fz-rail-sub-head">${op ? 'Toque num alerta para ver o que fazer' : 'Clique num alerta para abrir as ações'}</div>
      <div class="fz-rail-list">${itens}</div>
      ${hist}`;

    wire();
  }

  function item(a, op) {
    const crit = String(a.prioridade).indexOf('P1') === 0;
    const aberto = abertoChave === a.chave;
    const acoes = ACOES.filter(x => !(op && x.soAdmin));

    return `
      <div class="fz-rail-item ${crit ? 'crit' : 'warn'} ${aberto ? 'aberto' : ''}" data-chave="${esc(a.chave)}">
        <button class="fz-rail-item-h" data-act="abrir" data-chave="${esc(a.chave)}">
          <span class="fz-rail-pri">${crit ? 'PARE' : 'ATENÇÃO'}</span>
          <span class="fz-rail-hora">${esc(a.hora)}</span>
          <span class="fz-rail-tit-2">${esc(op ? resumo(a) : a.titulo)}</span>
          <span class="fz-rail-msg">${esc(op ? (a.valor != null ? `Medido: ${Number(a.valor).toFixed(2)} ${a.unidade || ''}` : '') : a.msg)}</span>
        </button>
        ${aberto ? `
          <div class="fz-rail-acoes">
            <div class="fz-rail-acoes-lbl">O que fazer</div>
            ${acoes.map(x => `
              <button class="fz-rail-acao" data-act="acao" data-id="${x.id}" data-chave="${esc(a.chave)}">
                <b>${esc(x.rotulo)}</b>
                ${op ? '' : `<span>${esc(x.dica)}</span>`}
              </button>`).join('')}
            <button class="fz-rail-acao ok" data-act="ok" data-chave="${esc(a.chave)}">
              <b>Reconhecer alarme</b>
            </button>
          </div>` : ''}
      </div>`;
  }

  function wire() {
    host.querySelectorAll('[data-act="abrir"]').forEach(b => b.addEventListener('click', () => {
      abertoChave = abertoChave === b.dataset.chave ? null : b.dataset.chave;
      refresh();
    }));
    host.querySelectorAll('[data-act="acao"]').forEach(b => b.addEventListener('click', () => {
      const a = (window.FZAlertas?.ativos() || []).find(x => x.chave === b.dataset.chave);
      const acao = ACOES.find(x => x.id === b.dataset.id);
      if (a && acao) acao.run(a);
    }));
    host.querySelectorAll('[data-act="ok"]').forEach(b => b.addEventListener('click', () => {
      abertoChave = null;
      window.FZAlertas?.reconhecer(b.dataset.chave);
    }));
    host.querySelector('[data-act="limpar"]')?.addEventListener('click', () => {
      abertoChave = null;
      window.FZAlertas?.limparTodos();
    });
    host.querySelector('[data-act="toggle-hist"]')?.addEventListener('click', () => {
      verHistorico = !verHistorico; refresh();
    });
    host.querySelector('[data-act="csv"]')?.addEventListener('click', () => window.FZAlertas?.exportarCSV());
  }

  function refresh() {
    render(window.FZAlertas?.ativos() || [], window.FZAlertas?.historico() || []);
  }

  function init() {
    host = document.getElementById('fzAlertRailBody');
    if (!host) return;

    const shell = document.getElementById('app-shell');
    const btn = document.getElementById('fzRailToggle');
    if (btn && shell) {
      let recolhido = false;
      try { recolhido = localStorage.getItem(COLLAPSE_KEY) === '1'; } catch (_) {}
      const aplicar = () => {
        shell.classList.toggle('rail-collapsed', recolhido);
        btn.textContent = recolhido ? '‹' : '›';
        btn.title = recolhido ? 'Mostrar alertas' : 'Recolher painel de alertas';
      };
      aplicar();
      btn.addEventListener('click', () => {
        recolhido = !recolhido;
        try { localStorage.setItem(COLLAPSE_KEY, recolhido ? '1' : '0'); } catch (_) {}
        aplicar();
      });
    }

    if (window.FZAlertas) window.FZAlertas.onChange(render);
    else refresh();
    document.addEventListener('fz-perfil-change', refresh);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
