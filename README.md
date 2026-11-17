# Claude Command Center

Painel desktop (Electron + React + TypeScript + Tailwind v4) para gerenciar projetos, scripts e ordens para o Claude Code.

## Rodar em desenvolvimento

```bash
npm install
npm run dev
```

Requisitos: Node.js 20+ e git no PATH.

## Onde ficam os dados

`config.json` na pasta `userData` do Electron:

- Windows: `%APPDATA%\claude-command-center\config.json`
- Linux: `~/.config/claude-command-center/config.json`

O caminho exato aparece na primeira linha do console do app.

## Estrutura

```
src/
  shared/types.ts        tipos compartilhados (Project, Script, AppConfig, API)
  main/index.ts          janela + handlers IPC
  main/store.ts          leitura/escrita atômica do config.json
  main/git.ts            branch atual via git rev-parse
  preload/index.ts       contextBridge → window.api
  renderer/src/
    App.tsx              estado + orquestração
    components/          Header, ProjectsPanel, ScriptsPanel, ConsoleDock, modais
    lib/utils.ts         variáveis {{x}}, caminhos, helpers
```

## Status por fase

- [x] Fase 1: UI, CRUD de projetos/scripts, persistência JSON, detecção de branch, variáveis `{{x}}`, console dock (execução **simulada**)
- [ ] Fase 2: execução real (`child_process.spawn`, `claude -p`, Remote Control no OFF)
- [ ] Fase 3: MCPs, Telegram, modo vigia
- [ ] Fase 4: instaladores
