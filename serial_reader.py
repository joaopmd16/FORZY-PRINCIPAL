"""
serial_reader.py — Lê dados do ESP32 via USB-Serial e persiste no banco.

Modos de firmware suportados:
  JSON   (firmware antigo): envia {"ax_rms":..., "mag_rms":..., ...} a ~1 Hz
  Binário (TIMER_MPU6050):  envia [0xAA][ax_int16][ay_int16][az_int16] a 300 Hz

Uso:
    python serial_reader.py                          # JSON, porta auto-detectada
    python serial_reader.py --port COM3              # JSON, porta explícita
    python serial_reader.py --binary --port COM3     # binário, 300 Hz
    python serial_reader.py --binary --save-csv      # binário + salva CSV em dados/
    python serial_reader.py --simulate               # sem hardware, usa mock_data
    python serial_reader.py --simulate --rate 0.5    # simula a cada 0.5 s
"""

import argparse
import csv
import json
import math
import os
import struct
import sys
import time
from datetime import datetime

import numpy as np
import serial
import serial.tools.list_ports

import database
from utils.mock_data import gerar_leitura_simulada

ATIVO_ID = "MTR-MPU-01"
BAUD = 115200

# Protocolo binário (TIMER_MPU6050_BYTES_STARTBYTE.ino)
BINARY_START  = b'\xaa'
BINARY_SCALE  = 8192.0   # ±4g → 1 g = 8192 LSB
BINARY_WINDOW = 300      # amostras por leitura (1 s a 300 Hz)

# ISO 10816 Classe I (motores pequenos <15 kW)
ISO_OK     = 1.8   # mm/s RMS
ISO_ALERTA = 4.5   # mm/s RMS


def _flag_iso(vibracao_mm_s: float) -> int:
    if vibracao_mm_s < ISO_OK:
        return 0
    if vibracao_mm_s < ISO_ALERTA:
        return 1
    return 2


def _accel_to_velocity(a_rms_g: float, freq_hz: float) -> float:
    """Converte aceleração RMS (g) para velocidade RMS (mm/s)."""
    if freq_hz <= 0:
        return 0.0
    return (a_rms_g * 9806.65) / (2 * math.pi * freq_hz)


def _detect_port() -> str | None:
    """Detecta automaticamente porta CP210x ou CH340."""
    keywords = ["CP210", "CH340", "USB-SERIAL", "UART", "Silicon"]
    ports = serial.tools.list_ports.comports()
    for p in ports:
        desc = (p.description or "").upper() + (p.manufacturer or "").upper()
        if any(k.upper() in desc for k in keywords):
            print(f"[auto] Porta detectada: {p.device} — {p.description}")
            return p.device
    if ports:
        p = ports[0]
        print(f"[auto] Usando primeira porta disponível: {p.device}")
        return p.device
    return None


def _ensure_ativo():
    criado = database.cadastrar_ativo(
        ATIVO_ID,
        descricao="Motor acoplado ao MPU6050 via ESP32",
        localizacao="Bancada de testes",
    )
    if criado:
        print(f"[db] Ativo '{ATIVO_ID}' cadastrado.")
    else:
        print(f"[db] Ativo '{ATIVO_ID}' já existe.")


# ── Modo JSON (firmware antigo) ────────────────────────────────────────────────

def _processar_payload_json(payload: dict) -> dict:
    """Transforma o JSON do ESP32 no formato do banco."""
    freq = payload.get("freq_hz", 50.0) or 50.0
    mag_rms_g = payload.get("mag_rms", 0.0)
    vibracao = _accel_to_velocity(mag_rms_g, freq)

    return {
        "fonte": "esp32_json",
        "temperatura_c": payload.get("temp_c"),
        "vibracao_mm_s": round(vibracao, 4),
        "corrente_a": None, "tensao_v": None, "rpm": None, "fator_potencia": None,
        "coletado_em": datetime.utcnow().isoformat(),
        "flag_anomalia": _flag_iso(vibracao),
        "ax_rms": payload.get("ax_rms"),
        "ay_rms": payload.get("ay_rms"),
        "az_rms": payload.get("az_rms"),
        "mag_rms": mag_rms_g,
        "freq_hz": freq,
        "gx_rms": payload.get("gx_rms"),
        "gy_rms": payload.get("gy_rms"),
        "gz_rms": payload.get("gz_rms"),
        "peaks": payload.get("peaks", []),
    }


def run_serial(port: str, debug: bool = False):
    print(f"[serial] Conectando em {port} @ {BAUD} baud (modo JSON)…")
    with serial.Serial(port, BAUD, timeout=2) as ser:
        print("[serial] Conectado. Aguardando dados do ESP32…\n")
        while True:
            try:
                line = ser.readline().decode("utf-8", errors="ignore").strip()
                if debug and line:
                    print(f"[raw] {line}")
                if not line or not line.startswith("{"):
                    continue
                payload = json.loads(line)
                dados = _processar_payload_json(payload)
                row_id = database.insert_leitura(ATIVO_ID, dados)
                flag_str = ["OK", "ALERTA", "ALARME"][dados["flag_anomalia"]]
                print(
                    f"[{datetime.now().strftime('%H:%M:%S')}] "
                    f"vib={dados['vibracao_mm_s']:.3f} mm/s  "
                    f"freq={dados['freq_hz']:.1f} Hz  "
                    f"temp={dados['temperatura_c']}°C  "
                    f"→ {flag_str}  (id={row_id})"
                )
            except json.JSONDecodeError:
                pass
            except KeyboardInterrupt:
                print("\n[serial] Interrompido pelo usuário.")
                break
            except Exception as exc:
                print(f"[serial] Erro: {exc}", file=sys.stderr)
                time.sleep(1)


# ── Modo Binário (TIMER_MPU6050_BYTES_STARTBYTE.ino) ──────────────────────────

def _processar_janela_binario(buf_ax, buf_ay, buf_az, ts_batch: datetime) -> dict:
    """Calcula RMS, frequência e velocidade a partir de uma janela de amostras brutas."""
    bax = np.array(buf_ax, dtype=np.float32)
    bay = np.array(buf_ay, dtype=np.float32)
    baz = np.array(buf_az, dtype=np.float32)

    # Remove componente DC (gravidade)
    bax -= bax.mean()
    bay -= bay.mean()
    baz -= baz.mean()

    # RMS por eixo
    ax_rms = float(np.sqrt(np.mean(bax ** 2)))
    ay_rms = float(np.sqrt(np.mean(bay ** 2)))
    az_rms = float(np.sqrt(np.mean(baz ** 2)))

    # Magnitude vetorial + mag RMS
    mag = np.sqrt(bax ** 2 + bay ** 2 + baz ** 2)
    mag_rms = float(np.sqrt(np.mean(mag ** 2)))

    # Frequência dominante por contagem de zero-crossings na magnitude
    crossings = int(np.sum(np.diff(np.sign(mag - mag.mean())) != 0))
    freq_hz = crossings / 2.0

    vibracao = _accel_to_velocity(mag_rms, freq_hz)

    return {
        "fonte": "esp32_binary",
        "temperatura_c": None,
        "vibracao_mm_s": round(vibracao, 4),
        "corrente_a": None, "tensao_v": None, "rpm": None, "fator_potencia": None,
        "coletado_em": ts_batch.isoformat(),
        "flag_anomalia": _flag_iso(vibracao),
        "ax_rms": round(ax_rms, 6),
        "ay_rms": round(ay_rms, 6),
        "az_rms": round(az_rms, 6),
        "mag_rms": round(mag_rms, 6),
        "freq_hz": round(freq_hz, 2),
        "gx_rms": None, "gy_rms": None, "gz_rms": None,
        "peaks": [round(freq_hz, 1), round(freq_hz * 2.0, 1)],
    }


def run_binary(port: str, window: int = BINARY_WINDOW,
               save_csv: bool = False, debug: bool = False):
    """
    Lê pacotes binários do firmware TIMER_MPU6050_BYTES_STARTBYTE.
    Protocolo: [0xAA][ax_int16_LE][ay_int16_LE][az_int16_LE] = 7 bytes por amostra.
    Acumula `window` amostras (~1 s a 300 Hz), calcula RMS e grava no SQLite.
    Com --save-csv, salva também amostras brutas em dados/dados_YYYY-MM-DD_HH-MM-SS.csv.
    """
    print(f"[binary] Conectando em {port} @ {BAUD} baud (protocolo binário, {window} amostras/janela)…")

    csv_file = None
    csv_writer = None
    if save_csv:
        os.makedirs("dados", exist_ok=True)
        hora = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        csv_path = os.path.join("dados", f"dados_{hora}.csv")
        csv_file = open(csv_path, mode="w", newline="", encoding="utf-8")
        csv_writer = csv.writer(csv_file)
        csv_writer.writerow(["timestamp", "AX_g", "AY_g", "AZ_g"])
        print(f"[binary] Salvando amostras brutas em: {csv_path}")

    try:
        with serial.Serial(port, BAUD, timeout=2) as ser:
            print("[binary] Conectado. Aguardando pacotes do ESP32…\n")
            while True:
                buf_ax, buf_ay, buf_az = [], [], []
                ts_batch = datetime.now()

                # Coleta `window` amostras válidas
                while len(buf_ax) < window:
                    try:
                        b = ser.read(1)
                        if b != BINARY_START:
                            continue
                        data = ser.read(6)
                        if len(data) < 6:
                            continue

                        ax_raw, ay_raw, az_raw = struct.unpack("<hhh", data)
                        ax_g = ax_raw / BINARY_SCALE
                        ay_g = ay_raw / BINARY_SCALE
                        az_g = az_raw / BINARY_SCALE

                        buf_ax.append(ax_g)
                        buf_ay.append(ay_g)
                        buf_az.append(az_g)

                        if debug:
                            print(f"  {ax_g:.4f}  {ay_g:.4f}  {az_g:.4f}")

                        if csv_writer:
                            ts_str = datetime.now().strftime("%H:%M:%S.%f")[:-3]
                            csv_writer.writerow([ts_str, ax_g, ay_g, az_g])

                    except serial.SerialException as exc:
                        print(f"[binary] Erro serial: {exc}", file=sys.stderr)
                        time.sleep(1)
                        break

                if len(buf_ax) < 10:
                    continue

                dados = _processar_janela_binario(buf_ax, buf_ay, buf_az, ts_batch)
                row_id = database.insert_leitura(ATIVO_ID, dados)
                flag_str = ["OK", "ALERTA", "ALARME"][dados["flag_anomalia"]]
                print(
                    f"[{ts_batch.strftime('%H:%M:%S')}] "
                    f"vib={dados['vibracao_mm_s']:.3f} mm/s  "
                    f"freq={dados['freq_hz']:.1f} Hz  "
                    f"n={len(buf_ax)}  → {flag_str}  (id={row_id})"
                )

    except KeyboardInterrupt:
        print("\n[binary] Interrompido.")
    finally:
        if csv_file:
            csv_file.close()
            print(f"[binary] CSV salvo.")


# ── Modo Simulação ─────────────────────────────────────────────────────────────

def run_simulate(rate: float):
    print(f"[simulate] Modo simulação ativo (intervalo={rate}s)\n")
    t = 0.0
    while True:
        try:
            dados = gerar_leitura_simulada(t)
            row_id = database.insert_leitura(ATIVO_ID, dados)
            flag_str = ["OK", "ALERTA", "ALARME"][dados["flag_anomalia"]]
            print(
                f"[{datetime.now().strftime('%H:%M:%S')}] "
                f"vib={dados['vibracao_mm_s']:.3f} mm/s  "
                f"freq={dados['freq_hz']:.1f} Hz  "
                f"temp={dados['temperatura_c']}°C  "
                f"→ {flag_str}  (id={row_id})"
            )
            t += rate
            time.sleep(rate)
        except KeyboardInterrupt:
            print("\n[simulate] Interrompido.")
            break


# ── Entry point ────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Leitor serial ESP32 → SQLite")
    parser.add_argument("--port",     help="Porta COM explícita (ex: COM3)")
    parser.add_argument("--binary",   action="store_true",
                        help="Protocolo binário — firmware TIMER_MPU6050_BYTES_STARTBYTE")
    parser.add_argument("--save-csv", action="store_true",
                        help="Salva amostras brutas em dados/dados_*.csv (só no modo binário)")
    parser.add_argument("--simulate", action="store_true", help="Usa dados simulados (sem hardware)")
    parser.add_argument("--rate",     type=float, default=1.0, help="Intervalo simulação em segundos")
    parser.add_argument("--window",   type=int,   default=BINARY_WINDOW,
                        help=f"Amostras por janela no modo binário (padrão: {BINARY_WINDOW})")
    parser.add_argument("--debug",    action="store_true", help="Imprime cada pacote recebido")
    args = parser.parse_args()

    _ensure_ativo()

    if args.simulate:
        run_simulate(args.rate)
        return

    port = args.port or _detect_port() or "COM5"
    if not port:
        print("[erro] Nenhuma porta serial encontrada. Use --port COM5 ou --simulate.")
        sys.exit(1)

    if args.binary:
        run_binary(port, window=args.window,
                   save_csv=args.save_csv, debug=args.debug)
    else:
        run_serial(port, debug=args.debug)


if __name__ == "__main__":
    main()
