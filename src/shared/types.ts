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

export interface UiState {
  consoleExpanded: boolean
  consoleMode: ConsoleMode
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
}

export type NotificationKind = 'pedido' | 'permissao' | 'projeto' | 'script' | 'atualizacao' | 'vigia' | 'remote' | 'demanda' | 'sistema'

/** Para onde o clique na notificação leva */
export type NotificationTarget = 'alerts' | 'terminals' | 'settings' | `tab:${string}` | `demand:${string}`

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
  timeline: Array<{ at: number; text: string }>
  createdAt: number
  updatedAt: number
}

/** O que a IA está fazendo agora numa demanda */
export interface DemandBusy {
  demandId: string
  what: 'jira' | 'analysis' | 'design' | 'dev' | 'branch'
  runId?: string
}

/** Quem disparou uma execução */
export type RunOrigin = 'app' | 'telegram' | 'pedido' | 'projeto' | 'demanda'

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
  projectStart(projectId: string): Promise<OpResult>
  projectStop(projectId: string): Promise<void>
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
  demandBranch(id: string, base: string): Promise<OpResult>
  demandStop(id: string): Promise<void>

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
