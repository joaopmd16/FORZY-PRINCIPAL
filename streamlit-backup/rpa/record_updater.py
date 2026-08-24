"""Atualização de status e dados técnicos em lote."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import database as db


STATUS_VALIDOS = {"ativo", "manutencao", "inativo"}


def atualizar_status(codigos: list[str], novo_status: str) -> dict:
    if novo_status not in STATUS_VALIDOS:
        return {"ok": 0, "erros": len(codigos), "detalhes": [f"Status inválido: {novo_status}"]}

    ok, erros, detalhes = 0, 0, []
    for codigo in codigos:
        ativo = db.get_ativo_por_codigo(codigo)
        if not ativo:
            erros += 1
            detalhes.append(f"ERRO — {codigo}: não encontrado")
            continue
        try:
            db.editar_ativo_industrial(codigo, {**ativo, "status": novo_status})
            ok += 1
            detalhes.append(f"OK — {codigo}: {ativo['status']} → {novo_status}")
        except Exception as e:
            erros += 1
            detalhes.append(f"ERRO — {codigo}: {e}")

    db.log_execucao(
        "Atualização de Status",
        "sucesso" if erros == 0 else "parcial",
        ok, erros, "\n".join(detalhes),
    )
    return {"ok": ok, "erros": erros, "detalhes": detalhes}


def coletar_leituras_simuladas(codigos: list[str]) -> dict:
    """Simula coleta de sensores e persiste em leituras."""
    import random
    from datetime import datetime

    ok, erros, detalhes = 0, 0, []
    for codigo in codigos:
        ativo = db.get_ativo_por_codigo(codigo)
        if not ativo:
            erros += 1
            detalhes.append(f"ERRO — {codigo}: não encontrado")
            continue
        try:
            anomalia = random.random() < 0.05
            vel = random.gauss(1.2, 0.4) if not anomalia else random.uniform(5.0, 9.0)
            dados = {
                "fonte":         "rpa_simulado",
                "temperatura_c": random.gauss(55, 5) if not anomalia else random.uniform(85, 100),
                "vibracao_mm_s": max(0, vel),
                "corrente_a":    random.gauss(ativo.get("corrente_nom") or 80, 5),
                "tensao_v":      random.gauss(ativo.get("tensao_v") or 380, 3),
                "rpm":           random.gauss(1780, 20),
                "fator_potencia":random.gauss(0.88, 0.02),
                "coletado_em":   datetime.utcnow().isoformat(),
                "flag_anomalia": int(anomalia),
                "ax_rms": random.gauss(0.02, 0.005),
                "ay_rms": random.gauss(0.98, 0.01),
                "az_rms": random.gauss(0.15, 0.01),
            }
            db.insert_leitura(codigo, dados)
            ok += 1
            flag = " [ANOMALIA]" if anomalia else ""
            detalhes.append(f"OK — {codigo}: vel={vel:.2f} mm/s{flag}")
        except Exception as e:
            erros += 1
            detalhes.append(f"ERRO — {codigo}: {e}")

    db.log_execucao(
        "Coleta de Leituras",
        "sucesso" if erros == 0 else "parcial",
        ok, erros, "\n".join(detalhes),
    )
    return {"ok": ok, "erros": erros, "detalhes": detalhes}
