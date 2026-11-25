export type PresenceStatus = 'on' | 'off'

export interface ProjectVar {
  key: string
  value: string
}

export interface Project {
  id: string
  name: string
  path: string
  /** Ligar o Claude Remote Control automaticamente no modo Ausente */
  remoteEnabled: boolean
  createdAt: number
  /** Como executar o projeto (ex: npm run dev). Vazio = projeto sem execução */
  runCommand: string
  /** Porta para checar se está no ar (opcional) */
  port: number | null
  /** Variáveis do projeto, usadas em ações globais como {{projeto.chave}} */
  vars: ProjectVar[]
  /** Como o Claude lida com permissões neste projeto */
  claudeMode: ClaudeMode
  /** Regras "sempre permitir" (formato do Claude Code, ex: Bash(git status:*)) */
  allowedTools: string[]
  /** Arquivos-guia do projeto, relativos à pasta (ex: docs/STYLE_GUIDE.md): as IAs leem e seguem */
  guides: string[]
  /** Comando de verificação (ex: npm run lint && npm test): roda no fim de cada tarefa da fila */
  checkCommand: string
  /** Tipo do projeto: libera recursos próprios (front: prints e erros do navegador; back: checagem da API) */
  kind: ProjectKind
  /** Endereço local do projeto rodando (ex: http://localhost:5173) */
  localUrl: string
  /** Front: caminhos das telas (ex: /pedidos). Back: "GET /health 200" (método, caminho, status esperado) */
  routes: string[]
  /** Front: tirar também o print em largura de celular (390px) */
  mobileShots: boolean
  /** Arquivo de memória do projeto, onde ficam os aprendizados (o Claude lê sozinho). Padrão: CLAUDE.md */
  memoryFile: string
  /**
   * Projetos ligados: executar este também executa eles (ex.: o front liga o back) e parar desliga
   * os que subiram junto. A branch da demanda também vai para eles quando existir lá.
   */
  linkedProjectIds: string[]
  /**
   * Comando para derrubar o projeto, rodado depois de parar o processo (ex.: docker compose stop).
   * Vazio = só interrompe o processo. Também vale quando o projeto está rodando fora do app.
   */
  stopCommand: string
  /** Quanto esperar o processo sair sozinho antes de forçar (segundos) */
  stopTimeoutSec: number
  /** Ao ficar Ausente, parar este projeto (se a fila não estiver usando) e religar ao voltar */
  awayStop: boolean
  /** Endereço que diz se o projeto está saudável (ex.: http://localhost:8000/up). Vazio = só a porta */
  healthUrl: string
  /** Comando do Compose (ex.: "docker compose", "docker compose -f docker/dev.yml") */
  dockerCommand: string
  /** Atalhos de comando dentro dos containers (ex.: php artisan migrate no serviço app) */
  dockerCommands: DockerCommand[]
  /** Onde fica o log da aplicação, para o botão Log e os alertas de erro */
  logSource: LogSource
  /** Avisar (sino e, no Ausente, Telegram) quando aparecer erro no log */
  logAlerts: boolean
}

export interface DockerCommand {
  id: string
  name: string
  /** Serviço do compose onde roda */
  service: string
  command: string
}

export type LogSourceKind = 'none' | 'docker' | 'file' | 'command'

export interface LogSource {
  kind: LogSourceKind
  /** docker: serviço do compose */
  service: string
  /** file: caminho do arquivo (relativo à pasta do projeto ou absoluto) */
  path: string
  /** command: comando que fica mostrando o log */
  command: string
}

/** Um serviço do docker compose do projeto */
export interface DockerService {
  name: string
  /** running, exited, created, restarting, paused, … ou 'none' (nunca criado) */
  state: string
  /** Texto do docker (ex.: "Up 3 minutes (healthy)") */
  status: string
  container: string
  ports: string
  cpu?: string
  mem?: string
}

export interface DockerStatus {
  /** Tem arquivo do compose (ou o comando do compose respondeu) */
  compose: boolean
  ok: boolean
  message?: string
  services: DockerService[]
}

/** Perfil de trabalho: um clique sobe vários projetos */
export interface WorkProfile {
  id: string
  name: string
  projectIds: string[]
  /** Subir também os projetos ligados a cada um */
  withLinked: boolean
}

/** Quem está usando uma porta */
export interface PortOwner {
  pid: number
  name: string
}

export type ProjectKind = 'front' | 'back' | 'fullstack' | 'outro'

// ---------------------------------------------------------------- Telas e checagem da API

export interface ShotItem {
  route: string
  /** Largura usada (1280 = desktop, 390 = celular) */
  width: number
  /** Arquivo PNG (front) */
  file?: string
  /** Miniatura leve (JPEG ~480px) para as listas */
  thumb?: string
  /** Erros no console e requisições que falharam (front) */
  errors: string[]
  /** Back: status recebido e esperado */
  status?: number | null
  expected?: number
  ms?: number
  ok: boolean
}

/** Um conjunto de prints (front) e/ou checagens da API (back) */
export interface ShotSet {
  id: string
  at: number
  label: string
  projectId: string
  demandId?: string
  taskId?: string
  kind: 'telas' | 'api'
  items: ShotItem[]
  /** Por que não rodou (ex: projeto fora do ar) */
  error?: string
  /** Espaço em disco ocupado pelas imagens */
  bytes?: number
}

// ---------------------------------------------------------------- Comentários do PR

export interface PrComment {
  id: string
  author: string
  body: string
  /** Comentário numa linha do código */
  path?: string
  line?: number | null
  at: string
  url?: string
  kind: 'geral' | 'revisao' | 'linha'
}

/**
 * ask      = pergunta no app (e no Telegram, se Ausente) o que não estiver liberado
 * edits    = pode editar arquivos sem perguntar; comandos ainda perguntam
 * readonly = nada que precise de permissão (bloqueia sem perguntar)
 */
export type ClaudeMode = 'ask' | 'edits' | 'readonly'

export interface ClaudePerms {
  claudeMode: ClaudeMode
  allowedTools: string[]
}

export type ApprovalDecision = 'allow' | 'deny' | 'always'

/** Pedido de permissão do Claude esperando você */
export interface ApprovalRequest {
  id: string
  runId: string
  projectId: string
  /** Nome do projeto ou "Global" */
  scopeName: string
  toolName: string
  /** Resumo legível (ex: o comando do Bash, o arquivo do Edit) */
  summary: string
  /** Entrada completa da ferramenta, para conferir */
  detail: string
  /** Regra que "Sempre permitir" vai gravar */
  rule: string
  createdAt: number
}

export type ScriptType = 'terminal' | 'claude' | 'gemini' | 'codex'

/** IAs que o app sabe chamar */
export type AiProvider = 'claude' | 'gemini'

export type ScriptTarget =
  /** Script do projeto: aparece dentro do card do projeto */
  | { kind: 'project'; projectId: string }
  /** Ação global: pergunta o projeto na hora de rodar e usa as variáveis dele */
  | { kind: 'ask' }
  | { kind: 'custom'; path: string }
  | { kind: 'global' }

export interface Script {
  id: string
  name: string
  type: ScriptType
  target: ScriptTarget
  content: string
  createdAt: number
}

export type ConsoleMode = 'terminal' | 'claude' | 'gemini' | 'codex'

/** IAs que o Hélice pode usar */
export type AiId = 'claude' | 'gemini' | 'codex'

export interface UiState {
  consoleExpanded: boolean
  consoleMode: ConsoleMode
  /**
   * Quais IAs aparecem nos seletores (console, scripts, demandas, revisão, Vigia).
   * É deste PC (não sincroniza): cada computador tem as suas instaladas.
   */
  ais: Record<AiId, boolean>
}

export interface GeneralPrefs {
  /** Fechar a janela só esconde (app continua na bandeja) */
  closeToTray: boolean
  /** Abrir junto com o sistema */
  openAtLogin: boolean
  /** Já mostrou o aviso "continuo rodando na bandeja" */
  trayHintShown: boolean
  /** Notificação do sistema (canto da tela) além do sino do app */
  desktopNotifications: boolean
  /** Avisar quando um script terminar */
  notifyScriptDone: boolean
  /** Jornadas: pausar o cronômetro depois de tantos minutos sem mexer no PC (0 = nunca) */
  idlePauseMin: number
}

export type NotificationKind = 'pedido' | 'permissao' | 'projeto' | 'script' | 'atualizacao' | 'vigia' | 'remote' | 'demanda' | 'fila' | 'custos' | 'sistema'

/** Para onde o clique na notificação leva */
export type NotificationTarget = 'alerts' | 'terminals' | 'settings' | 'queue' | 'costs' | `tab:${string}` | `demand:${string}`

export interface AppNotification {
  id: string
  at: number
  kind: NotificationKind
  title: string
  body: string
  target?: NotificationTarget
  read: boolean
}

// ---------- Fase 3: integrações, Telegram, Vigia ----------

export type IntegrationId = 'github' | 'jira' | 'gchat'

/** Resultado do teste de uma integração: uma linha por coisa verificada */
export interface IntegrationCheck {
  /** ok = funcionando · warn = opcional/atenção · fail = não funciona · off = não configurado */
  lines: Array<{ state: 'ok' | 'warn' | 'fail' | 'off'; label: string; detail: string }>
  at: number
}

/** Nomes com prefixo ccc- para nunca sobrescrever MCPs que você já tenha */
export const MCP_NAMES: Record<IntegrationId, string> = {
  github: 'ccc-github',
  jira: 'ccc-jira',
  gchat: 'ccc-gchat'
}

/** Chaves do cofre de segredos (valores nunca voltam para a interface) */
export type SecretKey = 'github.pat' | 'jira.token' | 'gchat.clientSecret' | 'gchat.customJson' | 'telegram.token'

export interface IntegrationsConfig {
  github: { enabled: boolean; readOnly: boolean }
  jira: { enabled: boolean; url: string; email: string }
  gchat: {
    enabled: boolean
    mode: 'official' | 'custom'
    clientId: string
    callbackPort: number
    /** Só modo custom: ferramentas de LEITURA que o Vigia pode usar (ex: list_messages) */
    readTools: string
    /** Só modo custom: a ferramenta que ENVIA mensagem (usada só para as respostas cadastradas) */
    sendTool: string
  }
  lastApplied: Partial<Record<IntegrationId, { ok: boolean; at: number; message: string }>>
}

export interface TelegramConfig {
  chatId: string
  /** Botões (Aprovar/Descartar/Rodar) e comandos (/status, /ausente…) no Telegram */
  interactive: boolean
  /** Comando que transcreve áudio para texto ({{arquivo}} = caminho do áudio). Vazio = áudio desligado */
  transcribeCommand: string
  /** No modo Ausente, manda também os avisos do sino (projeto caiu, script terminou, Vigia, atualização) */
  forwardNotifications: boolean
}

export interface WatcherConfig {
  /** Toggle "Monitorar Google Chat" do header */
  enabled: boolean
  /** Liga sozinho quando o status vai para OFF */
  autoWhenOff: boolean
  intervalMin: number
  /** Espaços/pessoas para focar (texto livre que vai no prompt) */
  focus: string
  /** Modelo para o ciclo (vazio = padrão do provedor) */
  model: string
  /** Qual IA lê o Google Chat (Gemini poupa os tokens do Claude) */
  provider: AiProvider
  lastCheckAt: number | null
  /** IDs de mensagens já alertadas (dedupe) */
  seen: string[]
}

export type AlertStatus = 'pending' | 'approved' | 'dismissed'

export type Urgency = 'baixa' | 'normal' | 'alta'

export interface DeployAlert {
  id: string
  /** O que ficou faltando no pedido (ex: "ambiente não informado") */
  missing: string[]
  urgency: Urgency
  /** Projeto/repo citado na mensagem, como a IA entendeu */
  projectHint: string
  /** Projeto cadastrado que o app associou (vazio = nenhum) */
  projectId: string
  /** IDs para responder na conversa certa */
  spaceId: string
  threadId: string
  /** Regra de automação que casou com o pedido */
  ruleId: string
  telegramMessageId: number | null
  /** Histórico curto do que aconteceu com o pedido */
  history: string[]
  createdAt: number
  messageId: string
  requester: string
  card: string
  branch: string
  environment: string
  summary: string
  space: string
  link: string
  messageTime: string
  status: AlertStatus
  telegram: 'sent' | 'failed' | 'off'
}

/** Resposta pronta para mandar no Google Chat. Variáveis: {{solicitante}} {{card}} {{branch}} {{ambiente}} {{projeto}} */
export interface ReplyTemplate {
  id: string
  name: string
  text: string
  /** Enviar sozinha assim que o pedido é detectado (ex: "Recebido!") */
  autoOnDetect: boolean
}

/**
 * suggest  = só sugere o script no card do pedido
 * telegram = Telegram ganha o botão "Aprovar e rodar"
 * auto     = roda sozinho ao detectar (nunca em produção)
 */
export type RuleMode = 'suggest' | 'telegram' | 'auto'

export interface AutomationRule {
  id: string
  name: string
  enabled: boolean
  /** Ambientes separados por vírgula; * = qualquer (exceto produção no modo auto) */
  environments: string
  /** Projeto específico ('' = qualquer) */
  projectId: string
  scriptId: string
  mode: RuleMode
  /** Resposta enviada no chat quando o pedido é aprovado ('' = nenhuma) */
  replyOnApproveId: string
}

export interface AiConfig {
  /** Comando do Gemini CLI (ex: gemini, ou um caminho completo) */
  geminiCommand: string
  /** Comando do Codex CLI / ChatGPT (ex: codex) */
  codexCommand: string
}

export interface AppConfig {
  version: 1
  status: PresenceStatus
  /** Desde quando está no status atual */
  statusSince: number
  general: GeneralPrefs
  projects: Project[]
  scripts: Script[]
  ui: UiState
  integrations: IntegrationsConfig
  telegram: TelegramConfig
  watcher: WatcherConfig
  alerts: DeployAlert[]
  ai: AiConfig
  /** Permissões do Claude fora de um projeto (console em Global, ações sem projeto) */
  claudeGlobal: ClaudePerms
  replies: ReplyTemplate[]
  rules: AutomationRule[]
  /** Perfis de trabalho (ex.: "Bom dia" sobe back e front) */
  profiles: WorkProfile[]
  queue: QueueConfig
  costs: CostsConfig
  sync: SyncConfig
}

export interface SyncConfig {
  enabled: boolean
  /** Repositório git privado (ex: git@github.com:voce/helice-sync.git) */
  repoUrl: string
}

export interface SyncStatus extends SyncConfig {
  running: boolean
  lastAt: number | null
  lastResult: string
  ok: boolean
  /** Nome deste PC no repositório (as pastas dos projetos ficam por PC) */
  machine: string
}

export interface QueueConfig {
  /** Só começa tarefas quando você está Ausente (padrão). Desligado: roda assim que entra na fila */
  onlyAway: boolean
  /** Fila pausada à mão */
  paused: boolean
  /** Tarefas de demanda rodam numa cópia separada do projeto (git worktree), sem mexer na sua pasta */
  useWorktree: boolean
}

export interface CostsConfig {
  /** Limite diário em US$ (0 = sem limite). Passou: pausa fila, Vigia e regras automáticas até o dia seguinte */
  dailyLimitUsd: number
}

export interface SecretsStatus {
  set: SecretKey[]
  /** false = o SO não oferece cofre (ex: Linux sem keyring): tokens ficam só ofuscados */
  encrypted: boolean
}

export interface SettingsPatch {
  general?: Partial<Omit<GeneralPrefs, 'trayHintShown'>>
  integrations?: Partial<Omit<IntegrationsConfig, 'lastApplied'>>
  telegram?: Partial<TelegramConfig>
  watcher?: Partial<Omit<WatcherConfig, 'seen' | 'lastCheckAt'>>
  ai?: Partial<AiConfig>
  claudeGlobal?: Partial<ClaudePerms>
  replies?: ReplyTemplate[]
  rules?: AutomationRule[]
  profiles?: WorkProfile[]
  queue?: Partial<QueueConfig>
  costs?: Partial<CostsConfig>
  sync?: Partial<SyncConfig>
  /** string = grava, null = apaga, ausente = mantém */
  secrets?: Partial<Record<SecretKey, string | null>>
}

export interface OpResult {
  ok: boolean
  message: string
  data?: Record<string, string>
}

export type WatcherPhase = 'off' | 'idle' | 'checking' | 'blocked'

export interface WatcherState {
  phase: WatcherPhase
  /** Por que está ligado/desligado/bloqueado */
  reason: string
  nextAt: number | null
  lastResult: string | null
}

export interface AppLog {
  kind: 'info' | 'error' | 'success' | 'tool'
  text: string
}

// ---------- Fase 2: execução ----------

export interface UpdateState {
  phase: 'idle' | 'disabled' | 'checking' | 'none' | 'downloading' | 'ready' | 'error'
  current: string
  version?: string
  percent?: number
  message?: string
  checkedAt?: number
}

export interface ToolCheck {
  id: 'claude' | 'git' | 'gh' | 'gemini' | 'codex' | 'uv' | 'google-chat-mcp'
  installed: boolean
  /** Versão / observação */
  detail: string
  /** undefined = não dá para saber */
  loggedIn?: boolean
}

/** Comandos que o app pode abrir num terminal do sistema (lista fechada) */
export type TerminalPreset = 'remote-control' | 'claude' | 'gemini' | 'codex' | 'gchat-login' | 'gh-login'

/** Cada aba do painel de Terminais */
export type TabKey = string // 'console' | 'claude' | 'system' | `script:${id}` | `project:${id}`

export interface RunRequest {
  kind: ScriptType
  /** Aba onde a saída aparece */
  tab: TabKey
  /** Título da aba */
  title: string
  /** Texto do script/comando, ainda com {{variaveis}} */
  content: string
  /** Valores das {{variaveis}}. Ausente = texto literal (console), sem substituição */
  variables?: Record<string, string>
  cwd: string
  label?: string
  /** Só para kind=claude: retoma uma sessão anterior (conversa contínua no console) */
  resumeSessionId?: string
  /** Terminal com stdin aberto (dá para digitar para o processo) */
  interactive?: boolean
  /** Projeto da execução (para as permissões do Claude); vazio = Global */
  projectId?: string
  /** Quem disparou (vai para o histórico). Padrão: app */
  origin?: RunOrigin
  /** Claude sem ferramentas de escrita (análise) */
  readOnly?: boolean
  /** Pastas extras que o Claude pode ler (ex: projeto da API) */
  addDirs?: string[]
}

/** Estado do git de um projeto (card) */
export interface GitInfo {
  branch: string | null
  /** Remoto que a branch acompanha (ex: origin/WEB-482); null = nunca deu push */
  upstream: string | null
  ahead: number
  behind: number
  /** Arquivos alterados/novos sem commit */
  changed: number
  conflicts: number
  lastCommit: { hash: string; subject: string; when: string } | null
  /** Branch principal (variável branch_principal ou a do remoto) */
  base: string
}

// ---------------------------------------------------------------- Demandas

/** Etapas de uma demanda (card do Jira) */
export type DemandStatus = 'nova' | 'estimada' | 'desenhada' | 'dev' | 'teste' | 'beta' | 'feita'

/** IA que estima e desenha (a implementação é sempre com o Claude) */
export type DemandAi = 'claude' | 'codex' | 'gemini'

export interface DemandJira {
  summary: string
  status: string
  type: string
  priority: string
  description: string
  comments: Array<{ author: string; at: string; body: string }>
  attachments: string[]
  url: string
  fetchedAt: number
}

export interface Demand {
  id: string
  projectId: string
  /** Número do card (ex: WEB-482); também é o nome da branch */
  key: string
  title: string
  status: DemandStatus
  jira: DemandJira | null
  /** Texto do chat, anotações, o que mais ajudar */
  context: string
  /** Transcrição da call de apresentação (colada) */
  transcript: string
  /** Outros projetos que a IA pode LER para conferir (ex: a API) */
  refProjectIds: string[]
  ai: DemandAi
  /** Análise da IA: entendimento, o que muda, dúvidas, riscos, estimativa */
  analysis: string
  /** Sugestão da IA em horas */
  aiHours: number | null
  /** Sua estimativa em horas */
  hours: number | null
  /** Desenho do que vai ser implementado (editável) */
  design: string
  designApproved: boolean
  /** Conversa do Claude desta demanda */
  sessionId: string | null
  /** Última revisão com IA (rascunho até publicar) */
  review: DemandReview | null
  reviewAi: ReviewAi
  /** Conversa do Claude na cópia da fila (outra pasta = outra conversa) */
  queueSessionId: string | null
  /** PR aberto pelo app */
  prUrl: string | null
  /** Quando a etapa mudou (para estimado × real) */
  statusLog: Array<{ at: number; status: DemandStatus }>
  /** Funcionalidade ou correção de bug (muda a análise e a implementação) */
  type: 'feature' | 'bug'
  /** Prints e imagens colados na demanda (arquivos na pasta de dados do app) */
  images: string[]
  /** Comentários do PR já mandados para o Claude */
  prCommentsDone: string[]
  timeline: Array<{ at: number; text: string }>
  createdAt: number
  updatedAt: number
}

/** O que a IA está fazendo agora numa demanda */
export interface DemandBusy {
  demandId: string
  what: 'jira' | 'analysis' | 'design' | 'dev' | 'branch' | 'review'
  runId?: string
}

/** Quem disparou uma execução */
export type RunOrigin = 'app' | 'telegram' | 'pedido' | 'projeto' | 'demanda' | 'fila'

/** Uma execução registrada no histórico (fica só no seu PC, na pasta do app) */
export interface HistoryEntry {
  id: string
  tab: TabKey
  title: string
  kind: ScriptType
  cwd: string
  projectId?: string
  origin: RunOrigin
  startedAt: number
  endedAt?: number
  status: 'running' | 'ok' | 'error' | 'stopped'
  code: number | null
  lineCount: number
  /** Custo estimado (Claude informa em US$; Gemini/ChatGPT só tokens) */
  costUsd?: number | null
  tokens?: number | null
}

// ---------------------------------------------------------------- Custos

export type CostSource = 'app' | 'telegram' | 'pedido' | 'projeto' | 'demanda' | 'fila' | 'vigia' | 'resposta'

export interface CostEntry {
  at: number
  source: CostSource
  ai: 'claude' | 'gemini' | 'codex'
  title: string
  projectId?: string
  demandId?: string
  runId?: string
  /** US$ estimado (equivalente da API; no plano Pro/Max não é cobrado à parte) */
  usd: number | null
  tokens: number | null
}

export interface CostGuard {
  todayUsd: number
  limitUsd: number
  /** Passou do limite hoje: automações pausadas */
  over: boolean
  /** Você liberou hoje mesmo passando do limite */
  overridden: boolean
}

// ---------------------------------------------------------------- Fila

export type QueueStatus = 'pendente' | 'rodando' | 'feita' | 'falhou' | 'cancelada'

export interface QueueTask {
  id: string
  projectId: string
  /** Tarefa de uma demanda: roda na conversa e na branch dela */
  demandId?: string
  prompt: string
  status: QueueStatus
  createdAt: number
  startedAt?: number
  endedAt?: number
  runId?: string
  /** Resposta final do Claude (resumida) */
  summary?: string
  /** Por que falhou / não começou */
  error?: string
  costUsd?: number | null
  origin: 'app' | 'telegram'
  /** Já entrou num resumo enviado */
  reported?: boolean
  /** Rodando: o Claude trabalhando ou o comando de verificação */
  phase?: 'trabalhando' | 'verificando'
  /** Pasta onde rodou (cópia da fila) */
  cwd?: string
  /** Commit local que o app fez na cópia da fila */
  committed?: boolean
  /** Resultado do comando de verificação do projeto */
  check?: { command: string; ok: boolean; output: string }
  /** Prints/checagem da API depois da tarefa (resumo de cada conjunto) */
  shots?: string[]
  shotSetIds?: string[]
  /** Algum conjunto depois da tarefa teve erro */
  shotsFailed?: boolean
  /** Aviso da preparação (ex: dependências da cópia diferentes do projeto) */
  warning?: string
}

/** Situação da cópia da fila de uma demanda */
export interface DemandQueueCopy {
  dir: string
  exists: boolean
  /** Commits da fila que ainda não estão na branch do card */
  ahead: number
  /** Espaço ocupado pela cópia (sem contar o node_modules emprestado) */
  bytes: number
}

/** Rascunho do PR montado a partir do card, desenho e revisão */
export interface PrDraft {
  title: string
  body: string
  base: string
}

/** Estimado × real de uma demanda */
/** Um período trabalhando numa demanda (jornada) */
export interface WorkSession {
  id: string
  demandId: string
  /** Número do card (ex.: MAS-123) */
  key: string
  title: string
  projectId: string
  start: number
  /** null = em andamento */
  end: number | null
  /** Já lançado como horas no Jira */
  jiraLogged?: boolean
  /** Como terminou, quando não foi você (ex.: "Ausente", "15 min sem mexer no PC") */
  note?: string
}

export interface WorkLogState {
  active: WorkSession | null
  /** Últimos 90 dias, mais recentes primeiro */
  sessions: WorkSession[]
}

export interface JiraTransition {
  id: string
  name: string
  to: string
}

export interface DemandTiming {
  demandId: string
  key: string
  title: string
  estimateHours: number | null
  /** Dias úteis entre começar (Em dev) e terminar (Feita) — ou até hoje, se não terminou */
  realDays: number | null
  done: boolean
  startedAt: number | null
  doneAt: number | null
}

export interface QueueState {
  tasks: QueueTask[]
  /** Por que a fila não está andando agora (null = andando ou vazia) */
  waiting: string | null
}

// ---------------------------------------------------------------- Revisão

export type ReviewAi = 'claude' | 'codex' | 'gemini' | 'dupla'

export interface DemandReview {
  at: number
  ai: ReviewAi
  base: string
  /** Commit revisado (HEAD na hora) */
  commit: string
  /** O que entrou: commits da branch + alterações ainda sem commit */
  scope: string
  text: string
  /** Já publicado como comentário no PR */
  publishedAt?: number
}

export type RunLineKind = 'stdout' | 'stderr' | 'claude' | 'tool' | 'info'

export type RunEvent =
  | {
      runId: string
      tab: TabKey
      type: 'start'
      title: string
      kind: ScriptType
      startedAt: number
      cwd?: string
      projectId?: string
      origin?: RunOrigin
    }
  | { runId: string; tab: TabKey; type: 'lines'; lines: Array<{ kind: RunLineKind; text: string }> }
  | { runId: string; tab: TabKey; type: 'session'; sessionId: string }
  | { runId: string; tab: TabKey; type: 'usage'; costUsd: number | null; tokens: number | null }
  | { runId: string; tab: TabKey; type: 'exit'; code: number | null; signal: string | null; killed: boolean }
  | { runId: string; tab: TabKey; type: 'error'; message: string }

/** Estado de execução de um projeto (botão ▶/■ do card) */
export interface ProjectRunState {
  projectId: string
  state: 'stopped' | 'starting' | 'running' | 'crashed' | 'external'
  runId?: string
  startedAt?: number
  exitCode?: number | null
  /** true/false se o projeto tem porta configurada; null = sem porta */
  portOpen: boolean | null
  /** Resposta do endereço de saúde: true = respondeu, false = não, undefined = sem endereço */
  healthy?: boolean
}

export type RemoteState = 'starting' | 'active' | 'needs-setup' | 'error' | 'stopping'

export interface RemoteSession {
  projectId: string
  projectName: string
  state: RemoteState
  url?: string
  message?: string
  pid?: number
  startedAt: number
  /** Últimas linhas de saída do processo (para diagnóstico) */
  tail: string[]
}

export interface CommandCenterApi {
  // Aprovação de permissões do Claude
  onApprovalRequest(cb: (r: ApprovalRequest) => void): () => void
  onApprovalResolved(cb: (id: string) => void): () => void
  respondApproval(id: string, decision: ApprovalDecision): Promise<void>
  pendingApprovals(): Promise<ApprovalRequest[]>

  // Atualização e configuração
  updateState(): Promise<UpdateState>
  onUpdateState(cb: (s: UpdateState) => void): () => void
  checkForUpdates(): Promise<void>
  installUpdate(): Promise<void>
  exportConfig(): Promise<OpResult>
  importConfig(): Promise<OpResult>

  // Assistente de configuração
  checkTools(): Promise<ToolCheck[]>
  platform(): Promise<'linux' | 'win32' | 'darwin'>

  // Melhorias
  runInput(runId: string, text: string): Promise<boolean>
  /** Abre o terminal do sistema na pasta; preset roda um comando conhecido (ex: configuração do Remote Control) */
  openSystemTerminal(cwd: string, preset?: TerminalPreset): Promise<OpResult>

  // Fase 6
  sendReply(alertId: string, replyId: string): Promise<OpResult>
  geminiCheck(): Promise<OpResult>
  geminiSetup(): Promise<OpResult>

  // Fase 5
  /** group: sobe também os projetos ligados (o back antes, esperando ele responder) */
  projectStart(projectId: string, opts?: { group?: boolean }): Promise<OpResult>
  /** group: para também os ligados */
  projectStop(projectId: string, opts?: { group?: boolean }): Promise<OpResult>
  /** Atualiza este projeto e os ligados: com a branch de mesmo nome no remoto da empresa, ou com a principal */
  projectsSyncBranches(projectId: string, target: 'branch' | 'main'): Promise<OpResult>
  dockerStatus(projectId: string): Promise<DockerStatus>
  /** Abre o terminal do sistema dentro do container */
  dockerShell(projectId: string, service: string): Promise<OpResult>
  dockerRestart(projectId: string, service: string): Promise<OpResult>
  /** Roda um comando no container; a saída vai para a aba do projeto */
  dockerExec(projectId: string, service: string, command: string): Promise<OpResult>
  /** Começa a mostrar o log da aplicação (aba applog:<id>) */
  logOpen(projectId: string, override?: Partial<LogSource>): Promise<OpResult & { tab?: string }>
  logClose(projectId: string): Promise<void>
  /** Manda um trecho do log para o Claude explicar (só leitura); a resposta vai para a aba claude */
  logAnalyze(projectId: string, text: string): Promise<OpResult>
  portOwner(port: number): Promise<PortOwner | null>
  portKill(port: number): Promise<OpResult>
  /** Arquivos .env.* do projeto e qual está em uso */
  envProfiles(projectId: string): Promise<{ files: string[]; active: string | null }>
  envSwitch(projectId: string, file: string): Promise<OpResult>
  profileRun(profileId: string): Promise<OpResult>
  /** Sugestões para o cadastro a partir da pasta (compose, serviços, log do Laravel, comandos) */
  projectSuggest(path: string, dockerCommand?: string): Promise<{ compose: boolean; services: string[]; logPath?: string; commands: Array<{ name: string; command: string }> }>
  saveProfiles(profiles: WorkProfile[]): Promise<AppConfig>
  projectRestart(projectId: string): Promise<OpResult>
  projectStates(): Promise<ProjectRunState[]>
  onProjectStates(cb: (s: ProjectRunState[]) => void): () => void
  remoteSetManual(projectId: string, on: boolean): Promise<void>
  /** keepRemote: ao voltar para Online, manter as sessões remotas abertas */
  setPresence(status: PresenceStatus, opts?: { keepRemote?: boolean }): Promise<AppConfig>
  onShowWindowRequest(cb: (what: NotificationTarget | 'go-online') => void): () => void

  /** Quais arquivos-guia existem na pasta do projeto */
  checkGuides(projectPath: string, guides: string[]): Promise<boolean[]>

  // Git no card do projeto
  gitInfo(projectId: string): Promise<GitInfo | null>
  gitPull(projectId: string): Promise<OpResult>
  gitBranches(projectId: string): Promise<string[]>
  gitCheckout(projectId: string, branch: string): Promise<OpResult>
  demandUpdateBase(id: string): Promise<OpResult>

  // Demandas
  demands(): Promise<Demand[]>
  onDemands(cb: (list: Demand[], busy: DemandBusy[]) => void): () => void
  demandsBusy(): Promise<DemandBusy[]>
  saveDemand(d: Demand): Promise<Demand[]>
  deleteDemand(id: string): Promise<Demand[]>
  demandFetchJira(id: string): Promise<OpResult>
  demandAnalyze(id: string, what: 'analysis' | 'design'): Promise<OpResult>
  demandImplement(id: string, message: string, fresh?: boolean): Promise<OpResult>
  demandBranch(
    id: string,
    opts: { base?: string; createOnCompany?: boolean; linked?: boolean }
  ): Promise<OpResult & { needsCompanyBranch?: boolean; linked?: Array<{ project: string; ok: boolean; message: string }> }>
  demandStop(id: string): Promise<void>
  demandReview(id: string): Promise<OpResult>
  demandSaveReview(id: string, text: string): Promise<void>
  demandPublishReview(id: string): Promise<OpResult>
  demandQueueCopy(id: string): Promise<DemandQueueCopy | null>
  demandBringQueue(id: string): Promise<OpResult>
  demandRemoveQueueCopy(id: string): Promise<OpResult>
  demandPrDraft(id: string): Promise<PrDraft | null>
  demandCreatePr(id: string, pr: { title: string; body: string; draft: boolean }): Promise<OpResult>
  demandTimings(): Promise<DemandTiming[]>
  /** Jornadas: tempo em cada demanda */
  worklogState(): Promise<WorkLogState>
  worklogStart(demandId: string): Promise<WorkLogState>
  worklogStop(): Promise<WorkLogState>
  worklogDelete(sessionId: string): Promise<WorkLogState>
  /** Corrige início/fim de um período */
  worklogEdit(sessionId: string, start: number, end: number): Promise<WorkLogState>
  /** Lança no Jira o tempo ainda não lançado da demanda naquele dia (AAAA-MM-DD) */
  worklogPush(demandId: string, day: string): Promise<OpResult>
  onWorklog(cb: (s: WorkLogState) => void): () => void
  /** Status atual do card no Jira e para onde pode ir */
  jiraTransitions(demandId: string): Promise<OpResult & { status?: string; transitions?: JiraTransition[] }>
  jiraTransition(demandId: string, transitionId: string): Promise<OpResult & { status?: string }>
  /** Resumo para a daily (texto pronto para colar) */
  daily(): Promise<string>

  // Telas (front) e checagem da API (back)
  shots(scope: { projectId?: string; demandId?: string }): Promise<ShotSet[]>
  takeShots(req: { projectId: string; demandId?: string; label: string }): Promise<OpResult & { sets?: ShotSet[] }>
  shotImage(file: string): Promise<string | null>
  deleteShots(id: string): Promise<void>
  onShots(cb: (set: ShotSet) => void): () => void

  // Comentários do PR, dúvidas, bug e memória
  demandPrComments(id: string): Promise<OpResult & { comments?: PrComment[] }>
  demandSendPrComments(id: string, commentIds: string[], comments: PrComment[], toQueue: boolean): Promise<OpResult>
  demandDoubts(id: string): Promise<string>
  demandCommentJira(id: string, text: string): Promise<OpResult>
  demandAddImage(id: string, dataUrl: string): Promise<OpResult & { file?: string }>
  demandRemoveImage(id: string, file: string): Promise<void>
  projectLearn(projectId: string, lesson: string): Promise<OpResult>

  // Sincronizar entre PCs
  syncStatus(): Promise<SyncStatus>
  syncNow(): Promise<OpResult>
  onSync(cb: (s: SyncStatus) => void): () => void

  // Fila de tarefas
  queue(): Promise<QueueState>
  onQueue(cb: (q: QueueState) => void): () => void
  queueAdd(t: { projectId: string; demandId?: string; prompt: string }): Promise<OpResult>
  queueCancel(id: string): Promise<void>
  queueRemove(id: string): Promise<void>
  queueRetry(id: string): Promise<void>
  queueMove(id: string, dir: -1 | 1): Promise<void>
  queueRunNow(): Promise<OpResult>
  queueClearDone(): Promise<void>

  // Custos
  costs(): Promise<CostEntry[]>
  costGuard(): Promise<CostGuard>
  onCosts(cb: (guard: CostGuard) => void): () => void
  costOverrideToday(): Promise<CostGuard>

  // Histórico de execuções
  history(): Promise<HistoryEntry[]>
  historyLog(id: string): Promise<string[]>
  clearHistory(): Promise<void>
  onHistory(cb: (entries: HistoryEntry[]) => void): () => void

  // Central de notificações
  notifications(): Promise<AppNotification[]>
  onNotification(cb: (n: AppNotification) => void): () => void
  markNotificationsRead(): Promise<void>
  clearNotifications(): Promise<void>

  // Fase 2
  run(req: RunRequest): Promise<string>
  stop(runId: string): Promise<void>
  onRunEvent(cb: (e: RunEvent) => void): () => void
  remoteList(): Promise<RemoteSession[]>
  remoteRestart(projectId: string): Promise<void>
  onRemoteUpdate(cb: (sessions: RemoteSession[]) => void): () => void
  copyText(text: string): Promise<void>
  openExternal(url: string): Promise<void>

  // Fase 3
  onConfigChanged(cb: (cfg: AppConfig) => void): () => void
  onAppLog(cb: (log: AppLog) => void): () => void
  saveSettings(patch: SettingsPatch): Promise<AppConfig>
  secretsStatus(): Promise<SecretsStatus>
  mcpApply(id: IntegrationId): Promise<OpResult>
  mcpStatus(id: IntegrationId): Promise<OpResult>
  /** Testa de verdade: conta (API), MCP no Claude e conectores da conta claude.ai */
  integrationCheck(id: IntegrationId): Promise<IntegrationCheck>
  mcpLogin(id: IntegrationId): Promise<OpResult>
  telegramTest(): Promise<OpResult>
  telegramDetectChat(): Promise<OpResult>
  watcherState(): Promise<WatcherState>
  onWatcherState(cb: (s: WatcherState) => void): () => void
  watcherRunNow(): Promise<void>
  setWatcherEnabled(enabled: boolean): Promise<AppConfig>
  setAlertStatus(id: string, status: AlertStatus): Promise<AppConfig>
  clearResolvedAlerts(): Promise<AppConfig>

  getConfig(): Promise<AppConfig>
  setStatus(status: PresenceStatus): Promise<AppConfig>
  saveProject(project: Project): Promise<AppConfig>
  deleteProject(id: string): Promise<AppConfig>
  saveScript(script: Script): Promise<AppConfig>
  deleteScript(id: string): Promise<AppConfig>
  saveUi(ui: Partial<UiState>): Promise<AppConfig>
  pickFolder(defaultPath?: string): Promise<string | null>
  gitBranch(path: string): Promise<string | null>
  homeDir(): Promise<string>
  configPath(): Promise<string>
}
