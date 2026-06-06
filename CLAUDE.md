# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## IMS · Forzy Industrial Monitoring System

Sistema de monitoramento industrial de bombas centrífugas — Python + Streamlit. Sprints 2 e 3 completos.

## Como Rodar

```powershell
pip install -r requirements.txt
python -m streamlit run 1_Inicio.py
# → http://localhost:8501
```

Com ESP32 conectado:
```powershell
# Terminal 1 — coletor serial (manter rodando)
python Armazenamento_Acelerometro_Bytes_Convertido.py

# Terminal 2 — app
python -m streamlit run 1_Inicio.py
```

## Arquitetura

Streamlit multi-página com navegação lateral **customizada** — nav padrão oculto via CSS. Toda página deve chamar:

```python
from utils.theme import apply as _apply_theme, sidebar_nav as _snav
_apply_theme(); _snav("inicio")
# chaves válidas: "inicio","dashboard","scada","iot","navegacao","cadastro","rpa","pipeline"
```

**Nunca** usar `sidebar_header()` — foi substituída por `sidebar_nav()`.

Ordem das seções na sidebar: **Principal → Gestão → Análise → Planta & Sensores**

## Páginas (`pages/`)

| Arquivo | Função |
|---|---|
| `2_Dashboard.py` | 5 tabs: Monitoramento, Espectral, Operacional, Histórico, Baseline ML |
| `3_SCADA.py` | Planta 2D (bomba.png + SVG do ativo) + Vista 3D (modelo STP tessellado) |
| `4_IoT.py` | ESP32 real (USB) ou Simulado; injeta leituras do ativo selecionado |
| `5_Navegacao.py` | Drill-down Planta → Área → Ativo + mapa + busca NLP textual livre |
| `6_Cadastro.py` | CRUD ativos + Dashboard do Ativo (abre automaticamente ao criar) + SVG upload |
| `7_RPA.py` | Automação: TAG em lote, status, coleta de sensores, auditoria |
| `8_Pipeline.py` | Pipeline OCR de plaqueta, mapeamento geral, simulação |

Arquivos com prefixo `_` são backups do Sprint 1 — ocultos do nav, não editar.

## Seletor de Fonte Global (`utils/fonte.py`)

**Peça central do sistema coligado.** Dashboard, SCADA e IoT compartilham o mesmo seletor via:

```python
from utils.fonte import render_fonte_selector, FONTE_FORZY, FONTE_ATIVO, FONTE_SIMULADO
dados = render_fonte_selector(key_prefix="pagina_unica")
# dados["fonte"] | dados["leitura"] | dados["historico"] | dados["ativo"] | dados["svg"] | dados["timestamp"]
```

- **Dataset Forzy**: lê `data/forzy.csv`, usa `st.session_state["mon_fidx"]` para sincronizar com o player
- **Ativo Cadastrado**: lista `ativos_industrial`, lê `db.get_leituras()`, fallback silencioso para Forzy se sem dados IoT
- **Simulado**: gaussiano seed por timestamp

No Dashboard o seletor fica **acima** do `st.tabs()` — nunca dentro de uma tab individual.

SVGs dos ativos: `data/svg/{codigo}.svg` — criados via upload no Cadastro.

## Dashboard (`pages/2_Dashboard.py`)

Troca de tab via `st.query_params["tab"]` + JS click. Sub-itens da sidebar usam `st.session_state["_dash_tab"]` + `st.switch_page`.

Acima das tabs: dois expanders — **Modo TV** (carrossel automático, JS click por intervalo) e **Exportar Relatório** (CSV/PDF, cooldown 10s em `st.session_state["rp_last_export"]`).

- **Tab 0 — Monitoramento**: Player por frames. Autorefresh só ativo quando `_active_tab == 0`. Motor 1 e Motor 2 com gauges + histórico deslizante.
- **Tab 1 — Espectral**: FFT sintética fs=1000 Sa/s, amplitude parametrizada pelo RMS real. Espectrograma + harmônicas.
- **Tab 2 — Operacional**: Sub-tabs Timeline, Análise, Comparação, Eventos, Estatísticas.
- **Tab 3 — Histórico**: Player/timelapse animado.
- **Tab 4 — Baseline ML**: Gauge de Z-score ao vivo (usa `_leitura_mon` do seletor global), série histórica, Z-scores por variável, tabela de estatísticas.

## Modelo ML de Baseline (`utils/baseline_model.py`)

Z-score multivariado puro (numpy/pandas, sem sklearn) sobre 7.183 amostras do Dataset Forzy.

```python
bl    = computar_baseline()                          # mean/std/p5/p95 por variável
zs    = zscore_leitura(leitura_dict, bl)             # {col: z_score}
score, classe, cor = classificar_anomalia(zs)        # score=max(Z), classe=Normal/Alerta/Anomalia
df    = score_serie_historica(n_pontos=400)           # DataFrame com timestamp, score, classe, z_col...
```

Limiar: Z < 2.0 = Normal · 2.0–3.0 = Alerta · > 3.0 = Anomalia.

## Exportação de Relatórios (`utils/relatorio.py`)

```python
dfs      = gerar_relatorios(tipos, inicio_dt, fim_dt, limiar_z)  # dict[str, DataFrame]
csv_b    = exportar_csv(dfs)   # bytes UTF-8 BOM (Excel-safe)
pdf_b    = exportar_pdf(dfs, inicio_dt, fim_dt)                  # bytes PDF landscape A4
```

5 tipos: `"Resumo Operacional (Motores)"`, `"Anomalias Detectadas (Baseline ML)"`, `"Ativos Cadastrados"`, `"Leituras IoT"`, `"Estatísticas por Período"`.

## Banco de Dados (`database.py`)

SQLite em `data/motores.db`. Duas camadas independentes:

**IoT/ESP32 (`leituras`)** — colunas relevantes: `ativo_id, vibracao_mm_s, temperatura_c, corrente_a, ax_rms, ay_rms, az_rms, mag_rms, coletado_em, flag_anomalia, hash_registro`

**Gestão Industrial** — tabelas: `plantas`, `areas`, `ativos_industrial` (specs completo + GPS), `log_execucoes` (RPA), `historico_atualizacoes` (auditoria)

**Ciclo IoT→DB fechado**: quando ESP32 Real está online E `_ativo_iot` está selecionado na página IoT, cada leitura nova é salva via `database.insert_leitura(codigo, dados)`. O dedupe usa `st.session_state[f"iot_saved_{codigo}"]` comparando o timestamp da última linha do CSV. Depois disso, Dashboard do Ativo e Navegação mostram o histórico real automaticamente.

Funções públicas: `get_plantas()`, `get_areas(planta_id?)`, `get_ativos_industrial(area_id?, status?)`, `get_ativo_por_codigo()`, `criar_ativo_industrial(dados)`, `editar_ativo_industrial(codigo, dados)`, `get_leituras(ativo_id, limit)`, `log_execucao()`, `get_logs(limit)`, `get_historico(limit)`.

Banco **não tem seed** — dados criados pelo usuário via Cadastro.

## Módulos RPA (`rpa/`)

- `tag_association.py` — associa TAG + área em lote, registra `log_execucao`
- `record_updater.py` — atualiza status em lote, simula coleta de sensores → `leituras`
- `nameplate_pipeline.py` — gera imagem de plaqueta (Pillow), simula OCR, valida campos

## Cadastro (`pages/6_Cadastro.py`)

4 tabs: Lista, Novo Ativo, Editar Ativo, **Dashboard do Ativo**.

- Seletores Planta e Área ficam **fora do `st.form`** (reativos — mudar planta filtra áreas na hora)
- Expander "Criar nova Área" inline sem sair da página
- Upload SVG → `data/svg/{codigo}.svg` → SCADA lê automaticamente
- Ao criar ativo com sucesso: JS `tabs[3].click()` abre Dashboard do Ativo
- Dashboard do Ativo: card + gráfico leituras IoT (fallback Forzy) + gauge ML + histórico de auditoria

## Dados

### Dataset Forzy (`data/forzy.csv`)
- Separador `;`, 3 linhas de cabeçalho → `skiprows=3`
- Colunas usadas: `[0,3,4,5,6,7,8]` → `timestamp | m1_vel | m1_acel | m1_temp | m2_vel | m2_acel | m2_temp`
- Unidades: velocidade **mm/s**, aceleração **g**, temperatura **°C**
- Valores são RMS agregados (~1 Sa/s) — **nunca fazer FFT direta neles**

### Limiares ISO 10816
| Zona | Vel RMS |
|---|---|
| Normal | < 1,8 mm/s |
| Alerta | 1,8–4,5 mm/s |
| Alarme | > 4,5 mm/s |

## Modelo 3D (SCADA)

Arrays pré-computados em `data/bomba_verts.npy` (float32, 14.932 vértices) e `data/bomba_faces.npy` (int32, 21.674 faces). Faces com Z ≤ -1.8 = base azul `#1e3d5c`; acima = máquina verde.

Re-gerar se o STP mudar:
```python
import cadquery as cq, numpy as np
shape = cq.importers.importStep(r"C:\Users\gel\Downloads\ChallengeForzy-bomba-teste.stp")
verts, faces = shape.val().tessellate(0.08)
V = np.array([[v.x,v.y,v.z] for v in verts]); V -= V.mean(axis=0)
V *= 10.0/(V.max()-V.min())
np.save("data/bomba_verts.npy", V.astype(np.float32))
np.save("data/bomba_faces.npy", np.array(faces).astype(np.int32))
```

## Tema e CSS

**Nunca** adicionar CSS inline em páginas individuais sem verificar `utils/theme.py`. Sem emojis — decisão de estilo do Sprint 2.

```
fundo app:        #060d18    fundo card:   #0a1628    borda card:  #0f2a45
fundo sidebar:    #080f1c    texto prim:   #e2eaf4    texto sec:   #4a7a9b
azul accent:      #3498db / #7ec8e3
Normal/Ativo:     #2ecc71    Alerta/Manu:  #f39c12    Alarme/Inat: #e74c3c
```

## Performance — Regras

- **Nunca** `shape="spline"` ou `smoothing` em gráficos com > 500 pontos
- **Usar `go.Scattergl`** (WebGL) para séries temporais longas
- **Máx 3.000 pontos** nos gráficos — usar downsample
- **`fillcolor` no Plotly** não aceita hex com alpha — usar `rgba(r,g,b,a)` sempre
- **`yaxis`** não pode estar no dict compartilhado E no `update_layout` — causa `multiple values for keyword argument`
- Valores numéricos vindos de fontes externas (IoT, ativo) podem ser NaN — sempre proteger com `float(v) if v==v else default`

## Modos de Falha Simulados (`utils/mock_data.py`)

| Modo | Assinatura |
|---|---|
| `normal` | 1x RPM pequeno, ruído baixo |
| `desbalanco` | 1x RPM dominante (±12%) |
| `cavitacao` | Banda larga + sub-harmônica |
| `desalinhamento` | 2x RPM dominante |

## ESP32 — Fluxo de Dados Real

Firmware em `firmware/esp32_mpu6050_rms/` — saída 115200 baud:
```
AX (g): 0.012 | AY (g): 0.974 | AZ (g): 0.195 || GX (°/s): -2.3 | ...
```
Placa: AI Thinker ESP32-CAM, MPU6050 em I2C, 5 amostras/segundo (`delay(200)`).

Coletor serial (`Armazenamento_Acelerometro_Bytes_Convertido.py`):
- Auto-detecta porta via VID/PID: CH340, CH343, CP210x, FTDI
- Salva em `dados/dados_YYYY-MM-DD_HH-MM-SS.csv`
- **CRÍTICO**: abrir porta com `rts=False, dtr=False` — sem isso ESP32 entra em bootloader

Página IoT lê o CSV mais recente de `dados/` a cada 2s. DC removido antes do RMS: `ax_ac = ax - ax.mean()`.

## Mapa

`5_Navegacao.py` e `8_Pipeline.py` usam `st.map()` nativo com colunas `lat`, `lon`, `color` (lista RGBA `[R,G,B,A]`), `size`. Não usar `plotly scatter_mapbox` — causa problema visual.

## Dependências Principais

```
streamlit==1.45.1     # NÃO atualizar — 1.46+ quebra com starlette
plotly>=5.20.0
pandas>=2.0.0
numpy>=1.26.0
cadquery>=2.7.0
Pillow
streamlit-autorefresh
pyserial
reportlab>=4.0.0
```
