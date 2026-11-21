# Melhorias anotadas

Lista de melhorias levantadas no primeiro uso real (Ubuntu, 20/11/2026). Marque `[x]` quando ficar pronto.

## 1. Feedback e interface

- [x] **"Iniciando…" / "Parando…" nos botões** de Executar/Parar/Reiniciar do projeto (e no Parar dos terminais):
  desabilitar o botão e mostrar spinner até o estado mudar de verdade, para não parecer que nada aconteceu.
- [x] **Modais mais largas** (projeto, script, executar). Na edição do projeto, o campo de **valor** das variáveis
  é estreito demais: dar mais espaço ao valor (ex: chave 30% / valor 70%) e aumentar a largura da modal.

## 2. Terminais

- [x] **Digitar comandos na aba do projeto**: hoje o campo de baixo sempre roda no Console/Claude/Gemini.
  Quando a aba ativa for de um projeto, o comando deve rodar na pasta daquele projeto (e aparecer naquela aba).
  Avaliar também mandar texto para o processo em execução (stdin), para comandos interativos simples.
- [x] **Abrir terminal do sistema nesta pasta**: botão no card do projeto que abre o terminal de verdade do
  Ubuntu/Windows já na pasta (gnome-terminal / Windows Terminal / PowerShell). Necessário para coisas interativas.

## 3. Remote Control

- [x] Quando aparecer *"Primeira vez nesta pasta: rode `claude remote-control`…"*, o card deve ter um botão
  **"Fazer a configuração inicial"** que abre o terminal do sistema na pasta já rodando `claude remote-control`
  (para responder `y` às perguntas), e depois **"Tentar de novo"**. Hoje a mensagem não diz onde fazer isso.

## 4. Claude no console: permissões

- [x] Em `claude -p` o Claude não consegue pedir aprovação, então comandos como `git config` / `gh auth status`
  foram bloqueados. Opções:
  - **Aprovação dentro do app** (feito): usar `--permission-prompt-tool` (uma ferramenta MCP do próprio app) para abrir
    uma janela "O Claude quer rodar: `git status` · Permitir / Negar / Sempre permitir" (e pelo Telegram no modo Ausente).
  - **Perfis de permissão** (feito, como "Perguntar / Pode editar arquivos / Só leitura" + regras "sempre permitir") por projeto/console: "Só leitura", "Git de leitura liberado" (`git status`, `git log`,
    `gh auth status`…), "Pode editar arquivos" (`acceptEdits`), com lista de comandos sempre permitidos.

## 5. Assistente de configuração (setup guiado)

O usuário não conseguiu configurar Git, Jira, Google Chat nem Telegram sozinho. Criar um **assistente passo a passo**
(primeira abertura + menu Configurações), com checagem automática de cada item e instruções na própria tela:

- [x] **Diagnóstico**: verifica `claude` (instalado + logado), `git`, `gh`, `gemini`, `codex`, `uv`, e mostra
  ✓/✗ com o comando exato para instalar no Ubuntu/Windows e um botão "Verificar de novo".
- [x] **Git/GitHub**: explicar o que é o token, link direto para criar o *fine-grained token* com as permissões
  certas, testar a conexão depois de salvar.
- [x] **Jira**: link direto para criar o API token da Atlassian, testar a conexão (listar 1 issue).
- [x] **Telegram**: passo a passo com prints/texto (BotFather → token → mandar "oi" → Detectar → Testar).
- [x] **Google Chat** (o mais difícil): pesquisar o caminho mais simples hoje. O servidor oficial exige o
  Developer Preview do Workspace; avaliar alternativas (servidor MCP da comunidade, conta de serviço / app do Chat,
  conector do Google Workspace) e escrever o guia completo, incluindo onde clicar no Google Cloud.
- [x] Em cada integração: botão **"Testar"** que faz uma chamada real e diz em português o que deu errado.

## 6. IAs

- [x] **Gemini não encontrado** (`exec: gemini: não encontrado`): o Gemini CLI não estava instalado. O assistente
  (item 5) deve detectar e ensinar a instalar e fazer login; o modo Gemini deve mostrar isso na hora em vez do erro cru.
- [x] **ChatGPT** (feito, só console e scripts; no Vigia não, porque o `codex exec` cancela ferramentas MCP): adicionar a OpenAI via **Codex CLI** (`codex exec`, modo não interativo) como terceira IA,
  com o mesmo esquema do Gemini: modo no console, tipo de script e opção no Vigia.
  Permitir **escolher a IA** por tarefa (console, scripts, Vigia) e alternar entre Gemini e ChatGPT.
  Conferir na documentação atual as flags do Codex para saída JSON e restrição de ferramentas.

## 7. Modo Vigia

- [x] Deixar claro na interface que dá para **ligar o Vigia sem estar Ausente** (botão "Vigia" no topo) e
  **onde chegam os avisos**: notificação do sistema, faixa de pedidos no app e Telegram (se configurado).
- [x] Quando o Vigia estiver bloqueado (⚠), o clique no botão deve abrir direto o passo do assistente que falta
  (ex: "Configure o Google Chat"), em vez de só mostrar a dica no tooltip.

## 8. Distribuição

- [x] **Atualização automática** (código pronto; começa a valer depois que o repo ficar público e a primeira release com ela for publicada) (`electron-updater` + GitHub Releases), sem reiniciar sozinho em modo Ausente ou
  com projetos rodando. Pré-requisitos do lado do usuário: repositório **público** (Settings → Danger Zone →
  Change visibility) e a primeira release publicada (Releases → Draft a new release → tag `v0.6.0`).

## 9. Feito junto (sugestões extras)

- [x] Ações de editar/excluir sempre visíveis (antes só apareciam passando o mouse).
- [x] Variáveis do projeto aparecem no card (clique para editar) e o formulário explica com exemplo.
- [x] "Inserir variável" no formulário de script: clica e entra no cursor (do projeto, do pedido do Vigia ou perguntar na hora).
- [x] Assistente "Começar" abre sozinho na primeira vez (sem projetos).
- [x] Exportar/importar configuração (Configurações → Geral), sem tokens.

## 10. Rodada 3

- [x] Variáveis do projeto: chave e valor meio a meio (o `w-full` do campo brigava com a largura).
- [x] Remote ligado não cria mais rolagem horizontal (link longo quebra dentro do card; colunas com `minmax(0,1fr)`).
- [x] Seletor de modo virou um botão só (`[ícone Terminal ▾]`); as outras opções aparecem no hover. Enter abre a aba certa.
- [x] **Central de notificações** (sino no topo): pedidos do Google Chat, permissões do Claude, scripts que terminam,
  projetos que caem, falhas do Vigia, Remote ativo e atualizações. Configurações → Geral → Notificações escolhe o que
  também aparece no canto da tela.
- [x] Release automática: subiu a versão no `package.json` e deu push na main → o CI cria a Release com os instaladores.
- [x] Teste de fumaça cobre Remote (Claude falso com link longo), rolagem horizontal, largura das variáveis, seletor de modo e sino.

## 11. Rodada 4

- [x] **Telegram completo**: `/projetos` (▶/■, Remote com link no chat, log, Claude), `/rodar` (escolhe projeto,
  pergunta variáveis, confirma), `/claude` + texto livre (conversa contínua, `/novo`, `/parar`, permissões com botões),
  `/log`, `/historico`; avisos do sino vão pro Telegram no modo Ausente.
- [x] **Histórico de execuções** (local): 300 últimas, origem, resultado, duração, saída completa, busca e filtro.
- [x] **Paleta de comandos** (`Ctrl+K`).
- [x] Notificações do sino sobrevivem ao fechar o app.

## Roteiro (próximas fases)

### Fase 9: Demandas ✅ (v0.10.0)
- [x] Demanda dentro do projeto, pelo número do card (que também é o nome da branch).
- [x] Puxa do Jira (título, descrição, comentários, anexos); contexto do chat e transcrição colados.
- [x] Análise só leitura (Claude, ChatGPT ou Gemini): entendimento, o que muda, dúvidas para o refinamento, riscos e
  estimativa em horas/dias; você registra a sua.
- [x] Desenho da solução (editável, com aprovação) consultando projetos relacionados só para leitura (ex: a API).
- [x] Implementação com o Claude numa conversa própria por demanda (app, terminal da demanda ou Telegram `/demanda`).
- [x] Branch com o nome do card (cria ou troca), etapas, linha do tempo, paleta e avisos no sino.


### Fase 10: Git no card do projeto ✅ (v0.11.0)
- [x] Arquivos alterados, commits à frente/atrás, "sem push", último commit (no chip da branch).
- [x] Chip da branch: puxar (só fast-forward), ver diferenças, trocar de branch; aviso ao ir para Ausente.
- [x] Demanda: "Atualizar com a master" (fetch + merge, só com a árvore limpa; em conflito, botão para o Claude resolver).
- [x] Guias do projeto (ex: docs/STYLE_GUIDE.md): o Claude segue em tudo no projeto; as Demandas levam o conteúdo.

### Fase 11: Fila de tarefas para o Claude ✅ (v0.12.0)
- [x] Tarefas por demanda (na branch e na conversa dela) ou por projeto; uma por vez; só no Ausente (opcional).
- [x] Pausar, rodar agora, mover, cancelar, tentar de novo; `/fila` no Telegram.
- [x] Resumo no Telegram quando a fila esvazia no Ausente e no sino quando você volta.

### Fase 12: Revisão com IA ✅ (v0.12.0)
- [x] Diff da branch da demanda contra a principal (commits + sem commit), seguindo card, desenho e guia.
- [x] Claude, ChatGPT, Gemini ou dupla (ChatGPT faz a 1ª passada, Claude confere e aprofunda).
- [x] Rascunho editável; publicar como comentário no PR com o gh só quando você clicar.

### Fase 13: Custos e limites ✅ (v0.12.0)
- [x] Gastos por dia, projeto, demanda, IA e origem (Claude em US$; Gemini/ChatGPT em tokens); Vigia e respostas incluídos.
- [x] Limite diário: pausa fila, Vigia e regras automáticas até o dia seguinte (ou "Liberar hoje"); aviso no sino e Telegram.

### Testes automáticos ✅ (v0.12.0)
- [x] `npm test`: 30 testes dos módulos (variáveis, git com repositórios reais, demandas com Jira falso, fila, custos,
  histórico, Telegram com servidor falso, Claude falso no runner, configuração). Rodam no CI antes de gerar os instaladores.

### Rodada 5 ✅ (v0.13.0)
- [x] Novo nome e ícone: **Hélice** (três C girando); a hélice gira na bandeja e no topo quando a fila/Vigia trabalham;
  azul-petróleo no modo Ausente. O nome técnico do pacote continua o mesmo (atualizações e configurações intactas).
- [x] Fila em cópia separada (git worktree) com commit local por tarefa, "Trazer para a branch" e "Remover cópia".
- [x] Comando de verificação do projeto no fim de cada tarefa da fila.
- [x] Abrir PR pelo app (push + gh pr create, rascunho opcional).
- [x] Resumo para a daily (app e /daily).
- [x] Estimado × real por demanda.
- [x] Sincronizar entre PCs por repositório git privado (mescla de três vias; segredos ficam em cada PC).

### Rodada 6 ✅ (v0.14.0)
- [x] Tipo do projeto (front/back/os dois/outro) com recursos próprios.
- [x] Front: prints das telas (desktop e celular) numa janela invisível + erros do console e requisições que falharam.
- [x] Back: checagem das rotas da API (método, caminho, status esperado).
- [x] Antes/depois nas tarefas da fila e ao trazer o trabalho da fila; prints no Telegram.
- [x] Comentários do PR → Claude (agora ou pela fila).
- [x] Dúvidas do refinamento → mensagem pronta / comentário no Jira.
- [x] Fluxo de bug com prints colados e correção começando pelo teste.
- [x] Áudio no Telegram com transcrição configurável.
- [x] Memória do projeto (CLAUDE.md) com sugestão automática.

### Para depois (sugeridos)
- [ ] Critérios de aceite como checklist conferido antes do PR.
- [ ] Atualizar o Jira (comentar PR aberto / mover etapa) com confirmação.
- [ ] Relatório da semana (demandas, horas, PRs, gastos).
- [ ] Comparar prints antes/depois lado a lado com destaque do que mudou.

### Fase 14: Modelos de projeto (sem prioridade por enquanto)
- [ ] "Projeto Node", "Laravel", etc. com comando de execução, variáveis e scripts comuns já prontos.

### Ideias soltas
- [ ] Aprovação de permissões também para o Gemini.
