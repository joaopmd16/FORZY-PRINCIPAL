"""Gerador de dados simulados — sensor Pepperl+Fuchs VIM32PL."""
import random
import math
from datetime import datetime


# Modos de falha simuláveis
MODO_NORMAL      = "normal"
MODO_DESBALANCO  = "desbalanco"
MODO_CAVITACAO   = "cavitacao"
MODO_DESALINHAMENTO = "desalinhamento"


def gerar_leitura_simulada(t: float = 0.0, modo: str = MODO_NORMAL) -> dict:
    """Simula leitura do VIM32PL com padrão oscilatório realista."""
    rpm_base = 2980.0

    if modo == MODO_DESBALANCO:
        # Vibração alta na frequência de rotação (1x)
        base_vib = 3.5 + 1.5 * math.sin(t / 20) + random.gauss(0, 0.3)
        freq_hz  = rpm_base / 60 + random.gauss(0, 0.5)
        a_peak   = 0.42 + 0.1 * math.sin(t / 15) + random.gauss(0, 0.02)
    elif modo == MODO_CAVITACAO:
        # Vibração irregular com picos aleatórios (ruído de fluido)
        base_vib = 2.8 + random.gauss(0, 0.8)
        freq_hz  = rpm_base / 60 * (1 + random.gauss(0, 0.05))
        a_peak   = 0.65 + random.gauss(0, 0.15)
    elif modo == MODO_DESALINHAMENTO:
        # Vibração alta em 2x RPM
        base_vib = 4.2 + 0.9 * math.sin(t / 25) + random.gauss(0, 0.2)
        freq_hz  = (rpm_base / 60) * 2 + random.gauss(0, 0.3)
        a_peak   = 0.55 + 0.08 * math.sin(t / 18) + random.gauss(0, 0.02)
    else:
        # Normal: oscilação lenta + ruído gaussiano
        base_vib = 1.2 + 0.8 * math.sin(t / 30) + random.gauss(0, 0.15)
        freq_hz  = rpm_base / 60 + random.gauss(0, 0.1)
        a_peak   = 0.12 + 0.04 * math.sin(t / 28) + random.gauss(0, 0.005)

    vibracao = max(0.05, base_vib)
    a_peak   = max(0.01, a_peak)

    # Aceleração RMS ≈ 60-70% do pico
    mag_rms = a_peak * (0.63 + random.gauss(0, 0.02))

    ax_rms = mag_rms * 0.70
    ay_rms = mag_rms * 0.55
    az_rms = mag_rms * 0.40
    mag_rms_calc = math.sqrt(ax_rms**2 + ay_rms**2 + az_rms**2)

    if vibracao < 1.8:
        flag = 0
    elif vibracao < 4.5:
        flag = 1
    else:
        flag = 2

    # Temperatura sobe levemente com vibração alta
    temp_base = 38.0 + vibracao * 1.2
    temperatura = temp_base + random.gauss(0, 1.2)

    return {
        "fonte":          "simulado",
        "temperatura_c":  round(temperatura, 2),
        "vibracao_mm_s":  round(vibracao, 4),
        "a_peak_g":       round(a_peak, 4),      # aceleração de pico (g) — canal VIM32PL
        "mag_rms":        round(mag_rms_calc, 6),  # aceleração RMS (g)
        "corrente_a":     round(4.2 + random.gauss(0, 0.1), 3),
        "tensao_v":       round(220.0 + random.gauss(0, 2), 1),
        "rpm":            round(rpm_base + random.gauss(0, 5), 1),
        "fator_potencia": round(0.92 + random.gauss(0, 0.01), 3),
        "coletado_em":    datetime.utcnow().isoformat(),
        "flag_anomalia":  flag,
        "ax_rms":         round(ax_rms, 6),
        "ay_rms":         round(ay_rms, 6),
        "az_rms":         round(az_rms, 6),
        "freq_hz":        round(freq_hz, 2),
        "gx_rms":         round(random.gauss(0, 0.05), 4),
        "gy_rms":         round(random.gauss(0, 0.05), 4),
        "gz_rms":         round(random.gauss(0, 0.05), 4),
        "peaks":          [round(freq_hz, 1), round(freq_hz * 2, 1)],
        "modo_falha":     modo,
    }


def gerar_historico_simulado(n: int = 300, incluir_falha: bool = True) -> list[dict]:
    """Gera N leituras com transição de modo normal → falha para demo."""
    leituras = []
    for i in range(n):
        t = float(i)
        if incluir_falha and i > int(n * 0.75):
            modo = MODO_DESBALANCO
        elif incluir_falha and i > int(n * 0.60):
            modo = MODO_CAVITACAO
        else:
            modo = MODO_NORMAL
        leituras.append(gerar_leitura_simulada(t=t, modo=modo))
    return leituras
