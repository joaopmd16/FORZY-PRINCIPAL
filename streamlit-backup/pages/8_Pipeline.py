import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import streamlit as st
import pandas as pd
import time
import database as db
from rpa import record_updater, nameplate_pipeline
from utils.theme import apply as _apply_theme, sidebar_nav as _snav

st.set_page_config(page_title="Pipeline — IMS Forzy", layout="wide")
_apply_theme()
_snav("pipeline")

st.markdown("""
<div style="padding:10px 0 18px">
  <div style="font-size:1.3rem;font-weight:700;color:#e2eaf4">Pipeline Industrial</div>
  <div style="font-size:.78rem;color:#4a7a9b;margin-top:2px">Executar · Mapeamento · OCR</div>
</div>
""", unsafe_allow_html=True)

tab_exec, tab_mapa, tab_ocr = st.tabs(["Executar Pipeline", "Mapeamento de Ativos", "Simulacao OCR"])

todos = db.get_ativos_industrial()
codigos = [a["codigo"] for a in todos]

STATUS_COR = {"ativo":"#27ae60","manutencao":"#f39c12","inativo":"#e74c3c"}

# ── Executar Pipeline ─────────────────────────────────────────────────────────
with tab_exec:
    st.markdown('<p style="font-size:.8rem;color:#4a7a9b;margin-bottom:16px">Roda o pipeline completo: valida ativos → coleta leituras → registra log.</p>', unsafe_allow_html=True)

    sels_p = st.multiselect("Ativos no pipeline", codigos, default=codigos, key="pipe_ativos")
    rodadas_p = st.slider("Rodadas de coleta", 1, 10, 3)

    if st.button("Executar Pipeline Completo", use_container_width=True, key="btn_pipe", disabled=not sels_p):
        steps = [
            ("Validando ativos...",     0.15),
            ("Coletando leituras...",   0.60),
            ("Registrando resultados...",0.90),
            ("Concluido",               1.00),
        ]
        bar = st.progress(0)
        status_txt = st.empty()

        # Passo 1 — validação
        status_txt.markdown('<span style="font-size:.85rem;color:#7ec8e3">Validando ativos...</span>', unsafe_allow_html=True)
        bar.progress(0.10)
        invalidos = [c for c in sels_p if not db.get_ativo_por_codigo(c)]
        time.sleep(0.4)
        bar.progress(0.20)

        # Passo 2 — coleta
        status_txt.markdown('<span style="font-size:.85rem;color:#7ec8e3">Coletando leituras...</span>', unsafe_allow_html=True)
        total_ok = total_err = 0
        for i in range(rodadas_p):
            res = record_updater.coletar_leituras_simuladas(sels_p)
            total_ok  += res["ok"]
            total_err += res["erros"]
            bar.progress(0.20 + 0.65 * (i+1)/rodadas_p)
            time.sleep(0.2)

        # Passo 3 — log
        status_txt.markdown('<span style="font-size:.85rem;color:#7ec8e3">Registrando resultados...</span>', unsafe_allow_html=True)
        bar.progress(0.95)
        db.log_execucao("Pipeline Completo", "sucesso" if total_err==0 else "parcial",
                        total_ok, total_err,
                        f"{rodadas_p} rodadas · {len(sels_p)} ativos · {len(invalidos)} invalidos")
        time.sleep(0.3)
        bar.progress(1.0)
        status_txt.empty()

        # Resumo
        cor = "#27ae60" if total_err == 0 else "#f39c12"
        st.markdown(f"""
        <div style="background:#0a1628;border:1px solid {cor}44;border-left:3px solid {cor};
                    border-radius:8px;padding:16px 20px;margin-top:14px">
          <div style="font-size:.95rem;font-weight:700;color:{cor}">Pipeline concluido</div>
          <div style="margin-top:10px;display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
            <div style="text-align:center">
              <div style="font-size:.65rem;color:#4a7a9b;text-transform:uppercase">Ativos</div>
              <div style="font-size:1.3rem;font-weight:700;color:#e2eaf4">{len(sels_p)}</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:.65rem;color:#4a7a9b;text-transform:uppercase">Rodadas</div>
              <div style="font-size:1.3rem;font-weight:700;color:#e2eaf4">{rodadas_p}</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:.65rem;color:#4a7a9b;text-transform:uppercase">Leituras OK</div>
              <div style="font-size:1.3rem;font-weight:700;color:#27ae60">{total_ok}</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:.65rem;color:#4a7a9b;text-transform:uppercase">Erros</div>
              <div style="font-size:1.3rem;font-weight:700;color:#e74c3c">{total_err}</div>
            </div>
          </div>
        </div>
        """, unsafe_allow_html=True)

# ── Mapeamento de Ativos ──────────────────────────────────────────────────────
with tab_mapa:
    st.markdown('<p style="font-size:.8rem;color:#4a7a9b;margin-bottom:12px">Todos os ativos cadastrados, coloridos por status operacional.</p>', unsafe_allow_html=True)

    col_f1, col_f2 = st.columns(2)
    status_f = col_f1.multiselect("Filtrar status", list(STATUS_COR.keys()), default=list(STATUS_COR.keys()), key="mapa_status")
    areas_db = db.get_areas()
    area_nomes = ["Todas"] + [a["nome"] for a in areas_db]
    area_f = col_f2.selectbox("Filtrar area", area_nomes, key="mapa_area")

    ativos_m = [a for a in todos if a["status"] in status_f and a["latitude"] and a["longitude"]]
    if area_f != "Todas":
        aid = next((a["id"] for a in areas_db if a["nome"]==area_f), None)
        ativos_m = [a for a in ativos_m if a["area_id"]==aid]

    if ativos_m:
        df_mapa = pd.DataFrame([
            {
                "lat":   a["latitude"],
                "lon":   a["longitude"],
                "color": [39, 174, 96, 220] if a["status"] == "ativo"
                         else [243, 156, 18, 220] if a["status"] == "manutencao"
                         else [231, 76, 60, 220],
            }
            for a in ativos_m
        ])
        st.map(df_mapa, latitude="lat", longitude="lon", color="color", size=12, zoom=15)
        st.markdown("""
        <div style="display:flex;gap:20px;margin-top:8px">
          <span style="font-size:.75rem;color:#27ae60;font-weight:600">● Ativo</span>
          <span style="font-size:.75rem;color:#f39c12;font-weight:600">● Manutencao</span>
          <span style="font-size:.75rem;color:#e74c3c;font-weight:600">● Inativo</span>
        </div>
        """, unsafe_allow_html=True)
    else:
        st.info("Nenhum ativo com coordenadas para os filtros selecionados.")

# ── Simulacao OCR ─────────────────────────────────────────────────────────────
with tab_ocr:
    st.markdown('<p style="font-size:.8rem;color:#4a7a9b;margin-bottom:12px">Simula a leitura de plaqueta de motor por OCR e mapeia os campos para um ativo.</p>', unsafe_allow_html=True)

    col_img, col_res = st.columns([1, 1], gap="large")

    with col_img:
        st.markdown('<p style="font-size:.75rem;color:#4a7a9b;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Imagem da Plaqueta</p>', unsafe_allow_html=True)

        upload = st.file_uploader("Upload (ou use a imagem de exemplo)", type=["png","jpg","jpeg"], key="ocr_upload")

        if upload:
            img_bytes = upload.read()
        else:
            img_bytes = nameplate_pipeline.gerar_imagem_plaqueta()

        st.image(img_bytes, use_container_width=True)

        processar = st.button("Processar OCR", use_container_width=True, key="btn_ocr")

    with col_res:
        st.markdown('<p style="font-size:.75rem;color:#4a7a9b;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Resultado da Extracao</p>', unsafe_allow_html=True)

        if "ocr_campos" not in st.session_state:
            st.session_state["ocr_campos"] = None

        if processar:
            with st.spinner("Processando OCR..."):
                time.sleep(0.8)
                campos = nameplate_pipeline.simular_ocr(img_bytes)
                avisos = nameplate_pipeline.validar_campos(campos)
                st.session_state["ocr_campos"] = campos
                st.session_state["ocr_avisos"] = avisos

        campos = st.session_state.get("ocr_campos")
        if campos:
            avisos = st.session_state.get("ocr_avisos", [])
            conf = campos.get("confianca", 0)
            cor_conf = "#27ae60" if conf >= 0.90 else "#f39c12" if conf >= 0.80 else "#e74c3c"

            st.markdown(f"""
            <div style="background:#0a1628;border:1px solid #0f2a45;border-radius:8px;padding:14px 16px;margin-bottom:10px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                <span style="font-size:.8rem;font-weight:700;color:#e2eaf4">Campos Extraidos</span>
                <span style="font-size:.75rem;color:{cor_conf};font-weight:700">Confianca: {conf:.0%}</span>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:.82rem">
                <div><span style="color:#4a7a9b">Fabricante:</span> <span style="color:#e2eaf4">{campos.get('fabricante','—')}</span></div>
                <div><span style="color:#4a7a9b">Potencia:</span> <span style="color:#e2eaf4">{campos.get('potencia_kw','—')} kW</span></div>
                <div><span style="color:#4a7a9b">Tensao:</span> <span style="color:#e2eaf4">{campos.get('tensao_v','—')} V</span></div>
                <div><span style="color:#4a7a9b">Corrente:</span> <span style="color:#e2eaf4">{campos.get('corrente_nom','—')} A</span></div>
                <div><span style="color:#4a7a9b">Protecao:</span> <span style="color:#e2eaf4">{campos.get('ip_rating','—')}</span></div>
                <div><span style="color:#4a7a9b">RPM:</span> <span style="color:#e2eaf4">{campos.get('rpm','—')}</span></div>
              </div>
            </div>
            """, unsafe_allow_html=True)

            if avisos:
                for av in avisos:
                    st.warning(av)

            st.markdown('<p style="font-size:.75rem;color:#4a7a9b;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin:10px 0 6px">Aplicar a ativo</p>', unsafe_allow_html=True)
            ativo_alvo = st.selectbox("Ativo destino", codigos, key="ocr_ativo")

            if st.button("Aplicar dados ao ativo", use_container_width=True, key="btn_ocr_apply"):
                ativo_atual = db.get_ativo_por_codigo(ativo_alvo)
                if ativo_atual:
                    db.editar_ativo_industrial(ativo_alvo, {
                        **ativo_atual,
                        "fabricante":   campos.get("fabricante", ativo_atual.get("fabricante")),
                        "potencia_kw":  campos.get("potencia_kw", ativo_atual.get("potencia_kw")),
                        "tensao_v":     campos.get("tensao_v", ativo_atual.get("tensao_v")),
                        "corrente_nom": campos.get("corrente_nom", ativo_atual.get("corrente_nom")),
                        "ip_rating":    campos.get("ip_rating", ativo_atual.get("ip_rating")),
                    })
                    db.log_execucao("OCR Pipeline", "sucesso", 1, 0,
                                    f"Dados da plaqueta aplicados ao ativo {ativo_alvo}")
                    st.success(f"Dados aplicados ao ativo {ativo_alvo}.")
                    st.session_state["ocr_campos"] = None
                    st.rerun()
        else:
            st.info("Clique em 'Processar OCR' para extrair os campos da plaqueta.")
