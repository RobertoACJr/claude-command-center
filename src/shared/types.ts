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

export interface CommandCenterApi {
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
