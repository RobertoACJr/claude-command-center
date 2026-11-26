import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppConfig,
  ConsoleMode,
  DeployAlert,
  Project,
  ProjectRunState,
  ApprovalRequest,
  RemoteSession,
  RunEvent,
  Script,
  ScriptType,
  UpdateState,
  WatcherState,
  GitInfo,
  NotificationTarget,
  Demand,
  DemandBusy,
  QueueState,
  CostGuard
} from '@shared/types'
import { Header } from './components/Header'
import { ProjectsPanel } from './components/ProjectsPanel'
import { ScriptsPanel, type ScriptActions } from './components/ScriptsPanel'
import { ProjectModal } from './components/ProjectModal'
import { ScriptModal } from './components/ScriptModal'
import { VariablesModal } from './components/VariablesModal'
import { SettingsModal, type SettingsTab } from './components/SettingsModal'
import { AlertsBar } from './components/AlertsBar'
import { AwayBanner, GoOnlineModal, VigiaBanner } from './components/Presence'
import { setEnabledAis } from './lib/ais'
import { dangerQuestion, isDangerous } from '@shared/danger'
import { BranchJourneyPrompt, WorklogModal } from './components/Worklog'
import {
  FIXED_TABS,
  TerminalsPanel,
  type ConsoleLine,
  type LineKind,
  type TabState
} from './components/TerminalsPanel'
import { ConfirmModal } from './components/ui'
import { ApprovalModal } from './components/ApprovalModal'
import { HistoryModal } from './components/HistoryModal'
import { CommandPalette, type PaletteItem } from './components/CommandPalette'
import { buildPaletteItems } from './lib/paletteItems'
import { DemandModal, newDemand } from './components/DemandModal'
import { lineStore } from './lib/lineStore'
import { QueueModal } from './components/QueueModal'
import { CostsModal } from './components/CostsModal'
import { DailyModal } from './components/DailyModal'
import { ShotsModal } from './components/ShotsView'
import {
  Clock,
  Bell,
  Bot,
  ClipboardList,
  Camera,
  DollarSign,
  ListTodo,
  MessageSquareText,
  Eye,
  FolderPlus,
  Gem,
  History as HistoryIcon,
  Moon,
  Pencil,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Settings,
  Sparkles,
  Square,
  SquareTerminal,
  Sun
} from 'lucide-react'
import {
  extractUserVariables,
  fillVariables,
  missingProjectKeys,
  projectValues,
  resolveTargetPath,
  shortPath,
  uid
} from './lib/utils'

type Confirm = { kind: 'project'; item: Project } | { kind: 'script'; item: Script } | null

const FIXED_TITLES: Record<string, string> = { console: 'Console', claude: 'Claude', gemini: 'Gemini', codex: 'ChatGPT', system: 'Sistema' }

function newTab(key: string, title: string): TabState {
  return { key, title, status: 'idle', exitCode: null, running: [], unread: false }
}

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [home, setHome] = useState('')
  const [branches, setBranches] = useState<Record<string, string | null | undefined>>({})
  const [remote, setRemote] = useState<Record<string, RemoteSession>>({})
  const [runStates, setRunStates] = useState<Record<string, ProjectRunState>>({})
  const [watcher, setWatcher] = useState<WatcherState>({ phase: 'off', reason: 'Desligado', nextAt: null, lastResult: null })

  const [projectModal, setProjectModal] = useState<{ open: boolean; item: Project | null }>({ open: false, item: null })
  const [scriptModal, setScriptModal] = useState<{ open: boolean; item: Script | null; preset?: string }>({
    open: false,
    item: null
  })
  const [runPrompt, setRunPrompt] = useState<{ script: Script; initial?: Record<string, string> } | null>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsAt, setSettingsAt] = useState<{ tab?: SettingsTab; focus?: string }>({})
  const openSettings = (tab?: SettingsTab, focus?: string) => {
    setSettingsAt({ tab, focus })
    setSettingsOpen(true)
  }
  const [goOnlineOpen, setGoOnlineOpen] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [queueState, setQueueState] = useState<QueueState>({ tasks: [], waiting: null })
  const [queueOpen, setQueueOpen] = useState<null | { demandId?: string; projectId?: string }>(null)
  const [costGuard, setCostGuard] = useState<CostGuard | null>(null)
  const [costsOpen, setCostsOpen] = useState(false)
  const [dailyOpen, setDailyOpen] = useState(false)
  const [shotsProject, setShotsProject] = useState<Project | null>(null)
  useEffect(() => {
    window.api.queue().then(setQueueState)
    window.api.costGuard().then(setCostGuard)
    const a = window.api.onQueue(setQueueState)
    const b = window.api.onCosts(setCostGuard)
    return () => {
      a()
      b()
    }
  }, [])
  const [demands, setDemands] = useState<Demand[]>([])
  const [demandsBusy, setDemandsBusy] = useState<DemandBusy[]>([])
  /** Demanda aberta: id de uma existente, ou o rascunho de uma nova */
  const [demandOpen, setDemandOpen] = useState<{ id: string } | { draft: Demand } | null>(null)
  useEffect(() => {
    window.api.demands().then(setDemands)
    window.api.demandsBusy().then(setDemandsBusy)
    return window.api.onDemands((list, busy) => {
      setDemands(list)
      setDemandsBusy(busy)
    })
  }, [])
  const [paletteOpen, setPaletteOpen] = useState(false)
  // Ctrl+K (ou Cmd+K) abre a paleta de comandos de qualquer lugar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const [toast, setToast] = useState<string | null>(null)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  /** Pedidos de permissão do Claude esperando resposta */
  const [approvalQueue, setApprovalQueue] = useState<ApprovalRequest[]>([])

  // ---------- terminais em abas ----------
  const [tabs, setTabs] = useState<Record<string, TabState>>(() =>
    Object.fromEntries(FIXED_TABS.map((k) => [k, newTab(k, FIXED_TITLES[k])]))
  )
  const [order, setOrder] = useState<string[]>([...FIXED_TABS])
  const [activeTab, setActiveTab] = useState('console')
  const [termOpen, setTermOpen] = useState(false)
  const [consoleTarget, setConsoleTarget] = useState('global')
  const [chatSessions, setChatSessions] = useState<Record<string, string>>({})
  /** Abas em que o usuário clicou Parar e o processo ainda não terminou */
  const [stoppingTabs, setStoppingTabs] = useState<Set<string>>(new Set())
  const activeRef = useRef(activeTab)
  activeRef.current = activeTab
  /** runId → chave da conversa ("claude:<pasta>" / "gemini:<pasta>") para continuar depois */
  const chatRuns = useRef(new Map<string, string>())
  const nextChatCwd = useRef<string | null>(null)

  const ensureTab = useCallback((key: string, title: string) => {
    setTabs((ts) => (ts[key] ? (ts[key].title === title ? ts : { ...ts, [key]: { ...ts[key], title } }) : { ...ts, [key]: newTab(key, title) }))
    setOrder((o) => (o.includes(key) ? o : [...o, key]))
  }, [])

  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  /** Saída vai para o lineStore (só o terminal redesenha); o App só muda ao marcar "não lida" */
  const append = useCallback((key: string, items: Array<{ kind: LineKind; text: string }>) => {
    const t = tabsRef.current[key]
    lineStore.append(key, items)
    if (t && key !== activeRef.current && !t.unread) {
      setTabs((ts) => (ts[key] && !ts[key].unread ? { ...ts, [key]: { ...ts[key], unread: true } } : ts))
    }
  }, [])

  const log = useCallback((kind: LineKind, text: string, tab = 'system') => append(tab, [{ kind, text }]), [append])

  const showToast = useCallback(
    (msg: string) => {
      setToast(msg)
      log('error', msg)
      setTimeout(() => setToast((t) => (t === msg ? null : t)), 5000)
    },
    [log]
  )

  const activate = useCallback((key: string, open = true) => {
    setActiveTab(key)
    // Aba de projeto: o campo de baixo passa a agir na pasta daquele projeto
    if (key.startsWith('project:')) setConsoleTarget(key.slice('project:'.length))
    setTabs((ts) => (ts[key]?.unread ? { ...ts, [key]: { ...ts[key], unread: false } } : ts))
    if (open) setTermOpen(true)
  }, [])

  /** Navega até o destino de uma notificação (sino ou notificação do sistema) */
  const goTo = useCallback(
    (t: NotificationTarget) => {
      if (t === 'terminals') return activate('system')
      if (t.startsWith('tab:')) return activate(t.slice(4))
      if (t === 'settings') return openSettings('general')
      if (t.startsWith('demand:')) return setDemandOpen({ id: t.slice('demand:'.length) })
      if (t === 'queue') return setQueueOpen({})
      if (t === 'costs') return setCostsOpen(true)
      if (t === 'alerts') document.querySelector('[data-testid="alerts-bar"]')?.scrollIntoView({ behavior: 'smooth' })
    },
    [activate]
  )

  // ---------- bootstrap ----------
  const booted = useRef(false)
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    Promise.all([
      window.api.getConfig(),
      window.api.homeDir(),
      window.api.configPath(),
      window.api.remoteList(),
      window.api.watcherState(),
      window.api.projectStates()
    ]).then(([cfg, h, cfgPath, sessions, ws, ps]) => {
      setConfig(cfg)
      setWatcher(ws)
      setHome(h)
      if (cfg.projects[0]) setConsoleTarget(cfg.projects[0].id)
      setRemote(Object.fromEntries(sessions.map((s) => [s.projectId, s])))
      setRunStates(Object.fromEntries(ps.map((s) => [s.projectId, s])))
      log('info', `Hélice pronta · config: ${cfgPath}`)
      // Primeira vez (nenhum projeto): abre o assistente de configuração
      if (cfg.projects.length === 0) openSettings('setup')
    })
  }, [log])

  // Eventos de execução: cada um vai para a aba dele
  useEffect(
    () =>
      window.api.onRunEvent((e: RunEvent) => {
        switch (e.type) {
          case 'start':
            ensureTab(e.tab, e.title)
            if ((e.tab === 'claude' || e.tab === 'gemini') && nextChatCwd.current) {
              chatRuns.current.set(e.runId, nextChatCwd.current)
              nextChatCwd.current = null
            }
            setTabs((ts) => {
              const t = ts[e.tab] ?? newTab(e.tab, e.title)
              return { ...ts, [e.tab]: { ...t, running: [...t.running, e.runId], status: 'running', exitCode: null } }
            })
            break
          case 'lines':
            append(e.tab, e.lines.map((l) => ({ kind: l.kind as LineKind, text: l.text })))
            break
          case 'session': {
            const cwd = chatRuns.current.get(e.runId)
            if (cwd) setChatSessions((s) => ({ ...s, [cwd]: e.sessionId }))
            break
          }
          case 'error':
            append(e.tab, [{ kind: 'error', text: `✖ ${e.message}` }])
            break
          case 'exit': {
            chatRuns.current.delete(e.runId)
            append(e.tab, [
              e.killed
                ? { kind: 'info', text: '■ Interrompido' }
                : e.code === 0
                  ? { kind: 'success', text: '✔ Finalizado (0)' }
                  : { kind: 'error', text: `✖ Saiu com código ${e.code ?? e.signal ?? '?'}` }
            ])
            setTabs((ts) => {
              const t = ts[e.tab]
              if (!t) return ts
              const running = t.running.filter((id) => id !== e.runId)
              if (!running.length)
                setStoppingTabs((st) => {
                  if (!st.has(e.tab)) return st
                  const n = new Set(st)
                  n.delete(e.tab)
                  return n
                })
              return {
                ...ts,
                [e.tab]: {
                  ...t,
                  running,
                  exitCode: e.code,
                  status: running.length ? 'running' : e.killed ? 'stopped' : e.code === 0 ? 'success' : 'error'
                }
              }
            })
            break
          }
        }
      }),
    [append, ensureTab]
  )

  useEffect(() => window.api.onConfigChanged(setConfig), [])
  useEffect(() => {
    window.api.updateState().then(setUpdate)
    return window.api.onUpdateState(setUpdate)
  }, [])
  useEffect(() => {
    window.api.pendingApprovals().then(setApprovalQueue)
    const offReq = window.api.onApprovalRequest((r) => setApprovalQueue((q) => (q.some((x) => x.id === r.id) ? q : [...q, r])))
    const offRes = window.api.onApprovalResolved((id) => setApprovalQueue((q) => q.filter((x) => x.id !== id)))
    return () => {
      offReq()
      offRes()
    }
  }, [])
  useEffect(() => window.api.onWatcherState(setWatcher), [])
  useEffect(() => window.api.onAppLog((l) => log(l.kind, l.text)), [log])
  useEffect(
    () => window.api.onRemoteUpdate((sessions) => setRemote(Object.fromEntries(sessions.map((s) => [s.projectId, s])))),
    []
  )
  useEffect(
    () => window.api.onProjectStates((ps) => setRunStates(Object.fromEntries(ps.map((s) => [s.projectId, s])))),
    []
  )
  // Pedidos vindos da bandeja / notificações
  useEffect(
    () =>
      window.api.onShowWindowRequest((what) => {
        if (what === 'go-online') setGoOnlineOpen(true)
        else goTo(what)
      }),
    [goTo]
  )

  // IAs ligadas neste PC: os seletores leem daqui
  useEffect(() => setEnabledAis(config?.ui.ais), [config?.ui.ais])
  // Histórico curto nos terminais (deste PC)
  useEffect(() => lineStore.setShort(!!config?.ui.shortHistory), [config?.ui.shortHistory])

  // Tema: azul no modo Ausente; lavanda com o Vigia ligado e você Online
  const vigiaOn = !!config?.watcher.enabled && watcher.phase !== 'off'
  useEffect(() => {
    document.documentElement.dataset.mode = config?.status === 'off' ? 'away' : vigiaOn ? 'vigia' : 'online'
  }, [config?.status, vigiaOn])

  // ---------- branches ----------
  const [gitInfos, setGitInfos] = useState<Record<string, GitInfo | null>>({})
  const gitLast = useRef(0)
  const gitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gitProjects = useRef<Project[]>([])
  /**
   * Lê o git de todos os projetos. Automático (foco na janela, fim de execução): no máximo a cada 15s,
   * juntando os pedidos. Pedido seu (botão, depois de mexer no git): na hora.
   */
  const refreshBranches = useCallback(async (projects: Project[], now = true) => {
    gitProjects.current = projects
    const wait = 15_000 - (Date.now() - gitLast.current)
    if (!now && wait > 0) {
      if (!gitTimer.current) {
        gitTimer.current = setTimeout(() => {
          gitTimer.current = null
          void refreshBranches(gitProjects.current, true)
        }, wait)
      }
      return
    }
    gitLast.current = Date.now()
    const entries = await Promise.all(projects.map(async (p) => [p.id, await window.api.gitInfo(p.id)] as const))
    setGitInfos(Object.fromEntries(entries))
    setBranches(Object.fromEntries(entries.map(([id, g]) => [id, g ? g.branch : null])))
  }, [])

  const projectsKey = config?.projects.map((p) => `${p.id}:${p.path}`).join('|') ?? ''
  useEffect(() => {
    if (config) refreshBranches(config.projects)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectsKey])

  useEffect(() => {
    const onFocus = () => config && refreshBranches(config.projects, false)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [config, refreshBranches])

  // Quando uma execução termina, re-lê as branches (o comando pode ter feito checkout)
  const totalRunning = useMemo(() => Object.values(tabs).reduce((n, t) => n + t.running.length, 0), [tabs])
  const prevRunning = useRef(0)
  useEffect(() => {
    if (config && totalRunning < prevRunning.current) refreshBranches(config.projects, false)
    prevRunning.current = totalRunning
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalRunning])

  useEffect(() => {
    if (config && consoleTarget !== 'global' && !config.projects.some((p) => p.id === consoleTarget)) {
      setConsoleTarget(config.projects[0]?.id ?? 'global')
    }
  }, [config, consoleTarget])

  // ---------- execução ----------
  async function execute(
    kind: ScriptType,
    content: string,
    variables: Record<string, string> | undefined,
    cwd: string,
    opts: { tab: string; title: string; chat?: boolean; projectId?: string }
  ) {
    // Comando que apaga dados ou derruba coisas: confirma antes (scripts, console, aba do projeto)
    if (kind === 'terminal' && isDangerous(content) && !window.confirm(dangerQuestion(content, opts.title))) return
    ensureTab(opts.tab, opts.title)
    const fixed = (FIXED_TABS as readonly string[]).includes(opts.tab)
    append(opts.tab, [
      ...(fixed ? [] : [{ kind: 'info' as const, text: `──── ${new Date().toLocaleTimeString()} · ${cwd}` }]),
      { kind: kind === 'terminal' ? 'cmd' : 'user', text: variables ? fillVariables(content, variables) : content }
    ])
    activate(opts.tab)
    const chatKey = `${kind}:${cwd}`
    const resumeSessionId = kind !== 'terminal' && opts.chat ? chatSessions[chatKey] : undefined
    if (kind !== 'terminal' && opts.chat) nextChatCwd.current = chatKey
    await window.api.run({
      kind,
      content,
      variables,
      cwd,
      tab: opts.tab,
      title: opts.title,
      resumeSessionId,
      projectId: opts.projectId,
      // Terminal com stdin aberto: dá para responder perguntas do comando pelo campo de baixo
      interactive: kind === 'terminal'
    })
  }

  const runScript = (s: Script, initial?: Record<string, string>) => {
    if (!config) return
    const userVars = extractUserVariables(s.content)
    if (s.target.kind === 'ask' || userVars.length) return setRunPrompt({ script: s, initial })
    if (s.target.kind === 'project') {
      const p = config.projects.find((x) => x.id === (s.target as { projectId: string }).projectId)
      if (p && missingProjectKeys(s.content, p).length) return setRunPrompt({ script: s, initial })
      return doRun(s, p ? projectValues(p) : {}, undefined)
    }
    doRun(s, {}, undefined)
  }

  const doRun = (s: Script, values: Record<string, string>, askedProjectId: string | undefined) => {
    if (!config) return
    const cwd = resolveTargetPath(s.target, config.projects, home, askedProjectId)
    const asked = askedProjectId ? config.projects.find((p) => p.id === askedProjectId) : undefined
    const projectId = s.target.kind === 'project' ? s.target.projectId : askedProjectId
    execute(s.type, s.content, values, cwd, {
      tab: `script:${s.id}`,
      title: asked ? `${s.name} · ${asked.name}` : s.name,
      projectId
    })
  }

  const stopTab = (key: string) => {
    const ids = tabs[key]?.running ?? []
    if (!ids.length) return
    setStoppingTabs((st) => new Set(st).add(key))
    for (const id of ids) window.api.stop(id)
  }

  const closeTab = (key: string) => {
    if ((FIXED_TABS as readonly string[]).includes(key)) return
    stopTab(key)
    lineStore.remove(key)
    setTabs((ts) => {
      const next = { ...ts }
      delete next[key]
      return next
    })
    setOrder((o) => {
      const i = o.indexOf(key)
      const next = o.filter((k) => k !== key)
      if (activeRef.current === key) setActiveTab(next[Math.max(0, i - 1)] ?? 'console')
      return next
    })
  }

  const clearTab = (key: string) => lineStore.clear(key)

  // ---------- ações ----------
  const save = async (p: Promise<AppConfig>) => setConfig(await p)

  const activeRemote = Object.values(remote).filter((s) => s.state === 'active' || s.state === 'starting')

  const togglePresence = async () => {
    if (!config) return
    if (config.status === 'on') {
      // Aviso: coisa sem commit ou sem push antes de sair
      const pend = config.projects
        .map((p) => ({ p, g: gitInfos[p.id] }))
        .filter(({ g }) => g && (g.changed > 0 || g.ahead > 0 || (!g.upstream && g.branch && g.branch !== g.base)))
        .map(({ p, g }) =>
          [
            `${p.name} (${g!.branch})`,
            g!.changed ? `${g!.changed} alterado(s) sem commit` : '',
            g!.ahead ? `${g!.ahead} commit(s) sem push` : '',
            !g!.upstream && g!.branch !== g!.base ? 'branch nunca teve push' : ''
          ]
            .filter(Boolean)
            .join(' · ')
        )
      if (pend.length) {
        showToast(`Atenção antes de sair: ${pend.join(' | ')}`)
        for (const l of pend) log('error', `[Git] ${l}`)
      }
      setConfig(await window.api.setPresence('off'))
      log('info', 'Modo Ausente: Vigia e Remote Control automáticos ligados')
    } else if (activeRemote.length) {
      setGoOnlineOpen(true)
    } else {
      setConfig(await window.api.setPresence('on', { keepRemote: false }))
      log('info', 'De volta ao PC (Online)')
    }
  }

  const goOnline = async (keepRemote: boolean) => {
    setGoOnlineOpen(false)
    setConfig(await window.api.setPresence('on', { keepRemote }))
    log('info', `De volta ao PC (Online) · sessões remotas ${keepRemote ? 'mantidas' : 'encerradas'}`)
  }

  const scriptActions: ScriptActions = {
    onRun: (s) => runScript(s),
    onEdit: (s) => setScriptModal({ open: true, item: s }),
    onDuplicate: async (s) => {
      const copy: Script = { ...s, id: uid(), name: `${s.name} (cópia)`, createdAt: Date.now() }
      await save(window.api.saveScript(copy))
      setScriptModal({ open: true, item: copy })
    },
    onDelete: (s) => setConfirm({ kind: 'script', item: s })
  }

  const openProjectTerminal = (projectId: string) => {
    const p = config?.projects.find((x) => x.id === projectId)
    if (!p) return
    ensureTab(`project:${projectId}`, p.name)
    activate(`project:${projectId}`)
  }

  // ---------- alertas do Vigia ----------
  const alertValues = (a: DeployAlert): Record<string, string> => ({
    card: a.card,
    ticket: a.card,
    issue: a.card,
    branch: a.branch,
    ambiente: a.environment,
    environment: a.environment,
    env: a.environment,
    solicitante: a.requester,
    requester: a.requester
  })
  const approveAlert = async (a: DeployAlert) => {
    setConfig(await window.api.setAlertStatus(a.id, 'approved'))
    log('success', `✔ Pedido aprovado: ${a.card || a.branch || a.summary} → ${a.environment || '?'}`)
  }
  const dismissAlert = async (a: DeployAlert) => {
    setConfig(await window.api.setAlertStatus(a.id, 'dismissed'))
    log('info', `Pedido descartado: ${a.card || a.branch || a.summary}`)
  }
  const approveAndRun = async (a: DeployAlert, s: Script) => {
    await approveAlert(a)
    // Com alerta, sempre confirma (mostra a prévia com os valores sugeridos)
    setRunPrompt({ script: s, initial: alertValues(a) })
  }

  // ---------- console ----------
  const consoleCwd = config
    ? consoleTarget === 'global'
      ? home
      : (config.projects.find((p) => p.id === consoleTarget)?.path ?? home)
    : home

  /** Na aba ativa há um processo rodando que aceita texto? (comando do terminal ou projeto) */
  const stdinRunId = termOpen && config?.ui.consoleMode === 'terminal' ? tabs[activeTab]?.running.at(-1) : undefined

  const submitConsole = async (text: string) => {
    if (!config) return
    const mode = config.ui.consoleMode
    // 1) Processo rodando na aba ativa: o texto vai para ele (stdin)
    if (stdinRunId) {
      append(activeTab, [{ kind: 'user', text }])
      const ok = await window.api.runInput(stdinRunId, text)
      if (!ok) append(activeTab, [{ kind: 'error', text: '✖ Este processo não aceita texto.' }])
      return
    }
    // 2) Aba de projeto parada: o comando roda na pasta do projeto, na própria aba
    if (mode === 'terminal' && termOpen && activeTab.startsWith('project:')) {
      const p = config.projects.find((x) => `project:${x.id}` === activeTab)
      if (p) return execute('terminal', text, undefined, p.path, { tab: activeTab, title: p.name, projectId: p.id })
    }
    if (mode === 'terminal' && /^(clear|cls)$/i.test(text)) return clearTab('console')
    // Texto literal: {{x}} não é tratado como variável (variables = undefined)
    const tab = mode === 'terminal' ? 'console' : mode
    execute(mode, text, undefined, consoleCwd, {
      tab,
      title: FIXED_TITLES[tab],
      // Codex: cada mensagem é uma conversa nova (sem retomar sessão)
      chat: mode === 'claude' || mode === 'gemini',
      projectId: consoleTarget !== 'global' ? consoleTarget : undefined
    })
  }

  const setMode = (m: ConsoleMode) => {
    save(window.api.saveUi({ consoleMode: m }))
    if (termOpen && ['console', 'claude', 'gemini', 'codex'].includes(activeTab)) activate(m === 'terminal' ? 'console' : m)
  }
  const toggleExpand = () => config && save(window.api.saveUi({ consoleExpanded: !config.ui.consoleExpanded }))

  if (!config) {
    return <div className="flex h-full items-center justify-center text-sm text-zinc-600">Carregando…</div>
  }

  const away = config.status === 'off'

  // ---------- paleta de comandos ----------
  const focusConsole = () =>
    setTimeout(() => (document.querySelector('[data-testid="console-input"]') as HTMLInputElement | null)?.focus(), 60)
  const projectName = (id?: string) => config.projects.find((p) => p.id === id)?.name
  const paletteItems = buildPaletteItems({
    config, away, demands, remote, runStates, activate, focusConsole, log, showToast, openProjectTerminal, openSettings,
    projectName, runScript, togglePresence, setConfig, setConsoleTarget, setMode, setProjectModal, setScriptModal,
    setShotsProject, setDemandOpen, setCostsOpen, setDailyOpen, setHistoryOpen, setQueueOpen
  })

  const remoteAuto = config.projects.filter((p) => p.remoteEnabled).length
  const runningTabs = new Set(order.filter((k) => tabs[k]?.running.length))
  const globalScripts = config.scripts.filter((s) => s.target.kind !== 'project')

  return (
    <div className="flex h-full flex-col">
      <Header
        status={config.status}
        onToggle={togglePresence}
        remoteCount={remoteAuto}
        remoteActive={activeRemote.length}
        watcher={watcher}
        watcherEnabled={config.watcher.enabled}
        onToggleWatcher={async () => {
          // Bloqueado (ex: Google Chat não configurado): leva direto ao guia que falta
          if (watcher.phase === 'blocked') return openSettings('setup', 'gchat')
          setConfig(await window.api.setWatcherEnabled(!config.watcher.enabled))
        }}
        onOpenSettings={() => openSettings()}
        onGo={goTo}
        onOpenHistory={() => setHistoryOpen(true)}
        onOpenQueue={() => setQueueOpen({})}
        onOpenCosts={() => setCostsOpen(true)}
        queueCount={queueState.tasks.filter((t) => t.status === 'pendente' || t.status === 'rodando').length}
        queueRunning={queueState.tasks.some((t) => t.status === 'rodando')}
        costGuard={costGuard}
        busy={queueState.tasks.some((t) => t.status === 'rodando') || watcher.phase === 'checking' || demandsBusy.length > 0}
        onOpenPalette={() => setPaletteOpen(true)}
      />
      {update?.phase === 'ready' && (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-emerald-500/30 bg-emerald-500/10 px-5 py-2 text-xs text-emerald-200">
          <span>
            ✨ Versão <b>{update.version}</b> baixada e pronta.{' '}
            {away || Object.values(runStates).some((r) => r.state === 'running' || r.state === 'starting')
              ? 'Reiniciar vai parar por alguns segundos o Vigia, o Remote Control e os projetos em execução.'
              : 'Leva poucos segundos.'}
          </span>
          <button
            type="button"
            onClick={() => window.api.installUpdate()}
            className="cursor-pointer rounded-lg bg-emerald-500/20 px-3 py-1 font-medium text-emerald-100 hover:bg-emerald-500/30"
          >
            Reiniciar e atualizar
          </button>
        </div>
      )}
      {!away && vigiaOn && (
        <VigiaBanner
          watcher={watcher}
          onRunNow={() => window.api.watcherRunNow()}
          onTurnOff={async () => setConfig(await window.api.setWatcherEnabled(false))}
        />
      )}
      {away && (
        <AwayBanner since={config.statusSince} watcher={watcher} remoteActive={activeRemote.length} onBack={togglePresence} />
      )}

      <main className="grid min-h-0 min-w-0 flex-1 grid-cols-1 gap-4 overflow-x-hidden p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <ProjectsPanel
          projects={config.projects}
          scripts={config.scripts}
          branches={branches}
          remote={remote}
          runStates={runStates}
          runningTabs={runningTabs}
          onAdd={() => setProjectModal({ open: true, item: null })}
          onEdit={(p) => setProjectModal({ open: true, item: p })}
          onDelete={(p) => setConfirm({ kind: 'project', item: p })}
          onRefreshBranches={() => refreshBranches(config.projects)}
          onAddScript={(projectId) => setScriptModal({ open: true, item: null, preset: `project:${projectId}` })}
          onOpenTerminal={openProjectTerminal}
          onError={showToast}
          scriptActions={scriptActions}
          profiles={config.profiles}
          demands={demands}
          demandsBusy={demandsBusy}
          onOpenDemand={(d) => setDemandOpen({ id: d.id })}
          gitInfos={gitInfos}
          onOpenShots={setShotsProject}
          onGitDiff={(p) =>
            execute('terminal', 'git status -sb; git diff --stat', undefined, p.path, { tab: `git:${p.id}`, title: `git · ${p.name}` })
          }
          onGitResult={(r) => {
            if (!r.ok) showToast(r.message)
            else log('success', `[Git] ${r.message}`)
            refreshBranches(config.projects)
          }}
          onNewDemand={(projectId) => setDemandOpen({ draft: newDemand(projectId) })}
        />
        <ScriptsPanel
          scripts={globalScripts}
          projects={config.projects}
          runningTabs={runningTabs}
          onAdd={() => setScriptModal({ open: true, item: null, preset: 'ask' })}
          actions={scriptActions}
        />
      </main>

      <AlertsBar
        alerts={config.alerts}
        scripts={config.scripts}
        projects={config.projects}
        replies={config.replies}
        rules={config.rules}
        onApprove={approveAlert}
        onDismiss={dismissAlert}
        onApproveAndRun={approveAndRun}
        onClearResolved={async () => setConfig(await window.api.clearResolvedAlerts())}
      />

      <TerminalsPanel
        tabs={tabs}
        order={order}
        active={activeTab}
        onActivate={(k) => activate(k)}
        open={termOpen}
        onToggleOpen={() => setTermOpen((o) => !o)}
        expanded={config.ui.consoleExpanded}
        onToggleExpand={toggleExpand}
        onCloseTab={closeTab}
        onClearTab={clearTab}
        shortHistory={config.ui.shortHistory}
        onStopTab={stopTab}
        stopping={stoppingTabs.has(activeTab)}
        inputTarget={
          stdinRunId
            ? 'stdin'
            : termOpen && config.ui.consoleMode === 'terminal' && activeTab.startsWith('project:')
              ? 'project'
              : 'normal'
        }
        mode={config.ui.consoleMode}
        onModeChange={setMode}
        onSubmit={submitConsole}
        onNewChat={() => {
          const mode = config.ui.consoleMode
          setChatSessions((s) => {
            const next = { ...s }
            delete next[`${mode}:${consoleCwd}`]
            return next
          })
          log('info', '— nova conversa —', mode === 'terminal' ? 'console' : mode)
        }}
        hasChat={!!chatSessions[`${config.ui.consoleMode}:${consoleCwd}`]}
        targets={[
          ...config.projects.map((p) => ({ value: p.id, label: p.name })),
          { value: 'global', label: 'Global (Home)' }
        ]}
        target={consoleTarget}
        onTargetChange={setConsoleTarget}
        cwdLabel={shortPath(consoleCwd, 60)}
      />

      {toast && (
        <div className="animate-modal fixed right-4 bottom-20 z-50 max-w-sm rounded-xl border border-red-500/40 bg-card px-4 py-3 text-sm text-red-200 shadow-2xl">
          {toast}
        </div>
      )}

      {(() => {
        const current = demandOpen && ('id' in demandOpen ? demands.find((x) => x.id === demandOpen.id) : demandOpen.draft)
        return (
          <DemandModal
            open={!!current}
            demand={current ?? null}
            isNew={!!demandOpen && 'draft' in demandOpen}
            busy={current ? demandsBusy.find((b) => b.demandId === current.id) : undefined}
            projects={config.projects}
            currentBranch={current ? branches[current.projectId] : undefined}
            git={current ? gitInfos[current.projectId] : undefined}
            onGitChanged={() => refreshBranches(config.projects)}
            onClose={() => {
              setDemandOpen(null)
              refreshBranches(config.projects)
            }}
            onCreated={(d) => setDemandOpen({ id: d.id })}
            onDeleted={() => setDemandOpen(null)}
            onQueue={(d) => {
              setDemandOpen(null)
              setQueueOpen({ demandId: d.id })
            }}
            onOpenTerminal={(d) => {
              setDemandOpen(null)
              ensureTab(`demand:${d.id}`, `${d.key}`)
              activate(`demand:${d.id}`)
            }}
          />
        )
      })()}
      <DailyModal open={dailyOpen} onClose={() => setDailyOpen(false)} />
      <WorklogModal onResult={(r) => showToast(r.message)} />
      <BranchJourneyPrompt branches={branches} demands={demands} />
      <ShotsModal project={shotsProject} onClose={() => setShotsProject(null)} />
      <QueueModal
        open={!!queueOpen}
        onClose={() => setQueueOpen(null)}
        config={config}
        demands={demands}
        queue={queueState}
        preset={queueOpen}
        onSaveSettings={async (q) => setConfig(await window.api.saveSettings({ queue: q }))}
        onOpenTerminal={(t) => {
          setQueueOpen(null)
          const tab = t.demandId ? `demand:${t.demandId}` : 'fila'
          ensureTab(tab, t.demandId ? demands.find((d) => d.id === t.demandId)?.key ?? 'Demanda' : 'Fila')
          activate(tab)
        }}
      />
      <CostsModal
        open={costsOpen}
        onClose={() => setCostsOpen(false)}
        config={config}
        demands={demands}
        guard={costGuard}
        onSaveLimit={async (v) => setConfig(await window.api.saveSettings({ costs: { dailyLimitUsd: v } }))}
      />
      <HistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} projects={config.projects} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={paletteItems} />

      <ProjectModal
        projects={config?.projects ?? []}
        open={projectModal.open}
        initial={projectModal.item}
        onClose={() => setProjectModal({ open: false, item: null })}
        onSave={(p) => save(window.api.saveProject(p))}
      />
      <ScriptModal
        open={scriptModal.open}
        initial={scriptModal.item}
        presetTarget={scriptModal.preset}
        projects={config.projects}
        onClose={() => setScriptModal({ open: false, item: null })}
        onSave={(s) => save(window.api.saveScript(s))}
      />
      <VariablesModal
        script={runPrompt?.script ?? null}
        projects={config.projects}
        initialValues={runPrompt?.initial}
        initialProjectId={consoleTarget !== 'global' ? consoleTarget : undefined}
        onClose={() => setRunPrompt(null)}
        onRun={(values, projectId) => runPrompt && doRun(runPrompt.script, values, projectId)}
      />
      <ApprovalModal
        queue={approvalQueue}
        onRespond={(id, d) => {
          setApprovalQueue((q) => q.filter((x) => x.id !== id))
          window.api.respondApproval(id, d)
        }}
      />
      <SettingsModal
        open={settingsOpen}
        config={config}
        watcher={watcher}
        initialTab={settingsAt.tab}
        focus={settingsAt.focus}
        onClose={() => setSettingsOpen(false)}
      />
      <GoOnlineModal
        open={goOnlineOpen}
        sessions={activeRemote}
        onClose={() => setGoOnlineOpen(false)}
        onChoose={goOnline}
      />
      <ConfirmModal
        open={!!confirm}
        title={confirm?.kind === 'project' ? 'Excluir projeto?' : 'Excluir script?'}
        message={
          confirm?.kind === 'project' ? (
            <>
              <b className="text-zinc-200">{confirm.item.name}</b> sai da lista (a pasta no disco não é tocada). Se ele
              estiver rodando, é parado. Os scripts dele viram ações globais.
            </>
          ) : (
            <>
              <b className="text-zinc-200">{confirm?.item.name}</b> será removido.
            </>
          )
        }
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return
          if (confirm.kind === 'project') save(window.api.deleteProject(confirm.item.id))
          else save(window.api.deleteScript(confirm.item.id))
        }}
      />
    </div>
  )
}
