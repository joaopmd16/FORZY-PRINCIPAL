"""Conexão IoT / ESP32 — Monitoramento ao Vivo"""
import streamlit as st
import pandas as pd
import numpy as np
import plotly.graph_objects as go
from datetime import datetime

st.set_page_config(page_title="IoT · ESP32", layout="wide")
import sys; sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent.parent))
from utils.theme import apply as _apply_theme, sidebar_nav as _snav
_apply_theme(); _snav("iot")


# ── CSS da página ─────────────────────────────────────────────────────────────
st.markdown("""
<style>
.conn-card {
    background:#08111f; border:1px solid #0f2035;
    border-radius:8px; padding:18px 20px; margin-bottom:12px;
}
.status-dot {
    width:10px; height:10px; border-radius:50%;
    display:inline-block; margin-right:6px;
}
.dot-online  { background:#2ecc71; box-shadow:0 0 8px #2ecc71; }
.dot-offline { background:#e74c3c; box-shadow:0 0 8px #e74c3c; }
.dot-waiting { background:#f39c12; box-shadow:0 0 8px #f39c12; animation:pulse 1.2s infinite; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
.channel-row {
    display:flex; justify-content:space-between; align-items:center;
    padding:8px 0; border-bottom:1px solid #0f2035; font-size:.82rem;
}
.channel-row:last-child { border-bottom:none; }
</style>
""", unsafe_allow_html=True)

# ── Header ────────────────────────────────────────────────────────────────────
st.markdown("""
<div style="background:#08111f;border:1px solid #0f2035;border-radius:10px;
            padding:18px 28px;margin-bottom:20px">
  <div style="font-size:1.15rem;font-weight:700;color:#e2eaf4">
    Conexão IoT — Sensor VIM32PL via ESP32
  </div>
  <div style="font-size:.8rem;color:#2a5a7a;margin-top:4px">
    Interface de monitoramento ao vivo · IO-Link 1.1 → ESP32 → Dashboard
  </div>
</div>
""", unsafe_allow_html=True)

# ── Sidebar de configuração (hardware) — definida ANTES do seletor de fonte ──
with st.sidebar:
    st.markdown("""
    <div style="padding:16px;border-bottom:1px solid #0f2035;margin-bottom:8px">
      <div style="font-size:.65rem;color:#2a5a7a;text-transform:uppercase;letter-spacing:.1em">
        Configuração Hardware
      </div>
    </div>
    """, unsafe_allow_html=True)

    modo = st.radio("Fonte de dados", ["Simulação (sem hardware)", "ESP32 Real (USB)"],
                    index=st.session_state.get("iot_modo_idx", 0),
                    key="iot_modo_radio")
    st.divider()
    porta = st.selectbox("Porta Serial", ["COM5","COM3","COM4","COM6","COM7","AUTO"],
                         disabled="Simulação" in modo)
    baud  = st.selectbox("Baud Rate", [115200, 9600, 57600], disabled="Simulação" in modo)
    st.divider()
    st.caption("**Sensor VIM32PL**")
    st.caption("Protocolo: IO-Link 1.1")
    st.caption("Transfer rate: COM2 (38,4 kBit/s)")
    st.caption("Ciclo mín: 5 ms")

is_sim = "Simulação" in modo

# ── Seletor de fonte global ───────────────────────────────────────────────────
# Quando ESP32 Real está ativo, a fonte é sempre "Ativo Cadastrado" — não faz
# sentido exibir Dataset Forzy ou Simulado enquanto o sensor está gravando.
from utils.fonte import render_fonte_selector, FONTE_ATIVO, FONTE_SIMULADO, FONTE_FORZY

if not is_sim:
    # ESP32 Real: força Ativo Cadastrado e mostra apenas seletor de ativo
    import database as _db_esp
    _ativos_esp = _db_esp.get_ativos_industrial()
    st.markdown("""
    <div style="background:#0a1628;border:1px solid #0f2a45;border-radius:8px;
                padding:10px 16px;margin-bottom:14px;display:flex;align-items:center;gap:12px">
      <span style="font-size:.65rem;color:#4a7a9b;text-transform:uppercase;
                   letter-spacing:.1em;font-weight:700">Fonte de Dados</span>
      <span style="font-size:.75rem;color:#3498db;font-weight:700">ESP32 Real → Ativo Cadastrado</span>
    </div>
    """, unsafe_allow_html=True)
    if not _ativos_esp:
        st.warning("Nenhum ativo cadastrado. Crie um ativo no Cadastro antes de usar o ESP32 Real.")
        _ativo_iot = None
        _fonte_iot = {"fonte": FONTE_ATIVO, "ativo": None, "leitura": {}, "historico": __import__("pandas").DataFrame(), "timestamp": "", "svg": None}
    else:
        _nomes_esp = [f"{a['codigo']} — {a['descricao'] or a['tag'] or ''}" for a in _ativos_esp]
        _sel_esp   = st.selectbox("Ativo para gravar leituras ESP32", _nomes_esp, key="iot_ativo_esp",
                                   label_visibility="collapsed")
        _ativo_iot = _ativos_esp[_nomes_esp.index(_sel_esp)]
        import database as _db_esp2
        _rows_esp  = _db_esp2.get_leituras(_ativo_iot["codigo"], limit=150)
        import pandas as _pd_esp
        _hist_esp  = _pd_esp.DataFrame(_rows_esp) if _rows_esp else _pd_esp.DataFrame()
        _fonte_iot = {"fonte": FONTE_ATIVO, "ativo": _ativo_iot, "leitura": {}, "historico": _hist_esp, "timestamp": "", "svg": None}
else:
    # Simulação: seletor completo normal
    _fonte_iot = render_fonte_selector(key_prefix="iot")
    _ativo_iot = _fonte_iot.get("ativo")

# ── Status de conexão ─────────────────────────────────────────────────────────
c1, c2, c3 = st.columns(3)

with c1:
    if is_sim:
        dot        = "dot-waiting"
        status_txt = "SIMULAÇÃO"
        status_cor = "#f39c12"
        sub_txt    = "Modo demonstração ativo"
    elif _fonte_iot["fonte"] == FONTE_ATIVO and _ativo_iot and not _fonte_iot["historico"].empty:
        # Fonte = Ativo Cadastrado com leituras no banco → status pelo DB, não pelo CSV
        _n_leit = len(_fonte_iot["historico"])
        dot        = "dot-online"
        status_txt = "DB CONECTADO"
        status_cor = "#3498db"
        sub_txt    = f"Ativo: {_ativo_iot['codigo']} · {_n_leit} leituras no banco"
    else:
        import glob as _glob, os as _os, time as _time
        _csvs = sorted(_glob.glob("dados/dados_*.csv"), key=_os.path.getmtime, reverse=True)
        # considera online só se o CSV foi atualizado nos últimos 5 segundos
        _age = _time.time() - _os.path.getmtime(_csvs[0]) if _csvs else 999
        has_data   = _age < 5
        dot        = "dot-online"  if has_data else "dot-offline"
        status_txt = "ONLINE"      if has_data else "DESCONECTADO"
        status_cor = "#2ecc71"     if has_data else "#e74c3c"
        if has_data:
            sub_txt = f"Porta: {porta} · {baud} baud"
        elif _csvs:
            sub_txt = f"Execute o coletor serial · COM{porta[-1]} livre"
        else:
            sub_txt = "Nenhum CSV em dados/ — inicie o coletor serial"
    st.markdown(f"""
    <div class="conn-card">
      <div style="font-size:.7rem;color:#2a5a7a;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">
        Status da Conexão
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="status-dot {dot}"></span>
        <span style="font-size:1rem;font-weight:700;color:{status_cor}">{status_txt}</span>
      </div>
      <div style="font-size:.78rem;color:#4a7a9b;margin-top:8px">{sub_txt}</div>
    </div>
    """, unsafe_allow_html=True)

with c2:
    st.markdown("""
    <div class="conn-card">
      <div style="font-size:.7rem;color:#2a5a7a;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">
        Protocolo IO-Link
      </div>
      <div class="channel-row">
        <span style="color:#4a7a9b">Canal 1</span>
        <span style="color:#e2eaf4">Velocidade RMS (mm/s)</span>
      </div>
      <div class="channel-row">
        <span style="color:#4a7a9b">Canal 2</span>
        <span style="color:#e2eaf4">Aceleração Pico (g)</span>
      </div>
      <div class="channel-row">
        <span style="color:#4a7a9b">Canal 3</span>
        <span style="color:#e2eaf4">Aceleração RMS (g)</span>
      </div>
      <div class="channel-row">
        <span style="color:#4a7a9b">Canal 4</span>
        <span style="color:#e2eaf4">Temperatura (°C)</span>
      </div>
    </div>
    """, unsafe_allow_html=True)

with c3:
    st.markdown("""
    <div class="conn-card">
      <div style="font-size:.7rem;color:#2a5a7a;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">
        Hardware Requerido
      </div>
      <div style="font-size:.8rem;color:#4a7a9b;line-height:2">
        Sensor VIM32PL-E1AC8<br>
        ESP32 Dev Module<br>
        Cabo USB-Serial (CP210x)<br>
        Driver CP210x / CH340
      </div>
    </div>
    """, unsafe_allow_html=True)

st.divider()

# ── Leituras ao vivo ──────────────────────────────────────────────────────────
st.markdown("#### Leituras em Tempo Real")

from streamlit_autorefresh import st_autorefresh
st_autorefresh(interval=2000, key="iot_refresh")

COR  = {0:"#2ecc71", 1:"#f39c12", 2:"#e74c3c"}
NOME = {0:"NORMAL",  1:"ALERTA",  2:"ALARME"}

# ── Modo real: lê e salva CSV primeiro (sempre que ESP32 Real estiver ativo) ──
# A leitura do CSV é separada do display — garante que novos dados do sensor
# sejam persistidos no banco mesmo quando a fonte de exibição é "Ativo Cadastrado".
if not is_sim:
    # ── Modo real: lê CSV mais recente de dados/ ──────────────────────────
    import glob, os
    csvs = sorted(glob.glob("dados/dados_*.csv"), key=os.path.getmtime, reverse=True)
    if csvs:
        try:
            df_raw = pd.read_csv(csvs[0])
            # timestamp com data de hoje para evitar "Jan 1, 1900"
            hoje = datetime.now().strftime("%Y-%m-%d ")
            df_raw["ts"] = pd.to_datetime(hoje + df_raw["timestamp"], format="%Y-%m-%d %H:%M:%S.%f")
            df_raw = df_raw.tail(150).reset_index(drop=True)
            # Remove componente DC (gravidade) — só a vibração dinâmica importa
            ax_ac = df_raw["AX_g"] - df_raw["AX_g"].mean()
            ay_ac = df_raw["AY_g"] - df_raw["AY_g"].mean()
            az_ac = df_raw["AZ_g"] - df_raw["AZ_g"].mean()
            # Magnitude dinâmica (g) e conversão para mm/s (integração aproximada a 5 Hz)
            mag_ac = np.sqrt(ax_ac**2 + ay_ac**2 + az_ac**2)
            vel_mms = (mag_ac * 9806.65 / (2 * np.pi * 5)).round(4)  # 5 Hz = freq dominante estimada
            apeak_g = np.sqrt(df_raw["AX_g"]**2 + df_raw["AY_g"]**2 + df_raw["AZ_g"]**2).round(4)
            df_live = pd.DataFrame({
                "ts":    df_raw["ts"],
                "vel":   vel_mms,
                "apeak": apeak_g,
                "arms":  mag_ac.round(4),
                "temp":  np.zeros(len(df_raw)),
                "flag":  0,
                "AX":    df_raw["AX_g"],
                "AY":    df_raw["AY_g"],
                "AZ":    df_raw["AZ_g"],
            })
            df_live["flag"] = np.where(df_live["vel"] >= 4.5, 2,
                              np.where(df_live["vel"] >= 1.8, 1, 0)).astype(int)
            last   = df_live.iloc[-1]
            vib    = float(last["vel"])
            apeak  = float(last["apeak"])
            arms   = float(last["arms"])
            temp   = float(last["temp"])
            flag_v = int(last["flag"])

            # ── Salva no banco se um ativo está selecionado ───────────────────
            if _ativo_iot:
                _ts_key = f"iot_saved_{_ativo_iot['codigo']}"
                _last_ts = str(df_live["ts"].iloc[-1])
                if st.session_state.get(_ts_key) != _last_ts:
                    try:
                        import database as _db
                        _db.insert_leitura(_ativo_iot["codigo"], {
                            "fonte":        "esp32",
                            "vibracao_mm_s": round(vib, 4),
                            "ax_rms":        round(float(df_live["AX"].iloc[-1]), 4),
                            "ay_rms":        round(float(df_live["AY"].iloc[-1]), 4),
                            "az_rms":        round(float(df_live["AZ"].iloc[-1]), 4),
                            "mag_rms":       round(float(arms), 4),
                            "flag_anomalia": int(flag_v),
                            "coletado_em":   datetime.utcnow().isoformat(),
                        })
                        st.session_state[_ts_key] = _last_ts
                    except Exception:
                        pass

            # ── Se fonte = Ativo Cadastrado, exibe pelo banco (agora atualizado) ─
            if _fonte_iot["fonte"] == FONTE_ATIVO and _ativo_iot:
                import database as _db2
                _rows = _db2.get_leituras(_ativo_iot["codigo"], limit=150)
                if _rows:
                    _h = pd.DataFrame(_rows)
                    _h["ts"]    = pd.to_datetime(_h["coletado_em"])
                    _h["vel"]   = pd.to_numeric(_h["vibracao_mm_s"], errors="coerce").fillna(0)
                    _h["apeak"] = pd.to_numeric(_h.get("mag_rms", pd.Series(dtype=float)), errors="coerce").fillna(0)
                    _h["arms"]  = _h["apeak"]
                    _h["temp"]  = pd.to_numeric(_h.get("temperatura_c", pd.Series(dtype=float)), errors="coerce").fillna(0)
                    _h["flag"]  = pd.to_numeric(_h["flag_anomalia"], errors="coerce").fillna(0).astype(int)
                    df_live = _h[["ts","vel","apeak","arms","temp","flag"]].sort_values("ts").tail(150).reset_index(drop=True)
                    last   = df_live.iloc[-1]
                    vib    = float(last["vel"])
                    apeak  = float(last["apeak"])
                    arms   = float(last["arms"])
                    temp   = float(last["temp"])
                    flag_v = int(last["flag"])
                    st.caption(f"Ativo: **{_ativo_iot['codigo']}** — {len(df_live)} leituras IoT · ESP32 gravando ao vivo")
                else:
                    st.caption(f"Lendo: `{csvs[0]}` · aguardando primeira gravação no DB...")
            else:
                if _ativo_iot:
                    st.caption(f"Lendo: `{csvs[0]}` · {len(df_live)} amostras · gravando em DB → `{_ativo_iot['codigo']}`")
                else:
                    st.caption(f"Lendo: `{csvs[0]}` · {len(df_live)} amostras")
        except Exception as e:
            st.warning(f"Erro ao ler CSV: {e}")
            df_live = pd.DataFrame({"ts":[], "vel":[], "apeak":[], "arms":[], "temp":[], "flag":[], "AX":[], "AY":[], "AZ":[]})
            vib = apeak = arms = temp = 0.0; flag_v = 0
    else:
        st.info("Nenhum dado encontrado. Execute `Armazenamento_Acelerometro_Bytes_Convertido.py` com o ESP32 conectado.")
        df_live = pd.DataFrame({"ts":[], "vel":[], "apeak":[], "arms":[], "temp":[], "flag":[], "AX":[], "AY":[], "AZ":[]})
        vib = apeak = arms = temp = 0.0; flag_v = 0
else:
    # ── Modo simulação ────────────────────────────────────────────────────
    if "iot_hist" not in st.session_state:
        st.session_state.iot_hist = []
        st.session_state.iot_t = 0.0

    st.session_state.iot_t += 2.0
    t = st.session_state.iot_t

    import math, random
    rng   = random.Random(int(t))
    base  = 1.1 + 0.9*math.sin(t/30)
    vib   = max(0.02, base + rng.gauss(0, 0.12))
    apeak = vib * 0.085 + rng.gauss(0, 0.003)
    arms  = apeak * 0.63
    temp  = 38 + vib*1.5 + rng.gauss(0, 0.8)
    flag_v = 2 if vib >= 4.5 else (1 if vib >= 1.8 else 0)

    st.session_state.iot_hist.append({
        "ts": datetime.now(), "vel": vib, "apeak": apeak,
        "arms": arms, "temp": temp, "flag": flag_v,
    })
    if len(st.session_state.iot_hist) > 150:
        st.session_state.iot_hist = st.session_state.iot_hist[-150:]

    df_live = pd.DataFrame(st.session_state.iot_hist)

# KPIs instantâneos
k1,k2,k3,k4,k5 = st.columns(5)
k1.metric("Vel. RMS",    f"{vib:.3f} mm/s",   NOME[flag_v],
          delta_color="inverse" if flag_v>0 else "off")
k2.metric("Acel. Mag",   f"{apeak:.4f} g")
if not is_sim and not df_live.empty and "AX" in df_live.columns:
    k3.metric("AX",  f"{float(df_live['AX'].iloc[-1]):.4f} g")
    k4.metric("AY",  f"{float(df_live['AY'].iloc[-1]):.4f} g")
    k5.metric("AZ",  f"{float(df_live['AZ'].iloc[-1]):.4f} g")
else:
    k3.metric("Acel. RMS",   f"{arms:.4f} g")
    k4.metric("Temperatura", f"{temp:.1f} °C")
    k5.metric("Status ISO",  NOME[flag_v], delta_color="off")

# Gráfico live
fig = go.Figure()
fig.add_trace(go.Scatter(
    x=df_live["ts"], y=df_live["vel"],
    mode="lines", name="Vel RMS (mm/s)",
    line=dict(color="#3498db", width=1.8, shape="spline", smoothing=0.5),
    fill="tozeroy", fillcolor="rgba(52,152,219,0.06)",
))
fig.add_hline(y=1.8, line_dash="dot", line_color="#f39c12", line_width=1)
fig.add_hline(y=4.5, line_dash="dot", line_color="#e74c3c", line_width=1)
fig.add_hrect(y0=0,   y1=1.8, fillcolor="#2ecc71", opacity=0.04)
fig.add_hrect(y0=1.8, y1=4.5, fillcolor="#f39c12", opacity=0.05)
fig.add_hrect(y0=4.5, y1=10,  fillcolor="#e74c3c", opacity=0.05)

# Marca último ponto
if not df_live.empty:
    fig.add_trace(go.Scatter(
        x=[df_live["ts"].iloc[-1]], y=[vib],
        mode="markers",
        marker=dict(color=COR[flag_v], size=10,
                    line=dict(color="white", width=2)),
        name="Atual", showlegend=True,
    ))
fig.update_layout(
    title=dict(text="Velocidade de Vibração RMS — Sensor VIM32PL (ao vivo)",
               font=dict(size=13, color="#7ec8e3")),
    height=300,
    paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
    font_color="#cdd9e5",
    margin=dict(l=50,r=20,t=40,b=40),
    xaxis=dict(gridcolor="#0f2035", showline=True, linecolor="#0f2035"),
    yaxis=dict(gridcolor="#0f2035", showline=True, linecolor="#0f2035",
               title="mm/s", range=[0,10]),
    hovermode="x unified",
    legend=dict(orientation="h", y=1.08, bgcolor="rgba(0,0,0,0)"),
    uirevision="vel_chart",
)
st.plotly_chart(fig, use_container_width=True, key="chart_vel")

# Gráfico XYZ (modo real)
if not is_sim and not df_live.empty and "AX" in df_live.columns:
    fig_xyz = go.Figure()
    for col, cor, nome in [("AX","#e74c3c","AX"), ("AY","#2ecc71","AY"), ("AZ","#3498db","AZ")]:
        fig_xyz.add_trace(go.Scattergl(
            x=df_live["ts"], y=df_live[col],
            mode="lines", name=nome,
            line=dict(color=cor, width=1.4),
        ))
    fig_xyz.update_layout(
        title=dict(text="Aceleração XYZ — MPU6050 (g)", font=dict(size=13, color="#7ec8e3")),
        height=250, paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        font_color="#cdd9e5", margin=dict(l=50,r=20,t=40,b=30),
        xaxis=dict(gridcolor="#0f2035"), yaxis=dict(gridcolor="#0f2035", title="g"),
        legend=dict(orientation="h", y=1.1, bgcolor="rgba(0,0,0,0)"),
        hovermode="x unified",
        uirevision="xyz_chart",
    )
    st.plotly_chart(fig_xyz, use_container_width=True, key="chart_xyz")

# Segunda linha: aceleração + temperatura
col_a, col_t = st.columns(2)
for col_w, col_y, titulo, cor, unidade, fill_cor in [
    (col_a, "apeak", "Aceleração de Pico (g)",    "#9b59b6", "g",   "rgba(155,89,182,0.06)"),
    (col_t, "temp",  "Temperatura do Sensor (°C)", "#e67e22", "°C",  "rgba(230,126,34,0.06)"),
]:
    fig_s = go.Figure(go.Scatter(
        x=df_live["ts"], y=df_live[col_y],
        mode="lines", line=dict(color=cor, width=1.5, shape="spline", smoothing=0.5),
        fill="tozeroy", fillcolor=fill_cor,
    ))
    fig_s.update_layout(
        uirevision=f"sub_{col_y}",
        title=dict(text=titulo, font=dict(size=12, color=cor)),
        height=210, paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        font_color="#cdd9e5", margin=dict(l=50,r=20,t=40,b=30),
        xaxis=dict(gridcolor="#0f2035"), yaxis=dict(gridcolor="#0f2035", title=unidade),
        showlegend=False,
    )
    with col_w:
        st.plotly_chart(fig_s, use_container_width=True, key=f"chart_{col_y}")

st.divider()

# ── Instruções de conexão ─────────────────────────────────────────────────────
with st.expander("Como conectar o hardware real", expanded=False):
    st.markdown("""
    **1. Instalar driver USB-Serial**
    - CP210x (Silicon Labs) ou CH340 (WCH) — instale o driver da placa que você tem

    **2. Gravar firmware no ESP32**
    ```
    Abra no Arduino IDE:
      firmware/TIMER_MPU6050_BYTES_STARTBYTE/TIMER_MPU6050_BYTES_STARTBYTE.ino
    Placa: ESP32 Dev Module
    Conexão MPU6050 → ESP32:
      VCC → 3.3V   |   GND → GND
      SDA → GPIO21 |   SCL → GPIO22
    ```

    **3. Iniciar o leitor serial (deixe rodando em paralelo ao site)**
    ```powershell
    # Firmware binário (TIMER_MPU6050) — recomendado:
    python serial_reader.py --binary --port COM5

    # Com salvamento de CSV de amostras brutas em dados/:
    python serial_reader.py --binary --port COM5 --save-csv
    ```

    **4. Selecionar "ESP32 Real" nesta página e escolher a porta COM correta.**

    > O site lê os dados do banco SQLite — não acessa a porta COM diretamente.
    > Somente o `serial_reader.py` precisa estar com a porta aberta.
    """)

if is_sim:
    st.markdown("""
    <div style="text-align:center;margin-top:20px;font-size:.72rem;color:#1a3a5a">
      Modo simulação ativo — dados gerados sinteticamente para demonstração
    </div>
    """, unsafe_allow_html=True)
