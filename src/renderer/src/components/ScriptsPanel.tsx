import { FileCode2, FolderTree, Pencil, Play, Plus, Sparkles, SquareTerminal, Trash2 } from 'lucide-react'
import type { Project, Script } from '@shared/types'
import { Button, EmptyState, IconButton } from './ui'
import { cn, extractVariables, targetLabel } from '../lib/utils'

export function ScriptsPanel({
  scripts,
  projects,
  onAdd,
  onEdit,
  onDelete,
  onRun
}: {
  scripts: Script[]
  projects: Project[]
  onAdd: () => void
  onEdit: (s: Script) => void
  onDelete: (s: Script) => void
  onRun: (s: Script) => void
}) {
  return (
    <section className="flex min-h-0 flex-col rounded-2xl border border-line bg-card">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <FileCode2 size={16} className="text-purple" />
          <h2 className="text-sm font-semibold text-zinc-100">Scripts &amp; Ordens</h2>
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-zinc-500">{scripts.length}</span>
        </div>
        <Button variant="primary" size="sm" onClick={onAdd}>
          <Plus size={14} /> Script
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {scripts.length === 0 && (
          <EmptyState
            icon={<FileCode2 size={20} />}
            title="Nenhum script ainda"
            text="Salve comandos de terminal ou ordens prontas para o Claude e rode com um clique."
          />
        )}

        {scripts.map((s) => {
          const isClaude = s.type === 'claude'
          const vars = extractVariables(s.content)
          return (
            <div
              key={s.id}
              className="group flex items-center gap-3 rounded-xl border border-line bg-card-2 p-3 transition-colors hover:border-violet/40"
            >
              <div
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                  isClaude ? 'bg-violet/15 text-purple' : 'bg-zinc-800 text-zinc-300'
                )}
              >
                {isClaude ? <Sparkles size={16} /> : <SquareTerminal size={16} />}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-zinc-100">{s.name}</span>
                  {vars.length > 0 && (
                    <span
                      className="shrink-0 rounded bg-violet/10 px-1.5 font-mono text-[10px] text-purple"
                      title={vars.join(', ')}
                    >
                      {`{{${vars.length}}}`}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
                  <span className="inline-flex items-center gap-1">
                    <FolderTree size={11} />
                    {targetLabel(s.target, projects)}
                  </span>
                  <span className="truncate font-mono text-zinc-600">{s.content.split('\n')[0]}</span>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-0.5">
                <div className="flex opacity-0 transition-opacity group-hover:opacity-100">
                  <IconButton title="Editar script" tone="accent" onClick={() => onEdit(s)}>
                    <Pencil size={13} />
                  </IconButton>
                  <IconButton title="Excluir script" tone="danger" onClick={() => onDelete(s)}>
                    <Trash2 size={13} />
                  </IconButton>
                </div>
                <Button size="sm" variant="outline" className="ml-1" onClick={() => onRun(s)}>
                  <Play size={12} className="text-purple" /> Executar
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
