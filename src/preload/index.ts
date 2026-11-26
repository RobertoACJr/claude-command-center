import { contextBridge, ipcRenderer } from 'electron'
import type {
  ShotSet,
  LimitsState,
  WorkLogState,
  SyncStatus,
  CostGuard,
  QueueState,
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

/** Lista de demandas que a tela tem (atualizada pelos avisos de mudança) */
let demandCache: Demand[] | null = null

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
  projectStart: (id, opts) => ipcRenderer.invoke('project:start', id, opts),
  projectStop: (id, opts) => ipcRenderer.invoke('project:stop', id, opts),
  projectsSyncBranches: (id, target) => ipcRenderer.invoke('projects:syncBranches', id, target),
  dockerStatus: (id) => ipcRenderer.invoke('docker:status', id),
  dockerShell: (id, service) => ipcRenderer.invoke('docker:shell', id, service),
  dockerRestart: (id, service) => ipcRenderer.invoke('docker:restart', id, service),
  dockerExec: (id, service, command) => ipcRenderer.invoke('docker:exec', id, service, command),
  logOpen: (id, override) => ipcRenderer.invoke('log:open', id, override),
  logClose: (id) => ipcRenderer.invoke('log:close', id),
  logAnalyze: (id, text) => ipcRenderer.invoke('log:analyze', id, text),
  portOwner: (port) => ipcRenderer.invoke('port:owner', port),
  portKill: (port) => ipcRenderer.invoke('port:kill', port),
  envProfiles: (id) => ipcRenderer.invoke('env:profiles', id),
  envSwitch: (id, file) => ipcRenderer.invoke('env:switch', id, file),
  profileRun: (id) => ipcRenderer.invoke('profiles:run', id),
  tokenCheck: () => ipcRenderer.invoke('tokens:check'),
  tokenRemove: (t) => ipcRenderer.invoke('tokens:remove', t),
  worklogState: () => ipcRenderer.invoke('worklog:state'),
  limitsState: () => ipcRenderer.invoke('limits:state'),
  accounts: () => ipcRenderer.invoke('accounts:list'),
  projectAccounts: (id) => ipcRenderer.invoke('accounts:project', id),
  onLimits: (cb) => subscribe<LimitsState>('limits:update', cb),
  statuslineSet: (on) => ipcRenderer.invoke('statusline:set', on),
  statuslineInstalled: () => ipcRenderer.invoke('statusline:installed'),
  planGenerate: (id) => ipcRenderer.invoke('plan:generate', id),
  planEdit: (id, plan) => ipcRenderer.invoke('plan:edit', id, plan),
  planStart: (id) => ipcRenderer.invoke('plan:start', id),
  planPause: (id) => ipcRenderer.invoke('plan:pause', id),
  planRelease: (id) => ipcRenderer.invoke('plan:release', id),
  planPreview: (id) => ipcRenderer.invoke('plan:preview', id),
  worklogWeekly: () => ipcRenderer.invoke('worklog:weekly'),
  jiraSync: () => ipcRenderer.invoke('jira:sync'),
  worklogStart: (id) => ipcRenderer.invoke('worklog:start', id),
  worklogStop: () => ipcRenderer.invoke('worklog:stop'),
  worklogDelete: (id) => ipcRenderer.invoke('worklog:delete', id),
  worklogEdit: (id, start, end) => ipcRenderer.invoke('worklog:edit', id, start, end),
  worklogPush: (id, day) => ipcRenderer.invoke('worklog:push', id, day),
  onWorklog: (cb) => {
    const h = (_e: unknown, s: WorkLogState) => cb(s)
    ipcRenderer.on('worklog:update', h)
    return () => ipcRenderer.removeListener('worklog:update', h)
  },
  jiraTransitions: (id) => ipcRenderer.invoke('jira:transitions', id),
  jiraTransition: (id, t) => ipcRenderer.invoke('jira:transition', id, t),
  projectSuggest: (path, dockerCommand) => ipcRenderer.invoke('project:suggest', path, dockerCommand),
  saveProfiles: (list) => ipcRenderer.invoke('profiles:save', list),
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
  demands: async () => (demandCache = await ipcRenderer.invoke('demands:list')),
  demandsBusy: () => ipcRenderer.invoke('demands:busy'),
  onDemands: (cb) =>
    subscribe<{ list?: Demand[]; upsert?: Demand; removed?: string; busy: DemandBusy[] }>('demands:update', (p) => {
      // O app manda só a demanda que mudou: junta aqui com a lista que a tela já tem
      if (p.list) demandCache = p.list
      else if (demandCache) {
        if (p.upsert) {
          const i = demandCache.findIndex((d) => d.id === p.upsert!.id)
          demandCache = i < 0 ? [p.upsert, ...demandCache] : demandCache.map((d, j) => (j === i ? p.upsert! : d))
        }
        if (p.removed) demandCache = demandCache.filter((d) => d.id !== p.removed)
      }
      if (demandCache) cb(demandCache, p.busy)
    }),
  saveDemand: (d) => ipcRenderer.invoke('demands:save', d),
  deleteDemand: (id) => ipcRenderer.invoke('demands:delete', id),
  demandFetchJira: (id) => ipcRenderer.invoke('demands:jira', id),
  demandAnalyze: (id, what) => ipcRenderer.invoke('demands:analyze', id, what),
  demandImplement: (id, message, fresh) => ipcRenderer.invoke('demands:implement', id, message, fresh),
  demandBranch: (id, opts) => ipcRenderer.invoke('demands:branch', id, opts),
  demandStop: (id) => ipcRenderer.invoke('demands:stop', id),
  demandReview: (id) => ipcRenderer.invoke('demands:review', id),
  demandSaveReview: (id, text) => ipcRenderer.invoke('demands:saveReview', id, text),
  demandPublishReview: (id) => ipcRenderer.invoke('demands:publishReview', id),
  demandQueueCopy: (id) => ipcRenderer.invoke('demands:queueCopy', id),
  demandBringQueue: (id) => ipcRenderer.invoke('demands:bringQueue', id),
  demandRemoveQueueCopy: (id) => ipcRenderer.invoke('demands:removeQueueCopy', id),
  demandPrDraft: (id) => ipcRenderer.invoke('demands:prDraft', id),
  demandCreatePr: (id, pr) => ipcRenderer.invoke('demands:createPr', id, pr),
  demandTimings: () => ipcRenderer.invoke('demands:timings'),
  daily: () => ipcRenderer.invoke('daily:text'),
  syncStatus: () => ipcRenderer.invoke('sync:status'),
  syncNow: () => ipcRenderer.invoke('sync:now'),
  onSync: (cb) => subscribe<SyncStatus>('sync:update', cb),
  shots: (scope) => ipcRenderer.invoke('shots:list', scope),
  takeShots: (req) => ipcRenderer.invoke('shots:take', req),
  shotImage: (file) => ipcRenderer.invoke('shots:image', file),
  deleteShots: (id) => ipcRenderer.invoke('shots:delete', id),
  onShots: (cb) => subscribe<ShotSet>('shots:new', cb),
  demandPrComments: (id) => ipcRenderer.invoke('demands:prComments', id),
  demandSendPrComments: (id, ids, comments, toQueue) => ipcRenderer.invoke('demands:sendPrComments', id, ids, comments, toQueue),
  demandDoubts: (id) => ipcRenderer.invoke('demands:doubts', id),
  demandCommentJira: (id, text) => ipcRenderer.invoke('demands:commentJira', id, text),
  demandAddImage: (id, dataUrl) => ipcRenderer.invoke('demands:addImage', id, dataUrl),
  demandRemoveImage: (id, file) => ipcRenderer.invoke('demands:removeImage', id, file),
  projectLearn: (projectId, lesson) => ipcRenderer.invoke('project:learn', projectId, lesson),
  queue: () => ipcRenderer.invoke('queue:state'),
  onQueue: (cb) => subscribe<QueueState>('queue:update', cb),
  queueAdd: (t) => ipcRenderer.invoke('queue:add', t),
  queueCancel: (id) => ipcRenderer.invoke('queue:cancel', id),
  queueRemove: (id) => ipcRenderer.invoke('queue:remove', id),
  queueRetry: (id) => ipcRenderer.invoke('queue:retry', id),
  queueMove: (id, dir) => ipcRenderer.invoke('queue:move', id, dir),
  queueRunNow: () => ipcRenderer.invoke('queue:runNow'),
  queueClearDone: () => ipcRenderer.invoke('queue:clearDone'),
  costs: () => ipcRenderer.invoke('costs:list'),
  costGuard: () => ipcRenderer.invoke('costs:guard'),
  onCosts: (cb) => subscribe<CostGuard>('costs:update', cb),
  costOverrideToday: () => ipcRenderer.invoke('costs:override'),
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
  integrationCheck: (id) => ipcRenderer.invoke('integration:check', id),
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
