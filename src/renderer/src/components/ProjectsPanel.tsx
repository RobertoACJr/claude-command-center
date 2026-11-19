import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FolderGit2,
  GitBranch,
  Loader2,
  Pencil,
  Play,
  Plus,
  Radio,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Square,
  SquareTerminal,
  Trash2
} from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Project, ProjectRunState, RemoteSession, Script } from '@shared/types'
import { Button, EmptyState, IconButton } from './ui'
import { ScriptRow, type ScriptActions } from './ScriptsPanel'
import { cn, fmtDuration, shortPath } from '../lib/utils'

export function ProjectsPanel({
  projects,
  scripts,
  branches,
  remote,
  runStates,
  runningTabs,
  onAdd,
  onEdit,
  onDelete,
  onRefreshBranches,
  onAddScript,
  onOpenTerminal,
  onError,
  scriptActions
}: {
  projects: Project[]
  /** Todos os scripts; o card mostra os que pertencem ao projeto */
  scripts: Script[]
  branches: Record<string, string | null | undefined>
  remote: Record<string, RemoteSession | undefined>
  runStates: Record<string, ProjectRunState | undefined>
  runningTabs: Set<string>
  onAdd: () => void
  onEdit: (p: Project) => void
  onDelete: (p: Project) => void
  onRefreshBranches: () => void
  onAddScript: (projectId: string) => void
  onOpenTerminal: (projectId: string) => void
  onError: (msg: string) => void
  scriptActions: ScriptActions
}) {
  return (
    <section className="flex min-h-0 flex-col rounded-2xl border border-line bg-card">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <FolderGit2 size={16} className="text-purple" />
          <h2 className="text-sm font-semibold text-zinc-100">Projetos</h2>
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-zinc-500">{projects.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <IconButton title="Atualizar branches" onClick={onRefreshBranches}>
            <RefreshCw size={14} />
          </IconButton>
          <Button variant="primary" size="sm" onClick={onAdd}>
            <Plus size={14} /> Projeto
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {projects.length === 0 && (
          <EmptyState
            icon={<FolderGit2 size={20} />}
            title="Nenhum projeto ainda"
            text="Cadastre as pastas onde você trabalha, como executar cada uma e os scripts de cada projeto."
          />
        )}

        {projects.map((p) => (
          <ProjectCard
            key={p.id}
            p={p}
            branch={branches[p.id]}
            session={remote[p.id]}
            run={runStates[p.id]}
            scripts={scripts.filter((s) => s.target.kind === 'project' && s.target.projectId === p.id)}
            projects={projects}
            runningTabs={runningTabs}
            onEdit={onEdit}
            onDelete={onDelete}
            onAddScript={onAddScript}
            onOpenTerminal={onOpenTerminal}
            onError={onError}
            scriptActions={scriptActions}
          />
        ))}
      </div>
    </section>
  )
}

function useTick(active: boolean) {
  const [, setN] = useState(0)
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setN((n) => n + 1), 15_000)
    return () => clearInterval(t)
  }, [active])
}

function RunChip({ p, run }: { p: Project; run: ProjectRunState | undefined }) {
  const state = run?.state ?? 'stopped'
  useTick(state === 'running')
  if (!p.runCommand && state !== 'external') return null
  const port = p.port ? `:${p.port}` : ''
  const look = {
    stopped: { cls: 'border-line text-zinc-500', dot: 'bg-zinc-600', label: 'Parado' },
    starting: { cls: 'border-violet/40 text-purple', dot: 'bg-violet animate-pulse', label: 'Subindo…' },
    running: {
      cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
      dot: 'bg-emerald-400',
      label: `Rodando${run?.startedAt ? ' há ' + fmtDuration(Date.now() - run.startedAt) : ''}${port ? ' · ' + port : ''}`
    },
    crashed: {
      cls: 'border-red-500/40 bg-red-500/10 text-red-300',
      dot: 'bg-red-400',
      label: `Caiu (código ${run?.exitCode ?? '?'})`
    },
    external: {
      cls: 'border-sky-500/40 bg-sky-500/10 text-sky-300',
      dot: 'bg-sky-400',
      label: `Rodando fora do app${port ? ' · ' + port : ''}`
    }
  }[state]
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px]', look.cls)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', look.dot)} />
      {look.label}
    </span>
  )
}

function ProjectCard({
  p,
  branch,
  session,
  run,
  scripts,
  projects,
  runningTabs,
  onEdit,
  onDelete,
  onAddScript,
  onOpenTerminal,
  onError,
  scriptActions
}: {
  p: Project
  branch: string | null | undefined
  session: RemoteSession | undefined
  run: ProjectRunState | undefined
  scripts: Script[]
  projects: Project[]
  runningTabs: Set<string>
  onEdit: (p: Project) => void
  onDelete: (p: Project) => void
  onAddScript: (projectId: string) => void
  onOpenTerminal: (projectId: string) => void
  onError: (msg: string) => void
  scriptActions: ScriptActions
}) {
  const [showScripts, setShowScripts] = useState(true)
  const state = run?.state ?? 'stopped'
  const alive = state === 'running' || state === 'starting'
  const rcOn = !!session && session.state !== 'stopping'

  const start = async () => {
    const r = await window.api.projectStart(p.id)
    if (!r.ok) onError(`${p.name}: ${r.message}`)
    else onOpenTerminal(p.id)
  }

  return (
    <div className="group rounded-xl border border-line bg-card-2 p-3 transition-colors hover:border-violet/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-zinc-100">{p.name}</div>
          <div className="selectable mt-0.5 truncate font-mono text-[11px] text-zinc-500" title={p.path}>
            {shortPath(p.path, 52)}
          </div>
        </div>
        <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
          <IconButton title="Editar projeto" tone="accent" onClick={() => onEdit(p)}>
            <Pencil size={13} />
          </IconButton>
          <IconButton title="Excluir projeto" tone="danger" onClick={() => onDelete(p)}>
            <Trash2 size={13} />
          </IconButton>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px]',
            branch ? 'border-violet/30 bg-violet/10 text-purple' : 'border-line bg-white/[0.02] text-zinc-600'
          )}
        >
          <GitBranch size={11} />
          {branch === undefined ? '…' : (branch ?? 'sem git')}
        </span>
        <RunChip p={p} run={run} />
      </div>

      {/* Ações do projeto */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {p.runCommand &&
          (alive ? (
            <>
              <Button size="sm" variant="danger" onClick={() => window.api.projectStop(p.id)}>
                <Square size={10} fill="currentColor" /> Parar
              </Button>
              <Button size="sm" onClick={() => window.api.projectRestart(p.id).then((r) => !r.ok && onError(r.message))}>
                <RotateCcw size={12} /> Reiniciar
              </Button>
            </>
          ) : (
            <Button size="sm" variant="primary" onClick={start} title={p.runCommand}>
              <Play size={12} /> Executar
            </Button>
          ))}
        <Button size="sm" onClick={() => onOpenTerminal(p.id)} title="Abrir o terminal deste projeto">
          <SquareTerminal size={12} /> Terminal
        </Button>
        <button
          type="button"
          role="switch"
          aria-checked={rcOn}
          onClick={() => window.api.remoteSetManual(p.id, !rcOn)}
          title={
            rcOn
              ? 'Desligar o Remote Control deste projeto'
              : 'Ligar o Remote Control deste projeto agora' +
                (p.remoteEnabled ? ' (ele também liga sozinho no modo Ausente)' : '')
          }
          className={cn(
            'ml-auto inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border px-2 text-xs transition-colors',
            rcOn ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-line text-zinc-500 hover:text-zinc-200'
          )}
        >
          <Radio size={12} className={session?.state === 'active' ? 'animate-pulse' : ''} />
          Remote
          <span className={cn('relative h-3.5 w-6 rounded-full transition-colors', rcOn ? 'bg-emerald-500' : 'bg-zinc-700')}>
            <span
              className={cn(
                'absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all',
                rcOn ? 'left-3' : 'left-0.5'
              )}
            />
          </span>
        </button>
      </div>

      {session && <RemotePanel session={session} />}

      {/* Scripts do projeto */}
      <div className="mt-2.5 border-t border-line pt-2">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowScripts(!showScripts)}
            className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-zinc-500 hover:text-zinc-300"
          >
            {showScripts ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Scripts do projeto ({scripts.length})
          </button>
          <IconButton title="Novo script deste projeto" tone="accent" onClick={() => onAddScript(p.id)}>
            <Plus size={13} />
          </IconButton>
        </div>
        {showScripts && scripts.length > 0 && (
          <div className="mt-1.5 space-y-1.5">
            {scripts.map((s) => (
              <ScriptRow
                key={s.id}
                s={s}
                compact
                projects={projects}
                running={runningTabs.has(`script:${s.id}`)}
                actions={scriptActions}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function RemotePanel({ session }: { session: RemoteSession | undefined }) {
  const [copied, setCopied] = useState(false)
  if (!session) return null

  const retry = () => window.api.remoteRestart(session.projectId)

  if (session.state === 'starting' || session.state === 'stopping') {
    return (
      <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-line bg-bg px-2.5 py-2 text-xs text-zinc-400">
        <Loader2 size={13} className="animate-spin text-purple" />
        {session.state === 'starting' ? 'Iniciando sessão remota…' : 'Encerrando sessão remota…'}
      </div>
    )
  }

  if (session.state === 'active' && session.url) {
    const copy = async () => {
      await window.api.copyText(session.url!)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
    return (
      <div className="mt-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.06] p-2.5">
        <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-300">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          Sessão Remota Ativa
        </div>
        <div className="mt-1.5 flex items-center gap-1">
          <code className="selectable min-w-0 flex-1 truncate rounded bg-bg px-2 py-1 font-mono text-[11px] text-zinc-400" title={session.url}>
            {session.url}
          </code>
          <IconButton title={copied ? 'Copiado!' : 'Copiar link'} tone="accent" onClick={copy}>
            <Copy size={13} className={copied ? 'text-emerald-400' : ''} />
          </IconButton>
          <IconButton title="Abrir no navegador" tone="accent" onClick={() => window.api.openExternal(session.url!)}>
            <ExternalLink size={13} />
          </IconButton>
        </div>
      </div>
    )
  }

  const setup = session.state === 'needs-setup'
  return (
    <div
      className={cn(
        'mt-2.5 rounded-lg border p-2.5 text-xs',
        setup ? 'border-amber-400/30 bg-amber-400/[0.06] text-amber-200' : 'border-red-500/30 bg-red-500/[0.06] text-red-300'
      )}
    >
      <div className="flex items-start gap-2">
        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
        <span className="selectable min-w-0 flex-1 break-words">
          {session.message ?? (session.state === 'active' ? 'Sessão ativa, aguardando URL…' : 'Falha na sessão remota.')}
        </span>
        <IconButton title="Tentar de novo" onClick={retry}>
          <RotateCw size={13} />
        </IconButton>
      </div>
    </div>
  )
}
