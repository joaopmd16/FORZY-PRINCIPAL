/* ===================================================================
   PROJETO FORZY - Sistema de Monitoramento Industrial
   Trabalho academico FIAP + Forzy-Promon

   Integrantes:
   - Arthur Baptista dos Santos       (RM 565346)
   - Joao Pedro de Moura Dutra Franco (RM 561738)
   - Nelson Felix Neto                (RM 565603)
   - Pietro Boroto Rodrigues          (RM 562407)
   - Vitor Soares Goncalves           (RM 566181)

   Arquivo: forzy-store.js
   O que faz: guarda os dados dos ativos no localStorage do navegador
   =================================================================== */

(function () {
  const KEY = 'forzy-db-v3';
  const STATUS = ['ativo', 'manutencao', 'inativo'];

  function blank() {
    return {
      seq: { plantas: 0, areas: 0, ativos: 0, leituras: 0, logs: 0, hist: 0 },
      plantas: [], areas: [], ativos_industrial: [],
      leituras: [], log_execucoes: [], historico_atualizacoes: [],
    };
  }
  let db = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {  }
    try { localStorage.removeItem('forzy-db-v1'); localStorage.removeItem('forzy-db-v2'); } catch (e) {  }
    const fresh = seed(blank());
    persist(fresh);
    return fresh;
  }
  function persist(d) { localStorage.setItem(KEY, JSON.stringify(d || db)); }
  function save() { persist(db); }
  function nowISO() { return new Date().toISOString(); }
  function nextId(t) { db.seq[t] = (db.seq[t] || 0) + 1; return db.seq[t]; }

  function seed(d) {
    const p = { id: ++d.seq.plantas, nome: 'Planta Forzy', descricao: 'Bancada de bombas centrífugas — Forzy/Promon', criado_em: nowISO() };
    d.plantas.push(p);
    const a1 = { id: ++d.seq.areas, planta_id: p.id, nome: 'Sala de Bombas', descricao: 'Conjunto principal de bombeamento' };
    const a2 = { id: ++d.seq.areas, planta_id: p.id, nome: 'Casa de Máquinas', descricao: 'Recalque e auxiliares' };
    d.areas.push(a1, a2);

    const ativos = [
      { codigo: 'BBA-001', tag: 'FZ-M1', origem: 'forzy', area_id: a1.id, descricao: 'Eixo 1 — Dataset Forzy',
        fabricante: 'WEG', potencia_kw: 7.5, tensao_v: 380, corrente_nom: 15.2, ip_rating: 'IP55',
        status: 'ativo', latitude: -23.5505, longitude: -46.6333, localizacao_descricao: 'Skid 01 · linha A',
        data_install: '2024-03-12' },
      { codigo: 'BBA-002', tag: 'FZ-M2', origem: 'forzy', area_id: a1.id, descricao: 'Eixo 2 — Dataset Forzy',
        fabricante: 'WEG', potencia_kw: 5.5, tensao_v: 380, corrente_nom: 11.4, ip_rating: 'IP55',
        status: 'ativo', latitude: -23.5512, longitude: -46.6340, localizacao_descricao: 'Skid 01 · linha B',
        data_install: '2024-03-12' },
    ];
    for (const at of ativos) d.ativos_industrial.push({ id: ++d.seq.ativos, criado_em: nowISO(), ...at });

    d.log_execucoes.push({ id: ++d.seq.logs, automacao: 'Carga Dataset Forzy', status: 'sucesso',
      registros_proc: ativos.length, registros_erro: 0, detalhes: '1 motor do Dataset Forzy (2 eixos) registrado', iniciado_em: nowISO() });
    return d;
  }

  const clone = o => JSON.parse(JSON.stringify(o));
  function plantaNome(id) { const p = db.plantas.find(x => x.id === id); return p ? p.nome : null; }
  function areaJoin(a) {
    const ar = db.areas.find(x => x.id === a.area_id);
    return { ...a, area_nome: ar ? ar.nome : null, planta_nome: ar ? plantaNome(ar.planta_id) : null,
             planta_id: ar ? ar.planta_id : null };
  }

  function getPlantas() { return clone(db.plantas).sort((a, b) => a.nome.localeCompare(b.nome)); }
  function criarPlanta(nome, descricao = '') {
    if (db.plantas.some(p => p.nome === nome)) return false;
    db.plantas.push({ id: nextId('plantas'), nome, descricao, criado_em: nowISO() });
    save(); return true;
  }
  function editarPlanta(id, dados) {
    const p = db.plantas.find(x => x.id === id);
    if (!p) return false;
    if (dados.nome !== undefined) {
      if (db.plantas.some(x => x.id !== id && x.nome === dados.nome)) return false;
      p.nome = dados.nome;
    }
    if (dados.descricao !== undefined) p.descricao = dados.descricao;
    if (dados.status !== undefined) p.status = dados.status;
    logHist('plantas', 'UPDATE', null, dados); save(); return true;
  }
  function excluirPlanta(id) {
    if (db.areas.some(a => a.planta_id === id))
      return { ok: false, motivo: 'A planta tem áreas. Exclua/mova as áreas antes.' };
    db.plantas = db.plantas.filter(p => p.id !== id);
    logHist('plantas', 'DELETE', { id }, null); save(); return { ok: true };
  }
  function getAreas(planta_id = null) {
    let r = db.areas.slice();
    if (planta_id) r = r.filter(a => a.planta_id === planta_id);
    return clone(r).sort((a, b) => a.nome.localeCompare(b.nome));
  }
  function criarArea(planta_id, nome, descricao = '') {
    db.areas.push({ id: nextId('areas'), planta_id, nome, descricao });
    save(); return true;
  }
  function editarArea(id, dados) {
    const a = db.areas.find(x => x.id === id);
    if (!a) return false;
    if (dados.nome !== undefined) a.nome = dados.nome;
    if (dados.descricao !== undefined) a.descricao = dados.descricao;
    if (dados.planta_id !== undefined) a.planta_id = +dados.planta_id;
    if (dados.status !== undefined) a.status = dados.status;
    logHist('areas', 'UPDATE', null, dados); save(); return true;
  }
  function excluirArea(id) {
    if (db.ativos_industrial.some(a => a.area_id === id))
      return { ok: false, motivo: 'A área tem ativos. Mova/exclua os ativos antes.' };
    db.areas = db.areas.filter(a => a.id !== id);
    logHist('areas', 'DELETE', { id }, null); save(); return { ok: true };
  }

  function getAtivosIndustrial(area_id = null, status = null) {
    let r = db.ativos_industrial.slice();
    if (area_id) r = r.filter(a => a.area_id === area_id);
    if (status) r = r.filter(a => a.status === status);
    return r.map(areaJoin).sort((a, b) => a.codigo.localeCompare(b.codigo));
  }
  function getAtivoPorCodigo(codigo) {
    const a = db.ativos_industrial.find(x => x.codigo === codigo);
    return a ? areaJoin(clone(a)) : null;
  }
  const CAMPOS = ['tag', 'area_id', 'descricao', 'fabricante', 'potencia_kw', 'tensao_v',
    'corrente_nom', 'ip_rating', 'status', 'latitude', 'longitude', 'localizacao_descricao', 'data_install',
    'observacoes'];
  function criarAtivoIndustrial(dados) {
    if (!dados.codigo || db.ativos_industrial.some(a => a.codigo === dados.codigo)) return false;
    const novo = { id: nextId('ativos'), codigo: dados.codigo, status: dados.status || 'ativo', criado_em: nowISO() };
    for (const c of CAMPOS) if (dados[c] !== undefined) novo[c] = dados[c];
    db.ativos_industrial.push(novo);
    logHist('ativos_industrial', 'INSERT', null, dados);
    save(); return true;
  }
  function editarAtivoIndustrial(codigo, dados) {
    const a = db.ativos_industrial.find(x => x.codigo === codigo);
    if (!a) return false;
    const antes = clone(a);
    for (const c of CAMPOS) if (dados[c] !== undefined) a[c] = dados[c];
    logHist('ativos_industrial', 'UPDATE', antes, dados);
    save(); return true;
  }
  function excluirAtivoIndustrial(codigo) {
    const a = db.ativos_industrial.find(x => x.codigo === codigo);
    if (!a) return { ok: false, motivo: 'Ativo não encontrado.' };
    if (a.origem === 'forzy') return { ok: false, motivo: 'Este ativo é do Dataset Forzy e não pode ser excluído.' };
    db.ativos_industrial = db.ativos_industrial.filter(x => x.codigo !== codigo);
    logHist('ativos_industrial', 'DELETE', a, null);
    save(); return { ok: true };
  }

  function getLeituras(ativo_codigo = null, limit = 500) {
    let r = db.leituras.slice();
    if (ativo_codigo) r = r.filter(l => l.ativo_id === ativo_codigo);
    r.sort((a, b) => (b.coletado_em || '').localeCompare(a.coletado_em || ''));
    return clone(r.slice(0, limit));
  }
  const MAX_LEITURAS = 6000;
  function insertLeitura(ativo_codigo, dados) {
    const reg = { id: nextId('leituras'), ativo_id: ativo_codigo, fonte: dados.fonte || 'esp32',
      coletado_em: dados.coletado_em || nowISO(), flag_anomalia: dados.flag_anomalia || 0, ...dados };
    db.leituras.push(reg);
    if (db.leituras.length > MAX_LEITURAS) db.leituras = db.leituras.slice(-MAX_LEITURAS);
    save(); return reg.id;
  }

  function logExecucao(automacao, status, proc = 0, erros = 0, detalhes = '') {
    db.log_execucoes.push({ id: nextId('logs'), automacao, status,
      registros_proc: proc, registros_erro: erros, detalhes, iniciado_em: nowISO() });
    save();
  }
  function getLogs(limit = 200) {
    return clone(db.log_execucoes).sort((a, b) => b.iniciado_em.localeCompare(a.iniciado_em)).slice(0, limit);
  }
  function logHist(tabela, operacao, antes, depois) {
    db.historico_atualizacoes.push({ id: nextId('hist'), tabela, operacao,
      dados_antes: antes ? JSON.stringify(antes) : null,
      dados_depois: depois ? JSON.stringify(depois) : null, ts: nowISO() });
  }
  function getHistorico(limit = 200) {
    return clone(db.historico_atualizacoes).sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, limit);
  }

  function reset() { db = seed(blank()); save(); }
  function statusLabel(s) { return { ativo: 'Ativo', manutencao: 'Manutenção', inativo: 'Inativo' }[s] || s; }
  function statusColor(s) {
    const v = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    return { ativo: v('--fz-ok') || '#2ecc71', manutencao: v('--fz-warn') || '#f39c12', inativo: v('--fz-bad') || '#e74c3c' }[s] || '#7d8794';
  }

  window.FZStore = {
    STATUS, statusLabel, statusColor, reset,
    getPlantas, criarPlanta, editarPlanta, excluirPlanta, getAreas, criarArea, editarArea, excluirArea,
    getAtivosIndustrial, getAtivoPorCodigo, criarAtivoIndustrial, editarAtivoIndustrial, excluirAtivoIndustrial,
    getLeituras, insertLeitura,
    logExecucao, getLogs, getHistorico,
  };
})();
