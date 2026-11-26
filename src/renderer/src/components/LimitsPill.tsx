// Pílula do topo: quanto da janela de 5h (e da semana) do Claude já foi usado e quando reseta
import { useEffect, useRef, useState } from 'react'
import { Gauge } from 'lucide-react'
import type { AccountInfo, LimitWindow, LimitsState } from '@shared/types'
import { cn } from '../lib/utils'

/** "16:40", "amanhã 09:10" ou "qui 09:10" */
export function fmtReset(ms: number | null, now = Date.now()): string {
  if (!ms) return 'sem horário'
  const d = new Date(ms)
  const hm = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  const days = Math.round((new Date(d.toDateString()).getTime() - new Date(new Date(now).toDateString()).getTime()) / 86400_000)
  if (days <= 0) return hm
  if (days === 1) return `amanhã ${hm}`
  return `${d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')} ${hm}`
}

/** "2h10" até o horário */
export function fmtLeft(ms: number | null, now = Date.now()): string {
  if (!ms || ms <= now) return ''
  const m = Math.round((ms - now) / 60_000)
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}` : `${m} min`
}

export function useLimits(): LimitsState | null {
  const [s, setS] = useState<LimitsState | null>(null)
  useEffect(() => {
    void window.api.limitsState().then(setS)
    return window.api.onLimits(setS)
  }, [])
  // Reavalia a cada minuto (o reset pode passar sem evento novo)
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 60_000)
    return () => clearInterval(t)
  }, [])
  return s
}

const pctText = (w: LimitWindow | null) => (w?.pct !== null && w?.pct !== undefined ? `${Math.round(w.pct)}%` : '—')

export function LimitsPill() {
  const s = useLimits()
  const [open, setOpen] = useState(false)
  const [account, setAccount] = useState<AccountInfo | null>(null)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (open) void window.api.accounts().then((l) => setAccount(l.find((a) => a.service === 'claude') ?? null))
  }, [open])
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  if (!s) return null
  const five = s.fiveHour
  const week = s.sevenDay
  const blocked = !!s.blockedUntil || five?.status === 'bloqueado' || week?.status === 'bloqueado'
  const warn = !blocked && (five?.status === 'aviso' || (five?.pct ?? 0) >= 80)
  const now = Date.now()
  return (
    <div className="relative hidden md:block" ref={box}>
      <button
        type="button"
        data-testid="limits-pill"
        onClick={() => setOpen(!open)}
        title="Uso do Claude: janela de 5h e semana"
        className={cn(
          'inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs whitespace-nowrap tabular-nums transition-colors',
          blocked
            ? 'border-red-500/50 bg-red-500/10 text-red-300'
            : warn
              ? 'border-violet/60 bg-violet/10 text-purple'
              : 'border-line bg-card text-zinc-400 hover:border-violet/60 hover:text-white'
        )}
      >
        <Gauge size={13} />
        {five ? (
          <>
            5h {pctText(five)}
            {five.resetsAt ? <span className="text-zinc-500">· {fmtReset(five.resetsAt, now)}</span> : null}
          </>
        ) : (
          'Uso do Claude'
        )}
        {week?.pct !== null && week?.pct !== undefined && <span className="hidden text-zinc-500 xl:inline">· sem {pctText(week)}</span>}
      </button>
      {open && (
        <div className="absolute top-11 right-0 z-50 w-80 rounded-xl border border-line bg-card-2 p-3 text-xs text-zinc-300 shadow-xl">
          <div className="text-sm font-semibold text-zinc-100">Uso do Claude</div>
          <div className="mb-2 truncate text-[11px] text-zinc-500" data-testid="limits-account">
            {account ? (account.who ? `Conta: ${account.who}${account.plan ? ' · ' + account.plan : ''}${account.org ? ' · ' + account.org : ''}` : 'Nenhuma conta logada no Claude') : '…'}
          </div>
          <Row label="Janela de 5h" w={five} now={now} />
          <Row label="Semana" w={week} now={now} />
          <div className="mt-2 border-t border-line pt-2 text-[11px] text-zinc-500">
            {s.blockedUntil ? (
              <span className="text-red-300">A fila e as fases esperam até {fmtReset(s.blockedUntil, now)} (teto de {s.capPct}% da janela).</span>
            ) : (
              <>A fila e as fases usam até {s.capPct}% da janela de 5h; passou disso, esperam o reset.</>
            )}
            {!five && (
              <div className="mt-1">
                Os números aparecem depois da primeira tarefa do Claude pelo app
                {s.statusLine ? '' : ' (ou ligue a linha de status em Configurações → IAs para ler também as sessões no terminal)'}.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, w, now }: { label: string; w: LimitWindow | null; now: number }) {
  const pct = w?.pct ?? null
  return (
    <div className="mb-2">
      <div className="flex justify-between">
        <span>{label}</span>
        <span className="tabular-nums">
          {pct !== null ? `${Math.round(pct)}%` : 'sem dados'}
          {w?.status === 'bloqueado' && <span className="ml-1 text-red-300">estourou</span>}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={cn('h-full rounded-full', w?.status === 'bloqueado' ? 'bg-red-400' : 'bg-violet')}
          style={{ width: `${Math.min(100, pct ?? 0)}%` }}
        />
      </div>
      {w?.resetsAt ? (
        <div className="mt-0.5 text-[11px] text-zinc-500">
          reseta {fmtReset(w.resetsAt, now)} {fmtLeft(w.resetsAt, now) && `(em ${fmtLeft(w.resetsAt, now)})`}
        </div>
      ) : null}
    </div>
  )
}
