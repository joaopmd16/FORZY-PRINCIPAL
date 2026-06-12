"""Associação automática de TAG + área nos ativos industriais."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import database as db
from datetime import datetime


def associar_tags(mapeamento: list[dict]) -> dict:
    """
    mapeamento: lista de {codigo, tag, area_id}
    Retorna: {ok: int, erros: int, detalhes: list[str]}
    """
    ok, erros, detalhes = 0, 0, []
    for item in mapeamento:
        codigo = item.get("codigo", "").strip()
        if not codigo:
            continue
        ativo = db.get_ativo_por_codigo(codigo)
        if not ativo:
            erros += 1
            detalhes.append(f"ERRO — {codigo}: ativo não encontrado")
            continue
        try:
            db.editar_ativo_industrial(codigo, {
                **ativo,
                "tag":     item.get("tag", ativo.get("tag")),
                "area_id": item.get("area_id", ativo.get("area_id")),
            })
            ok += 1
            detalhes.append(f"OK — {codigo}: TAG={item.get('tag')} | Área ID={item.get('area_id')}")
        except Exception as e:
            erros += 1
            detalhes.append(f"ERRO — {codigo}: {e}")

    db.log_execucao(
        "Associação de TAGs",
        "sucesso" if erros == 0 else "parcial",
        ok, erros,
        "\n".join(detalhes),
    )
    return {"ok": ok, "erros": erros, "detalhes": detalhes}
