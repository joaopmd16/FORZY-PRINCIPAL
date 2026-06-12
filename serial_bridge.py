"""
Forzy Serial Bridge — lê o ESP32 pela porta COM e expõe via HTTP localhost.
O iot.js faz polling em http://localhost:8766/data a cada 1 s.

Uso:  python serial_bridge.py            (detecta porta automaticamente)
      python serial_bridge.py COM4       (força a porta)

Dependência: pip install pyserial
"""
import sys, json, time, threading
import http.server, socketserver

try:
    import serial
    import serial.tools.list_ports
except ImportError:
    print("ERRO: pyserial não instalado. Rode: pip install pyserial")
    input("Pressione Enter para fechar...")
    sys.exit(1)

# ── Configuração ──────────────────────────────────────────────────────────────
BAUD     = 115200
HTTP_PORT = 8766
PORTA    = sys.argv[1] if len(sys.argv) > 1 else None   # ex.: COM4

# ── Estado compartilhado ─────────────────────────────────────────────────────
state = {
    "status": "desconectado",
    "porta":  "",
    "ultima": {},
    "ts":     0,
    "erro":   ""
}
lock = threading.Lock()

# ── Detecta porta automaticamente ────────────────────────────────────────────
def detectar_porta():
    portas = list(serial.tools.list_ports.comports())
    for p in portas:
        desc = (p.description or "").lower()
        if any(k in desc for k in ["cp210", "ch340", "ch341", "uart", "usb serial", "esp"]):
            return p.device
    if portas:
        return portas[0].device
    return None

# ── Loop de leitura serial ────────────────────────────────────────────────────
def ler_serial():
    porta = PORTA or detectar_porta()
    if not porta:
        with lock:
            state["status"] = "erro"
            state["erro"]   = "Nenhuma porta serial detectada"
        print("ERRO: nenhuma porta serial encontrada")
        return

    print(f"[Bridge] Conectando em {porta} @ {BAUD} baud...")
    while True:
        try:
            # dsrdtr=False / rtscts=False evita que o pyserial pulse DTR/RTS ao abrir
            # a porta — o ESP32-CAM reseta quando DTR sobe, o que impede receber dados.
            ser = serial.Serial()
            ser.port     = porta
            ser.baudrate = BAUD
            ser.timeout  = 2
            ser.dsrdtr   = False   # NÃO pulsa DTR → ESP32 não reseta
            ser.rtscts   = False   # NÃO pulsa RTS
            ser.open()
            ser.setDTR(False)      # garante nível baixo após open
            ser.setRTS(False)
            time.sleep(0.1)        # estabiliza a linha
            ser.reset_input_buffer()
            with ser:
                with lock:
                    state["status"] = "online"
                    state["porta"]  = porta
                    state["erro"]   = ""
                print(f"[Bridge] Conectado em {porta} — aguardando dados do ESP32...")
                buf = ""
                while True:
                    raw = ser.readline()
                    if not raw:
                        continue
                    line = raw.decode("utf-8", errors="ignore").strip()
                    if not line:
                        continue
                    # Garante que a linha começa com { (descarta lixo de boot)
                    if "{" in line:
                        line = line[line.index("{"):]
                    try:
                        d = json.loads(line)
                        with lock:
                            state["ultima"] = d
                            state["ts"]     = time.time()
                        print(f"[Bridge] OK — ax_rms={d.get('ax_rms','?'):.4f}  mag_rms={d.get('mag_rms','?'):.4f}  temp={d.get('temp_c','?'):.1f}°C")
                    except Exception:
                        print(f"[Bridge] linha ignorada: {line[:60]}")
        except serial.SerialException as e:
            with lock:
                state["status"] = "desconectado"
                state["erro"]   = str(e)
            print(f"[Bridge] Porta desconectada: {e} — tentando reconectar em 3s...")
            time.sleep(3)
        except Exception as e:
            with lock:
                state["status"] = "erro"
                state["erro"]   = str(e)
            print(f"[Bridge] Erro inesperado: {e}")
            time.sleep(3)

# ── Servidor HTTP ─────────────────────────────────────────────────────────────
class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        with lock:
            resp = {
                "status": state["status"],
                "porta":  state["porta"],
                "ts":     state["ts"],
                "erro":   state["erro"],
                "data":   state["ultima"]
            }
        body = json.dumps(resp).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()

    def log_message(self, *a): pass   # silencia log HTTP

# ── Main ──────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    t = threading.Thread(target=ler_serial, daemon=True)
    t.start()

    print(f"[Bridge] HTTP rodando em http://localhost:{HTTP_PORT}/data")
    print("[Bridge] Ctrl+C para encerrar\n")
    with socketserver.TCPServer(("", HTTP_PORT), Handler) as srv:
        srv.serve_forever()
