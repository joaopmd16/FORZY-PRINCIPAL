import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import streamlit as st
import pandas as pd
from datetime import datetime
import database as db
from rpa import tag_association, record_updater
from utils.theme import apply as _apply_theme, sidebar_nav as _snav

st.set_page_config(page_title="RPA — IMS Forzy", layout="wide")
_apply_theme()
_snav("rpa")

st.markdown("""
<div style="padding:10px 0 18px">
  <div style="font-size:1.3rem;font-weight:700;color:#e2eaf4">RPA — Automacao</div>
  <div style="font-size:.78rem;color:#4a7a9b;margin-top:2px">Associacao · Status · Coleta · Logs</div>
</div>
""", unsafe_allow_html=True)

tab_assoc, tab_status, tab_coleta, tab_logs = st.tabs([
    "Associacao de TAGs", "Atualizar Status", "Coleta de Leitura", "Log / Auditoria"
])

todos_ativos = db.get_ativos_industrial()
codigos = [a["codigo"] for a in todos_ativos]
areas   = db.get_areas()

STATUS_COR = {"ativo":"#27ae60","manutencao":"#f39c12","inativo":"#e74c3c","sucesso":"#27ae60","parcial":"#f39c12","erro":"#e74c3c"}

def _resultado_box(res):
    cor = "#27ae60" if res["erros"] == 0 else "#f39c12"
    st.markdown(f"""
    <div style="background:#0a1628;border:1px solid {cor}44;border-left:3px solid {cor};
                border-radius:8px;padding:14px 16px;margin-top:12px">
      <div style="font-size:.85rem;font-weight:700;color:{cor}">
        {res['ok']} processados &nbsp;·&nbsp; {res['erros']} erros
      </div>
    </div>
    """, unsafe_allow_html=True)
    with st.expander("Ver detalhes"):
        for d in res["detalhes"]:
            cor_l = "#27ae60" if d.startswith("OK") else "#e74c3c"
            st.markdown(f'<span style="font-size:.8rem;color:{cor_l}">{d}</span>', unsafe_allow_html=True)

# ── Associacao de TAGs ────────────────────────────────────────────────────────
with tab_assoc:
    st.markdown('<p style="font-size:.8rem;color:#4a7a9b;margin-bottom:10px">Vincule TAG e Area para varios ativos de uma vez.</p>', unsafe_allow_html=True)

    area_opts = [(a["id"], a["nome"]) for a in areas]

    sels = st.multiselect("Ativos a associar", codigos, key="assoc_ativos")
    if sels:
        col_tag, col_area = st.columns(2)
        nova_tag  = col_tag.text_input("Nova TAG (aplica a todos)", placeholder="TAG-XX")
        area_nome = col_area.selectbox("Nova Area", [x[1] for x in area_opts], key="assoc_area")
        area_id_sel = next((x[0] for x in area_opts if x[1]==area_nome), None)

        if st.button("Executar Associacao", use_container_width=True, key="btn_assoc"):
            mapeamento = [{"codigo": c, "tag": nova_tag or None, "area_id": area_id_sel} for c in sels]
            with st.spinner("Associando..."):
                res = tag_association.associar_tags(mapeamento)
            _resultado_box(res)
    else:
        st.info("Selecione ao menos um ativo para associar.")

# ── Atualizar Status ──────────────────────────────────────────────────────────
with tab_status:
    st.markdown('<p style="font-size:.8rem;color:#4a7a9b;margin-bottom:10px">Muda o status operacional de varios ativos de uma vez.</p>', unsafe_allow_html=True)

    sels_s = st.multiselect("Ativos", codigos, key="status_ativos")
    novo_status = st.radio("Novo status", ["ativo","manutencao","inativo"],
                           horizontal=True, key="status_radio")

    col_prev, col_btn = st.columns([3,1])
    with col_prev:
        if sels_s:
            atual = {a["codigo"]: a["status"] for a in todos_ativos if a["codigo"] in sels_s}
            for cod, s in atual.items():
                cor_a = STATUS_COR.get(s,"#4a7a9b")
                cor_n = STATUS_COR.get(novo_status,"#4a7a9b")
                st.markdown(f'<span style="font-size:.8rem;color:#4a7a9b">{cod}</span> &nbsp;<span style="color:{cor_a};font-size:.8rem;font-weight:600">{s}</span> <span style="color:#4a7a9b"> → </span> <span style="color:{cor_n};font-size:.8rem;font-weight:600">{novo_status}</span>', unsafe_allow_html=True)

    with col_btn:
        if st.button("Aplicar", use_container_width=True, key="btn_status", disabled=not sels_s):
            with st.spinner("Atualizando..."):
                res = record_updater.atualizar_status(sels_s, novo_status)
            _resultado_box(res)
            st.rerun()

# ── Coleta de Leitura ─────────────────────────────────────────────────────────
with tab_coleta:
    st.markdown('<p style="font-size:.8rem;color:#4a7a9b;margin-bottom:10px">Simula coleta de sensores e grava leituras no banco.</p>', unsafe_allow_html=True)

    sels_c = st.multiselect("Ativos para coletar", codigos,
                             default=codigos, key="coleta_ativos")

    col_c1, col_c2 = st.columns(2)
    rodadas = col_c1.number_input("Rodadas de coleta", min_value=1, max_value=20, value=1)

    if col_c2.button("Executar Coleta", use_container_width=True, key="btn_coleta", disabled=not sels_c):
        bar = st.progress(0, "Coletando...")
        resultado_total = {"ok":0,"erros":0,"detalhes":[]}
        for i in range(rodadas):
            res = record_updater.coletar_leituras_simuladas(sels_c)
            resultado_total["ok"]     += res["ok"]
            resultado_total["erros"]  += res["erros"]
            resultado_total["detalhes"] += res["detalhes"]
            bar.progress((i+1)/rodadas, f"Rodada {i+1}/{rodadas}...")
        bar.empty()
        _resultado_box(resultado_total)

# ── Log / Auditoria ───────────────────────────────────────────────────────────
with tab_logs:
    sub_log, sub_hist = st.tabs(["Log de Execucoes", "Historico de Mudancas"])

    with sub_log:
        logs = db.get_logs(200)
        if logs:
            df_l = pd.DataFrame(logs)[["iniciado_em","automacao","status","registros_proc","registros_erro"]]
            df_l.columns = ["Data/Hora","Automacao","Status","Processados","Erros"]
            st.dataframe(
                df_l.style.map(
                    lambda v: f"color:{STATUS_COR.get(v,'#e2eaf4')};font-weight:600",
                    subset=["Status"]
                ),
                use_container_width=True, hide_index=True
            )
        else:
            st.info("Nenhuma execucao registrada ainda.")

    with sub_hist:
        hist = db.get_historico(200)
        if hist:
            df_h = pd.DataFrame(hist)[["ts","tabela","operacao","dados_antes","dados_depois"]]
            df_h.columns = ["Data/Hora","Tabela","Operacao","Antes","Depois"]
            st.dataframe(df_h, use_container_width=True, hide_index=True)
        else:
            st.info("Nenhuma mudanca registrada ainda.")
