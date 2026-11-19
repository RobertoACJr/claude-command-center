# Claude Command Center

Painel desktop para Windows e Ubuntu: seus projetos (rodar, parar, branch), scripts e ações globais,
ordens para o Claude Code e o Gemini, Remote Control, Modo Vigia no Google Chat com aviso e aprovação pelo Telegram.

## Instalar

Baixe o instalador na página de **[Releases](https://github.com/RobertoACJr/claude-command-center/releases/latest)**.

### Ubuntu

1. Baixe o `claude-command-center_X.Y.Z_amd64.deb`.
2. Instale (o `apt` resolve as dependências):
   ```bash
   sudo apt install ./claude-command-center_*_amd64.deb
   ```
3. Abra pelo menu de aplicativos (**Claude Command Center**) ou rode `claude-command-center` no terminal.

Para desinstalar: `sudo apt remove claude-command-center`.

> Também tem o `.AppImage` (não instala nada: `chmod +x` e execute). Ele precisa do `libfuse2`
> (`sudo apt install libfuse2t64` no 24.04) e, no Ubuntu 24.04, pode esbarrar na restrição do AppArmor ao sandbox do
> Chromium. Por isso o `.deb` é o recomendado.

### Windows

1. Baixe o `claude-command-center-setup-X.Y.Z.exe` e execute.
2. O instalador não é assinado, então o Windows mostra **"O Windows protegeu o computador"**:
   clique em **Mais informações → Executar assim mesmo**.
3. Escolha a pasta e conclua. Ele cria atalho na área de trabalho e no menu Iniciar.

Para desinstalar: Configurações → Aplicativos → Claude Command Center.

### Atualizar

Baixe a versão nova e instale por cima (no Ubuntu, o mesmo `sudo apt install ./…deb`). Projetos, scripts, regras e
tokens ficam fora do app e não são apagados.

## O que precisa estar instalado no PC

| Para… | Instale | Confira com |
|---|---|---|
| Tudo que envolve Claude (ordens, Remote Control, Vigia, respostas no chat) | [Claude Code](https://docs.claude.com/en/docs/claude-code) e faça login | `claude --version` |
| Branch dos projetos e scripts git | git | `git --version` |
| Modo Gemini / Vigia com Gemini (opcional) | Gemini CLI, com login ou chave de API | `gemini --version` |
| MCP do Jira (opcional) | [uv](https://docs.astral.sh/uv/) | `uvx --version` |

**Não precisa de Node.js** para usar o app instalado (só para desenvolver).

## Primeiros passos

1. **+ Projeto**: nome, pasta, "Como executar" (ex: `npm run dev`), porta e variáveis (ex: `remote`, `branch_principal`).
2. **+ Ação** (ações globais) ou **+** dentro do card (scripts do projeto). Use `{{variavel}}` e `{{projeto.chave}}`.
3. **Remote Control**: antes do primeiro uso, rode `claude remote-control` uma vez num terminal em cada pasta de projeto
   e responda `y` (confiança na pasta e ativação).
4. **Engrenagem** → Integrações (GitHub, Jira, Google Chat), Telegram, Modo Vigia, Automação.

## Levar a configuração de um PC para outro (Windows ⇄ Ubuntu)

Copie o `config.json` da pasta de dados do app de um PC para o outro (com o app fechado):

- Windows: `%APPDATA%\Claude Command Center\config.json`
- Ubuntu: `~/.config/Claude Command Center/config.json`

Depois, ajuste as **pastas dos projetos** (os caminhos mudam entre Windows e Linux) e informe os **tokens de novo**
em Configurações: o `secrets.json` é cifrado pelo cofre do sistema de cada PC e não funciona em outra máquina.
O caminho exato da pasta de dados aparece na primeira linha da aba *Sistema* dos Terminais.

## Desenvolvimento

Requisitos: **Node.js 22 LTS** (mínimo 20.19 ou 22.12, exigência do Vite 7) e git.

```bash
# Ubuntu (via nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
nvm install 22

# Windows (PowerShell)
winget install OpenJS.NodeJS.LTS
```

```bash
git clone https://github.com/RobertoACJr/claude-command-center.git
cd claude-command-center
npm install
npm run dev          # abre o app em modo desenvolvimento
npm run typecheck    # checagem de tipos
```

### Publicar uma versão nova

Os instaladores são gerados pelo GitHub Actions (`.github/workflows/release.yml`) numa máquina Windows e numa Ubuntu,
passam por um **teste de fumaça** (abre o app empacotado, confere as telas principais, roda um comando no console e
troca para o modo Ausente) e são publicados na página de Releases:

```bash
npm version 0.7.0 --no-git-tag-version   # atualiza o package.json
git commit -am "v0.7.0"
git tag v0.7.0
git push origin main v0.7.0
```

Pela aba **Actions → Instaladores → Run workflow** dá para gerar sem publicar (os arquivos ficam como artefatos do run).
Para gerar localmente: `npm run build:linux` (no Ubuntu) ou `npm run build:win` (no Windows); saem em `release/<versão>/`.

## Como funciona

### Execução (terminal, Claude, Remote Control)

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

### Integrações, Telegram e Modo Vigia

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

### Projetos, terminais, ações globais, modo Ausente e bandeja

- **Projetos executáveis**: no cadastro, "Como executar" (ex: `npm run dev`) e, opcionalmente, a porta.
  O card mostra ▶ Executar / ■ Parar / ↻ Reiniciar e o estado: *Rodando há X · :porta*, *Parado*, *Caiu (código N)*
  ou *Rodando fora do app* (a porta já estava ocupada por outro processo). Se o projeto cair, aparece uma notificação.
- **Terminais em abas**: botão **Terminais** na barra de baixo. Abas fixas *Console*, *Claude* e *Sistema*
  (logs do Vigia, MCPs, Telegram), mais uma aba por projeto em execução e uma por script. Cada aba tem parar,
  copiar log, limpar e tela cheia. Ctrl+C no campo de comando para a aba ativa.
- **Scripts do projeto × ações globais**:
  - *Scripts do projeto* ficam dentro do card do projeto (botão + no card).
  - *Ações globais* (coluna da direita) perguntam o projeto na hora de rodar.
  - *Variáveis do projeto* (no cadastro): `branch_principal = master`, `remote = xxx`… Use `{{projeto.chave}}`
    no script; `{{projeto.nome}}` e `{{projeto.pasta}}` sempre existem. Se o projeto não tiver a variável, o app avisa antes de rodar.
  - Exemplo de ação global "Subir card em beta": `git fetch {{projeto.remote}} && git push {{projeto.remote}} {{card}}:{{projeto.branch_beta}}`
  - Botão **Duplicar** em qualquer script.
- **Remote Control por projeto**: switch "Remote" no card liga/desliga a qualquer hora. O toggle do cadastro agora
  significa "ligar automaticamente no modo Ausente".
- **Modo Ausente** (azul-petróleo): liga o Vigia e o Remote Control automático, com uma faixa mostrando desde quando.
  Ao voltar para Online com sessões remotas abertas, o app pergunta se encerra ou mantém.
- **Bandeja**: fechar a janela mantém o app rodando ao lado do relógio (Vigia, Remote Control e projetos continuam).
  O menu do ícone tem Online/Ausente, Vigia, pedidos pendentes e *Sair*. Em Configurações → Geral: desligar isso e
  "Abrir junto com o sistema" (só no app instalado). No Ubuntu/GNOME o ícone precisa da extensão AppIndicator
  (já vem no Ubuntu).

### Vigia 2.0, automação e Gemini

- **Gemini CLI** como segunda IA (Configurações → IAs): modo *Gemini* no console, scripts "Ordem para o Gemini" e
  Vigia com Gemini (poupa os tokens do Claude). Sem terminal, o Gemini nega sozinho tudo que pediria aprovação.
  - Vigia com Gemini: carrega só o servidor `ccc-gchat` (`--allowed-mcp-server-names`) e o app escreve
    `~/.gemini/policies/claude-command-center.toml` liberando só as ferramentas de leitura (e negando o envio),
    valendo só para execuções sem terminal.
  - "Preparar Google Chat no Gemini" registra o `ccc-gchat` no Gemini a partir do JSON do modo personalizado.
    No modo oficial (OAuth do Google), configure no próprio Gemini com o nome `ccc-gchat`.
  - Atenção: para contas gratuitas/Google One, o Google trocou o Gemini CLI pelo Antigravity CLI (jun/2026).
- **Resumo melhor**: cada pedido vem com resumo de uma frase, o que faltou, urgência e o projeto citado
  (associado ao projeto cadastrado pelo nome ou pela variável `apelidos`).
- **Respostas cadastradas** (Configurações → Automação): textos com `{{solicitante}} {{card}} {{branch}} {{ambiente}} {{projeto}}`.
  Envio manual pelo card do pedido, automático ao detectar ("Recebido"), ou ao aprovar (por regra).
  O envio usa o Claude com uma única ferramenta liberada (a de enviar mensagem); o texto é montado pelo app.
- **Regras**: ambiente(s) + projeto → script, com três modos: só sugerir, botão "Aprovar e rodar" no Telegram,
  ou rodar sozinho. **Trava fixa:** ambientes que parecem produção (prod, produção, prd, live, main, master)
  nunca rodam sozinhos nem pelo Telegram. E o script só roda se todas as variáveis estiverem preenchidas.
- **Telegram com botões e comandos**: ✅ Aprovar / 🗑 Descartar / ▶ Aprovar e rodar; o app edita a mensagem com o
  desfecho e avisa quando o script termina. Comandos: `/status`, `/pendentes`, `/ausente`, `/online`, `/vigia`.
  Só o Chat ID configurado é obedecido. O bot usa long polling (se outro programa já lê o bot, ele pausa e avisa).

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
  main/projects.ts       execução dos projetos (▶/■), monitor de porta
  main/tray.ts           ícone na bandeja + abrir com o sistema
  main/gemini.ts         Gemini CLI: política só-leitura, registrar ccc-gchat, args do Vigia
  main/automation.ts     pedidos: Telegram, respostas, regras, trava de produção
  shared/vars.ts         variáveis, associação de projeto, regras (usado pelo main e pela interface)
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
- [x] Fase 5: projetos executáveis, terminais em abas, scripts de projeto + ações globais, Remote Control por projeto, modo Ausente, bandeja
- [x] Fase 6: Vigia 2.0 (resumo melhor, respostas cadastradas, regras automáticas, Telegram com botões) + Gemini
- [x] Fase 7 (parte 1): instaladores no GitHub Actions + Releases
- [ ] Fase 7 (parte 2): atualização automática
