"""IMS — Industrial Monitoring System · Forzy"""
import streamlit as st
import pandas as pd
import numpy as np
import plotly.graph_objects as go
from pathlib import Path
from datetime import datetime

st.set_page_config(
    page_title="IMS · Forzy Industrial",
    page_icon=None,
    layout="wide",
    initial_sidebar_state="expanded",
)

import sys as _sys; _sys.path.insert(0, str(Path(__file__).parent))
from utils.theme import apply as _apply_theme, sidebar_nav as _snav
from utils.mock_data import gerar_leitura_simulada, MODO_NORMAL, MODO_DESBALANCO, MODO_CAVITACAO, MODO_DESALINHAMENTO
from streamlit_autorefresh import st_autorefresh as _sar
_apply_theme(); _snav("inicio")

# ── Onboarding: banco vazio ────────────────────────────────────────────────────
try:
    import database as _db
    _plantas = _db.get_plantas()
    if not _plantas:
        st.info(
            "**Primeira execução detectada.** O banco de dados está vazio.  \n"
            "Para monitorar ativos reais, comece em **Cadastro** para criar uma Planta, "
            "uma Área e seu primeiro Ativo. Enquanto isso, o Dashboard usa o Dataset Forzy como referência.",
            icon="ℹ️",
        )
        with st.expander("Como iniciar em 3 passos", expanded=False):
            st.markdown("""
1. **Cadastro → Nova Planta** — ex.: "Planta Forzy"
2. **Cadastro → Nova Área** — ex.: "Sala de Bombas"
3. **Cadastro → Novo Ativo** — preencha código, TAG e selecione a área

Depois, na página **IoT**, selecione *Ativo Cadastrado* + *ESP32 Real* para iniciar a coleta de dados reais.
            """)
except Exception:
    pass

# ── Dataset ────────────────────────────────────────────────────────────────────
@st.cache_data
def _load_df():
    csv = Path(__file__).parent / "data" / "forzy.csv"
    if not csv.exists():
        return None
    df = pd.read_csv(csv, sep=";", skiprows=3, header=None,
        usecols=[0,3,4,5,6,7,8],
        names=["ts","m1_vel","m1_acel","m1_temp","m2_vel","m2_acel","m2_temp"])
    df["ts"] = pd.to_datetime(df["ts"])
    for c in df.columns[1:]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df.dropna(subset=["m1_vel","m2_vel"]).sort_values("ts").reset_index(drop=True)

df_full = _load_df()

VEL_AL, VEL_ALM   = 1.8, 4.5
TEMP_AL, TEMP_ALM = 35.0, 42.0
COR  = {0: "#2ecc71", 1: "#f39c12", 2: "#e74c3c"}
NOME = {0: "NORMAL",  1: "ALERTA",  2: "ALARME"}

def _flag(v, a, al): return 2 if v >= al else 1 if v >= a else 0

# ── Controles de fonte + autorefresh ──────────────────────────────────────────
cc1, cc2, cc3, cc4 = st.columns([2, 1, 1, 2])
with cc1:
    fonte = st.radio("Fonte", ["Dataset Forzy", "Simulado"],
                     horizontal=True, key="home_fonte")
with cc2:
    auto = st.toggle("Auto-refresh", value=True, key="home_auto")
with cc3:
    intervalo = st.selectbox("Intervalo", [2000, 5000, 10000], index=1,
                             format_func=lambda x: f"{x//1000}s",
                             key="home_interval")

if auto:
    _sar(interval=intervalo, key="home_sar")

# ── Leitura atual ──────────────────────────────────────────────────────────────
if fonte == "Dataset Forzy" and df_full is not None:
    N = len(df_full)
    if "home_fidx" not in st.session_state:
        st.session_state.home_fidx = 0
    if auto:
        st.session_state.home_fidx = (st.session_state.home_fidx + 5) % N

    idx  = st.session_state.home_fidx
    row  = df_full.iloc[idx]
    v1, t1 = float(row.m1_vel), float(row.m1_temp)
    v2, t2 = float(row.m2_vel), float(row.m2_temp)
    ts_label = row["ts"].strftime("%d/%m/%Y  %H:%M:%S")

    # janela histórica: últimos 120 frames até o frame atual
    win_start = max(0, idx - 120)
    win = df_full.iloc[win_start:idx+1]
    serie_v1, serie_v2 = win.m1_vel, win.m2_vel

    prog = idx / max(N - 1, 1)
    st.progress(prog, text=f"Dataset Forzy · frame {idx+1}/{N} · {ts_label}")

else:
    with cc4:
        modo_sim = st.selectbox("Cenário", [MODO_NORMAL, MODO_DESBALANCO, MODO_CAVITACAO, MODO_DESALINHAMENTO],
            format_func=lambda x: {"normal":"Normal","desbalanco":"Desbalanceamento",
                                   "cavitacao":"Cavitação","desalinhamento":"Desalinhamento"}[x],
            key="home_modo_sim")
    if "home_t" not in st.session_state:
        st.session_state.home_t = 0.0
    if auto:
        st.session_state.home_t += 1.0
    t_sim = st.session_state.home_t
    r1 = gerar_leitura_simulada(t=t_sim, modo=modo_sim)
    r2 = gerar_leitura_simulada(t=t_sim + 17.3, modo=modo_sim)
    v1, t1 = float(r1.get("vibracao_mm_s",0)), float(r1.get("temperatura_c",25))
    v2, t2 = float(r2.get("vibracao_mm_s",0)), float(r2.get("temperatura_c",25))
    ts_label = datetime.now().strftime("%H:%M:%S")

    # acumula histórico simulado
    if "home_hist_v1" not in st.session_state:
        st.session_state.home_hist_v1 = []
        st.session_state.home_hist_v2 = []
    st.session_state.home_hist_v1.append(v1)
    st.session_state.home_hist_v2.append(v2)
    st.session_state.home_hist_v1 = st.session_state.home_hist_v1[-120:]
    st.session_state.home_hist_v2 = st.session_state.home_hist_v2[-120:]
    serie_v1 = pd.Series(st.session_state.home_hist_v1)
    serie_v2 = pd.Series(st.session_state.home_hist_v2)

    st.caption(f"Modo Simulado · {ts_label}")
    if df_full is None:
        prog = None

f1 = max(_flag(v1, VEL_AL, VEL_ALM), _flag(t1, TEMP_AL, TEMP_ALM))
f2 = max(_flag(v2, VEL_AL, VEL_ALM), _flag(t2, TEMP_AL, TEMP_ALM))
pior = max(f1, f2)

# ── Header ────────────────────────────────────────────────────────────────────
now = datetime.now().strftime("%d/%m/%Y  %H:%M")
st.markdown(f"""
<div style="background:linear-gradient(90deg,#080f1c 0%,#060d18 100%);
            border:1px solid #0f2035;border-radius:10px;
            padding:18px 28px;margin-bottom:16px;
            display:flex;align-items:center;justify-content:space-between">
  <div>
    <div style="font-size:1.35rem;font-weight:700;color:#e2eaf4;letter-spacing:.03em">
      Sistema de Monitoramento Industrial
    </div>
    <div style="font-size:.8rem;color:#2a5a7a;margin-top:4px">
      Bancada Forzy · Monitoramento de Bombas Centrífugas · Sensor VIM32PL IO-Link
    </div>
  </div>
  <div style="text-align:right">
    <div style="display:inline-block;padding:5px 16px;border-radius:5px;
                border:1px solid {COR[pior]};background:{COR[pior]}18;
                font-size:.78rem;font-weight:700;color:{COR[pior]};letter-spacing:.08em">
      {NOME[pior]}
    </div>
    <div style="font-size:.72rem;color:#2a5a7a;margin-top:6px">{now}</div>
  </div>
</div>
""", unsafe_allow_html=True)

# ── KPI Bar ───────────────────────────────────────────────────────────────────
if df_full is not None:
    total   = len(df_full)
    n_al1   = int((df_full.m1_vel >= VEL_ALM).sum())
    n_al2   = int((df_full.m2_vel >= VEL_ALM).sum())
    uptime  = round(int((df_full.m1_vel < VEL_AL).sum()) / total * 100, 1)
    dur     = df_full.ts.max() - df_full.ts.min()
    h_op    = int(dur.total_seconds()) // 3600
    split   = max(1, total // 10)
    tend_v  = df_full.m1_vel.iloc[-split:].mean() - df_full.m1_vel.iloc[-2*split:-split].mean()
    t_icon  = "↑" if tend_v > 0.05 else "↓" if tend_v < -0.05 else "→"
    t_cor   = "#e74c3c" if tend_v > 0.05 else "#2ecc71" if tend_v < -0.05 else "#f39c12"
    kpis = [
        ("Disponibilidade",   f"{uptime}%",                  "#2ecc71"),
        ("Total de Alarmes",  str(n_al1 + n_al2),            "#e74c3c" if (n_al1+n_al2) > 0 else "#2ecc71"),
        ("Horas em Operação", f"{h_op}h",                    "#7ec8e3"),
        ("Tendência Vel M1",  f"{t_icon} {abs(tend_v):.3f} mm/s", t_cor),
        ("Amostras",          f"{total:,}",                  "#4a7a9b"),
    ]
    kcols = st.columns(len(kpis))
    for col, (label, valor, cor) in zip(kcols, kpis):
        col.markdown(f"""
        <div style="background:#08111f;border:1px solid #0f2035;border-radius:8px;
                    padding:12px 16px;text-align:center">
          <div style="font-size:.62rem;color:#4a7a9b;text-transform:uppercase;
                      letter-spacing:.09em;margin-bottom:4px">{label}</div>
          <div style="font-size:1.15rem;font-weight:700;color:{cor}">{valor}</div>
        </div>
        """, unsafe_allow_html=True)
    st.markdown("<div style='margin-bottom:14px'></div>", unsafe_allow_html=True)

# ── Status dos Ativos + Sparklines ────────────────────────────────────────────
st.markdown("#### Status dos Ativos")

def _hex_rgba(h, a=0.10):
    h = h.lstrip("#")
    r, g, b = int(h[0:2],16), int(h[2:4],16), int(h[4:6],16)
    return f"rgba({r},{g},{b},{a})"

def sparkline(series, cor, height=60):
    s = series.values if hasattr(series, "values") else np.array(series)
    fig = go.Figure(go.Scatter(
        y=s, mode="lines",
        line=dict(color=cor, width=1.5),
        fill="tozeroy",
        fillcolor=_hex_rgba(cor, 0.10),
    ))
    fig.update_layout(
        margin=dict(l=0, r=0, t=0, b=0), height=height,
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        xaxis=dict(visible=False), yaxis=dict(visible=False), showlegend=False,
    )
    return fig

col1, col2, col3, col4 = st.columns(4)

for col, nome, vel, temp, f_status, serie in [
    (col1, "Motor 1 — Bomba Principal", v1, t1, f1, serie_v1),
    (col2, "Motor 2 — Bomba Auxiliar",  v2, t2, f2, serie_v2),
]:
    with col:
        st.markdown(f"""
        <div style="background:#08111f;border:1.5px solid {COR[f_status]};
                    border-radius:8px;padding:16px 18px 8px">
          <div style="font-size:.68rem;color:#2a5a7a;text-transform:uppercase;
                      letter-spacing:.08em;margin-bottom:8px">{nome}</div>
          <div style="font-size:1.25rem;font-weight:700;color:{COR[f_status]};
                      margin-bottom:8px">{NOME[f_status]}</div>
          <div style="font-size:.82rem;color:#aac;line-height:2">
            Vel: <b style="color:#e2eaf4">{vel:.3f} mm/s</b> &nbsp;
            Temp: <b style="color:#e2eaf4">{temp:.1f} °C</b>
          </div>
        </div>
        """, unsafe_allow_html=True)
        if len(serie) > 1:
            st.plotly_chart(sparkline(serie, COR[f_status]),
                            use_container_width=True, config={"displayModeBar": False})

with col3:
    st.markdown("""
    <div style="background:#08111f;border:1px solid #0f2035;
                border-radius:8px;padding:16px 18px">
      <div style="font-size:.68rem;color:#2a5a7a;text-transform:uppercase;
                  letter-spacing:.08em;margin-bottom:10px">Sensor</div>
      <div style="font-size:.82rem;color:#aac;line-height:1.9">
        VIM32PL-E1AC8<br>IO-Link 1.1<br>38,4 kBit/s<br>
        <b style="color:#2ecc71">Ativo</b>
      </div>
    </div>
    """, unsafe_allow_html=True)

with col4:
    if df_full is not None:
        dur = df_full.ts.max() - df_full.ts.min()
        h, m = divmod(int(dur.total_seconds()), 3600); m //= 60
        st.markdown(f"""
        <div style="background:#08111f;border:1px solid #0f2035;
                    border-radius:8px;padding:16px 18px">
          <div style="font-size:.68rem;color:#2a5a7a;text-transform:uppercase;
                      letter-spacing:.08em;margin-bottom:10px">Dataset</div>
          <div style="font-size:.82rem;color:#aac;line-height:1.9">
            {len(df_full):,} amostras<br>
            {df_full.ts.min().strftime('%H:%M')} → {df_full.ts.max().strftime('%H:%M')}<br>
            Duração: {h}h {m:02d}min<br>forzy.csv
          </div>
        </div>
        """, unsafe_allow_html=True)

st.markdown("<div style='margin-bottom:4px'></div>", unsafe_allow_html=True)

# ── Módulos do Sistema ────────────────────────────────────────────────────────
st.markdown("#### Módulos do Sistema")

cards = [
    ("Monitoramento",       "Dados em tempo real com gauges, health score e modo de falha simulado.",  "#3498db"),
    ("Análise Espectral",   "FFT com marcadores de harmônicas, espectrograma e cenários de falha.",    "#9b59b6"),
    ("SCADA Visual",        "Planta 2D com modelo STP real + Vista 3D interativa com alertas ao vivo.","#1abc9c"),
    ("Análise Operacional", "Timeline completa, análise de distribuição, correlação e log de eventos.","#e67e22"),
    ("Histórico / Player",  "Reprodução animada do histórico de operação com scrubbing de timeline.",  "#e74c3c"),
    ("Conexão IoT / ESP32", "Interface para monitoramento ao vivo via ESP32 + VIM32PL em produção.",  "#2ecc71"),
]
nav_cols = st.columns(3)
for i, (titulo, desc, cor) in enumerate(cards):
    with nav_cols[i % 3]:
        st.markdown(f"""
        <div style="background:#08111f;border:1px solid {cor}30;
                    border-radius:8px;padding:16px 20px;margin-bottom:10px;
                    border-left:3px solid {cor}">
          <div style="font-size:.88rem;font-weight:700;color:#e2eaf4;margin-bottom:4px">{titulo}</div>
          <div style="font-size:.75rem;color:#4a7a9b;line-height:1.5">{desc}</div>
        </div>
        """, unsafe_allow_html=True)

st.markdown("<div style='margin-bottom:4px'></div>", unsafe_allow_html=True)

# ── Atividade Recente & Ações Rápidas ─────────────────────────────────────────
st.markdown("#### Atividade Recente")

col_log, col_actions = st.columns([3, 1], gap="large")

with col_log:
    if df_full is not None:
        estados_m1 = np.where(df_full.m1_vel >= VEL_ALM, 2, np.where(df_full.m1_vel >= VEL_AL, 1, 0))
        estados_m2 = np.where(df_full.m2_vel >= VEL_ALM, 2, np.where(df_full.m2_vel >= VEL_AL, 1, 0))
        eventos = []
        for i in range(1, min(len(df_full), 500)):
            if estados_m1[i] != estados_m1[i-1]:
                eventos.append((df_full.ts.iloc[i], "Motor 1", NOME[estados_m1[i]],
                                COR[estados_m1[i]], f"Vel = {df_full.m1_vel.iloc[i]:.3f} mm/s"))
            if estados_m2[i] != estados_m2[i-1]:
                eventos.append((df_full.ts.iloc[i], "Motor 2", NOME[estados_m2[i]],
                                COR[estados_m2[i]], f"Vel = {df_full.m2_vel.iloc[i]:.3f} mm/s"))
        eventos.append((df_full.ts.max(), "Dataset", "COLETADO", "#4a7a9b",
                        f"{len(df_full):,} amostras · forzy.csv"))
        eventos.sort(key=lambda x: x[0], reverse=True)
        eventos = eventos[:12]

        st.markdown('<div style="background:#08111f;border:1px solid #0f2035;border-radius:8px;padding:14px 18px">', unsafe_allow_html=True)
        for ts, motor, status, cor_ev, detalhe in eventos:
            st.markdown(f"""
            <div style="display:flex;align-items:flex-start;gap:12px;
                        padding:7px 0;border-bottom:1px solid #0a1628">
              <div style="font-size:.72rem;color:#4a7a9b;white-space:nowrap;
                          padding-top:2px;min-width:42px">{ts.strftime('%H:%M')}</div>
              <div style="width:6px;height:6px;border-radius:50%;
                          background:{cor_ev};margin-top:5px;flex-shrink:0"></div>
              <div>
                <span style="font-size:.78rem;font-weight:600;color:{cor_ev}">{motor}</span>
                <span style="font-size:.78rem;color:#e2eaf4"> → {status}</span>
                <span style="font-size:.72rem;color:#4a7a9b;margin-left:6px">{detalhe}</span>
              </div>
            </div>
            """, unsafe_allow_html=True)
        st.markdown("</div>", unsafe_allow_html=True)
    else:
        st.info("Sem dados para exibir.")

with col_actions:
    st.markdown('<div style="font-size:.7rem;color:#4a7a9b;font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin-bottom:10px">Ações Rápidas</div>', unsafe_allow_html=True)

    if st.button("Forçar Refresh dos Dados", use_container_width=True):
        st.cache_data.clear()
        st.rerun()

    if df_full is not None:
        csv_bytes = df_full.to_csv(index=False, sep=";").encode("utf-8")
        st.download_button("Exportar Dataset CSV", data=csv_bytes,
            file_name=f"forzy_export_{datetime.now().strftime('%Y%m%d_%H%M')}.csv",
            mime="text/csv", use_container_width=True)

    if st.button("Ir para Monitoramento", use_container_width=True):
        st.switch_page("pages/2_Dashboard.py")

    if st.button("Ir para Cadastro", use_container_width=True):
        st.switch_page("pages/6_Cadastro.py")

    st.markdown("<div style='margin-top:14px'></div>", unsafe_allow_html=True)
    st.markdown("""
    <div style="background:#08111f;border:1px solid #0f2035;border-radius:8px;padding:12px 14px">
      <div style="font-size:.62rem;color:#4a7a9b;text-transform:uppercase;
                  letter-spacing:.09em;margin-bottom:8px">Referência ISO</div>
      <div style="font-size:.72rem;color:#aac;line-height:1.8">
        Normal &nbsp;<b style="color:#2ecc71">&lt; 1,8 mm/s</b><br>
        Alerta &nbsp;<b style="color:#f39c12">1,8 – 4,5</b><br>
        Alarme &nbsp;<b style="color:#e74c3c">&gt; 4,5 mm/s</b>
      </div>
    </div>
    """, unsafe_allow_html=True)

# ── Footer ────────────────────────────────────────────────────────────────────
st.markdown("""
<div style="border-top:1px solid #0f2035;margin-top:20px;padding-top:12px;
            display:flex;justify-content:space-between;align-items:center">
  <span style="font-size:.72rem;color:#1a3a5a">IMS · Forzy Industrial Monitoring System</span>
  <span style="font-size:.72rem;color:#1a3a5a">Sensor: Pepperl+Fuchs VIM32PL · ISO 10816 / 20816</span>
</div>
""", unsafe_allow_html=True)
