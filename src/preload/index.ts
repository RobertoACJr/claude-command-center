import { contextBridge, ipcRenderer } from 'electron'
import type { AppConfig, AppLog, CommandCenterApi, RemoteSession, RunEvent, WatcherState } from '../shared/types'

function subscribe<T>(channel: string, cb: (v: T) => void): () => void {
  const h = (_e: Electron.IpcRendererEvent, v: T) => cb(v)
  ipcRenderer.on(channel, h)
  return () => ipcRenderer.removeListener(channel, h)
}

const api: CommandCenterApi = {
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
