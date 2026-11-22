import { app, BrowserWindow, clipboard, dialog, ipcMain, Notification, shell } from 'electron'
import { existsSync } from 'fs'
import { writeFileAtomic } from './fsutil'
import { homedir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
// Ícone da janela (Linux usa no dock/alt-tab; no Windows o .exe já carrega o build/icon.ico)
import appIcon from '../../build/icons/512x512.png?asset'
import trayIcon from '../../build/icons/64x64.png?asset'
import { configFilePath, store } from './store'
import { getGitBranch, gitBranches, gitCheckout, gitInfo, gitPull } from './git'
import { checkGuides, guidesInstruction } from './guides'
import { RunManager } from './runner'
import { RemoteManager } from './remote'
import { secrets } from './secrets'
import { applyIntegration, integrationCheck, integrationLogin, integrationStatus } from './mcp'
import { detectChatId, editTelegramMessage, escapeHtml, formatAlert, registerBot, sendTelegram, sendTelegramMessage, sendTelegramPhoto, TelegramBot } from './telegram'
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
import { DemandManager } from './demands'
import { costs } from './costs'
import { QueueManager, queueSummary } from './queue'
import { buildDaily } from './daily'
import { SyncManager } from './sync'
import { isUp, ShotManager } from './shots'
import { captureWithElectron, makeThumb } from './capture'
import { learn } from './guides'
import type {
  AlertStatus,
  AppNotification,
  Demand,
  PrComment,
  QueueTask,
  ShotSet,
  RunEvent,
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
  if (e.type === 'usage') recordRunCost(e)
  history.handle(e)
  queue.handleRunEvent(e)
  demandsDoneNotice(e)
  demands.handleRunEvent(e)
  tg.handleRunEvent(e)
  projects.handleRunEvent(e)
  automation.handleRunEvent(e)
  if (e.type === 'exit') approvals.runEnded(e.runId)
  send('run:event', e)
})
const demands = new DemandManager(app.getPath('userData'), runs, (list, busy, change) => {
  // Só o que mudou vai para a tela (antes ia a lista inteira, com transcrições, a cada tecla)
  send('demands:update', change?.all || !change ? { list, busy } : { upsert: change.upsert, removed: change.removed, busy })
  refreshTrayActivity()
})
/** Hélice da bandeja gira enquanto a fila, o Vigia ou uma demanda trabalham */
function refreshTrayActivity(): void {
  try {
    const busy =
      queue.state().tasks.some((t) => t.status === 'rodando') || watcher.getState().phase === 'checking' || demands.busyList().length > 0
    const phase = watcher.getState().phase
    const tone = store.get().status === 'off' ? 'away' : phase === 'idle' || phase === 'checking' ? 'vigia' : 'online'
    tray.setActivity(busy, tone)
  } catch {
    /* durante a inicialização algum ainda não existe */
  }
}

// ---------- Custos ----------
costs.init(app.getPath('userData'), {
  limit: () => store.get().costs.dailyLimitUsd,
  onChange: (g) => send('costs:update', g),
  onLimit: (g) => {
    notify(
      '💸 Limite diário de gastos atingido',
      `Hoje: US$ ${g.todayUsd.toFixed(2)} (limite US$ ${g.limitUsd.toFixed(2)}). Fila, Vigia e regras automáticas ficam pausados até amanhã, ou libere no painel de custos.`,
      'costs',
      'custos',
      'always',
      true
    )
  }
})
/** Custo de uma execução do app (histórico sabe de onde veio) */
function recordRunCost(e: Extract<RunEvent, { type: 'usage' }>): void {
  const h = history.list().find((x) => x.id === e.runId)
  const kind = h?.kind === 'gemini' || h?.kind === 'codex' ? h.kind : 'claude'
  costs.record({
    source: h?.origin ?? 'app',
    ai: kind,
    title: h?.title ?? 'Execução',
    projectId: h?.projectId,
    demandId: e.tab.startsWith('demand:') ? e.tab.slice('demand:'.length) : undefined,
    runId: e.runId,
    usd: e.costUsd,
    tokens: e.tokens
  })
}

// ---------- Daily ----------
function dailyText(): string {
  const cfg = store.get()
  return buildDaily({ now: Date.now(), demands: demands.all(), history: history.list(), queue: queue.state().tasks, projects: cfg.projects })
}

// ---------- Sincronizar entre PCs ----------
const sync = new SyncManager(app.getPath('userData'), {
  config: () => store.get(),
  applyConfig: (merged, paths) => {
    const c = store.applySynced(merged, paths)
    send('config:changed', c)
  },
  demands: () => demands.all(),
  applyDemands: (list) => demands.replaceAll(list),
  onChange: (s) => send('sync:update', s)
})
let syncTimer: NodeJS.Timeout | null = null
function scheduleSync(): void {
  if (syncTimer) clearInterval(syncTimer)
  syncTimer = null
  const c = store.get().sync
  if (!c.enabled || !c.repoUrl) return
  syncTimer = setInterval(() => void sync.sync().then((r) => !r.ok && appLog({ kind: 'error', text: `[Sincronizar] ${r.message}` })), 15 * 60_000)
}

// ---------- Telas (front) e checagem da API (back) ----------
const shots = new ShotManager(app.getPath('userData'), captureWithElectron, (s) => send('shots:new', s), makeThumb)
/** Prints antes/depois de uma tarefa da fila, se o projeto for front/back e estiver no ar */
async function queueShots(t: QueueTask, label: 'antes' | 'depois'): Promise<ShotSet[] | null> {
  const p = store.get().projects.find((x) => x.id === t.projectId)
  if (!p) return null
  const w = ShotManager.wants(p)
  if (!w.telas && !w.api) return null
  if (label === 'antes' && !(await isUp(p.localUrl))) return null
  if (label === 'depois') await new Promise((r) => setTimeout(r, 3000)) // recarregamento do servidor de dev
  const r = await shots.take(p, { demandId: t.demandId, taskId: t.id, label: `${label} · fila` })
  return r.sets ?? null
}

/** Manda os prints "depois" das tarefas da fila no Telegram */
async function sendQueueShots(done: QueueTask[]): Promise<void> {
  const chat = store.get().telegram.chatId
  let sent = 0
  for (const t of done) {
    for (const id of t.shotSetIds ?? []) {
      const set = shots.get(id)
      for (const item of set?.items ?? []) {
        if (!item.file || sent >= 4) continue
        const png = shots.image(item.file)
        if (!png) continue
        await sendTelegramPhoto(chat, Buffer.from(png.split(',')[1], 'base64'), `${queueName(t)} · ${item.route}${item.width < 800 ? ' (celular)' : ''}${item.errors.length ? ` · ⚠ ${item.errors[0]}` : ''}`)
        sent++
      }
    }
  }
}

// ---------- Fila de tarefas ----------
const queueName = (t: { projectId: string; demandId?: string }) =>
  (t.demandId && demands.get(t.demandId)?.key) || store.get().projects.find((p) => p.id === t.projectId)?.name || '?'
const queue = new QueueManager(app.getPath('userData'), {
  runs,
  demands,
  onChange: (q) => {
    send('queue:update', q)
    refreshTrayActivity()
  },
  onDrained: (done) => {
    const text = queueSummary(done, queueName)
    notify('📋 Fila concluída', text.split('\n')[0], 'queue', 'fila', 'unfocused', false)
    const cfg = store.get()
    if (telegramReady()) {
      void sendTelegramMessage(cfg.telegram.chatId, `📋 <b>Fila concluída</b>\n${escapeHtml(text)}`).then(() => sendQueueShots(done))
    }
  },
  log: (text, kind = 'info') => appLog({ kind, text }),
  shots: queueShots
})
/** Avisa no sino quando a análise/desenho/resposta do Claude de uma demanda fica pronta */
function demandsDoneNotice(e: RunEvent): void {
  if (e.type !== 'exit' || !e.tab.startsWith('demand:') || e.killed) return
  const d = demands.get(e.tab.slice('demand:'.length))
  const busy = demands.busyList().find((b) => b.runId === e.runId)
  if (!d || !busy) return
  const what = { analysis: 'análise pronta', design: 'desenho pronto para revisar', dev: 'o Claude respondeu' }[busy.what as 'analysis']
  if (!what) return
  notify(`📋 ${d.key}: ${e.code === 0 ? what : 'falhou'}`, d.title || d.jira?.summary || '', `demand:${d.id}`, 'demanda', 'unfocused', false)
}
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
runs.setClaudeArgsProvider((runId, req) => {
  const cfg = store.get()
  const args = approvals.claudeArgs(runId, req, cfg)
  // Guias do projeto (ex: docs/STYLE_GUIDE.md): o Claude lê e segue em tudo que fizer ali
  const g = guidesInstruction(cfg.projects.find((p) => p.id === req.projectId))
  if (g) args.push('--append-system-prompt', g)
  return args
})

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
    refreshTrayActivity()
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
  daily: () => dailyText(),
  runs,
  demands,
  queue,
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
  onVoice: (fileId) => tg.voice(fileId),
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
      writeFileAtomic(notificationsFile, JSON.stringify(notifications))
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
  const cfg = store.setStatus(status)
  if (status === 'off') void queue.tick()
  else {
    // Voltou: resumo do que a fila fez enquanto você estava fora
    const done = queue.takeUnreported()
    if (done.length) notify('📋 Enquanto você estava fora', queueSummary(done, queueName).split('\n')[0] + ' · clique para ver', 'queue', 'fila', 'always', false)
    void queue.tick()
  }
  return cfg
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
    title: 'Hélice',
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
  const proj = (id: string) => store.get().projects.find((p) => p.id === id)
  ipcMain.handle('git:info', (_e, id: string) => {
    const p = proj(String(id))
    return p ? gitInfo(p) : null
  })
  ipcMain.handle('git:pull', (_e, id: string) => {
    const p = proj(String(id))
    return p ? gitPull(p) : { ok: false, message: 'Projeto não encontrado.' }
  })
  ipcMain.handle('git:branches', (_e, id: string) => {
    const p = proj(String(id))
    return p ? gitBranches(p) : []
  })
  ipcMain.handle('git:checkout', (_e, id: string, branch: string) => {
    const p = proj(String(id))
    return p ? gitCheckout(p, String(branch)) : { ok: false, message: 'Projeto não encontrado.' }
  })
  ipcMain.handle('project:checkGuides', (_e, path: string, guides: string[]) =>
    checkGuides(String(path), Array.isArray(guides) ? guides.map(String) : [])
  )
  ipcMain.handle('demands:updateBase', (_e, id: string) => demands.updateBase(String(id)))
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
    const out = store.saveSettings({ ...patch, secrets: undefined })
    if (patch.sync) {
      scheduleSync()
      send('sync:update', sync.status())
    }
    if (patch.queue || patch.costs) {
      void queue.tick()
      send('costs:update', costs.guard())
    }
    return out
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
  ipcMain.handle('integration:check', (_e, id: IntegrationId) =>
    INTEGRATIONS.includes(id) ? integrationCheck(id, store.get()) : { lines: [], at: Date.now() }
  )
  ipcMain.handle('mcp:login', async (_e, id: IntegrationId) => {
    if (!INTEGRATIONS.includes(id)) return { ok: false, message: 'Integração desconhecida' }
    appLog({ kind: 'info', text: `[MCP] login ${id}: siga no navegador que vai abrir…` })
    const r = await integrationLogin(id, (line) => appLog({ kind: 'info', text: `[MCP] ${line}` }))
    appLog({ kind: r.ok ? 'success' : 'error', text: `[MCP] login ${id}: ${r.ok ? 'ok' : r.message}` })
    return r
  })
  ipcMain.handle('telegram:test', () =>
    sendTelegram(store.get().telegram.chatId, '✅ <b>Hélice</b>\nNotificações funcionando.')
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
  ipcMain.handle('demands:list', () => demands.all())
  ipcMain.handle('demands:busy', () => demands.busyList())
  ipcMain.handle('demands:save', (_e, d: Demand) => demands.save(d))
  ipcMain.handle('demands:delete', (_e, id: string) => demands.delete(String(id)))
  ipcMain.handle('demands:jira', (_e, id: string) => demands.fetchJira(String(id)))
  ipcMain.handle('demands:analyze', (_e, id: string, what: 'analysis' | 'design') =>
    demands.analyze(String(id), what === 'design' ? 'design' : 'analysis')
  )
  ipcMain.handle('demands:implement', (_e, id: string, message: string, fresh?: boolean) =>
    demands.implement(String(id), String(message ?? ''), Boolean(fresh))
  )
  ipcMain.handle('demands:branch', (_e, id: string, opts: { base?: string; createOnCompany?: boolean; linked?: boolean }) =>
    demands.branch(String(id), {
      base: typeof opts?.base === 'string' ? opts.base : undefined,
      createOnCompany: opts?.createOnCompany === true,
      linked: opts?.linked !== false
    })
  )
  ipcMain.handle('demands:stop', (_e, id: string) => demands.stop(String(id)))
  ipcMain.handle('demands:review', (_e, id: string) => demands.review(String(id)))
  ipcMain.handle('demands:saveReview', (_e, id: string, text: string) => demands.saveReview(String(id), String(text ?? '')))
  ipcMain.handle('demands:publishReview', (_e, id: string) => demands.publishReview(String(id)))
  ipcMain.handle('queue:state', () => queue.state())
  ipcMain.handle('queue:add', (_e, t: { projectId: string; demandId?: string; prompt: string }) =>
    queue.add({ projectId: String(t?.projectId ?? ''), demandId: t?.demandId ? String(t.demandId) : undefined, prompt: String(t?.prompt ?? '') })
  )
  ipcMain.handle('queue:cancel', (_e, id: string) => queue.cancel(String(id)))
  ipcMain.handle('queue:remove', (_e, id: string) => queue.remove(String(id)))
  ipcMain.handle('queue:retry', (_e, id: string) => queue.retry(String(id)))
  ipcMain.handle('queue:move', (_e, id: string, dir: number) => queue.move(String(id), dir < 0 ? -1 : 1))
  ipcMain.handle('queue:runNow', () => queue.runNow())
  ipcMain.handle('queue:clearDone', () => queue.clearDone())
  ipcMain.handle('costs:list', () => costs.list())
  ipcMain.handle('costs:guard', () => costs.guard())
  ipcMain.handle('costs:override', () => {
    const g = costs.overrideToday()
    void queue.tick()
    return g
  })
  ipcMain.handle('demands:queueCopy', (_e, id: string) => demands.queueCopy(String(id)))
  ipcMain.handle('demands:bringQueue', async (_e, id: string) => {
    const r = await demands.bringQueue(String(id))
    // Trouxe para a branch aberta: o servidor de dev recarrega → prints "depois"
    const d = demands.get(String(id))
    const p = d && store.get().projects.find((x) => x.id === d.projectId)
    if (r.ok && d && p && !/Nada novo/.test(r.message)) {
      const w = ShotManager.wants(p)
      const info = await gitInfo(p)
      if ((w.telas || w.api) && info?.branch === d.key && (await isUp(p.localUrl))) {
        setTimeout(() => void shots.take(p, { demandId: d.id, label: 'depois · trouxe da fila' }), 4000)
      }
    }
    return r
  })
  ipcMain.handle('demands:removeQueueCopy', (_e, id: string) => demands.removeQueueCopy(String(id)))
  ipcMain.handle('demands:prDraft', (_e, id: string) => demands.prDraft(String(id)))
  ipcMain.handle('demands:createPr', (_e, id: string, pr: { title: string; body: string; draft: boolean }) =>
    demands.createPr(String(id), { title: String(pr?.title ?? ''), body: String(pr?.body ?? ''), draft: Boolean(pr?.draft) })
  )
  ipcMain.handle('demands:timings', () => demands.timings())
  ipcMain.handle('daily:text', () => dailyText())
  ipcMain.handle('sync:status', () => sync.status())
  ipcMain.handle('sync:now', async () => {
    const r = await sync.sync()
    return r
  })
  ipcMain.handle('shots:list', (_e, scope: { projectId?: string; demandId?: string }) => shots.list(scope ?? {}))
  ipcMain.handle('shots:take', async (_e, req: { projectId: string; demandId?: string; label: string }) => {
    const p = store.get().projects.find((x) => x.id === req?.projectId)
    if (!p) return { ok: false, message: 'Projeto não encontrado.' }
    return shots.take(p, { demandId: req.demandId, label: String(req.label || 'manual') })
  })
  ipcMain.handle('shots:image', (_e, file: string) => shots.image(String(file)))
  ipcMain.handle('shots:delete', (_e, id: string) => shots.delete(String(id)))
  ipcMain.handle('demands:prComments', (_e, id: string) => demands.prComments(String(id)))
  ipcMain.handle('demands:sendPrComments', (_e, id: string, ids: string[], list: PrComment[], toQueue: boolean) => {
    const chosen = (Array.isArray(list) ? list : []).filter((c) => Array.isArray(ids) && ids.includes(c.id))
    const d = demands.get(String(id))
    if (!d) return { ok: false, message: 'Demanda não encontrada.' }
    const msg = demands.prCommentsMessage(d.id, chosen)
    if (!msg) return { ok: false, message: 'Escolha ao menos um comentário.' }
    if (toQueue) return queue.add({ projectId: d.projectId, demandId: d.id, prompt: msg })
    return demands.implement(d.id, msg)
  })
  ipcMain.handle('demands:doubts', (_e, id: string) => demands.doubts(String(id)))
  ipcMain.handle('demands:commentJira', (_e, id: string, text: string) => demands.commentJira(String(id), String(text ?? '')))
  ipcMain.handle('demands:addImage', (_e, id: string, dataUrl: string) => demands.addImage(String(id), String(dataUrl ?? '')))
  ipcMain.handle('demands:removeImage', (_e, id: string, file: string) => demands.removeImage(String(id), String(file)))
  ipcMain.handle('project:learn', (_e, projectId: string, lesson: string) => {
    const p = store.get().projects.find((x) => x.id === projectId)
    if (!p) return { ok: false, message: 'Projeto não encontrado.' }
    return learn(p, String(lesson ?? ''))
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
      // Sincronização entre PCs: logo ao abrir e depois a cada 15 min
      if (cfg.sync.enabled && cfg.sync.repoUrl) {
        setTimeout(() => void sync.sync().then((r) => appLog({ kind: r.ok ? 'info' : 'error', text: `[Sincronizar] ${r.message}` })), 8000)
      }
      scheduleSync()
    })
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  // Encerra tudo que o app abriu: nada de processo órfão/zumbi
  app.on('before-quit', () => {
    quitting = true
    history.flush()
    if (syncTimer) clearInterval(syncTimer)
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
