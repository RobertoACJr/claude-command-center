import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Clock3, Copy, History, Loader2, StopCircle, Trash2, XCircle } from 'lucide-react'
import type { HistoryEntry, Project } from '@shared/types'
import { cn, shortPath } from '../lib/utils'
import { Button, Modal } from './ui'

const ORIGIN: Record<HistoryEntry['origin'], string> = {
  app: 'app',
  telegram: 'Telegram',
  pedido: 'pedido do chat',
  projeto: 'projeto'
}

const KIND: Record<HistoryEntry['kind'], string> = { terminal: 'Terminal', claude: 'Claude', gemini: 'Gemini', codex: 'ChatGPT' }

function StatusIcon({ s }: { s: HistoryEntry['status'] }) {
  if (s === 'running') return <Loader2 size={14} className="animate-spin text-purple" />
  if (s === 'ok') return <CheckCircle2 size={14} className="text-emerald-400" />
  if (s === 'error') return <XCircle size={14} className="text-rose-400" />
  return <StopCircle size={14} className="text-amber-300" />
}

const fmt = (t: number) =>
  new Date(t).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })

function duration(e: HistoryEntry, now: number) {
  const s = Math.round(((e.endedAt ?? now) - e.startedAt) / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}min ${String(s % 60).padStart(2, '0')}s`
}

/** Histórico de execuções: o que rodou, quando, quem disparou, resultado e a saída completa. Fica só no seu PC. */
export function HistoryModal({ open, onClose, projects }: { open: boolean; onClose: () => void; projects: Project[] }) {
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<'all' | 'error' | 'ok'>('all')

  useEffect(() => {
    if (!open) return
    window.api.history().then(setEntries)
    return window.api.onHistory(setEntries)
  }, [open])

  useEffect(() => {
    if (!sel) return setLog([])
    let alive = true
    const load = () => window.api.historyLog(sel).then((l) => alive && setLog(l))
    load()
    // Em andamento: atualiza a saída enquanto roda
    const running = entries.find((e) => e.id === sel)?.status === 'running'
    const t = running ? setInterval(load, 1500) : null
    return () => {
      alive = false
      if (t) clearInterval(t)
    }
  }, [sel, entries])

  const names = useMemo(() => Object.fromEntries(projects.map((p) => [p.id, p.name])), [projects])
  const shown = entries.filter((e) => {
    if (status === 'error' && e.status !== 'error') return false
    if (status === 'ok' && e.status !== 'ok') return false
    if (!q.trim()) return true
    const hay = `${e.title} ${names[e.projectId ?? ''] ?? ''} ${e.cwd} ${ORIGIN[e.origin]}`.toLowerCase()
    return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))
  })
  const current = entries.find((e) => e.id === sel)
  const now = Date.now()

  return (
    <Modal open={open} onClose={onClose} title="Histórico de execuções" icon={<History size={16} />} width="max-w-6xl">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          data-testid="history-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nome, projeto, pasta…"
          className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 text-sm text-zinc-200 outline-none focus:border-violet/60"
        />
        {(['all', 'error', 'ok'] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={cn(
              'h-9 cursor-pointer rounded-lg border px-3 text-xs',
              status === s ? 'border-violet/60 bg-violet/15 text-purple' : 'border-line text-zinc-400 hover:text-white'
            )}
          >
            {s === 'all' ? 'Tudo' : s === 'error' ? 'Falhas' : 'Sucesso'}
          </button>
        ))}
        <Button
          size="sm"
          onClick={async () => {
            await window.api.clearHistory()
            setSel(null)
          }}
          title="Apaga o histórico (o que estiver rodando fica)"
        >
          <Trash2 size={12} /> Limpar
        </Button>
      </div>
      <p className="text-[11px] text-zinc-500">
        Guarda as últimas 300 execuções com a saída completa. Fica só neste PC, na pasta de dados do app.
      </p>

      <div className="grid h-[58vh] grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3">
        <div data-testid="history-list" className="min-w-0 overflow-y-auto overflow-x-hidden rounded-xl border border-line">
          {shown.length === 0 && <p className="p-6 text-center text-xs text-zinc-500">Nada por aqui ainda.</p>}
          {shown.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => setSel(e.id)}
              className={cn(
                'flex w-full min-w-0 cursor-pointer items-start gap-2 border-b border-line/60 px-3 py-2 text-left hover:bg-white/5',
                sel === e.id && 'bg-violet/10'
              )}
            >
              <span className="mt-0.5">
                <StatusIcon s={e.status} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-zinc-100">{e.title}</span>
                <span className="block truncate text-[11px] text-zinc-500">
                  {fmt(e.startedAt)} · {duration(e, now)} · {KIND[e.kind]}
                  {e.origin !== 'app' && ` · via ${ORIGIN[e.origin]}`}
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-bg">
          {!current ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-xs text-zinc-500">
              <Clock3 size={14} /> Escolha uma execução para ver a saída.
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-2 border-b border-line px-3 py-2">
                <div className="min-w-0 text-[11px] leading-relaxed text-zinc-400">
                  <div className="truncate text-xs font-semibold text-zinc-100">{current.title}</div>
                  <div>
                    {fmt(current.startedAt)} · {duration(current, now)} · {KIND[current.kind]} · via {ORIGIN[current.origin]}
                    {current.code !== null && ` · código ${current.code}`}
                  </div>
                  <div className="truncate font-mono" title={current.cwd}>
                    {shortPath(current.cwd, 70)}
                  </div>
                </div>
                <Button size="sm" onClick={() => window.api.copyText(log.join('\n'))} title="Copiar a saída">
                  <Copy size={12} /> Copiar
                </Button>
              </div>
              <pre
                data-testid="history-log"
                className="selectable min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-zinc-300 [overflow-wrap:anywhere]"
              >
                {log.join('\n') || '(sem saída)'}
              </pre>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
