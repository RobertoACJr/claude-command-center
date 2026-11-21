import { contextBridge, ipcRenderer } from 'electron'
import type {
  Demand,
  DemandBusy,
  HistoryEntry,
  AppNotification,
  NotificationTarget,
  ApprovalRequest,
  AppConfig,
  AppLog,
  CommandCenterApi,
  ProjectRunState,
  RemoteSession,
  RunEvent,
  UpdateState,
  WatcherState
} from '../shared/types'

function subscribe<T>(channel: string, cb: (v: T) => void): () => void {
  const h = (_e: Electron.IpcRendererEvent, v: T) => cb(v)
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

const api: CommandCenterApi = {
  // Aprovação de permissões do Claude
  onApprovalRequest: (cb) => subscribe<ApprovalRequest>('approval:request', cb),
  onApprovalResolved: (cb) => subscribe<string>('approval:resolved', cb),
  respondApproval: (id, decision) => ipcRenderer.invoke('approval:respond', id, decision),
  pendingApprovals: () => ipcRenderer.invoke('approval:pending'),

  // Atualização e configuração
  updateState: () => ipcRenderer.invoke('update:state'),
  onUpdateState: (cb) => subscribe<UpdateState>('update:state', cb),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  exportConfig: () => ipcRenderer.invoke('config:export'),
  importConfig: () => ipcRenderer.invoke('config:import'),

  // Assistente de configuração
  checkTools: () => ipcRenderer.invoke('setup:checkTools'),
  platform: () => ipcRenderer.invoke('sys:platform'),

  // Melhorias
  runInput: (runId, text) => ipcRenderer.invoke('run:input', runId, text),
  openSystemTerminal: (cwd, preset) => ipcRenderer.invoke('sys:openTerminal', cwd, preset),

  // Fase 6
  sendReply: (alertId, replyId) => ipcRenderer.invoke('alert:sendReply', alertId, replyId),
  geminiCheck: () => ipcRenderer.invoke('gemini:check'),
  geminiSetup: () => ipcRenderer.invoke('gemini:setup'),

  // Fase 5
  projectStart: (id) => ipcRenderer.invoke('project:start', id),
  projectStop: (id) => ipcRenderer.invoke('project:stop', id),
  projectRestart: (id) => ipcRenderer.invoke('project:restart', id),
  projectStates: () => ipcRenderer.invoke('project:states'),
  onProjectStates: (cb) => subscribe<ProjectRunState[]>('project:states', cb),
  remoteSetManual: (id, on) => ipcRenderer.invoke('remote:setManual', id, on),
  setPresence: (status, opts) => ipcRenderer.invoke('presence:set', status, opts),
  onShowWindowRequest: (cb) => subscribe<NotificationTarget | 'go-online'>('window:show', cb),
  checkGuides: (path, guides) => ipcRenderer.invoke('project:checkGuides', path, guides),
  gitInfo: (id) => ipcRenderer.invoke('git:info', id),
  gitPull: (id) => ipcRenderer.invoke('git:pull', id),
  gitBranches: (id) => ipcRenderer.invoke('git:branches', id),
  gitCheckout: (id, branch) => ipcRenderer.invoke('git:checkout', id, branch),
  demandUpdateBase: (id) => ipcRenderer.invoke('demands:updateBase', id),
  demands: () => ipcRenderer.invoke('demands:list'),
  demandsBusy: () => ipcRenderer.invoke('demands:busy'),
  onDemands: (cb) => subscribe<{ list: Demand[]; busy: DemandBusy[] }>('demands:update', (p) => cb(p.list, p.busy)),
  saveDemand: (d) => ipcRenderer.invoke('demands:save', d),
  deleteDemand: (id) => ipcRenderer.invoke('demands:delete', id),
  demandFetchJira: (id) => ipcRenderer.invoke('demands:jira', id),
  demandAnalyze: (id, what) => ipcRenderer.invoke('demands:analyze', id, what),
  demandImplement: (id, message, fresh) => ipcRenderer.invoke('demands:implement', id, message, fresh),
  demandBranch: (id, base) => ipcRenderer.invoke('demands:branch', id, base),
  demandStop: (id) => ipcRenderer.invoke('demands:stop', id),
  history: () => ipcRenderer.invoke('history:list'),
  historyLog: (id) => ipcRenderer.invoke('history:log', id),
  clearHistory: () => ipcRenderer.invoke('history:clear'),
  onHistory: (cb) => subscribe<HistoryEntry[]>('history:update', cb),
  notifications: () => ipcRenderer.invoke('notify:list'),
  onNotification: (cb) => subscribe<AppNotification>('notify:new', cb),
  markNotificationsRead: () => ipcRenderer.invoke('notify:markRead'),
  clearNotifications: () => ipcRenderer.invoke('notify:clear'),

  getConfig: () => ipcRenderer.invoke('config:get'),
  setStatus: (status) => ipcRenderer.invoke('config:setStatus', status),
  saveProject: (p) => ipcRenderer.invoke('projects:save', p),
  deleteProject: (id) => ipcRenderer.invoke('projects:delete', id),
  saveScript: (s) => ipcRenderer.invoke('scripts:save', s),
  deleteScript: (id) => ipcRenderer.invoke('scripts:delete', id),
  saveUi: (ui) => ipcRenderer.invoke('ui:save', ui),
  pickFolder: (defaultPath) => ipcRenderer.invoke('dialog:pickFolder', defaultPath),
  gitBranch: (path) => ipcRenderer.invoke('git:branch', path),
  homeDir: () => ipcRenderer.invoke('sys:home'),
  configPath: () => ipcRenderer.invoke('sys:configPath'),

  run: (req) => ipcRenderer.invoke('run:start', req),
  stop: (runId) => ipcRenderer.invoke('run:stop', runId),
  onRunEvent: (cb) => {
    const h = (_e: Electron.IpcRendererEvent, ev: RunEvent) => cb(ev)
    ipcRenderer.on('run:event', h)
    return () => ipcRenderer.removeListener('run:event', h)
  },
  remoteList: () => ipcRenderer.invoke('remote:list'),
  remoteRestart: (projectId) => ipcRenderer.invoke('remote:restart', projectId),
  onRemoteUpdate: (cb) => {
    const h = (_e: Electron.IpcRendererEvent, s: RemoteSession[]) => cb(s)
    ipcRenderer.on('remote:update', h)
    return () => ipcRenderer.removeListener('remote:update', h)
  },
  copyText: (text) => ipcRenderer.invoke('clipboard:write', text),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  onConfigChanged: (cb) => subscribe<AppConfig>('config:changed', cb),
  onAppLog: (cb) => subscribe<AppLog>('app:log', cb),
  saveSettings: (patch) => ipcRenderer.invoke('settings:save', patch),
  secretsStatus: () => ipcRenderer.invoke('secrets:status'),
  mcpApply: (id) => ipcRenderer.invoke('mcp:apply', id),
  mcpStatus: (id) => ipcRenderer.invoke('mcp:status', id),
  mcpLogin: (id) => ipcRenderer.invoke('mcp:login', id),
  telegramTest: () => ipcRenderer.invoke('telegram:test'),
  telegramDetectChat: () => ipcRenderer.invoke('telegram:detectChat'),
  watcherState: () => ipcRenderer.invoke('watcher:state'),
  onWatcherState: (cb) => subscribe<WatcherState>('watcher:state', cb),
  watcherRunNow: () => ipcRenderer.invoke('watcher:runNow'),
  setWatcherEnabled: (enabled) => ipcRenderer.invoke('watcher:setEnabled', enabled),
  setAlertStatus: (id, status) => ipcRenderer.invoke('alerts:setStatus', id, status),
  clearResolvedAlerts: () => ipcRenderer.invoke('alerts:clearResolved')
}

contextBridge.exposeInMainWorld('api', api)
