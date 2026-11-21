import { useEffect, useMemo, useState } from 'react'
import { DollarSign, Unlock } from 'lucide-react'
import type { AppConfig, CostEntry, CostGuard, Demand } from '@shared/types'
import { cn } from '../lib/utils'
import { Button, Modal } from './ui'

const AI: Record<CostEntry['ai'], string> = { claude: 'Claude', gemini: 'Gemini', codex: 'ChatGPT' }
const SOURCE: Record<CostEntry['source'], string> = {
  app: 'Console / app',
  telegram: 'Telegram',
  pedido: 'Pedidos do chat',
  projeto: 'Projeto',
  demanda: 'Demandas',
  fila: 'Fila',
  vigia: 'Vigia',
  resposta: 'Respostas no chat'
}

const usd = (v: number) => `US$ ${v < 10 ? v.toFixed(2) : v.toFixed(1)}`
const tk = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)} mi` : v >= 1e3 ? `${Math.round(v / 1e3)} mil` : String(v))

function dayStart(t: number) {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

interface Row {
  key: string
  label: string
  usd: number
  tokens: number
  runs: number
}

function group(list: CostEntry[], key: (e: CostEntry) => string, label: (k: string) => string): Row[] {
  const m = new Map<string, Row>()
  for (const e of list) {
    const k = key(e)
    const r = m.get(k) ?? { key: k, label: label(k), usd: 0, tokens: 0, runs: 0 }
    r.usd += e.usd ?? 0
    r.tokens += e.tokens ?? 0
    r.runs++
    m.set(k, r)
  }
  return [...m.values()].sort((a, b) => b.usd - a.usd || b.tokens - a.tokens)
}

function Table({ title, rows, testid }: { title: string; rows: Row[]; testid?: string }) {
  const max = Math.max(...rows.map((r) => r.usd), 0.0001)
  return (
    <div data-testid={testid} className="min-w-0 rounded-xl border border-line bg-bg/50 p-3">
      <div className="mb-2 text-xs font-semibold text-zinc-200">{title}</div>
      {!rows.length && <p className="text-[11px] text-zinc-500">Nada no período.</p>}
      <div className="space-y-1.5">
        {rows.slice(0, 8).map((r) => (
          <div key={r.key} className="text-[11px]">
            <div className="flex justify-between gap-2">
              <span className="truncate text-zinc-300">{r.label}</span>
              <span className="shrink-0 text-zinc-400 tabular-nums">
                {r.usd ? usd(r.usd) : ''}
                {r.tokens && !r.usd ? `${tk(r.tokens)} tokens` : ''}
                <span className="text-zinc-600"> · {r.runs}×</span>
              </span>
            </div>
            {r.usd > 0 && (
              <div className="mt-0.5 h-1 rounded-full bg-white/5">
                <div className="h-1 rounded-full bg-violet/70" style={{ width: `${(r.usd / max) * 100}%` }} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Gastos com IA: por dia, projeto, demanda, IA e origem, com limite diário */
export function CostsModal({
  open,
  onClose,
  config,
  demands,
  guard,
  onSaveLimit
}: {
  open: boolean
  onClose: () => void
  config: AppConfig
  demands: Demand[]
  guard: CostGuard | null
  onSaveLimit: (v: number) => void
}) {
  const [entries, setEntries] = useState<CostEntry[]>([])
  const [days, setDays] = useState<7 | 30>(7)
  const [limit, setLimit] = useState('')
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    if (!open) return
    window.api.costs().then(setEntries)
    setLimit(config.costs.dailyLimitUsd ? String(config.costs.dailyLimitUsd) : '')
  }, [open, guard?.todayUsd, config.costs.dailyLimitUsd])

  const today = dayStart(Date.now())
  const from = today - (days - 1) * 86_400_000
  const list = useMemo(() => entries.filter((e) => e.at >= from), [entries, from])
  const total = list.reduce((s, e) => s + (e.usd ?? 0), 0)
  const otherTokens = list.filter((e) => e.ai !== 'claude').reduce((s, e) => s + (e.tokens ?? 0), 0)

  const perDay = Array.from({ length: days }, (_, i) => {
    const start = from + i * 86_400_000
    const items = list.filter((e) => e.at >= start && e.at < start + 86_400_000)
    return { start, usd: items.reduce((s, e) => s + (e.usd ?? 0), 0), runs: items.length }
  })
  const maxDay = Math.max(...perDay.map((d) => d.usd), config.costs.dailyLimitUsd || 0, 0.01)
  const projName = (id: string) => config.projects.find((p) => p.id === id)?.name ?? (id ? 'projeto removido' : 'Sem projeto')
  const demandName = (id: string) => {
    const d = demands.find((x) => x.id === id)
    return d ? `${d.key} · ${d.title || d.jira?.summary || ''}` : 'demanda removida'
  }

  return (
    <Modal open={open} onClose={onClose} title="Gastos com IA" icon={<DollarSign size={16} />} width="max-w-5xl">
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-line bg-bg/50 p-3">
          <div className="text-[11px] text-zinc-500">Hoje</div>
          <div data-testid="costs-today" className="text-2xl font-semibold text-zinc-100 tabular-nums">
            {usd(guard?.todayUsd ?? 0)}
          </div>
          {guard && guard.limitUsd > 0 && (
            <div className={cn('text-[11px]', guard.over ? 'text-red-300' : 'text-zinc-500')}>
              de {usd(guard.limitUsd)} {guard.over ? (guard.overridden ? '· liberado hoje' : '· automações pausadas') : ''}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-line bg-bg/50 p-3">
          <div className="text-[11px] text-zinc-500">Últimos {days} dias</div>
          <div className="text-2xl font-semibold text-zinc-100 tabular-nums">{usd(total)}</div>
          {otherTokens > 0 && <div className="text-[11px] text-zinc-500">+ {tk(otherTokens)} tokens (Gemini/ChatGPT)</div>}
        </div>
        <div className="space-y-1.5 rounded-xl border border-line bg-bg/50 p-3">
          <div className="text-[11px] text-zinc-500">Limite diário (US$)</div>
          <div className="flex gap-2">
            <input
              data-testid="costs-limit"
              type="number"
              min={0}
              step={0.5}
              value={limit}
              placeholder="sem limite"
              onChange={(e) => setLimit(e.target.value)}
              className="h-8 w-24 rounded-lg border border-line bg-bg px-2 text-sm text-zinc-200 outline-none focus:border-violet/60"
            />
            <Button size="sm" onClick={() => onSaveLimit(Math.max(0, Number(limit) || 0))}>
              Salvar
            </Button>
          </div>
          {guard?.over && !guard.overridden && (
            <Button size="sm" onClick={() => window.api.costOverrideToday()}>
              <Unlock size={12} /> Liberar hoje
            </Button>
          )}
        </div>
      </div>
      <p className="text-[11px] text-zinc-500">
        Valores do Claude são o custo estimado que ele informa (equivalente da API; no plano Pro/Max não é cobrado à parte,
        mas mostra o quanto você usou). Gemini e ChatGPT informam só tokens. Passando do limite, a fila, o Vigia e as regras
        automáticas param até o dia seguinte; o que você manda na mão continua funcionando.
      </p>

      <div className="rounded-xl border border-line bg-bg/50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-zinc-200">Por dia (US$)</span>
          <div className="flex overflow-hidden rounded-lg border border-line">
            {([7, 30] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={cn('cursor-pointer px-2.5 py-1 text-[11px]', days === d ? 'bg-violet/20 text-purple' : 'text-zinc-400')}
              >
                {d} dias
              </button>
            ))}
          </div>
        </div>
        <div className="relative flex h-36 items-end gap-[2px] border-b border-line" onMouseLeave={() => setHover(null)}>
          {config.costs.dailyLimitUsd > 0 && (
            <div
              className="pointer-events-none absolute right-0 left-0 border-t border-dashed border-zinc-500/60"
              style={{ bottom: `${(config.costs.dailyLimitUsd / maxDay) * 100}%` }}
            >
              <span className="absolute -top-4 right-0 text-[10px] text-zinc-500">limite</span>
            </div>
          )}
          {perDay.map((d, i) => (
            <div key={d.start} className="flex h-full min-w-0 flex-1 items-end" onMouseEnter={() => setHover(i)}>
              <div
                className={cn('w-full rounded-t-[4px]', hover === i ? 'bg-violet' : 'bg-violet/70')}
                style={{ height: `${Math.max((d.usd / maxDay) * 100, d.usd ? 2 : 0)}%` }}
              />
            </div>
          ))}
          {hover !== null && (
            <div
              className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 rounded-lg border border-line bg-card px-2 py-1 text-[11px] whitespace-nowrap text-zinc-200 shadow-xl"
              style={{ left: `${((hover + 0.5) / days) * 100}%` }}
            >
              {new Date(perDay[hover].start).toLocaleDateString([], { weekday: 'short', day: '2-digit', month: '2-digit' })} ·{' '}
              {usd(perDay[hover].usd)} · {perDay[hover].runs} execução(ões)
            </div>
          )}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-zinc-600">
          <span>{new Date(from).toLocaleDateString([], { day: '2-digit', month: '2-digit' })}</span>
          <span>hoje</span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Table title="Por projeto" testid="costs-by-project" rows={group(list, (e) => e.projectId ?? '', projName)} />
        <Table
          title="Por demanda"
          rows={group(
            list.filter((e) => e.demandId),
            (e) => e.demandId!,
            demandName
          )}
        />
        <Table title="Por IA" rows={group(list, (e) => e.ai, (k) => AI[k as CostEntry['ai']] ?? k)} />
        <Table title="Por origem" rows={group(list, (e) => e.source, (k) => SOURCE[k as CostEntry['source']] ?? k)} />
      </div>

      <div className="rounded-xl border border-line bg-bg/50 p-3">
        <div className="mb-2 text-xs font-semibold text-zinc-200">Execuções mais caras do período</div>
        {list
          .filter((e) => e.usd)
          .sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0))
          .slice(0, 8)
          .map((e, i) => (
            <div key={i} className="flex justify-between gap-2 text-[11px]">
              <span className="truncate text-zinc-300">
                {e.title} <span className="text-zinc-600">· {new Date(e.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
              </span>
              <span className="shrink-0 text-zinc-400 tabular-nums">{usd(e.usd ?? 0)}</span>
            </div>
          ))}
        {!list.some((e) => e.usd) && <p className="text-[11px] text-zinc-500">Nada no período.</p>}
      </div>
    </Modal>
  )
}
