# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## O que é este projeto

**IMS · Forzy** — dashboard industrial de monitoramento de bombas centrífugas. Site estático (HTML + CSS + JS vanilla, **sem build, sem framework, sem package manager**). Porte do app original Streamlit (preservado em `streamlit-backup/`).

---

## Como rodar

```bash
# Opção 1 — bat (inicia bridge ESP32 + servidor HTTP + abre browser)
ligar_html.bat

# Opção 2 — manual
python -m http.server 8760
# Abre: http://localhost:8760/vision.html
```

**Verificação:** usar `preview_eval` (não screenshot — CDN Lucide trava o *network-idle*). Medir layout em largura ≥ 1440.

### Forçar reload do cache no browser
Os scripts têm query string de versão (`?v=N`) no `vision.html`. Ao editar JS, incremente o `?v=N` do arquivo alterado para garantir que o browser baixe a versão nova. Um F5 normal basta após isso.

### Bridge ESP32 (opcional)
```bash
python serial_bridge.py COM4   # expõe http://localhost:8766/data
```
Necessário apenas se Web Serial API falhar. O `iot.js` tenta auto-conectar ao bridge ao abrir a tela.

### Verificar sintaxe JS (PowerShell)
```powershell
node --check arquivo.js
```

---

## Estrutura de arquivos

```
vision.html          ← única página (todas as telas em divs .screen)
styles.css           ← todos os tokens CSS e estilos (tema dark/light)
app.js               ← roteamento: showScreen() + classes .screen.active
forzy-store.js       ← camada de dados: localStorage chave forzy-db-v3
data/forzy-data.js   ← dataset histórico estático (window.FORZY)
topbar.js            ← topbar: relógio, busca, alertas ISA-18.2 (sininho), menu conta
assistant.js         ← assistente IA flutuante (Groq llama-3.3-70b + visão llama-3.2-11b)
config.js            ← chave de API local — GITIGNORE, nunca commitar
serial_bridge.py     ← bridge Python: porta serial → HTTP :8766
ligar_html.bat       ← inicia bridge + servidor + browser

Telas (um JS por tela):
  inicio.js          ← Início: KPIs ao vivo, sparklines, log, export CSV
  forzy.js           ← Dashboard: Monitoramento/Espectral/Operacional/Histórico/Baseline ML
  cadastro.js        ← Cadastro: CRUD ativos, plantas/áreas, Dashboard do Ativo
  gestao.js          ← Navegação, RPA, Pipeline
  scada.js           ← SCADA: Planta 2D SVG, Vista 3D canvas (mesh real .npy)
  iot.js             ← IoT ESP32: Web Serial + bridge HTTP

data/
  bomba_verts.npy    ← mesh 3D real da bomba (14.932 vértices, float32)
  bomba_faces.npy    ← faces do mesh (21.674 triângulos, int32)
docs/                ← PDFs, Figma refs, screenshots (não servido)
firmware/            ← firmware Arduino do ESP32-CAM + MPU6050
streamlit-backup/    ← versão Streamlit original
```

---

## Arquitetura

### Roteamento
`app.js` controla qual `<div id="screen-X">` tem classe `.active`. Não há hash router — F5 volta para Início. Cada tela tem um `init()` chamado na primeira visita.

### Ordem dos scripts em vision.html
```
forzy-data → forzy-store → forzy → inicio → cadastro → gestao → scada → iot → topbar → app → assistant
```
**Importante:** `topbar.js` carrega antes de `assistant.js`. A topbar chama `checarAlertas()` imediatamente ao iniciar — nesse momento `window.FZAssistant` ainda não existe. Por isso existe o flag `_topbarInicializado` em `topbar.js`: a primeira checagem só estabelece o estado baseline sem disparar a IA.

### Dados (forzy-store.js)
- `window.FZStore` — CRUD sobre `localStorage` (`forzy-db-v3`)
- Seed automático: 2 ativos `BBA-001`/`BBA-002` com `origem:'forzy'` (read-only para IoT)
- Guard: IoT **nunca** grava em ativos com `origem:'forzy'` ou tag `FZ-M*`
- `window.FORZY` — dataset histórico estático vindo de `data/forzy-data.js`

### Dashboard (forzy.js) — fonte de dados
| Fonte | O que usa |
|---|---|
| `forzy` | Dataset histórico `window.FORZY` (frame a frame) |
| `ativo` | Leituras IoT do ativo selecionado via `FZStore.getLeituras()` |
| `sim` | Gerador sintético (gaussiana parametrizada por cenário) |
| `esp32` | Ao vivo via `window.FZIoT.getHist()` (exposto por `iot.js`) |

### IoT ESP32 (iot.js)
- **Web Serial API** (Chrome): `port.open()` + `port.setSignals({dataTerminalReady:false})` imediatamente após para evitar reset do ESP32-CAM via DTR
- **Bridge Python** (`serial_bridge.py`): fallback — pyserial com `dsrdtr=False`, expõe último JSON em `GET /data`
- `window.FZIoT = { isConnected, getHist, getLast }` — exposto globalmente
- `push(r)` — toda leitura passa por aqui. Detecta mudança de `flag` (0→1 ou 0→2) e chama `window.FZAssistant.alertarIoT()` automaticamente
- Botões de teste no card "Hardware Requerido": simulam P2 e P1 para testar push da IA

### Topbar (topbar.js) — Alarmes ISA-18.2
- **Sininho:** verifica alertas a cada **2s** (ESP32 + leituras do store)
- **ISA-18.2 com histerese:** alarme dispara ao cruzar threshold para cima; só limpa quando cai abaixo de `threshold × 0.90` (deadband 10%)
- **Prioridades:** P1 Crítico (vel ≥ 4.5 mm/s / temp ≥ 42°C) · P2 Alto (vel ≥ 1.8 / temp ≥ 35°C)
- **Log:** `logAlarmes[]` registra ATIVADO/NORMALIZADO com timestamp ISO → exportável via "Exportar CSV"
- **Push automático:** `adicionarAlerta()` chama `window.FZAssistant.alertarNotificacao()` a cada novo alarme (após `_topbarInicializado = true`)
- Painéis do sininho e da pessoinha usam `opacity + visibility + transform` com `transition:0.18s` (fade-in/out)

### Assistente IA (assistant.js)
- **Groq** via `fetch` direto do browser — `llama-3.3-70b-versatile` (texto), `llama-3.2-11b-vision-preview` (imagem)
- Chave em `config.js` como `window.FORZY_GEMINI_KEY` (gitignored)
- `perguntarGemini(texto)` gerencia `historico[]` internamente — **não fazer push manual ao historico antes de chamar essa função**
- `window.FZAssistant = { alertarIoT, resetarAlertaIoT, alertarNotificacao }` — API pública para push automático
  - `alertarIoT({ vel, temp, flag, arms })` — disparado pelo `iot.js` em mudança de flag; cooldown por transição
  - `alertarNotificacao({ prioridade, titulo, msg, nivel, valor, unidade })` — disparado pelo `topbar.js`; cooldown 30s
- Bolinha flutuante fixed bottom-right; botão expandir abre painel lateral (estilo VS Code)

### Vista 3D SCADA (scada.js)
- Carrega mesh real da bomba de `data/bomba_verts.npy` + `data/bomba_faces.npy` (parser `.npy` próprio, sem dependências)
- Fallback para mesh paramétrico se os arquivos falharem
- **Back-face culling:** só renderiza faces com normal `n[1] < 0` (câmera olha ao longo de +Y) — reduz ~50% das faces
- **Batching por cor:** faces agrupadas por bucket de cor (`shade(hex, br)` quantizado em 48 níveis) → ~50 `ctx.fill()` calls por frame em vez de ~10k
- **Rotação independente por motor:** `st.yaw1/pitch1` e `st.yaw2/pitch2`; drag detecta metade esquerda/direita do canvas
- **Click sem drag** (`moved: false`) → `showMotorInfo(motorIdx)` exibe painel com vel, accel, temp
- Base do modelo classificada por Z: faces nos 20% inferiores do mesh recebem `group:'base'` (cor `#4a5060`)
- Dois motores desenhados em `W*0.27` e `W*0.73` com label e status colorido por ISO 10816

### Gráficos
SVG/Canvas feitos à mão. Funções principais:
- `lineChart(host, opt)` em `forzy.js` — multi-série com limiares e hover
- `velChart`, `lineChart`, `xyzChart` em `iot.js` — ao vivo com `smooth(arr, w)` (média móvel)
- Cards de temperatura e aceleração em `iot.js` exibem valor numérico atual em destaque no canto
- `gaugeSVG(v, max, a, al, unit)` em `forzy.js` e `cadastro.js`

---

## Convenções

- **Classes CSS:** prefixo `fz-*` para componentes do projeto
- **Tokens:** sempre `var(--token)` — nunca cores fixas. Accent = `--teal`; status = `--fz-ok / --fz-warn / --fz-bad`
- **Toggle knob:** usa `transition` (não `animation`) para não reanimar no re-render via innerHTML
- **CSS novo:** adicionar no fim de `styles.css` em bloco comentado por seção
- **Escape XSS:** usar `esc()` (disponível em cada IIFE) em todo dado de usuário em `innerHTML`
- **Timers:** limpar `setInterval` quando a tela fica inativa (checar `screen.classList.contains('active')`)
- **Dropdowns/painéis:** usar `opacity + visibility + transform` com `transition` para animações — não `display:none/block`

---

## Tema (dark)

```
--bg: #141417        (fundo geral)
--card: #26262c      (cards)
--field: #2f2f36     (inputs)
--teal: #8aa9c9      (accent principal)
--fz-ok: verde       (status Normal)
--fz-warn: amarelo   (status Alerta)
--fz-bad: vermelho   (status Alarme)
```

---

## Normas de referência

### ISO 10816 (motores < 15 kW)
| Condição | Vel. RMS |
|---|---|
| Normal | < 1,8 mm/s |
| Alerta | 1,8 – 4,5 mm/s |
| Alarme | > 4,5 mm/s |

### ISA-18.2:2016 — Gestão de Alarmes
- **P1 Crítico:** vel ≥ 4,5 mm/s ou temp ≥ 42°C → intervenção imediata
- **P2 Alto:** vel ≥ 1,8 mm/s ou temp ≥ 35°C → verificar
- **Histerese (deadband 10%):** alarme só limpa quando valor < threshold × 0,90 (evita flickering)
- **Baseline ML (forzy.js):** Z-score < 2,0 Normal · 2,0–3,0 P2 · ≥ 3,0 P1

---

## ESP32 / Firmware

- **Hardware:** ESP32-CAM AI Thinker + MPU6050 (SDA→GPIO21, SCL→GPIO22)
- **Firmware:** `firmware/esp32_mpu6050_rms/` — envia JSON a ~1 Hz: `{"ax_rms":...,"mag_rms":...,"temp_c":...,"freq_hz":...}`
- **Baud:** 115200
- **Problema DTR:** abrir a porta serial reseta o ESP32-CAM. Fix: `setSignals({dataTerminalReady:false})` após `port.open()` no Web Serial; `dsrdtr=False` no pyserial
- **Velocidade RMS:** `vel = mag_rms * 9806.65 / (2π * freq_hz)` — usa 50 Hz padrão se `freq_hz < 0.5`

---

## Figma
FileKey `RfPNMiutHeo7MPKAs3S4fv` (plano Starter — usar com parcimônia). Refs em `docs/figma_ref/`.
