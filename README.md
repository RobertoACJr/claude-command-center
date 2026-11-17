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

## Fase 2: como a execução funciona

- **Terminal**: Linux usa `/bin/bash -lc` (login shell, pega o PATH do nvm/`~/.local/bin`). Windows usa `pwsh` se instalado, senão `powershell.exe`.
  Cada comando roda separado na pasta escolhida (o `cd` não persiste entre comandos; use o seletor de pasta do console).
- **Variáveis `{{x}}` em scripts de terminal** viram variáveis de ambiente (`"${CCC_x}"` no bash, `$env:CCC_x` no PowerShell).
  O valor nunca é colado no comando, então `main; rm -rf ~` é só texto. Limitação: dentro de 'aspas simples' no bash a variável não expande.
- **Claude**: `claude -p --output-format stream-json --verbose`, com o prompt via stdin. No console em modo Claude a conversa continua
  (`--resume`) por pasta; o botão "Nova conversa" zera. Em `-p` o Claude não consegue pedir aprovação: ações que precisam de permissão são bloqueadas e o console avisa.
- **Parar / sair do app**: mata a árvore inteira de processos (grupo de processos + SIGTERM → SIGKILL no Linux, `taskkill /T` no Windows).
- **Remote Control**: com status OFF, sobe `claude remote-control --spawn same-dir --name "<projeto> · Command Center"` em cada projeto marcado,
  captura a URL e mostra no card. Voltar para ON encerra tudo com SIGTERM.
  **Antes do primeiro uso, rode `claude remote-control` uma vez no terminal em cada pasta** e responda `y` (confiança na pasta + ativação):
  sem terminal o CLI não consegue perguntar e sai.
- `CCC_CLAUDE_BIN=/caminho/do/claude` força um executável específico do Claude Code.

## Estrutura

```
src/
  shared/types.ts        tipos compartilhados (Project, Script, AppConfig, API)
  main/index.ts          janela + handlers IPC
  main/store.ts          leitura/escrita atômica do config.json
  main/git.ts            branch atual via git rev-parse
  main/proc.ts           spawn de shell/claude, kill da árvore, split de linhas
  main/runner.ts         execuções (terminal + Claude stream-json)
  main/remote.ts         sessões de Remote Control (reconciliação ON/OFF)
  preload/index.ts       contextBridge → window.api
  renderer/src/
    App.tsx              estado + orquestração
    components/          Header, ProjectsPanel, ScriptsPanel, ConsoleDock, modais
    lib/utils.ts         variáveis {{x}}, caminhos, helpers
```

## Status por fase

- [x] Fase 1: UI, CRUD de projetos/scripts, persistência JSON, detecção de branch, variáveis `{{x}}`, console dock
- [x] Fase 2: execução real (bash/PowerShell, `claude -p` em streaming, Remote Control automático no OFF)
- [ ] Fase 3: MCPs, Telegram, modo vigia
- [ ] Fase 4: instaladores
