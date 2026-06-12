"""
Seletor global de fonte de dados — Dataset Forzy | Ativo Cadastrado | Simulado.

Uso em qualquer página:
    from utils.fonte import render_fonte_selector
    dados = render_fonte_selector()
    # dados["m1_vel"], dados["historico"], dados["ativo"], etc.
"""
from __future__ import annotations
import random
import time
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
import streamlit as st

_ROOT    = Path(__file__).parent.parent
_CSV     = _ROOT / "data" / "forzy.csv"
_SVG_DIR = _ROOT / "data" / "svg"

FONTE_FORZY    = "Dataset Forzy"
FONTE_ATIVO    = "Ativo Cadastrado"
FONTE_SIMULADO = "Simulado"
FONTES         = [FONTE_FORZY, FONTE_ATIVO, FONTE_SIMULADO]

# Campos padronizados que todos os consumidores esperam
CAMPOS = ["m1_vel", "m1_acel", "m1_temp", "m2_vel", "m2_acel", "m2_temp"]


# ── Loaders ────────────────────────────────────────────────────────────────────

@st.cache_data(show_spinner=False)
def _load_forzy() -> pd.DataFrame:
    df = pd.read_csv(
        _CSV, sep=";", skiprows=3, header=None,
        usecols=[0, 3, 4, 5, 6, 7, 8],
        names=["timestamp", "m1_vel", "m1_acel", "m1_temp",
               "m2_vel", "m2_acel", "m2_temp"],
    )
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    for c in CAMPOS:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df.dropna(subset=CAMPOS).sort_values("timestamp").reset_index(drop=True)


def _leituras_ativo(codigo: str, limit: int = 200) -> pd.DataFrame:
    """Converte leituras IoT do ativo para o formato padrão (CAMPOS)."""
    import database as db
    rows = db.get_leituras(codigo, limit=limit)
    if not rows:
        return pd.DataFrame()
    df = pd.DataFrame(rows)
    df["timestamp"] = pd.to_datetime(df["coletado_em"])
    # Mapeia: vibracao → vel, aceleracao_g → acel, temperatura → temp
    df["m1_vel"]  = pd.to_numeric(df.get("vibracao_mm_s",  pd.Series(dtype=float)), errors="coerce").fillna(0)
    df["m1_acel"] = pd.to_numeric(df.get("aceleracao_g",   pd.Series(dtype=float)), errors="coerce").fillna(0)
    df["m1_temp"] = pd.to_numeric(df.get("temperatura_c",  pd.Series(dtype=float)), errors="coerce").fillna(25)
    # M2 = mesmas leituras (sensor único por ativo)
    df["m2_vel"]  = df["m1_vel"]
    df["m2_acel"] = df["m1_acel"]
    df["m2_temp"] = df["m1_temp"]
    return df[["timestamp"] + CAMPOS].sort_values("timestamp").reset_index(drop=True)


def _simular_leitura(t: float | None = None) -> dict:
    t = t or time.time()
    seed = int(t) % 10000
    rng  = random.Random(seed)
    return {
        "m1_vel":  round(rng.gauss(2.1, 0.8), 3),
        "m1_acel": round(abs(rng.gauss(0.18, 0.06)), 4),
        "m1_temp": round(rng.gauss(32, 3), 1),
        "m2_vel":  round(rng.gauss(2.4, 0.9), 3),
        "m2_acel": round(abs(rng.gauss(0.19, 0.07)), 4),
        "m2_temp": round(rng.gauss(37, 2.5), 1),
        "timestamp": datetime.now().strftime("%H:%M:%S"),
    }


def svg_path(codigo: str) -> Path | None:
    """Retorna o caminho do SVG do ativo, ou None se não existir."""
    p = _SVG_DIR / f"{codigo}.svg"
    return p if p.exists() else None


def salvar_svg(codigo: str, conteudo: bytes) -> Path:
    """Salva o SVG enviado pelo usuário."""
    _SVG_DIR.mkdir(parents=True, exist_ok=True)
    p = _SVG_DIR / f"{codigo}.svg"
    p.write_bytes(conteudo)
    return p


# ── Widget principal ───────────────────────────────────────────────────────────

def render_fonte_selector(key_prefix: str = "gf") -> dict:
    """
    Renderiza a barra de seleção de fonte e retorna um dicionário com:
        fonte:        str (FONTE_FORZY | FONTE_ATIVO | FONTE_SIMULADO)
        ativo:        dict | None  — registro completo do ativo selecionado
        leitura:      dict         — valores atuais {m1_vel, m1_acel, m1_temp, m2_vel, m2_acel, m2_temp}
        historico:    pd.DataFrame — série histórica com coluna timestamp + CAMPOS
        timestamp:    str          — label do momento atual
        svg:          Path | None  — caminho do SVG do ativo (se existir)
    """
    import database as db

    ativos = db.get_ativos_industrial()

    # ── Barra de seleção ────────────────────────────────────────────────────────
    st.markdown("""
    <div style="background:#0a1628;border:1px solid #0f2a45;border-radius:8px;
                padding:10px 16px;margin-bottom:14px">
      <span style="font-size:.65rem;color:#4a7a9b;text-transform:uppercase;
                   letter-spacing:.1em;font-weight:700">Fonte de Dados</span>
    </div>
    """, unsafe_allow_html=True)

    _col_f, _col_a = st.columns([2, 3])

    with _col_f:
        fonte = st.radio(
            "Fonte",
            FONTES,
            horizontal=True,
            key=f"{key_prefix}_fonte",
            label_visibility="collapsed",
        )

    ativo_obj = None
    with _col_a:
        if fonte == FONTE_ATIVO:
            if not ativos:
                st.warning("Nenhum ativo cadastrado. Crie um ativo no Cadastro.")
                fonte = FONTE_FORZY
            else:
                _nomes = [f"{a['codigo']} — {a['descricao'] or a['tag'] or ''}" for a in ativos]
                _sel   = st.selectbox("Ativo", _nomes, key=f"{key_prefix}_ativo_sel",
                                      label_visibility="collapsed")
                _idx   = _nomes.index(_sel)
                ativo_obj = ativos[_idx]
                STATUS_COR = {"ativo": "#2ecc71", "manutencao": "#f39c12", "inativo": "#e74c3c"}
                _sc = STATUS_COR.get(ativo_obj.get("status", ""), "#4a7a9b")
                st.markdown(
                    f'<span style="font-size:.72rem;color:{_sc};font-weight:700">'
                    f'{ativo_obj["status"].upper()}</span>'
                    f'<span style="font-size:.7rem;color:#4a7a9b;margin-left:10px">'
                    f'TAG: {ativo_obj.get("tag") or "—"}  ·  '
                    f'{ativo_obj.get("area_nome","—")} · {ativo_obj.get("planta_nome","—")}'
                    f'</span>',
                    unsafe_allow_html=True,
                )
        elif fonte == FONTE_SIMULADO:
            st.caption("Dados sinteticos — sem hardware necessario")
        else:
            st.caption(f"Historico real: {_load_forzy().__len__()} amostras do Dataset Forzy")

    # ── Monta resultado ─────────────────────────────────────────────────────────
    historico = pd.DataFrame()
    leitura   = {}
    timestamp = datetime.now().strftime("%H:%M:%S")
    svg       = None

    if fonte == FONTE_FORZY and _CSV.exists():
        df = _load_forzy()
        fidx = st.session_state.get("mon_fidx", len(df) - 1) % len(df)
        row  = df.iloc[fidx]
        leitura   = {c: float(row[c]) for c in CAMPOS}
        historico = df
        timestamp = row["timestamp"].strftime("%d/%m/%Y %H:%M:%S")

    elif fonte == FONTE_ATIVO and ativo_obj:
        df_a = _leituras_ativo(ativo_obj["codigo"])
        svg  = svg_path(ativo_obj["codigo"])
        if not df_a.empty:
            row  = df_a.iloc[-1]
            leitura   = {c: float(row[c]) for c in CAMPOS}
            historico = df_a
            timestamp = row["timestamp"].strftime("%d/%m/%Y %H:%M:%S")
        else:
            # Sem leituras IoT → usa Dataset Forzy como referência (mostra aviso)
            st.warning(
                f"Ativo **{ativo_obj['codigo']}** ainda não tem leituras IoT. "
                "Conecte o ESP32 na página IoT para iniciar a coleta. "
                "Exibindo Dataset Forzy como referência.",
                icon="⚠️",
            )
            if _CSV.exists():
                df = _load_forzy()
                row = df.iloc[-1]
                leitura   = {c: float(row[c]) for c in CAMPOS}
                historico = df
                timestamp = "Sem leituras IoT — referencia Forzy"
            else:
                leitura   = {c: 0.0 for c in CAMPOS}
                timestamp = "Sem dados"

    else:  # Simulado
        leitura   = _simular_leitura()
        timestamp = leitura.pop("timestamp", datetime.now().strftime("%H:%M:%S"))
        # Gera historico simulado (120 pontos)
        _hist_rows = []
        _t0 = time.time() - 120
        for _i in range(120):
            _r = _simular_leitura(_t0 + _i)
            _r["timestamp"] = pd.Timestamp.now() - pd.Timedelta(seconds=120 - _i)
            _hist_rows.append(_r)
        historico = pd.DataFrame(_hist_rows)

    return {
        "fonte":     fonte,
        "ativo":     ativo_obj,
        "leitura":   leitura,
        "historico": historico,
        "timestamp": timestamp,
        "svg":       svg,
    }
