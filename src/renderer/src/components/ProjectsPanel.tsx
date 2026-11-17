import { FolderGit2, GitBranch, Pencil, Plus, Radio, RefreshCw, Trash2 } from 'lucide-react'
import type { PresenceStatus, Project } from '@shared/types'
import { Button, EmptyState, IconButton } from './ui'
import { cn, shortPath } from '../lib/utils'

export function ProjectsPanel({
  projects,
  branches,
  status,
  onAdd,
  onEdit,
  onDelete,
  onRefreshBranches
}: {
  projects: Project[]
  branches: Record<string, string | null | undefined>
  status: PresenceStatus
  onAdd: () => void
  onEdit: (p: Project) => void
  onDelete: (p: Project) => void
  onRefreshBranches: () => void
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
            text="Cadastre as pastas onde você trabalha para rodar scripts e ordens do Claude nelas."
          />
        )}

        {projects.map((p) => {
          const branch = branches[p.id]
          const remoteLive = p.remoteEnabled && status === 'off'
          return (
            <div
              key={p.id}
              className="group rounded-xl border border-line bg-card-2 p-3 transition-colors hover:border-violet/40"
            >
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
                    branch
                      ? 'border-violet/30 bg-violet/10 text-purple'
                      : 'border-line bg-white/[0.02] text-zinc-600'
                  )}
                >
                  <GitBranch size={11} />
                  {branch === undefined ? '…' : (branch ?? 'sem git')}
                </span>

                {p.remoteEnabled && (
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]',
                      remoteLive
                        ? 'border-amber-400/40 bg-amber-400/10 text-amber-300'
                        : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400'
                    )}
                  >
                    <Radio size={11} className={remoteLive ? 'animate-pulse' : ''} />
                    {remoteLive ? 'Remote Control (aguardando Fase 2)' : 'Remote Control'}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
