"""Análise espectral — FFT com marcadores de harmônicas e bandas de falha."""
import numpy as np
import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import streamlit as st
from streamlit_autorefresh import st_autorefresh

from utils.mock_data import gerar_historico_simulado, MODO_NORMAL, MODO_DESBALANCO, MODO_CAVITACAO, MODO_DESALINHAMENTO

st.set_page_config(page_title="Análise Espectral — Digital TWIN", layout="wide")
import sys; sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent.parent))
from utils.theme import apply as _apply_theme, sidebar_header as _sh
_apply_theme(); _sh()

st_autorefresh(interval=4000, key="espectral_refresh")

st.title("🔬 Análise Espectral de Vibração")
st.caption("FFT simulada a 200 Sa/s — sensor VIM32PL (faixa real 10–1000 Hz)")

# ── Sidebar ───────────────────────────────────────────────────────────────────
with st.sidebar:
    st.header("⚙️ Parâmetros")
    rpm = st.slider("RPM do equipamento", 1000, 4000, 2980, 10)
    modo = st.selectbox("Cenário",
        [MODO_NORMAL, MODO_DESBALANCO, MODO_CAVITACAO, MODO_DESALINHAMENTO],
        format_func=lambda x: {
            MODO_NORMAL:         "✅ Normal",
            MODO_DESBALANCO:     "⚠️ Desbalanceamento",
            MODO_CAVITACAO:      "🌊 Cavitação",
            MODO_DESALINHAMENTO: "❌ Desalinhamento",
        }[x]
    )
    fs = st.selectbox("Frequência de amostragem (Sa/s)", [200, 500, 1000], index=0)
    janela_s = st.slider("Janela de análise (s)", 2, 20, 5)
    st.divider()
    mostrar_harmonicas = st.toggle("Marcar harmônicas RPM", value=True)
    mostrar_bandas_falha = st.toggle("Marcar bandas de falha", value=True)

freq_rot = rpm / 60.0  # Hz

# ── Gerar sinal sintético a fs Hz ────────────────────────────────────────────
def gerar_sinal(fs: int, dur: float, modo: str, freq_rot: float) -> np.ndarray:
    """Sinal de vibração com componentes realistas conforme modo de falha."""
    rng = np.random.default_rng(seed=int(st.session_state.get("seed_esp", 42)))
    N = int(fs * dur)
    t = np.linspace(0, dur, N, endpoint=False)

    # Ruído de fundo
    sinal = rng.normal(0, 0.005, N)

    if modo == MODO_NORMAL:
        # 1x RPM dominante, pequena 2x
        sinal += 0.04 * np.sin(2 * np.pi * freq_rot * t)
        sinal += 0.01 * np.sin(2 * np.pi * freq_rot * 2 * t)

    elif modo == MODO_DESBALANCO:
        # 1x RPM bem elevado — assinatura clássica de desbalanceamento
        sinal += 0.18 * np.sin(2 * np.pi * freq_rot * t)
        sinal += 0.04 * np.sin(2 * np.pi * freq_rot * 2 * t)
        sinal += 0.01 * np.sin(2 * np.pi * freq_rot * 3 * t)

    elif modo == MODO_CAVITACAO:
        # Banda larga de ruído + picos irregulares (fluido)
        sinal += rng.normal(0, 0.05, N)
        # Sub-harmônica
        sinal += 0.06 * np.sin(2 * np.pi * freq_rot * 0.5 * t)
        sinal += 0.03 * np.sin(2 * np.pi * freq_rot * t)

    elif modo == MODO_DESALINHAMENTO:
        # 2x RPM dominante + 1x e 3x
        sinal += 0.05 * np.sin(2 * np.pi * freq_rot * t)
        sinal += 0.16 * np.sin(2 * np.pi * freq_rot * 2 * t)
        sinal += 0.07 * np.sin(2 * np.pi * freq_rot * 3 * t)

    return sinal


if "seed_esp" not in st.session_state:
    st.session_state.seed_esp = 42

sinal = gerar_sinal(fs, janela_s, modo, freq_rot)
N = len(sinal)

# Remove DC, janela Hanning
sinal -= sinal.mean()
sinal_w = sinal * np.hanning(N)

# FFT
freqs     = np.fft.rfftfreq(N, d=1.0 / fs)
amplitudes = np.abs(np.fft.rfft(sinal_w)) * 2 / N

# Pico dominante (ignora DC)
idx_pico  = np.argmax(amplitudes[1:]) + 1
freq_pico = freqs[idx_pico]
amp_pico  = amplitudes[idx_pico]

# ── Gráfico espectral ─────────────────────────────────────────────────────────
fig = go.Figure()

fig.add_trace(go.Scatter(
    x=freqs, y=amplitudes,
    mode="lines", fill="tozeroy",
    line=dict(color="#9b59b6", width=1.5),
    fillcolor="rgba(155,89,182,0.12)",
    name="Amplitude (g)",
))

# Pico dominante
fig.add_vline(x=freq_pico, line_dash="dash", line_color="#e74c3c",
              annotation_text=f"Pico: {freq_pico:.2f} Hz",
              annotation_font_color="#e74c3c")

# Harmônicas de RPM
if mostrar_harmonicas:
    for h, cor, label in [
        (1, "#3498db",   "1x"),
        (2, "#2ecc71",   "2x"),
        (3, "#f39c12",   "3x"),
        (4, "#e67e22",   "4x"),
    ]:
        fx = freq_rot * h
        if fx < freqs[-1]:
            fig.add_vline(x=fx, line_dash="dot", line_color=cor, line_width=1,
                          annotation_text=f"{label} {fx:.1f}Hz",
                          annotation_font_color=cor, annotation_position="top")

# Bandas de falha típicas
if mostrar_bandas_falha:
    # Sub-harmônica (cavitação)
    fig.add_vrect(x0=freq_rot * 0.4, x1=freq_rot * 0.6,
                  fillcolor="rgba(52,152,219,0.06)",
                  annotation_text="Sub-harm.", annotation_position="top left",
                  annotation_font_size=10)
    # Zona de desbalanceamento (0.9–1.1x)
    fig.add_vrect(x0=freq_rot * 0.9, x1=freq_rot * 1.1,
                  fillcolor="rgba(230,126,34,0.07)",
                  annotation_text="Desbal.", annotation_position="top right",
                  annotation_font_size=10)

fig.update_layout(
    title=f"Espectro FFT — {modo.capitalize()} · {rpm} RPM · fs={fs} Sa/s · janela={janela_s}s",
    xaxis_title="Frequência (Hz)",
    yaxis_title="Amplitude (g)",
    height=420,
    margin=dict(l=50, r=30, t=60, b=50),
    paper_bgcolor="rgba(0,0,0,0)",
    plot_bgcolor="rgba(0,0,0,0)",
    font_color="#eee",
    xaxis=dict(gridcolor="#222"),
    yaxis=dict(gridcolor="#222"),
    hovermode="x unified",
)
st.plotly_chart(fig, use_container_width=True)

# ── Métricas ──────────────────────────────────────────────────────────────────
m1, m2, m3, m4 = st.columns(4)
m1.metric("Pico dominante", f"{freq_pico:.2f} Hz")
m2.metric("Amplitude do pico", f"{amp_pico:.4f} g")
m3.metric("Freq. rotação (1x)", f"{freq_rot:.2f} Hz")
m4.metric("Relação pico/1x",
          f"{freq_pico / freq_rot:.2f}x",
          help="1.0 = desbalanceamento; 2.0 = desalinhamento; 0.5 = cavitação")

st.divider()

# ── Espectrograma (waterfall) ─────────────────────────────────────────────────
st.subheader("📊 Espectrograma — Evolução Temporal")
st.caption("Cada linha é uma janela de 1 s; intensidade representa amplitude (g)")

n_frames = 30
frame_len = fs  # 1 s de dados por linha
sinal_long = gerar_sinal(fs, n_frames, modo, freq_rot)

Z = []
for i in range(n_frames):
    seg = sinal_long[i * frame_len: (i + 1) * frame_len]
    seg -= seg.mean()
    seg *= np.hanning(len(seg))
    amp = np.abs(np.fft.rfft(seg)) * 2 / len(seg)
    Z.append(amp)

Z = np.array(Z)
f_ax = np.fft.rfftfreq(frame_len, 1.0 / fs)
t_ax = list(range(n_frames))

fig_wf = go.Figure(go.Heatmap(
    z=Z,
    x=f_ax,
    y=t_ax,
    colorscale="Plasma",
    colorbar=dict(title=dict(text="g", font=dict(color="#eee")), tickfont=dict(color="#eee")),
    hovertemplate="Freq: %{x:.1f} Hz<br>t: %{y}s<br>Amp: %{z:.5f} g<extra></extra>",
))

if mostrar_harmonicas:
    for h, cor in [(1, "#3498db"), (2, "#2ecc71"), (3, "#f39c12")]:
        fx = freq_rot * h
        if fx < f_ax[-1]:
            fig_wf.add_vline(x=fx, line_color=cor, line_width=1.5, line_dash="dot")

fig_wf.update_layout(
    xaxis_title="Frequência (Hz)",
    yaxis_title="Tempo (s)",
    height=380,
    margin=dict(l=50, r=20, t=20, b=50),
    paper_bgcolor="rgba(0,0,0,0)",
    plot_bgcolor="rgba(0,0,0,0)",
    font_color="#eee",
)
st.plotly_chart(fig_wf, use_container_width=True)

# ── Tabela de picos ───────────────────────────────────────────────────────────
with st.expander("Top 10 picos espectrais"):
    top_idx = np.argsort(amplitudes[1:])[::-1][:10] + 1
    df_picos = pd.DataFrame({
        "Frequência (Hz)": freqs[top_idx].round(2),
        "Amplitude (g)":   amplitudes[top_idx].round(6),
        "Relação 1x RPM":  (freqs[top_idx] / freq_rot).round(2),
    })
    st.dataframe(df_picos, use_container_width=True, hide_index=True)
