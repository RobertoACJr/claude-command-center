import { contextBridge, ipcRenderer } from 'electron'
import type { CommandCenterApi } from '../shared/types'

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
  configPath: () => ipcRenderer.invoke('sys:configPath')
}

contextBridge.exposeInMainWorld('api', api)
