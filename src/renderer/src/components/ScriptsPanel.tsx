import { Copy, FileCode2, FolderTree, Gem, Globe2, Loader2, Pencil, Play, Plus, Sparkles, SquareTerminal, Trash2 } from 'lucide-react'
import type { Project, Script } from '@shared/types'
import { Button, EmptyState, IconButton } from './ui'
import { cn, extractProjectKeys, extractUserVariables, targetLabel } from '../lib/utils'

export interface ScriptActions {
  onRun: (s: Script) => void
  onEdit: (s: Script) => void
  onDuplicate: (s: Script) => void
  onDelete: (s: Script) => void
}

/** Linha de script, usada nas ações globais e dentro do card do projeto */
export function ScriptRow({
  s,
  projects,
  running,
  compact,
  actions
}: {
  s: Script
  projects: Project[]
  running: boolean
  compact?: boolean
  actions: ScriptActions
}) {
  const isAi = s.type !== 'terminal'
  const vars = extractUserVariables(s.content)
  const pvars = extractProjectKeys(s.content)
  return (
    <div
      className={cn(
        'group flex items-center gap-3 rounded-xl border border-line transition-colors hover:border-violet/40',
        compact ? 'bg-bg/60 p-2' : 'bg-card-2 p-3'
      )}
    >
      <div
        className={cn(
          'flex shrink-0 items-center justify-center rounded-lg',
          compact ? 'h-7 w-7' : 'h-9 w-9',
          isAi ? 'bg-violet/15 text-purple' : 'bg-zinc-800 text-zinc-300'
        )}
      >
        {s.type === 'gemini' ? (
          <Gem size={compact ? 13 : 16} />
        ) : s.type === 'claude' ? (
          <Sparkles size={compact ? 13 : 16} />
        ) : (
          <SquareTerminal size={compact ? 13 : 16} />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn('truncate font-medium text-zinc-100', compact ? 'text-xs' : 'text-sm')}>{s.name}</span>
          {vars.length > 0 && (
            <span className="shrink-0 rounded bg-violet/10 px-1.5 font-mono text-[10px] text-purple" title={vars.join(', ')}>
              {`{{${vars.length}}}`}
            </span>
          )}
          {pvars.length > 0 && (
            <span
              className="shrink-0 rounded bg-white/5 px-1.5 font-mono text-[10px] text-zinc-400"
              title={'Usa do projeto: ' + pvars.join(', ')}
            >
              projeto.{pvars.length === 1 ? pvars[0] : `${pvars.length}`}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
          {!compact && (
            <span className="inline-flex shrink-0 items-center gap-1">
              {s.target.kind === 'ask' ? <Globe2 size={11} /> : <FolderTree size={11} />}
              {targetLabel(s.target, projects)}
            </span>
          )}
          <span className="truncate font-mono text-zinc-600">{s.content.split('\n')[0]}</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <div className="flex opacity-0 transition-opacity group-hover:opacity-100">
          <IconButton title="Editar" tone="accent" onClick={() => actions.onEdit(s)}>
            <Pencil size={13} />
          </IconButton>
          <IconButton title="Duplicar" tone="accent" onClick={() => actions.onDuplicate(s)}>
            <Copy size={13} />
          </IconButton>
          <IconButton title="Excluir" tone="danger" onClick={() => actions.onDelete(s)}>
            <Trash2 size={13} />
          </IconButton>
        </div>
        <Button size="sm" variant="outline" className="ml-1" onClick={() => actions.onRun(s)}>
          {running ? <Loader2 size={12} className="animate-spin text-purple" /> : <Play size={12} className="text-purple" />}
          {compact ? '' : 'Executar'}
        </Button>
      </div>
    </div>
  )
}

export function ScriptsPanel({
  scripts,
  projects,
  runningTabs,
  onAdd,
  actions
}: {
  /** Só as ações globais (sem os scripts que pertencem a um projeto) */
  scripts: Script[]
  projects: Project[]
  runningTabs: Set<string>
  onAdd: () => void
  actions: ScriptActions
}) {
  return (
    <section className="flex min-h-0 flex-col rounded-2xl border border-line bg-card">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <Globe2 size={16} className="text-purple" />
          <h2 className="text-sm font-semibold text-zinc-100">Ações globais</h2>
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-zinc-500">{scripts.length}</span>
        </div>
        <Button variant="primary" size="sm" onClick={onAdd}>
          <Plus size={14} /> Ação
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {scripts.length === 0 && (
          <EmptyState
            icon={<FileCode2 size={20} />}
            title="Nenhuma ação global ainda"
            text='Ações que servem para qualquer projeto, como "Atualizar branch com a master". Na hora de rodar você escolhe o projeto. Scripts de um projeto só ficam dentro do card dele.'
          />
        )}
        {scripts.map((s) => (
          <ScriptRow key={s.id} s={s} projects={projects} running={runningTabs.has(`script:${s.id}`)} actions={actions} />
        ))}
      </div>
    </section>
  )
}
