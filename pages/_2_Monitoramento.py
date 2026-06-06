"""Dashboard em tempo real — sensor VIM32PL (4 canais) com modo demo."""
import math
import time

import pandas as pd
import plotly.graph_objects as go
import plotly.express as px
from plotly.subplots import make_subplots
import streamlit as st
from streamlit_autorefresh import st_autorefresh

import database
from utils.mock_data import gerar_leitura_simulada, gerar_historico_simulado

ATIVO_ID = "MTR-VIM32-01"

# ISO 10816 Classe I / ISO 20816 Classe II
LIMITES = {
    "ISO 10816 (< 15 kW)":  {"alerta": 1.8, "alarme": 4.5},
    "ISO 20816 (15–75 kW)": {"alerta": 2.3, "alarme": 7.1},
}

FLAG_COLOR = {0: "#2ecc71", 1: "#f39c12", 2: "#e74c3c"}
FLAG_LABEL = {0: "OK", 1: "ALERTA", 2: "ALARME"}

st.set_page_config(page_title="Dashboard — Digital TWIN", layout="wide")
import sys; sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent.parent))
from utils.theme import apply as _apply_theme, sidebar_header as _sh
_apply_theme(); _sh()

st_autorefresh(interval=2000, key="dash_refresh")

# ── CSS ───────────────────────────────────────────────────────────────────────
st.markdown("""
<style>
.status-banner { border-radius:10px; padding:14px 24px; font-size:1.15rem;
                 font-weight:bold; text-align:center; color:white; margin-bottom:8px; }
.health-bar-bg { background:#333; border-radius:8px; height:18px; overflow:hidden; }
.health-bar    { height:18px; border-radius:8px; transition:width .4s ease; }
</style>
""", unsafe_allow_html=True)

# ── Sidebar ───────────────────────────────────────────────────────────────────
with st.sidebar:
    st.header("⚙️ Configurações")
    norma = st.selectbox("Norma ISO", list(LIMITES.keys()))
    modo_demo = st.toggle("Modo Demo (simulação)", value=True)
    if modo_demo:
        modo_falha = st.selectbox(
            "Cenário de falha",
            ["normal", "desbalanco", "cavitacao", "desalinhamento"],
            format_func=lambda x: {
                "normal": "✅ Normal",
                "desbalanco": "⚠️ Desbalanceamento",
                "cavitacao": "🌊 Cavitação",
                "desalinhamento": "❌ Desalinhamento",
            }[x]
        )

ISO_ALERTA = LIMITES[norma]["alerta"]
ISO_ALARME = LIMITES[norma]["alarme"]

# ── Carregar / gerar dados ────────────────────────────────────────────────────
if modo_demo:
    if "demo_hist" not in st.session_state:
        st.session_state.demo_hist = gerar_historico_simulado(300, incluir_falha=False)
        st.session_state.demo_t = 300.0

    st.session_state.demo_t += 1.0
    nova = gerar_leitura_simulada(t=st.session_state.demo_t, modo=modo_falha)
    st.session_state.demo_hist.append(nova)
    if len(st.session_state.demo_hist) > 400:
        st.session_state.demo_hist = st.session_state.demo_hist[-400:]
    rows = st.session_state.demo_hist
else:
    rows = database.get_leituras(ativo_id=ATIVO_ID, limit=300)
    if not rows:
        st.warning("Sem dados no banco. Ative o **Modo Demo** na barra lateral.")
        st.stop()

df = pd.DataFrame(rows)
if "coletado_em" in df.columns:
    df["coletado_em"] = pd.to_datetime(df["coletado_em"])
    df = df.sort_values("coletado_em")
else:
    df["coletado_em"] = pd.date_range(end=pd.Timestamp.now(), periods=len(df), freq="2s")

ultima = df.iloc[-1]
vib   = float(ultima.get("vibracao_mm_s") or 0)
temp  = float(ultima.get("temperatura_c") or 0)
apeak = float(ultima.get("a_peak_g") or 0)
arms  = float(ultima.get("mag_rms") or 0)
freq  = float(ultima.get("freq_hz") or 0)

flag_atual = 2 if vib >= ISO_ALARME else (1 if vib >= ISO_ALERTA else 0)

# ── Health Score ──────────────────────────────────────────────────────────────
vib_ratio  = min(vib / ISO_ALARME, 1.0)
temp_ratio = min(max((temp - 35) / 45, 0), 1.0)
peak_ratio = min(apeak / 5.0, 1.0)
health = max(0, round(100 - 60 * vib_ratio - 25 * temp_ratio - 15 * peak_ratio))
health_cor = "#2ecc71" if health >= 70 else ("#f39c12" if health >= 40 else "#e74c3c")

# ── Título ────────────────────────────────────────────────────────────────────
st.title("📊 Dashboard — Bomba Industrial")
st.caption(f"Sensor: Pepperl+Fuchs VIM32PL · Norma: {norma}")

# ── Banner de status ──────────────────────────────────────────────────────────
cor = FLAG_COLOR[flag_atual]
st.markdown(
    f'<div class="status-banner" style="background:{cor}">'
    f'Status {norma}: {FLAG_LABEL[flag_atual]} — {vib:.3f} mm/s'
    f'</div>',
    unsafe_allow_html=True,
)

# ── Health Score bar ──────────────────────────────────────────────────────────
st.markdown(
    f'<div style="display:flex;align-items:center;gap:12px;margin:8px 0 16px 0">'
    f'<span style="color:#aaa;font-size:.9rem;white-space:nowrap">Health Score</span>'
    f'<div class="health-bar-bg" style="flex:1">'
    f'  <div class="health-bar" style="width:{health}%;background:{health_cor}"></div>'
    f'</div>'
    f'<span style="color:{health_cor};font-weight:bold;font-size:1.1rem;white-space:nowrap">{health}/100</span>'
    f'</div>',
    unsafe_allow_html=True,
)

# ── KPIs ──────────────────────────────────────────────────────────────────────
k1, k2, k3, k4, k5, k6 = st.columns(6)
k1.metric("Vibração RMS",     f"{vib:.3f} mm/s",  FLAG_LABEL[flag_atual], delta_color="off")
k2.metric("Acel. Pico",       f"{apeak:.3f} g",   help="Canal ② VIM32PL — aceleração de pico")
k3.metric("Acel. RMS",        f"{arms:.4f} g",    help="Canal ③ VIM32PL — aceleração RMS")
k4.metric("Temperatura",      f"{temp:.1f} °C",   help="Canal ④ VIM32PL")
k5.metric("Freq. dominante",  f"{freq:.1f} Hz")
k6.metric("Alarmes (300 pts)",
          str(int((df["flag_anomalia"] >= 2).sum() if "flag_anomalia" in df.columns else 0)))

st.divider()

# ── Gauges ────────────────────────────────────────────────────────────────────
st.subheader("Gauges — Estado Atual")
g1, g2, g3, g4 = st.columns(4)

def gauge(val, title, maximo, unidade, limiar_a, limiar_al):
    fig = go.Figure(go.Indicator(
        mode="gauge+number",
        value=val,
        title={"text": title, "font": {"size": 13}},
        number={"suffix": f" {unidade}", "font": {"size": 18}},
        gauge={
            "axis": {"range": [0, maximo]},
            "bar":  {"color": FLAG_COLOR[2 if val >= limiar_al else (1 if val >= limiar_a else 0)]},
            "steps": [
                {"range": [0, limiar_a],         "color": "#1a2e1a"},
                {"range": [limiar_a, limiar_al],  "color": "#2e2200"},
                {"range": [limiar_al, maximo],    "color": "#2e0d0d"},
            ],
            "threshold": {"line": {"color": "#e74c3c", "width": 3},
                          "thickness": 0.85, "value": limiar_al},
        },
    ))
    fig.update_layout(height=220, margin=dict(l=20, r=20, t=30, b=10),
                      paper_bgcolor="rgba(0,0,0,0)", font_color="#eee")
    return fig

with g1:
    st.plotly_chart(gauge(vib, "Vibração RMS (mm/s)",
                          max(ISO_ALARME * 2, 10), "mm/s", ISO_ALERTA, ISO_ALARME),
                    use_container_width=True)
with g2:
    st.plotly_chart(gauge(apeak, "Acel. Pico (g)", 5.0, "g", 0.3, 0.5),
                    use_container_width=True)
with g3:
    st.plotly_chart(gauge(arms, "Acel. RMS (g)", 3.0, "g", 0.2, 0.4),
                    use_container_width=True)
with g4:
    st.plotly_chart(gauge(temp, "Temperatura (°C)", 85.0, "°C", 60.0, 75.0),
                    use_container_width=True)

st.divider()

# ── Gráfico temporal principal ────────────────────────────────────────────────
st.subheader("Velocidade de Vibração RMS — Histórico")
fig_vib = go.Figure()
fig_vib.add_trace(go.Scatter(
    x=df["coletado_em"], y=df["vibracao_mm_s"],
    mode="lines", name="Vibração RMS",
    line=dict(color="#3498db", width=1.5),
    fill="tozeroy", fillcolor="rgba(52,152,219,0.08)",
))
vib_max_plot = max(ISO_ALARME * 2, df["vibracao_mm_s"].max() * 1.2)
fig_vib.add_hrect(y0=0, y1=ISO_ALERTA,         fillcolor="#2ecc71", opacity=0.07,
                  annotation_text="OK", annotation_position="left")
fig_vib.add_hrect(y0=ISO_ALERTA, y1=ISO_ALARME, fillcolor="#f39c12", opacity=0.07,
                  annotation_text="Alerta", annotation_position="left")
fig_vib.add_hrect(y0=ISO_ALARME, y1=vib_max_plot, fillcolor="#e74c3c", opacity=0.07,
                  annotation_text="Alarme", annotation_position="left")
fig_vib.add_hline(y=ISO_ALERTA, line_dash="dash", line_color="#f39c12", line_width=1)
fig_vib.add_hline(y=ISO_ALARME, line_dash="dash", line_color="#e74c3c", line_width=1)
fig_vib.update_layout(height=320, xaxis_title="Tempo", yaxis_title="mm/s",
                      hovermode="x unified", margin=dict(l=50, r=20, t=30, b=40),
                      paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
                      font_color="#eee", xaxis=dict(gridcolor="#222"),
                      yaxis=dict(gridcolor="#222"))
st.plotly_chart(fig_vib, use_container_width=True)

# ── Aceleração pico + temperatura ─────────────────────────────────────────────
col_a, col_b = st.columns(2)

with col_a:
    st.subheader("Aceleração de Pico (g)")
    if "a_peak_g" in df.columns:
        fig_pk = go.Figure(go.Scatter(
            x=df["coletado_em"], y=df["a_peak_g"],
            mode="lines", name="a_peak",
            line=dict(color="#9b59b6", width=1.4),
            fill="tozeroy", fillcolor="rgba(155,89,182,0.07)",
        ))
    else:
        fig_pk = go.Figure(go.Scatter(
            x=df["coletado_em"], y=df.get("mag_rms", [0] * len(df)),
            mode="lines", name="Acel.", line=dict(color="#9b59b6", width=1.4),
        ))
    fig_pk.add_hline(y=0.3, line_dash="dash", line_color="#f39c12", line_width=1)
    fig_pk.add_hline(y=0.5, line_dash="dash", line_color="#e74c3c", line_width=1)
    fig_pk.update_layout(height=280, xaxis_title="Tempo", yaxis_title="g",
                         margin=dict(l=50, r=20, t=20, b=40),
                         paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
                         font_color="#eee", xaxis=dict(gridcolor="#222"),
                         yaxis=dict(gridcolor="#222"))
    st.plotly_chart(fig_pk, use_container_width=True)

with col_b:
    st.subheader("Temperatura (°C)")
    fig_temp = go.Figure(go.Scatter(
        x=df["coletado_em"], y=df["temperatura_c"],
        mode="lines", name="Temperatura",
        line=dict(color="#e67e22", width=1.5),
        fill="tozeroy", fillcolor="rgba(230,126,34,0.07)",
    ))
    fig_temp.add_hline(y=60, line_dash="dash", line_color="#f39c12", line_width=1)
    fig_temp.add_hline(y=75, line_dash="dash", line_color="#e74c3c", line_width=1)
    fig_temp.update_layout(height=280, xaxis_title="Tempo", yaxis_title="°C",
                           margin=dict(l=50, r=20, t=20, b=40),
                           paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
                           font_color="#eee", xaxis=dict(gridcolor="#222"),
                           yaxis=dict(gridcolor="#222"))
    st.plotly_chart(fig_temp, use_container_width=True)

# ── Distribuição ──────────────────────────────────────────────────────────────
st.subheader("Distribuição Estatística — Vibração RMS")
fig_hist = px.histogram(df, x="vibracao_mm_s", nbins=40,
                        color_discrete_sequence=["#3498db"],
                        labels={"vibracao_mm_s": "Vibração RMS (mm/s)"})
fig_hist.add_vline(x=ISO_ALERTA, line_dash="dash", line_color="#f39c12",
                   annotation_text=f"{ISO_ALERTA} mm/s (alerta)")
fig_hist.add_vline(x=ISO_ALARME, line_dash="dash", line_color="#e74c3c",
                   annotation_text=f"{ISO_ALARME} mm/s (alarme)")
fig_hist.update_layout(height=260, margin=dict(l=40, r=20, t=20, b=30),
                       paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
                       font_color="#eee")
st.plotly_chart(fig_hist, use_container_width=True)

# ── Tabela ────────────────────────────────────────────────────────────────────
with st.expander("Últimas leituras brutas"):
    cols_show = [c for c in ["coletado_em", "vibracao_mm_s", "a_peak_g", "mag_rms",
                              "freq_hz", "temperatura_c", "flag_anomalia", "modo_falha", "fonte"]
                 if c in df.columns]
    st.dataframe(df[cols_show].tail(50).iloc[::-1], use_container_width=True)
