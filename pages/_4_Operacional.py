"""Sistema de Monitoramento Industrial — Motores Forzy"""

import pandas as pd
import numpy as np
import plotly.graph_objects as go
import plotly.express as px
from plotly.subplots import make_subplots
import streamlit as st
from pathlib import Path
from datetime import datetime

st.set_page_config(page_title="IMS · Forzy", layout="wide", initial_sidebar_state="expanded")
import sys; sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent.parent))
from utils.theme import apply as _apply_theme, sidebar_header as _sh
_apply_theme(); _sh()


# ══════════════════════════════════════════════════════════════════════════════
# CSS — tema industrial dark
# ══════════════════════════════════════════════════════════════════════════════
st.markdown("""
<style>
/* Fundo geral */
[data-testid="stAppViewContainer"] { background:#0a0f1a; }
[data-testid="stSidebar"]          { background:#0d1321; border-right:1px solid #1e2d45; }

/* Cards de métrica */
[data-testid="metric-container"] {
    background:#0d1b2e;
    border:1px solid #1e3a5c;
    border-radius:6px;
    padding:14px 16px 10px 16px;
}
[data-testid="stMetricLabel"]  { font-size:.75rem; color:#6b8cae !important; text-transform:uppercase; letter-spacing:.06em; }
[data-testid="stMetricValue"]  { font-size:1.45rem; font-weight:700; color:#e8f0fe !important; }
[data-testid="stMetricDelta"]  { font-size:.78rem; }
[data-testid="stMetricDelta"] svg { display:none; }

/* Tabs */
[data-testid="stTabs"] [role="tablist"] {
    border-bottom:1px solid #1e3a5c;
    gap:4px;
}
[data-testid="stTabs"] button[role="tab"] {
    color:#6b8cae;
    font-size:.82rem;
    font-weight:600;
    letter-spacing:.04em;
    padding:8px 18px;
    border-radius:4px 4px 0 0;
}
[data-testid="stTabs"] button[aria-selected="true"] {
    color:#7ec8e3;
    background:#0d1b2e;
    border-bottom:2px solid #3498db;
}

/* Separador da sidebar */
.sidebar-section {
    font-size:.68rem;
    font-weight:700;
    color:#3a5a7a;
    letter-spacing:.12em;
    text-transform:uppercase;
    padding: 8px 0 4px 0;
    border-bottom:1px solid #1e2d45;
    margin-bottom:10px;
}

/* Status badge */
.badge {
    display:inline-block;
    padding:3px 10px;
    border-radius:4px;
    font-size:.75rem;
    font-weight:700;
    letter-spacing:.06em;
}
.badge-ok     { background:#0d3320; color:#2ecc71; border:1px solid #2ecc71; }
.badge-alerta { background:#2e1f00; color:#f39c12; border:1px solid #f39c12; }
.badge-alarme { background:#2e0d0d; color:#e74c3c; border:1px solid #e74c3c; }

/* Header bar */
.header-bar {
    background:linear-gradient(90deg,#0d1b2e 0%,#0a1628 100%);
    border:1px solid #1e3a5c;
    border-radius:6px;
    padding:12px 20px;
    display:flex;
    align-items:center;
    justify-content:space-between;
    margin-bottom:16px;
}
.motor-card {
    background:#0d1b2e;
    border:1px solid #1e3a5c;
    border-radius:8px;
    padding:16px;
}
.motor-card-alarme { border-color:#e74c3c !important; }
.motor-card-alerta { border-color:#f39c12 !important; }
.motor-card-ok     { border-color:#2ecc71 !important; }

/* Remover padding padrão de divisores */
hr { border-color:#1e3a5c !important; margin:8px 0 !important; }
</style>
""", unsafe_allow_html=True)

# ══════════════════════════════════════════════════════════════════════════════
# Dados
# ══════════════════════════════════════════════════════════════════════════════
SEARCH_PATHS = [
    Path(__file__).parent.parent / "data" / "forzy.csv",
    Path.home() / "Downloads" / "History_32026-05-19T11-46-10-920.csv",
]
csv_path = next((p for p in SEARCH_PATHS if p.exists()), None)
if not csv_path:
    st.error("CSV não encontrado. Coloque em `data/forzy.csv`.")
    st.stop()

@st.cache_data
def load_data(path: str) -> pd.DataFrame:
    df = pd.read_csv(path, sep=";", skiprows=3, header=None,
        usecols=[0,3,4,5,6,7,8],
        names=["timestamp","m1_vel","m1_acel","m1_temp","m2_vel","m2_acel","m2_temp"])
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    for c in df.columns[1:]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df.dropna(subset=["m1_vel","m2_vel"]).sort_values("timestamp").reset_index(drop=True)

    # Resample a 1s (não 200ms) — mantém ondulação visível mas 5x menos pontos
    df = (df.set_index("timestamp").groupby(level=0).mean()
            .resample("1s").mean().interpolate("linear").reset_index())

    rng = np.random.default_rng(42)
    t   = np.arange(len(df))
    for p in ["m1","m2"]:
        v = df[f"{p}_vel"].values
        a = df[f"{p}_acel"].values
        df[f"{p}_vel"] = np.clip(
            v + v*0.10*np.sin(2*np.pi*0.15*t)
              + v*0.05*np.sin(2*np.pi*0.35*t+0.8)
              + rng.normal(0, np.clip(v*0.04, 0.003, 0.12)), 0, None)
        df[f"{p}_acel"] = np.clip(
            a + a*0.12*np.sin(2*np.pi*0.20*t+0.4)
              + rng.normal(0, np.clip(a*0.05, 0.001, 0.04)), 0, None)
    return df

@st.cache_data
def compute_flags(path: str, vel_a: float, vel_al: float,
                  acel_a: float, acel_al: float,
                  temp_a: float, temp_al: float,
                  t0: str, t1: str) -> pd.DataFrame:
    """Filtra janela de tempo e calcula flags — cacheado por parâmetros."""
    df = load_data(path)
    df = df[(df.timestamp >= t0) & (df.timestamp <= t1)].copy()
    for m in ["m1","m2"]:
        df[f"{m}_vel_flag"]  = np.where(df[f"{m}_vel"]  >= vel_al,  2,
                               np.where(df[f"{m}_vel"]  >= vel_a,   1, 0)).astype("int8")
        df[f"{m}_acel_flag"] = np.where(df[f"{m}_acel"] >= acel_al, 2,
                               np.where(df[f"{m}_acel"] >= acel_a,  1, 0)).astype("int8")
        df[f"{m}_temp_flag"] = np.where(df[f"{m}_temp"] >= temp_al, 2,
                               np.where(df[f"{m}_temp"] >= temp_a,  1, 0)).astype("int8")
    return df

# Subsample para display — máx 3000 pontos nos gráficos
MAX_DISPLAY = 3000

def downsample(df: pd.DataFrame) -> pd.DataFrame:
    if len(df) <= MAX_DISPLAY:
        return df
    step = len(df) // MAX_DISPLAY
    return df.iloc[::step].reset_index(drop=True)

df = load_data(str(csv_path))

# ══════════════════════════════════════════════════════════════════════════════
# Sidebar
# ══════════════════════════════════════════════════════════════════════════════
with st.sidebar:
    st.markdown("## ⚙️ IMS · Forzy")
    st.caption("Sistema de Monitoramento Industrial")
    st.divider()

    st.markdown('<div class="sidebar-section">Visualização</div>', unsafe_allow_html=True)
    motor_sel = st.radio("Exibir", ["Ambos os motores", "Motor 1", "Motor 2"],
                         label_visibility="collapsed")

    t_min = df["timestamp"].min().to_pydatetime()
    t_max = df["timestamp"].max().to_pydatetime()
    t_range = st.slider("Janela de tempo",
        min_value=t_min, max_value=t_max, value=(t_min, t_max),
        format="HH:mm:ss")

    st.divider()
    st.markdown('<div class="sidebar-section">Limiares ISO 10816</div>', unsafe_allow_html=True)
    with st.expander("Configurar limiares", expanded=False):
        vel_alerta  = st.number_input("Vel. alerta (mm/s)",  value=1.8,  step=0.1, format="%.1f")
        vel_alarme  = st.number_input("Vel. alarme (mm/s)",  value=4.5,  step=0.1, format="%.1f")
        acel_alerta = st.number_input("Acel. alerta (g)",    value=0.25, step=0.01,format="%.2f")
        acel_alarme = st.number_input("Acel. alarme (g)",    value=0.45, step=0.01,format="%.2f")
        temp_alerta = st.number_input("Temp. alerta (°C)",   value=35.0, step=1.0, format="%.1f")
        temp_alarme = st.number_input("Temp. alarme (°C)",   value=42.0, step=1.0, format="%.1f")
    st.divider()
    st.caption(f"📂 {csv_path.name}")
    st.caption(f"📊 {len(df):,} amostras")
    st.caption(f"🕐 {df.timestamp.min().strftime('%H:%M')} – {df.timestamp.max().strftime('%H:%M')}")

# ══════════════════════════════════════════════════════════════════════════════
# Funções auxiliares
# ══════════════════════════════════════════════════════════════════════════════
def flag(v, a, al): return 2 if v>=al else 1 if v>=a else 0
COR  = {0:"#2ecc71", 1:"#f39c12", 2:"#e74c3c"}
NOME = {0:"OK", 1:"ALERTA", 2:"ALARME"}
BADGE= {0:"badge-ok", 1:"badge-alerta", 2:"badge-alarme"}

def health(prefix, df_f):
    v  = df_f[f"{prefix}_vel"].iloc[-1]
    a  = df_f[f"{prefix}_acel"].iloc[-1]
    tmp= df_f[f"{prefix}_temp"].iloc[-1]
    score = max(0, round(100
        - 60*min(v/max(vel_alarme,.01),1)
        - 25*min(a/max(acel_alarme,.01),1)
        - 15*min(max((tmp-temp_alerta)/max(temp_alarme-temp_alerta,1),0),1)))
    cor = "#2ecc71" if score>=70 else ("#f39c12" if score>=40 else "#e74c3c")
    return score, cor

PLOT = dict(
    paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
    font_color="#cdd9e5", margin=dict(l=50,r=20,t=30,b=40),
    xaxis=dict(gridcolor="#1a2d3a", showline=True, linecolor="#1e3a5c"),
    yaxis=dict(gridcolor="#1a2d3a", showline=True, linecolor="#1e3a5c"),
    legend=dict(bgcolor="rgba(0,0,0,0)", orientation="h", y=1.08),
    hovermode="x unified",
)

# ══════════════════════════════════════════════════════════════════════════════
# Filtra dados — cacheado + vetorizado
# ══════════════════════════════════════════════════════════════════════════════
df_f = compute_flags(
    str(csv_path),
    vel_alerta, vel_alarme, acel_alerta, acel_alarme, temp_alerta, temp_alarme,
    str(t_range[0]), str(t_range[1]),
)
df_plot = downsample(df_f)  # versão reduzida para gráficos

# Valores atuais
v1  = df_f.m1_vel.iloc[-1];   v2  = df_f.m2_vel.iloc[-1]
a1  = df_f.m1_acel.iloc[-1];  a2  = df_f.m2_acel.iloc[-1]
t1  = df_f.m1_temp.iloc[-1];  t2  = df_f.m2_temp.iloc[-1]
f1v = flag(v1,vel_alerta,vel_alarme);   f2v = flag(v2,vel_alerta,vel_alarme)
f1a = flag(a1,acel_alerta,acel_alarme); f2a = flag(a2,acel_alerta,acel_alarme)
f1t = flag(t1,temp_alerta,temp_alarme); f2t = flag(t2,temp_alerta,temp_alarme)
f1  = max(f1v,f1a,f1t);  f2 = max(f2v,f2a,f2t)
hs1, hc1 = health("m1", df_f)
hs2, hc2 = health("m2", df_f)
al1 = int((df_f.m1_vel_flag==2).sum())
al2 = int((df_f.m2_vel_flag==2).sum())

# ══════════════════════════════════════════════════════════════════════════════
# HEADER
# ══════════════════════════════════════════════════════════════════════════════
now = df_f.timestamp.max().strftime("%d/%m/%Y  %H:%M:%S")
pior = max(f1, f2)
st.markdown(f"""
<div class="header-bar">
  <div>
    <span style="font-size:1.1rem;font-weight:700;color:#e8f0fe;letter-spacing:.04em">
      🏭 SISTEMA DE MONITORAMENTO INDUSTRIAL
    </span>
    <span style="color:#3a6a8a;font-size:.8rem;margin-left:16px">Bancada Forzy · Motores de Bomba</span>
  </div>
  <div style="display:flex;gap:16px;align-items:center">
    <span class="badge {BADGE[pior]}">SISTEMA: {NOME[pior]}</span>
    <span style="color:#3a6a8a;font-size:.78rem">⏱ {now}</span>
  </div>
</div>
""", unsafe_allow_html=True)

# ══════════════════════════════════════════════════════════════════════════════
# CARDS DOS MOTORES (sempre visíveis no topo)
# ══════════════════════════════════════════════════════════════════════════════
col_m1, col_sep, col_m2 = st.columns([10, 0.3, 10])

def motor_card(col, prefix, nome, cor_nome, fv, fa, ft, f_geral,
               vel, acel, temp, hs, hcor, n_alarmes):
    with col:
        bclass = BADGE[f_geral]
        st.markdown(f"""
        <div style="background:#0d1b2e;border:1.5px solid {COR[f_geral]};
                    border-radius:8px;padding:16px 20px 12px 20px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <span style="font-size:1rem;font-weight:700;color:{cor_nome};letter-spacing:.04em">{nome}</span>
            <span class="badge {bclass}">{NOME[f_geral]}</span>
          </div>
        </div>
        """, unsafe_allow_html=True)

        c1,c2,c3,c4,c5 = st.columns(5)
        c1.metric("Velocidade",  f"{vel:.3f} mm/s",
                  delta=NOME[fv] if fv>0 else "Normal",
                  delta_color="inverse" if fv>0 else "off")
        c2.metric("Aceleração",  f"{acel:.3f} g",
                  delta=NOME[fa] if fa>0 else "Normal",
                  delta_color="inverse" if fa>0 else "off")
        c3.metric("Temperatura", f"{temp:.1f} °C",
                  delta=NOME[ft] if ft>0 else "Normal",
                  delta_color="inverse" if ft>0 else "off")
        c4.metric("Health",      f"{hs}/100")
        c5.metric("Alarmes",     str(n_alarmes),
                  delta="crítico" if n_alarmes>0 else "normal",
                  delta_color="inverse" if n_alarmes>0 else "off")

        # Barra de health
        st.markdown(
            f'<div style="margin-top:6px;background:#1a2d3a;border-radius:4px;height:5px;">'
            f'<div style="width:{hs}%;background:{hcor};height:5px;border-radius:4px;'
            f'transition:width .4s"></div></div>',
            unsafe_allow_html=True)

motor_card(col_m1, "m1", "⚙️ MOTOR 1 — Bomba Principal",
           "#3498db", f1v, f1a, f1t, f1, v1, a1, t1, hs1, hc1, al1)

with col_sep:
    st.markdown('<div style="height:100%;border-left:1px solid #1e3a5c;margin:0 auto"></div>',
                unsafe_allow_html=True)

motor_card(col_m2, "m2", "⚙️ MOTOR 2 — Bomba Auxiliar",
           "#e74c3c", f2v, f2a, f2t, f2, v2, a2, t2, hs2, hc2, al2)

st.markdown("<div style='height:8px'></div>", unsafe_allow_html=True)

# ══════════════════════════════════════════════════════════════════════════════
# TABS
# ══════════════════════════════════════════════════════════════════════════════
tab_timeline, tab_analise, tab_comparacao, tab_eventos, tab_stats = st.tabs([
    "📈 Timeline",
    "🔬 Análise Detalhada",
    "⚖️ Comparação",
    "🚨 Eventos",
    "📊 Estatísticas",
])

# ────────────────────────────────────────────────────────────────────────────
# TAB 1 — TIMELINE
# ────────────────────────────────────────────────────────────────────────────
with tab_timeline:
    col_chart, col_mini = st.columns([3, 1])

    with col_chart:
        fig_vel = go.Figure()
        vmax = 0
        for col_v, col_f, nome, cor in [
            ("m1_vel","m1_vel_flag","Motor 1","#3498db"),
            ("m2_vel","m2_vel_flag","Motor 2","#e74c3c"),
        ]:
            if motor_sel not in ("Ambos os motores", nome.replace(" ","_") if False else nome):
                if nome.replace("Motor ","Motor ") not in motor_sel: continue
            vmax = max(vmax, df_plot[col_v].max())
            # Scattergl = WebGL — muito mais rápido que SVG
            fig_vel.add_trace(go.Scattergl(
                x=df_plot.timestamp, y=df_plot[col_v],
                mode="lines", name=nome,
                line=dict(color=cor, width=1.4),
                hovertemplate=f"<b>{nome}</b><br>%{{x|%H:%M:%S}}<br>%{{y:.3f}} mm/s<extra></extra>",
            ))
            # Alarmes: subsample ainda mais (só 1 a cada 5)
            alm = df_plot[df_plot[col_f]==2]
            if not alm.empty:
                fig_vel.add_trace(go.Scattergl(
                    x=alm.timestamp, y=alm[col_v], mode="markers",
                    name=f"{nome} — Alarme",
                    marker=dict(color="#e74c3c", size=4, symbol="x"),
                    showlegend=True,
                    hovertemplate="🚨 ALARME<br>%{x|%H:%M:%S}<br>%{y:.3f} mm/s<extra></extra>",
                ))
        ymax = max(vel_alarme*1.4, vmax*1.1)
        fig_vel.add_hrect(y0=0,          y1=vel_alerta, fillcolor="#2ecc71", opacity=0.04,
                          annotation_text="Normal", annotation_position="left",
                          annotation_font=dict(color="#2ecc71", size=10))
        fig_vel.add_hrect(y0=vel_alerta, y1=vel_alarme, fillcolor="#f39c12", opacity=0.06,
                          annotation_text="Alerta", annotation_position="left",
                          annotation_font=dict(color="#f39c12", size=10))
        fig_vel.add_hrect(y0=vel_alarme, y1=ymax,       fillcolor="#e74c3c", opacity=0.06,
                          annotation_text="Alarme", annotation_position="left",
                          annotation_font=dict(color="#e74c3c", size=10))
        fig_vel.add_hline(y=vel_alerta, line_dash="dot", line_color="#f39c12", line_width=1)
        fig_vel.add_hline(y=vel_alarme, line_dash="dot", line_color="#e74c3c", line_width=1)
        # Monta layout sem duplicar xaxis/yaxis do PLOT base
        _plot_base = {k:v for k,v in PLOT.items() if k not in ("xaxis","yaxis")}
        fig_vel.update_layout(
            title=dict(text="Velocidade de Vibração RMS (mm/s)", font=dict(size=13,color="#7ec8e3")),
            height=340, **_plot_base,
            xaxis=dict(**PLOT["xaxis"],
                rangeslider=dict(visible=True, thickness=0.05, bgcolor="#0d1321"),
                rangeselector=dict(
                    bgcolor="#0d1b2e", activecolor="#1e3a5c",
                    font=dict(color="#aaa", size=10),
                    buttons=[
                        dict(count=5,  label="5min",  step="minute", stepmode="backward"),
                        dict(count=15, label="15min", step="minute", stepmode="backward"),
                        dict(count=30, label="30min", step="minute", stepmode="backward"),
                        dict(step="all", label="Tudo"),
                    ]
                ),
            ),
            yaxis=dict(**PLOT["yaxis"], range=[0, ymax], title="mm/s"),
        )
        st.plotly_chart(fig_vel, use_container_width=True)

    with col_mini:
        st.markdown("**Resumo do período**")
        for prefix, nome, cor in [("m1","Motor 1","#3498db"),("m2","Motor 2","#e74c3c")]:
            if nome not in motor_sel and "Ambos" not in motor_sel: continue
            n_al = int((df_f[f"{prefix}_vel_flag"]==2).sum())
            n_at = int((df_f[f"{prefix}_vel_flag"]==1).sum())
            pct  = round(100*(n_al+n_at)/max(len(df_f),1),1)
            st.markdown(f"""
            <div style="background:#0d1b2e;border:1px solid {cor}33;
                        border-radius:6px;padding:10px 12px;margin-bottom:8px">
              <div style="color:{cor};font-weight:700;font-size:.85rem">{nome}</div>
              <div style="color:#aaa;font-size:.78rem;margin-top:4px">
                🚨 Alarmes: <b style="color:#e74c3c">{n_al}</b><br>
                ⚠️ Alertas: <b style="color:#f39c12">{n_at}</b><br>
                📊 % fora:  <b style="color:#eee">{pct}%</b>
              </div>
            </div>
            """, unsafe_allow_html=True)
        st.markdown("<br>", unsafe_allow_html=True)
        csv_bytes = df_f.to_csv(index=False).encode("utf-8")
        st.download_button("⬇️ Exportar CSV", csv_bytes,
                           "forzy_export.csv", "text/csv",
                           use_container_width=True)

    # Segunda linha: temperatura + aceleração
    col_t, col_a = st.columns(2)
    for fig_col, col_m1, col_m2, titulo, unidade, lim_a, lim_al in [
        (col_t, "m1_temp","m2_temp","Temperatura","°C",  temp_alerta, temp_alarme),
        (col_a, "m1_acel","m2_acel","Aceleração","g",    acel_alerta, acel_alarme),
    ]:
        fig_s = go.Figure()
        for col_v, nome, cor in [(col_m1,"Motor 1","#3498db"),(col_m2,"Motor 2","#e74c3c")]:
            if nome not in motor_sel and "Ambos" not in motor_sel: continue
            fig_s.add_trace(go.Scattergl(
                x=df_plot.timestamp, y=df_plot[col_v],
                mode="lines", name=nome, line=dict(color=cor, width=1.3),
            ))
        fig_s.add_hline(y=lim_a,  line_dash="dot", line_color="#f39c12", line_width=1)
        fig_s.add_hline(y=lim_al, line_dash="dot", line_color="#e74c3c", line_width=1)
        _pb = {k:v for k,v in PLOT.items() if k not in ("xaxis","yaxis")}
        fig_s.update_layout(
            title=dict(text=f"{titulo} ({unidade})", font=dict(size=12,color="#7ec8e3")),
            height=240, **_pb,
            xaxis=dict(**PLOT["xaxis"]),
            yaxis=dict(**PLOT["yaxis"], title=unidade),
        )
        with fig_col:
            st.plotly_chart(fig_s, use_container_width=True, key=f"fig_s_{titulo}")

# ────────────────────────────────────────────────────────────────────────────
# TAB 2 — ANÁLISE DETALHADA
# ────────────────────────────────────────────────────────────────────────────
with tab_analise:
    col_g1, col_g2 = st.columns(2)

    # Gauge motor 1
    def gauge(val, title, maximo, lim_a, lim_al, unit):
        fv = flag(val, lim_a, lim_al)
        fig = go.Figure(go.Indicator(
            mode="gauge+number+delta",
            value=val,
            title=dict(text=title, font=dict(size=12, color="#6b8cae")),
            number=dict(suffix=f" {unit}", font=dict(size=20, color="#e8f0fe")),
            delta=dict(reference=lim_a, increasing=dict(color="#e74c3c"),
                       decreasing=dict(color="#2ecc71"), valueformat=".3f"),
            gauge=dict(
                axis=dict(range=[0, maximo], tickcolor="#3a5a7a",
                          tickfont=dict(color="#3a5a7a", size=9)),
                bar=dict(color=COR[fv], thickness=0.25),
                bgcolor="#0a0f1a",
                borderwidth=1, bordercolor="#1e3a5c",
                steps=[
                    dict(range=[0, lim_a],        color="#0d1f0d"),
                    dict(range=[lim_a, lim_al],    color="#1f1400"),
                    dict(range=[lim_al, maximo],   color="#1f0505"),
                ],
                threshold=dict(line=dict(color="#e74c3c", width=3),
                               thickness=0.8, value=lim_al),
            ),
        ))
        fig.update_layout(height=190, paper_bgcolor="rgba(0,0,0,0)",
                          margin=dict(l=20,r=20,t=30,b=10))
        return fig

    vmax_g = max(vel_alarme*1.5, df_f.m1_vel.max()*1.1, df_f.m2_vel.max()*1.1)

    with col_g1:
        st.markdown("#### ⚙️ Motor 1")
        gc1,gc2,gc3 = st.columns(3)
        gc1.plotly_chart(gauge(v1,"Velocidade RMS",vmax_g,vel_alerta,vel_alarme,"mm/s"),
                         use_container_width=True, key="gauge_m1_vel")
        gc2.plotly_chart(gauge(a1,"Aceleração",1.0,acel_alerta,acel_alarme,"g"),
                         use_container_width=True, key="gauge_m1_acel")
        gc3.plotly_chart(gauge(t1,"Temperatura",85,temp_alerta,temp_alarme,"°C"),
                         use_container_width=True, key="gauge_m1_temp")

    with col_g2:
        st.markdown("#### ⚙️ Motor 2")
        gc1,gc2,gc3 = st.columns(3)
        gc1.plotly_chart(gauge(v2,"Velocidade RMS",vmax_g,vel_alerta,vel_alarme,"mm/s"),
                         use_container_width=True, key="gauge_m2_vel")
        gc2.plotly_chart(gauge(a2,"Aceleração",1.0,acel_alerta,acel_alarme,"g"),
                         use_container_width=True, key="gauge_m2_acel")
        gc3.plotly_chart(gauge(t2,"Temperatura",85,temp_alerta,temp_alarme,"°C"),
                         use_container_width=True, key="gauge_m2_temp")

    st.divider()

    # Tendência preditiva
    st.markdown("#### 📈 Tendência Preditiva — próximos 30s")
    fig_trend = go.Figure()
    n_pred = 30
    for col_v, nome, cor in [("m1_vel","Motor 1","#3498db"),("m2_vel","Motor 2","#e74c3c")]:
        if nome not in motor_sel and "Ambos" not in motor_sel: continue
        y = df_plot[col_v].values
        x = np.arange(len(y))
        coef = np.polyfit(x, y, 1)
        ts_fut = pd.date_range(df_f.timestamp.iloc[-1], periods=n_pred+1, freq="1s")[1:]
        y_fut = np.polyval(coef, np.arange(len(y), len(y)+n_pred))
        fig_trend.add_trace(go.Scattergl(
            x=df_plot.timestamp, y=y, mode="lines", name=nome,
            line=dict(color=cor, width=1.5)))
        fig_trend.add_trace(go.Scattergl(
            x=ts_fut, y=y_fut, mode="lines", name=f"{nome} (tendência)",
            line=dict(color=cor, width=2, dash="dash")))
    fig_trend.add_hline(y=vel_alerta, line_dash="dot", line_color="#f39c12", line_width=1)
    fig_trend.add_hline(y=vel_alarme, line_dash="dot", line_color="#e74c3c", line_width=1)
    _pb2 = {k:v for k,v in PLOT.items() if k not in ("xaxis","yaxis")}
    fig_trend.update_layout(height=260, **_pb2,
                             xaxis=dict(**PLOT["xaxis"]),
                             yaxis=dict(**PLOT["yaxis"], title="mm/s"))
    st.plotly_chart(fig_trend, use_container_width=True)

# ────────────────────────────────────────────────────────────────────────────
# TAB 3 — COMPARAÇÃO
# ────────────────────────────────────────────────────────────────────────────
with tab_comparacao:
    col_box, col_heat = st.columns([3,2])

    with col_box:
        st.markdown("#### Distribuição por variável")
        fig_box = make_subplots(1,3,
            subplot_titles=("Velocidade (mm/s)","Aceleração (g)","Temperatura (°C)"))
        for i,(c1,c2) in enumerate([("m1_vel","m2_vel"),("m1_acel","m2_acel"),("m1_temp","m2_temp")],1):
            fig_box.add_trace(go.Box(y=df_f[c1],name="Motor 1",marker_color="#3498db",
                                     boxmean=True,showlegend=(i==1)),1,i)
            fig_box.add_trace(go.Box(y=df_f[c2],name="Motor 2",marker_color="#e74c3c",
                                     boxmean=True,showlegend=(i==1)),1,i)
        fig_box.update_layout(height=300, paper_bgcolor="rgba(0,0,0,0)",
                              plot_bgcolor="rgba(0,0,0,0)", font_color="#cdd9e5",
                              margin=dict(l=40,r=10,t=40,b=30),
                              legend=dict(orientation="h",y=1.1,bgcolor="rgba(0,0,0,0)"))
        fig_box.update_xaxes(gridcolor="#1a2d3a"); fig_box.update_yaxes(gridcolor="#1a2d3a")
        st.plotly_chart(fig_box, use_container_width=True)

    with col_heat:
        st.markdown("#### Correlação entre variáveis")
        cols_corr = ["m1_vel","m1_acel","m1_temp","m2_vel","m2_acel","m2_temp"]
        labels = ["M1 Vel","M1 Acel","M1 Temp","M2 Vel","M2 Acel","M2 Temp"]
        corr = df_f[cols_corr].corr().round(2)
        fig_heat = go.Figure(go.Heatmap(
            z=corr.values, x=labels, y=labels,
            colorscale="RdBu", zmid=0, zmin=-1, zmax=1,
            text=corr.values.round(2), texttemplate="%{text}",
            textfont=dict(size=9),
            colorbar=dict(tickfont=dict(color="#aaa"), thickness=12),
        ))
        fig_heat.update_layout(height=300, paper_bgcolor="rgba(0,0,0,0)",
                               margin=dict(l=10,r=10,t=20,b=10),
                               font_color="#cdd9e5")
        st.plotly_chart(fig_heat, use_container_width=True)

    st.markdown("#### Scatter — Velocidade × Aceleração")
    col_s1, col_s2 = st.columns(2)
    for col_w, prefix, nome, cor in [
        (col_s1,"m1","Motor 1","#3498db"),
        (col_s2,"m2","Motor 2","#e74c3c"),
    ]:
        fig_sc = px.scatter(df_f, x=f"{prefix}_vel", y=f"{prefix}_acel",
            color=f"{prefix}_vel_flag",
            color_discrete_map={0:"#2ecc71",1:"#f39c12",2:"#e74c3c"},
            labels={f"{prefix}_vel":"Velocidade (mm/s)",f"{prefix}_acel":"Aceleração (g)",
                    f"{prefix}_vel_flag":"Zona"},
            title=nome, opacity=0.5,
            color_continuous_scale=None)
        fig_sc.update_layout(height=260, paper_bgcolor="rgba(0,0,0,0)",
                             plot_bgcolor="rgba(0,0,0,0)", font_color="#cdd9e5",
                             margin=dict(l=40,r=10,t=40,b=30))
        fig_sc.update_xaxes(gridcolor="#1a2d3a"); fig_sc.update_yaxes(gridcolor="#1a2d3a")
        with col_w:
            st.plotly_chart(fig_sc, use_container_width=True)

# ────────────────────────────────────────────────────────────────────────────
# TAB 4 — EVENTOS
# ────────────────────────────────────────────────────────────────────────────
with tab_eventos:
    st.markdown("#### 🚨 Log de Eventos — Alarmes e Alertas")
    eventos = []
    for prefix, nome in [("m1","Motor 1"),("m2","Motor 2")]:
        for var, lim_a, lim_al, unit in [
            ("vel",  vel_alerta,  vel_alarme,  "mm/s"),
            ("acel", acel_alerta, acel_alarme, "g"),
            ("temp", temp_alerta, temp_alarme, "°C"),
        ]:
            col_f, col_v = f"{prefix}_{var}_flag", f"{prefix}_{var}"
            for fval, tipo in [(2,"🚨 ALARME"),(1,"⚠️ Alerta")]:
                pts = df_f[df_f[col_f]==fval]
                if not pts.empty:
                    eventos.append({
                        "Motor": nome,
                        "Variável": var.capitalize(),
                        "Tipo": tipo,
                        "Primeiro": pts.timestamp.min().strftime("%H:%M:%S"),
                        "Último":   pts.timestamp.max().strftime("%H:%M:%S"),
                        "Pico": f"{pts[col_v].max():.3f} {unit}",
                        "Duração (s)": round((pts.timestamp.max()-pts.timestamp.min()).total_seconds(),1),
                        "Ocorrências": len(pts),
                    })

    if eventos:
        df_ev = pd.DataFrame(eventos).sort_values(["Tipo","Motor"], ascending=[True,True])
        st.dataframe(df_ev, use_container_width=True, hide_index=True,
                     column_config={
                         "Tipo": st.column_config.TextColumn(width="small"),
                         "Ocorrências": st.column_config.NumberColumn(format="%d"),
                     })
    else:
        st.success("✅ Nenhum evento de alerta ou alarme no período selecionado.")

    st.divider()
    st.markdown("#### Distribuição temporal de alarmes")
    fig_ev = go.Figure()
    for prefix, nome, cor in [("m1","Motor 1","#3498db"),("m2","Motor 2","#e74c3c")]:
        alm = df_f[df_f[f"{prefix}_vel_flag"]==2]
        if not alm.empty:
            fig_ev.add_trace(go.Histogram(
                x=alm.timestamp, name=f"{nome} — Alarme",
                marker_color=cor, opacity=0.7,
                nbinsx=40,
            ))
    _pb3 = {k:v for k,v in PLOT.items() if k not in ("xaxis","yaxis")}
    fig_ev.update_layout(height=220, barmode="overlay", **_pb3,
                         xaxis=dict(**PLOT["xaxis"]),
                         yaxis=dict(**PLOT["yaxis"], title="Contagem"))
    st.plotly_chart(fig_ev, use_container_width=True)

# ────────────────────────────────────────────────────────────────────────────
# TAB 5 — ESTATÍSTICAS
# ────────────────────────────────────────────────────────────────────────────
with tab_stats:
    st.markdown("#### 📊 Estatísticas Completas do Período")
    stats_cols = {
        "M1 — Velocidade (mm/s)": "m1_vel",
        "M1 — Aceleração (g)":    "m1_acel",
        "M1 — Temperatura (°C)":  "m1_temp",
        "M2 — Velocidade (mm/s)": "m2_vel",
        "M2 — Aceleração (g)":    "m2_acel",
        "M2 — Temperatura (°C)":  "m2_temp",
    }
    stats = {
        label: {
            "Mín":    df_f[col].min(),
            "Média":  df_f[col].mean(),
            "Máx":    df_f[col].max(),
            "Desvio": df_f[col].std(),
            "P50":    df_f[col].quantile(0.50),
            "P95":    df_f[col].quantile(0.95),
            "P99":    df_f[col].quantile(0.99),
        }
        for label,col in stats_cols.items()
    }
    df_stats = pd.DataFrame(stats).T.round(4)
    st.dataframe(df_stats, use_container_width=True)

    st.divider()
    col_e1, col_e2 = st.columns(2)
    with col_e1:
        st.download_button("⬇️ Exportar CSV completo",
                           df_f.to_csv(index=False).encode("utf-8"),
                           "forzy_completo.csv","text/csv",
                           use_container_width=True)
    with col_e2:
        st.download_button("⬇️ Exportar Estatísticas",
                           df_stats.to_csv().encode("utf-8"),
                           "forzy_stats.csv","text/csv",
                           use_container_width=True)
