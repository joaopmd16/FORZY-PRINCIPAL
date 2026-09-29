# IMS · Forzy — Industrial Monitoring System

> **Sprint 2 completa** — Visualização operacional, drill-down hierárquico, baseline ML, IoT ESP32, OCR de placa por IA, assistente conversacional com chat por ativo (OpenAI gpt-4o-mini)

Sistema de monitoramento industrial de bombas centrífugas. Dashboard **HTML + CSS + JS vanilla** (zero framework, zero build). Monitora 1 motor (2 eixos) com dados históricos do dataset Forzy, análise espectral FFT, SCADA 2D/3D, integração com ESP32 + MPU6050 em tempo real, gestão de ativos e IA conversacional.

---

## Integrantes

Projeto acadêmico FIAP × Forzy-Promon.

| Nome | RM |
|---|---|
| Arthur Baptista dos Santos | 565346 |
| João Pedro de Moura Dutra Franco | 561738 |
| Nelson Félix Neto | 565603 |
| Pietro Boroto Rodrigues | 562407 |
| Vitor Soares Gonçalves | 566181 |

---

## Stack

| Camada | Tecnologia |
|--------|------------|
| Interface | HTML5 + CSS3 + JS vanilla (sem framework) |
| Gráficos | SVG + Canvas feitos à mão |
| Dados | localStorage (`forzy-db-v3`) + dataset estático `forzy-data.js` |
| Hardware | ESP32-CAM + MPU6050 (I2C) via Web Serial API |
| ML / Anomalia | Z-score multivariado (JS puro) |
| IA Conversacional | OpenAI — `gpt-4o-mini` |
| IA Visão (OCR) | OpenAI — `gpt-4o-mini` (multimodal) |
| Normas | ISO 10816 · ISA-18.2:2016 |

---

## Como Rodar

```powershell
# Inicia bridge ESP32 + servidor HTTP + abre browser
.\ligar_html.bat

# Ou manualmente:
python -m http.server 8760
# Acesse: http://localhost:8760/vision.html
```

### Bridge ESP32 (opcional)
```powershell
python serial_bridge.py COM4   # expõe http://localhost:8766/data
```

### Configurar chave de API (OpenAI)
Edite `config.js` (gitignored, precisa ser recriado a cada novo ambiente):
```js
window.FORZY_OPENAI_KEY = 'sk-sua-chave-aqui';
```
Obtenha em [platform.openai.com](https://platform.openai.com/api-keys).

---

## Estrutura de Navegação

Sidebar enxuta (6 itens), com grupos que abrem sub-abas internas:

```
Início               — Hub central com KPIs, sparklines e log de eventos
Monitoramento        — Dashboard: Monitoramento / Histórico / Baseline ML
SCADA                — Planta 2D SVG + modelo 3D (mesh real .npy) com rotação
Ativos               — Lista de Ativos (CRUD + OCR de placa por IA) · Plantas & Áreas (drill-down)
Sensores & Automação — IoT ao Vivo (ESP32) · RPA · Pipeline (execução, mapeamento, OCR com IA)
Assistente IA        — Chat técnico com conversa dedicada por ativo (contexto injetado automaticamente)
```

---

## Navegação Drill-down (Sprint 2 — foco professor)

A tela **Navegação** implementa o fluxo hierárquico pedido pela Forzy:

```
Fábricas
  └── Planta (ex: Bancada Forzy)
        └── Área / Seção (ex: Sala de Máquinas)
              └── Equipamento (ex: BBA-001 — Bomba Principal)
                    └── Sensores ao vivo:
                          • Vibração RMS (gráfico temporal + ISO 10816)
                          • Temperatura · Corrente · Aceleração
                          • Score de anomalia baseline ML (Z-score)
                          • Localização no mapa
```

Em cada nível: cards clicáveis com status colorido (verde/amarelo/vermelho), contagem de ativos e distribuição de saúde. Breadcrumb no topo permite voltar a qualquer nível. A busca NLP no topo permite acesso direto a qualquer ativo pelo nome, TAG, fabricante ou status.

---

## OCR de Placa por IA

No cadastro de novo ativo (e na tela Pipeline), o botão de envio de foto manda a imagem da plaqueta para o `gpt-4o-mini` (OpenAI, visão) e extrai automaticamente:

- TAG / código do motor
- Fabricante, tipo de motor
- Potência (kW), tensão (V), corrente nominal (A)
- Grau de proteção IP, RPM, frequência, ligação, fator de potência

Os campos do formulário são preenchidos automaticamente. O usuário revisa e confirma antes de salvar.

---

## Arquitetura de Arquivos

```
vision.html          ← única página (todas as telas em divs .screen)
styles.css           ← tokens CSS + estilos (tema dark/light)
app.js               ← roteamento: showScreen() + classes .screen.active
nav-v2.js            ← sidebar enxuta + breadcrumb (roda ao lado do app.js)
forzy-store.js       ← camada de dados: localStorage (forzy-db-v3)
data/forzy-data.js   ← dataset histórico estático (window.FORZY)
topbar.js            ← topbar: relógio, busca, alertas ISA-18.2 (sininho)
assistant.js         ← assistente IA (fallback bolinha flutuante; cede lugar à tela dedicada)
assistente-screen.js ← tela dedicada "Assistente IA" — conversa por ativo + geral (gpt-4o-mini)
config.js            ← chave de API — GITIGNORE, nunca commitar

Telas:
  inicio.js          ← Início: KPIs ao vivo, sparklines, log, export CSV
  forzy.js           ← Dashboard: Monitoramento/Histórico/Baseline ML
  cadastro.js        ← Cadastro: CRUD ativos, OCR de placa, Dashboard do Ativo
  gestao.js          ← Navegação drill-down, RPA, Pipeline (OCR com IA de visão)
  scada.js           ← SCADA: Planta 2D SVG, Vista 3D canvas (mesh real .npy)
  iot.js             ← IoT ESP32: Web Serial + bridge HTTP

data/
  forzy-data.js      ← 7.183 amostras de vibração/temp/aceleração
  bomba_verts.npy    ← mesh 3D real da bomba (14.932 vértices, float32)
  bomba_faces.npy    ← faces do mesh (21.674 triângulos, int32)

firmware/            ← firmware Arduino do ESP32-CAM + MPU6050
streamlit-backup/    ← versão Streamlit original (referência)
```

---

## ESP32 + MPU6050

```
Hardware: ESP32-CAM AI Thinker + MPU6050 (SDA→GPIO21, SCL→GPIO22)
Firmware: firmware/esp32_mpu6050_rms/
Baud: 115200
Output: {"ax_rms":...,"mag_rms":...,"temp_c":...,"freq_hz":...} a ~1 Hz
```

**Velocidade RMS:** `vel = mag_rms × 9806.65 / (2π × freq_hz)`

**Problema DTR:** após `port.open()`, chama `setSignals({dataTerminalReady:false})` para evitar reset do ESP32-CAM.

---

## Classificação ISO 10816 (motores < 15 kW)

| Condição | Vel. RMS | Ação |
|---|---|---|
| Normal | < 1,8 mm/s | Operação normal |
| Alerta | 1,8 – 4,5 mm/s | Monitorar, planejar manutenção |
| Alarme | > 4,5 mm/s | Parada imediata recomendada |

## Alarmes ISA-18.2:2016

- **P1 Crítico:** vel ≥ 4,5 mm/s ou temp ≥ 42 °C
- **P2 Alto:** vel ≥ 1,8 mm/s ou temp ≥ 35 °C
- **Histerese 10%:** alarme limpa só quando valor < threshold × 0,90

---

## Licença

Projeto acadêmico FIAP × Forzy-Promon — uso educacional.
Sprint 1 + Sprint 2 completos · 2026
