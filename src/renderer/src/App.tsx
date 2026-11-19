import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppConfig,
  ConsoleMode,
  DeployAlert,
  Project,
  ProjectRunState,
  RemoteSession,
  RunEvent,
  Script,
  ScriptType,
  WatcherState
} from '@shared/types'
import { Header } from './components/Header'
import { ProjectsPanel } from './components/ProjectsPanel'
import { ScriptsPanel, type ScriptActions } from './components/ScriptsPanel'
import { ProjectModal } from './components/ProjectModal'
import { ScriptModal } from './components/ScriptModal'
import { VariablesModal } from './components/VariablesModal'
import { SettingsModal } from './components/SettingsModal'
import { AlertsBar } from './components/AlertsBar'
import { AwayBanner, GoOnlineModal } from './components/Presence'
import {
  FIXED_TABS,
  TerminalsPanel,
  type ConsoleLine,
  type LineKind,
  type TabState
} from './components/TerminalsPanel'
import { ConfirmModal } from './components/ui'
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

const MAX_LINES = 4000
const FIXED_TITLES: Record<string, string> = { console: 'Console', claude: 'Claude', gemini: 'Gemini', system: 'Sistema' }

function newTab(key: string, title: string): TabState {
  return { key, title, lines: [], status: 'idle', exitCode: null, running: [], unread: false }
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
  const [goOnlineOpen, setGoOnlineOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  // ---------- terminais em abas ----------
  const [tabs, setTabs] = useState<Record<string, TabState>>(() =>
    Object.fromEntries(FIXED_TABS.map((k) => [k, newTab(k, FIXED_TITLES[k])]))
  )
  const [order, setOrder] = useState<string[]>([...FIXED_TABS])
  const [activeTab, setActiveTab] = useState('console')
  const [termOpen, setTermOpen] = useState(false)
  const [consoleTarget, setConsoleTarget] = useState('global')
  const [chatSessions, setChatSessions] = useState<Record<string, string>>({})
  const lineId = useRef(0)
  const activeRef = useRef(activeTab)
  activeRef.current = activeTab
  /** runId → chave da conversa ("claude:<pasta>" / "gemini:<pasta>") para continuar depois */
  const chatRuns = useRef(new Map<string, string>())
  const nextChatCwd = useRef<string | null>(null)

  const ensureTab = useCallback((key: string, title: string) => {
    setTabs((ts) => (ts[key] ? (ts[key].title === title ? ts : { ...ts, [key]: { ...ts[key], title } }) : { ...ts, [key]: newTab(key, title) }))
    setOrder((o) => (o.includes(key) ? o : [...o, key]))
  }, [])

  const append = useCallback((key: string, items: Array<{ kind: LineKind; text: string }>) => {
    setTabs((ts) => {
      const t = ts[key]
      if (!t) return ts // aba fechada: descarta
      const lines: ConsoleLine[] = [...t.lines, ...items.map((i) => ({ id: ++lineId.current, ...i }))].slice(-MAX_LINES)
      return { ...ts, [key]: { ...t, lines, unread: t.unread || key !== activeRef.current } }
    })
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
    setTabs((ts) => (ts[key]?.unread ? { ...ts, [key]: { ...ts[key], unread: false } } : ts))
    if (open) setTermOpen(true)
  }, [])

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
      log('info', `Claude Command Center pronto · config: ${cfgPath}`)
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
        if (what === 'terminals') activate('system')
      }),
    [activate]
  )

  // Tema: azul-petróleo no modo Ausente
  useEffect(() => {
    document.documentElement.dataset.mode = config?.status === 'off' ? 'away' : 'online'
  }, [config?.status])

  // ---------- branches ----------
  const refreshBranches = useCallback(async (projects: Project[]) => {
    const entries = await Promise.all(projects.map(async (p) => [p.id, await window.api.gitBranch(p.path)] as const))
    setBranches(Object.fromEntries(entries))
  }, [])

  const projectsKey = config?.projects.map((p) => `${p.id}:${p.path}`).join('|') ?? ''
  useEffect(() => {
    if (config) refreshBranches(config.projects)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectsKey])

  useEffect(() => {
    const onFocus = () => config && refreshBranches(config.projects)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [config, refreshBranches])

  // Quando uma execução termina, re-lê as branches (o comando pode ter feito checkout)
  const totalRunning = useMemo(() => Object.values(tabs).reduce((n, t) => n + t.running.length, 0), [tabs])
  const prevRunning = useRef(0)
  useEffect(() => {
    if (config && totalRunning < prevRunning.current) refreshBranches(config.projects)
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
    opts: { tab: string; title: string; chat?: boolean }
  ) {
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
    await window.api.run({ kind, content, variables, cwd, tab: opts.tab, title: opts.title, resumeSessionId })
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
    execute(s.type, s.content, values, cwd, { tab: `script:${s.id}`, title: asked ? `${s.name} · ${asked.name}` : s.name })
  }

  const stopTab = (key: string) => {
    for (const id of tabs[key]?.running ?? []) window.api.stop(id)
  }

  const closeTab = (key: string) => {
    if ((FIXED_TABS as readonly string[]).includes(key)) return
    stopTab(key)
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

  const clearTab = (key: string) => setTabs((ts) => (ts[key] ? { ...ts, [key]: { ...ts[key], lines: [] } } : ts))

  // ---------- ações ----------
  const save = async (p: Promise<AppConfig>) => setConfig(await p)

  const activeRemote = Object.values(remote).filter((s) => s.state === 'active' || s.state === 'starting')

  const togglePresence = async () => {
    if (!config) return
    if (config.status === 'on') {
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

  const submitConsole = (text: string) => {
    if (!config) return
    const mode = config.ui.consoleMode
    if (mode === 'terminal' && /^(clear|cls)$/i.test(text)) return clearTab('console')
    // Texto literal: {{x}} não é tratado como variável (variables = undefined)
    const tab = mode === 'terminal' ? 'console' : mode
    execute(mode, text, undefined, consoleCwd, { tab, title: FIXED_TITLES[tab], chat: mode !== 'terminal' })
  }

  const setMode = (m: ConsoleMode) => {
    save(window.api.saveUi({ consoleMode: m }))
    if (termOpen && ['console', 'claude', 'gemini'].includes(activeTab)) activate(m === 'terminal' ? 'console' : m)
  }
  const toggleExpand = () => config && save(window.api.saveUi({ consoleExpanded: !config.ui.consoleExpanded }))

  if (!config) {
    return <div className="flex h-full items-center justify-center text-sm text-zinc-600">Carregando…</div>
  }

  const away = config.status === 'off'
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
        onToggleWatcher={async () => setConfig(await window.api.setWatcherEnabled(!config.watcher.enabled))}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      {away && (
        <AwayBanner since={config.statusSince} watcher={watcher} remoteActive={activeRemote.length} onBack={togglePresence} />
      )}

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(360px,1fr)_minmax(320px,1fr)]">
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
        onStopTab={stopTab}
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

      <ProjectModal
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
      <SettingsModal open={settingsOpen} config={config} watcher={watcher} onClose={() => setSettingsOpen(false)} />
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
