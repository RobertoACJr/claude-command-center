import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppConfig, ConsoleMode, Project, Script } from '@shared/types'
import { Header } from './components/Header'
import { ProjectsPanel } from './components/ProjectsPanel'
import { ScriptsPanel } from './components/ScriptsPanel'
import { ProjectModal } from './components/ProjectModal'
import { ScriptModal } from './components/ScriptModal'
import { VariablesModal } from './components/VariablesModal'
import { ConsoleDock, type ConsoleLine, type LineKind, type RunStatus } from './components/ConsoleDock'
import { ConfirmModal } from './components/ui'
import { extractVariables, fillVariables, resolveTargetPath, shortPath } from './lib/utils'

type Confirm = { kind: 'project'; item: Project } | { kind: 'script'; item: Script } | null

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [home, setHome] = useState('')
  const [branches, setBranches] = useState<Record<string, string | null | undefined>>({})

  const [projectModal, setProjectModal] = useState<{ open: boolean; item: Project | null }>({
    open: false,
    item: null
  })
  const [scriptModal, setScriptModal] = useState<{ open: boolean; item: Script | null }>({ open: false, item: null })
  const [varsPrompt, setVarsPrompt] = useState<{ script: Script; vars: string[] } | null>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)

  const [lines, setLines] = useState<ConsoleLine[]>([])
  const [runStatus, setRunStatus] = useState<RunStatus>('idle')
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [cwd, setCwd] = useState('')
  const lineId = useRef(0)

  // ---------- bootstrap ----------
  const booted = useRef(false)
  useEffect(() => {
    if (booted.current) return
    booted.current = true
    Promise.all([window.api.getConfig(), window.api.homeDir(), window.api.configPath()]).then(([cfg, h, cfgPath]) => {
      setConfig(cfg)
      setHome(h)
      setCwd(h)
      log('info', `Claude Command Center pronto · config: ${cfgPath}`)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // Atualiza branches quando a janela volta ao foco (você pode ter trocado de branch no terminal)
  useEffect(() => {
    const onFocus = () => config && refreshBranches(config.projects)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [config, refreshBranches])

  // ---------- console ----------
  function log(kind: LineKind, text: string) {
    setLines((ls) => [...ls.slice(-1999), { id: ++lineId.current, kind, text, ts: Date.now() }])
  }

  /** Fase 1: execução simulada. Na Fase 2 isto vira child_process.spawn / claude -p no main process. */
  function execute(kind: 'terminal' | 'claude', text: string, dir: string, label?: string) {
    setCwd(dir)
    setRunStatus('running')
    setExitCode(null)
    if (label) log('info', `▶ ${label}  ·  ${dir}`)
    log(kind === 'terminal' ? 'cmd' : 'user', text)
    setTimeout(() => {
      log('info', '[Fase 1] Execução simulada: o motor real (terminal + Claude CLI) entra na Fase 2.')
      setRunStatus('success')
    }, 350)
  }

  // ---------- ações ----------
  const save = async (p: Promise<AppConfig>) => setConfig(await p)

  const toggleStatus = () => {
    if (!config) return
    const next = config.status === 'on' ? 'off' : 'on'
    save(window.api.setStatus(next))
    log('info', next === 'off' ? 'Status → OFF (Ausente)' : 'Status → ON (No PC)')
  }

  const runScript = (s: Script) => {
    const vars = extractVariables(s.content)
    if (vars.length) return setVarsPrompt({ script: s, vars })
    doRun(s, {})
  }

  const doRun = (s: Script, values: Record<string, string>) => {
    if (!config) return
    const dir = resolveTargetPath(s.target, config.projects, home)
    execute(s.type, fillVariables(s.content, values), dir, s.name)
  }

  const submitConsole = (text: string) => {
    if (!config) return
    execute(config.ui.consoleMode, text, cwd || home)
  }

  const setMode = (m: ConsoleMode) => save(window.api.saveUi({ consoleMode: m }))
  const toggleExpand = () => config && save(window.api.saveUi({ consoleExpanded: !config.ui.consoleExpanded }))

  if (!config) {
    return <div className="flex h-full items-center justify-center text-sm text-zinc-600">Carregando…</div>
  }

  const remoteCount = config.projects.filter((p) => p.remoteEnabled).length

  return (
    <div className="flex h-full flex-col">
      <Header status={config.status} onToggle={toggleStatus} remoteCount={remoteCount} />

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 lg:grid-cols-[minmax(320px,2fr)_3fr]">
        <ProjectsPanel
          projects={config.projects}
          branches={branches}
          status={config.status}
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

      <ConsoleDock
        lines={lines}
        mode={config.ui.consoleMode}
        onModeChange={setMode}
        expanded={config.ui.consoleExpanded}
        onToggleExpand={toggleExpand}
        status={runStatus}
        exitCode={exitCode}
        onSubmit={submitConsole}
        onClear={() => setLines([])}
        cwdLabel={shortPath(cwd || home, 70)}
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
        onClose={() => setVarsPrompt(null)}
        onRun={(values) => varsPrompt && doRun(varsPrompt.script, values)}
      />
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
