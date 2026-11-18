import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AppConfig,
  ConsoleMode,
  DeployAlert,
  Project,
  RemoteSession,
  RunEvent,
  Script,
  ScriptType,
  WatcherState
} from '@shared/types'
import { Header } from './components/Header'
import { ProjectsPanel } from './components/ProjectsPanel'
import { ScriptsPanel } from './components/ScriptsPanel'
import { ProjectModal } from './components/ProjectModal'
import { ScriptModal } from './components/ScriptModal'
import { VariablesModal } from './components/VariablesModal'
import { SettingsModal } from './components/SettingsModal'
import { AlertsBar } from './components/AlertsBar'
import { ConsoleDock, type ConsoleLine, type LineKind, type RunStatus } from './components/ConsoleDock'
import { ConfirmModal } from './components/ui'
import { extractVariables, fillVariables, resolveTargetPath, shortPath } from './lib/utils'

type Confirm = { kind: 'project'; item: Project } | { kind: 'script'; item: Script } | null

interface RunMeta {
  kind: ScriptType
  /** Pasta da conversa contínua (só para mensagens do console em modo Claude) */
  chatCwd?: string
}

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [home, setHome] = useState('')
  const [branches, setBranches] = useState<Record<string, string | null | undefined>>({})
  const [remote, setRemote] = useState<Record<string, RemoteSession>>({})

  const [projectModal, setProjectModal] = useState<{ open: boolean; item: Project | null }>({
    open: false,
    item: null
  })
  const [scriptModal, setScriptModal] = useState<{ open: boolean; item: Script | null }>({ open: false, item: null })
  const [varsPrompt, setVarsPrompt] = useState<{
    script: Script
    vars: string[]
    initial?: Record<string, string>
  } | null>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [watcher, setWatcher] = useState<WatcherState>({ phase: 'off', reason: 'Desligado', nextAt: null, lastResult: null })

  // ---------- console / execução ----------
  const [lines, setLines] = useState<ConsoleLine[]>([])
  const [runStatus, setRunStatus] = useState<RunStatus>('idle')
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [running, setRunning] = useState<string[]>([])
  const [consoleTarget, setConsoleTarget] = useState('global')
  const [chatSessions, setChatSessions] = useState<Record<string, string>>({})
  const lineId = useRef(0)
  const runMeta = useRef(new Map<string, RunMeta>())
  const lastRunId = useRef<string | null>(null)

  const log = useCallback((kind: LineKind, text: string) => {
    setLines((ls) => [...ls.slice(-2999), { id: ++lineId.current, kind, text, ts: Date.now() }])
  }, [])

  const logMany = useCallback((items: Array<{ kind: LineKind; text: string }>) => {
    setLines((ls) => [
      ...ls,
      ...items.map((i) => ({ id: ++lineId.current, kind: i.kind, text: i.text, ts: Date.now() }))
    ].slice(-3000))
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
      window.api.watcherState()
    ]).then(
      ([cfg, h, cfgPath, sessions, ws]) => {
        setConfig(cfg)
        setWatcher(ws)
        setHome(h)
        if (cfg.projects[0]) setConsoleTarget(cfg.projects[0].id)
        setRemote(Object.fromEntries(sessions.map((s) => [s.projectId, s])))
        log('info', `Claude Command Center pronto · config: ${cfgPath}`)
      }
    )
  }, [log])

  // Eventos de execução vindos do main process
  useEffect(() => {
    const off = window.api.onRunEvent((e: RunEvent) => {
      switch (e.type) {
        case 'lines':
          logMany(e.lines.map((l) => ({ kind: l.kind as LineKind, text: l.text })))
          break
        case 'session': {
          const meta = runMeta.current.get(e.runId)
          if (meta?.chatCwd) setChatSessions((s) => ({ ...s, [meta.chatCwd!]: e.sessionId }))
          break
        }
        case 'error':
          log('error', `✖ ${e.message}`)
          break
        case 'exit': {
          runMeta.current.delete(e.runId)
          setRunning((r) => r.filter((id) => id !== e.runId))
          if (e.killed) log('info', '■ Interrompido')
          else if (e.code === 0) log('success', '✔ Finalizado (0)')
          else log('error', `✖ Saiu com código ${e.code ?? e.signal ?? '?'}`)
          if (e.runId === lastRunId.current) {
            setExitCode(e.code)
            setRunStatus(e.killed ? 'stopped' : e.code === 0 ? 'success' : 'error')
          }
          break
        }
      }
    })
    return off
  }, [log, logMany])

  // Fase 3: config alterada pelo main (Vigia, alertas), logs do app e estado do Vigia
  useEffect(() => window.api.onConfigChanged(setConfig), [])
  useEffect(() => window.api.onWatcherState(setWatcher), [])
  useEffect(() => window.api.onAppLog((l) => log(l.kind, l.text)), [log])

  // Sessões de Remote Control
  useEffect(
    () => window.api.onRemoteUpdate((sessions) => setRemote(Object.fromEntries(sessions.map((s) => [s.projectId, s])))),
    []
  )

  // ---------- branches ----------
  const refreshBranches = useCallback(async (projects: Project[]) => {
    setBranches(Object.fromEntries(projects.map((p) => [p.id, undefined])))
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

  // Se o projeto do console for excluído, volta para Global
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
    opts: { label?: string; chat?: boolean } = {}
  ) {
    if (opts.label) log('info', `▶ ${opts.label}  ·  ${cwd}`)
    log(kind === 'terminal' ? 'cmd' : 'user', variables ? fillVariables(content, variables) : content)
    const resumeSessionId = kind === 'claude' && opts.chat ? chatSessions[cwd] : undefined

    setRunStatus('running')
    setExitCode(null)
    const runId = await window.api.run({ kind, content, variables, cwd, label: opts.label, resumeSessionId })
    runMeta.current.set(runId, { kind, chatCwd: opts.chat ? cwd : undefined })
    lastRunId.current = runId
    setRunning((r) => (r.includes(runId) ? r : [...r, runId]))
  }

  // Quando termina uma execução, re-lê as branches (o comando pode ter feito checkout)
  const runningCount = running.length
  const prevRunning = useRef(0)
  useEffect(() => {
    if (config && runningCount < prevRunning.current) refreshBranches(config.projects)
    prevRunning.current = runningCount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningCount])

  const stopLatest = () => {
    const id = lastRunId.current && running.includes(lastRunId.current) ? lastRunId.current : running.at(-1)
    if (id) window.api.stop(id)
  }

  // ---------- ações ----------
  const save = async (p: Promise<AppConfig>) => setConfig(await p)

  const toggleStatus = () => {
    if (!config) return
    const next = config.status === 'on' ? 'off' : 'on'
    save(window.api.setStatus(next))
    log(
      'info',
      next === 'off'
        ? 'Status → OFF (Ausente): iniciando Remote Control nos projetos marcados'
        : 'Status → ON (No PC): encerrando sessões remotas'
    )
  }

  const runScript = (s: Script, initial?: Record<string, string>) => {
    const vars = extractVariables(s.content)
    if (vars.length) return setVarsPrompt({ script: s, vars, initial })
    doRun(s, {})
  }

  // ---------- alertas do Vigia ----------
  /** Sugere valores para {{variaveis}} a partir do alerta (card, branch, ambiente…) */
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
    runScript(s, alertValues(a))
  }

  const doRun = (s: Script, values: Record<string, string>) => {
    if (!config) return
    const dir = resolveTargetPath(s.target, config.projects, home)
    execute(s.type, s.content, values, dir, { label: s.name })
  }

  const consoleCwd = config
    ? consoleTarget === 'global'
      ? home
      : (config.projects.find((p) => p.id === consoleTarget)?.path ?? home)
    : home

  const submitConsole = (text: string) => {
    if (!config) return
    if (config.ui.consoleMode === 'terminal' && /^(clear|cls)$/i.test(text)) return setLines([])
    // No console o texto é literal: {{x}} não é tratado como variável (variables = undefined)
    execute(config.ui.consoleMode, text, undefined, consoleCwd, { chat: config.ui.consoleMode === 'claude' })
  }

  const setMode = (m: ConsoleMode) => save(window.api.saveUi({ consoleMode: m }))
  const toggleExpand = () => config && save(window.api.saveUi({ consoleExpanded: !config.ui.consoleExpanded }))

  if (!config) {
    return <div className="flex h-full items-center justify-center text-sm text-zinc-600">Carregando…</div>
  }

  const remoteCount = config.projects.filter((p) => p.remoteEnabled).length
  const remoteActive = Object.values(remote).filter((s) => s.state === 'active').length

  return (
    <div className="flex h-full flex-col">
      <Header
        status={config.status}
        onToggle={toggleStatus}
        remoteCount={remoteCount}
        remoteActive={remoteActive}
        watcher={watcher}
        watcherEnabled={config.watcher.enabled}
        onToggleWatcher={async () => setConfig(await window.api.setWatcherEnabled(!config.watcher.enabled))}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(320px,2fr)_3fr]">
        <ProjectsPanel
          projects={config.projects}
          branches={branches}
          status={config.status}
          remote={remote}
          onAdd={() => setProjectModal({ open: true, item: null })}
          onEdit={(p) => setProjectModal({ open: true, item: p })}
          onDelete={(p) => setConfirm({ kind: 'project', item: p })}
          onRefreshBranches={() => refreshBranches(config.projects)}
        />
        <ScriptsPanel
          scripts={config.scripts}
          projects={config.projects}
          onAdd={() => setScriptModal({ open: true, item: null })}
          onEdit={(s) => setScriptModal({ open: true, item: s })}
          onDelete={(s) => setConfirm({ kind: 'script', item: s })}
          onRun={runScript}
        />
      </main>

      <AlertsBar
        alerts={config.alerts}
        scripts={config.scripts}
        onApprove={approveAlert}
        onDismiss={dismissAlert}
        onApproveAndRun={approveAndRun}
        onClearResolved={async () => setConfig(await window.api.clearResolvedAlerts())}
      />

      <ConsoleDock
        lines={lines}
        mode={config.ui.consoleMode}
        onModeChange={setMode}
        expanded={config.ui.consoleExpanded}
        onToggleExpand={toggleExpand}
        status={runStatus}
        exitCode={exitCode}
        running={runningCount}
        onStop={stopLatest}
        onSubmit={submitConsole}
        onClear={() => setLines([])}
        onNewChat={() => {
          setChatSessions((s) => {
            const next = { ...s }
            delete next[consoleCwd]
            return next
          })
          log('info', '— nova conversa com o Claude —')
        }}
        hasChat={!!chatSessions[consoleCwd]}
        targets={[
          ...config.projects.map((p) => ({ value: p.id, label: p.name })),
          { value: 'global', label: 'Global (Home)' }
        ]}
        target={consoleTarget}
        onTargetChange={setConsoleTarget}
        cwdLabel={shortPath(consoleCwd, 60)}
      />

      <ProjectModal
        open={projectModal.open}
        initial={projectModal.item}
        onClose={() => setProjectModal({ open: false, item: null })}
        onSave={(p) => save(window.api.saveProject(p))}
      />
      <ScriptModal
        open={scriptModal.open}
        initial={scriptModal.item}
        projects={config.projects}
        onClose={() => setScriptModal({ open: false, item: null })}
        onSave={(s) => save(window.api.saveScript(s))}
      />
      <VariablesModal
        script={varsPrompt?.script ?? null}
        variables={varsPrompt?.vars ?? []}
        initialValues={varsPrompt?.initial}
        onClose={() => setVarsPrompt(null)}
        onRun={(values) => varsPrompt && doRun(varsPrompt.script, values)}
      />
      <SettingsModal open={settingsOpen} config={config} watcher={watcher} onClose={() => setSettingsOpen(false)} />
      <ConfirmModal
        open={!!confirm}
        title={confirm?.kind === 'project' ? 'Excluir projeto?' : 'Excluir script?'}
        message={
          confirm?.kind === 'project' ? (
            <>
              <b className="text-zinc-200">{confirm.item.name}</b> sai da lista. A pasta no disco não é tocada.
              Scripts vinculados a ele passam a rodar em Global (Home).
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
