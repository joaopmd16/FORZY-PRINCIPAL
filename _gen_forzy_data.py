"""
Gera data/forzy-data.js para o dashboard Vision (HTML estatico).
Le data/forzy.csv (mesmo parsing do baseline_model.py) e emite window.FORZY
com as series completas + baseline pre-calculado. One-shot helper.
"""
import json
from pathlib import Path
import numpy as np
import pandas as pd

SRC = Path(__file__).parent / "data" / "forzy.csv"
OUT = Path(r"C:/Users/gel/Desktop/HTML CHAVETA/data/forzy-data.js")

COLS = ["m1_vel", "m1_acel", "m1_temp", "m2_vel", "m2_acel", "m2_temp"]
LABELS = {
    "m1_vel": ("Motor 1 - Velocidade", "mm/s"),
    "m1_acel": ("Motor 1 - Aceleracao", "g"),
    "m1_temp": ("Motor 1 - Temperatura", "C"),
    "m2_vel": ("Motor 2 - Velocidade", "mm/s"),
    "m2_acel": ("Motor 2 - Aceleracao", "g"),
    "m2_temp": ("Motor 2 - Temperatura", "C"),
}

df = pd.read_csv(SRC, sep=";", skiprows=3, header=None,
                 usecols=[0, 3, 4, 5, 6, 7, 8],
                 names=["timestamp"] + COLS)
df["timestamp"] = pd.to_datetime(df["timestamp"])
for c in COLS:
    df[c] = pd.to_numeric(df[c], errors="coerce")
df = df.dropna(subset=COLS).reset_index(drop=True)

t0 = df["timestamp"].iloc[0]
tsec = ((df["timestamp"] - t0).dt.total_seconds()).round(3).tolist()

def ser(col, dec):
    return [round(float(v), dec) for v in df[col]]

baseline = {}
for col in COLS:
    s = df[col]
    baseline[col] = {
        "mean": round(float(s.mean()), 5),
        "std": round(float(s.std()), 5),
        "p5": round(float(s.quantile(0.05)), 5),
        "p95": round(float(s.quantile(0.95)), 5),
        "min": round(float(s.min()), 5),
        "max": round(float(s.max()), 5),
        "n": int(len(s)),
        "label": LABELS[col][0],
        "unit": LABELS[col][1],
    }

data = {
    "meta": {
        "n": int(len(df)),
        "t0": t0.isoformat(),
        "t_end": df["timestamp"].iloc[-1].isoformat(),
        "cols": COLS,
    },
    "t": tsec,  # segundos desde t0
    "m1": {"vel": ser("m1_vel", 4), "acel": ser("m1_acel", 4), "temp": ser("m1_temp", 2)},
    "m2": {"vel": ser("m2_vel", 4), "acel": ser("m2_acel", 4), "temp": ser("m2_temp", 2)},
    "baseline": baseline,
}

OUT.parent.mkdir(parents=True, exist_ok=True)
js = "/* Auto-gerado de data/forzy.csv por _gen_forzy_data.py. Nao editar a mao. */\n"
js += "window.FORZY = " + json.dumps(data, separators=(",", ":")) + ";\n"
OUT.write_text(js, encoding="utf-8")
kb = OUT.stat().st_size / 1024
print(f"OK -> {OUT}  ({kb:.0f} KB, {len(df)} amostras)")
print("baseline:")
for c in COLS:
    b = baseline[c]
    print(f"  {c:8s} mean={b['mean']:.3f} std={b['std']:.3f} p5={b['p5']:.3f} p95={b['p95']:.3f}")
