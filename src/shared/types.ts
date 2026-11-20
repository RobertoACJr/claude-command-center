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
}

export type RunLineKind = 'stdout' | 'stderr' | 'claude' | 'tool' | 'info'

export type RunEvent =
  | { runId: string; tab: TabKey; type: 'start'; title: string; kind: ScriptType; startedAt: number }
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
  onShowWindowRequest(cb: (what: 'alerts' | 'terminals' | 'go-online') => void): () => void

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
