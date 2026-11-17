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

export interface AppConfig {
  version: 1
  status: PresenceStatus
  projects: Project[]
  scripts: Script[]
  ui: UiState
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
