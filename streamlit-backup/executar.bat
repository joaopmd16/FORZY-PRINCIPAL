@echo off
setlocal

echo ============================================
echo  Digital TWIN -- Forzy Dashboard
echo ============================================
echo.

where python >nul 2>&1
if errorlevel 1 (
    echo [ERRO] Python nao encontrado no PATH.
    pause
    exit /b 1
)

echo [1/2] Instalando dependencias...
python -m pip install -q -r requirements.txt
if errorlevel 1 (
    echo [ERRO] Falha ao instalar dependencias.
    pause
    exit /b 1
)

echo [2/2] Iniciando dashboard...
echo.
echo Acesse: http://localhost:8501
echo.
python -m streamlit run 1_Inicio.py --server.port 8501

endlocal
