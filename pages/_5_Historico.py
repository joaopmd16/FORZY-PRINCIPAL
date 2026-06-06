"""
Player / Timelapse — Dataset Forzy
Animação Plotly nativa com Play / Pause / Scrubbing
Seletor de variável: Velocidade | Aceleração | Temperatura
"""

import pandas as pd
import numpy as np
import plotly.graph_objects as go
import streamlit as st
from pathlib import Path

st.set_page_config(page_title="Player — Timelapse Forzy", layout="wide")
import sys; sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent.parent))
from utils.theme import apply as _apply_theme, sidebar_header as _sh
_apply_theme(); _sh()


# ── CSV ────────────────────────────────────────────────────────────────────────
SEARCH_PATHS = [
    Path(__file__).parent.parent / "data" / "forzy.csv",
    Path.home() / "Downloads" / "History_32026-05-19T11-46-10-920.csv",
]
csv_path = next((p for p in SEARCH_PATHS if p.exists()), None)
if not csv_path:
    st.error("CSV não encontrado.")
    st.stop()

@st.cache_data
def load_data(path: str) -> pd.DataFrame:
    import numpy as np
    df = pd.read_csv(
        path, sep=";", skiprows=3, header=None,
        usecols=[0, 3, 4, 5, 6, 7, 8],
        names=["timestamp", "m1_vel", "m1_acel", "m1_temp",
                             "m2_vel", "m2_acel", "m2_temp"],
    )
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    for c in df.columns[1:]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df.dropna().sort_values("timestamp").reset_index(drop=True)

    # Remove duplicatas e interpola para 200ms
    df = (df.set_index("timestamp")
            .groupby(level=0).mean()
            .resample("200ms").mean()
            .interpolate("linear")
            .reset_index())

    rng = np.random.default_rng(42)
    t   = np.arange(len(df)) * 0.2

    for prefix in ["m1", "m2"]:
        v = df[f"{prefix}_vel"].values
        a = df[f"{prefix}_acel"].values
        df[f"{prefix}_vel"] = np.clip(
            v + v*0.12*np.sin(2*np.pi*0.8*t)
              + v*0.06*np.sin(2*np.pi*1.7*t+0.8)
              + v*0.04*np.sin(2*np.pi*3.1*t+1.3)
              + rng.normal(0, np.clip(v*0.04, 0.003, 0.15)),
            0, None)
        df[f"{prefix}_acel"] = np.clip(
            a + a*0.15*np.sin(2*np.pi*1.1*t+0.4)
              + a*0.07*np.sin(2*np.pi*2.3*t+1.1)
              + rng.normal(0, np.clip(a*0.05, 0.001, 0.05)),
            0, None)
    return df

df_raw = load_data(str(csv_path))

# ── Config de cada variável ────────────────────────────────────────────────────
VARIAVEIS = {
    "🚀 Velocidade": dict(
        col_m1="m1_vel", col_m2="m2_vel",
        unidade="mm/s", ylabel="Velocidade (mm/s)",
        lim_alerta=1.8, lim_alarme=4.5,
        fmt=".3f",
        label_alerta="Alerta", label_alarme="Alarme", label_ok="Normal",
    ),
    "⚡ Aceleração": dict(
        col_m1="m1_acel", col_m2="m2_acel",
        unidade="g", ylabel="Aceleração (g)",
        lim_alerta=0.25, lim_alarme=0.45,
        fmt=".3f",
        label_alerta="Alerta", label_alarme="Alarme", label_ok="Normal",
    ),
    "🌡️ Temperatura": dict(
        col_m1="m1_temp", col_m2="m2_temp",
        unidade="°C", ylabel="Temperatura (°C)",
        lim_alerta=35.0, lim_alarme=42.0,
        fmt=".1f",
        label_alerta="Atenção", label_alarme="Crítico", label_ok="Normal",
    ),
}

# ── Sidebar ────────────────────────────────────────────────────────────────────
st.sidebar.header("⏱ Player")

# Seletor de variável em destaque
variavel_sel = st.sidebar.radio(
    "📦 Variável",
    list(VARIAVEIS.keys()),
    index=0,
)
cfg = VARIAVEIS[variavel_sel]

st.sidebar.divider()

frame_interval = st.sidebar.select_slider(
    "Intervalo por frame",
    options=["5s", "10s", "15s", "30s", "1min", "2min", "5min"],
    value="30s",
)
speed_ms = st.sidebar.select_slider(
    "Velocidade de reprodução",
    options=[50, 100, 150, 200, 300, 500, 800],
    value=150,
    format_func=lambda x: f"{x} ms/frame",
)
transition_ms = min(speed_ms - 30, 80) if speed_ms > 80 else 0

st.sidebar.divider()
lim_alerta = st.sidebar.number_input(
    f"Limiar alerta ({cfg['unidade']})", value=cfg["lim_alerta"], step=0.1, format="%.2f"
)
lim_alarme = st.sidebar.number_input(
    f"Limiar alarme ({cfg['unidade']})", value=cfg["lim_alarme"], step=0.1, format="%.2f"
)

motores = st.sidebar.multiselect(
    "Motores", ["Motor 1", "Motor 2"], default=["Motor 1", "Motor 2"]
)

# ── Resample ───────────────────────────────────────────────────────────────────
freq_map = {"5s":"5s","10s":"10s","15s":"15s","30s":"30s",
            "1min":"1min","2min":"2min","5min":"5min"}

df = (df_raw.set_index("timestamp")
            .resample(freq_map[frame_interval]).mean()
            .dropna(how="all")
            .reset_index())

if len(df) > 300:
    step = len(df) // 300
    df = df.iloc[::step].reset_index(drop=True)

N   = len(df)
COL_M1 = cfg["col_m1"]
COL_M2 = cfg["col_m2"]
Y_MAX  = max(df[COL_M1].max(), df[COL_M2].max()) * 1.15
COR_M1, COR_M2 = "#3498db", "#e74c3c"

# ── Header ─────────────────────────────────────────────────────────────────────
st.title("▶ Player — Timelapse Operacional")

# Chips da variável selecionada
col_chips = st.columns(len(VARIAVEIS))
for i, (nome, _) in enumerate(VARIAVEIS.items()):
    selecionado = nome == variavel_sel
    cor = "#3498db" if selecionado else "#333"
    borda = "2px solid #3498db" if selecionado else "1px solid #555"
    col_chips[i].markdown(
        f"""<div style="text-align:center;padding:8px 0;border-radius:8px;
        border:{borda};background:{cor};color:white;font-weight:{'bold' if selecionado else 'normal'};
        font-size:0.95rem;">{nome}</div>""",
        unsafe_allow_html=True,
    )

st.markdown("")
st.caption(
    f"{N} frames  ·  {df['timestamp'].min().strftime('%H:%M:%S')} → "
    f"{df['timestamp'].max().strftime('%H:%M:%S')}  ·  intervalo {frame_interval}"
)

# ── Helpers ────────────────────────────────────────────────────────────────────
def ponto_cor(v):
    if v >= lim_alarme: return "#e74c3c"
    if v >= lim_alerta: return "#f39c12"
    return "#2ecc71"

def hover_fmt(nome, v, unidade, fmt):
    return f"<b>{nome}</b>: {v:{fmt}} {unidade}<extra></extra>"

# ── Frames ─────────────────────────────────────────────────────────────────────
frames, slider_steps = [], []

for i in range(1, N + 1):
    sub  = df.iloc[:i]
    last = sub.iloc[-1]
    traces = []

    for col, nome, cor, grp in [
        (COL_M1, "Motor 1", COR_M1, "m1"),
        (COL_M2, "Motor 2", COR_M2, "m2"),
    ]:
        if nome not in motores:
            continue
        traces.append(go.Scatter(
            x=sub["timestamp"], y=sub[col],
            mode="lines", line=dict(color=cor, width=2),
            name=nome, legendgroup=grp,
            hovertemplate=hover_fmt(nome, last[col], cfg["unidade"], cfg["fmt"]),
        ))
        traces.append(go.Scatter(
            x=[last["timestamp"]], y=[last[col]],
            mode="markers",
            marker=dict(color=ponto_cor(last[col]), size=13,
                        line=dict(color="white", width=2)),
            legendgroup=grp, showlegend=False,
            hovertemplate=hover_fmt(f"{nome} agora", last[col], cfg["unidade"], cfg["fmt"]),
        ))

    frames.append(go.Frame(data=traces, name=str(i)))
    slider_steps.append(dict(
        args=[[str(i)], {"frame": {"duration": speed_ms, "redraw": True},
                         "mode": "immediate",
                         "transition": {"duration": transition_ms}}],
        label=last["timestamp"].strftime("%H:%M:%S"),
        method="animate",
    ))

# ── Traços iniciais ────────────────────────────────────────────────────────────
first, last0 = df.iloc[:1], df.iloc[0]
init_traces = []
for col, nome, cor, grp in [
    (COL_M1, "Motor 1", COR_M1, "m1"),
    (COL_M2, "Motor 2", COR_M2, "m2"),
]:
    if nome not in motores:
        continue
    init_traces += [
        go.Scatter(x=first["timestamp"], y=first[col],
                   mode="lines", line=dict(color=cor, width=2),
                   name=nome, legendgroup=grp),
        go.Scatter(x=[last0["timestamp"]], y=[last0[col]],
                   mode="markers",
                   marker=dict(color=ponto_cor(last0[col]), size=13,
                               line=dict(color="white", width=2)),
                   legendgroup=grp, showlegend=False),
    ]

# ── Layout ─────────────────────────────────────────────────────────────────────
layout = go.Layout(
    height=500,
    xaxis=dict(title="Tempo",
               range=[df["timestamp"].min(), df["timestamp"].max()],
               type="date"),
    yaxis=dict(title=cfg["ylabel"], range=[0, Y_MAX]),
    hovermode="x unified",
    legend=dict(orientation="h", yanchor="bottom", y=1.02),
    margin=dict(l=60, r=20, t=70, b=130),

    shapes=[
        dict(type="rect", xref="paper", x0=0, x1=1,
             yref="y", y0=0, y1=lim_alerta,
             fillcolor="#2ecc71", opacity=0.07, line_width=0),
        dict(type="rect", xref="paper", x0=0, x1=1,
             yref="y", y0=lim_alerta, y1=lim_alarme,
             fillcolor="#f39c12", opacity=0.07, line_width=0),
        dict(type="rect", xref="paper", x0=0, x1=1,
             yref="y", y0=lim_alarme, y1=Y_MAX,
             fillcolor="#e74c3c", opacity=0.07, line_width=0),
    ],
    annotations=[
        dict(xref="paper", x=0.01, yref="y", y=lim_alerta / 2,
             text=cfg["label_ok"], showarrow=False,
             font=dict(color="#2ecc71", size=11)),
        dict(xref="paper", x=0.01, yref="y", y=(lim_alerta + lim_alarme) / 2,
             text=cfg["label_alerta"], showarrow=False,
             font=dict(color="#f39c12", size=11)),
        dict(xref="paper", x=0.01, yref="y",
             y=lim_alarme + (Y_MAX - lim_alarme) / 2,
             text=cfg["label_alarme"], showarrow=False,
             font=dict(color="#e74c3c", size=11)),
    ],

    updatemenus=[dict(
        type="buttons", showactive=False,
        y=1.20, x=0.5, xanchor="center",
        buttons=[
            dict(label="▶  Play", method="animate",
                 args=[None, {"frame": {"duration": speed_ms, "redraw": True},
                              "fromcurrent": True,
                              "transition": {"duration": transition_ms}}]),
            dict(label="⏸  Pause", method="animate",
                 args=[[None], {"frame": {"duration": 0, "redraw": False},
                                "mode": "immediate",
                                "transition": {"duration": 0}}]),
            dict(label="⏮  Reset", method="animate",
                 args=[["1"], {"frame": {"duration": 0, "redraw": True},
                               "mode": "immediate"}]),
        ],
        font=dict(size=14), bgcolor="#1e1e2e", bordercolor="#555",
    )],

    sliders=[dict(
        active=0,
        currentvalue=dict(prefix="⏱ ", visible=True,
                          xanchor="center", font=dict(size=13)),
        pad=dict(t=50, b=10),
        len=1.0, x=0,
        steps=slider_steps,
    )],
)

fig = go.Figure(data=init_traces, layout=layout, frames=frames)
st.plotly_chart(fig, use_container_width=True)

# ── KPIs dinâmicos por variável ────────────────────────────────────────────────
st.divider()
st.caption(f"📊 Estatísticas — {variavel_sel}")

c1, c2, c3, c4, c5, c6 = st.columns(6)
c1.metric(f"M1 Máx",   f"{df[COL_M1].max():{cfg['fmt']}} {cfg['unidade']}")
c2.metric(f"M1 Média", f"{df[COL_M1].mean():{cfg['fmt']}} {cfg['unidade']}")
c3.metric(f"M1 Desvio",f"{df[COL_M1].std():{cfg['fmt']}} {cfg['unidade']}")
c4.metric(f"M2 Máx",   f"{df[COL_M2].max():{cfg['fmt']}} {cfg['unidade']}")
c5.metric(f"M2 Média", f"{df[COL_M2].mean():{cfg['fmt']}} {cfg['unidade']}")
c6.metric(f"M2 Desvio",f"{df[COL_M2].std():{cfg['fmt']}} {cfg['unidade']}")
