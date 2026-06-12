import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import streamlit as st
import pandas as pd
import sqlite3
import database as db
from database import DB_PATH as _DB_PATH
from utils.theme import apply as _apply_theme, sidebar_nav as _snav

def _connect_db():
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

st.set_page_config(page_title="Cadastro — IMS Forzy", layout="wide")
_apply_theme()
_snav("cadastro")

# ── CSS específico do cadastro ─────────────────────────────────────────────────
st.markdown("""
<style>
/* Título do formulário */
.form-title {
    font-size: 1.4rem; font-weight: 700; color: #e2eaf4;
    margin-bottom: 24px; padding-bottom: 12px;
    border-bottom: 1px solid #0f2035;
}
/* Labels customizados */
.field-label {
    font-size: .72rem; font-weight: 600; color: #4a7a9b;
    text-transform: uppercase; letter-spacing: .08em;
    margin-bottom: 4px;
}
/* Botão Cadastrar — coral/vermelho */
div[data-testid="stForm"] div[data-testid="stButton"]:last-child > button,
.btn-cadastrar button {
    background: #c0392b !important;
    border: none !important;
    color: #fff !important;
    font-size: .88rem !important;
    font-weight: 700 !important;
    padding: 10px 0 !important;
    border-radius: 6px !important;
    letter-spacing: .04em !important;
    transition: background .15s !important;
}
div[data-testid="stForm"] div[data-testid="stButton"]:last-child > button:hover,
.btn-cadastrar button:hover {
    background: #e74c3c !important;
}
/* Botão Salvar Alterações — azul */
.btn-salvar button {
    background: #1e5fa8 !important;
    border: none !important;
    color: #fff !important;
    font-size: .88rem !important;
    font-weight: 700 !important;
    border-radius: 6px !important;
}
.btn-salvar button:hover { background: #2980b9 !important; }

/* Remove borda padrão do st.form */
div[data-testid="stForm"] {
    border: none !important;
    padding: 0 !important;
}
/* Inputs mais escuros */
div[data-testid="stTextInput"] input,
div[data-testid="stNumberInput"] input {
    background: #0a1628 !important;
    border: 1px solid #0f2a45 !important;
    color: #e2eaf4 !important;
    border-radius: 6px !important;
}
div[data-testid="stSelectbox"] > div > div {
    background: #0a1628 !important;
    border: 1px solid #0f2a45 !important;
    border-radius: 6px !important;
}
</style>
""", unsafe_allow_html=True)

st.markdown("""
<div style="padding:10px 0 18px">
  <div style="font-size:1.3rem;font-weight:700;color:#e2eaf4">Cadastro de Ativos</div>
  <div style="font-size:.78rem;color:#4a7a9b;margin-top:2px">Lista · Novo · Editar</div>
</div>
""", unsafe_allow_html=True)

tab_lista, tab_novo, tab_editar, tab_dash_ativo = st.tabs([
    "Lista de Ativos", "Novo Ativo", "Editar Ativo", "Dashboard do Ativo"
])

plantas = db.get_plantas()
areas   = db.get_areas()

def _area_options(planta_id=None):
    if planta_id:
        return [(a["id"], a["nome"]) for a in areas if a["planta_id"] == planta_id]
    return [(a["id"], a["nome"]) for a in areas]

STATUS_OPTS = ["ativo", "manutencao", "inativo"]
IP_OPTS     = ["IP44", "IP54", "IP55", "IP65", "IP66", "IP67"]

# ── Tab Lista ─────────────────────────────────────────────────────────────────
with tab_lista:
    col_f1, col_f2, col_f3 = st.columns(3)
    planta_f = col_f1.selectbox("Planta",  ["Todas"] + [p["nome"] for p in plantas], key="lst_planta")
    status_f = col_f2.selectbox("Status",  ["Todos"] + STATUS_OPTS,                  key="lst_status")
    busca    = col_f3.text_input("Busca",  key="lst_busca", placeholder="Codigo ou descrição")

    pid      = next((p["id"] for p in plantas if p["nome"] == planta_f), None) if planta_f != "Todas" else None
    area_ids = [a["id"] for a in areas if a["planta_id"] == pid] if pid else None

    todos = db.get_ativos_industrial()
    if area_ids is not None:
        todos = [a for a in todos if a["area_id"] in area_ids]
    if status_f != "Todos":
        todos = [a for a in todos if a["status"] == status_f]
    if busca:
        bl = busca.lower()
        todos = [a for a in todos if bl in (a["codigo"] or "").lower() or bl in (a["descricao"] or "").lower()]

    if todos:
        STATUS_COR = {"ativo": "#27ae60", "manutencao": "#f39c12", "inativo": "#e74c3c"}
        df = pd.DataFrame(todos)[["codigo","tag","descricao","fabricante",
                                   "potencia_kw","tensao_v","corrente_nom","ip_rating",
                                   "status","area_nome","planta_nome","localizacao_descricao"]]
        df.columns = ["Codigo","TAG","Descrição","Fabricante","kW","V","A nom","IP",
                      "Status","Área","Planta","Localização"]
        st.dataframe(
            df.style.map(lambda v: f"color:{STATUS_COR.get(v,'#e2eaf4')};font-weight:600",
                         subset=["Status"]),
            use_container_width=True, hide_index=True
        )
        csv = df.to_csv(index=False, sep=";").encode("utf-8")
        st.download_button("Exportar CSV", csv, "ativos.csv", "text/csv")
    else:
        st.info("Nenhum ativo encontrado.")

# ── Tab Novo ──────────────────────────────────────────────────────────────────
with tab_novo:

    # ── Criar Planta (se não existir) ──────────────────────────────────────────
    if not plantas:
        st.warning("Nenhuma planta cadastrada. Crie uma planta antes de adicionar ativos.")
        with st.form("form_planta"):
            st.markdown('<div class="form-title">Criar Planta</div>', unsafe_allow_html=True)
            nome_p = st.text_input("Nome da Planta *", placeholder="Planta São Paulo A1")
            desc_p = st.text_input("Descrição",        placeholder="Unidade principal")
            if st.form_submit_button("Criar Planta", use_container_width=True):
                if nome_p.strip():
                    with _connect_db() as conn:
                        conn.execute("INSERT INTO plantas (nome, descricao) VALUES (?,?)",
                                     (nome_p.strip(), desc_p))
                    st.success(f"Planta '{nome_p}' criada.")
                    st.rerun()
                else:
                    st.error("Nome obrigatório.")
        st.stop()

    # ── Selecionar Planta (fora do form — reativo) ────────────────────────────
    st.markdown('<div class="form-title">Cadastrar Novo Ativo</div>', unsafe_allow_html=True)

    c_pl_top, c_ar_top = st.columns(2)
    with c_pl_top:
        st.markdown('<p class="field-label">Planta</p>', unsafe_allow_html=True)
        planta_n = st.selectbox("Planta", [p["nome"] for p in plantas],
                                key="n_planta", label_visibility="collapsed")
    pid_n     = next((p["id"] for p in plantas if p["nome"] == planta_n), None)
    area_opts = _area_options(pid_n) if pid_n else []

    with c_ar_top:
        st.markdown('<p class="field-label">Área</p>', unsafe_allow_html=True)
        if area_opts:
            area_n    = st.selectbox("Área", [x[1] for x in area_opts],
                                     key="n_area", label_visibility="collapsed")
            area_id_n = next((x[0] for x in area_opts if x[1] == area_n), None)
        else:
            st.selectbox("Área", ["— nenhuma área nesta planta —"],
                         disabled=True, label_visibility="collapsed", key="n_area_disabled")
            area_id_n = None

    # ── Criar Área (expander, reativo) ────────────────────────────────────────
    with st.expander("Criar nova Área nesta planta" + (" (necessário para cadastrar ativo)" if not area_opts else "")):
        with st.form("form_area_nova"):
            ca1, ca2 = st.columns(2)
            nome_area = ca1.text_input("Nome da Área *", placeholder="Sala de Maquinas")
            desc_area = ca2.text_input("Descrição",      placeholder="Piso 1 - Bloco B")
            if st.form_submit_button("Criar Área", use_container_width=True):
                if nome_area.strip() and pid_n:
                    with _connect_db() as conn:
                        conn.execute(
                            "INSERT INTO areas (nome, descricao, planta_id) VALUES (?,?,?)",
                            (nome_area.strip(), desc_area.strip(), pid_n),
                        )
                    st.success(f"Área '{nome_area}' criada na planta '{planta_n}'.")
                    st.rerun()
                else:
                    st.error("Nome da área obrigatório.")

    if not area_id_n:
        st.info("Crie uma Área para a planta selecionada antes de cadastrar um ativo.")
        st.stop()

    # ── Formulário principal ───────────────────────────────────────────────────
    with st.form("form_novo", clear_on_submit=True):

        # Código e TAG
        c_cod, c_tag = st.columns(2)
        codigo = c_cod.text_input("Código *", placeholder="MTR-001")
        tag    = c_tag.text_input("TAG",       placeholder="MTR-001")

        # Descrição
        descricao = st.text_input("Descrição *", placeholder="Motor Bomba Secundária")

        # Fabricante e IP
        c_fab, c_ip = st.columns(2)
        fabricante = c_fab.text_input("Fabricante", placeholder="WEG")
        ip_rating  = c_ip.selectbox("IP Rating",   IP_OPTS, index=1)

        # Status
        status = st.selectbox("Status", STATUS_OPTS)

        # Specs elétricas
        c_kw, c_v, c_a = st.columns(3)
        potencia = c_kw.number_input("Potência (kW)",       min_value=0.0, value=0.0,   step=0.5)
        tensao   = c_v.number_input("Tensão (V)",           min_value=0.0, value=380.0, step=10.0)
        corrente = c_a.number_input("Corrente Nominal (A)", min_value=0.0, value=0.0,   step=1.0)

        # Localização e data
        loc_desc  = st.text_input("Localização", placeholder="Bloco 1 - Sala de Máquinas")
        data_inst = st.date_input("Data de Instalação")

        # Coordenadas (colapsável)
        with st.expander("Coordenadas GPS (opcional)"):
            c_lat, c_lon = st.columns(2)
            lat = c_lat.number_input("Latitude",  value=-23.5505, format="%.6f")
            lon = c_lon.number_input("Longitude", value=-46.6333, format="%.6f")

        # SVG para modelo 2D/3D no SCADA
        with st.expander("Planta / Modelo SVG para SCADA (opcional)"):
            st.caption("Faca upload do SVG da planta baixa ou layout do ativo. Sera usado no SCADA 2D.")
            svg_file = st.file_uploader(
                "Arquivo SVG", type=["svg"], key="novo_svg_upload",
                label_visibility="collapsed",
            )

        st.markdown("<div style='height:8px'></div>", unsafe_allow_html=True)
        submitted = st.form_submit_button("Cadastrar Ativo", use_container_width=True)

    if submitted:
        if not codigo.strip():
            st.error("Código é obrigatório.")
        elif not descricao.strip():
            st.error("Descrição é obrigatória.")
        else:
            try:
                db.criar_ativo_industrial({
                    "codigo": codigo.strip(), "tag": tag.strip() or codigo.strip(),
                    "area_id": area_id_n, "descricao": descricao.strip(),
                    "fabricante": fabricante, "potencia_kw": potencia,
                    "tensao_v": tensao, "corrente_nom": corrente,
                    "ip_rating": ip_rating, "status": status,
                    "latitude": lat, "longitude": lon,
                    "localizacao_descricao": loc_desc,
                    "data_install": str(data_inst),
                })
                st.session_state["dash_ativo_codigo"] = codigo.strip()
                # Salva SVG se enviado
                if svg_file is not None:
                    from utils.fonte import salvar_svg
                    salvar_svg(codigo.strip(), svg_file.getvalue())
                st.success(f"Ativo **{codigo}** cadastrado com sucesso.")
                st.balloons()
                # Abre a aba Dashboard do Ativo via JS click
                import streamlit.components.v1 as _cv1_cad
                _cv1_cad.html("""<script>
                (function(){
                    function clickTab(){
                        var tabs = window.parent.document.querySelectorAll('button[role="tab"]');
                        if(tabs.length >= 4){ tabs[3].click(); }
                        else { setTimeout(clickTab, 80); }
                    }
                    setTimeout(clickTab, 300);
                })();
                </script>""", height=0)
            except Exception as e:
                st.error(f"Erro ao cadastrar: {e}")

# ── Tab Editar ────────────────────────────────────────────────────────────────
with tab_editar:
    todos_edit  = db.get_ativos_industrial()
    codigos_edit = [a["codigo"] for a in todos_edit]

    if not codigos_edit:
        st.info("Nenhum ativo cadastrado ainda.")
    else:
        cod_sel = st.selectbox("Selecione o ativo para editar", codigos_edit, key="edit_sel")
        a = db.get_ativo_por_codigo(cod_sel)

        if a:
            st.markdown(f'<div class="form-title">Editar — {a["codigo"]}</div>', unsafe_allow_html=True)

            with st.form("form_editar", clear_on_submit=False):
                pid_e_default = a.get("planta_id")
                c_pl_e, c_ar_e = st.columns(2)
                planta_e = c_pl_e.selectbox("Planta", [p["nome"] for p in plantas],
                    index=next((i for i, p in enumerate(plantas) if p["id"] == pid_e_default), 0),
                    key="e_planta")
                pid_e       = next(p["id"] for p in plantas if p["nome"] == planta_e)
                area_opts_e = _area_options(pid_e)
                area_e      = c_ar_e.selectbox("Área", [x[1] for x in area_opts_e],
                    index=next((i for i, (aid, _) in enumerate(area_opts_e) if aid == a["area_id"]), 0),
                    key="e_area")
                area_id_e = next((x[0] for x in area_opts_e if x[1] == area_e), None)

                c_cod_e, c_tag_e = st.columns(2)
                c_cod_e.text_input("Código", value=a["codigo"], disabled=True)
                tag_e = c_tag_e.text_input("TAG", value=a["tag"] or "")

                descricao_e = st.text_input("Descrição", value=a["descricao"] or "")

                c_fab_e, c_ip_e = st.columns(2)
                fabricante_e = c_fab_e.text_input("Fabricante", value=a["fabricante"] or "")
                ip_e         = c_ip_e.selectbox("IP Rating", IP_OPTS,
                    index=IP_OPTS.index(a["ip_rating"]) if a["ip_rating"] in IP_OPTS else 1)

                status_e = st.selectbox("Status", STATUS_OPTS,
                    index=STATUS_OPTS.index(a["status"]) if a["status"] in STATUS_OPTS else 0)

                c_kw_e, c_v_e, c_a_e = st.columns(3)
                potencia_e = c_kw_e.number_input("Potência (kW)", value=float(a["potencia_kw"] or 0), step=0.5)
                tensao_e   = c_v_e.number_input("Tensão (V)",     value=float(a["tensao_v"] or 0),    step=10.0)
                corrente_e = c_a_e.number_input("Corrente Nom (A)", value=float(a["corrente_nom"] or 0), step=1.0)

                loc_e = st.text_input("Localização", value=a["localizacao_descricao"] or "")

                with st.expander("Coordenadas GPS"):
                    c_lat_e, c_lon_e = st.columns(2)
                    lat_e = c_lat_e.number_input("Latitude",  value=float(a["latitude"] or -23.5505), format="%.6f")
                    lon_e = c_lon_e.number_input("Longitude", value=float(a["longitude"] or -46.6333), format="%.6f")

                st.markdown("<div style='height:8px'></div>", unsafe_allow_html=True)
                salvar = st.form_submit_button("Salvar Alterações", use_container_width=True)

            if salvar:
                try:
                    db.editar_ativo_industrial(cod_sel, {
                        "tag": tag_e, "area_id": area_id_e, "descricao": descricao_e,
                        "fabricante": fabricante_e, "potencia_kw": potencia_e,
                        "tensao_v": tensao_e, "corrente_nom": corrente_e,
                        "ip_rating": ip_e, "status": status_e,
                        "latitude": lat_e, "longitude": lon_e,
                        "localizacao_descricao": loc_e,
                        "data_install": a.get("data_install"),
                    })
                    st.session_state["dash_ativo_codigo"] = cod_sel
                    st.success(f"Ativo {cod_sel} atualizado com sucesso.")
                    st.rerun()
                except Exception as e:
                    st.error(f"Erro: {e}")

# ── Tab Dashboard do Ativo ────────────────────────────────────────────────────
with tab_dash_ativo:
    import plotly.graph_objects as go
    import numpy as np
    from pathlib import Path
    from datetime import datetime

    # Seletor de ativo (padrão = último criado/editado)
    todos_dash = db.get_ativos_industrial()
    if not todos_dash:
        st.info("Nenhum ativo cadastrado ainda. Crie um ativo na aba 'Novo Ativo'.")
        st.stop()

    codigos_dash = [a["codigo"] for a in todos_dash]
    default_idx  = 0
    _cod_sess    = st.session_state.get("dash_ativo_codigo")
    if _cod_sess and _cod_sess in codigos_dash:
        default_idx = codigos_dash.index(_cod_sess)

    _da_sel = st.selectbox("Ativo", codigos_dash, index=default_idx, key="dash_ativo_sel")
    st.session_state["dash_ativo_codigo"] = _da_sel
    _da = db.get_ativo_por_codigo(_da_sel)

    if not _da:
        st.warning("Ativo não encontrado.")
        st.stop()

    # ── Cabeçalho do ativo ────────────────────────────────────────────────────
    STATUS_COR_DA = {"ativo": "#27ae60", "manutencao": "#f39c12", "inativo": "#e74c3c"}
    _sc_da = STATUS_COR_DA.get(_da["status"], "#4a7a9b")

    st.markdown(f"""
    <div style="background:#0a1628;border:1px solid #0f2a45;border-left:4px solid {_sc_da};
                border-radius:10px;padding:18px 22px;margin-bottom:18px">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
        <div>
          <div style="font-size:1.25rem;font-weight:700;color:#e2eaf4">{_da['codigo']}</div>
          <div style="font-size:.85rem;color:#4a7a9b;margin-top:2px">{_da['descricao']}</div>
          <div style="font-size:.75rem;color:#4a7a9b;margin-top:4px">
            {_da.get('area_nome','—')} · {_da.get('planta_nome','—')}
          </div>
        </div>
        <div style="display:flex;gap:14px;flex-wrap:wrap">
          <div style="text-align:center">
            <div style="font-size:.6rem;color:#4a7a9b;text-transform:uppercase;letter-spacing:.08em">TAG</div>
            <div style="font-size:.95rem;font-weight:700;color:#7ec8e3">{_da.get('tag') or '—'}</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:.6rem;color:#4a7a9b;text-transform:uppercase;letter-spacing:.08em">Fabricante</div>
            <div style="font-size:.95rem;font-weight:700;color:#e2eaf4">{_da.get('fabricante') or '—'}</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:.6rem;color:#4a7a9b;text-transform:uppercase;letter-spacing:.08em">Potência</div>
            <div style="font-size:.95rem;font-weight:700;color:#e2eaf4">{_da.get('potencia_kw') or '—'} kW</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:.6rem;color:#4a7a9b;text-transform:uppercase;letter-spacing:.08em">Tensão</div>
            <div style="font-size:.95rem;font-weight:700;color:#e2eaf4">{_da.get('tensao_v') or '—'} V</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:.6rem;color:#4a7a9b;text-transform:uppercase;letter-spacing:.08em">IP</div>
            <div style="font-size:.95rem;font-weight:700;color:#e2eaf4">{_da.get('ip_rating') or '—'}</div>
          </div>
          <div>
            <span style="background:{_sc_da}22;border:1px solid {_sc_da};color:{_sc_da};
                         font-size:.72rem;font-weight:700;padding:5px 14px;border-radius:20px;
                         text-transform:uppercase;letter-spacing:.08em">{_da['status']}</span>
          </div>
        </div>
      </div>
    </div>
    """, unsafe_allow_html=True)

    # ── Leituras IoT do ativo (se existirem) ──────────────────────────────────
    leituras_da = db.get_leituras(_da["codigo"], limit=50)

    if leituras_da:
        import pandas as pd
        df_l = pd.DataFrame(leituras_da)
        df_l["coletado_em"] = pd.to_datetime(df_l["coletado_em"])

        st.markdown('<p style="font-size:.72rem;color:#4a7a9b;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">Leituras de Sensores (IoT)</p>', unsafe_allow_html=True)

        _m1, _m2, _m3 = st.columns(3)
        def _fmt(val, fmt):
            v = float(val) if val is not None and val == val else None
            return f"{v:{fmt}}" if v is not None else "—"
        _m1.metric("Vibração atual (mm/s)", _fmt(df_l['vibracao_mm_s'].iloc[-1], ".3f"))
        _m2.metric("Temperatura atual (°C)", _fmt(df_l['temperatura_c'].iloc[-1], ".1f"))
        _m3.metric("Corrente atual (A)", _fmt(df_l['corrente_a'].iloc[-1], ".2f"))

        _fig_l = go.Figure()
        for _col, _lbl, _cor in [
            ("vibracao_mm_s", "Vibração mm/s", "#7ec8e3"),
            ("temperatura_c", "Temperatura °C", "#f39c12"),
            ("corrente_a",    "Corrente A",     "#2ecc71"),
        ]:
            if _col in df_l.columns:
                _fig_l.add_trace(go.Scattergl(
                    x=df_l["coletado_em"], y=df_l[_col],
                    mode="lines", name=_lbl,
                    line=dict(color=_cor, width=1.5),
                ))
        _fig_l.update_layout(
            height=240, paper_bgcolor="#060d18", plot_bgcolor="#060d18",
            font_color="#e2eaf4", font_size=11,
            margin=dict(t=10, b=40, l=50, r=20),
            xaxis=dict(gridcolor="#0f2035"),
            yaxis=dict(gridcolor="#0f2035"),
            legend=dict(bgcolor="#0a1628", bordercolor="#0f2a45", borderwidth=1, font_size=10),
        )
        st.plotly_chart(_fig_l, use_container_width=True, key="da_leituras")

    else:
        # Sem leituras reais → exibe dados do Dataset Forzy como referência operacional
        st.markdown('<p style="font-size:.72rem;color:#4a7a9b;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Referência Operacional — Dataset Forzy</p>', unsafe_allow_html=True)
        st.caption("Nenhuma leitura IoT vinculada a este ativo. Exibindo dados históricos do dataset como referência.")

        _CSV_DA = Path(__file__).parent.parent / "data" / "forzy.csv"
        if _CSV_DA.exists():
            import pandas as pd
            _df_da = pd.read_csv(_CSV_DA, sep=";", skiprows=3, header=None,
                usecols=[0,3,4,5,6,7,8],
                names=["timestamp","m1_vel","m1_acel","m1_temp","m2_vel","m2_acel","m2_temp"])
            _df_da["timestamp"] = pd.to_datetime(_df_da["timestamp"])
            for _c in ["m1_vel","m1_acel","m1_temp","m2_vel","m2_acel","m2_temp"]:
                _df_da[_c] = pd.to_numeric(_df_da[_c], errors="coerce")
            _df_da = _df_da.dropna().reset_index(drop=True)

            # Downsample para exibição
            if len(_df_da) > 300:
                _idx = np.linspace(0, len(_df_da)-1, 300, dtype=int)
                _df_da = _df_da.iloc[_idx].reset_index(drop=True)

            # Métricas resumidas
            _mm1, _mm2, _mm3, _mm4 = st.columns(4)
            _mm1.metric("Vel. M1 média (mm/s)", f"{_df_da.m1_vel.mean():.3f}")
            _mm2.metric("Vel. M2 média (mm/s)", f"{_df_da.m2_vel.mean():.3f}")
            _mm3.metric("Temp M1 média (°C)",   f"{_df_da.m1_temp.mean():.1f}")
            _mm4.metric("Temp M2 média (°C)",   f"{_df_da.m2_temp.mean():.1f}")

            _fig_da = go.Figure()
            for _col, _lbl, _cor in [
                ("m1_vel", "Motor 1 — Velocidade mm/s", "#7ec8e3"),
                ("m2_vel", "Motor 2 — Velocidade mm/s", "#3498db"),
                ("m1_temp","Motor 1 — Temp °C",         "#f39c12"),
                ("m2_temp","Motor 2 — Temp °C",         "#e67e22"),
            ]:
                _fig_da.add_trace(go.Scattergl(
                    x=_df_da["timestamp"], y=_df_da[_col],
                    mode="lines", name=_lbl,
                    line=dict(width=1.3),
                ))
            _fig_da.update_layout(
                height=300, paper_bgcolor="#060d18", plot_bgcolor="#060d18",
                font_color="#e2eaf4", font_size=11,
                margin=dict(t=10, b=40, l=50, r=20),
                xaxis=dict(gridcolor="#0f2035"),
                yaxis=dict(gridcolor="#0f2035", title="Valor"),
                legend=dict(bgcolor="#0a1628", bordercolor="#0f2a45", borderwidth=1, font_size=10),
            )
            st.plotly_chart(_fig_da, use_container_width=True, key="da_forzy")

    # ── Score de anomalia pelo baseline ML ────────────────────────────────────
    st.markdown('<hr style="border-color:#0f2035;margin:14px 0">', unsafe_allow_html=True)
    st.markdown('<p style="font-size:.72rem;color:#4a7a9b;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Score de Anomalia — Baseline ML</p>', unsafe_allow_html=True)

    from utils.baseline_model import computar_baseline, zscore_leitura, classificar_anomalia
    _bl_da = computar_baseline()

    if leituras_da:
        import pandas as pd
        _last = pd.DataFrame(leituras_da).iloc[-1]
        def _safe(val, fallback):
            try:
                v = float(val)
                return v if v == v else float(fallback)  # NaN check
            except (TypeError, ValueError):
                return float(fallback)
        _leit_da = {
            "m1_vel":  _safe(_last.get("vibracao_mm_s"), _bl_da["m1_vel"]["mean"]),
            "m1_acel": _safe(_last.get("aceleracao_g"),  _bl_da["m1_acel"]["mean"]),
            "m1_temp": _safe(_last.get("temperatura_c"), _bl_da["m1_temp"]["mean"]),
            "m2_vel":  _safe(_last.get("vibracao_mm_s"), _bl_da["m2_vel"]["mean"]),
            "m2_acel": _safe(_last.get("aceleracao_g"),  _bl_da["m2_acel"]["mean"]),
            "m2_temp": _safe(_last.get("temperatura_c"), _bl_da["m2_temp"]["mean"]),
        }
    else:
        # usa última linha do forzy como proxy
        _CSV_BL = Path(__file__).parent.parent / "data" / "forzy.csv"
        import pandas as pd
        _df_bl = pd.read_csv(_CSV_BL, sep=";", skiprows=3, header=None,
            usecols=[0,3,4,5,6,7,8],
            names=["timestamp","m1_vel","m1_acel","m1_temp","m2_vel","m2_acel","m2_temp"])
        for _c in ["m1_vel","m1_acel","m1_temp","m2_vel","m2_acel","m2_temp"]:
            _df_bl[_c] = pd.to_numeric(_df_bl[_c], errors="coerce")
        _row_bl  = _df_bl.dropna().iloc[-1]
        _leit_da = {c: float(_row_bl[c]) for c in ["m1_vel","m1_acel","m1_temp","m2_vel","m2_acel","m2_temp"]}

    _zs_da = zscore_leitura(_leit_da, _bl_da)
    _score_da, _classe_da, _cor_da = classificar_anomalia(_zs_da)

    _ga_da, _gb_da = st.columns([1, 2])
    with _ga_da:
        _fig_gda = go.Figure(go.Indicator(
            mode="gauge+number",
            value=round(_score_da, 2),
            title={"text": "Score Anomalia", "font": {"color": "#e2eaf4", "size": 13}},
            number={"font": {"color": _cor_da, "size": 30}},
            gauge={
                "axis": {"range": [0, 5], "tickcolor": "#4a7a9b", "tickfont": {"color": "#4a7a9b", "size": 9}},
                "bar":  {"color": _cor_da, "thickness": 0.25},
                "bgcolor": "#0a1628", "bordercolor": "#0f2a45",
                "steps": [
                    {"range": [0, 2], "color": "rgba(46,204,113,.15)"},
                    {"range": [2, 3], "color": "rgba(243,156,18,.15)"},
                    {"range": [3, 5], "color": "rgba(231,76,60,.15)"},
                ],
            },
        ))
        _fig_gda.update_layout(height=200, margin=dict(t=40,b=10,l=20,r=20),
                               paper_bgcolor="#060d18", font_color="#e2eaf4")
        st.plotly_chart(_fig_gda, use_container_width=True, key="da_gauge_ml")
        st.markdown(f"""<div style="text-align:center;margin-top:-8px">
          <span style="background:{_cor_da}22;border:1px solid {_cor_da};color:{_cor_da};
                       font-size:.8rem;font-weight:700;padding:4px 16px;border-radius:20px">
            {_classe_da.upper()}
          </span></div>""", unsafe_allow_html=True)

    with _gb_da:
        st.markdown('<p style="font-size:.7rem;color:#4a7a9b;margin-bottom:8px">Z-scores por variável</p>', unsafe_allow_html=True)
        from utils.baseline_model import VARIAVEIS as _VARS_DA
        _z_cols = st.columns(3)
        for _zi, (col, info) in enumerate(_VARS_DA.items()):
            _z = _zs_da[col]
            _, _, _cr = classificar_anomalia({col: _z})
            with _z_cols[_zi % 3]:
                st.markdown(f"""
                <div style="background:#0a1628;border:1px solid #0f2a45;border-left:2px solid {_cr};
                             border-radius:6px;padding:8px 12px;margin-bottom:8px">
                  <div style="font-size:.62rem;color:#4a7a9b">{info['label']}</div>
                  <div style="font-size:.85rem;font-weight:700;color:{_cr}">Z = {_z:.2f}</div>
                </div>""", unsafe_allow_html=True)

    # ── Histórico de atualizações ─────────────────────────────────────────────
    _hist_todos = db.get_historico(limit=100)
    # Filtra registros que mencionam o codigo do ativo nos dados
    hist = [h for h in _hist_todos
            if _da["codigo"] in str(h.get("dados_antes","")) or
               _da["codigo"] in str(h.get("dados_depois",""))][:10]
    if hist:
        st.markdown('<hr style="border-color:#0f2035;margin:14px 0">', unsafe_allow_html=True)
        st.markdown('<p style="font-size:.72rem;color:#4a7a9b;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Histórico de Atualizações</p>', unsafe_allow_html=True)
        import pandas as pd
        _df_h = pd.DataFrame(hist)[["ts","tabela","operacao","dados_antes","dados_depois"]]
        _df_h.columns = ["Data","Tabela","Operação","Antes","Depois"]
        st.dataframe(_df_h, use_container_width=True, hide_index=True)
