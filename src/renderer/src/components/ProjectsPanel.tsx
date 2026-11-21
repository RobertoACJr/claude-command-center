import {
  AlertTriangle,
  AppWindow,
  Braces,
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
import { useEffect, useRef, useState } from 'react'
import type { Demand, DemandBusy, GitInfo, OpResult, Project, ProjectRunState, RemoteSession, Script } from '@shared/types'
import { statusInfo } from './DemandModal'
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
  scriptActions,
  demands,
  demandsBusy,
  onOpenDemand,
  onNewDemand,
  gitInfos,
  onGitDiff,
  onGitResult
}: {
  demands: Demand[]
  demandsBusy: DemandBusy[]
  onOpenDemand: (d: Demand) => void
  onNewDemand: (projectId: string) => void
  gitInfos: Record<string, GitInfo | null | undefined>
  onGitDiff: (p: Project) => void
  onGitResult: (r: OpResult) => void
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
    <section className="flex min-h-0 min-w-0 flex-col rounded-2xl border border-line bg-card">
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

      <div data-testid="panel-list" className="min-h-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden p-3">
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
            demands={demands.filter((d) => d.projectId === p.id)}
            demandsBusy={demandsBusy}
            onOpenDemand={onOpenDemand}
            onNewDemand={onNewDemand}
            git={gitInfos[p.id]}
            onGitDiff={onGitDiff}
            onGitResult={onGitResult}
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
  scriptActions,
  demands,
  demandsBusy,
  onOpenDemand,
  onNewDemand,
  git,
  onGitDiff,
  onGitResult
}: {
  demands: Demand[]
  demandsBusy: DemandBusy[]
  onOpenDemand: (d: Demand) => void
  onNewDemand: (projectId: string) => void
  git: GitInfo | null | undefined
  onGitDiff: (p: Project) => void
  onGitResult: (r: OpResult) => void
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
  const [showDemands, setShowDemands] = useState(true)
  const [showDone, setShowDone] = useState(false)
  const openDemands = demands.filter((d) => d.status !== 'feita')
  const doneCount = demands.length - openDemands.length
  /** Clique em andamento: mostra "Iniciando…/Parando…" até o estado mudar de verdade */
  const [busy, setBusy] = useState<null | 'start' | 'stop' | 'restart' | 'remote'>(null)
  const state = run?.state ?? 'stopped'
  const alive = state === 'running' || state === 'starting'
  const rcOn = !!session && session.state !== 'stopping'

  // Libera o botão quando o estado de execução ou do Remote Control muda
  useEffect(() => {
    if (busy === 'remote') return
    setBusy((b) => (b === 'start' && state === 'stopped' ? b : null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])
  useEffect(() => {
    if (busy === 'remote') setBusy(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.state, !!session])

  const act = async (kind: 'start' | 'stop' | 'restart', fn: () => Promise<{ ok: boolean; message: string } | void>) => {
    setBusy(kind)
    try {
      const r = await fn()
      if (r && !r.ok) onError(`${p.name}: ${r.message}`)
      else if (kind !== 'stop') onOpenTerminal(p.id)
    } finally {
      // Segurança: nunca deixa o botão preso
      setTimeout(() => setBusy((b) => (b === kind ? null : b)), 1500)
    }
  }

  const toggleRemote = () => {
    setBusy('remote')
    window.api.remoteSetManual(p.id, !rcOn)
    setTimeout(() => setBusy((b) => (b === 'remote' ? null : b)), 8000)
  }

  return (
    <div className="group min-w-0 rounded-xl border border-line bg-card-2 p-3 transition-colors hover:border-violet/40">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-zinc-100">{p.name}</div>
          <div className="selectable mt-0.5 truncate font-mono text-[11px] text-zinc-500" title={p.path}>
            {shortPath(p.path, 52)}
          </div>
        </div>
        <div className="flex shrink-0 items-center">
          <IconButton title="Abrir o terminal do sistema nesta pasta" tone="accent" onClick={() => window.api.openSystemTerminal(p.path).then((r) => !r.ok && onError(r.message))}>
            <AppWindow size={13} />
          </IconButton>
          <IconButton title="Editar projeto (nome, pasta, como executar, variáveis)" tone="accent" onClick={() => onEdit(p)}>
            <Pencil size={13} />
          </IconButton>
          <IconButton title="Excluir projeto" tone="danger" onClick={() => onDelete(p)}>
            <Trash2 size={13} />
          </IconButton>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {!p.path && (
          <span title="Veio da sincronização de outro PC: edite o projeto e escolha a pasta aqui" className="rounded-md border border-amber-400/50 px-1.5 py-0.5 text-[11px] text-amber-300">
            defina a pasta neste PC
          </span>
        )}
        <GitMenu p={p} branch={branch} git={git} onDiff={() => onGitDiff(p)} onResult={onGitResult} />
        {git && git.changed > 0 && (
          <span
            title={git.conflicts ? `${git.conflicts} arquivo(s) com conflito` : 'Arquivos alterados ou novos, sem commit'}
            className={cn(
              'rounded-md border px-1.5 py-0.5 text-[11px]',
              git.conflicts ? 'border-red-500/40 text-red-300' : 'border-amber-400/40 text-amber-300'
            )}
          >
            {git.conflicts ? `⚠ ${git.conflicts} conflito(s)` : `● ${git.changed} alterado${git.changed > 1 ? 's' : ''}`}
          </span>
        )}
        {git && (git.ahead > 0 || git.behind > 0) && (
          <span
            title={`${git.ahead} commit(s) seu(s) sem push · ${git.behind} commit(s) novo(s) no remoto (${git.upstream})`}
            className="rounded-md border border-sky-500/40 px-1.5 py-0.5 font-mono text-[11px] text-sky-300"
          >
            {git.ahead > 0 && `↑${git.ahead}`}
            {git.ahead > 0 && git.behind > 0 && ' '}
            {git.behind > 0 && `↓${git.behind}`}
          </span>
        )}
        {git && !git.upstream && git.branch && git.branch !== git.base && git.branch !== '(detached)' && (
          <span title="Esta branch ainda não existe no remoto" className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-zinc-500">
            sem push
          </span>
        )}
        <RunChip p={p} run={run} />
      </div>

      {/* Variáveis do projeto (clique para editar) */}
      {p.vars.length > 0 && (
        <button
          type="button"
          onClick={() => onEdit(p)}
          title="Variáveis do projeto: usadas nas ações globais como {{projeto.chave}}. Clique para editar."
          className="mt-2 flex w-full cursor-pointer flex-wrap items-center gap-1 text-left"
        >
          <Braces size={11} className="text-zinc-600" />
          {p.vars.map((v) => (
            <span key={v.key} className="rounded border border-line bg-bg px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
              <span className="text-zinc-500">{v.key}</span>
              <span className="text-zinc-600">=</span>
              {v.value || <i className="text-zinc-600">vazio</i>}
            </span>
          ))}
        </button>
      )}

      {/* Ações do projeto */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {p.runCommand &&
          (alive ? (
            <>
              <Button size="sm" variant="danger" disabled={!!busy && busy !== 'remote'} onClick={() => act('stop', () => window.api.projectStop(p.id))}>
                {busy === 'stop' ? <Loader2 size={11} className="animate-spin" /> : <Square size={10} fill="currentColor" />}
                {busy === 'stop' ? 'Parando…' : 'Parar'}
              </Button>
              <Button size="sm" disabled={!!busy && busy !== 'remote'} onClick={() => act('restart', () => window.api.projectRestart(p.id))}>
                {busy === 'restart' ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                {busy === 'restart' ? 'Reiniciando…' : 'Reiniciar'}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="primary"
              disabled={busy === 'start'}
              onClick={() => act('start', () => window.api.projectStart(p.id))}
              title={p.runCommand}
            >
              {busy === 'start' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              {busy === 'start' ? 'Iniciando…' : 'Executar'}
            </Button>
          ))}
        <Button size="sm" onClick={() => onOpenTerminal(p.id)} title="Abrir o terminal deste projeto">
          <SquareTerminal size={12} /> Terminal
        </Button>
        <button
          type="button"
          role="switch"
          aria-checked={rcOn}
          onClick={toggleRemote}
          disabled={busy === 'remote'}
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
          {busy === 'remote' ? <Loader2 size={12} className="animate-spin" /> : <Radio size={12} className={session?.state === 'active' ? 'animate-pulse' : ''} />}
          {busy === 'remote' ? (rcOn ? 'Desligando…' : 'Ligando…') : 'Remote'}
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

      {session && <RemotePanel session={session} projectPath={p.path} />}

      {/* Demandas do projeto */}
      <div className="mt-2.5 border-t border-line pt-2">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowDemands(!showDemands)}
            className="inline-flex cursor-pointer items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-zinc-500 hover:text-zinc-300"
          >
            {showDemands ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Demandas ({openDemands.length})
          </button>
          <IconButton title="Nova demanda (card do Jira)" tone="accent" onClick={() => onNewDemand(p.id)} data-testid="new-demand">
            <Plus size={13} />
          </IconButton>
        </div>
        {showDemands && (
          <div className="mt-1.5 space-y-1">
            {(showDone ? demands : openDemands).map((d) => {
              const st = statusInfo(d.status)
              const b = demandsBusy.find((x) => x.demandId === d.id)
              return (
                <button
                  key={d.id}
                  type="button"
                  data-testid="demand-row"
                  onClick={() => onOpenDemand(d)}
                  className="flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-line bg-bg/60 px-2.5 py-1.5 text-left hover:border-violet/50"
                >
                  <span className="shrink-0 font-mono text-[11px] text-purple">{d.key}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-zinc-300">{d.title || d.jira?.summary || ''}</span>
                  {b && <Loader2 size={12} className="shrink-0 animate-spin text-purple" />}
                  {d.hours ? <span className="shrink-0 text-[10px] text-zinc-500">{d.hours}h</span> : null}
                  <span className={cn('shrink-0 rounded border px-1.5 text-[10px]', st.cls)}>{st.label}</span>
                </button>
              )
            })}
            {doneCount > 0 && (
              <button
                type="button"
                onClick={() => setShowDone(!showDone)}
                className="cursor-pointer text-[11px] text-zinc-500 hover:text-zinc-300"
              >
                {showDone ? 'esconder feitas' : `mostrar ${doneCount} feita(s)`}
              </button>
            )}
          </div>
        )}
      </div>

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

/** Chip da branch: clique abre puxar, diferenças e troca de branch */
function GitMenu({
  p,
  branch,
  git,
  onDiff,
  onResult
}: {
  p: Project
  branch: string | null | undefined
  git: GitInfo | null | undefined
  onDiff: () => void
  onResult: (r: OpResult) => void
}) {
  const [open, setOpen] = useState(false)
  const [list, setList] = useState<string[] | null>(null)
  const [working, setWorking] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    setList(null)
    window.api.gitBranches(p.id).then(setList)
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open, p.id])
  const run = async (fn: () => Promise<OpResult>) => {
    setWorking(true)
    try {
      onResult(await fn())
    } finally {
      setWorking(false)
      setOpen(false)
    }
  }
  const last = git?.lastCommit
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        data-testid="git-chip"
        disabled={!git}
        onClick={() => setOpen(!open)}
        title={last ? `Último commit: ${last.hash} ${last.subject} (${last.when})\nClique: puxar, diferenças, trocar de branch` : 'Branch atual'}
        className={cn(
          'inline-flex cursor-pointer items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px] disabled:cursor-default',
          branch ? 'border-violet/30 bg-violet/10 text-purple hover:border-violet/60' : 'border-line bg-white/[0.02] text-zinc-600'
        )}
      >
        {working ? <Loader2 size={11} className="animate-spin" /> : <GitBranch size={11} />}
        {branch === undefined ? '…' : (branch ?? 'sem git')}
        {git && <ChevronDown size={10} />}
      </button>
      {open && git && (
        <div data-testid="git-menu" className="absolute top-full left-0 z-40 mt-1 w-72 overflow-hidden rounded-xl border border-line bg-card text-xs shadow-2xl">
          {last && (
            <div className="border-b border-line px-3 py-2 text-[11px] text-zinc-500">
              <span className="font-mono text-zinc-400">{last.hash}</span> {last.subject}
              <div>{last.when}</div>
            </div>
          )}
          <button type="button" className="block w-full cursor-pointer px-3 py-2 text-left text-zinc-200 hover:bg-white/5" onClick={() => run(() => window.api.gitPull(p.id))}>
            ⬇ Puxar do remoto {git.behind ? `(${git.behind} novo${git.behind > 1 ? 's' : ''})` : ''}
          </button>
          <button
            type="button"
            className="block w-full cursor-pointer px-3 py-2 text-left text-zinc-200 hover:bg-white/5"
            onClick={() => {
              setOpen(false)
              onDiff()
            }}
          >
            ± Ver diferenças ({git.changed} alterado{git.changed === 1 ? '' : 's'})
          </button>
          <div className="border-t border-line px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-zinc-600">Trocar de branch</div>
          <div className="max-h-48 overflow-y-auto pb-1">
            {list === null && <div className="px-3 py-1.5 text-zinc-500">carregando…</div>}
            {list?.map((b) => (
              <button
                key={b}
                type="button"
                disabled={b === git.branch}
                onClick={() => run(() => window.api.gitCheckout(p.id, b))}
                className="block w-full cursor-pointer truncate px-3 py-1.5 text-left font-mono text-[11px] text-zinc-300 hover:bg-white/5 disabled:cursor-default disabled:text-purple"
              >
                {b === git.branch ? '● ' : ''}
                {b}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function RemotePanel({ session, projectPath }: { session: RemoteSession | undefined; projectPath: string }) {
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
        <span className="selectable min-w-0 flex-1 [overflow-wrap:anywhere]">
          {session.message ?? (session.state === 'active' ? 'Sessão ativa, aguardando URL…' : 'Falha na sessão remota.')}
        </span>
        <IconButton title="Tentar de novo" onClick={retry}>
          <RotateCw size={13} />
        </IconButton>
      </div>
      {setup && (
        <div className="mt-2 space-y-1.5 border-t border-amber-400/20 pt-2 text-[11px] text-amber-100/80">
          <div>
            1. Clique abaixo: abre o terminal do sistema nesta pasta já rodando <code>claude remote-control</code>.
            <br />
            2. Responda <b>y</b> às perguntas (confiar na pasta e ativar o Remote Control).
            <br />
            3. Quando aparecer o link, feche o terminal (Ctrl+C) e clique em ↻ Tentar de novo aqui.
          </div>
          <Button size="sm" onClick={() => window.api.openSystemTerminal(projectPath, 'remote-control')}>
            <AppWindow size={12} /> Fazer a configuração inicial
          </Button>
        </div>
      )}
    </div>
  )
}
