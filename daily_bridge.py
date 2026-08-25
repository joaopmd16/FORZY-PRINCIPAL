"""
Forzy Cloud Bridge — consulta os endpoints ngrok da Forzy (S1/S2) e grava
cada leitura em dados/forzy_cloud_log.csv.

Feito para rodar 1x por execução (disparado pelo Agendador de Tarefas do
Windows a cada hora) — não fica em loop, não precisa do navegador aberto.

Uso:  python daily_bridge.py
"""
import csv
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone

# ── Configuração ──────────────────────────────────────────────────────────────
BASE_URL = "https://charred-buzz-tannery.ngrok-free.dev"
ENDPOINTS = {
    "s1": (f"{BASE_URL}/get_s1", "dados1"),
    "s2": (f"{BASE_URL}/get_s2", "dados2"),
}
TIMEOUT_S = 15

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_PATH = os.path.join(SCRIPT_DIR, "dados", "forzy_cloud_log.csv")
HEADER = ["timestamp", "sensor", "velocidade", "aceleracao", "temperatura", "erro"]


def buscar(sensor, url, chave):
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        d = body.get(chave, {})
        return {
            "sensor": sensor,
            "velocidade": d.get("Velocidade"),
            "aceleracao": d.get("Aceleração"),
            "temperatura": d.get("Temperatura"),
            "erro": "",
        }
    except Exception as e:
        print(f"[CloudBridge] {sensor}: erro ao consultar {url} — {e}")
        return {"sensor": sensor, "velocidade": None, "aceleracao": None, "temperatura": None, "erro": str(e)}


def gravar(linhas):
    os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
    novo = not os.path.exists(LOG_PATH)
    with open(LOG_PATH, "a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=HEADER)
        if novo:
            w.writeheader()
        for linha in linhas:
            w.writerow(linha)


def main():
    ts = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    linhas = []
    for sensor, (url, chave) in ENDPOINTS.items():
        r = buscar(sensor, url, chave)
        r["timestamp"] = ts
        linhas.append(r)
        if not r["erro"]:
            print(f"[CloudBridge] {sensor}: Vel={r['velocidade']} Acel={r['aceleracao']} Temp={r['temperatura']}")
    gravar(linhas)
    print(f"[CloudBridge] {len(linhas)} leitura(s) gravada(s) em {LOG_PATH}")


if __name__ == "__main__":
    sys.exit(main())
