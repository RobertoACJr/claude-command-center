import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { configFilePath, store } from './store'
import { getGitBranch } from './git'
import type { PresenceStatus, Project, Script, UiState } from '../shared/types'

let mainWindow: BrowserWindow | null = null

function preloadPath(): string {
  const dir = join(__dirname, '../preload')
  const found = ['index.js', 'index.cjs', 'index.mjs'].map((f) => join(dir, f)).find((p) => existsSync(p))
  return found ?? join(dir, 'index.js')
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: 'Claude Command Center',
    backgroundColor: '#09090B',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // Links externos abrem no navegador, nunca dentro do app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('config:get', () => store.get())
  ipcMain.handle('config:setStatus', (_e, status: PresenceStatus) => store.setStatus(status))
  ipcMain.handle('projects:save', (_e, p: Project) => store.saveProject(p))
  ipcMain.handle('projects:delete', (_e, id: string) => store.deleteProject(id))
  ipcMain.handle('scripts:save', (_e, s: Script) => store.saveScript(s))
  ipcMain.handle('scripts:delete', (_e, id: string) => store.deleteScript(id))
  ipcMain.handle('ui:save', (_e, ui: Partial<UiState>) => store.saveUi(ui))
  ipcMain.handle('git:branch', (_e, path: string) => getGitBranch(path))
  ipcMain.handle('sys:home', () => homedir())
  ipcMain.handle('sys:configPath', () => configFilePath())

  ipcMain.handle('dialog:pickFolder', async (_e, defaultPath?: string) => {
    const opts: Electron.OpenDialogOptions = {
      title: 'Selecionar pasta do projeto',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: defaultPath || homedir()
    }
    const res = mainWindow ? await dialog.showOpenDialog(mainWindow, opts) : await dialog.showOpenDialog(opts)
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]
  })
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('com.jraya.claude-command-center')
    store.load()
    registerIpc()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
