// Tela de mudanças: arquivos alterados à esquerda e o diff à direita, sem abrir o editor.
// Clicar no número da linha abre o arquivo no editor, naquela linha.
import { useEffect, useMemo, useState } from 'react'
import { Check, Code2, FileDiff, Loader2, RefreshCw } from 'lucide-react'
import type { DiffFile, DiffSummary, DiffText, Project } from '@shared/types'
import { parseUnified } from '@shared/diff'
import { Button, Modal } from './ui'
import { cn } from '../lib/utils'

const STATUS: Record<DiffFile['status'], { label: string; cls: string; tip: string }> = {
  M: { label: 'M', cls: 'text-purple', tip: 'Alterado' },
  A: { label: 'A', cls: 'text-sky-300', tip: 'Novo' },
  '?': { label: 'N', cls: 'text-sky-300', tip: 'Novo (ainda sem git add)' },
  D: { label: 'D', cls: 'text-red-300', tip: 'Apagado' },
  R: { label: 'R', cls: 'text-violet-200', tip: 'Renomeado' }
}
const MAX_LINES = 3000

export function DiffModal({
  project,
  open,
  onClose,
  initialMode = 'local',
  onResult
}: {
  project: Project | null
  open: boolean
  onClose: () => void
  initialMode?: 'local' | 'base'
  onResult: (r: { ok: boolean; message: string }) => void
}) {
  const [mode, setMode] = useState<'local' | 'base'>(initialMode)
  const [sum, setSum] = useState<DiffSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const [text, setText] = useState<DiffText | null>(null)
  const [loadingFile, setLoadingFile] = useState(false)
  const [viewed, setViewed] = useState<Set<string>>(new Set())
  const [all, setAll] = useState(false)

  useEffect(() => {
    if (open) setMode(initialMode)
  }, [open, initialMode])

  const load = async () => {
    if (!project) return
    setLoading(true)
    try {
      const s = await window.api.diffSummary(project.id, mode)
      setSum(s)
      setSel((cur) => (cur && s.files.some((f) => f.path === cur) ? cur : s.files[0]?.path ?? null))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    if (open) void load()
  }, [open, mode, project?.id])

  const file = sum?.files.find((f) => f.path === sel) ?? null
  useEffect(() => {
    setText(null)
    setAll(false)
    if (!open || !project || !file || !sum) return
    let alive = true
    setLoadingFile(true)
    void window.api.diffFile(project.id, file, sum.ref).then((t) => {
      if (alive) {
        setText(t)
        setLoadingFile(false)
      }
    })
    return () => {
      alive = false
    }
  }, [sel, sum?.ref, open])

  const lines = useMemo(() => (text && !text.binary ? parseUnified(text.text) : []), [text])
  const totals = useMemo(() => {
    const f = sum?.files ?? []
    return { add: f.reduce((a, x) => a + (x.add ?? 0), 0), del: f.reduce((a, x) => a + (x.del ?? 0), 0) }
  }, [sum])
  const key = (f: DiffFile) => `${sum?.ref}:${f.path}`
  const toggleViewed = (f: DiffFile) =>
    setViewed((v) => {
      const n = new Set(v)
      if (n.has(key(f))) n.delete(key(f))
      else n.add(key(f))
      return n
    })
  const openAt = async (path: string, line?: number) => {
    if (!project) return
    const r = await window.api.openEditor(project.id, path, line)
    if (!r.ok) onResult(r)
  }
  const seen = sum ? sum.files.filter((f) => viewed.has(key(f))).length : 0
  const shown = all ? lines : lines.slice(0, MAX_LINES)

  return (
    <Modal open={open && !!project} onClose={onClose} title={`Mudanças · ${project?.name ?? ''}`} icon={<FileDiff size={15} />} width="max-w-[min(1400px,96vw)]">
      <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="diff-modal">
        <div className="inline-flex overflow-hidden rounded-lg border border-line" role="radiogroup" aria-label="Comparar com">
          {(
            [
              ['local', 'Sem commit', 'O que mudou na pasta desde o último commit'],
              ['base', 'Desde a base', 'Tudo o que a branch mudou desde que saiu da principal (o que vai no PR), com o que ainda não tem commit']
            ] as const
          ).map(([m, label, tip]) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              title={tip}
              onClick={() => setMode(m)}
              className={cn('cursor-pointer px-2.5 py-1', mode === m ? 'bg-violet/20 text-white' : 'text-zinc-400 hover:text-white')}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-zinc-500">
          {sum?.branch && <span className="font-mono text-zinc-300">{sum.branch}</span>}
          {sum?.ok && sum.refLabel && <> × {sum.refLabel}</>}
          {sum?.ok && (
            <>
              {' '}
              · {sum.files.length} arquivo(s) · <span className="text-sky-300">+{totals.add}</span> <span className="text-red-300">−{totals.del}</span>
              {seen > 0 && ` · ${seen} visto(s)`}
            </>
          )}
        </span>
        <span className="ml-auto flex gap-2">
          <Button size="sm" onClick={() => void load()} disabled={loading} title="Ler de novo">
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </Button>
          <Button size="sm" onClick={() => project && void window.api.openEditor(project.id).then((r) => !r.ok && onResult(r))}>
            <Code2 size={12} /> Abrir no editor
          </Button>
        </span>
      </div>

      {sum && !sum.ok ? (
        <div className="rounded-lg border border-line p-6 text-center text-sm text-zinc-400">{sum.message}</div>
      ) : sum && !sum.files.length ? (
        <div className="rounded-lg border border-dashed border-line p-10 text-center text-sm text-zinc-500">
          Nada mudou {mode === 'local' ? 'desde o último commit' : `desde ${sum.refLabel}`}.
        </div>
      ) : (
        <div className="flex h-[64vh] min-h-0 gap-3">
          <ul className="w-72 shrink-0 overflow-y-auto rounded-lg border border-line bg-bg/40 p-1" data-testid="diff-files">
            {(sum?.files ?? []).map((f) => {
              const st = STATUS[f.status]
              const name = f.path.split('/').pop()
              const dir = f.path.slice(0, f.path.length - (name?.length ?? 0))
              return (
                <li key={f.path}>
                  <div
                    className={cn(
                      'group flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs',
                      sel === f.path ? 'bg-violet/15 text-white' : 'text-zinc-300 hover:bg-white/5',
                      viewed.has(key(f)) && sel !== f.path && 'opacity-50'
                    )}
                    onClick={() => setSel(f.path)}
                    title={f.oldPath ? `${f.oldPath} → ${f.path}` : f.path}
                  >
                    <span className={cn('w-3 shrink-0 font-mono text-[11px]', st.cls)} title={st.tip}>
                      {st.label}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-zinc-500">{dir}</span>
                      {name}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                      {f.binary ? 'bin' : `${f.add !== null ? '+' + f.add : ''} ${f.del ? '−' + f.del : ''}`}
                    </span>
                    <button
                      type="button"
                      title={viewed.has(key(f)) ? 'Desmarcar como visto' : 'Marcar como visto'}
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleViewed(f)
                      }}
                      className={cn('shrink-0 cursor-pointer rounded p-0.5', viewed.has(key(f)) ? 'text-purple' : 'text-zinc-600 opacity-0 group-hover:opacity-100')}
                    >
                      <Check size={12} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>

          <div className="min-w-0 flex-1 overflow-auto rounded-lg border border-line bg-bg/40 font-mono text-[12px] leading-[1.55]" data-testid="diff-view">
            {file && (
              <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-card px-3 py-1.5 font-sans text-xs">
                <span className="min-w-0 flex-1 truncate text-zinc-200">{file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}</span>
                {file.status !== 'D' && (
                  <button type="button" className="cursor-pointer text-purple hover:underline" onClick={() => void openAt(file.path)}>
                    abrir no editor
                  </button>
                )}
                <button type="button" className="cursor-pointer text-zinc-400 hover:text-white" onClick={() => toggleViewed(file)}>
                  {viewed.has(key(file)) ? 'visto ✓' : 'marcar como visto'}
                </button>
              </div>
            )}
            {loadingFile ? (
              <div className="flex items-center gap-2 p-4 font-sans text-xs text-zinc-500">
                <Loader2 size={12} className="animate-spin" /> Lendo…
              </div>
            ) : text?.error ? (
              <div className="p-4 font-sans text-xs text-red-300">{text.error}</div>
            ) : text?.binary ? (
              <div className="p-4 font-sans text-xs text-zinc-500">Arquivo binário (imagem, PDF…): sem diff de texto.</div>
            ) : (
              <table className="w-full border-collapse">
                <tbody>
                  {shown.map((l, i) =>
                    l.kind === 'hunk' ? (
                      <tr key={i} className="bg-violet/10 text-zinc-500">
                        <td colSpan={3} className="px-3 py-0.5 text-[11px]">
                          {l.text}
                        </td>
                      </tr>
                    ) : (
                      <tr key={i} className={l.kind === 'add' ? 'bg-sky-500/10' : l.kind === 'del' ? 'bg-red-500/10' : ''}>
                        <td className="w-12 select-none px-2 text-right text-[11px] text-zinc-600">{l.oldNo ?? ''}</td>
                        <td
                          className={cn('w-12 select-none px-2 text-right text-[11px] text-zinc-600', l.newNo !== null && file?.status !== 'D' && 'cursor-pointer hover:text-purple')}
                          title={l.newNo ? 'Abrir no editor nesta linha' : ''}
                          onClick={() => l.newNo && file && file.status !== 'D' && void openAt(file.path, l.newNo)}
                        >
                          {l.newNo ?? ''}
                        </td>
                        <td
                          className={cn(
                            'selectable whitespace-pre px-2',
                            l.kind === 'add' ? 'text-sky-100' : l.kind === 'del' ? 'text-red-200' : l.kind === 'meta' ? 'text-zinc-600' : 'text-zinc-300'
                          )}
                        >
                          <span className="select-none text-zinc-600">{l.kind === 'add' ? '+' : l.kind === 'del' ? '−' : ' '}</span>
                          {l.text}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            )}
            {!all && lines.length > MAX_LINES && (
              <div className="p-3 text-center font-sans text-xs">
                <Button size="sm" onClick={() => setAll(true)}>
                  Mostrar as {lines.length - MAX_LINES} linhas restantes
                </Button>
              </div>
            )}
            {text?.truncated && <div className="p-3 font-sans text-[11px] text-zinc-500">Diff muito grande: mostrei o começo. Abra no editor para ver o resto.</div>}
          </div>
        </div>
      )}
    </Modal>
  )
}
