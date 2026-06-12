import serial
import serial.serialutil
import serial.tools.list_ports
import time
import re
from datetime import datetime
import csv
import os

baudrate = 115200

# VID/PID dos chips USB-serial mais comuns em placas ESP32
ESP32_CHIPS = {
    (0x1A86, 0x7523): "CH340",
    (0x1A86, 0x55D4): "CH343",
    (0x10C4, 0xEA60): "CP210x",
    (0x0403, 0x6001): "FTDI FT232",
    (0x0403, 0x6010): "FTDI FT2232",
}

def detectar_porta():
    portas = list(serial.tools.list_ports.comports())
    for p in portas:
        vid, pid = p.vid, p.pid
        if (vid, pid) in ESP32_CHIPS:
            chip = ESP32_CHIPS[(vid, pid)]
            print(f"ESP32 detectado: {p.device} ({chip}) — {p.description}")
            return p.device
    # fallback: qualquer porta com "CH34" ou "CP21" ou "FTDI" no nome
    for p in portas:
        desc = (p.description or "").upper()
        if any(k in desc for k in ["CH34", "CP21", "FTDI", "ESP", "UART", "USB SERIAL"]):
            print(f"ESP32 detectado (fallback): {p.device} — {p.description}")
            return p.device
    print("Portas disponíveis:")
    for p in portas:
        print(f"  {p.device} — {p.description} (VID={p.vid:#06x} PID={p.pid:#06x})")
    raise RuntimeError("Nenhuma porta ESP32 encontrada. Verifique o cabo USB.")

porta = detectar_porta()

PATTERN = re.compile(
    r'AX[^:]*:\s*([-\d.]+).*?AY[^:]*:\s*([-\d.]+).*?AZ[^:]*:\s*([-\d.]+)'
    r'.*?GX[^:]*:\s*([-\d.]+).*?GY[^:]*:\s*([-\d.]+).*?GZ[^:]*:\s*([-\d.]+)'
)

os.makedirs("dados", exist_ok=True)
hora_atual = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
nome_arquivo = f"dados/dados_{hora_atual}.csv"

with open(nome_arquivo, mode='w', newline='') as f:
    csv.writer(f).writerow(['timestamp', 'AX_g', 'AY_g', 'AZ_g', 'GX_dps', 'GY_dps', 'GZ_dps'])

print(f"Salvando em: {nome_arquivo}\n")

def abrir_porta():
    s = serial.Serial(porta, baudrate, timeout=2)
    s.rts = False  # IO0=HIGH → modo execução (não download)
    s.dtr = False  # EN=HIGH → não reseta
    time.sleep(3)
    s.reset_input_buffer()
    return s

ser = None
contador = 0
inicio_segundo = time.time()

while True:
    # (re)abre porta se necessário
    if ser is None or not ser.is_open:
        try:
            if ser:
                ser.close()
            print("Abrindo porta...")
            ser = abrir_porta()
            print("Porta aberta. Aguardando dados...\n")
        except serial.serialutil.SerialException as e:
            print(f"Erro ao abrir porta: {e} — tentando em 2s")
            time.sleep(2)
            continue

    # lê linha
    try:
        raw = ser.readline()
        if not raw:
            if time.time() - inicio_segundo >= 1.0:
                print(f"→ Taxa de dados: {contador} amostras/segundo")
                contador = 0
                inicio_segundo = time.time()
            continue
        linha = raw.decode('latin-1', errors='replace').strip()
    except serial.serialutil.SerialException as e:
        print(f"Erro de leitura: {e} — reabrindo porta")
        ser = None
        time.sleep(1)
        continue

    m = PATTERN.search(linha)
    if m:
        ax, ay, az, gx, gy, gz = m.groups()
        timestamp = datetime.now().strftime('%H:%M:%S.%f')[:-3]
        print(f"{timestamp} | AX={ax}g  AY={ay}g  AZ={az}g")
        with open(nome_arquivo, mode='a', newline='') as f:
            csv.writer(f).writerow([timestamp, ax, ay, az, gx, gy, gz])
        contador += 1
    else:
        print(f"[RAW] {repr(linha)}")

    if time.time() - inicio_segundo >= 1.0:
        print(f"→ Taxa de dados: {contador} amostras/segundo")
        contador = 0
        inicio_segundo = time.time()
