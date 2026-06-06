# IMS · Forzy — Industrial Monitoring System

> **Sprint 2 (completa)** — Visualização operacional, modelo ML de baseline, NLP, sistema coligado de fontes, relatórios CSV/PDF e Modo TV

Sistema de monitoramento industrial de bombas centrífugas construído com Python e Streamlit. Monitora 2 motores com dados históricos do dataset Forzy, análise espectral FFT, visualização SCADA 2D/3D, integração com ESP32 + MPU6050 em tempo real e gestão completa de ativos industriais.

---

## Stack

| Camada | Tecnologia |
|--------|------------|
| Interface | Streamlit 1.45.1 |
| Graficos | Plotly 5+ (WebGL) |
| Dados | Pandas + forzy.csv + SQLite |
| Hardware | ESP32-CAM + MPU6050 (I2C) |
| Serial | PySerial (auto-detect VID/PID) |
| ML / Anomalia | Z-score multivariado (numpy/pandas puro) |
| Relatorios | ReportLab 4+ (PDF) |
| Linguagem | Python 3.10+ |

---

## Como Rodar

```powershell
pip install -r requirements.txt
python -m streamlit run 1_Inicio.py
```

**Com ESP32 conectado:**
```powershell
# Terminal 1 — coletor serial
python Armazenamento_Acelerometro_Bytes_Convertido.py

# Terminal 2 — dashboard
python -m streamlit run 1_Inicio.py
```

Acesse: **http://localhost:8501**

---

## Estrutura de Navegação

```
PRINCIPAL
  Início              — Hub central com KPIs, sparklines e log de eventos

GESTÃO
  Navegação           — Drill-down Planta > Área > Ativo com mapa
  Cadastro            — CRUD completo de ativos industriais
  RPA                 — Automação: associação TAG, status em lote, coleta, auditoria
  Pipeline            — Execução de pipeline, mapeamento geral e simulação OCR

ANÁLISE
  Dashboard
    Monitoramento     — Motor 1 e Motor 2 ao vivo (Dataset Forzy / Ativo / Simulado)
    Espectral         — FFT + espectrograma parametrizado pelo dado real
    Operacional       — Análise histórica completa do dataset Forzy
    Histórico         — Player/timelapse animado
    Baseline ML       — Z-score multivariado, gauge de anomalia, série histórica

PLANTA & SENSORES
  SCADA               — Planta 2D + modelo 3D (STP real) com player
  IoT ESP32           — Leitura ao vivo via USB-Serial
```

---

## Sprint 2 — Visualização Operacional e IA

### Seletor de Fonte Global
Todas as páginas de análise (Dashboard, SCADA, IoT) compartilham um seletor de fonte único:
- **Dataset Forzy** — histórico real de 7.183 amostras, player por frames sincronizado
- **Ativo Cadastrado** — usa leituras IoT reais do ativo selecionado (fallback para Forzy se sem dados)
- **Simulado** — geração sintética com cenários de falha

### Modelo ML de Baseline
- Z-score multivariado calculado sobre o histórico completo do Dataset Forzy
- Gauge de score ao vivo na Tab Baseline ML, sincronizado com a fonte selecionada
- Série histórica do score de anomalia ao longo do dataset
- Limiar configurável: Z < 2 = Normal · 2–3 = Alerta · > 3 = Anomalia

### Busca NLP na Navegação
- Campo de busca textual livre na página de Navegação
- Tokenização e score de relevância por múltiplos campos (código, TAG, fabricante, área, status...)

### Exportação de Relatórios
- Multi-select de 5 tipos de relatório + filtro de período + limiar de anomalia
- Export CSV (UTF-8 BOM, compatível Excel) e PDF (landscape A4, ReportLab)
- Controle de fila: cooldown de 10s entre exports

### Modo TV
- Carrossel automático de abas para telas de chão de fábrica
- Intervalo configurável (5–30s), seleção de quais abas entram no ciclo

### Cadastro Integrado
- Upload de SVG da planta do ativo → renderizado no SCADA 2D
- Dashboard do Ativo abre automaticamente ao criar (JS click na aba)
- Criação de Área inline, sem sair da página

---

## Sprint 3 — Gestão Industrial

### Navegação da Planta
- Drill-down hierárquico: Planta → Área → Ativo
- Card de detalhes do ativo selecionado (specs, status, localização)
- Mapa interativo via `st.map()` com pins coloridos por status operacional
- Últimas leituras do ativo exibidas inline

### Cadastro de Ativos
- Lista com filtros por planta, área, status e busca textual — exporta CSV
- Formulário de criação com todos os campos de plaqueta (kW, V, A, IP, fabricante)
- Formulário de edição com histórico automático de alterações
- Coordenadas GPS opcionais (expander)

### RPA — Automação
- **Associação de TAGs**: vincula TAG + área em múltiplos ativos de uma vez
- **Atualizar Status**: muda status operacional em lote com preview da mudança
- **Coleta de Leitura**: simula coleta de sensores e persiste em `leituras`
- **Log / Auditoria**: histórico completo de execuções e mudanças de dados

### Pipeline
- **Executar Pipeline**: sequência completa com barra de progresso e resumo
- **Mapeamento**: mapa geral de todos os ativos filtrados por status/área
- **Simulação OCR**: gera imagem de plaqueta → extrai campos → valida → aplica ao ativo

---

## Home — Hub Central

A tela inicial atualiza em tempo real (2s / 5s / 10s) com dois modos:

- **Dataset Forzy**: player por frames com barra de progresso, sparklines de janela deslizante
- **Simulado**: geração contínua com cenários de falha (Normal, Desbalanceamento, Cavitação, Desalinhamento)

Componentes da home:
- KPI bar: Disponibilidade, Alarmes, Horas em operação, Tendência, Amostras
- Cards de status Motor 1 / Motor 2 com sparklines (últimos 120 frames)
- Log de eventos — transições de estado extraídas automaticamente do dataset
- Ações rápidas: refresh, exportar CSV, navegação direta

---

## Dashboard Consolidado

### Monitoramento
- Motor 1 e Motor 2 com gauges (velocidade, aceleração, temperatura)
- Health score e banner de status ISO 10816 por motor
- Histórico recente em janela deslizante de 120 frames
- Fonte selecionável: Dataset Forzy / Ativo Cadastrado / Simulado (seletor global acima das tabs)

### Espectral
- FFT com fs=1000 Sa/s, amplitude parametrizada pelo RMS real
- Espectrograma por janelas sequenciais
- Marcação de harmônicas RPM e bandas de falha

### Operacional
- Timeline, análise estatística, comparação M1 × M2, eventos e anomalias

### Histórico
- Player animado com controle de velocidade e scrubbing

### Baseline ML
- Score de anomalia ao vivo calculado via Z-score multivariado
- Evolução histórica do score, Z-scores individuais por variável
- Tabela de estatísticas do baseline (média, desvio, P5, P95)

---

## ESP32 + MPU6050

```
ESP32-CAM (AI Thinker) — COM auto-detectada
MPU6050 (I2C) → AX, AY, AZ (g) + GX, GY, GZ (dps)
Taxa: 5 Sa/s (delay 200 ms no firmware)
Saída serial: AX (g): 0.012 | AY (g): 0.974 | ...
```

O coletor serial salva em `dados/dados_YYYY-MM-DD_HH-MM-SS.csv`. A página IoT lê o CSV mais recente a cada 2s e remove o componente DC de gravidade antes de calcular o RMS dinâmico.

**Importante:** porta aberta com `rts=False, dtr=False` — caso contrário o ESP32 entra em modo bootloader.

---

## Classificação ISO 10816

| Zona | Velocidade RMS | Ação |
|------|---------------|------|
| Normal | < 1,8 mm/s | Operação normal |
| Alerta | 1,8 – 4,5 mm/s | Monitorar, planejar manutenção |
| Alarme | > 4,5 mm/s | Parada imediata recomendada |

---

## Dataset Forzy

`data/forzy.csv` — separador `;`, `skiprows=3`

| Coluna | Unidade | Descrição |
|--------|---------|-----------|
| timestamp | — | Data/hora da medição |
| m1_vel | mm/s | Velocidade RMS Motor 1 |
| m1_acel | g | Aceleração RMS Motor 1 |
| m1_temp | °C | Temperatura Motor 1 |
| m2_vel | mm/s | Velocidade RMS Motor 2 |
| m2_acel | g | Aceleração RMS Motor 2 |
| m2_temp | °C | Temperatura Motor 2 |

Os valores são RMS agregados (~1 Sa/s). A FFT espectral usa esses valores para parametrizar um sinal sintético em 1000 Sa/s.

---

## Licença

Projeto acadêmico — uso livre para fins educacionais.  
Sprint 2 + Sprint 3 completos · Forzy–Promon · 2026
