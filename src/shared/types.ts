export type PresenceStatus = 'on' | 'off'

export interface Project {
  id: string
  name: string
  path: string
  /** Ativar Claude Remote Control quando o status for OFF */
  remoteEnabled: boolean
  createdAt: number
}

export type ScriptType = 'terminal' | 'claude'

export type ScriptTarget =
  | { kind: 'project'; projectId: string }
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

export type ConsoleMode = 'terminal' | 'claude'

export interface UiState {
  consoleExpanded: boolean
  consoleMode: ConsoleMode
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
    /** Só modo custom: ferramentas de LEITURA que o Vigia pode usar (ex: mcp__ccc-gchat__list_messages) */
    readTools: string
  }
  lastApplied: Partial<Record<IntegrationId, { ok: boolean; at: number; message: string }>>
}

export interface TelegramConfig {
  chatId: string
}

export interface WatcherConfig {
  /** Toggle "Monitorar Google Chat" do header */
  enabled: boolean
  /** Liga sozinho quando o status vai para OFF */
  autoWhenOff: boolean
  intervalMin: number
  /** Espaços/pessoas para focar (texto livre que vai no prompt) */
  focus: string
  /** Modelo do Claude para o ciclo (vazio = padrão) */
  model: string
  lastCheckAt: number | null
  /** IDs de mensagens já alertadas (dedupe) */
  seen: string[]
}

export type AlertStatus = 'pending' | 'approved' | 'dismissed'

export interface DeployAlert {
  id: string
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

export interface AppConfig {
  version: 1
  status: PresenceStatus
  projects: Project[]
  scripts: Script[]
  ui: UiState
  integrations: IntegrationsConfig
  telegram: TelegramConfig
  watcher: WatcherConfig
  alerts: DeployAlert[]
}

export interface SecretsStatus {
  set: SecretKey[]
  /** false = o SO não oferece cofre (ex: Linux sem keyring): tokens ficam só ofuscados */
  encrypted: boolean
}

export interface SettingsPatch {
  integrations?: Partial<Omit<IntegrationsConfig, 'lastApplied'>>
  telegram?: Partial<TelegramConfig>
  watcher?: Partial<Omit<WatcherConfig, 'seen' | 'lastCheckAt'>>
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

export interface RunRequest {
  kind: ScriptType
  /** Texto do script/comando, ainda com {{variaveis}} */
  content: string
  /** Valores das {{variaveis}}. Ausente = texto literal (console), sem substituição */
  variables?: Record<string, string>
  cwd: string
  label?: string
  /** Só para kind=claude: retoma uma sessão anterior (conversa contínua no console) */
  resumeSessionId?: string
}

export type RunLineKind = 'stdout' | 'stderr' | 'claude' | 'tool' | 'info'

export type RunEvent =
  | { runId: string; type: 'lines'; lines: Array<{ kind: RunLineKind; text: string }> }
  | { runId: string; type: 'session'; sessionId: string }
  | { runId: string; type: 'exit'; code: number | null; signal: string | null; killed: boolean }
  | { runId: string; type: 'error'; message: string }

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
