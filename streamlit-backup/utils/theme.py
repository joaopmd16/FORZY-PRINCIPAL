"""CSS global do IMS · Forzy — importar no topo de cada página."""
import streamlit as st


_NAV_HIDE_CSS = """
<style>
/* Oculta a navegação automática do Streamlit */
[data-testid="stSidebarNav"] { display: none !important; }

/* Nav customizada */
.nav-section-label {
    font-size: .62rem; font-weight: 700; letter-spacing: .12em;
    color: #2a5a7a; text-transform: uppercase;
    padding: 14px 14px 4px; margin: 0;
}
.nav-item {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 14px; border-radius: 7px; cursor: pointer;
    font-size: .84rem; font-weight: 500; color: #4a7a9b;
    text-decoration: none; transition: all .15s;
    margin: 1px 6px;
}
.nav-item:hover { background: #0f2035; color: #7ec8e3; }
.nav-item.active {
    background: linear-gradient(90deg,#0d2040,#0a1a35);
    color: #7ec8e3 !important;
    border-left: 3px solid #3498db;
    padding-left: 11px;
}
.nav-sub {
    margin-left: 18px; border-left: 1px solid #0f2a45;
    padding-left: 4px; margin-bottom: 4px;
}
.nav-sub .nav-item {
    font-size: .78rem; font-weight: 400; color: #3a6a8b;
    padding: 6px 10px; margin: 0px 4px;
}
.nav-sub .nav-item:hover { color: #7ec8e3; background: #0a1a30; }
.nav-sub .nav-item.active { color: #7ec8e3 !important; border-left: 2px solid #3498db; }
.nav-divider { border: none; border-top: 1px solid #0f2035; margin: 6px 10px; }
.nav-parent {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 14px; border-radius: 7px;
    font-size: .84rem; font-weight: 600; color: #4a7a9b;
    margin: 1px 6px; cursor: default;
    user-select: none;
}
.nav-parent.active { color: #7ec8e3; }
</style>
"""


def apply():
    st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
html, body, [class*="css"] { font-family:'Inter',sans-serif !important; }

[data-testid="stAppViewContainer"]  { background:#060d18; }
[data-testid="stSidebar"]           { background:#080f1c; border-right:1px solid #0f2035; }
[data-testid="stHeader"]            { background:#060d18; border-bottom:1px solid #0f2035; }
section[data-testid="stSidebarContent"] { padding-top:0 !important; }

[data-testid="stSidebarNavLink"] {
    color:#4a7a9b !important; font-size:.82rem; font-weight:500;
    border-radius:6px; padding:8px 12px !important; transition:all .15s;
}
[data-testid="stSidebarNavLink"]:hover { background:#0f2035 !important; color:#7ec8e3 !important; }
[data-testid="stSidebarNavLink"][aria-current="page"] {
    background:#0d2040 !important; color:#7ec8e3 !important;
    border-left:3px solid #3498db;
}

[data-testid="metric-container"] {
    background:#0a1628; border:1px solid #0f2a45;
    border-radius:8px; padding:14px 16px 10px;
}
[data-testid="stMetricLabel"] { color:#4a7a9b !important; font-size:.72rem; text-transform:uppercase; letter-spacing:.07em; }
[data-testid="stMetricValue"] { color:#e2eaf4 !important; font-size:1.4rem; font-weight:700; }
[data-testid="stMetricDelta"] svg { display:none; }

[data-testid="stTabs"] [role="tablist"] { border-bottom:1px solid #0f2035; gap:2px; }
[data-testid="stTabs"] button[role="tab"] {
    color:#4a7a9b; font-size:.8rem; font-weight:600;
    letter-spacing:.05em; padding:8px 20px; border-radius:4px 4px 0 0;
}
[data-testid="stTabs"] button[aria-selected="true"] {
    color:#7ec8e3 !important; background:#0a1628 !important;
    border-bottom:2px solid #3498db;
}

hr { border-color:#0f2035 !important; margin:10px 0 !important; }

[data-testid="stExpander"] {
    border:1px solid #0f2035 !important; border-radius:8px !important;
    background:#08111f !important;
}

[data-testid="stButton"] > button {
    background:#0d2040; border:1px solid #1e3d60;
    color:#7ec8e3; border-radius:6px; font-size:.8rem; font-weight:600;
}
[data-testid="stButton"] > button:hover {
    background:#1e3d60; border-color:#3498db; color:#fff;
}
[data-testid="stDownloadButton"] > button {
    background:#0d2040; border:1px solid #1e3d60;
    color:#7ec8e3; border-radius:6px; font-size:.8rem; font-weight:600;
}

::-webkit-scrollbar { width:4px; }
::-webkit-scrollbar-track { background:#060d18; }
::-webkit-scrollbar-thumb { background:#1e3d60; border-radius:4px; }
</style>
""", unsafe_allow_html=True)


def sidebar_header():
    """Cabeçalho padrão da sidebar — mantido por compatibilidade. Use sidebar_nav()."""
    with st.sidebar:
        st.markdown("""
        <div style="padding:20px 16px 16px;border-bottom:1px solid #0f2035;margin-bottom:8px">
          <div style="font-size:1.05rem;font-weight:700;color:#e2eaf4;letter-spacing:.04em">
            IMS · Forzy
          </div>
          <div style="font-size:.7rem;color:#2a5a7a;margin-top:3px;letter-spacing:.06em;text-transform:uppercase">
            Industrial Monitoring System
          </div>
        </div>
        """, unsafe_allow_html=True)


def sidebar_nav(current_page: str = ""):
    """
    Navegação lateral customizada com hierarquia pai-filho.
    current_page: 'inicio' | 'dashboard' | 'scada' | 'iot'
    """
    st.markdown(_NAV_HIDE_CSS, unsafe_allow_html=True)

    with st.sidebar:
        # ── Logotipo ─────────────────────────────────────────────────────────
        st.markdown("""
        <div style="padding:20px 16px 16px;border-bottom:1px solid #0f2035;margin-bottom:10px">
          <div style="font-size:1.08rem;font-weight:700;color:#e2eaf4;letter-spacing:.04em">
            IMS · Forzy
          </div>
          <div style="font-size:.68rem;color:#2a5a7a;margin-top:3px;letter-spacing:.08em;text-transform:uppercase">
            Industrial Monitoring System
          </div>
        </div>
        """, unsafe_allow_html=True)

        # ── Início ───────────────────────────────────────────────────────────
        st.markdown('<p class="nav-section-label">Principal</p>', unsafe_allow_html=True)
        st.page_link("1_Inicio.py", label="Início", use_container_width=True)

        # ── Sub-item CSS (links de texto, sem borda/fundo) ───────────────────
        st.markdown("""
        <style>
        div[data-testid="stSidebar"] .dash-subitem button {
            background: transparent !important;
            border: none !important;
            box-shadow: none !important;
            color: #3a6a8b !important;
            font-size: .80rem !important;
            font-weight: 400 !important;
            padding: 4px 10px 4px 28px !important;
            text-align: left !important;
            width: 100% !important;
            border-radius: 5px !important;
            transition: color .15s !important;
        }
        div[data-testid="stSidebar"] .dash-subitem button:hover {
            background: #0a1a30 !important;
            color: #7ec8e3 !important;
        }
        </style>
        """, unsafe_allow_html=True)

        # ── Gestão industrial ─────────────────────────────────────────────────
        st.markdown('<hr class="nav-divider">', unsafe_allow_html=True)
        st.markdown('<p class="nav-section-label">Gestão</p>', unsafe_allow_html=True)
        st.page_link("pages/5_Navegacao.py", label="Navegação", use_container_width=True)
        st.page_link("pages/6_Cadastro.py",  label="Cadastro",  use_container_width=True)
        st.page_link("pages/7_RPA.py",       label="RPA",       use_container_width=True)
        st.page_link("pages/8_Pipeline.py",  label="Pipeline",  use_container_width=True)

        # ── Dashboard (pai + filhos) ──────────────────────────────────────────
        st.markdown('<hr class="nav-divider">', unsafe_allow_html=True)
        st.markdown('<p class="nav-section-label">Análise</p>', unsafe_allow_html=True)
        st.page_link("pages/2_Dashboard.py", label="Dashboard", use_container_width=True)

        _DASH_TABS = [
            (0, "Monitoramento"),
            (1, "Espectral"),
            (2, "Operacional"),
            (3, "Histórico"),
        ]
        for _idx, _label in _DASH_TABS:
            with st.container():
                st.markdown('<div class="dash-subitem">', unsafe_allow_html=True)
                if st.button(_label, key=f"_nav_dash_{_idx}", use_container_width=True):
                    st.session_state["_dash_tab"] = _idx
                    st.switch_page("pages/2_Dashboard.py")
                st.markdown('</div>', unsafe_allow_html=True)

        # ── SCADA e IoT ──────────────────────────────────────────────────────
        st.markdown('<hr class="nav-divider">', unsafe_allow_html=True)
        st.markdown('<p class="nav-section-label">Planta & Sensores</p>', unsafe_allow_html=True)
        st.page_link("pages/3_SCADA.py", label="SCADA",    use_container_width=True)
        st.page_link("pages/4_IoT.py",   label="IoT ESP32", use_container_width=True)

        # ── Rodapé ───────────────────────────────────────────────────────────
        st.markdown('<hr class="nav-divider">', unsafe_allow_html=True)
        st.markdown("""
        <div style="padding:6px 16px 4px">
          <div style="font-size:.62rem;color:#1e4060;letter-spacing:.05em">
            Sprint 3 · Forzy–Promon · 2026
          </div>
        </div>
        """, unsafe_allow_html=True)
