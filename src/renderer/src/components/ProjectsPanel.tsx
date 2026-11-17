import {
  AlertTriangle,
  Copy,
  ExternalLink,
  FolderGit2,
  GitBranch,
  Loader2,
  Pencil,
  Plus,
  Radio,
  RefreshCw,
  RotateCw,
  Trash2
} from 'lucide-react'
import { useState } from 'react'
import type { PresenceStatus, Project, RemoteSession } from '@shared/types'
import { Button, EmptyState, IconButton } from './ui'
import { cn, shortPath } from '../lib/utils'

export function ProjectsPanel({
  projects,
  branches,
  status,
  remote,
  onAdd,
  onEdit,
  onDelete,
  onRefreshBranches
}: {
  projects: Project[]
  branches: Record<string, string | null | undefined>
  status: PresenceStatus
  remote: Record<string, RemoteSession | undefined>
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
          const session = remote[p.id]
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
                      session?.state === 'active'
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                        : 'border-violet/25 bg-violet/5 text-zinc-400'
                    )}
                  >
                    <Radio size={11} className={session?.state === 'active' ? 'animate-pulse' : ''} />
                    Remote Control
                  </span>
                )}
              </div>

              {p.remoteEnabled && status === 'off' && <RemotePanel session={session} />}
            </div>
          )
        })}
      </div>
    </section>
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
