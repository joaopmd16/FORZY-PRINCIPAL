"""Simulação de OCR de plaqueta industrial e mapeamento de campos."""
import re
import random
from PIL import Image, ImageDraw, ImageFont
import io


# Campos extraídos de uma plaqueta típica WEG
_TEMPLATE = {
    "fabricante":   "WEG",
    "potencia_kw":  75.0,
    "tensao_v":     380.0,
    "corrente_nom": 140.0,
    "ip_rating":    "IP55",
    "rpm":          1780,
    "cos_phi":      0.88,
    "grau_iso":     "F",
}


def gerar_imagem_plaqueta(dados: dict | None = None) -> bytes:
    """Gera imagem PNG de exemplo de plaqueta para demo."""
    d = dados or _TEMPLATE
    w, h = 520, 300
    img = Image.new("RGB", (w, h), color=(30, 45, 70))
    draw = ImageDraw.Draw(img)

    # Borda
    draw.rectangle([4, 4, w-5, h-5], outline=(80, 160, 220), width=2)
    draw.rectangle([10, 10, w-11, h-11], outline=(50, 110, 160), width=1)

    # Título
    draw.rectangle([10, 10, w-11, 50], fill=(20, 35, 55))
    draw.text((w//2, 30), "MOTOR ELETRICO TRIFASICO", fill=(180, 220, 255), anchor="mm")

    linhas = [
        f"Fabricante : {d.get('fabricante','WEG')}",
        f"Potencia   : {d.get('potencia_kw',75)} kW",
        f"Tensao     : {d.get('tensao_v',380)} V   Corrente: {d.get('corrente_nom',140)} A",
        f"Rot        : {d.get('rpm',1780)} rpm      cos phi: {d.get('cos_phi',0.88)}",
        f"Prot       : {d.get('ip_rating','IP55')}    Cl.Iso: {d.get('grau_iso','F')}",
    ]
    y = 70
    for linha in linhas:
        draw.text((30, y), linha, fill=(200, 230, 255))
        y += 38

    draw.text((w//2, h-18), "SN: FZY-2024-00001", fill=(80, 130, 180), anchor="mm")

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def simular_ocr(image_bytes: bytes) -> dict:
    """
    Extrai campos da plaqueta via simulação.
    Em produção, substituir por pytesseract.image_to_string + regex.
    """
    # Variação aleatória para tornar o demo mais realista
    noise = random.uniform(-0.03, 0.03)
    return {
        "fabricante":   "WEG",
        "potencia_kw":  round(75.0 * (1 + noise), 1),
        "tensao_v":     380.0,
        "corrente_nom": round(140.0 * (1 + noise), 1),
        "ip_rating":    "IP55",
        "rpm":          1780,
        "confianca":    round(random.uniform(0.88, 0.97), 2),
    }


def validar_campos(campos: dict) -> list[str]:
    """Retorna lista de avisos de validação (vazia = OK)."""
    avisos = []
    if campos.get("potencia_kw", 0) <= 0:
        avisos.append("Potência inválida (deve ser > 0)")
    if campos.get("tensao_v", 0) not in [220, 380, 440, 690]:
        avisos.append(f"Tensão {campos.get('tensao_v')} V fora dos valores típicos")
    if campos.get("confianca", 1) < 0.80:
        avisos.append("Confiança OCR baixa — confirme manualmente")
    return avisos
