import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync } from 'fs'
import { join } from 'path'
import type {
  AlertStatus,
  AppConfig,
  DeployAlert,
  IntegrationId,
  Project,
  Script,
  SettingsPatch,
  UiState
} from '../shared/types'

function defaults(): AppConfig {
  return {
    version: 1,
    status: 'on',
    statusSince: Date.now(),
    general: { closeToTray: true, openAtLogin: false, trayHintShown: false },
    projects: [],
    scripts: [],
    ui: { consoleExpanded: false, consoleMode: 'terminal' },
    integrations: {
      github: { enabled: false, readOnly: true },
      jira: { enabled: false, url: '', email: '' },
      gchat: { enabled: false, mode: 'official', clientId: '', callbackPort: 8765, readTools: '' },
      lastApplied: {}
    },
    telegram: { chatId: '' },
    watcher: {
      enabled: false,
      autoWhenOff: true,
      intervalMin: 3,
      focus: '',
      model: '',
      lastCheckAt: null,
      seen: []
    },
    alerts: []
  }
}

export function configFilePath(): string {
  return join(app.getPath('userData'), 'config.json')
}

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d)
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
const num = (v: unknown, d: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d

function normalize(raw: unknown): AppConfig {
  const d = defaults()
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<AppConfig>
  const gi = r.integrations?.github
  const ji = r.integrations?.jira
  const ci = r.integrations?.gchat
  const w = r.watcher
  return {
    version: 1,
    status: r.status === 'off' ? 'off' : 'on',
    statusSince: typeof r.statusSince === 'number' ? r.statusSince : Date.now(),
    general: {
      closeToTray: bool(r.general?.closeToTray, true),
      openAtLogin: bool(r.general?.openAtLogin, false),
      trayHintShown: bool(r.general?.trayHintShown, false)
    },
    projects: Array.isArray(r.projects) ? (r.projects as Project[]).filter((p) => p && p.id).map(normProject) : [],
    scripts: Array.isArray(r.scripts) ? (r.scripts as Script[]).filter((s) => s && s.id).map(normScript) : [],
    ui: {
      consoleExpanded: Boolean(r.ui?.consoleExpanded),
      consoleMode: r.ui?.consoleMode === 'claude' ? 'claude' : 'terminal'
    },
    integrations: {
      github: { enabled: bool(gi?.enabled, false), readOnly: bool(gi?.readOnly, true) },
      jira: { enabled: bool(ji?.enabled, false), url: str(ji?.url).trim(), email: str(ji?.email).trim() },
      gchat: {
        enabled: bool(ci?.enabled, false),
        mode: ci?.mode === 'custom' ? 'custom' : 'official',
        clientId: str(ci?.clientId).trim(),
        callbackPort: num(ci?.callbackPort, 8765, 1024, 65535),
        readTools: str(ci?.readTools)
      },
      lastApplied: r.integrations?.lastApplied && typeof r.integrations.lastApplied === 'object'
        ? r.integrations.lastApplied
        : {}
    },
    telegram: { chatId: str(r.telegram?.chatId).trim() },
    watcher: {
      enabled: bool(w?.enabled, d.watcher.enabled),
      autoWhenOff: bool(w?.autoWhenOff, d.watcher.autoWhenOff),
      intervalMin: num(w?.intervalMin, 3, 1, 120),
      focus: str(w?.focus),
      model: str(w?.model).trim(),
      lastCheckAt: typeof w?.lastCheckAt === 'number' ? w.lastCheckAt : null,
      seen: Array.isArray(w?.seen) ? w.seen.filter((x) => typeof x === 'string').slice(-500) : []
    },
    alerts: Array.isArray(r.alerts) ? (r.alerts as DeployAlert[]).filter((a) => a && a.id).slice(-200) : []
  }
}

function normProject(p: Project): Project {
  const port = Number(p.port)
  return {
    id: p.id,
    name: str(p.name),
    path: str(p.path),
    remoteEnabled: bool(p.remoteEnabled, false),
    createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now(),
    runCommand: str(p.runCommand).trim(),
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : null,
    vars: Array.isArray(p.vars)
      ? p.vars
          .filter((v) => v && typeof v.key === 'string')
          .map((v) => ({ key: v.key.trim().replace(/[^\w.-]/g, '_'), value: str(v.value) }))
          .filter((v) => v.key)
      : []
  }
}

function normScript(s: Script): Script {
  const t = s.target as Script['target'] | undefined
  const target: Script['target'] =
    t?.kind === 'project' && typeof t.projectId === 'string'
      ? { kind: 'project', projectId: t.projectId }
      : t?.kind === 'custom' && typeof t.path === 'string'
        ? { kind: 'custom', path: t.path }
        : t?.kind === 'ask'
          ? { kind: 'ask' }
          : { kind: 'global' }
  return { ...s, type: s.type === 'claude' ? 'claude' : 'terminal', target }
}

type Listener = (cfg: AppConfig) => void

class ConfigStore {
  private data: AppConfig = defaults()
  private listeners: Listener[] = []

  /** Avisado a cada mudança (Remote Control, Vigia e renderer acompanham) */
  onChange(fn: Listener): void {
    this.listeners.push(fn)
  }

  load(): AppConfig {
    const file = configFilePath()
    if (!existsSync(file)) {
      this.data = defaults()
      this.persist()
      return this.get()
    }
    try {
      this.data = normalize(JSON.parse(readFileSync(file, 'utf-8')))
    } catch (err) {
      const backup = `${file}.corrupt-${Date.now()}`
      try {
        copyFileSync(file, backup)
      } catch {
        /* ignore */
      }
      console.error('[store] config.json inválido, backup salvo em', backup, err)
      this.data = defaults()
      this.persist()
    }
    return this.get()
  }

  get(): AppConfig {
    return structuredClone(this.data)
  }

  private persist(): void {
    const file = configFilePath()
    mkdirSync(app.getPath('userData'), { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8')
    renameSync(tmp, file) // escrita atômica
  }

  update(mutator: (draft: AppConfig) => void): AppConfig {
    const draft = structuredClone(this.data)
    mutator(draft)
    this.data = normalize(draft)
    this.persist()
    const snapshot = this.get()
    for (const fn of this.listeners) fn(snapshot)
    return snapshot
  }

  setStatus(status: AppConfig['status']): AppConfig {
    return this.update((d) => {
      if (d.status !== status) d.statusSince = Date.now()
      d.status = status
    })
  }

  markTrayHintShown(): AppConfig {
    return this.update((d) => {
      d.general.trayHintShown = true
    })
  }

  saveProject(p: Project): AppConfig {
    return this.update((d) => {
      const i = d.projects.findIndex((x) => x.id === p.id)
      if (i >= 0) d.projects[i] = p
      else d.projects.push(p)
    })
  }

  deleteProject(id: string): AppConfig {
    return this.update((d) => {
      d.projects = d.projects.filter((x) => x.id !== id)
      // Scripts do projeto viram ações globais (perguntam o projeto na hora)
      d.scripts = d.scripts.map(
        (s): Script =>
          s.target.kind === 'project' && s.target.projectId === id ? { ...s, target: { kind: 'ask' } } : s
      )
    })
  }

  saveScript(s: Script): AppConfig {
    return this.update((d) => {
      const i = d.scripts.findIndex((x) => x.id === s.id)
      if (i >= 0) d.scripts[i] = s
      else d.scripts.push(s)
    })
  }

  deleteScript(id: string): AppConfig {
    return this.update((d) => {
      d.scripts = d.scripts.filter((x) => x.id !== id)
    })
  }

  saveUi(ui: Partial<UiState>): AppConfig {
    return this.update((d) => {
      d.ui = { ...d.ui, ...ui }
    })
  }

  // ---------- Fase 3 ----------

  saveSettings(patch: SettingsPatch): AppConfig {
    return this.update((d) => {
      if (patch.general) d.general = { ...d.general, ...patch.general }
      if (patch.integrations?.github) d.integrations.github = { ...d.integrations.github, ...patch.integrations.github }
      if (patch.integrations?.jira) d.integrations.jira = { ...d.integrations.jira, ...patch.integrations.jira }
      if (patch.integrations?.gchat) d.integrations.gchat = { ...d.integrations.gchat, ...patch.integrations.gchat }
      if (patch.telegram) d.telegram = { ...d.telegram, ...patch.telegram }
      if (patch.watcher) d.watcher = { ...d.watcher, ...patch.watcher }
    })
  }

  setApplied(id: IntegrationId, ok: boolean, message: string): AppConfig {
    return this.update((d) => {
      d.integrations.lastApplied[id] = { ok, at: Date.now(), message: message.slice(0, 500) }
    })
  }

  setWatcherEnabled(enabled: boolean): AppConfig {
    return this.update((d) => {
      d.watcher.enabled = enabled
    })
  }

  /** Grava resultado de um ciclo do Vigia: novos alertas + mensagens vistas + horário */
  recordWatcherCycle(checkedAt: number, newAlerts: DeployAlert[], seenIds: string[]): AppConfig {
    return this.update((d) => {
      d.watcher.lastCheckAt = checkedAt
      d.watcher.seen = [...new Set([...d.watcher.seen, ...seenIds])].slice(-500)
      d.alerts = [...d.alerts, ...newAlerts].slice(-200)
    })
  }

  patchAlert(id: string, patch: Partial<Pick<DeployAlert, 'status' | 'telegram'>>): AppConfig {
    return this.update((d) => {
      d.alerts = d.alerts.map((a) => (a.id === id ? { ...a, ...patch } : a))
    })
  }

  setAlertStatus(id: string, status: AlertStatus): AppConfig {
    return this.patchAlert(id, { status })
  }

  clearResolvedAlerts(): AppConfig {
    return this.update((d) => {
      d.alerts = d.alerts.filter((a) => a.status === 'pending')
    })
  }
}

export const store = new ConfigStore()
