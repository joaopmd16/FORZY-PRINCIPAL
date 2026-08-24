# Sprint 3 — O que falta fazer

## Nova aba: Navegação
- Drill-down: Planta > Área > Ativo
- Card do ativo com specs (kW, tensão, IP, status)
- Mapa com pin do ativo (sem API key)

## Nova aba: Cadastro
- Lista de ativos com filtros
- Formulário para criar ativo novo
- Formulário para editar ativo existente
- Exportar lista em CSV

## Nova aba: RPA
- Associar TAG + área em lote
- Mudar status de vários ativos de uma vez
- Simular coleta de leitura dos sensores
- Ver log de execuções e histórico de mudanças

## Nova aba: Pipeline
- Rodar pipeline completo (coletar → validar → gravar)
- Mapa com todos os ativos coloridos por status
- Simulação de OCR: faz upload de foto de plaqueta, extrai os dados, confirma e grava

## O que muda nos arquivos existentes
- `database.py` — novas tabelas: plantas, areas, ativos, leituras, logs
- `utils/theme.py` — 4 novos itens no menu lateral
- Nova pasta `rpa/` com a lógica de automação separada
