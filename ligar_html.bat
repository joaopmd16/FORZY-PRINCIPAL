@echo off
setlocal
cd /d "%~dp0"

echo ============================================
echo  IMS - Forzy  ^|  Dashboard HTML (principal)
echo ============================================
echo.

where python >nul 2>&1
if errorlevel 1 (
    echo [ERRO] Python nao encontrado no PATH.
    pause
    exit /b 1
)

REM ── Inicia o bridge do ESP32 em segundo plano (janela separada) ───────────────
echo Iniciando bridge ESP32 (serial_bridge.py)...
start "Forzy Bridge ESP32" /min python serial_bridge.py

REM ── Sobe o servidor HTTP e abre o navegador ───────────────────────────────────
echo Servindo a pasta atual em http://localhost:8760/vision.html
echo Abrindo o navegador...
timeout /t 1 /nobreak >nul
start "" "http://localhost:8760/vision.html"
echo.
echo Para encerrar: feche esta janela ou pressione Ctrl+C.
echo (O bridge do ESP32 roda em janela minimizada separada)
echo.
python -m http.server 8760

endlocal
