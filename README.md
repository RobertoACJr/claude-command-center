# Claude Command Center

Painel desktop (Electron + React + TypeScript + Tailwind v4) para gerenciar projetos, scripts e ordens para o Claude Code.

## Rodar em desenvolvimento

```bash
npm install
npm run dev
```

Requisitos: **Node.js 22 LTS** (mínimo 20.19 ou 22.12, exigência do Vite 7) e git no PATH. Confira com `node -v`.

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

## Fase 3: integrações, Telegram e Modo Vigia

Engrenagem no header → **Configurações & Integrações**.

- **MCPs** são registrados pelo próprio CLI (`claude mcp add-json <nome> -` / `claude mcp add`, escopo `user`), com nomes
  `ccc-github`, `ccc-jira`, `ccc-gchat` para não mexer nos seus MCPs. Tokens vão pelo stdin ou por variável de ambiente.
  - GitHub: servidor remoto oficial (`api.githubcopilot.com/mcp`, ou `/readonly`) com PAT.
  - Jira: `uvx mcp-atlassian` com URL + e-mail + API token (precisa do [uv](https://docs.astral.sh/uv/)).
  - Google Chat: **oficial** (`chatmcp.googleapis.com`, OAuth; hoje em Developer Preview do Workspace) ou **personalizado**
    (cole o JSON de outro servidor e diga quais ferramentas são de leitura).
  - Se o app for aberto *de dentro* de uma sessão do Claude Code, o CLI recusa o `add-json` via stdin. Abra por um terminal comum.
- **Tokens** ficam em `secrets.json` (userData), cifrados com o cofre do sistema (DPAPI no Windows, libsecret/kwallet no Linux).
  Os valores nunca voltam para a interface.
- **Telegram**: o app chama `sendMessage` direto (o Claude nunca vê o token). Botões "Detectar" (Chat ID via `getUpdates`) e "Testar".
- **Modo Vigia**: toggle no header, ou automático quando o status vai pra OFF. A cada N minutos:
  `claude -p --tools "" --permission-mode default --allowedTools <leitura do Google Chat> --disallowedTools <escrita>`.
  O Claude devolve JSON; o app deduplica pelo ID da mensagem, cria o alerta, avisa no Telegram e **espera você**:
  "Aprovar e executar" abre o script escolhido com `{{card}}`, `{{branch}}`, `{{ambiente}}`/`{{env}}`, `{{solicitante}}` já preenchidos.

## Fase 4: gerar os instaladores

Gere cada instalador **no próprio sistema** (o .exe no Windows, o .deb/AppImage no Ubuntu).
Gerar o de Windows a partir do Linux exige o Wine, e o contrário não funciona.

```bash
# Ubuntu
npm install
npm run build:linux      # → release/0.1.0/claude-command-center_0.1.0_amd64.deb e .AppImage

# Windows (PowerShell)
npm install
npm run build:win        # → release\0.1.0\claude-command-center-setup-0.1.0.exe
```

- **Ubuntu: prefira o .deb** (`sudo apt install ./release/0.1.0/claude-command-center_0.1.0_amd64.deb`): ele cria o
  atalho no menu de aplicativos. O AppImage precisa do `libfuse2` (`sudo apt install libfuse2t64` no 24.04)
  e, no 24.04, pode esbarrar na restrição do AppArmor ao sandbox do Chromium.
- **Windows:** o instalador não é assinado, então o SmartScreen mostra "O Windows protegeu o computador".
  Clique em *Mais informações → Executar assim mesmo*. Ele cria atalho na área de trabalho e no menu Iniciar.
- `npm run build:unpack` gera só a pasta do app, sem instalador. Serve para testar rápido.
- Ícones em `build/` (fonte: `build/icon.svg`; PNGs em `build/icons/`, `build/icon.ico` para o Windows).
- Seus dados (`config.json`, `secrets.json`) ficam fora do app, na pasta userData. Reinstalar ou atualizar não apaga nada.

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
  main/secrets.ts        cofre de tokens (safeStorage)
  main/mcp.ts            claude mcp add/get/login para GitHub, Jira, Google Chat
  main/telegram.ts       sendMessage / getUpdates
  main/watcher.ts        ciclo do Modo Vigia (só leitura) + alertas
  preload/index.ts       contextBridge → window.api
  renderer/src/
    App.tsx              estado + orquestração
    components/          Header, ProjectsPanel, ScriptsPanel, ConsoleDock, modais
    lib/utils.ts         variáveis {{x}}, caminhos, helpers
```

## Status por fase

- [x] Fase 1: UI, CRUD de projetos/scripts, persistência JSON, detecção de branch, variáveis `{{x}}`, console dock
- [x] Fase 2: execução real (bash/PowerShell, `claude -p` em streaming, Remote Control automático no OFF)
- [x] Fase 3: MCPs (GitHub, Jira, Google Chat), Telegram, Modo Vigia com aprovação
- [x] Fase 4: instaladores (AppImage + .deb para Ubuntu, NSIS .exe para Windows)
