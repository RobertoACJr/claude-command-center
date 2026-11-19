import { app, BrowserWindow, clipboard, dialog, ipcMain, Notification, shell } from 'electron'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
// Ícone da janela (Linux usa no dock/alt-tab; no Windows o .exe já carrega o build/icon.ico)
import appIcon from '../../build/icons/512x512.png?asset'
import trayIcon from '../../build/icons/64x64.png?asset'
import { configFilePath, store } from './store'
import { getGitBranch } from './git'
import { RunManager } from './runner'
import { RemoteManager } from './remote'
import { secrets } from './secrets'
import { applyIntegration, integrationLogin, integrationStatus } from './mcp'
import { detectChatId, formatDecision, sendTelegram } from './telegram'
import { Watcher } from './watcher'
import { ProjectProcesses } from './projects'
import { AppTray, applyOpenAtLogin } from './tray'
import type {
  AlertStatus,
  AppConfig,
  AppLog,
  IntegrationId,
  PresenceStatus,
  Project,
  RunRequest,
  Script,
  SecretKey,
  SettingsPatch,
  UiState
} from '../shared/types'

let mainWindow: BrowserWindow | null = null
/** true quando o usuário pediu para sair de verdade (não só fechar a janela) */
let quitting = false

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

const runs = new RunManager((e) => {
  projects.handleRunEvent(e)
  send('run:event', e)
})
const projects = new ProjectProcesses(runs, (states) => {
  send('project:states', states)
  // Aviso nativo se um projeto cair sozinho
  for (const s of states) {
    if (s.state === 'crashed' && !notifiedCrash.has(s.projectId)) {
      notifiedCrash.add(s.projectId)
      const p = store.get().projects.find((x) => x.id === s.projectId)
      notify(`${p?.name ?? 'Projeto'} caiu`, `Saiu com código ${s.exitCode ?? '?'}. Veja o terminal do projeto.`, 'terminals')
    }
    if (s.state !== 'crashed') notifiedCrash.delete(s.projectId)
  }
})
const notifiedCrash = new Set<string>()
const remote = new RemoteManager((sessions) => send('remote:update', sessions))

const appLog = (l: AppLog) => send('app:log', l)
const watcher = new Watcher(
  (s) => {
    send('watcher:state', s)
    tray.update(store.get(), s.phase === 'idle' || s.phase === 'checking')
  },
  appLog
)

function showWindow(what?: 'alerts' | 'terminals' | 'go-online') {
  if (!mainWindow) createWindow()
  if (mainWindow?.isMinimized()) mainWindow.restore()
  mainWindow?.show()
  mainWindow?.focus()
  if (what) send('window:show', what)
}

function notify(title: string, body: string, open?: 'alerts' | 'terminals') {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body, icon: appIcon })
  n.on('click', () => showWindow(open))
  n.show()
}

/** Mudança de presença. Indo para Ausente, o que já roda continua; voltando, o renderer pergunta. */
function setPresence(status: PresenceStatus, keepRemote = true): AppConfig {
  remote.presenceChanged(status === 'off' ? true : keepRemote)
  return store.setStatus(status)
}

const tray = new AppTray(trayIcon, {
  show: () => showWindow(),
  showAlerts: () => showWindow('alerts'),
  setAway: () => setPresence('off'),
  goOnline: () => {
    // Com sessões remotas abertas, quem decide encerrar ou manter é você (na janela)
    if (remote.activeCount() > 0) showWindow('go-online')
    else setPresence('on', false)
  },
  toggleWatcher: () => store.setWatcherEnabled(!store.get().watcher.enabled),
  quit: () => {
    quitting = true
    app.quit()
  }
})

// Toda mudança de config: Remote Control, Vigia, processos e bandeja se reconciliam; a interface recebe a versão nova
let lastPending = -1
let lastOpenAtLogin: boolean | null = null
store.onChange((cfg) => {
  remote.sync(cfg)
  watcher.evaluate(cfg)
  projects.sync(cfg)
  syncGeneral(cfg)
  const st = watcher.getState()
  tray.update(cfg, st.phase === 'idle' || st.phase === 'checking')
  const pending = cfg.alerts.filter((a) => a.status === 'pending').length
  if (lastPending >= 0 && pending > lastPending) {
    const a = cfg.alerts.filter((x) => x.status === 'pending').at(-1)
    notify(
      '🚨 Pedido de deploy',
      a ? `${a.requester || 'Alguém'} pediu ${a.card || a.branch || 'deploy'} → ${a.environment || '?'}` : 'Novo pedido',
      'alerts'
    )
  }
  lastPending = pending
  send('config:changed', cfg)
})

/** Bandeja e "abrir com o sistema" acompanham as preferências */
function syncGeneral(cfg: AppConfig) {
  if (cfg.general.closeToTray && !tray.exists()) tray.create()
  if (!cfg.general.closeToTray && tray.exists()) tray.destroy()
  if (lastOpenAtLogin !== cfg.general.openAtLogin) {
    const firstRun = lastOpenAtLogin === null
    lastOpenAtLogin = cfg.general.openAtLogin
    // Na primeira passada só aplica se estiver ligado (não mexe no sistema à toa)
    if (!firstRun || cfg.general.openAtLogin) {
      const warn = applyOpenAtLogin(cfg.general.openAtLogin)
      if (warn && !firstRun) appLog({ kind: 'info', text: warn })
    }
  }
}

const INTEGRATIONS: IntegrationId[] = ['github', 'jira', 'gchat']
const SECRET_KEYS: SecretKey[] = ['github.pat', 'jira.token', 'gchat.clientSecret', 'gchat.customJson', 'telegram.token']

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
    ...(process.platform === 'linux' ? { icon: appIcon } : {}),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // Abriu com o sistema (--hidden): fica só na bandeja
  const startHidden = process.argv.includes('--hidden') && store.get().general.closeToTray
  mainWindow.on('ready-to-show', () => {
    if (!startHidden) mainWindow?.show()
  })

  // Fechar a janela só esconde: Vigia, Remote Control e projetos continuam rodando
  mainWindow.on('close', (e) => {
    const cfg = store.get()
    if (quitting || !cfg.general.closeToTray || !tray.exists()) return
    e.preventDefault()
    mainWindow?.hide()
    if (!cfg.general.trayHintShown) {
      notify('Continuo rodando aqui', 'O app está na bandeja, ao lado do relógio. Use "Sair" no menu dele para encerrar tudo.')
      store.markTrayHintShown()
    }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })

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
  ipcMain.handle('config:setStatus', (_e, status: PresenceStatus) => setPresence(status))
  ipcMain.handle('presence:set', (_e, status: PresenceStatus, opts?: { keepRemote?: boolean }) =>
    setPresence(status === 'off' ? 'off' : 'on', opts?.keepRemote ?? true)
  )
  ipcMain.handle('projects:save', (_e, p: Project) => store.saveProject(p))
  ipcMain.handle('projects:delete', (_e, id: string) => store.deleteProject(id))
  ipcMain.handle('scripts:save', (_e, s: Script) => store.saveScript(s))
  ipcMain.handle('scripts:delete', (_e, id: string) => store.deleteScript(id))
  ipcMain.handle('ui:save', (_e, ui: Partial<UiState>) => store.saveUi(ui))
  ipcMain.handle('git:branch', (_e, path: string) => getGitBranch(path))
  ipcMain.handle('sys:home', () => homedir())
  ipcMain.handle('sys:configPath', () => configFilePath())

  // Fase 5: projetos executáveis, Remote Control por projeto
  ipcMain.handle('project:start', (_e, id: string) => projects.start(id))
  ipcMain.handle('project:stop', (_e, id: string) => projects.stop(id))
  ipcMain.handle('project:restart', (_e, id: string) => projects.restart(id))
  ipcMain.handle('project:states', () => projects.list())
  ipcMain.handle('remote:setManual', (_e, id: string, on: boolean) => remote.setManual(id, Boolean(on)))

  // Fase 2: execução
  ipcMain.handle('run:start', (_e, req: RunRequest) => runs.start(req))
  ipcMain.handle('run:stop', (_e, runId: string) => runs.stop(runId))
  ipcMain.handle('remote:list', () => remote.list())
  ipcMain.handle('remote:restart', (_e, projectId: string) => remote.restart(projectId))
  ipcMain.handle('clipboard:write', (_e, text: string) => clipboard.writeText(String(text)))
  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (/^https:\/\//.test(url)) return shell.openExternal(url)
  })

  // Fase 3: configurações, MCPs, Telegram, Vigia
  ipcMain.handle('settings:save', (_e, patch: SettingsPatch) => {
    for (const [k, v] of Object.entries(patch.secrets ?? {})) {
      if (SECRET_KEYS.includes(k as SecretKey) && v !== undefined) secrets.set(k as SecretKey, v)
    }
    return store.saveSettings({ ...patch, secrets: undefined })
  })
  ipcMain.handle('secrets:status', () => secrets.status())
  ipcMain.handle('mcp:apply', async (_e, id: IntegrationId) => {
    if (!INTEGRATIONS.includes(id)) return { ok: false, message: 'Integração desconhecida' }
    appLog({ kind: 'info', text: `[MCP] aplicando ${id}…` })
    const r = await applyIntegration(id, store.get())
    store.setApplied(id, r.ok, r.message)
    appLog({ kind: r.ok ? 'success' : 'error', text: `[MCP] ${id}: ${r.message.split('\n')[0]}` })
    return r
  })
  ipcMain.handle('mcp:status', (_e, id: IntegrationId) =>
    INTEGRATIONS.includes(id) ? integrationStatus(id) : { ok: false, message: 'Integração desconhecida' }
  )
  ipcMain.handle('mcp:login', async (_e, id: IntegrationId) => {
    if (!INTEGRATIONS.includes(id)) return { ok: false, message: 'Integração desconhecida' }
    appLog({ kind: 'info', text: `[MCP] login ${id}: siga no navegador que vai abrir…` })
    const r = await integrationLogin(id, (line) => appLog({ kind: 'info', text: `[MCP] ${line}` }))
    appLog({ kind: r.ok ? 'success' : 'error', text: `[MCP] login ${id}: ${r.ok ? 'ok' : r.message}` })
    return r
  })
  ipcMain.handle('telegram:test', () =>
    sendTelegram(store.get().telegram.chatId, '✅ <b>Claude Command Center</b>\nNotificações funcionando.')
  )
  ipcMain.handle('telegram:detectChat', () => detectChatId())
  ipcMain.handle('watcher:state', () => watcher.getState())
  ipcMain.handle('watcher:runNow', () => watcher.runNow())
  ipcMain.handle('watcher:setEnabled', (_e, enabled: boolean) => store.setWatcherEnabled(Boolean(enabled)))
  ipcMain.handle('alerts:setStatus', async (_e, id: string, status: AlertStatus) => {
    const cfg = store.setAlertStatus(id, status)
    const alert = cfg.alerts.find((a) => a.id === id)
    if (alert && status !== 'pending' && alert.telegram === 'sent' && secrets.get('telegram.token')) {
      void sendTelegram(cfg.telegram.chatId, formatDecision(alert, status === 'approved'))
    }
    return cfg
  })
  ipcMain.handle('alerts:clearResolved', () => store.clearResolvedAlerts())

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
  app.on('second-instance', () => showWindow())

  app.whenReady().then(() => {
    if (process.platform === 'win32') app.setAppUserModelId('com.jraya.claude-command-center')
    const cfg = store.load()
    registerIpc()
    createWindow()
    // Se o app abriu já em OFF, sobe as sessões remotas e o Vigia
    syncGeneral(cfg)
    projects.sync(cfg)
    tray.update(cfg, false)
    mainWindow?.webContents.once('did-finish-load', () => {
      remote.sync(cfg)
      watcher.evaluate(cfg)
    })
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  // Encerra tudo que o app abriu: nada de processo órfão/zumbi
  app.on('before-quit', () => {
    quitting = true
    projects.stopPolling()
    tray.destroy()
    watcher.stop()
    runs.stopAllSync()
    remote.stopAllSync()
  })
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      watcher.stop()
      runs.stopAllSync()
      remote.stopAllSync()
      app.exit(0)
    })
  }

  app.on('window-all-closed', () => {
    // Com a bandeja ativa a janela só se esconde, então isto só roda quando a bandeja está desligada
    if (process.platform !== 'darwin' && !tray.exists()) app.quit()
  })
}
