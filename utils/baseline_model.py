"""
Modelo de baseline estatístico para detecção de anomalias operacionais.
Usa Z-score multivariado sobre o histórico do Dataset Forzy.
Não requer sklearn — apenas numpy/pandas.
"""
from __future__ import annotations
import numpy as np
import pandas as pd
from pathlib import Path

_CSV = Path(__file__).parent.parent / "data" / "forzy.csv"

VARIAVEIS = {
    "m1_vel":  {"label": "Motor 1 — Velocidade",    "unidade": "mm/s"},
    "m1_acel": {"label": "Motor 1 — Aceleração",    "unidade": "g"},
    "m1_temp": {"label": "Motor 1 — Temperatura",   "unidade": "°C"},
    "m2_vel":  {"label": "Motor 2 — Velocidade",    "unidade": "mm/s"},
    "m2_acel": {"label": "Motor 2 — Aceleração",    "unidade": "g"},
    "m2_temp": {"label": "Motor 2 — Temperatura",   "unidade": "°C"},
}


def _load_df() -> pd.DataFrame:
    df = pd.read_csv(
        _CSV, sep=";", skiprows=3, header=None,
        usecols=[0, 3, 4, 5, 6, 7, 8],
        names=["timestamp", "m1_vel", "m1_acel", "m1_temp",
               "m2_vel", "m2_acel", "m2_temp"],
    )
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    for c in list(VARIAVEIS.keys()):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df.dropna(subset=list(VARIAVEIS.keys())).reset_index(drop=True)


def computar_baseline() -> dict:
    """
    Retorna estatísticas do baseline calculadas sobre o dataset histórico completo.
    Estrutura: {col: {mean, std, p5, p95, min, max}}
    """
    df = _load_df()
    baseline = {}
    for col in VARIAVEIS:
        s = df[col]
        baseline[col] = {
            "mean": float(s.mean()),
            "std":  float(s.std()),
            "p5":   float(s.quantile(0.05)),
            "p95":  float(s.quantile(0.95)),
            "min":  float(s.min()),
            "max":  float(s.max()),
            "n":    int(len(s)),
        }
    return baseline


def zscore_leitura(leitura: dict, baseline: dict) -> dict:
    """
    Calcula o Z-score de uma leitura pontual contra o baseline.
    leitura: {col: valor_float, ...}
    Retorna {col: z_score}
    """
    scores = {}
    for col, meta in baseline.items():
        val = leitura.get(col)
        if val is None or meta["std"] == 0:
            scores[col] = 0.0
        else:
            scores[col] = abs(float(val) - meta["mean"]) / meta["std"]
    return scores


def classificar_anomalia(z_scores: dict) -> tuple[float, str, str]:
    """
    Retorna (score_max, classificação, cor).
    score = máximo Z entre todas as variáveis.
    """
    score = max(z_scores.values()) if z_scores else 0.0
    if score < 2.0:
        return score, "Normal", "#2ecc71"
    elif score < 3.0:
        return score, "Alerta", "#f39c12"
    else:
        return score, "Anomalia", "#e74c3c"


def score_serie_historica(n_pontos: int = 500) -> pd.DataFrame:
    """
    Calcula Z-score e classificação para uma janela do dataset histórico.
    Útil para plotar a evolução do score ao longo do tempo.
    """
    df = _load_df()
    baseline = computar_baseline()

    # Downsample se necessário
    if len(df) > n_pontos:
        idx = np.linspace(0, len(df) - 1, n_pontos, dtype=int)
        df = df.iloc[idx].reset_index(drop=True)

    rows = []
    for _, row in df.iterrows():
        leitura = {col: row[col] for col in VARIAVEIS}
        zs = zscore_leitura(leitura, baseline)
        score, classe, cor = classificar_anomalia(zs)
        rows.append({
            "timestamp": row["timestamp"],
            "score":     round(score, 3),
            "classe":    classe,
            "cor":       cor,
            **{f"z_{col}": round(v, 3) for col, v in zs.items()},
        })
    return pd.DataFrame(rows)


def tabela_baseline_formatada() -> pd.DataFrame:
    """Retorna DataFrame formatado para exibição na UI."""
    bl = computar_baseline()
    linhas = []
    for col, meta in bl.items():
        info = VARIAVEIS[col]
        linhas.append({
            "Variável":   info["label"],
            "Unidade":    info["unidade"],
            "Média":      f"{meta['mean']:.3f}",
            "Desvio Padrão": f"{meta['std']:.3f}",
            "P5":         f"{meta['p5']:.3f}",
            "P95":        f"{meta['p95']:.3f}",
            "N amostras": meta["n"],
        })
    return pd.DataFrame(linhas)
