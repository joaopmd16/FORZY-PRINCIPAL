"""
SCADA 2D / 3D — Planta virtual da bancada Forzy
Timelapse integrado com alerta piscante por temperatura
"""

import numpy as np
import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import streamlit as st
from streamlit_autorefresh import st_autorefresh
from pathlib import Path

st.set_page_config(page_title="SCADA — Forzy", layout="wide")
import sys; sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent.parent))
from utils.theme import apply as _apply_theme, sidebar_nav as _snav
_apply_theme(); _snav("scada")


# ══════════════════════════════════════════════════════════════════════════════
# CSS — alerta piscante
# ══════════════════════════════════════════════════════════════════════════════
st.markdown("""
<style>
@keyframes blink-red {
  0%,100% { background:#e74c3c; box-shadow:0 0 18px #e74c3c; opacity:1; }
  50%      { background:#7b1a1a; box-shadow:0 0 4px #e74c3c;  opacity:.5; }
}
@keyframes blink-yellow {
  0%,100% { background:#f39c12; box-shadow:0 0 14px #f39c12; opacity:1; }
  50%      { background:#7d5005; box-shadow:0 0 4px #f39c12;  opacity:.5; }
}
.alert-red    { animation:blink-red    .7s infinite; border-radius:8px;
                padding:10px 20px; color:#fff; font-weight:bold; text-align:center; }
.alert-yellow { animation:blink-yellow 1s infinite;  border-radius:8px;
                padding:10px 20px; color:#fff; font-weight:bold; text-align:center; }
.status-ok    { background:#2ecc71; border-radius:8px;
                padding:10px 20px; color:#fff; font-weight:bold; text-align:center; }
.player-bar   { background:#1a1a2e; border-radius:10px; padding:12px 20px;
                margin-bottom:16px; }
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
    st.error("CSV não encontrado.")
    st.stop()

@st.cache_data
def load_data(path: str) -> pd.DataFrame:
    df = pd.read_csv(path, sep=";", skiprows=3, header=None,
                     usecols=[0,3,4,5,6,7,8],
                     names=["ts","m1_vel","m1_acel","m1_temp",
                                  "m2_vel","m2_acel","m2_temp"])
    df["ts"] = pd.to_datetime(df["ts"])
    for c in df.columns[1:]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df.dropna().sort_values("ts").reset_index(drop=True)
    return (df.set_index("ts").resample("5s").mean()
              .dropna(how="all").reset_index())

df = load_data(str(csv_path))
if len(df) > 400:
    df = df.iloc[::len(df)//400].reset_index(drop=True)
N = len(df)

# ══════════════════════════════════════════════════════════════════════════════
# Limiares
# ══════════════════════════════════════════════════════════════════════════════
TEMP_ALERTA  = 35.0
TEMP_ALARME  = 42.0
VEL_ALERTA   = 1.8   # mm/s — ISO 10816 Classe I
VEL_ALARME   = 4.5   # mm/s
ACEL_ALERTA  = 0.25  # g
ACEL_ALARME  = 0.45  # g

def flag(v, a, al): return 2 if v>=al else 1 if v>=a else 0
FLAG_COR  = {0:"#2ecc71", 1:"#f39c12", 2:"#e74c3c"}
FLAG_NOME = {0:"OK", 1:"ALERTA", 2:"ALARME"}

# ══════════════════════════════════════════════════════════════════════════════
# Seletor de fonte global
# ══════════════════════════════════════════════════════════════════════════════
from utils.fonte import render_fonte_selector, FONTE_FORZY
_fonte_dados = render_fonte_selector(key_prefix="scada")
_usando_forzy = (_fonte_dados["fonte"] == FONTE_FORZY)

# ══════════════════════════════════════════════════════════════════════════════
# Session state — player (só relevante no modo Forzy)
# ══════════════════════════════════════════════════════════════════════════════
for k, v in [("fidx", 0), ("playing", False), ("speed", 200)]:
    if k not in st.session_state:
        st.session_state[k] = v

# Autorefresh SEMPRE ativo — intervalo curto quando tocando, longo quando pausado
_interval = st.session_state.speed if (st.session_state.playing and _usando_forzy) else 86_400_000
st_autorefresh(interval=_interval, key="scada_play")

# Avança frame a cada rerun
if st.session_state.playing and _usando_forzy:
    st.session_state.fidx = min(st.session_state.fidx + 1, N - 1)
    if st.session_state.fidx >= N - 1:
        st.session_state.playing = False

# ── Row de dados — vem do seletor de fonte ─────────────────────────────────
if _usando_forzy:
    row = df.iloc[st.session_state.fidx]
else:
    # Ativo ou Simulado: cria objeto compatível com row
    _l = _fonte_dados["leitura"]
    row = pd.Series({
        "ts":      pd.Timestamp.now(),
        "m1_vel":  _l.get("m1_vel", 0.0),
        "m1_acel": _l.get("m1_acel", 0.0),
        "m1_temp": _l.get("m1_temp", 25.0),
        "m2_vel":  _l.get("m2_vel", 0.0),
        "m2_acel": _l.get("m2_acel", 0.0),
        "m2_temp": _l.get("m2_temp", 25.0),
    })

# ══════════════════════════════════════════════════════════════════════════════
# Sidebar
# ══════════════════════════════════════════════════════════════════════════════
with st.sidebar:
    st.header("SCADA Config")
    vista = st.radio("Vista", ["2D Planta", "3D Motor"], index=0)
    st.divider()
    st.subheader("Limiares")
    TEMP_ALERTA = st.number_input("Temp alerta °C", value=TEMP_ALERTA, step=1.0)
    TEMP_ALARME = st.number_input("Temp alarme °C", value=TEMP_ALARME, step=1.0)
    VEL_ALERTA  = st.number_input("Vel alerta mm/s", value=VEL_ALERTA, step=0.1)
    VEL_ALARME  = st.number_input("Vel alarme mm/s", value=VEL_ALARME, step=0.1)
    st.divider()
    st.caption(f"Frame {st.session_state.fidx+1}/{N}")
    st.caption(f"{row['ts'].strftime('%H:%M:%S')}")

# ══════════════════════════════════════════════════════════════════════════════
# Header + Player bar
# ══════════════════════════════════════════════════════════════════════════════
st.title("SCADA — Bancada Forzy")

with st.container():
    st.markdown('<div class="player-bar">', unsafe_allow_html=True)
    pc1, pc2, pc3, pc4, pc5, pc6 = st.columns([1, 1, 1, 1, 5, 1])

    # ⏮ Reset — sempre habilitado
    with pc1:
        if st.button("⏮", use_container_width=True, key="btn_reset"):
            st.session_state.fidx = 0
            st.session_state.playing = False
            st.rerun()

    # ▶ Play — desabilitado se já tocando
    with pc2:
        if st.button("▶", use_container_width=True, key="btn_play",
                     disabled=st.session_state.playing):
            if st.session_state.fidx >= N - 1:
                st.session_state.fidx = 0
            st.session_state.playing = True
            st.rerun()

    # ⏸ Pause — desabilitado se pausado
    with pc3:
        if st.button("⏸", use_container_width=True, key="btn_pause",
                     disabled=not st.session_state.playing):
            st.session_state.playing = False
            st.rerun()

    # Velocidade
    with pc4:
        spd = st.selectbox("", [50, 100, 200, 300, 500],
                           index=[50,100,200,300,500].index(
                               st.session_state.speed)
                               if st.session_state.speed in [50,100,200,300,500] else 2,
                           format_func=lambda x: f"{x} ms",
                           label_visibility="collapsed", key="sel_speed")
        st.session_state.speed = spd

    # Slider — sem key para que value= sempre seja respeitado
    with pc5:
        slider_val = st.slider("", 0, N - 1,
                               value=st.session_state.fidx,
                               label_visibility="collapsed")
        # Só atualiza fidx a partir do slider se o usuário arrastou (não playing)
        if not st.session_state.playing and slider_val != st.session_state.fidx:
            st.session_state.fidx = slider_val
            st.rerun()

    # Timestamp atual
    with pc6:
        st.markdown(
            f"<div style='color:#aaa;font-size:.82rem;padding-top:8px;text-align:center'>"
            f"{row['ts'].strftime('%H:%M:%S')}</div>",
            unsafe_allow_html=True)

    st.markdown('</div>', unsafe_allow_html=True)

# ══════════════════════════════════════════════════════════════════════════════
# Alertas piscantes
# ══════════════════════════════════════════════════════════════════════════════
f_m1_temp = flag(row.m1_temp, TEMP_ALERTA, TEMP_ALARME)
f_m2_temp = flag(row.m2_temp, TEMP_ALERTA, TEMP_ALARME)
f_m1_vel  = flag(row.m1_vel,  VEL_ALERTA,  VEL_ALARME)
f_m2_vel  = flag(row.m2_vel,  VEL_ALERTA,  VEL_ALARME)

al1, al2 = st.columns(2)
with al1:
    css = "alert-red" if f_m1_temp==2 else "alert-yellow" if f_m1_temp==1 else "status-ok"
    st.markdown(
        f'<div class="{css}">MOTOR 1 — Temp {row.m1_temp:.1f}°C '
        f'| Vel {row.m1_vel:.2f} m/s — {FLAG_NOME[max(f_m1_temp,f_m1_vel)]}</div>',
        unsafe_allow_html=True)
with al2:
    css = "alert-red" if f_m2_temp==2 else "alert-yellow" if f_m2_temp==1 else "status-ok"
    st.markdown(
        f'<div class="{css}">MOTOR 2 — Temp {row.m2_temp:.1f}°C '
        f'| Vel {row.m2_vel:.2f} m/s — {FLAG_NOME[max(f_m2_temp,f_m2_vel)]}</div>',
        unsafe_allow_html=True)

st.markdown("")

# ══════════════════════════════════════════════════════════════════════════════
# TABS — 2D / 3D
# ══════════════════════════════════════════════════════════════════════════════
tab2d, tab3d, tab_hist = st.tabs(["Planta 2D", "Vista 3D", "Histórico"])

# ─────────────────────────────────────────────────────────────────────────────
# helpers de cor com "blink" simulado por frame par/ímpar
# ─────────────────────────────────────────────────────────────────────────────
blink_on = (st.session_state.fidx % 3) < 2   # 2 frames aceso, 1 apagado

def motor_fill(flag_temp, flag_vel):
    f = max(flag_temp, flag_vel)
    if f == 2:
        return FLAG_COR[2] if blink_on else "#4a1010"
    if f == 1:
        return FLAG_COR[1] if blink_on else "#6b4a00"
    return FLAG_COR[0]

mc1 = motor_fill(f_m1_temp, f_m1_vel)
mc2 = motor_fill(f_m2_temp, f_m2_vel)

# ══════════════════════════════════════════════════════════════════════════════
# ABA 2D
# ══════════════════════════════════════════════════════════════════════════════
with tab2d:
    import base64
    from pathlib import Path as _Path
    from PIL import Image as _PILImage
    import plotly.express as _px

    # ── SVG do ativo selecionado (se existir) ─────────────────────────────────
    _svg_ativo = _fonte_dados.get("svg")
    if _svg_ativo and _svg_ativo.exists():
        _ativo_info = _fonte_dados.get("ativo") or {}
        st.markdown(f"""
        <div style="background:#0a1628;border:1px solid #0f2a45;border-radius:8px;
                    padding:10px 16px;margin-bottom:12px;display:flex;align-items:center;gap:12px">
          <span style="font-size:.65rem;color:#4a7a9b;text-transform:uppercase;letter-spacing:.1em">
            Planta 2D — Ativo
          </span>
          <span style="font-size:.85rem;font-weight:700;color:#7ec8e3">
            {_ativo_info.get('codigo','—')}
          </span>
          <span style="font-size:.75rem;color:#4a7a9b">
            {_ativo_info.get('descricao') or ''}
          </span>
        </div>
        """, unsafe_allow_html=True)
        _svg_content = _svg_ativo.read_text(encoding="utf-8", errors="replace")
        st.markdown(
            f'<div style="background:#0a1628;border:1px solid #0f2a45;border-radius:8px;'
            f'padding:16px;overflow:auto;max-height:500px">{_svg_content}</div>',
            unsafe_allow_html=True,
        )
        st.markdown('<hr style="border-color:#0f2035;margin:16px 0">', unsafe_allow_html=True)
        st.markdown('<p style="font-size:.72rem;color:#4a7a9b">Planta Geral da Bancada</p>',
                    unsafe_allow_html=True)

    # ── Carrega imagem da bomba (DWG extraído) ────────────────────────────────
    _img_path = _Path(__file__).parent.parent / "data" / "bomba.png"

    # ── Carrega imagem PIL para usar em layout.images ────────────────────────
    if _img_path.exists():
        _pil_img = _PILImage.open(_img_path).convert("RGBA")
        IW, IH = _pil_img.size
    else:
        _pil_img = None
        IW, IH = 900, 600

    fig2 = go.Figure()
    # Ponto invisível para forçar o range do eixo
    fig2.add_trace(go.Scatter(x=[0,1600], y=[0,700], mode="markers",
                               marker=dict(opacity=0), showlegend=False,
                               hoverinfo="skip"))

    def ann(x, y, txt, size=11, color="white", ax="center", ay="middle", bgcolor=None):
        kw = dict(bgcolor=bgcolor, bordercolor=color, borderwidth=1,
                  borderpad=4) if bgcolor else {}
        fig2.add_annotation(x=x, y=y, text=txt, showarrow=False,
                             font=dict(size=size, color=color),
                             xanchor=ax, yanchor=ay,
                             xref="x", yref="y", **kw)

    def box(x0, y0, x1, y1, fill, border, lw=2):
        fig2.add_shape(type="rect", x0=x0, y0=y0, x1=x1, y1=y1,
                       xref="x", yref="y",
                       fillcolor=fill, line=dict(color=border, width=lw),
                       layer="above")

    def wire(x0, y0, x1, y1, cor="#8e44ad", w=2):
        # Curva Bézier cúbica suave — linha sólida
        cx1, cy1 = x0 + (x1 - x0) * 0.5, y0
        cx2, cy2 = x0 + (x1 - x0) * 0.5, y1
        path = f"M {x0},{y0} C {cx1},{cy1} {cx2},{cy2} {x1},{y1}"
        # sombra (linha mais larga e transparente por baixo)
        fig2.add_shape(type="path", path=path, xref="x", yref="y",
                       line=dict(color="rgba(142,68,173,0.25)", width=w+4),
                       layer="above")
        # linha principal sólida
        fig2.add_shape(type="path", path=path, xref="x", yref="y",
                       line=dict(color=cor, width=w), layer="above")

    # ── Layout: canvas 1600×580, 2 motores lado a lado ───────────────────────
    CW, CH = 1600, 580
    # Imagem 1040×420 centralizada
    IX0, IY0 = (CW-1040)//2, 60
    ISX, ISY = 1040, 420

    # Sensor M1: sobre o motor esquerdo (corpo do motor ~motor esquerdo)
    S1X, S1Y = IX0 + 120, IY0 + 130
    # Sensor M2: sobre o motor direito
    S2X, S2Y = IX0 + 120 + 520, IY0 + 130

    # ── PAINEL MOTOR 1 (esquerda) ─────────────────────────────────────────────
    cm1 = FLAG_COR[max(f_m1_temp, f_m1_vel)]
    P1X, P1Y, P1W, P1H = 10, 100, 260, 300
    box(P1X, P1Y, P1X+P1W, P1Y+P1H, "rgba(13,17,23,0.92)", cm1, 2)
    cx = P1X + P1W//2
    ann(cx, P1Y+28,  "<b>MOTOR 1</b>",              14, cm1)
    ann(cx, P1Y+58,  "VIM32PL  ·  Port 1",           9, "#7ec8e3")
    ann(cx, P1Y+100, f"Vel: {row.m1_vel:.3f} mm/s",  12, FLAG_COR[f_m1_vel])
    ann(cx, P1Y+135, f"Acel: {row.m1_acel:.3f} g",    11, "#ccc")
    ann(cx, P1Y+170, f"Temp: {row.m1_temp:.1f} °C",   11, FLAG_COR[f_m1_temp])
    ann(cx, P1Y+215,
        f"● {FLAG_NOME[max(f_m1_temp,f_m1_vel)]}",
        13, FLAG_COR[max(f_m1_temp,f_m1_vel)], bgcolor="#0d1117")
    ann(cx, P1Y+265, f"{row['ts'].strftime('%H:%M:%S')}", 8, "#445566")

    # ── Fio e sensor 1 ────────────────────────────────────────────────────────
    wire(P1X+P1W, P1Y+P1H//2, S1X-15, S1Y)
    fig2.add_shape(type="circle",
                   x0=S1X-18, y0=S1Y-18, x1=S1X+18, y1=S1Y+18,
                   xref="x", yref="y",
                   fillcolor="#8e44ad", line=dict(color="#d7bde2", width=2),
                   layer="above")
    ann(S1X, S1Y-28, "VIM32PL", 8, "#d7bde2")

    # ── PAINEL MOTOR 2 (direita) ──────────────────────────────────────────────
    cm2 = FLAG_COR[max(f_m2_temp, f_m2_vel)]
    P2X, P2Y, P2W, P2H = CW-270, 100, 260, 300
    box(P2X, P2Y, P2X+P2W, P2Y+P2H, "rgba(13,17,23,0.92)", cm2, 2)
    cx2 = P2X + P2W//2
    ann(cx2, P2Y+28,  "<b>MOTOR 2</b>",              14, cm2)
    ann(cx2, P2Y+58,  "VIM32PL  ·  Port 2",           9, "#7ec8e3")
    ann(cx2, P2Y+100, f"Vel: {row.m2_vel:.3f} mm/s",  12, FLAG_COR[f_m2_vel])
    ann(cx2, P2Y+135, f"Acel: {row.m2_acel:.3f} g",    11, "#ccc")
    ann(cx2, P2Y+170, f"Temp: {row.m2_temp:.1f} °C",   11, FLAG_COR[f_m2_temp])
    ann(cx2, P2Y+215,
        f"● {FLAG_NOME[max(f_m2_temp,f_m2_vel)]}",
        13, FLAG_COR[max(f_m2_temp,f_m2_vel)], bgcolor="#0d1117")
    ann(cx2, P2Y+265, f"Frame {st.session_state.fidx+1}/{N}", 8, "#445566")

    # ── Fio e sensor 2 ────────────────────────────────────────────────────────
    wire(P2X, P2Y+P2H//2, S2X+15, S2Y)
    fig2.add_shape(type="circle",
                   x0=S2X-18, y0=S2Y-18, x1=S2X+18, y1=S2Y+18,
                   xref="x", yref="y",
                   fillcolor="#8e44ad", line=dict(color="#d7bde2", width=2),
                   layer="above")
    ann(S2X, S2Y-28, "VIM32PL", 8, "#d7bde2")

    # ── Título e legenda ──────────────────────────────────────────────────────
    ann(CW//2, CH-55,
        "<b>BANCADA DE TESTES — FORZY</b>  ·  Sensor VIM32PL IO-Link",
        13, "#7ec8e3")
    for lx, cor, txt in [(520,"#2ecc71","OK"),(620,"#f39c12","Alerta"),
                          (730,"#e74c3c","Alarme"),(840,"#8e44ad","Sensor VIM32PL")]:
        fig2.add_shape(type="rect", x0=lx, y0=CH-30, x1=lx+16, y1=CH-14,
                       xref="x", yref="y",
                       fillcolor=cor, line=dict(color="#111",width=1), layer="above")
        ann(lx+26, CH-22, txt, 8, "#aaa", "left")

    fig2.update_layout(
        xaxis=dict(range=[0, CW], showgrid=False, zeroline=False, showticklabels=False, fixedrange=True),
        yaxis=dict(range=[CH, 0], showgrid=False, zeroline=False, showticklabels=False, fixedrange=True),
        images=[dict(
            source=_pil_img,
            xref="x", yref="y",
            x=IX0, y=IY0,
            sizex=ISX, sizey=ISY,
            sizing="stretch",
            opacity=0.95,
            layer="below",
        )] if _img_path.exists() else [],
        height=580,
        margin=dict(l=0, r=0, t=10, b=0),
        paper_bgcolor="#0d1117",
        plot_bgcolor="#0d1117",
        showlegend=False,
    )
    st.plotly_chart(fig2, use_container_width=True)

# ══════════════════════════════════════════════════════════════════════════════
# ABA 3D
# ══════════════════════════════════════════════════════════════════════════════
with tab3d:
    from pathlib import Path as _P3
    _vpath = _P3(__file__).parent.parent / "data" / "bomba_verts.npy"
    _fpath = _P3(__file__).parent.parent / "data" / "bomba_faces.npy"

    fig3 = go.Figure()

    if _vpath.exists() and _fpath.exists():
        V = np.load(str(_vpath)).astype(float)
        F = np.load(str(_fpath))

        # Normaliza para caber em -5..5 e centraliza
        scale = 10.0 / (V.max() - V.min())
        V = V * scale

        # Separa faces e re-indexa vértices para cada grupo
        z_face = V[F].mean(axis=1)[:,2]
        z_corte = -1.8

        pior = max(f_m1_temp, f_m1_vel, f_m2_temp, f_m2_vel)
        cor_maq = FLAG_COR[pior]

        lighting = dict(ambient=0.45, diffuse=0.85, specular=0.35,
                        roughness=0.45, fresnel=0.25)
        lpos = dict(x=150, y=250, z=200)

        def add_mesh_group(fig, V, F, mask, color, name, opacity=0.93, area_max=None):
            F_sel = F[mask]
            if len(F_sel) == 0:
                return
            # Remove faces com área anômala (artefatos de tessellação)
            if area_max is not None:
                v0=V[F_sel[:,0]]; v1=V[F_sel[:,1]]; v2=V[F_sel[:,2]]
                areas = np.linalg.norm(np.cross(v1-v0, v2-v0), axis=1)*0.5
                F_sel = F_sel[areas <= area_max]
            if len(F_sel) == 0:
                return
            # Re-indexa vértices usados
            used = np.unique(F_sel)
            remap = np.zeros(V.shape[0], dtype=int)
            remap[used] = np.arange(len(used))
            V_sel = V[used]
            F_new = remap[F_sel]
            fig.add_trace(go.Mesh3d(
                x=V_sel[:,0], y=V_sel[:,1], z=V_sel[:,2],
                i=F_new[:,0], j=F_new[:,1], k=F_new[:,2],
                color=color, opacity=opacity, name=name,
                flatshading=False, lighting=lighting, lightposition=lpos,
                hoverinfo="skip", showlegend=True,
            ))

        # Base: faces planas grandes são normais — sem filtro de área
        add_mesh_group(fig3, V, F, z_face <= z_corte,
                       "#1e3d5c", "Base / Skid", opacity=0.97, area_max=None)
        # Máquina: tampas de cilindro chegam a ~0.8 — artefatos estão em 3.5+
        add_mesh_group(fig3, V, F, z_face > z_corte,
                       cor_maq, f"Bomba — {FLAG_NOME[pior]}", opacity=0.93, area_max=2.0)

        # Marca os dois pontos de sensor na carcaça
        sx1 = V[:,0].min() + (V[:,0].max()-V[:,0].min()) * 0.35
        sx2 = V[:,0].min() + (V[:,0].max()-V[:,0].min()) * 0.65
        sz  = V[:,2].max()
        sy  = V[:,1].mean()

        for sx, nome, fc_t, fc_v, rv in [
            (sx1, "Motor 1", f_m1_temp, f_m1_vel, row),
            (sx2, "Motor 2", f_m2_temp, f_m2_vel, row),
        ]:
            cor_s = FLAG_COR[max(fc_t, fc_v)]
            vel_v = rv.m1_vel if "Motor 1" == nome else rv.m2_vel
            tmp_v = rv.m1_temp if "Motor 1" == nome else rv.m2_temp
            acel_v = rv.m1_acel if "Motor 1" == nome else rv.m2_acel

            fig3.add_trace(go.Scatter3d(
                x=[sx], y=[sy], z=[sz + 0.3],
                mode="markers+text",
                marker=dict(size=12, color="#8e44ad", symbol="diamond",
                            line=dict(color="#d7bde2", width=2)),
                text=[f"VIM32PL<br>{FLAG_NOME[max(fc_t,fc_v)]}"],
                textposition="top center",
                textfont=dict(color=cor_s, size=10),
                name=f"Sensor {nome}",
                hovertemplate=(
                    f"<b>{nome}</b><br>"
                    f"Vel: {vel_v:.3f} mm/s<br>"
                    f"Acel: {acel_v:.3f} g<br>"
                    f"Temp: {tmp_v:.1f} °C<br>"
                    f"Status: {FLAG_NOME[max(fc_t,fc_v)]}"
                    "<extra></extra>"
                ),
            ))

            # Linha vertical do sensor até a carcaça
            fig3.add_trace(go.Scatter3d(
                x=[sx, sx], y=[sy, sy], z=[V[:,2].max()*0.6, sz+0.3],
                mode="lines",
                line=dict(color="#8e44ad", width=3, dash="dot"),
                showlegend=False, hoverinfo="skip",
            ))

    else:
        fig3.add_trace(go.Scatter3d(x=[0],y=[0],z=[0],mode="text",
                                     text=["STP não carregado"],
                                     textfont=dict(color="#e74c3c",size=14)))

    fig3.update_layout(
        height=620,
        scene=dict(
            xaxis=dict(showgrid=True, gridcolor="#1a2e3a", backgroundcolor="#0d1117",
                       title="", showticklabels=False),
            yaxis=dict(showgrid=True, gridcolor="#1a2e3a", backgroundcolor="#0d1117",
                       title="", showticklabels=False),
            zaxis=dict(showgrid=True, gridcolor="#1a2e3a", backgroundcolor="#0d1117",
                       title="", showticklabels=False),
            bgcolor="#0d1117",
            camera=dict(eye=dict(x=1.6, y=-2.0, z=1.2)),
            aspectmode="data",
        ),
        paper_bgcolor="#0d1117",
        margin=dict(l=0, r=0, t=40, b=0),
        legend=dict(font=dict(color="white", size=11), bgcolor="#1a1a2e",
                    bordercolor="#333", borderwidth=1),
        title=dict(
            text=f"Vista 3D — Modelo STP Real · {row['ts'].strftime('%H:%M:%S')}  "
                 f"M1:{FLAG_NOME[max(f_m1_temp,f_m1_vel)]}  "
                 f"M2:{FLAG_NOME[max(f_m2_temp,f_m2_vel)]}",
            font=dict(color="#7ec8e3", size=13)),
    )
    st.plotly_chart(fig3, use_container_width=True)
    st.info("Arraste para rotacionar · Scroll para zoom · "
            "Cor do modelo reflete o pior status: OK  Alerta  Alarme  "
            "· Diamante roxo = sensor VIM32PL")

# ══════════════════════════════════════════════════════════════════════════════
# ABA HISTÓRICO — mini dashboard integrado
# ══════════════════════════════════════════════════════════════════════════════
with tab_hist:
    if _usando_forzy:
        hist_sub = df.iloc[:st.session_state.fidx+1]
    else:
        _h = _fonte_dados["historico"].copy()
        if not _h.empty:
            _col_ts = "timestamp" if "timestamp" in _h.columns else "ts"
            hist_sub = _h.rename(columns={_col_ts: "ts"})
        else:
            hist_sub = df  # fallback para forzy se ativo não tem leituras

    fig_h = make_subplots(
        rows=3, cols=1,
        shared_xaxes=True,
        subplot_titles=("Velocidade (m/s)", "Aceleração", "Temperatura (°C)"),
        vertical_spacing=0.07,
    )

    for col_m1, col_m2, row_idx, unidade, la, lal in [
        ("m1_vel",  "m2_vel",  1, "m/s", VEL_ALERTA,  VEL_ALARME),
        ("m1_acel", "m2_acel", 2, "",    ACEL_ALERTA,  ACEL_ALARME),
        ("m1_temp", "m2_temp", 3, "°C",  TEMP_ALERTA, TEMP_ALARME),
    ]:
        fig_h.add_trace(go.Scatter(x=hist_sub["ts"], y=hist_sub[col_m1],
            mode="lines", name="Motor 1" if row_idx==1 else None,
            showlegend=(row_idx==1),
            line=dict(color="#3498db",width=1.5)), row=row_idx, col=1)
        fig_h.add_trace(go.Scatter(x=hist_sub["ts"], y=hist_sub[col_m2],
            mode="lines", name="Motor 2" if row_idx==1 else None,
            showlegend=(row_idx==1),
            line=dict(color="#e74c3c",width=1.5)), row=row_idx, col=1)
        fig_h.add_hline(y=la,  line_dash="dash", line_color="#f39c12",
                        line_width=1, row=row_idx, col=1)
        fig_h.add_hline(y=lal, line_dash="dash", line_color="#e74c3c",
                        line_width=1, row=row_idx, col=1)
        # Marcador do frame atual
        if not hist_sub.empty:
            for col_, cor_ in [(col_m1,"#3498db"),(col_m2,"#e74c3c")]:
                fig_h.add_trace(go.Scatter(
                    x=[hist_sub["ts"].iloc[-1]],
                    y=[hist_sub[col_].iloc[-1]],
                    mode="markers",
                    marker=dict(size=9,color=cor_,
                                line=dict(color="white",width=2)),
                    showlegend=False,
                ), row=row_idx, col=1)

    fig_h.update_layout(
        height=520, hovermode="x unified",
        paper_bgcolor="#0d1117", plot_bgcolor="#0d1117",
        font=dict(color="#eee"),
        margin=dict(l=50,r=20,t=40,b=30),
        legend=dict(orientation="h",y=1.05,bgcolor="rgba(0,0,0,0)"),
    )
    fig_h.update_xaxes(gridcolor="#222")
    fig_h.update_yaxes(gridcolor="#222")
    st.plotly_chart(fig_h, use_container_width=True)
