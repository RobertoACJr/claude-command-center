import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync } from 'fs'
import { join } from 'path'
import type {
  WorkProfile,
  ClaudePerms,
  AlertStatus,
  AppConfig,
  AutomationRule,
  ReplyTemplate,
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
    general: { closeToTray: true, openAtLogin: false, trayHintShown: false, desktopNotifications: true, notifyScriptDone: true, idlePauseMin: 15 },
    projects: [],
    scripts: [],
    ui: { consoleExpanded: false, consoleMode: 'terminal', ais: { claude: true, gemini: true, codex: true } },
    integrations: {
      github: { enabled: false, readOnly: true },
      jira: { enabled: false, url: '', email: '' },
      gchat: { enabled: false, mode: 'official', clientId: '', callbackPort: 8765, readTools: '', sendTool: '' },
      lastApplied: {}
    },
    telegram: { chatId: '', interactive: true, forwardNotifications: true, transcribeCommand: '' },
    watcher: {
      enabled: false,
      autoWhenOff: true,
      intervalMin: 3,
      focus: '',
      model: '',
      provider: 'claude',
      lastCheckAt: null,
      seen: []
    },
    alerts: [],
    ai: { geminiCommand: 'gemini', codexCommand: 'codex' },
    claudeGlobal: { claudeMode: 'ask', allowedTools: [] },
    replies: [
      {
        id: 'recebido',
        name: 'Recebido',
        text: 'Oi {{solicitante}}! Recebi o pedido de {{card}} em {{ambiente}}. Assim que eu subir, aviso aqui. 👍',
        autoOnDetect: false
      },
      {
        id: 'feito',
        name: 'Feito',
        text: '{{card}} já está em {{ambiente}}, {{solicitante}}. ✅',
        autoOnDetect: false
      }
    ],
    rules: [],
    profiles: [],
    queue: { onlyAway: true, paused: false, useWorktree: true },
    costs: { dailyLimitUsd: 0 },
    sync: { enabled: false, repoUrl: '' }
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
      trayHintShown: bool(r.general?.trayHintShown, false),
      desktopNotifications: bool(r.general?.desktopNotifications, true),
      notifyScriptDone: bool(r.general?.notifyScriptDone, true),
      idlePauseMin: num(r.general?.idlePauseMin, 15, 0, 240)
    },
    projects: Array.isArray(r.projects) ? (r.projects as Project[]).filter((p) => p && p.id).map(normProject) : [],
    scripts: Array.isArray(r.scripts) ? (r.scripts as Script[]).filter((s) => s && s.id).map(normScript) : [],
    ui: {
      consoleExpanded: Boolean(r.ui?.consoleExpanded),
      consoleMode: ['claude', 'gemini', 'codex'].includes(r.ui?.consoleMode as string) ? r.ui!.consoleMode : 'terminal',
      ais: {
        claude: r.ui?.ais?.claude !== false,
        gemini: r.ui?.ais?.gemini !== false,
        codex: r.ui?.ais?.codex !== false
      }
    },
    integrations: {
      github: { enabled: bool(gi?.enabled, false), readOnly: bool(gi?.readOnly, true) },
      jira: { enabled: bool(ji?.enabled, false), url: str(ji?.url).trim(), email: str(ji?.email).trim() },
      gchat: {
        enabled: bool(ci?.enabled, false),
        mode: ci?.mode === 'custom' ? 'custom' : 'official',
        clientId: str(ci?.clientId).trim(),
        callbackPort: num(ci?.callbackPort, 8765, 1024, 65535),
        readTools: str(ci?.readTools),
        sendTool: str(ci?.sendTool).trim()
      },
      lastApplied: r.integrations?.lastApplied && typeof r.integrations.lastApplied === 'object'
        ? r.integrations.lastApplied
        : {}
    },
    telegram: {
      transcribeCommand: str(r.telegram?.transcribeCommand).trim(),
      chatId: str(r.telegram?.chatId).trim(),
      interactive: bool(r.telegram?.interactive, true),
      forwardNotifications: bool(r.telegram?.forwardNotifications, true)
    },
    watcher: {
      enabled: bool(w?.enabled, d.watcher.enabled),
      autoWhenOff: bool(w?.autoWhenOff, d.watcher.autoWhenOff),
      intervalMin: num(w?.intervalMin, 3, 1, 120),
      focus: str(w?.focus),
      model: str(w?.model).trim(),
      provider: w?.provider === 'gemini' ? 'gemini' : 'claude',
      lastCheckAt: typeof w?.lastCheckAt === 'number' ? w.lastCheckAt : null,
      seen: Array.isArray(w?.seen) ? w.seen.filter((x) => typeof x === 'string').slice(-500) : []
    },
    alerts: Array.isArray(r.alerts) ? (r.alerts as DeployAlert[]).filter((a) => a && a.id).map(normAlert).slice(-200) : [],
    ai: {
      geminiCommand: str(r.ai?.geminiCommand, 'gemini').trim() || 'gemini',
      codexCommand: str(r.ai?.codexCommand, 'codex').trim() || 'codex'
    },
    claudeGlobal: normPerms(r.claudeGlobal),
    replies: Array.isArray(r.replies) ? (r.replies as ReplyTemplate[]).filter((x) => x && x.id).map(normReply) : d.replies,
    rules: Array.isArray(r.rules) ? (r.rules as AutomationRule[]).filter((x) => x && x.id).map(normRule) : [],
    profiles: Array.isArray(r.profiles)
      ? (r.profiles as WorkProfile[])
          .filter((x) => x && typeof x.id === 'string' && x.id)
          .map((x) => ({
            id: x.id,
            name: str(x.name).trim() || 'Perfil',
            projectIds: Array.isArray(x.projectIds) ? x.projectIds.filter((y) => typeof y === 'string').slice(0, 20) : [],
            withLinked: bool(x.withLinked, true)
          }))
          .slice(0, 20)
      : [],
    queue: { onlyAway: bool(r.queue?.onlyAway, true), paused: bool(r.queue?.paused, false), useWorktree: bool(r.queue?.useWorktree, true) },
    costs: { dailyLimitUsd: num(r.costs?.dailyLimitUsd, 0, 0, 10_000) },
    sync: { enabled: bool(r.sync?.enabled, false), repoUrl: str(r.sync?.repoUrl).trim() }
  }
}

function normAlert(a: DeployAlert): DeployAlert {
  return {
    ...a,
    missing: Array.isArray(a.missing) ? a.missing.filter((m) => typeof m === 'string') : [],
    urgency: a.urgency === 'alta' || a.urgency === 'baixa' ? a.urgency : 'normal',
    projectHint: str(a.projectHint),
    projectId: str(a.projectId),
    spaceId: str(a.spaceId),
    threadId: str(a.threadId),
    ruleId: str(a.ruleId),
    telegramMessageId: typeof a.telegramMessageId === 'number' ? a.telegramMessageId : null,
    history: Array.isArray(a.history) ? a.history.filter((h) => typeof h === 'string').slice(-30) : []
  }
}

function normReply(x: ReplyTemplate): ReplyTemplate {
  return { id: x.id, name: str(x.name), text: str(x.text), autoOnDetect: bool(x.autoOnDetect, false) }
}

function normRule(x: AutomationRule): AutomationRule {
  return {
    id: x.id,
    name: str(x.name),
    enabled: bool(x.enabled, true),
    environments: str(x.environments),
    projectId: str(x.projectId),
    scriptId: str(x.scriptId),
    mode: x.mode === 'auto' || x.mode === 'telegram' ? x.mode : 'suggest',
    replyOnApproveId: str(x.replyOnApproveId)
  }
}

const RULE_RE = /^[\w.-]+(\(.{1,300}\))?$/

function normPerms(x: Partial<ClaudePerms> | undefined): ClaudePerms {
  return {
    claudeMode: x?.claudeMode === 'edits' || x?.claudeMode === 'readonly' ? x.claudeMode : 'ask',
    allowedTools: Array.isArray(x?.allowedTools)
      ? [...new Set(x!.allowedTools.filter((t): t is string => typeof t === 'string' && RULE_RE.test(t.trim())).map((t) => t.trim()))]
      : []
  }
}

function normProject(p: Project): Project {
  const port = Number(p.port)
  return {
    ...normPerms(p),
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
      : [],
    checkCommand: str(p.checkCommand).trim(),
    kind: (['front', 'back', 'fullstack', 'outro'] as const).includes(p.kind as never) ? p.kind : 'outro',
    localUrl: str(p.localUrl).trim().replace(/\/+$/, ''),
    routes: Array.isArray(p.routes) ? p.routes.filter((x) => typeof x === 'string').map((x) => x.trim()).filter(Boolean).slice(0, 30) : [],
    mobileShots: bool(p.mobileShots, false),
    memoryFile: str(p.memoryFile).trim() || 'CLAUDE.md',
    linkedProjectIds: Array.isArray(p.linkedProjectIds)
      ? [...new Set(p.linkedProjectIds.filter((x) => typeof x === 'string' && x && x !== p.id))].slice(0, 10)
      : [],
    guides: Array.isArray(p.guides)
      ? [...new Set(p.guides.filter((g) => typeof g === 'string').map((g) => g.trim().replace(/\\/g, '/')).filter(Boolean))].slice(0, 10)
      : [],
    stopCommand: str(p.stopCommand).trim(),
    stopTimeoutSec: num(p.stopTimeoutSec, 10, 1, 300),
    awayStop: bool(p.awayStop, false),
    healthUrl: str(p.healthUrl).trim(),
    dockerCommand: str(p.dockerCommand).trim() || 'docker compose',
    dockerCommands: Array.isArray(p.dockerCommands)
      ? p.dockerCommands
          .filter((c) => c && typeof c.command === 'string' && c.command.trim())
          .map((c) => ({
            id: str(c.id) || Math.random().toString(36).slice(2, 10),
            name: str(c.name).trim() || c.command.trim().slice(0, 40),
            service: str(c.service).trim(),
            command: c.command.trim()
          }))
          .slice(0, 30)
      : [],
    logSource: {
      kind: (['none', 'docker', 'file', 'command'] as const).includes(p.logSource?.kind as never) ? p.logSource.kind : 'none',
      service: str(p.logSource?.service).trim(),
      path: str(p.logSource?.path).trim(),
      command: str(p.logSource?.command).trim()
    },
    logAlerts: bool(p.logAlerts, false)
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
  return { ...s, type: ['claude', 'gemini', 'codex'].includes(s.type) ? s.type : 'terminal', target }
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

  /** "Sempre permitir": grava a regra no projeto (ou no Global) */
  addAllowedTool(projectId: string, rule: string): AppConfig {
    return this.update((d) => {
      const target = d.projects.find((p) => p.id === projectId) ?? d.claudeGlobal
      if (!target.allowedTools.includes(rule)) target.allowedTools.push(rule)
    })
  }

  /** Para exportar: tudo menos dados de execução (pedidos, mensagens vistas). Tokens nunca estão aqui. */
  exportable(): Partial<AppConfig> {
    const c = this.get()
    return {
      version: 1,
      general: c.general,
      projects: c.projects,
      scripts: c.scripts,
      ui: c.ui,
      integrations: { ...c.integrations, lastApplied: {} },
      telegram: c.telegram,
      watcher: { ...c.watcher, seen: [], lastCheckAt: null },
      ai: c.ai,
      claudeGlobal: c.claudeGlobal,
      replies: c.replies,
      rules: c.rules,
      profiles: c.profiles
    }
  }

  /** Importa de outro PC: troca a configuração, mantém o status atual e os pedidos daqui */
  importFrom(raw: unknown): { projects: number; scripts: number; rules: number } {
    if (!raw || typeof raw !== 'object') throw new Error('não é uma configuração')
    const incoming = normalize(raw)
    this.update((d) => {
      const keep = { status: d.status, statusSince: d.statusSince, alerts: d.alerts, watcher: d.watcher }
      Object.assign(d, incoming, keep, {
        watcher: { ...incoming.watcher, seen: keep.watcher.seen, lastCheckAt: keep.watcher.lastCheckAt }
      })
    })
    return { projects: incoming.projects.length, scripts: incoming.scripts.length, rules: incoming.rules.length }
  }

  /** Aplica o que veio da sincronização: mantém pastas deste PC, segredos, status e pedidos */
  applySynced(merged: Record<string, unknown>, paths: Record<string, string>): AppConfig {
    const cur = this.get()
    const localPath = new Map(cur.projects.map((p) => [p.id, p.path]))
    const incoming = normalize({ ...cur, ...merged })
    return this.update((d) => {
      for (const k of ['projects', 'scripts', 'replies', 'rules', 'profiles', 'general', 'integrations', 'telegram', 'ai', 'claudeGlobal', 'queue', 'costs'] as const) {
        ;(d as unknown as Record<string, unknown>)[k] = incoming[k]
      }
      d.projects = incoming.projects.map((p) => ({ ...p, path: localPath.get(p.id) || paths[p.id] || '' }))
      d.general = { ...incoming.general, trayHintShown: cur.general.trayHintShown, openAtLogin: cur.general.openAtLogin }
      d.integrations = { ...incoming.integrations, lastApplied: cur.integrations.lastApplied }
      d.watcher = { ...incoming.watcher, seen: cur.watcher.seen, lastCheckAt: cur.watcher.lastCheckAt }
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
      d.ui = { ...d.ui, ...ui, ais: { ...d.ui.ais, ...(ui.ais ?? {}) } }
      // Console num modo de IA que foi desligada: volta para o Terminal
      if (d.ui.consoleMode !== 'terminal' && !d.ui.ais[d.ui.consoleMode]) d.ui.consoleMode = 'terminal'
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
      if (patch.ai) d.ai = { ...d.ai, ...patch.ai }
      if (patch.claudeGlobal) d.claudeGlobal = { ...d.claudeGlobal, ...patch.claudeGlobal }
      if (patch.replies) d.replies = patch.replies
      if (patch.rules) d.rules = patch.rules
      if (patch.profiles) d.profiles = patch.profiles
      if (patch.queue) d.queue = { ...d.queue, ...patch.queue }
      if (patch.costs) d.costs = { ...d.costs, ...patch.costs }
      if (patch.sync) d.sync = { ...d.sync, ...patch.sync }
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

  patchAlert(
    id: string,
    patch: Partial<Pick<DeployAlert, 'status' | 'telegram' | 'telegramMessageId'>>,
    historyLine?: string
  ): AppConfig {
    const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return this.update((d) => {
      d.alerts = d.alerts.map((a) =>
        a.id === id
          ? { ...a, ...patch, history: historyLine ? [...a.history, `${stamp} ${historyLine}`].slice(-30) : a.history }
          : a
      )
    })
  }

  getAlert(id: string): DeployAlert | undefined {
    return this.data.alerts.find((a) => a.id === id)
  }

  setAlertStatus(id: string, status: AlertStatus, via = 'no app'): AppConfig {
    return this.patchAlert(id, { status }, `${status === 'approved' ? 'aprovado' : status === 'dismissed' ? 'descartado' : 'reaberto'} ${via}`)
  }

  clearResolvedAlerts(): AppConfig {
    return this.update((d) => {
      d.alerts = d.alerts.filter((a) => a.status === 'pending')
    })
  }
}

export const store = new ConfigStore()
