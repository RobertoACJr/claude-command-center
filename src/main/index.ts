import { app, BrowserWindow, clipboard, dialog, ipcMain, Notification, shell } from 'electron'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
// Ícone da janela (Linux usa no dock/alt-tab; no Windows o .exe já carrega o build/icon.ico)
import appIcon from '../../build/icons/512x512.png?asset'
import trayIcon from '../../build/icons/64x64.png?asset'
import { configFilePath, store } from './store'
import { getGitBranch } from './git'
import { RunManager } from './runner'
import { RemoteManager } from './remote'
import { secrets } from './secrets'
import { applyIntegration, integrationLogin, integrationStatus } from './mcp'
import { detectChatId, editTelegramMessage, escapeHtml, formatAlert, registerBot, sendTelegram, sendTelegramMessage, TelegramBot } from './telegram'
import { Automation } from './automation'
import { geminiCheck, geminiSetup } from './gemini'
import { setCodexCommand, setGeminiCommand } from './proc'
import { openSystemTerminal } from './systerm'
import { ApprovalServer } from './approval'
import { checkTools } from './setup'
import { Updater } from './updater'
import { readFileSync, writeFileSync } from 'fs'
import { Watcher } from './watcher'
import { ProjectProcesses } from './projects'
import { AppTray, applyOpenAtLogin } from './tray'
import { History } from './history'
import { TelegramControl } from './tgcontrol'
import type {
  AlertStatus,
  AppNotification,
  NotificationKind,
  NotificationTarget,
  ApprovalDecision,
  AppConfig,
  AppLog,
  IntegrationId,
  PresenceStatus,
  Project,
  RunRequest,
  Script,
  SecretKey,
  SettingsPatch,
  TerminalPreset,
  UiState
} from '../shared/types'

let mainWindow: BrowserWindow | null = null
/** true quando o usuário pediu para sair de verdade (não só fechar a janela) */
let quitting = false

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

/** runId → título (para avisar quando um script termina) */
const runTitles = new Map<string, string>()
const history = new History(app.getPath('userData'), (entries) => send('history:update', entries))
const runs = new RunManager((e) => {
  if (e.type === 'start' && e.tab.startsWith('script:')) runTitles.set(e.runId, e.title)
  if (e.type === 'exit' && runTitles.has(e.runId)) {
    const title = runTitles.get(e.runId)!
    runTitles.delete(e.runId)
    if (store.get().general.notifyScriptDone && !e.killed) {
      const ok = e.code === 0
      // Scripts do Telegram e das regras já avisam no Telegram por conta própria
      const toTelegram = !tg.isTelegramRun(e.runId) && !automation.isAlertRun(e.runId)
      notify(`${ok ? '✔' : '✖'} ${title}`, ok ? 'Terminou com sucesso.' : `Falhou (código ${e.code ?? '?'}).`, `tab:${e.tab}`, 'script', 'unfocused', toTelegram)
    }
  }
  history.handle(e)
  tg.handleRunEvent(e)
  projects.handleRunEvent(e)
  automation.handleRunEvent(e)
  if (e.type === 'exit') approvals.runEnded(e.runId)
  send('run:event', e)
})
const projects = new ProjectProcesses(runs, (states) => {
  send('project:states', states)
  // Aviso nativo se um projeto cair sozinho
  for (const s of states) {
    if (s.state === 'crashed' && !notifiedCrash.has(s.projectId)) {
      notifiedCrash.add(s.projectId)
      const p = store.get().projects.find((x) => x.id === s.projectId)
      notify(`${p?.name ?? 'Projeto'} caiu`, `Saiu com código ${s.exitCode ?? '?'}. Veja o terminal do projeto.`, `tab:project:${s.projectId}`, 'projeto', 'always')
    }
    if (s.state !== 'crashed') notifiedCrash.delete(s.projectId)
  }
})
const notifiedCrash = new Set<string>()
/** Sessões que já avisaram "ativa" (para notificar só na primeira vez que o link aparece) */
const remoteNotified = new Set<string>()
const remote = new RemoteManager((sessions) => {
  send('remote:update', sessions)
  for (const s of sessions) {
    const key = `${s.projectId}:${s.startedAt}`
    if (s.state === 'active' && s.url && !remoteNotified.has(key)) {
      remoteNotified.add(key)
      notify(`📡 Remote Control ativo: ${s.projectName}`, 'Abra pelo app do Claude no celular ou pelo link no card do projeto.', undefined, 'remote', 'never')
      // Ligado pelo Telegram (ou no modo Ausente): o link vai para lá
      const cfg = store.get()
      if ((tg.takeRemoteRequest(s.projectId) || cfg.status === 'off') && telegramReady()) {
        void sendTelegramMessage(cfg.telegram.chatId, `📡 <b>Remote Control ativo</b> · ${escapeHtml(s.projectName)}\n${escapeHtml(s.url)}`)
      }
    }
  }
})

let lastWatcherError = ''
const appLog = (l: AppLog) => {
  send('app:log', l)
  // Falha do Vigia vira notificação (sem repetir a mesma em sequência)
  if (l.text.startsWith('[Vigia] falha')) {
    if (l.text !== lastWatcherError) notify('Vigia com problema', l.text.replace('[Vigia] falha: ', ''), 'tab:system', 'vigia')
    lastWatcherError = l.text
  } else if (l.text.startsWith('[Vigia] verificado')) lastWatcherError = ''
}
let lastUpdatePhase = ''
const updater = new Updater((st) => {
  send('update:state', st)
  if (st.phase === 'ready' && lastUpdatePhase !== 'ready') {
    notify(`Versão ${st.version} pronta`, 'Instale quando quiser: botão no topo do app, ou ao sair pelo menu da bandeja.', 'settings', 'atualizacao')
    appLog({ kind: 'success', text: `[Atualização] versão ${st.version} baixada e pronta para instalar` })
  }
  lastUpdatePhase = st.phase
})
const automation = new Automation(runs, appLog)

// ---------- Aprovação de permissões do Claude ----------
/** Mensagens do Telegram de cada pedido de permissão (para editar com a resposta) */
const approvalTelegram = new Map<string, number>()
const approvals = new ApprovalServer({
  onRequest: (r) => {
    send('approval:request', r)
    const cfg = store.get()
    notify('🔐 O Claude pede permissão', `${r.scopeName}: ${r.toolName} ${r.summary}`.slice(0, 200), undefined, 'permissao')
    // No modo Ausente (ou se a ordem veio do Telegram), pergunta também pelo Telegram
    if ((cfg.status === 'off' || tg.isTelegramRun(r.runId)) && cfg.telegram.interactive && telegramReady()) {
      void sendTelegramMessage(
        cfg.telegram.chatId,
        `🔐 <b>O Claude pede permissão</b> · ${escapeHtml(r.scopeName)}\n\n<b>${escapeHtml(r.toolName)}</b>\n<code>${escapeHtml(r.summary.slice(0, 600))}</code>`,
        [
          [
            { text: '✅ Permitir', callback_data: `pa:${r.id}` },
            { text: '⛔ Negar', callback_data: `pd:${r.id}` }
          ],
          [{ text: `♾ Sempre permitir ${r.rule}`.slice(0, 60), callback_data: `pw:${r.id}` }]
        ]
      ).then((m) => m.messageId && approvalTelegram.set(r.id, m.messageId))
    }
  },
  onResolved: (id) => {
    send('approval:resolved', id)
    approvalTelegram.delete(id)
  }
})
runs.setClaudeArgsProvider((runId, req) => approvals.claudeArgs(runId, req, store.get()))

function respondApproval(id: string, decision: ApprovalDecision, via: string): string {
  const tgMsg = approvalTelegram.get(id)
  const r = approvals.respond(id, decision)
  if (!r) return 'Esse pedido já foi respondido.'
  if (decision === 'always') store.addAllowedTool(r.projectId, r.rule)
  const label = decision === 'deny' ? 'negado' : decision === 'always' ? `permitido sempre (${r.rule})` : 'permitido'
  appLog({ kind: decision === 'deny' ? 'info' : 'success', text: `[Permissão] ${r.scopeName}: ${r.toolName} ${label} ${via}` })
  const chat = store.get().telegram.chatId
  if (tgMsg && chat) {
    void editTelegramMessage(
      chat,
      tgMsg,
      `🔐 ${escapeHtml(r.scopeName)} · <b>${escapeHtml(r.toolName)}</b>\n<code>${escapeHtml(r.summary.slice(0, 600))}</code>\n\n${decision === 'deny' ? '⛔' : '✅'} ${escapeHtml(label)} ${escapeHtml(via)}`
    )
  }
  return `${r.toolName}: ${label}.`
}
const watcher = new Watcher(
  (s) => {
    send('watcher:state', s)
    tray.update(store.get(), s.phase === 'idle' || s.phase === 'checking')
  },
  appLog,
  (a) => automation.onNewAlert(a)
)

// ---------- Telegram: botões e comandos ----------
const fmtTime = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

async function telegramStatus(): Promise<string> {
  const cfg = store.get()
  const st = watcher.getState()
  const pending = cfg.alerts.filter((a) => a.status === 'pending')
  const running = projects
    .list()
    .filter((s) => s.state === 'running' || s.state === 'starting')
    .map((s) => cfg.projects.find((p) => p.id === s.projectId)?.name ?? '?')
  return [
    cfg.status === 'off' ? `🌙 <b>Ausente</b> desde ${fmtTime(cfg.statusSince)}` : `🟣 <b>Online</b> (no PC)`,
    `👁 Vigia: ${st.phase === 'idle' || st.phase === 'checking' ? 'ligado' : st.phase === 'blocked' ? 'bloqueado' : 'desligado'}${st.lastResult ? ` · último: ${escapeHtml(st.lastResult)}` : ''}`,
    `🔔 Pedidos pendentes: ${pending.length}`,
    `▶ Projetos rodando: ${running.length ? escapeHtml(running.join(', ')) : 'nenhum'}`,
    `📡 Remote Control: ${remote.activeCount()} sessão(ões)`
  ].join('\n')
}

const tg = new TelegramControl({
  runs,
  projects,
  remote,
  history,
  status: () => telegramStatus(),
  log: (text, kind = 'info') => appLog({ kind, text })
})

function telegramReady(): boolean {
  return !!store.get().telegram.chatId && !!secrets.get('telegram.token')
}

const bot = new TelegramBot({
  settings: () => ({ chatId: store.get().telegram.chatId, interactive: store.get().telegram.interactive }),
  log: (text, kind = 'info') => appLog({ kind, text }),
  onCallback: async (data) => {
    const [kind, id] = data.split(':')
    if (kind === 'k') return tg.callback(id)
    if (kind === 'ap') return (await automation.approve(id, 'pelo Telegram', false)).message
    if (kind === 'ds') return (await automation.dismiss(id, 'pelo Telegram')).message
    if (kind === 'rr') return (await automation.approve(id, 'pelo Telegram', true)).message
    if (kind === 'pa' || kind === 'pd' || kind === 'pw') {
      return respondApproval(id, kind === 'pa' ? 'allow' : kind === 'pd' ? 'deny' : 'always', 'pelo Telegram')
    }
    if (kind === 'on') {
      setPresence('on', id === 'keep')
      return id === 'keep' ? 'Online, sessões remotas mantidas.' : 'Online, sessões remotas encerradas.'
    }
    return 'Ação desconhecida.'
  },
  onText: (text) => tg.text(text),
  onCommand: async (cmd, args) => {
    if (await tg.command(cmd, args)) return
    const cfg = store.get()
    const chat = cfg.telegram.chatId
    const say = (html: string) => sendTelegramMessage(chat, html)
    switch (cmd) {
      case 'status':
        await say(await telegramStatus())
        break
      case 'ausente':
        setPresence('off')
        await say('🌙 Modo <b>Ausente</b> ligado. Vigia e Remote Control automáticos ativos.')
        break
      case 'online':
        if (remote.activeCount() > 0) {
          await sendTelegramMessage(chat, `Há ${remote.activeCount()} sessão(ões) de Remote Control abertas. O que faço com elas?`, [
            [
              { text: 'Encerrar sessões', callback_data: 'on:end' },
              { text: 'Manter ligadas', callback_data: 'on:keep' }
            ]
          ])
        } else {
          setPresence('on', false)
          await say('🟣 Modo <b>Online</b>.')
        }
        break
      case 'pendentes': {
        const pending = cfg.alerts.filter((a) => a.status === 'pending')
        if (!pending.length) {
          await say('Nenhum pedido pendente. 🎉')
          break
        }
        for (const a of pending.slice(-5)) {
          const name = cfg.projects.find((p) => p.id === a.projectId)?.name ?? ''
          const r = await sendTelegramMessage(chat, formatAlert(a, name), automation.telegramButtons(a))
          if (r.messageId) store.patchAlert(a.id, { telegramMessageId: r.messageId })
        }
        break
      }
      case 'vigia':
        watcher.runNow()
        await say('👁 Verificando o Google Chat agora…')
        break
      default:
        await say(tg.help)
    }
  }
})
registerBot(bot)

function showWindow(what?: NotificationTarget | 'go-online') {
  if (!mainWindow) createWindow()
  if (mainWindow?.isMinimized()) mainWindow.restore()
  mainWindow?.show()
  mainWindow?.focus()
  if (what) send('window:show', what)
}

// ---------- Central de notificações (sino do app + notificação do sistema) ----------
const notificationsFile = join(app.getPath('userData'), 'notifications.json')
const notifications: AppNotification[] = (() => {
  try {
    const l = JSON.parse(readFileSync(notificationsFile, 'utf8'))
    return Array.isArray(l) ? l.slice(0, 100) : []
  } catch {
    return []
  }
})()
let notifSaveTimer: NodeJS.Timeout | null = null
function saveNotificationsSoon(): void {
  if (notifSaveTimer) return
  notifSaveTimer = setTimeout(() => {
    notifSaveTimer = null
    try {
      writeFileSync(notificationsFile, JSON.stringify(notifications))
    } catch {
      /* ignora */
    }
  }, 1000)
}

/**
 * Registra no sino do app e, se ligado nas preferências, mostra a notificação do sistema.
 * desktop: 'always' (mesmo com a janela em foco), 'unfocused' (padrão: só se você não estiver olhando), 'never'.
 */
function notify(
  title: string,
  body: string,
  target?: NotificationTarget,
  kind: NotificationKind = 'sistema',
  desktop: 'always' | 'unfocused' | 'never' = 'unfocused',
  /** Mandar também pro Telegram no modo Ausente (pedidos e permissões já têm mensagem própria) */
  toTelegram = kind === 'projeto' || kind === 'script' || kind === 'vigia' || kind === 'atualizacao'
) {
  const n: AppNotification = { id: randomUUID(), at: Date.now(), kind, title, body, target, read: false }
  notifications.unshift(n)
  notifications.splice(100)
  saveNotificationsSoon()
  send('notify:new', n)
  const cfg = store.get()
  if (toTelegram && cfg.status === 'off' && cfg.telegram.forwardNotifications && telegramReady()) {
    void sendTelegramMessage(cfg.telegram.chatId, `🔔 <b>${escapeHtml(title)}</b>\n${escapeHtml(body)}`)
  }
  const focused = !!mainWindow?.isVisible() && mainWindow.isFocused()
  const want = desktop === 'always' || (desktop === 'unfocused' && !focused)
  if (!want || !store.get().general.desktopNotifications || !Notification.isSupported()) return
  const dn = new Notification({ title, body, icon: appIcon })
  dn.on('click', () => showWindow(target))
  dn.show()
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
  setGeminiCommand(cfg.ai.geminiCommand)
  setCodexCommand(cfg.ai.codexCommand)
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
      'alerts',
      'pedido',
      'always'
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
      notify('Continuo rodando aqui', 'O app está na bandeja, ao lado do relógio. Use "Sair" no menu dele para encerrar tudo.', undefined, 'sistema', 'always')
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
    // Pelo app: aprovar/descartar atualiza também a mensagem do Telegram e manda a resposta da regra
    if (status === 'approved') await automation.approve(id, 'no app', false)
    else if (status === 'dismissed') await automation.dismiss(id, 'no app')
    else store.setAlertStatus(id, status)
    return store.get()
  })
  ipcMain.handle('alert:sendReply', (_e, alertId: string, replyId: string) => automation.sendReply(alertId, replyId, 'manual'))
  ipcMain.handle('gemini:check', () => geminiCheck())
  ipcMain.handle('approval:respond', (_e, id: string, decision: ApprovalDecision) => {
    respondApproval(id, decision, 'no app')
  })
  ipcMain.handle('approval:pending', () => approvals.list())
  ipcMain.handle('setup:checkTools', () => checkTools())
  ipcMain.handle('notify:list', () => notifications)
  ipcMain.handle('notify:markRead', () => {
    for (const n of notifications) n.read = true
    saveNotificationsSoon()
  })
  ipcMain.handle('notify:clear', () => {
    notifications.splice(0)
    saveNotificationsSoon()
  })
  ipcMain.handle('history:list', () => history.list())
  ipcMain.handle('history:log', (_e, id: string) => history.log(String(id)))
  ipcMain.handle('history:clear', () => history.clear())
  ipcMain.handle('update:state', () => updater.getState())
  ipcMain.handle('update:check', () => updater.check())
  ipcMain.handle('update:install', () => {
    quitting = true
    updater.installNow()
  })
  ipcMain.handle('config:export', async () => {
    const opts: Electron.SaveDialogOptions = {
      title: 'Exportar configuração',
      defaultPath: join(app.getPath('documents'), 'claude-command-center-config.json'),
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const r = mainWindow ? await dialog.showSaveDialog(mainWindow, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return { ok: false, message: 'Cancelado.' }
    writeFileSync(r.filePath, JSON.stringify(store.exportable(), null, 2), 'utf-8')
    return { ok: true, message: `Exportado para ${r.filePath} (sem tokens).` }
  })
  ipcMain.handle('config:import', async () => {
    const opts: Electron.OpenDialogOptions = {
      title: 'Importar configuração',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    }
    const r = mainWindow ? await dialog.showOpenDialog(mainWindow, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths[0]) return { ok: false, message: 'Cancelado.' }
    try {
      const n = store.importFrom(JSON.parse(readFileSync(r.filePaths[0], 'utf-8')))
      return {
        ok: true,
        message: `Importado: ${n.projects} projeto(s), ${n.scripts} script(s), ${n.rules} regra(s). Confira as pastas dos projetos e cadastre os tokens de novo.`
      }
    } catch (err) {
      return { ok: false, message: `Arquivo inválido: ${(err as Error).message}` }
    }
  })
  ipcMain.handle('sys:platform', () => process.platform)
  ipcMain.handle('run:input', (_e, runId: string, text: string) => runs.sendInput(runId, String(text)))
  ipcMain.handle('sys:openTerminal', (_e, cwd: string, preset?: TerminalPreset) => openSystemTerminal(cwd, preset))
  ipcMain.handle('gemini:setup', () => geminiSetup(store.get()))
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

  app.whenReady().then(async () => {
    if (process.platform === 'win32') app.setAppUserModelId('com.jraya.claude-command-center')
    const cfg = store.load()
    setGeminiCommand(cfg.ai.geminiCommand)
    setCodexCommand(cfg.ai.codexCommand)
    bot.start()
    updater.start()
    await approvals.start().catch((err) => console.error('[approval]', err))
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
    history.flush()
    updater.stop()
    bot.stop()
    approvals.stop()
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
