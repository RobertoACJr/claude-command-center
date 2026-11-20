import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Command, CornerDownLeft } from 'lucide-react'
import { cn } from '../lib/utils'

export interface PaletteItem {
  id: string
  group: string
  label: string
  hint?: string
  icon?: ReactNode
  /** Palavras extras para a busca */
  keywords?: string
  run: () => void
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/** Pontua o item: todas as palavras precisam aparecer; começo de palavra e rótulo valem mais */
function score(item: PaletteItem, words: string[]): number {
  if (!words.length) return 1
  const label = norm(item.label)
  const hay = `${label} ${norm(item.group)} ${norm(item.hint ?? '')} ${norm(item.keywords ?? '')}`
  let total = 0
  for (const w of words) {
    const i = hay.indexOf(w)
    if (i < 0) return 0
    total += label.includes(w) ? 3 : 1
    if (i === 0 || hay[i - 1] === ' ') total += 2
  }
  return total
}

/** Paleta de comandos (Ctrl+K): faz qualquer coisa do app pelo teclado */
export function CommandPalette({ open, onClose, items }: { open: boolean; onClose: () => void; items: PaletteItem[] }) {
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQ('')
      setIdx(0)
    }
  }, [open])

  const shown = useMemo(() => {
    const words = norm(q).split(/\s+/).filter(Boolean)
    return items
      .map((it, i) => ({ it, s: score(it, words), i }))
      .filter((x) => x.s > 0)
      .sort((a, b) => (words.length ? b.s - a.s : 0) || a.i - b.i)
      .slice(0, 60)
      .map((x) => x.it)
  }, [items, q])

  useEffect(() => setIdx(0), [q])
  useEffect(() => {
    list.current?.querySelector(`[data-idx="${idx}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [idx])

  if (!open) return null

  const pick = (it: PaletteItem | undefined) => {
    if (!it) return
    onClose()
    // Deixa a paleta fechar antes (a ação pode abrir outro modal)
    setTimeout(it.run, 0)
  }

  let lastGroup = ''
  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 px-6 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div data-testid="palette" className="animate-modal w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-card shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line px-4">
          <Command size={15} className="text-purple" />
          <input
            autoFocus
            data-testid="palette-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setIdx((i) => Math.min(i + 1, shown.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setIdx((i) => Math.max(i - 1, 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                pick(shown[idx])
              } else if (e.key === 'Escape') {
                e.preventDefault()
                onClose()
              }
            }}
            placeholder="Rodar script, executar projeto, ligar Remote, abrir configurações…"
            className="h-12 min-w-0 flex-1 bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-600"
          />
          <kbd className="rounded border border-line px-1.5 text-[10px] text-zinc-500">Esc</kbd>
        </div>
        <div ref={list} className="max-h-[52vh] overflow-y-auto overflow-x-hidden py-1">
          {shown.length === 0 && <p className="px-4 py-6 text-center text-xs text-zinc-500">Nada encontrado.</p>}
          {shown.map((it, i) => {
            const header = it.group !== lastGroup ? it.group : null
            lastGroup = it.group
            return (
              <div key={it.id}>
                {header && !q && (
                  <div className="px-4 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-zinc-600 uppercase">{header}</div>
                )}
                <button
                  type="button"
                  data-idx={i}
                  onMouseMove={() => setIdx(i)}
                  onClick={() => pick(it)}
                  className={cn(
                    'flex w-full min-w-0 cursor-pointer items-center gap-2.5 px-4 py-2 text-left',
                    i === idx ? 'bg-violet/15' : ''
                  )}
                >
                  <span className="flex w-4 shrink-0 justify-center text-zinc-400">{it.icon}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-100">{it.label}</span>
                  {it.hint && <span className="max-w-[40%] shrink-0 truncate text-[11px] text-zinc-500">{it.hint}</span>}
                  {i === idx && <CornerDownLeft size={12} className="shrink-0 text-zinc-500" />}
                </button>
              </div>
            )
          })}
        </div>
        <div className="flex gap-3 border-t border-line px-4 py-1.5 text-[10px] text-zinc-600">
          <span>↑↓ escolher</span>
          <span>Enter executar</span>
          <span>Ctrl+K abre de qualquer lugar</span>
        </div>
      </div>
    </div>
  )
}
