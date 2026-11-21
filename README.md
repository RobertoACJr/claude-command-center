# Hélice

*(antes Claude Command Center)*

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

O app procura versões novas nas Releases a cada 4 horas, baixa sozinho e mostra **"Reiniciar e atualizar"** (ele nunca
reinicia sozinho; também instala ao sair pelo menu da bandeja). No Ubuntu (.deb) a instalação pede sua senha.
Requisitos: repositório público e a release publicada com os arquivos `latest*.yml` (o workflow já anexa).
Também dá para baixar a versão nova e instalar por cima (no Ubuntu, o mesmo `sudo apt install ./…deb`). Projetos, scripts, regras e
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

O assistente **Configurações → Começar** abre sozinho na primeira vez: ele confere o que está instalado (Claude Code
e login, git, gh, Gemini, Codex, uv), mostra o comando para instalar cada um e tem guias passo a passo de Remote
Control, Telegram, GitHub, Jira e Google Chat.

1. **+ Projeto**: nome, pasta, "Como executar" (ex: `npm run dev`), porta e variáveis (ex: `remote`, `branch_principal`).
2. **+ Ação** (ações globais) ou **+** dentro do card (scripts do projeto). Use `{{variavel}}` e `{{projeto.chave}}`.
3. **Remote Control**: antes do primeiro uso, rode `claude remote-control` uma vez num terminal em cada pasta de projeto
   e responda `y` (confiança na pasta e ativação).
4. **Engrenagem** → Integrações (GitHub, Jira, Google Chat), Telegram, Modo Vigia, Automação.

## Levar a configuração de um PC para outro (Windows ⇄ Ubuntu)

Em **Configurações → Geral → Levar a configuração para outro PC**: *Exportar…* num PC e *Importar…* no outro.
Ou copie o `config.json` da pasta de dados do app (com o app fechado):

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

### Testes

```bash
npm test            # todos
npm test -- fila    # só os arquivos com "fila" no nome (ex: queue)
```

Testam os módulos do processo principal sem abrir o app (git com repositórios reais, Jira e Telegram com servidores
falsos, um Claude falso). O CI roda os testes e depois um teste de fumaça que abre o app empacotado.

## Publicar uma versão nova

Os instaladores são gerados pelo GitHub Actions (`.github/workflows/release.yml`) numa máquina Windows e numa Ubuntu,
passam por um **teste de fumaça** (abre o app empacotado, confere as telas principais, roda um comando no console e
liga o Remote Control com um Claude falso, troca para o modo Ausente) e são publicados na página de Releases:

**É só subir a versão no `package.json` e dar push na `main`:** quando o workflow vê que ainda não existe
Release para aquela versão, ele cria a `v<versão>` sozinho com os instaladores (e o app de quem já instalou
se atualiza a partir dela). Push sem mudar a versão só gera e testa, sem publicar.

```bash
npm version 0.9.0 --no-git-tag-version   # atualiza o package.json
git commit -am "v0.9.0"
git push origin main
```

Também funciona enviar uma tag (`git tag v0.9.0 && git push origin v0.9.0`) ou criar a Release pela página do GitHub.

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
  desfecho e avisa quando o script termina. Só o Chat ID configurado é obedecido. O bot usa long polling
  (se outro programa já lê o bot, ele pausa e avisa).
- **O celular é o Telegram** (mande `/ajuda` no bot):
  - `/projetos`: estado de cada projeto com botões ▶/■, 📡 Remote (o link chega no chat), 📜 log e 🤖 Claude ali.
  - `/rodar`: scripts e ações globais; escolhe o projeto, pergunta as variáveis no chat e confirma antes de rodar.
    O resultado (com as últimas linhas) chega quando termina.
  - `/claude`: escolhe o projeto; depois, qualquer texto vira ordem para o Claude, com conversa contínua (`/novo`
    começa outra). Pedidos de permissão chegam com botões. `/parar` interrompe.
  - `/log [nome]`, `/historico`, `/status`, `/pendentes`, `/ausente`, `/online`, `/vigia`.
  - No modo Ausente, os avisos do sino (projeto caiu, script terminou, Vigia, atualização) também vão para lá.
- **Demandas** (no card do projeto): número do card do Jira → o app puxa título, descrição e comentários; você cola o
  contexto do chat e a transcrição da apresentação. A IA (Claude, ChatGPT ou Gemini) analisa **só lendo** o código:
  entendimento, o que muda, dúvidas para o refinamento, riscos e estimativa em horas. Depois desenha a solução
  (editável, você aprova) e o Claude implementa numa conversa própria da demanda, na branch com o nome do card.
  Dá para continuar pelo Telegram: `/demanda WEB-482 o botão ficou desalinhado`.
- **Git no card**: o chip da branch mostra alterados, ↑ sem push / ↓ novos no remoto e o último commit; clique para
  puxar, ver diferenças ou trocar de branch. Ao ir para Ausente, o app avisa o que ficou sem commit ou sem push.
  Na demanda, **Atualizar com a master** (usa a variável `branch_principal` do projeto, ou a padrão do remoto).
- **Guias do projeto** (no formulário do projeto, ex: `docs/STYLE_GUIDE.md`): o Claude é instruído a ler e seguir em
  tudo que fizer naquele projeto, e as Demandas levam o conteúdo do guia na análise, no desenho e na implementação.
- **Fila de tarefas** (ícone de lista no topo, `/fila` no Telegram ou "Pôr na fila" na demanda): o Claude faz uma
  tarefa por vez, por padrão só quando você está Ausente. Tarefa de demanda roda na branch e na conversa dela. Quando
  a fila esvazia, o resumo chega no Telegram; ao voltar, no sino.
- **Revisão com IA** (aba Revisão da demanda): compara a branch do card com a principal e revisa como num PR, com
  Claude, ChatGPT, Gemini ou em dupla. Fica como rascunho; "Publicar no PR" usa o `gh`.
- **Gastos com IA** (valor de hoje no topo): por dia, projeto, demanda, IA e origem, com limite diário que pausa a
  fila, o Vigia e as regras automáticas.
- **Fila em cópia separada**: tarefas de demanda rodam numa pasta só da fila (git worktree, branch `fila/WEB-123`),
  sem mexer na sua. Cada tarefa vira um commit local; na demanda, **Trazer para WEB-123** junta tudo na branch do card.
  Se o projeto tiver um **comando de verificação** (ex: `npm run lint && npm test`), ele roda no fim de cada tarefa e
  o resultado entra no resumo.
- **Abrir PR pelo app** (aba Revisão da demanda): título e descrição montados do card, do desenho e da revisão; você
  edita, e o app faz o push e abre o PR (rascunho, se quiser) com o `gh`.
- **Resumo para a daily** (`Ctrl+K` → "daily", ou `/daily` no Telegram): ontem (ou sexta) / hoje / impedimentos.
- **Estimado × real** (painel de gastos e cabeçalho da demanda): dias úteis de "Em dev" até "Feita" contra a estimativa.
- **Sincronizar entre PCs** (Configurações → Geral): um repositório git privado seu mantém projetos, scripts, regras,
  preferências e demandas iguais no Ubuntu e no Windows. Segredos não vão; a pasta de cada projeto é por PC.
- **Histórico** (ícone de relógio no topo): as últimas 300 execuções com quem disparou (app, Telegram, pedido),
  resultado, duração e a saída completa. Fica só no PC (`history.json` + `history/` na pasta de dados do app).
- **Paleta de comandos** (`Ctrl+K`): rodar qualquer script, executar/parar projeto, ligar Remote, falar com o Claude
  num projeto, trocar o modo do console, abrir configurações, histórico e notificações, tudo pelo teclado.

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
  main/tgcontrol.ts      comandos do Telegram (/projetos, /rodar, /claude, /log, /historico)
  main/history.ts        histórico de execuções (local)
  main/demands.ts        demandas: Jira, análise/desenho com IA, conversa do Claude, branch
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
- [x] Fase 7 (parte 2): atualização automática + Release automática ao subir a versão
- [x] Fase 8: central de notificações, Telegram completo, histórico, paleta de comandos
- [x] Fase 9: Demandas · Fase 10: Git no card + guias do projeto
