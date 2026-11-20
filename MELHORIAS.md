# Melhorias anotadas

Lista de melhorias levantadas no primeiro uso real (Ubuntu, 20/11/2026). Marque `[x]` quando ficar pronto.

## 1. Feedback e interface

- [ ] **"Iniciando…" / "Parando…" nos botões** de Executar/Parar/Reiniciar do projeto (e no Parar dos terminais):
  desabilitar o botão e mostrar spinner até o estado mudar de verdade, para não parecer que nada aconteceu.
- [ ] **Modais mais largas** (projeto, script, executar). Na edição do projeto, o campo de **valor** das variáveis
  é estreito demais: dar mais espaço ao valor (ex: chave 30% / valor 70%) e aumentar a largura da modal.

## 2. Terminais

- [ ] **Digitar comandos na aba do projeto**: hoje o campo de baixo sempre roda no Console/Claude/Gemini.
  Quando a aba ativa for de um projeto, o comando deve rodar na pasta daquele projeto (e aparecer naquela aba).
  Avaliar também mandar texto para o processo em execução (stdin), para comandos interativos simples.
- [ ] **Abrir terminal do sistema nesta pasta**: botão no card do projeto que abre o terminal de verdade do
  Ubuntu/Windows já na pasta (gnome-terminal / Windows Terminal / PowerShell). Necessário para coisas interativas.

## 3. Remote Control

- [ ] Quando aparecer *"Primeira vez nesta pasta: rode `claude remote-control`…"*, o card deve ter um botão
  **"Fazer a configuração inicial"** que abre o terminal do sistema na pasta já rodando `claude remote-control`
  (para responder `y` às perguntas), e depois **"Tentar de novo"**. Hoje a mensagem não diz onde fazer isso.

## 4. Claude no console: permissões

- [ ] Em `claude -p` o Claude não consegue pedir aprovação, então comandos como `git config` / `gh auth status`
  foram bloqueados. Opções:
  - **Aprovação dentro do app**: usar `--permission-prompt-tool` (uma ferramenta MCP do próprio app) para abrir
    uma janela "O Claude quer rodar: `git status` · Permitir / Negar / Sempre permitir" (e pelo Telegram no modo Ausente).
  - **Perfis de permissão** por projeto/console: "Só leitura", "Git de leitura liberado" (`git status`, `git log`,
    `gh auth status`…), "Pode editar arquivos" (`acceptEdits`), com lista de comandos sempre permitidos.

## 5. Assistente de configuração (setup guiado)

O usuário não conseguiu configurar Git, Jira, Google Chat nem Telegram sozinho. Criar um **assistente passo a passo**
(primeira abertura + menu Configurações), com checagem automática de cada item e instruções na própria tela:

- [ ] **Diagnóstico**: verifica `claude` (instalado + logado), `git`, `gh`, `gemini`, `codex`, `uv`, e mostra
  ✓/✗ com o comando exato para instalar no Ubuntu/Windows e um botão "Verificar de novo".
- [ ] **Git/GitHub**: explicar o que é o token, link direto para criar o *fine-grained token* com as permissões
  certas, testar a conexão depois de salvar.
- [ ] **Jira**: link direto para criar o API token da Atlassian, testar a conexão (listar 1 issue).
- [ ] **Telegram**: passo a passo com prints/texto (BotFather → token → mandar "oi" → Detectar → Testar).
- [ ] **Google Chat** (o mais difícil): pesquisar o caminho mais simples hoje. O servidor oficial exige o
  Developer Preview do Workspace; avaliar alternativas (servidor MCP da comunidade, conta de serviço / app do Chat,
  conector do Google Workspace) e escrever o guia completo, incluindo onde clicar no Google Cloud.
- [ ] Em cada integração: botão **"Testar"** que faz uma chamada real e diz em português o que deu errado.

## 6. IAs

- [ ] **Gemini não encontrado** (`exec: gemini: não encontrado`): o Gemini CLI não estava instalado. O assistente
  (item 5) deve detectar e ensinar a instalar e fazer login; o modo Gemini deve mostrar isso na hora em vez do erro cru.
- [ ] **ChatGPT**: adicionar a OpenAI via **Codex CLI** (`codex exec`, modo não interativo) como terceira IA,
  com o mesmo esquema do Gemini: modo no console, tipo de script e opção no Vigia.
  Permitir **escolher a IA** por tarefa (console, scripts, Vigia) e alternar entre Gemini e ChatGPT.
  Conferir na documentação atual as flags do Codex para saída JSON e restrição de ferramentas.

## 7. Modo Vigia

- [ ] Deixar claro na interface que dá para **ligar o Vigia sem estar Ausente** (botão "Vigia" no topo) e
  **onde chegam os avisos**: notificação do sistema, faixa de pedidos no app e Telegram (se configurado).
- [ ] Quando o Vigia estiver bloqueado (⚠), o clique no botão deve abrir direto o passo do assistente que falta
  (ex: "Configure o Google Chat"), em vez de só mostrar a dica no tooltip.

## 8. Distribuição

- [ ] **Atualização automática** (`electron-updater` + GitHub Releases), sem reiniciar sozinho em modo Ausente ou
  com projetos rodando. Pré-requisitos do lado do usuário: repositório **público** (Settings → Danger Zone →
  Change visibility) e a primeira release publicada (Releases → Draft a new release → tag `v0.6.0`).
