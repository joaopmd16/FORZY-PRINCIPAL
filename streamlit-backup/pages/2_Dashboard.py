"""Dashboard consolidado — Monitoramento · Espectral · Operacional · Histórico"""
import math
import numpy as np
import pandas as pd
import plotly.graph_objects as go
import plotly.express as px
from plotly.subplots import make_subplots
import streamlit as st
from pathlib import Path
from datetime import datetime

st.set_page_config(page_title="Dashboard — IMS Forzy", layout="wide")
import sys; sys.path.insert(0, str(Path(__file__).parent.parent))
from utils.theme import apply as _apply_theme, sidebar_nav as _snav
_apply_theme(); _snav("dashboard")

import database
from utils.mock_data import gerar_leitura_simulada, gerar_historico_simulado
from utils.mock_data import MODO_NORMAL, MODO_DESBALANCO, MODO_CAVITACAO, MODO_DESALINHAMENTO

# ── Detecta tab ativo via query_params + JS ───────────────────────────────────
import streamlit.components.v1 as _cv1

# Lê o tab ativo da URL (?tab=0,1,2,3)
_active_tab = int(st.query_params.get("tab", "0"))

# Se veio da sidebar, navega para o tab certo e atualiza query param
_nav_tab = st.session_state.pop("_dash_tab", None)
if _nav_tab is not None:
    st.query_params["tab"] = str(_nav_tab)
    _active_tab = _nav_tab

# JS: ao clicar em qualquer tab, atualiza ?tab=N na URL (dispara rerun)
_cv1.html("""<script>
(function(){
    function attachListeners(){
        var tabs = window.parent.document.querySelectorAll('button[role="tab"]');
        if(!tabs.length){ setTimeout(attachListeners, 100); return; }
        tabs.forEach(function(btn, i){
            btn.addEventListener('click', function(){
                var url = new URL(window.parent.location.href);
                url.searchParams.set('tab', i);
                window.parent.history.replaceState(null, '', url.toString());
            });
        });
    }
    setTimeout(attachListeners, 200);
})();
</script>""", height=0)

# Se tab ativo != 0, força o clique via JS
if _active_tab:
    _cv1.html(f"""<script>
    (function(){{
        function clickTab(){{
            var t = window.parent.document.querySelectorAll('button[role="tab"]');
            if(t.length > {_active_tab}) t[{_active_tab}].click();
            else setTimeout(clickTab, 40);
        }}
        setTimeout(clickTab, 100);
    }})();
    </script>""", height=0)

# ── Barra de ferramentas: Modo TV + Exportar Relatório ───────────────────────
from utils.relatorio import TIPOS_RELATORIO, gerar_relatorios, exportar_csv, exportar_pdf
import time as _time_mod
from datetime import date as _date_cls, timedelta as _timedelta

_tb_col1, _tb_col2 = st.columns([1, 1])

# ── MODO TV ──────────────────────────────────────────────────────────────────
with _tb_col1:
    with st.expander("Modo TV  —  Carrossel automático de abas"):
        _tv_on = st.toggle("Ativar Modo TV", key="tv_mode_on")
        _tv_interval = st.selectbox("Intervalo por aba",
                                    [5, 10, 15, 20, 30],
                                    index=1,
                                    format_func=lambda x: f"{x} segundos",
                                    key="tv_interval_sel")
        _tv_tabs = st.multiselect(
            "Abas no carrossel",
            ["Monitoramento", "Espectral", "Operacional", "Histórico", "Baseline ML"],
            default=["Monitoramento", "Operacional", "Baseline ML"],
            key="tv_tabs_sel",
        )
        if _tv_on and _tv_tabs:
            _n_tv = len(_tv_tabs)
            _ALL_TABS = ["Monitoramento", "Espectral", "Operacional", "Histórico", "Baseline ML"]
            from streamlit_autorefresh import st_autorefresh as _sar_tv
            _sar_tv(interval=_tv_interval * 1000, key="tv_refresh")
            _tv_tick = int(_time_mod.time() // _tv_interval) % _n_tv
            _tv_tab_name = _tv_tabs[_tv_tick]
            _tv_tab_idx  = _ALL_TABS.index(_tv_tab_name) if _tv_tab_name in _ALL_TABS else 0
            import streamlit.components.v1 as _cv1_tv
            _cv1_tv.html(f"""<script>
            (function(){{
                function clickTV(){{
                    var tabs = window.parent.document.querySelectorAll('button[role="tab"]');
                    if(tabs.length > {_tv_tab_idx}) tabs[{_tv_tab_idx}].click();
                    else setTimeout(clickTV, 100);
                }}
                setTimeout(clickTV, 400);
            }})();
            </script>""", height=0)
            st.caption(f"TV: exibindo **{_tv_tab_name}** — proxima em {_tv_interval}s")

# ── EXPORTAR RELATÓRIO ────────────────────────────────────────────────────────
with _tb_col2:
    with st.expander("Exportar Relatório  —  CSV / PDF"):
        _rp_tipos = st.multiselect(
            "Selecione os relatórios",
            TIPOS_RELATORIO,
            default=["Resumo Operacional (Motores)", "Ativos Cadastrados"],
            key="rp_tipos",
        )
        _rp_c1, _rp_c2 = st.columns(2)
        _rp_inicio = _rp_c1.date_input(
            "De", value=_date_cls.today() - _timedelta(days=30), key="rp_inicio"
        )
        _rp_fim = _rp_c2.date_input(
            "Até", value=_date_cls.today(), key="rp_fim"
        )
        _rp_limiar = st.slider(
            "Limiar Z anomalia", min_value=1.0, max_value=4.0, value=2.0,
            step=0.5, key="rp_limiar",
            help="Usado apenas no relatório de Anomalias Detectadas",
        )

        if not _rp_tipos:
            st.caption("Selecione ao menos um relatório.")
        else:
            # Controle de fila: evita geração em loop (mínimo 10s entre exports)
            _rp_last = st.session_state.get("rp_last_export", 0)
            _rp_cooldown = 10
            _rp_restante = max(0, int(_rp_cooldown - (_time_mod.time() - _rp_last)))

            _rb1, _rb2 = st.columns(2)
            _btn_csv = _rb1.button(
                "Baixar CSV",
                disabled=bool(_rp_restante),
                use_container_width=True,
                key="rp_btn_csv",
            )
            _btn_pdf = _rb2.button(
                "Baixar PDF",
                disabled=bool(_rp_restante),
                use_container_width=True,
                key="rp_btn_pdf",
            )
            if _rp_restante:
                st.caption(f"Aguarde {_rp_restante}s para o próximo export.")

            if _btn_csv or _btn_pdf:
                if _rp_inicio > _rp_fim:
                    st.error("Data inicial maior que a final.")
                else:
                    _inicio_dt = datetime.combine(_rp_inicio, datetime.min.time())
                    _fim_dt    = datetime.combine(_rp_fim,    datetime.max.time().replace(microsecond=0))
                    with st.spinner("Gerando relatório..."):
                        _dfs = gerar_relatorios(_rp_tipos, _inicio_dt, _fim_dt, _rp_limiar)
                    st.session_state["rp_last_export"] = _time_mod.time()

                    _nome_base = f"forzy_relatorio_{_date_cls.today().isoformat()}"
                    if _btn_csv:
                        _csv_bytes = exportar_csv(_dfs)
                        st.download_button(
                            "Clique para baixar CSV",
                            data=_csv_bytes,
                            file_name=f"{_nome_base}.csv",
                            mime="text/csv",
                            key="rp_dl_csv",
                        )
                    if _btn_pdf:
                        _pdf_bytes = exportar_pdf(_dfs, _inicio_dt, _fim_dt)
                        st.download_button(
                            "Clique para baixar PDF",
                            data=_pdf_bytes,
                            file_name=f"{_nome_base}.pdf",
                            mime="application/pdf",
                            key="rp_dl_pdf",
                        )

st.markdown('<div style="margin-bottom:6px"></div>', unsafe_allow_html=True)

# ═════════════════════════════════════════════════════════════════════════════
# SELETOR DE FONTE GLOBAL — acima de todas as abas
# ═════════════════════════════════════════════════════════════════════════════
from utils.fonte import render_fonte_selector, FONTE_FORZY, FONTE_SIMULADO, FONTE_ATIVO
_fonte_dados = render_fonte_selector(key_prefix="dash")
_fonte_mon   = _fonte_dados["fonte"]
_leitura_mon = _fonte_dados["leitura"]
_hist_mon    = _fonte_dados["historico"]

# ── Tabs principais ───────────────────────────────────────────────────────────
tab_mon, tab_esp, tab_oper, tab_hist, tab_ml = st.tabs([
    "Monitoramento", "Espectral", "Operacional", "Histórico", "Baseline ML",
])

# ═════════════════════════════════════════════════════════════════════════════
# TAB 1 — MONITORAMENTO
# ═════════════════════════════════════════════════════════════════════════════
with tab_mon:
    # Autorefresh APENAS se o tab Monitoramento estiver ativo
    from streamlit_autorefresh import st_autorefresh as _sar

    # ── Controles de player (só Forzy) ───────────────────────────────────────
    _mc2, _mc3, _mc4, _mc5 = st.columns([1, 1, 1, 1])
    with _mc2:
        _auto = st.toggle("Auto-refresh", value=True, key="mon_autoref")
    with _mc3:
        _interval_ms = st.selectbox("Intervalo", [1000, 2000, 5000], index=1,
                                    format_func=lambda x: f"{x//1000}s",
                                    key="mon_interval")
    with _mc4:
        _step = st.selectbox("Passo", [1, 5, 10, 20], index=1,
                             format_func=lambda x: f"+{x} frames",
                             key="mon_step")
    if _auto and _active_tab == 0:
        _sar(interval=_interval_ms, key="mon_refresh")

    # ── Carrega dataset ───────────────────────────────────────────────────────
    _MON_CSV = Path(__file__).parent.parent / "data" / "forzy.csv"

    @st.cache_data
    def _load_mon(path):
        df = pd.read_csv(path, sep=";", skiprows=3, header=None,
            usecols=[0,3,4,5,6,7,8],
            names=["timestamp","m1_vel","m1_acel","m1_temp","m2_vel","m2_acel","m2_temp"])
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        for c in df.columns[1:]:
            df[c] = pd.to_numeric(df[c], errors="coerce")
        return df.dropna(subset=["m1_vel","m2_vel"]).sort_values("timestamp").reset_index(drop=True)

    if _fonte_mon == FONTE_FORZY and _MON_CSV.exists():
        _df_mon = _load_mon(str(_MON_CSV))
        _N_mon  = len(_df_mon)

        # Frame avança _step posições por rerun
        if "mon_fidx" not in st.session_state:
            st.session_state.mon_fidx = 0
        if _auto and _active_tab == 0:
            st.session_state.mon_fidx = (st.session_state.mon_fidx + _step) % _N_mon
        _row = _df_mon.iloc[st.session_state.mon_fidx]

        m1_vel  = float(_row.m1_vel);  m1_acel = float(_row.m1_acel); m1_temp = float(_row.m1_temp)
        m2_vel  = float(_row.m2_vel);  m2_acel = float(_row.m2_acel); m2_temp = float(_row.m2_temp)
        _ts_label = _row["timestamp"].strftime("%d/%m/%Y  %H:%M:%S")
        _prog = st.session_state.mon_fidx / max(_N_mon - 1, 1)
        st.progress(_prog, text=f"Dataset: frame {st.session_state.mon_fidx+1}/{_N_mon}  —  {_ts_label}")

    elif _fonte_mon == FONTE_ATIVO and _leitura_mon:
        # Ativo cadastrado — usa leitura atual do ativo
        _ativo_info = _fonte_dados.get("ativo") or {}
        def _nan_safe(v, d=0.0):
            try: f=float(v); return d if f!=f else f
            except: return d
        m1_vel  = _nan_safe(_leitura_mon.get("m1_vel"),  0.0)
        m1_acel = _nan_safe(_leitura_mon.get("m1_acel"), 0.0)
        m1_temp = _nan_safe(_leitura_mon.get("m1_temp"), 25.0)
        m2_vel  = _nan_safe(_leitura_mon.get("m2_vel"),  0.0)
        m2_acel = _nan_safe(_leitura_mon.get("m2_acel"), 0.0)
        m2_temp = _nan_safe(_leitura_mon.get("m2_temp"), 25.0)
        _ts_label = _fonte_dados.get("timestamp", "")
        _df_mon = _hist_mon if not _hist_mon.empty else _load_mon(str(_MON_CSV))
        _N_mon  = len(_df_mon)
        if "mon_fidx" not in st.session_state:
            st.session_state.mon_fidx = max(0, _N_mon - 1)
        _cod = _ativo_info.get("codigo","—")
        _tag = _ativo_info.get("tag","—")
        st.caption(f"Ativo: **{_cod}**  TAG: {_tag}  —  {_ts_label}")

    else:
        # Simulado: gera leitura nova a cada rerun
        if "demo_t" not in st.session_state:
            st.session_state.demo_t = 0.0
        st.session_state.demo_t += 1.0
        _modo_sim = st.selectbox("Cenário simulado",
            [MODO_NORMAL, MODO_DESBALANCO, MODO_CAVITACAO, MODO_DESALINHAMENTO],
            format_func=lambda x: {"normal":"Normal","desbalanco":"Desbalanceamento",
                                   "cavitacao":"Cavitação","desalinhamento":"Desalinhamento"}[x],
            key="mon_sim_modo")
        _r1 = gerar_leitura_simulada(t=st.session_state.demo_t, modo=_modo_sim)
        _r2 = gerar_leitura_simulada(t=st.session_state.demo_t + 17.3, modo=_modo_sim)
        m1_vel  = float(_r1.get("vibracao_mm_s", 0)); m1_acel = float(_r1.get("a_peak_g", 0)); m1_temp = float(_r1.get("temperatura_c", 25))
        m2_vel  = float(_r2.get("vibracao_mm_s", 0)); m2_acel = float(_r2.get("a_peak_g", 0)); m2_temp = float(_r2.get("temperatura_c", 25))
        _ts_label = datetime.now().strftime("%H:%M:%S")
        _df_mon = _load_mon(str(_MON_CSV)) if _MON_CSV.exists() else None
        _N_mon  = len(_df_mon) if _df_mon is not None else 0
        if "mon_fidx" not in st.session_state:
            st.session_state.mon_fidx = 0
        st.caption(f"Simulado — {_ts_label}")

    # ── Norma ISO ─────────────────────────────────────────────────────────────
    LIMITES_MON = {
        "ISO 10816 (< 15 kW)":  {"alerta": 1.8, "alarme": 4.5},
        "ISO 20816 (15–75 kW)": {"alerta": 2.3, "alarme": 7.1},
    }
    FLAG_COLOR = {0: "#2ecc71", 1: "#f39c12", 2: "#e74c3c"}
    FLAG_LABEL = {0: "OK", 1: "ALERTA", 2: "ALARME"}

    _nc1, _nc2 = st.columns([3, 1])
    with _nc1:
        _norma = st.selectbox("Norma ISO", list(LIMITES_MON.keys()), key="mon_norma")
    with _nc2:
        st.caption(_ts_label)

    _ISO_A  = LIMITES_MON[_norma]["alerta"]
    _ISO_AL = LIMITES_MON[_norma]["alarme"]
    _TEMP_A, _TEMP_AL = 35.0, 42.0
    _ACEL_A, _ACEL_AL = 0.25, 0.45

    def _flag(v, a, al): return 2 if v >= al else (1 if v >= a else 0)

    def _safe(v, default=0.0):
        try:
            f = float(v)
            return default if (f != f) else f  # NaN check
        except (TypeError, ValueError):
            return default

    def _health(vel, acel, temp):
        vel  = _safe(vel);  acel = _safe(acel);  temp = _safe(temp, 25.0)
        iso  = _ISO_AL if _ISO_AL else 1.0
        acel_al = _ACEL_AL if _ACEL_AL else 1.0
        return max(0, round(100
            - 60*min(vel/iso, 1.0)
            - 25*min(max((temp-35)/45, 0), 1.0)
            - 15*min(acel/acel_al, 1.0)))

    def _gauge_fig(val, title, maximo, unidade, lim_a, lim_al, key):
        fv = _flag(val, lim_a, lim_al)
        fig = go.Figure(go.Indicator(
            mode="gauge+number", value=round(val, 3),
            title={"text": title, "font": {"size": 12}},
            number={"suffix": f" {unidade}", "font": {"size": 16}},
            gauge={
                "axis": {"range": [0, maximo]},
                "bar":  {"color": FLAG_COLOR[fv]},
                "steps": [
                    {"range": [0, lim_a],  "color": "#1a2e1a"},
                    {"range": [lim_a, lim_al], "color": "#2e2200"},
                    {"range": [lim_al, maximo], "color": "#2e0d0d"},
                ],
                "threshold": {"line": {"color": "#e74c3c", "width": 3},
                              "thickness": 0.85, "value": lim_al},
            },
        ))
        fig.update_layout(height=200, margin=dict(l=14,r=14,t=34,b=8),
                          paper_bgcolor="rgba(0,0,0,0)", font_color="#eee")
        return fig

    def _motor_card(col, nome, vel, acel, temp, prefix):
        fv  = _flag(vel,  _ISO_A, _ISO_AL)
        fa  = _flag(acel, _ACEL_A, _ACEL_AL)
        ft  = _flag(temp, _TEMP_A, _TEMP_AL)
        h   = _health(vel, acel, temp)
        hcor = "#2ecc71" if h>=70 else ("#f39c12" if h>=40 else "#e74c3c")
        with col:
            # Banner status
            st.markdown(
                f'<div style="border-radius:8px;padding:8px 16px;font-size:.95rem;font-weight:700;'
                f'text-align:center;color:#fff;background:{FLAG_COLOR[fv]};margin-bottom:8px">'
                f'{nome} — {FLAG_LABEL[fv]}</div>', unsafe_allow_html=True)
            # Health bar
            st.markdown(
                f'<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">'
                f'<span style="font-size:.78rem;color:#aaa;white-space:nowrap">Health Score</span>'
                f'<div style="flex:1;background:#1a2535;border-radius:6px;height:10px;overflow:hidden">'
                f'<div style="width:{h}%;background:{hcor};height:10px;border-radius:6px"></div></div>'
                f'<span style="color:{hcor};font-weight:700;font-size:.85rem">{h}/100</span></div>',
                unsafe_allow_html=True)
            # KPIs
            ka, kb, kc = st.columns(3)
            ka.metric("Velocidade RMS", f"{vel:.3f} mm/s",
                      FLAG_LABEL[fv], delta_color="off")
            kb.metric("Aceleração", f"{acel:.3f} g",
                      FLAG_LABEL[fa], delta_color="off")
            kc.metric("Temperatura", f"{temp:.1f} °C",
                      FLAG_LABEL[ft], delta_color="off")
            # Gauges
            g1, g2, g3 = st.columns(3)
            with g1:
                st.plotly_chart(_gauge_fig(vel, "Vel RMS (mm/s)",
                    max(_ISO_AL*2,10), "mm/s", _ISO_A, _ISO_AL, f"{prefix}_gv"),
                    use_container_width=True, key=f"{prefix}_gv")
            with g2:
                st.plotly_chart(_gauge_fig(acel, "Aceleração (g)",
                    1.0, "g", _ACEL_A, _ACEL_AL, f"{prefix}_ga"),
                    use_container_width=True, key=f"{prefix}_ga")
            with g3:
                st.plotly_chart(_gauge_fig(temp, "Temperatura (°C)",
                    85.0, "°C", _TEMP_A, _TEMP_AL, f"{prefix}_gt"),
                    use_container_width=True, key=f"{prefix}_gt")

    st.markdown("---")
    col_m1, col_sep, col_m2 = st.columns([10, 1, 10])
    col_sep.markdown(
        '<div style="border-left:1px solid #0f2a45;height:100%;min-height:300px"></div>',
        unsafe_allow_html=True)

    _motor_card(col_m1, "Motor 1", m1_vel, m1_acel, m1_temp, "m1")
    _motor_card(col_m2, "Motor 2", m2_vel, m2_acel, m2_temp, "m2")

    # ── Gráficos de histórico recente (janela deslizante) ─────────────────────
    st.divider()
    st.subheader("Histórico Recente")

    _PLOT_STYLE = dict(
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        font_color="#cdd9e5", margin=dict(l=50,r=20,t=36,b=40),
        hovermode="x unified", height=240,
        xaxis=dict(gridcolor="#1a2d3a"),
        yaxis=dict(gridcolor="#1a2d3a"),
        legend=dict(orientation="h", y=1.12, font=dict(size=11)),
    )

    if _fonte_mon == "Dataset Forzy" and _MON_CSV.exists():
        _win = 120  # últimos N frames visíveis
        _i0  = max(0, st.session_state.mon_fidx - _win)
        _i1  = st.session_state.mon_fidx + 1
        _df_win = _df_mon.iloc[_i0:_i1]
        _tx = _df_win["timestamp"]
    else:
        # Simulado: acumula histórico em session_state
        if "sim_hist" not in st.session_state:
            st.session_state.sim_hist = []
        st.session_state.sim_hist.append({
            "ts": datetime.now(), "m1_vel": m1_vel, "m1_acel": m1_acel, "m1_temp": m1_temp,
            "m2_vel": m2_vel, "m2_acel": m2_acel, "m2_temp": m2_temp,
        })
        if len(st.session_state.sim_hist) > 120:
            st.session_state.sim_hist = st.session_state.sim_hist[-120:]
        _df_win = pd.DataFrame(st.session_state.sim_hist)
        _tx = _df_win["ts"]

    _ISO_A_plot  = LIMITES_MON[_norma]["alerta"]
    _ISO_AL_plot = LIMITES_MON[_norma]["alarme"]

    def _line_chart(y1, y2, title, yunit, la, lal, key):
        fig = go.Figure()
        fig.add_trace(go.Scattergl(x=_tx, y=y1, mode="lines", name="Motor 1",
                                   line=dict(color="#3498db", width=1.5)))
        fig.add_trace(go.Scattergl(x=_tx, y=y2, mode="lines", name="Motor 2",
                                   line=dict(color="#9b59b6", width=1.5)))
        if la:
            fig.add_hline(y=la,  line_dash="dot", line_color="#f39c12", line_width=1)
        if lal:
            fig.add_hline(y=lal, line_dash="dot", line_color="#e74c3c", line_width=1)
        fig.update_layout(title=dict(text=f"{title} ({yunit})", font=dict(size=13)),
                          **_PLOT_STYLE)
        st.plotly_chart(fig, use_container_width=True, key=key)

    gc1, gc2, gc3 = st.columns(3)
    with gc1:
        _line_chart(_df_win["m1_vel"], _df_win["m2_vel"],
                    "Velocidade RMS", "mm/s", _ISO_A_plot, _ISO_AL_plot, "mon_chart_vel")
    with gc2:
        _line_chart(_df_win["m1_acel"], _df_win["m2_acel"],
                    "Aceleração", "g", 0.25, 0.45, "mon_chart_acel")
    with gc3:
        _line_chart(_df_win["m1_temp"], _df_win["m2_temp"],
                    "Temperatura", "°C", 35.0, 42.0, "mon_chart_temp")

    with st.expander("Últimas leituras"):
        _cols_show = [c for c in ["timestamp","m1_vel","m1_acel","m1_temp","m2_vel","m2_acel","m2_temp"]
                      if c in _df_win.columns]
        st.dataframe(_df_win[_cols_show].iloc[::-1].head(50), use_container_width=True)


# ═════════════════════════════════════════════════════════════════════════════
# TAB 2 — ESPECTRAL
# ═════════════════════════════════════════════════════════════════════════════
with tab_esp:
    st.subheader("Análise Espectral de Vibração")

    # ── Carrega dataset ────────────────────────────────────────────────────────
    _ESP_CSV = Path(__file__).parent.parent / "data" / "forzy.csv"

    @st.cache_data
    def _load_esp(path):
        df = pd.read_csv(path, sep=";", skiprows=3, header=None,
            usecols=[0,3,4,5,6,7,8],
            names=["timestamp","m1_vel","m1_acel","m1_temp","m2_vel","m2_acel","m2_temp"])
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        for c in df.columns[1:]:
            df[c] = pd.to_numeric(df[c], errors="coerce")
        return df.dropna(subset=["m1_acel","m2_acel"]).sort_values("timestamp").reset_index(drop=True)

    _df_esp = _load_esp(str(_ESP_CSV)) if _ESP_CSV.exists() else None

    # ── Controles ─────────────────────────────────────────────────────────────
    ec1, ec2, ec3, ec4 = st.columns(4)
    with ec1:
        _fonte_esp = st.radio("Fonte", ["Dataset Forzy", "Simulado"], horizontal=True, key="esp_fonte")
    with ec2:
        _motor_esp = st.selectbox("Motor", ["Motor 1", "Motor 2"], key="esp_motor")
    with ec3:
        _rpm_esp = st.slider("RPM (para harmônicas)", 500, 4000, 1780, 10, key="esp_rpm")
    with ec4:
        _janela_n = st.slider("Amostras na janela FFT", 64, 1024, 256, 64, key="esp_janela")

    ec5, ec6 = st.columns(2)
    with ec5: _mostrar_harm = st.toggle("Marcar harmônicas RPM", value=True, key="esp_harm")
    with ec6: _mostrar_bandas = st.toggle("Marcar bandas de falha", value=True, key="esp_bandas")

    _freq_rot = _rpm_esp / 60.0
    _col_acel = "m1_acel" if _motor_esp == "Motor 1" else "m2_acel"

    # ── Sinal para FFT ────────────────────────────────────────────────────────
    # O forzy.csv contém valores RMS agregados (~1 Sa/s) — não waveform bruto.
    # No modo Dataset usamos o RMS medido para parametrizar amplitude do sinal
    # sintético, mantendo fs adequado para FFT de vibração.
    _fs_est = 1000.0  # Sa/s para síntese (Nyquist 500 Hz — faixa de vibração)
    _rng_esp = np.random.default_rng(int(abs(_freq_rot * 100)))
    _t_esp = np.linspace(0, _janela_n / _fs_est, _janela_n, endpoint=False)

    if _fonte_esp == "Dataset Forzy" and _df_esp is not None and len(_df_esp) > 0:
        # Amplitude base = RMS medido pelo sensor no dataset
        _acel_rms = float(_df_esp[_col_acel].median())
        _vel_col   = "m1_vel" if _motor_esp == "Motor 1" else "m2_vel"
        _vel_rms   = float(_df_esp[_vel_col].median())
        # Sinal sintético com amplitude proporcional ao valor real
        _amp1x = _acel_rms * 0.8
        _amp2x = _acel_rms * 0.2
        _sinal = (_rng_esp.normal(0, _acel_rms * 0.05, _janela_n)
                  + _amp1x * np.sin(2*np.pi*_freq_rot*_t_esp)
                  + _amp2x * np.sin(2*np.pi*_freq_rot*2*_t_esp))
        _fonte_label = (f"Dataset Forzy · {_motor_esp} · "
                        f"Acel RMS={_acel_rms:.3f} g · Vel RMS={_vel_rms:.3f} mm/s")
    else:
        _sinal = (_rng_esp.normal(0, 0.005, _janela_n)
                  + 0.04*np.sin(2*np.pi*_freq_rot*_t_esp)
                  + 0.01*np.sin(2*np.pi*_freq_rot*2*_t_esp))
        _fonte_label = f"Simulado · {_motor_esp} · fs={_fs_est:.0f} Sa/s"

    st.caption(_fonte_label)

    # ── FFT ───────────────────────────────────────────────────────────────────
    _sinal = _sinal - _sinal.mean()
    _sinal_w = _sinal * np.hanning(len(_sinal))
    _freqs = np.fft.rfftfreq(len(_sinal), d=1.0/_fs_est)
    _amps  = np.abs(np.fft.rfft(_sinal_w)) * 2 / len(_sinal)
    _idx_p = int(np.argmax(_amps[1:])) + 1
    _freq_p = _freqs[_idx_p]
    _amp_p  = _amps[_idx_p]

    fig_esp = go.Figure()
    fig_esp.add_trace(go.Scatter(x=_freqs, y=_amps, mode="lines", fill="tozeroy",
        line=dict(color="#9b59b6", width=1.5), fillcolor="rgba(155,89,182,0.12)", name="Amplitude (g)"))
    fig_esp.add_vline(x=_freq_p, line_dash="dash", line_color="#e74c3c",
                      annotation_text=f"Pico: {_freq_p:.3f} Hz", annotation_font_color="#e74c3c")
    if _mostrar_harm:
        for _h, _cor, _lbl in [(1,"#3498db","1x"),(2,"#2ecc71","2x"),(3,"#f39c12","3x"),(4,"#e67e22","4x")]:
            _fx = _freq_rot * _h
            if _fx < _freqs[-1]:
                fig_esp.add_vline(x=_fx, line_dash="dot", line_color=_cor, line_width=1,
                                  annotation_text=f"{_lbl} {_fx:.1f}Hz",
                                  annotation_font_color=_cor, annotation_position="top")
    if _mostrar_bandas:
        fig_esp.add_vrect(x0=_freq_rot*0.4, x1=_freq_rot*0.6,
                          fillcolor="rgba(52,152,219,0.06)", annotation_text="Sub-harm.", annotation_font_size=10)
        fig_esp.add_vrect(x0=_freq_rot*0.9, x1=_freq_rot*1.1,
                          fillcolor="rgba(230,126,34,0.07)", annotation_text="Desbal.", annotation_font_size=10)
    fig_esp.update_layout(
        title=f"Espectro FFT — {_fonte_label}",
        xaxis_title="Frequência (Hz)", yaxis_title="Amplitude (g)", height=420,
        margin=dict(l=50,r=30,t=60,b=50), paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(0,0,0,0)", font_color="#eee",
        xaxis=dict(gridcolor="#1a2535"), yaxis=dict(gridcolor="#1a2535"), hovermode="x unified")
    st.plotly_chart(fig_esp, use_container_width=True, key="esp_fft")

    _km1, _km2, _km3, _km4 = st.columns(4)
    _km1.metric("Pico dominante",   f"{_freq_p:.3f} Hz")
    _km2.metric("Amplitude do pico", f"{_amp_p:.4f} g")
    _km3.metric("Freq. rotação (1x)", f"{_freq_rot:.2f} Hz")
    _km4.metric("Relação pico/1x",  f"{_freq_p/_freq_rot:.2f}x" if _freq_rot else "—")

    # ── Espectrograma com dataset real ────────────────────────────────────────
    st.divider()
    st.subheader("Espectrograma — Evolução Temporal")

    if _fonte_esp == "Dataset Forzy" and _df_esp is not None:
        _n_frames_esp = min(40, len(_df_esp) // _janela_n)
        _Z_esp, _t_labels = [], []
        for _fi in range(_n_frames_esp):
            _start = _fi * _janela_n
            _seg = _df_esp[_col_acel].values[_start:_start+_janela_n].astype(float)
            if len(_seg) < _janela_n: break
            _seg -= _seg.mean(); _seg *= np.hanning(_janela_n)
            _Z_esp.append(np.abs(np.fft.rfft(_seg)) * 2 / _janela_n)
            _t_labels.append(str(_df_esp["timestamp"].iloc[_start].strftime("%H:%M:%S")))
        _f_ax_esp = np.fft.rfftfreq(_janela_n, 1.0/_fs_est)
    else:
        _n_frames_esp = 30
        _Z_esp = []
        _t_labels = list(range(_n_frames_esp))
        for _fi in range(_n_frames_esp):
            _seg = _sinal_w if _fi == 0 else _sinal_w * (0.9 + 0.2*np.random.rand())
            _Z_esp.append(np.abs(np.fft.rfft(_seg)) * 2 / len(_seg))
        _f_ax_esp = _freqs

    _Z_esp = np.array(_Z_esp)
    fig_wf = go.Figure(go.Heatmap(
        z=_Z_esp, x=_f_ax_esp, y=_t_labels,
        colorscale="Plasma",
        colorbar=dict(title=dict(text="g", font=dict(color="#eee")), tickfont=dict(color="#eee")),
        hovertemplate="Freq: %{x:.2f} Hz<br>t: %{y}<br>Amp: %{z:.5f} g<extra></extra>"))
    if _mostrar_harm:
        for _h, _cor in [(1,"#3498db"),(2,"#2ecc71"),(3,"#f39c12")]:
            _fx = _freq_rot * _h
            if _fx < _f_ax_esp[-1]:
                fig_wf.add_vline(x=_fx, line_color=_cor, line_width=1.5, line_dash="dot")
    fig_wf.update_layout(
        xaxis_title="Frequência (Hz)", yaxis_title="Tempo", height=380,
        margin=dict(l=70,r=20,t=20,b=50),
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)", font_color="#eee")
    st.plotly_chart(fig_wf, use_container_width=True, key="esp_wf")

    with st.expander("Top 10 picos espectrais"):
        _top_idx = np.argsort(_amps[1:])[::-1][:10] + 1
        _df_picos = pd.DataFrame({
            "Frequência (Hz)": _freqs[_top_idx].round(3),
            "Amplitude (g)":   _amps[_top_idx].round(6),
            "Relação 1x RPM":  (_freqs[_top_idx]/_freq_rot).round(2) if _freq_rot else 0,
        })
        st.dataframe(_df_picos, use_container_width=True, hide_index=True)


# ═════════════════════════════════════════════════════════════════════════════
# TAB 3 — OPERACIONAL (Dataset Forzy)
# ═════════════════════════════════════════════════════════════════════════════
with tab_oper:
    SEARCH_PATHS = [
        Path(__file__).parent.parent / "data" / "forzy.csv",
        Path.home() / "Downloads" / "History_32026-05-19T11-46-10-920.csv",
    ]
    csv_path = next((p for p in SEARCH_PATHS if p.exists()), None)
    if not csv_path:
        st.error("CSV não encontrado. Coloque em `data/forzy.csv`.")
    else:
        @st.cache_data
        def _load_forzy(path):
            df = pd.read_csv(path, sep=";", skiprows=3, header=None,
                usecols=[0,3,4,5,6,7,8],
                names=["timestamp","m1_vel","m1_acel","m1_temp","m2_vel","m2_acel","m2_temp"])
            df["timestamp"] = pd.to_datetime(df["timestamp"])
            for c in df.columns[1:]:
                df[c] = pd.to_numeric(df[c], errors="coerce")
            df = df.dropna(subset=["m1_vel","m2_vel"]).sort_values("timestamp").reset_index(drop=True)
            df = (df.set_index("timestamp").groupby(level=0).mean()
                    .resample("1s").mean().interpolate("linear").reset_index())
            rng = np.random.default_rng(42)
            t   = np.arange(len(df))
            for p in ["m1","m2"]:
                v = df[f"{p}_vel"].values; a = df[f"{p}_acel"].values
                df[f"{p}_vel"]  = np.clip(v + v*0.10*np.sin(2*np.pi*0.15*t) + v*0.05*np.sin(2*np.pi*0.35*t+0.8) + rng.normal(0, np.clip(v*0.04,0.003,0.12)), 0, None)
                df[f"{p}_acel"] = np.clip(a + a*0.12*np.sin(2*np.pi*0.20*t+0.4) + rng.normal(0, np.clip(a*0.05,0.001,0.04)), 0, None)
            return df

        @st.cache_data
        def _compute_flags(path, va, val, aa, aal, ta, tal, t0, t1):
            df = _load_forzy(path)
            df = df[(df.timestamp >= t0) & (df.timestamp <= t1)].copy()
            for m in ["m1","m2"]:
                df[f"{m}_vel_flag"]  = np.where(df[f"{m}_vel"]  >= val, 2, np.where(df[f"{m}_vel"]  >= va,  1, 0)).astype("int8")
                df[f"{m}_acel_flag"] = np.where(df[f"{m}_acel"] >= aal, 2, np.where(df[f"{m}_acel"] >= aa,  1, 0)).astype("int8")
                df[f"{m}_temp_flag"] = np.where(df[f"{m}_temp"] >= tal, 2, np.where(df[f"{m}_temp"] >= ta,  1, 0)).astype("int8")
            return df

        df_forzy = _load_forzy(str(csv_path))
        MAX_DISPLAY = 3000

        def _downsample(df):
            if len(df) <= MAX_DISPLAY: return df
            return df.iloc[::len(df)//MAX_DISPLAY].reset_index(drop=True)

        # Controles inline
        oc1, oc2 = st.columns([2,3])
        with oc1:
            motor_sel = st.radio("Exibir", ["Ambos os motores","Motor 1","Motor 2"],
                                 horizontal=True, key="oper_motor")
        with oc2:
            t_min = df_forzy["timestamp"].min().to_pydatetime()
            t_max = df_forzy["timestamp"].max().to_pydatetime()
            t_range = st.slider("Janela de tempo", min_value=t_min, max_value=t_max,
                                value=(t_min,t_max), format="HH:mm:ss", key="oper_trange")

        with st.expander("Limiares ISO 10816", expanded=False):
            oc3,oc4,oc5,oc6,oc7,oc8 = st.columns(6)
            vel_alerta  = oc3.number_input("Vel. alerta",  value=1.8,  step=0.1, format="%.1f", key="oper_va")
            vel_alarme  = oc4.number_input("Vel. alarme",  value=4.5,  step=0.1, format="%.1f", key="oper_val")
            acel_alerta = oc5.number_input("Acel. alerta", value=0.25, step=0.01,format="%.2f", key="oper_aa")
            acel_alarme = oc6.number_input("Acel. alarme", value=0.45, step=0.01,format="%.2f", key="oper_aal")
            temp_alerta = oc7.number_input("Temp. alerta", value=35.0, step=1.0, format="%.1f", key="oper_ta")
            temp_alarme = oc8.number_input("Temp. alarme", value=42.0, step=1.0, format="%.1f", key="oper_tal")

        df_f = _compute_flags(str(csv_path), vel_alerta, vel_alarme, acel_alerta, acel_alarme,
                              temp_alerta, temp_alarme, str(t_range[0]), str(t_range[1]))
        df_plot = _downsample(df_f)

        COR_O  = {0:"#2ecc71", 1:"#f39c12", 2:"#e74c3c"}
        NOME_O = {0:"OK", 1:"ALERTA", 2:"ALARME"}
        BADGE_O= {0:"#0d3320", 1:"#2e1f00", 2:"#2e0d0d"}
        PLOT_O = dict(paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
                      font_color="#cdd9e5", margin=dict(l=50,r=20,t=30,b=40),
                      xaxis=dict(gridcolor="#1a2d3a"),
                      hovermode="x unified")

        def _flag_o(v, a, al): return 2 if v>=al else 1 if v>=a else 0

        v1  = df_f.m1_vel.iloc[-1];   v2  = df_f.m2_vel.iloc[-1]
        a1  = df_f.m1_acel.iloc[-1];  a2  = df_f.m2_acel.iloc[-1]
        t1_ = df_f.m1_temp.iloc[-1];  t2_ = df_f.m2_temp.iloc[-1]
        f1  = max(_flag_o(v1,vel_alerta,vel_alarme), _flag_o(a1,acel_alerta,acel_alarme), _flag_o(t1_,temp_alerta,temp_alarme))
        f2  = max(_flag_o(v2,vel_alerta,vel_alarme), _flag_o(a2,acel_alerta,acel_alarme), _flag_o(t2_,temp_alerta,temp_alarme))

        # Cards dos motores
        cc1, cc2 = st.columns(2)
        for col_w, prefix, nome, cor_n, fv, vel, acel, temp_, f_g in [
            (cc1,"m1","Motor 1","#3498db",_flag_o(v1,vel_alerta,vel_alarme),v1,a1,t1_,f1),
            (cc2,"m2","Motor 2","#e74c3c",_flag_o(v2,vel_alerta,vel_alarme),v2,a2,t2_,f2),
        ]:
            with col_w:
                n_al = int((df_f[f"{prefix}_vel_flag"]==2).sum())
                st.markdown(f'<div style="background:#0d1b2e;border:1.5px solid {COR_O[f_g]};'
                            f'border-radius:8px;padding:12px 16px;margin-bottom:8px">'
                            f'<span style="font-weight:700;color:{cor_n}">{nome}</span>'
                            f'<span style="float:right;background:{BADGE_O[f_g]};color:{COR_O[f_g]};'
                            f'padding:2px 8px;border-radius:4px;font-size:.75rem">{NOME_O[f_g]}</span></div>',
                            unsafe_allow_html=True)
                mc1,mc2,mc3,mc4 = st.columns(4)
                mc1.metric("Velocidade", f"{vel:.3f} mm/s")
                mc2.metric("Aceleração", f"{acel:.3f} g")
                mc3.metric("Temperatura",f"{temp_:.1f} °C")
                mc4.metric("Alarmes",    str(n_al))

        st.divider()

        # Sub-tabs do Operacional
        sub1, sub2, sub3, sub4, sub5 = st.tabs(["Timeline","Análise","Comparação","Eventos","Estatísticas"])

        with sub1:
            fig_vel_o = go.Figure()
            for col_v, col_fl, nome, cor in [("m1_vel","m1_vel_flag","Motor 1","#3498db"),
                                              ("m2_vel","m2_vel_flag","Motor 2","#e74c3c")]:
                if "Motor" in motor_sel and nome not in motor_sel: continue
                fig_vel_o.add_trace(go.Scattergl(x=df_plot.timestamp, y=df_plot[col_v],
                    mode="lines", name=nome, line=dict(color=cor,width=1.4)))
                alm = df_plot[df_plot[col_fl]==2]
                if not alm.empty:
                    fig_vel_o.add_trace(go.Scattergl(x=alm.timestamp, y=alm[col_v], mode="markers",
                        name=f"{nome} Alarme", marker=dict(color="#e74c3c",size=4,symbol="x")))
            ymax_o = max(vel_alarme*1.4, df_plot.m1_vel.max(), df_plot.m2_vel.max())*1.1
            fig_vel_o.add_hline(y=vel_alerta, line_dash="dot", line_color="#f39c12", line_width=1)
            fig_vel_o.add_hline(y=vel_alarme, line_dash="dot", line_color="#e74c3c", line_width=1)
            fig_vel_o.update_layout(height=320, title="Velocidade RMS (mm/s)", **PLOT_O,
                                    yaxis=dict(gridcolor="#1a2d3a", range=[0,ymax_o]))
            st.plotly_chart(fig_vel_o, use_container_width=True, key="oper_vel")

            col_t_o, col_a_o = st.columns(2)
            for fig_col, c1_, c2_, titulo, unidade, la, lal in [
                (col_t_o,"m1_temp","m2_temp","Temperatura","°C",temp_alerta,temp_alarme),
                (col_a_o,"m1_acel","m2_acel","Aceleração","g",acel_alerta,acel_alarme),
            ]:
                fig_s = go.Figure()
                for cv, nome, cor in [(c1_,"Motor 1","#3498db"),(c2_,"Motor 2","#e74c3c")]:
                    if "Motor" in motor_sel and nome not in motor_sel: continue
                    fig_s.add_trace(go.Scattergl(x=df_plot.timestamp, y=df_plot[cv],
                        mode="lines", name=nome, line=dict(color=cor,width=1.3)))
                fig_s.add_hline(y=la, line_dash="dot", line_color="#f39c12", line_width=1)
                fig_s.add_hline(y=lal, line_dash="dot", line_color="#e74c3c", line_width=1)
                fig_s.update_layout(height=220, title=f"{titulo} ({unidade})", **PLOT_O,
                                    yaxis=dict(gridcolor="#1a2d3a"))
                with fig_col: st.plotly_chart(fig_s, use_container_width=True, key=f"oper_{titulo}")

        with sub2:
            cg1, cg2 = st.columns(2)
            def _gauge_o(val, title, maximo, la, lal, unit):
                fv = _flag_o(val, la, lal)
                fig = go.Figure(go.Indicator(mode="gauge+number", value=val,
                    title=dict(text=title,font=dict(size=12,color="#6b8cae")),
                    number=dict(suffix=f" {unit}",font=dict(size=18,color="#e8f0fe")),
                    gauge=dict(axis=dict(range=[0,maximo]),bar=dict(color=COR_O[fv],thickness=0.25),
                               bgcolor="#0a0f1a",borderwidth=1,bordercolor="#1e3a5c",
                               steps=[dict(range=[0,la],color="#0d1f0d"),
                                      dict(range=[la,lal],color="#1f1400"),
                                      dict(range=[lal,maximo],color="#1f0505")],
                               threshold=dict(line=dict(color="#e74c3c",width=3),thickness=0.8,value=lal))))
                fig.update_layout(height=180,paper_bgcolor="rgba(0,0,0,0)",margin=dict(l=20,r=20,t=30,b=10))
                return fig
            vmax_g = max(vel_alarme*1.5, df_f.m1_vel.max()*1.1, df_f.m2_vel.max()*1.1)
            with cg1:
                st.markdown("#### Motor 1")
                ga,gb,gc = st.columns(3)
                ga.plotly_chart(_gauge_o(v1,"Velocidade",vmax_g,vel_alerta,vel_alarme,"mm/s"), use_container_width=True, key="oper_g1v")
                gb.plotly_chart(_gauge_o(a1,"Aceleração",1.0,acel_alerta,acel_alarme,"g"), use_container_width=True, key="oper_g1a")
                gc.plotly_chart(_gauge_o(t1_,"Temperatura",85,temp_alerta,temp_alarme,"°C"), use_container_width=True, key="oper_g1t")
            with cg2:
                st.markdown("#### Motor 2")
                ga,gb,gc = st.columns(3)
                ga.plotly_chart(_gauge_o(v2,"Velocidade",vmax_g,vel_alerta,vel_alarme,"mm/s"), use_container_width=True, key="oper_g2v")
                gb.plotly_chart(_gauge_o(a2,"Aceleração",1.0,acel_alerta,acel_alarme,"g"), use_container_width=True, key="oper_g2a")
                gc.plotly_chart(_gauge_o(t2_,"Temperatura",85,temp_alerta,temp_alarme,"°C"), use_container_width=True, key="oper_g2t")

            st.divider()
            st.markdown("#### Tendência Preditiva — próximos 30s")
            fig_trend = go.Figure()
            for col_v, nome, cor in [("m1_vel","Motor 1","#3498db"),("m2_vel","Motor 2","#e74c3c")]:
                if "Motor" in motor_sel and nome not in motor_sel: continue
                y = df_plot[col_v].values; x = np.arange(len(y))
                coef = np.polyfit(x, y, 1)
                ts_fut = pd.date_range(df_f.timestamp.iloc[-1], periods=31, freq="1s")[1:]
                y_fut = np.polyval(coef, np.arange(len(y), len(y)+30))
                fig_trend.add_trace(go.Scattergl(x=df_plot.timestamp,y=y,mode="lines",name=nome,line=dict(color=cor,width=1.5)))
                fig_trend.add_trace(go.Scattergl(x=ts_fut,y=y_fut,mode="lines",name=f"{nome} (tendência)",line=dict(color=cor,width=2,dash="dash")))
            fig_trend.add_hline(y=vel_alerta, line_dash="dot", line_color="#f39c12", line_width=1)
            fig_trend.add_hline(y=vel_alarme, line_dash="dot", line_color="#e74c3c", line_width=1)
            fig_trend.update_layout(height=260, **PLOT_O, yaxis=dict(gridcolor="#1a2d3a"))
            st.plotly_chart(fig_trend, use_container_width=True, key="oper_trend")

        with sub3:
            cb1, cb2 = st.columns([3,2])
            with cb1:
                fig_box = make_subplots(1,3,subplot_titles=("Velocidade","Aceleração","Temperatura"))
                for i,(c1__,c2__) in enumerate([("m1_vel","m2_vel"),("m1_acel","m2_acel"),("m1_temp","m2_temp")],1):
                    fig_box.add_trace(go.Box(y=df_f[c1__],name="M1",marker_color="#3498db",boxmean=True,showlegend=(i==1)),1,i)
                    fig_box.add_trace(go.Box(y=df_f[c2__],name="M2",marker_color="#e74c3c",boxmean=True,showlegend=(i==1)),1,i)
                fig_box.update_layout(height=300,paper_bgcolor="rgba(0,0,0,0)",plot_bgcolor="rgba(0,0,0,0)",
                                      font_color="#cdd9e5",margin=dict(l=40,r=10,t=40,b=30),
                                      legend=dict(orientation="h",y=1.1,bgcolor="rgba(0,0,0,0)"))
                fig_box.update_xaxes(gridcolor="#1a2d3a"); fig_box.update_yaxes(gridcolor="#1a2d3a")
                st.plotly_chart(fig_box, use_container_width=True, key="oper_box")
            with cb2:
                cols_corr = ["m1_vel","m1_acel","m1_temp","m2_vel","m2_acel","m2_temp"]
                labels_c  = ["M1 Vel","M1 Acel","M1 Temp","M2 Vel","M2 Acel","M2 Temp"]
                corr = df_f[cols_corr].corr().round(2)
                fig_heat = go.Figure(go.Heatmap(z=corr.values,x=labels_c,y=labels_c,
                    colorscale="RdBu",zmid=0,zmin=-1,zmax=1,
                    text=corr.values.round(2),texttemplate="%{text}",textfont=dict(size=9),
                    colorbar=dict(tickfont=dict(color="#aaa"),thickness=12)))
                fig_heat.update_layout(height=300,paper_bgcolor="rgba(0,0,0,0)",
                                       margin=dict(l=10,r=10,t=20,b=10),font_color="#cdd9e5")
                st.plotly_chart(fig_heat, use_container_width=True, key="oper_heat")

        with sub4:
            eventos = []
            for prefix, nome in [("m1","Motor 1"),("m2","Motor 2")]:
                for var, la, lal, unit in [("vel",vel_alerta,vel_alarme,"mm/s"),
                                            ("acel",acel_alerta,acel_alarme,"g"),
                                            ("temp",temp_alerta,temp_alarme,"°C")]:
                    col_f, col_v = f"{prefix}_{var}_flag", f"{prefix}_{var}"
                    for fval, tipo in [(2,"ALARME"),(1,"Alerta")]:
                        pts = df_f[df_f[col_f]==fval]
                        if not pts.empty:
                            eventos.append({"Motor":nome,"Variável":var.capitalize(),"Tipo":tipo,
                                "Primeiro":pts.timestamp.min().strftime("%H:%M:%S"),
                                "Último":pts.timestamp.max().strftime("%H:%M:%S"),
                                "Pico":f"{pts[col_v].max():.3f} {unit}",
                                "Duração (s)":round((pts.timestamp.max()-pts.timestamp.min()).total_seconds(),1),
                                "Ocorrências":len(pts)})
            if eventos:
                st.dataframe(pd.DataFrame(eventos).sort_values(["Tipo","Motor"]), use_container_width=True, hide_index=True)
            else:
                st.success("Nenhum evento no período.")

        with sub5:
            stats_cols = {"M1 Vel (mm/s)":"m1_vel","M1 Acel (g)":"m1_acel","M1 Temp (°C)":"m1_temp",
                          "M2 Vel (mm/s)":"m2_vel","M2 Acel (g)":"m2_acel","M2 Temp (°C)":"m2_temp"}
            stats = {label:{"Mín":df_f[col].min(),"Média":df_f[col].mean(),"Máx":df_f[col].max(),
                             "Desvio":df_f[col].std(),"P95":df_f[col].quantile(0.95)}
                     for label,col in stats_cols.items()}
            st.dataframe(pd.DataFrame(stats).T.round(4), use_container_width=True)
            st.download_button("Exportar CSV", df_f.to_csv(index=False).encode("utf-8"),
                               "forzy_export.csv","text/csv", use_container_width=True)


# ═════════════════════════════════════════════════════════════════════════════
# TAB 4 — HISTÓRICO / PLAYER
# ═════════════════════════════════════════════════════════════════════════════
with tab_hist:
    st.subheader("▶ Player — Timelapse Operacional")

    SEARCH_PATHS_H = [
        Path(__file__).parent.parent / "data" / "forzy.csv",
        Path.home() / "Downloads" / "History_32026-05-19T11-46-10-920.csv",
    ]
    csv_path_h = next((p for p in SEARCH_PATHS_H if p.exists()), None)
    if not csv_path_h:
        st.error("CSV não encontrado.")
    else:
        @st.cache_data
        def _load_hist(path):
            df = pd.read_csv(path, sep=";", skiprows=3, header=None,
                usecols=[0,3,4,5,6,7,8],
                names=["timestamp","m1_vel","m1_acel","m1_temp","m2_vel","m2_acel","m2_temp"])
            df["timestamp"] = pd.to_datetime(df["timestamp"])
            for c in df.columns[1:]:
                df[c] = pd.to_numeric(df[c], errors="coerce")
            df = df.dropna().sort_values("timestamp").reset_index(drop=True)
            df = (df.set_index("timestamp").groupby(level=0).mean()
                    .resample("200ms").mean().interpolate("linear").reset_index())
            rng = np.random.default_rng(42)
            t   = np.arange(len(df)) * 0.2
            for prefix in ["m1","m2"]:
                v = df[f"{prefix}_vel"].values; a = df[f"{prefix}_acel"].values
                df[f"{prefix}_vel"]  = np.clip(v + v*0.12*np.sin(2*np.pi*0.8*t) + v*0.06*np.sin(2*np.pi*1.7*t+0.8) + rng.normal(0, np.clip(v*0.04,0.003,0.15)), 0, None)
                df[f"{prefix}_acel"] = np.clip(a + a*0.15*np.sin(2*np.pi*1.1*t+0.4) + a*0.07*np.sin(2*np.pi*2.3*t+1.1) + rng.normal(0, np.clip(a*0.05,0.001,0.05)), 0, None)
            return df

        df_raw_h = _load_hist(str(csv_path_h))

        VARIAVEIS_H = {
            "Velocidade": dict(col_m1="m1_vel",col_m2="m2_vel",unidade="mm/s",ylabel="Velocidade (mm/s)",lim_alerta=1.8,lim_alarme=4.5,fmt=".3f"),
            "Aceleração": dict(col_m1="m1_acel",col_m2="m2_acel",unidade="g",ylabel="Aceleração (g)",lim_alerta=0.25,lim_alarme=0.45,fmt=".3f"),
            "Temperatura": dict(col_m1="m1_temp",col_m2="m2_temp",unidade="°C",ylabel="Temperatura (°C)",lim_alerta=35.0,lim_alarme=42.0,fmt=".1f"),
        }

        hc1, hc2, hc3 = st.columns(3)
        with hc1: variavel_sel = st.radio("Variável", list(VARIAVEIS_H.keys()), horizontal=True, key="hist_var")
        with hc2: frame_interval = st.select_slider("Intervalo/frame", ["5s","10s","15s","30s","1min","2min","5min"], value="30s", key="hist_fi")
        with hc3: speed_ms = st.select_slider("Velocidade", [50,100,150,200,300,500,800], value=150,
                                               format_func=lambda x:f"{x} ms/frame", key="hist_spd")
        motores_h = st.multiselect("Motores", ["Motor 1","Motor 2"], default=["Motor 1","Motor 2"], key="hist_mot")

        cfg_h = VARIAVEIS_H[variavel_sel]
        transition_ms = min(speed_ms-30, 80) if speed_ms > 80 else 0

        df_h = (df_raw_h.set_index("timestamp").resample(frame_interval).mean()
                        .dropna(how="all").reset_index())
        if len(df_h) > 300:
            df_h = df_h.iloc[::len(df_h)//300].reset_index(drop=True)

        N_h = len(df_h)
        COL_M1_H = cfg_h["col_m1"]; COL_M2_H = cfg_h["col_m2"]
        Y_MAX_H  = max(df_h[COL_M1_H].max(), df_h[COL_M2_H].max()) * 1.15
        la_h, lal_h = cfg_h["lim_alerta"], cfg_h["lim_alarme"]

        def _ponto_cor_h(v):
            return "#e74c3c" if v>=lal_h else ("#f39c12" if v>=la_h else "#2ecc71")

        frames_h, steps_h = [], []
        for i in range(1, N_h+1):
            sub = df_h.iloc[:i]; last = sub.iloc[-1]
            traces = []
            for col, nome, cor in [(COL_M1_H,"Motor 1","#3498db"),(COL_M2_H,"Motor 2","#e74c3c")]:
                if nome not in motores_h: continue
                traces.append(go.Scatter(x=sub["timestamp"],y=sub[col],mode="lines",line=dict(color=cor,width=2),name=nome))
                traces.append(go.Scatter(x=[last["timestamp"]],y=[last[col]],mode="markers",
                    marker=dict(color=_ponto_cor_h(last[col]),size=12,line=dict(color="white",width=2)),showlegend=False))
            frames_h.append(go.Frame(data=traces,name=str(i)))
            steps_h.append(dict(args=[[str(i)],{"frame":{"duration":speed_ms,"redraw":True},"mode":"immediate","transition":{"duration":transition_ms}}],
                                label=last["timestamp"].strftime("%H:%M:%S"),method="animate"))

        first_h = df_h.iloc[:1]; last0_h = df_h.iloc[0]
        init_traces_h = []
        for col, nome, cor in [(COL_M1_H,"Motor 1","#3498db"),(COL_M2_H,"Motor 2","#e74c3c")]:
            if nome not in motores_h: continue
            init_traces_h += [
                go.Scatter(x=first_h["timestamp"],y=first_h[col],mode="lines",line=dict(color=cor,width=2),name=nome),
                go.Scatter(x=[last0_h["timestamp"]],y=[last0_h[col]],mode="markers",
                           marker=dict(color=_ponto_cor_h(last0_h[col]),size=12,line=dict(color="white",width=2)),showlegend=False),
            ]

        layout_h = go.Layout(
            height=480, hovermode="x unified",
            xaxis=dict(title="Tempo",range=[df_h["timestamp"].min(),df_h["timestamp"].max()],type="date"),
            yaxis=dict(title=cfg_h["ylabel"],range=[0,Y_MAX_H]),
            legend=dict(orientation="h",yanchor="bottom",y=1.02),
            margin=dict(l=60,r=20,t=70,b=130),
            shapes=[
                dict(type="rect",xref="paper",x0=0,x1=1,yref="y",y0=0,y1=la_h,fillcolor="#2ecc71",opacity=0.07,line_width=0),
                dict(type="rect",xref="paper",x0=0,x1=1,yref="y",y0=la_h,y1=lal_h,fillcolor="#f39c12",opacity=0.07,line_width=0),
                dict(type="rect",xref="paper",x0=0,x1=1,yref="y",y0=lal_h,y1=Y_MAX_H,fillcolor="#e74c3c",opacity=0.07,line_width=0),
            ],
            updatemenus=[dict(type="buttons",showactive=False,y=1.20,x=0.5,xanchor="center",
                buttons=[
                    dict(label="▶  Play",method="animate",args=[None,{"frame":{"duration":speed_ms,"redraw":True},"fromcurrent":True,"transition":{"duration":transition_ms}}]),
                    dict(label="⏸  Pause",method="animate",args=[[None],{"frame":{"duration":0,"redraw":False},"mode":"immediate"}]),
                    dict(label="⏮  Reset",method="animate",args=[["1"],{"frame":{"duration":0,"redraw":True},"mode":"immediate"}]),
                ], font=dict(size=14),bgcolor="#1e1e2e",bordercolor="#555")],
            sliders=[dict(active=0,currentvalue=dict(prefix="T: ",visible=True,xanchor="center",font=dict(size=13)),
                          pad=dict(t=50,b=10),len=1.0,x=0,steps=steps_h)],
        )

        st.plotly_chart(go.Figure(data=init_traces_h,layout=layout_h,frames=frames_h),
                        use_container_width=True, key="hist_player")

        st.divider()
        st.caption(f"Estatísticas — {variavel_sel}")
        hk1,hk2,hk3,hk4,hk5,hk6 = st.columns(6)
        hk1.metric("M1 Máx",   f"{df_h[COL_M1_H].max():{cfg_h['fmt']}} {cfg_h['unidade']}")
        hk2.metric("M1 Média", f"{df_h[COL_M1_H].mean():{cfg_h['fmt']}} {cfg_h['unidade']}")
        hk3.metric("M1 Desvio",f"{df_h[COL_M1_H].std():{cfg_h['fmt']}} {cfg_h['unidade']}")
        hk4.metric("M2 Máx",   f"{df_h[COL_M2_H].max():{cfg_h['fmt']}} {cfg_h['unidade']}")
        hk5.metric("M2 Média", f"{df_h[COL_M2_H].mean():{cfg_h['fmt']}} {cfg_h['unidade']}")
        hk6.metric("M2 Desvio",f"{df_h[COL_M2_H].std():{cfg_h['fmt']}} {cfg_h['unidade']}")

# ═════════════════════════════════════════════════════════════════════════════
# TAB 5 — BASELINE ML
# ═════════════════════════════════════════════════════════════════════════════
with tab_ml:
    from utils.baseline_model import (
        computar_baseline, zscore_leitura, classificar_anomalia,
        score_serie_historica, tabela_baseline_formatada, VARIAVEIS,
    )

    st.markdown("""
    <div style="padding:6px 0 18px">
      <div style="font-size:1.05rem;font-weight:700;color:#e2eaf4">Baseline de Operacao — Modelo Estatístico</div>
      <div style="font-size:.78rem;color:#4a7a9b;margin-top:2px">
        Z-score multivariado calculado sobre o histórico completo do Dataset Forzy.
        Score &lt; 2.0 = Normal · 2.0–3.0 = Alerta · &gt; 3.0 = Anomalia
      </div>
    </div>
    """, unsafe_allow_html=True)

    # ── Calcula baseline (cacheado) ───────────────────────────────────────────
    @st.cache_data(show_spinner="Calculando baseline...")
    def _get_baseline():
        return computar_baseline()

    @st.cache_data(show_spinner="Calculando serie historica...")
    def _get_serie():
        return score_serie_historica(n_pontos=400)

    _bl  = _get_baseline()
    _ser = _get_serie()

    # ── Leitura ao vivo vem do seletor global (acima das tabs) ───────────────
    _leitura_viva = {c: float(_leitura_mon.get(c, _bl[c]["mean"])) for c in VARIAVEIS}
    _ts_ml = _fonte_dados.get("timestamp", "—")
    _fonte_label = _fonte_mon
    if _fonte_dados.get("ativo"):
        _fonte_label = f"Ativo: {_fonte_dados['ativo']['codigo']}"
    st.caption(f"Score calculado sobre: **{_fonte_label}**  —  {_ts_ml}")

    _zs = zscore_leitura(_leitura_viva, _bl)
    _score_global, _classe_global, _cor_global = classificar_anomalia(_zs)

    # ── Score global ao vivo ──────────────────────────────────────────────────
    _ga, _gb = st.columns([1, 3])
    with _ga:
        _fig_gauge_ml = go.Figure(go.Indicator(
            mode="gauge+number",
            value=round(_score_global, 2),
            title={"text": "Score Anomalia", "font": {"color": "#e2eaf4", "size": 13}},
            number={"font": {"color": _cor_global, "size": 28}},
            gauge={
                "axis": {"range": [0, 5], "tickcolor": "#4a7a9b",
                         "tickfont": {"color": "#4a7a9b", "size": 9}},
                "bar":  {"color": _cor_global, "thickness": 0.25},
                "bgcolor": "#0a1628",
                "bordercolor": "#0f2a45",
                "steps": [
                    {"range": [0, 2],   "color": "rgba(46,204,113,.15)"},
                    {"range": [2, 3],   "color": "rgba(243,156,18,.15)"},
                    {"range": [3, 5],   "color": "rgba(231,76,60,.15)"},
                ],
                "threshold": {"line": {"color": _cor_global, "width": 2},
                              "thickness": 0.75, "value": _score_global},
            },
        ))
        _fig_gauge_ml.update_layout(
            height=220, margin=dict(t=40, b=10, l=20, r=20),
            paper_bgcolor="#060d18", font_color="#e2eaf4",
        )
        st.plotly_chart(_fig_gauge_ml, use_container_width=True, key="ml_gauge")

        _badge_color = _cor_global
        st.markdown(f"""
        <div style="text-align:center;margin-top:-10px">
          <span style="background:{_badge_color}22;border:1px solid {_badge_color};
                       color:{_badge_color};font-size:.8rem;font-weight:700;
                       padding:5px 18px;border-radius:20px;letter-spacing:.08em">
            {_classe_global.upper()}
          </span>
        </div>
        """, unsafe_allow_html=True)

    with _gb:
        # Z-scores por variável
        _cols_z = st.columns(3)
        _vars_list = list(VARIAVEIS.items())
        for _i, (col, info) in enumerate(_vars_list):
            _z = _zs[col]
            _, _cl, _cr = classificar_anomalia({col: _z})
            _v = _leitura_viva.get(col, 0)
            _mean = _bl[col]["mean"]
            _std  = _bl[col]["std"]
            with _cols_z[_i % 3]:
                st.markdown(f"""
                <div style="background:#0a1628;border:1px solid #0f2a45;border-left:3px solid {_cr};
                             border-radius:8px;padding:10px 14px;margin-bottom:10px">
                  <div style="font-size:.65rem;color:#4a7a9b;text-transform:uppercase;
                               letter-spacing:.08em;margin-bottom:4px">{info['label']}</div>
                  <div style="display:flex;justify-content:space-between;align-items:baseline">
                    <span style="font-size:1.05rem;font-weight:700;color:#e2eaf4">
                      {_v:.3f} {info['unidade']}
                    </span>
                    <span style="font-size:.78rem;color:{_cr};font-weight:600">Z={_z:.2f}</span>
                  </div>
                  <div style="font-size:.7rem;color:#4a7a9b;margin-top:3px">
                    media {_mean:.3f} ± {_std:.3f}
                  </div>
                </div>
                """, unsafe_allow_html=True)

    st.markdown('<hr style="border-color:#0f2035;margin:10px 0 18px">', unsafe_allow_html=True)

    # ── Evolução do score ao longo do dataset ─────────────────────────────────
    st.markdown('<p style="font-size:.75rem;color:#4a7a9b;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Evolucao do Score de Anomalia — Dataset Historico</p>', unsafe_allow_html=True)

    _fig_score = go.Figure()
    _fig_score.add_hrect(y0=0,   y1=2,   fillcolor="rgba(46,204,113,.06)",  line_width=0)
    _fig_score.add_hrect(y0=2,   y1=3,   fillcolor="rgba(243,156,18,.08)",  line_width=0)
    _fig_score.add_hrect(y0=3,   y1=6,   fillcolor="rgba(231,76,60,.08)",   line_width=0)
    _fig_score.add_hline(y=2.0, line_dash="dot", line_color="#f39c12", line_width=1,
                         annotation_text="Alerta (Z=2)", annotation_font_color="#f39c12",
                         annotation_font_size=10)
    _fig_score.add_hline(y=3.0, line_dash="dot", line_color="#e74c3c", line_width=1,
                         annotation_text="Anomalia (Z=3)", annotation_font_color="#e74c3c",
                         annotation_font_size=10)
    _fig_score.add_trace(go.Scattergl(
        x=_ser["timestamp"], y=_ser["score"],
        mode="lines",
        line=dict(color="#7ec8e3", width=1.2),
        name="Score Z-score",
        hovertemplate="<b>%{x}</b><br>Score: %{y:.3f}<extra></extra>",
    ))
    _fig_score.update_layout(
        height=260,
        paper_bgcolor="#060d18", plot_bgcolor="#060d18",
        font_color="#e2eaf4", font_size=11,
        margin=dict(t=10, b=40, l=50, r=20),
        xaxis=dict(gridcolor="#0f2035", showgrid=True, title=""),
        yaxis=dict(gridcolor="#0f2035", showgrid=True, title="Score Z-score", range=[0, None]),
        showlegend=False,
    )
    st.plotly_chart(_fig_score, use_container_width=True, key="ml_score_hist")

    # ── Z-scores individuais ao longo do tempo ───────────────────────────────
    st.markdown('<p style="font-size:.75rem;color:#4a7a9b;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Z-scores Individuais por Variavel</p>', unsafe_allow_html=True)

    _var_opcoes = {info["label"]: col for col, info in VARIAVEIS.items()}
    _var_sel_ml = st.multiselect(
        "Variaveis", list(_var_opcoes.keys()),
        default=["Motor 1 — Velocidade", "Motor 2 — Velocidade"],
        key="ml_vars_sel",
    )

    _CORES_ML = ["#3498db", "#2ecc71", "#e74c3c", "#f39c12", "#9b59b6", "#1abc9c"]
    _fig_z = go.Figure()
    for _ci, _vl in enumerate(_var_sel_ml):
        _col = _var_opcoes[_vl]
        _zcol = f"z_{_col}"
        if _zcol in _ser.columns:
            _fig_z.add_trace(go.Scattergl(
                x=_ser["timestamp"], y=_ser[_zcol],
                mode="lines", name=_vl,
                line=dict(color=_CORES_ML[_ci % len(_CORES_ML)], width=1.2),
                hovertemplate=f"<b>{_vl}</b><br>Z: %{{y:.3f}}<extra></extra>",
            ))
    _fig_z.add_hline(y=2.0, line_dash="dot", line_color="#f39c12", line_width=1)
    _fig_z.add_hline(y=3.0, line_dash="dot", line_color="#e74c3c", line_width=1)
    _fig_z.update_layout(
        height=250,
        paper_bgcolor="#060d18", plot_bgcolor="#060d18",
        font_color="#e2eaf4", font_size=11,
        margin=dict(t=10, b=40, l=50, r=20),
        xaxis=dict(gridcolor="#0f2035", showgrid=True),
        yaxis=dict(gridcolor="#0f2035", showgrid=True, title="Z-score"),
        legend=dict(bgcolor="#0a1628", bordercolor="#0f2a45", borderwidth=1,
                    font=dict(size=10)),
    )
    st.plotly_chart(_fig_z, use_container_width=True, key="ml_z_vars")

    # ── Tabela do baseline ────────────────────────────────────────────────────
    st.markdown('<p style="font-size:.75rem;color:#4a7a9b;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin:14px 0 6px">Estatísticas do Baseline (Dataset Completo)</p>', unsafe_allow_html=True)
    st.dataframe(tabela_baseline_formatada(), use_container_width=True, hide_index=True)
