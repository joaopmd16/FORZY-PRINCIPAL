"""
Gerador de relatórios CSV e PDF para o IMS Forzy.
Suporta múltiplos tipos de relatório com filtros por período.
"""
from __future__ import annotations
import io
import csv
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

# ── Constantes ─────────────────────────────────────────────────────────────────
_CSV_PATH = Path(__file__).parent.parent / "data" / "forzy.csv"

TIPOS_RELATORIO = [
    "Resumo Operacional (Motores)",
    "Anomalias Detectadas (Baseline ML)",
    "Ativos Cadastrados",
    "Leituras IoT",
    "Estatísticas por Período",
]


# ── Coleta de dados ─────────────────────────────────────────────────────────────

def _load_forzy() -> pd.DataFrame:
    df = pd.read_csv(
        _CSV_PATH, sep=";", skiprows=3, header=None,
        usecols=[0, 3, 4, 5, 6, 7, 8],
        names=["timestamp", "m1_vel", "m1_acel", "m1_temp",
               "m2_vel", "m2_acel", "m2_temp"],
    )
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    for c in ["m1_vel", "m1_acel", "m1_temp", "m2_vel", "m2_acel", "m2_temp"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df.dropna().reset_index(drop=True)


def _df_resumo_operacional(inicio: datetime, fim: datetime) -> pd.DataFrame:
    df = _load_forzy()
    df = df[(df["timestamp"] >= pd.Timestamp(inicio)) &
            (df["timestamp"] <= pd.Timestamp(fim))]
    if df.empty:
        return pd.DataFrame()
    resumo = pd.DataFrame({
        "Variável": ["M1 Velocidade (mm/s)", "M1 Aceleração (g)", "M1 Temperatura (°C)",
                     "M2 Velocidade (mm/s)", "M2 Aceleração (g)", "M2 Temperatura (°C)"],
        "Mínimo":   [df.m1_vel.min(), df.m1_acel.min(), df.m1_temp.min(),
                     df.m2_vel.min(), df.m2_acel.min(), df.m2_temp.min()],
        "Média":    [df.m1_vel.mean(), df.m1_acel.mean(), df.m1_temp.mean(),
                     df.m2_vel.mean(), df.m2_acel.mean(), df.m2_temp.mean()],
        "Máximo":   [df.m1_vel.max(), df.m1_acel.max(), df.m1_temp.max(),
                     df.m2_vel.max(), df.m2_acel.max(), df.m2_temp.max()],
        "Desvio":   [df.m1_vel.std(), df.m1_acel.std(), df.m1_temp.std(),
                     df.m2_vel.std(), df.m2_acel.std(), df.m2_temp.std()],
        "N amostras": [len(df)] * 6,
    })
    for c in ["Mínimo", "Média", "Máximo", "Desvio"]:
        resumo[c] = resumo[c].round(4)
    return resumo


def _df_anomalias(inicio: datetime, fim: datetime, limiar_z: float = 2.0) -> pd.DataFrame:
    from utils.baseline_model import computar_baseline, zscore_leitura, classificar_anomalia, VARIAVEIS
    df = _load_forzy()
    df = df[(df["timestamp"] >= pd.Timestamp(inicio)) &
            (df["timestamp"] <= pd.Timestamp(fim))]
    if df.empty:
        return pd.DataFrame()

    # Downsample para não travar (máx 2000 linhas)
    if len(df) > 2000:
        idx = np.linspace(0, len(df) - 1, 2000, dtype=int)
        df = df.iloc[idx].reset_index(drop=True)

    bl = computar_baseline()
    rows = []
    for _, row in df.iterrows():
        leitura = {c: float(row[c]) for c in VARIAVEIS}
        zs = zscore_leitura(leitura, bl)
        score, classe, _ = classificar_anomalia(zs)
        if score >= limiar_z:
            rows.append({
                "Timestamp":    row["timestamp"].strftime("%Y-%m-%d %H:%M:%S"),
                "Score Z":      round(score, 3),
                "Classificação": classe,
                "M1 Vel":       round(row.m1_vel, 3),
                "M1 Acel":      round(row.m1_acel, 3),
                "M1 Temp":      round(row.m1_temp, 1),
                "M2 Vel":       round(row.m2_vel, 3),
                "M2 Acel":      round(row.m2_acel, 3),
                "M2 Temp":      round(row.m2_temp, 1),
            })
    return pd.DataFrame(rows)


def _df_ativos() -> pd.DataFrame:
    import database as db
    ativos = db.get_ativos_industrial()
    if not ativos:
        return pd.DataFrame()
    df = pd.DataFrame(ativos)
    cols = ["codigo", "tag", "descricao", "fabricante", "potencia_kw",
            "tensao_v", "corrente_nom", "ip_rating", "status",
            "area_nome", "planta_nome", "localizacao_descricao", "data_install"]
    cols_exist = [c for c in cols if c in df.columns]
    return df[cols_exist].rename(columns={
        "codigo": "Código", "tag": "TAG", "descricao": "Descrição",
        "fabricante": "Fabricante", "potencia_kw": "kW", "tensao_v": "V",
        "corrente_nom": "A nom", "ip_rating": "IP", "status": "Status",
        "area_nome": "Área", "planta_nome": "Planta",
        "localizacao_descricao": "Localização", "data_install": "Instalação",
    })


def _df_leituras_iot(limite: int = 500) -> pd.DataFrame:
    import database as db
    ativos = db.get_ativos_industrial()
    if not ativos:
        return pd.DataFrame()
    todas = []
    for a in ativos:
        lts = db.get_leituras(a["codigo"], limit=limite // max(len(ativos), 1))
        for lt in lts:
            lt["ativo"] = a["codigo"]
            todas.append(lt)
    if not todas:
        return pd.DataFrame()
    df = pd.DataFrame(todas)
    return df[["ativo", "coletado_em", "vibracao_mm_s", "temperatura_c", "corrente_a", "flag_anomalia"]].rename(
        columns={"ativo": "Ativo", "coletado_em": "Coletado em",
                 "vibracao_mm_s": "Vibração mm/s", "temperatura_c": "Temp °C",
                 "corrente_a": "Corrente A", "flag_anomalia": "Anomalia"}
    )


def _df_estatisticas_periodo(inicio: datetime, fim: datetime) -> pd.DataFrame:
    df = _load_forzy()
    df = df[(df["timestamp"] >= pd.Timestamp(inicio)) &
            (df["timestamp"] <= pd.Timestamp(fim))]
    if df.empty:
        return pd.DataFrame()
    df["hora"] = df["timestamp"].dt.floor("H")
    agg = df.groupby("hora").agg(
        m1_vel_media=("m1_vel", "mean"), m1_temp_media=("m1_temp", "mean"),
        m2_vel_media=("m2_vel", "mean"), m2_temp_media=("m2_temp", "mean"),
        amostras=("m1_vel", "count"),
    ).reset_index()
    agg.columns = ["Hora", "M1 Vel Média", "M1 Temp Média",
                   "M2 Vel Média", "M2 Temp Média", "Amostras"]
    for c in ["M1 Vel Média", "M1 Temp Média", "M2 Vel Média", "M2 Temp Média"]:
        agg[c] = agg[c].round(3)
    return agg


# ── Exportadores ───────────────────────────────────────────────────────────────

def exportar_csv(dfs: dict[str, pd.DataFrame]) -> bytes:
    """Combina múltiplos DataFrames em um CSV com seções separadas."""
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["IMS Forzy — Relatório", datetime.now().strftime("%Y-%m-%d %H:%M:%S")])
    w.writerow([])
    for titulo, df in dfs.items():
        w.writerow([f"=== {titulo} ==="])
        if df.empty:
            w.writerow(["Sem dados para o período selecionado."])
        else:
            w.writerow(df.columns.tolist())
            for _, row in df.iterrows():
                w.writerow(row.tolist())
        w.writerow([])
    return buf.getvalue().encode("utf-8-sig")  # BOM para Excel


def exportar_pdf(dfs: dict[str, pd.DataFrame], inicio: datetime, fim: datetime) -> bytes:
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib import colors
    from reportlab.lib.units import cm
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak,
    )
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_LEFT

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4),
                            topMargin=1.5*cm, bottomMargin=1.5*cm,
                            leftMargin=1.5*cm, rightMargin=1.5*cm)

    styles = getSampleStyleSheet()
    style_title = ParagraphStyle("title", parent=styles["Title"],
                                 fontSize=16, textColor=colors.HexColor("#3498db"),
                                 spaceAfter=6)
    style_sub   = ParagraphStyle("sub", parent=styles["Normal"],
                                 fontSize=9, textColor=colors.HexColor("#7f8c8d"),
                                 spaceAfter=14)
    style_h2    = ParagraphStyle("h2", parent=styles["Heading2"],
                                 fontSize=11, textColor=colors.HexColor("#2c3e50"),
                                 spaceBefore=12, spaceAfter=6)
    style_empty = ParagraphStyle("empty", parent=styles["Normal"],
                                 fontSize=9, textColor=colors.HexColor("#95a5a6"),
                                 spaceAfter=8)

    HDR_COLOR  = colors.HexColor("#1a2740")
    ROW_COLOR1 = colors.HexColor("#f7faff")
    ROW_COLOR2 = colors.white

    story = [
        Paragraph("IMS Forzy — Relatório Operacional", style_title),
        Paragraph(
            f"Período: {inicio.strftime('%d/%m/%Y')} a {fim.strftime('%d/%m/%Y')}  |  "
            f"Gerado em: {datetime.now().strftime('%d/%m/%Y %H:%M')}",
            style_sub,
        ),
    ]

    for titulo, df in dfs.items():
        story.append(Paragraph(titulo, style_h2))
        if df.empty:
            story.append(Paragraph("Sem dados para o período selecionado.", style_empty))
            continue

        # Limita colunas e linhas para não estourar a página
        df_show = df.head(200)
        max_cols = 10
        if len(df_show.columns) > max_cols:
            df_show = df_show.iloc[:, :max_cols]

        data = [df_show.columns.tolist()] + df_show.astype(str).values.tolist()

        col_w = (26 * cm) / max(len(df_show.columns), 1)
        tbl = Table(data, colWidths=[col_w] * len(df_show.columns), repeatRows=1)
        tbl.setStyle(TableStyle([
            ("BACKGROUND",  (0, 0), (-1, 0),  HDR_COLOR),
            ("TEXTCOLOR",   (0, 0), (-1, 0),  colors.white),
            ("FONTNAME",    (0, 0), (-1, 0),  "Helvetica-Bold"),
            ("FONTSIZE",    (0, 0), (-1, 0),  8),
            ("FONTSIZE",    (0, 1), (-1, -1), 7),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [ROW_COLOR1, ROW_COLOR2]),
            ("GRID",        (0, 0), (-1, -1), 0.4, colors.HexColor("#dde3ec")),
            ("VALIGN",      (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING",  (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
        ]))
        story.append(tbl)
        story.append(Spacer(1, 0.4*cm))

    doc.build(story)
    return buf.getvalue()


# ── Ponto de entrada principal ─────────────────────────────────────────────────

def gerar_relatorios(tipos: list[str], inicio: datetime, fim: datetime,
                     limiar_z: float = 2.0) -> dict[str, pd.DataFrame]:
    """Retorna dict {titulo: DataFrame} para os tipos selecionados."""
    resultado = {}
    mapa = {
        "Resumo Operacional (Motores)":      lambda: _df_resumo_operacional(inicio, fim),
        "Anomalias Detectadas (Baseline ML)": lambda: _df_anomalias(inicio, fim, limiar_z),
        "Ativos Cadastrados":                 lambda: _df_ativos(),
        "Leituras IoT":                       lambda: _df_leituras_iot(),
        "Estatísticas por Período":           lambda: _df_estatisticas_periodo(inicio, fim),
    }
    for t in tipos:
        if t in mapa:
            resultado[t] = mapa[t]()
    return resultado
