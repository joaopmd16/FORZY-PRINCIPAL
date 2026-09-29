/* ===================================================================
   PROJETO FORZY - Sistema de Monitoramento Industrial
   Trabalho academico FIAP + Forzy-Promon

   Integrantes:
   - Arthur Baptista dos Santos       (RM 565346)
   - Joao Pedro de Moura Dutra Franco (RM 561738)
   - Nelson Felix Neto                (RM 565603)
   - Pietro Boroto Rodrigues          (RM 562407)
   - Vitor Soares Goncalves           (RM 566181)

   Arquivo: preditivo.js
   O que faz: sub-aba de Projecao (estimativa de quando pode dar falha)
   =================================================================== */

(function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (v, d = 2) => (v == null || v !== v) ? '—' : Number(v).toFixed(d);

  let _root = null, _win = 30;

  function ativos() {
    try { return (window.FZStore && window.FZStore.getAtivosIndustrial()) || []; } catch (e) { return []; }
  }

  function projetar(eixo) {
    const F = window.FORZY;
    if (!F || !F[eixo]) return null;
    const vel = F[eixo].vel, t = F.t || null, n = vel.length;
    const tEnd = t ? t[n - 1] : n;
    const janelaSeg = _win * 60;
    let i0 = 0;
    if (t) { for (let i = n - 1; i >= 0; i--) { if (tEnd - t[i] > janelaSeg) { i0 = i + 1; break; } } }
    else i0 = Math.max(0, n - Math.round(janelaSeg));
    const seg = vel.slice(i0), ts = (t ? t.slice(i0) : seg.map((_, k) => i0 + k));
    const w = seg.length;
    if (w < 4) return null;
    const x0 = ts[0];
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (let k = 0; k < w; k++) { const x = ts[k] - x0; sx += x; sy += seg[k]; sxy += x * seg[k]; sxx += x * x; }
    const denom = (w * sxx - sx * sx) || 1;
    const slopePerSec = (w * sxy - sx * sy) / denom;
    const atual = seg[w - 1];
    const slopePerHora = slopePerSec * 3600;

    const LIM = window.FZCopiloto.LIM;
    function diasAte(alvo) {
      if (atual >= alvo) return { txt: 'já acima', v: 0 };
      if (slopePerSec <= 1e-9) return { txt: 'tendência estável ou de melhora', v: Infinity };
      const seg = (alvo - atual) / slopePerSec;
      const d = seg / 86400;
      return { txt: d > 60 ? '> 60 dias' : d >= 2 ? `~${d.toFixed(1)} dias` : d >= 1 ? '~1 dia' : `~${Math.max(1, Math.round(d * 24))} h`, v: d };
    }

    const last = n - 1;
    const zmax = Math.max(
      window.FZCopiloto.zscore(eixo + '_vel', F[eixo].vel[last]),
      window.FZCopiloto.zscore(eixo + '_acel', F[eixo].acel[last]),
      window.FZCopiloto.zscore(eixo + '_temp', F[eixo].temp[last]),
    );
    const anom = zmax >= 3 ? 'Anomalia' : zmax >= 2 ? 'Atenção' : 'Normal';

    const reading = {
      m1_vel: F.m1.vel[last], m1_acel: F.m1.acel[last], m1_temp: F.m1.temp[last],
      m2_vel: F.m2.vel[last], m2_acel: F.m2.acel[last], m2_temp: F.m2.temp[last],
    };
    const diag = window.FZCopiloto.diagnosticar(reading, eixo);

    return {
      eixo, atual, slopePerHora,
      ateAtencao: diasAte(LIM.vel.a), ateAlarme: diasAte(LIM.vel.al),
      zmax, anom, motivo: diag.modo, causa: diag.causa, prioridade: diag.prioridade,
      serie: seg, i0, n,
    };
  }

  function sparkProj(p) {
    if (!p) return '';
    const LIM = window.FZCopiloto.LIM;
    const arr = p.serie.slice(-120);
    const mx = Math.max(LIM.vel.al * 1.15, ...arr) || 1;
    const w = 520, h = 120, pad = 4;
    const X = i => pad + i / (arr.length - 1) * (w - pad * 2);
    const Y = v => h - pad - v / mx * (h - pad * 2);
    const line = arr.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');

    const lastX = arr.length - 1, projSpanSec = 1800;
    const slopePerSec = p.slopePerHora / 3600;
    const projEnd = p.atual + slopePerSec * projSpanSec;
    const px1 = X(lastX), py1 = Y(p.atual);
    const px2 = w - pad, py2 = Y(Math.max(0, projEnd));
    return `<svg class="fz-pr-chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <line x1="0" x2="${w}" y1="${Y(LIM.vel.a).toFixed(1)}" y2="${Y(LIM.vel.a).toFixed(1)}" class="fz-pr-lim-a"/>
      <line x1="0" x2="${w}" y1="${Y(LIM.vel.al).toFixed(1)}" y2="${Y(LIM.vel.al).toFixed(1)}" class="fz-pr-lim-al"/>
      <polyline points="${line}" class="fz-pr-line"/>
      <line x1="${px1.toFixed(1)}" y1="${py1.toFixed(1)}" x2="${px2.toFixed(1)}" y2="${py2.toFixed(1)}" class="fz-pr-proj"/>
    </svg>`;
  }

  function riscoScore(p) {
    if (!p) return 0;
    const LIM = window.FZCopiloto.LIM;
    const nivel = Math.min(1, p.atual / LIM.vel.al);
    const tend = p.slopePerHora > 0 ? Math.min(1, p.slopePerHora / 0.5) : 0;
    const an = Math.min(1, p.zmax / 3);
    return Math.round((nivel * 0.45 + tend * 0.35 + an * 0.20) * 100);
  }

  function render() {
    if (!_root) return;
    if (!window.FORZY) { _root.innerHTML = '<div class="fz-card">Dataset não carregado.</div>'; return; }
    const p1 = projetar('m1'), p2 = projetar('m2');
    const list = ativos();
    const semChave = !window.FORZY_OPENAI_KEY;

    const cardEixo = (p, nome) => {
      if (!p) return `<div class="fz-card"><div class="fz-card-title">${nome}</div><p class="fz-cop-sub">Janela insuficiente.</p></div>`;
      const cor = p.prioridade === 'P1' ? 'var(--fz-bad)' : p.prioridade === 'P2' ? 'var(--fz-warn)' : 'var(--fz-ok)';
      const anCor = p.anom === 'Anomalia' ? 'var(--fz-bad)' : p.anom === 'Atenção' ? 'var(--fz-warn)' : 'var(--fz-ok)';
      return `<div class="fz-card fz-pr-card">
        <div class="fz-pr-head">
          <div class="fz-card-title">${nome}</div>
          <span class="fz-cop-tag" style="background:${anCor}22;color:${anCor};border:1px solid ${anCor}">${p.anom}</span>
        </div>
        <div class="fz-pr-kpis">
          <div><span>Vibração atual</span><b>${fmt(p.atual)} <i>mm/s</i></b></div>
          <div><span>Tendência</span><b>${p.slopePerHora >= 0 ? '+' : ''}${fmt(p.slopePerHora, 3)} <i>mm/s por hora</i></b></div>
          <div><span>Anomalia (Z-score)</span><b>${fmt(p.zmax, 1)}</b></div>
        </div>
        ${sparkProj(p)}
        <div class="fz-pr-proj-row">
          <div><span>Projeção até o nível de atenção (1,8 mm/s)</span><b>${esc(p.ateAtencao.txt)}</b></div>
          <div><span>Projeção até o nível de alarme (4,5 mm/s)</span><b style="color:${cor}">${esc(p.ateAlarme.txt)}</b></div>
        </div>
        <div class="fz-cop-os-sec fz-cop-sub"><b>Motivo provável da degradação:</b> ${esc(p.motivo)} — ${esc(p.causa)}</div>
      </div>`;
    };

    const melhor = riscoScore(p1) >= riscoScore(p2) ? p1 : p2;
    const linhasFrota = list.map(a => {
      const s = riscoScore(melhor);
      const cor = s >= 66 ? 'var(--fz-bad)' : s >= 33 ? 'var(--fz-warn)' : 'var(--fz-ok)';
      return { a, s, cor };
    }).sort((x, y) => y.s - x.s);

    _root.innerHTML = `
      <div class="fz-cop-controls fz-card">
        <label>Janela de tendência
          <select id="prWin">
            ${[15, 30, 60, 120].map(m => `<option value="${m}" ${m === _win ? 'selected' : ''}>${m} min</option>`).join('')}
          </select>
        </label>
        <button class="fz-btn ghost" id="prRefresh">Recalcular</button>
        <button class="fz-btn" id="prIA" ${semChave ? 'disabled title="Configure config.js com a chave OpenAI"' : ''}>Refinar com IA</button>
        <span class="fz-cop-sub" style="align-self:center">Extrapolação linear da tendência — não é previsão por ML.</span>
      </div>
      <div class="fz-card fz-rc-report" id="prRefino" hidden></div>

      <div class="fz-row2">${cardEixo(p1, 'Eixo 1')}${cardEixo(p2, 'Eixo 2')}</div>

      <div class="fz-card">
        <div class="fz-card-title">Ranking de risco da frota</div>
        ${list.length ? `<table class="fz-cop-table">
          <thead><tr><th>Ativo</th><th>Descrição</th><th>Score de risco</th><th>Status</th></tr></thead>
          <tbody>${linhasFrota.map(r => `<tr>
            <td>${esc(r.a.codigo)}</td><td>${esc(r.a.descricao || '')}</td>
            <td><b style="color:${r.cor}">${r.s}</b> / 100</td>
            <td><span class="fz-cop-tag" style="background:${r.cor}22;color:${r.cor};border:1px solid ${r.cor}">${r.s >= 66 ? 'Alto' : r.s >= 33 ? 'Moderado' : 'Baixo'}</span></td>
          </tr>`).join('')}</tbody></table>`
        : '<p class="fz-cop-sub">Nenhum ativo cadastrado.</p>'}
        <p class="fz-cop-sub">Score = 45% nível atual de vibração + 35% inclinação da tendência + 20% score de anomalia.
        Enquanto houver um só conjunto de telemetria (Dataset Forzy), todos os ativos usam a mesma série.</p>
      </div>`;

    _root.querySelector('#prWin').addEventListener('change', e => { _win = +e.target.value; render(); });
    _root.querySelector('#prRefresh').addEventListener('click', render);
    const _ia = _root.querySelector('#prIA');
    if (_ia && !semChave) _ia.addEventListener('click', refinarIA);
  }

  function resumoTexto(p1, p2) {
    const F = window.FORZY || {};
    const linha = (p, nome) => {
      if (!p) return nome + ': janela insuficiente.';
      return nome + ': vibracao ' + fmt(p.atual) + ' mm/s, tendencia '
        + (p.slopePerHora >= 0 ? '+' : '') + fmt(p.slopePerHora, 3) + ' mm/s por hora, '
        + 'Z-score ' + fmt(p.zmax, 1) + ' (' + p.anom + '). '
        + 'Projecao ate atencao: ' + p.ateAtencao.txt + '; ate alarme: ' + p.ateAlarme.txt + '. '
        + 'Motivo provavel: ' + p.motivo + ' - ' + p.causa + '. Prioridade ' + p.prioridade + '.';
    };
    const al = (window.FZAlertas && typeof window.FZAlertas.ativos === 'function')
      ? window.FZAlertas.ativos() : [];
    const alTxt = al.length
      ? 'Alarmes ativos agora: ' + al.map(a => (a.prioridade || '') + ' ' + (a.titulo || a.msg || '')).join(' | ')
      : 'Nenhum alarme ativo no momento.';
    return [
      'Janela de tendencia analisada: ' + _win + ' min.',
      linha(p1, 'Eixo 1'),
      linha(p2, 'Eixo 2'),
      alTxt,
    ].join('\n');
  }

  async function refinarIA() {
    const btn = _root.querySelector('#prIA'); const key = window.FORZY_OPENAI_KEY;
    if (!btn || !key) return;
    btn.disabled = true; btn.textContent = 'Consultando IA...';
    try {
      const prompt = 'Voce e um engenheiro de manutencao preditiva. A partir da projecao de degradacao abaixo '
        + '(extrapolacao linear de tendencia, nao e previsao por ML), escreva em portugues, no maximo 160 palavras: '
        + '1) qual eixo exige atencao primeiro e por que; 2) a janela realista para intervir antes do nivel de alarme; '
        + '3) uma acao concreta de manutencao. Nao repita os numeros um a um.\n\n'
        + resumoTexto(projetar('m1'), projetar('m2'));
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }], temperature: 0.4, max_tokens: 380 }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const txt = (data.choices && data.choices[0] && data.choices[0].message.content || '').trim();
      const box = _root.querySelector('#prRefino');
      if (box) { box.hidden = false; box.innerHTML = `<div class="fz-card-title">Parecer preditivo (IA)</div><p>${esc(txt)}</p>`; }
    } catch (e) {
      alert('Falha ao consultar a IA: ' + e.message);
    } finally { btn.disabled = false; btn.textContent = 'Refinar com IA'; }
  }

  function init() {
    _root = document.getElementById('preditivoRoot');
    if (!_root) return;
    render();
  }

  window.FZPreditivo = { init, render };
})();
