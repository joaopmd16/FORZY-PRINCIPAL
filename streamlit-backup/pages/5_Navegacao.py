import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import streamlit as st
import pandas as pd
import database as db
from utils.theme import apply as _apply_theme, sidebar_nav as _snav

st.set_page_config(page_title="Navegacao — IMS Forzy", layout="wide")
_apply_theme()
_snav("navegacao")

# ── Cabeçalho ────────────────────────────────────────────────────────────────
st.markdown("""
<div style="padding:10px 0 14px">
  <div style="font-size:1.3rem;font-weight:700;color:#e2eaf4">Navegacao da Planta</div>
  <div style="font-size:.78rem;color:#4a7a9b;margin-top:2px">Planta · Area · Ativo</div>
</div>
""", unsafe_allow_html=True)

# ── Busca NLP ─────────────────────────────────────────────────────────────────
_todos_ativos = db.get_ativos_industrial()

def _busca_nlp(query: str, ativos: list) -> list:
    """
    Busca textual simples (NLP) sobre ativos industriais.
    Tokeniza a query e verifica presença nos campos textuais do ativo.
    Retorna lista ordenada por relevância (qtd de tokens encontrados).
    """
    tokens = [t.lower().strip() for t in query.split() if len(t.strip()) >= 2]
    if not tokens:
        return ativos

    CAMPOS = ["codigo", "tag", "descricao", "fabricante", "tipo_ativo",
              "status", "area_nome", "planta_nome", "localizacao_descricao",
              "modelo", "numero_serie"]

    resultados = []
    for ativo in ativos:
        texto = " ".join(
            str(ativo.get(c, "") or "") for c in CAMPOS
        ).lower()
        hits = sum(1 for t in tokens if t in texto)
        if hits > 0:
            resultados.append((hits, ativo))

    resultados.sort(key=lambda x: -x[0])
    return [a for _, a in resultados]

_busca_col, _busca_btn = st.columns([5, 1])
with _busca_col:
    _query = st.text_input(
        "Busca de ativo",
        placeholder="Ex: bomba, WEG, area-01, 220V, manutencao, TAG-003...",
        label_visibility="collapsed",
        key="nav_busca_query",
    )
with _busca_btn:
    _limpar = st.button("Limpar", key="nav_busca_clear", use_container_width=True)
    if _limpar:
        st.session_state["nav_busca_query"] = ""
        st.rerun()

if _query and _query.strip():
    _resultados = _busca_nlp(_query.strip(), _todos_ativos)
    _STATUS_COR_B = {"ativo": "#27ae60", "manutencao": "#f39c12", "inativo": "#e74c3c"}

    st.markdown(f'<p style="font-size:.72rem;color:#4a7a9b;margin:6px 0 10px">'
                f'{len(_resultados)} ativo(s) encontrado(s) para "<b style="color:#7ec8e3">{_query}</b>"</p>',
                unsafe_allow_html=True)

    if _resultados:
        _r_cols = st.columns(min(3, len(_resultados)))
        for _ri, _ra in enumerate(_resultados[:9]):
            _sc = _STATUS_COR_B.get(_ra.get("status", ""), "#4a7a9b")
            with _r_cols[_ri % 3]:
                st.markdown(f"""
                <div style="background:#0a1628;border:1px solid #0f2a45;border-left:3px solid {_sc};
                             border-radius:8px;padding:12px 14px;margin-bottom:10px">
                  <div style="font-size:.95rem;font-weight:700;color:#7ec8e3">{_ra.get('codigo','—')}</div>
                  <div style="font-size:.75rem;color:#4a7a9b;margin:2px 0 6px">
                    TAG: {_ra.get('tag') or '—'}
                  </div>
                  <div style="font-size:.78rem;color:#e2eaf4">{_ra.get('descricao') or '—'}</div>
                  <div style="font-size:.7rem;color:#4a7a9b;margin-top:4px">
                    {_ra.get('area_nome','—')} · {_ra.get('planta_nome','—')}
                  </div>
                  <div style="margin-top:8px">
                    <span style="background:{_sc}22;border:1px solid {_sc};color:{_sc};
                                 font-size:.65rem;font-weight:700;padding:2px 10px;
                                 border-radius:12px;text-transform:uppercase">
                      {_ra.get('status','—')}
                    </span>
                  </div>
                </div>
                """, unsafe_allow_html=True)
    else:
        st.info("Nenhum ativo encontrado. Tente outros termos.")

    st.markdown('<hr style="border-color:#0f2035;margin:14px 0">', unsafe_allow_html=True)

# ── Drill-down ───────────────────────────────────────────────────────────────
plantas = db.get_plantas()
if not plantas:
    st.warning("Nenhuma planta cadastrada.")
    st.stop()

col1, col2, col3 = st.columns(3)

with col1:
    st.markdown('<p style="font-size:.7rem;color:#4a7a9b;font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px">Planta</p>', unsafe_allow_html=True)
    planta_sel = st.selectbox("Planta", [p["nome"] for p in plantas], label_visibility="collapsed")
    planta = next(p for p in plantas if p["nome"] == planta_sel)

areas = db.get_areas(planta["id"])
with col2:
    st.markdown('<p style="font-size:.7rem;color:#4a7a9b;font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px">Area</p>', unsafe_allow_html=True)
    area_nomes = [a["nome"] for a in areas]
    area_sel = st.selectbox("Area", area_nomes, label_visibility="collapsed") if area_nomes else None
    area = next((a for a in areas if a["nome"] == area_sel), None)

ativos = db.get_ativos_industrial(area_id=area["id"]) if area else []
with col3:
    st.markdown('<p style="font-size:.7rem;color:#4a7a9b;font-weight:700;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px">Ativo</p>', unsafe_allow_html=True)
    ativo_codigos = [a["codigo"] for a in ativos]
    ativo_sel = st.selectbox("Ativo", ativo_codigos, label_visibility="collapsed") if ativo_codigos else None
    ativo = next((a for a in ativos if a["codigo"] == ativo_sel), None)

st.markdown('<hr style="border-color:#0f2035;margin:14px 0">', unsafe_allow_html=True)

if not ativo:
    st.info("Selecione um ativo para ver os detalhes.")
    st.stop()

# ── Card do ativo ─────────────────────────────────────────────────────────────
STATUS_COR = {"ativo": "#27ae60", "manutencao": "#f39c12", "inativo": "#e74c3c"}
status_cor = STATUS_COR.get(ativo["status"], "#4a7a9b")

col_info, col_mapa = st.columns([1, 1], gap="large")

with col_info:
    st.markdown(f"""
    <div style="background:#0a1628;border:1px solid #0f2a45;border-radius:10px;padding:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div>
          <div style="font-size:1.1rem;font-weight:700;color:#e2eaf4">{ativo['codigo']}</div>
          <div style="font-size:.8rem;color:#4a7a9b;margin-top:2px">{ativo['descricao']}</div>
        </div>
        <div style="background:{status_cor}22;border:1px solid {status_cor};color:{status_cor};
                    font-size:.72rem;font-weight:700;padding:4px 12px;border-radius:20px;
                    text-transform:uppercase;letter-spacing:.08em">
          {ativo['status']}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div style="background:#060d18;border-radius:6px;padding:10px 14px">
          <div style="font-size:.65rem;color:#4a7a9b;text-transform:uppercase;letter-spacing:.08em">TAG</div>
          <div style="font-size:.95rem;font-weight:600;color:#7ec8e3;margin-top:3px">{ativo['tag'] or '—'}</div>
        </div>
        <div style="background:#060d18;border-radius:6px;padding:10px 14px">
          <div style="font-size:.65rem;color:#4a7a9b;text-transform:uppercase;letter-spacing:.08em">Fabricante</div>
          <div style="font-size:.95rem;font-weight:600;color:#e2eaf4;margin-top:3px">{ativo['fabricante'] or '—'}</div>
        </div>
        <div style="background:#060d18;border-radius:6px;padding:10px 14px">
          <div style="font-size:.65rem;color:#4a7a9b;text-transform:uppercase;letter-spacing:.08em">Potencia</div>
          <div style="font-size:.95rem;font-weight:600;color:#e2eaf4;margin-top:3px">{ativo['potencia_kw'] or '—'} kW</div>
        </div>
        <div style="background:#060d18;border-radius:6px;padding:10px 14px">
          <div style="font-size:.65rem;color:#4a7a9b;text-transform:uppercase;letter-spacing:.08em">Tensao</div>
          <div style="font-size:.95rem;font-weight:600;color:#e2eaf4;margin-top:3px">{ativo['tensao_v'] or '—'} V</div>
        </div>
        <div style="background:#060d18;border-radius:6px;padding:10px 14px">
          <div style="font-size:.65rem;color:#4a7a9b;text-transform:uppercase;letter-spacing:.08em">Corrente Nom</div>
          <div style="font-size:.95rem;font-weight:600;color:#e2eaf4;margin-top:3px">{ativo['corrente_nom'] or '—'} A</div>
        </div>
        <div style="background:#060d18;border-radius:6px;padding:10px 14px">
          <div style="font-size:.65rem;color:#4a7a9b;text-transform:uppercase;letter-spacing:.08em">Protecao</div>
          <div style="font-size:.95rem;font-weight:600;color:#e2eaf4;margin-top:3px">{ativo['ip_rating'] or '—'}</div>
        </div>
      </div>
      <div style="margin-top:12px;background:#060d18;border-radius:6px;padding:10px 14px">
        <div style="font-size:.65rem;color:#4a7a9b;text-transform:uppercase;letter-spacing:.08em">Localizacao na Fabrica</div>
        <div style="font-size:.88rem;color:#e2eaf4;margin-top:4px">{ativo['localizacao_descricao'] or '—'}</div>
        <div style="font-size:.75rem;color:#4a7a9b;margin-top:4px">{ativo['area_nome']} · {ativo['planta_nome']}</div>
      </div>
    </div>
    """, unsafe_allow_html=True)

    # Últimas leituras
    leituras = db.get_leituras(ativo["codigo"], limit=5)
    if leituras:
        st.markdown('<p style="font-size:.72rem;color:#4a7a9b;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin:14px 0 6px">Ultimas Leituras</p>', unsafe_allow_html=True)
        df_l = pd.DataFrame(leituras)[["coletado_em","vibracao_mm_s","temperatura_c","corrente_a","flag_anomalia"]]
        df_l.columns = ["Coletado em","Vibracao mm/s","Temp C","Corrente A","Anomalia"]
        st.dataframe(df_l, use_container_width=True, hide_index=True)

with col_mapa:
    lat = ativo.get("latitude")
    lon = ativo.get("longitude")
    if lat and lon:
        todos_area = db.get_ativos_industrial(area_id=area["id"])
        df_mapa = pd.DataFrame([
            {
                "lat":   a["latitude"],
                "lon":   a["longitude"],
                "color": [39, 174, 96, 220] if a["status"] == "ativo"
                         else [243, 156, 18, 220] if a["status"] == "manutencao"
                         else [231, 76, 60, 220],
                "size":  20 if a["codigo"] == ativo["codigo"] else 10,
            }
            for a in todos_area if a["latitude"] and a["longitude"]
        ])
        st.markdown('<p style="font-size:.72rem;color:#4a7a9b;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Localizacao no Mapa</p>', unsafe_allow_html=True)
        st.map(df_mapa, latitude="lat", longitude="lon", color="color", size="size", zoom=16)
        st.markdown("""
        <div style="display:flex;gap:16px;margin-top:6px">
          <span style="font-size:.73rem;color:#27ae60;font-weight:600">● Ativo</span>
          <span style="font-size:.73rem;color:#f39c12;font-weight:600">● Manutencao</span>
          <span style="font-size:.73rem;color:#e74c3c;font-weight:600">● Inativo</span>
          <span style="font-size:.73rem;color:#4a7a9b">( ponto maior = ativo selecionado )</span>
        </div>
        """, unsafe_allow_html=True)
    else:
        st.info("Coordenadas nao cadastradas para este ativo.")
