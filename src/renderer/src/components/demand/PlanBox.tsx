// Plano por fases da demanda: a IA divide em fases com custo estimado (% da janela de 5h do Claude),
// o app distribui no tempo e executa pela fila, no automático ou liberando você mesmo cada fase.
import { useEffect, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, CheckCircle2, Clock, Hand, Layers, Loader2, Pause, Play, Plus, Trash2, XCircle } from 'lucide-react'
import type { Demand, DemandPlan, OpResult, PlanPhase, PlanSlot } from '@shared/types'
import { Button } from '../ui'
import { cn, uid } from '../../lib/utils'
import { fmtReset, useLimits } from '../LimitsPill'
import { areaCls, inputCls } from './shared'

const STATUS: Record<PlanPhase['status'], { label: string; cls: string; icon: ReactNode }> = {
  pendente: { label: 'pendente', cls: 'text-zinc-500', icon: <Clock size={12} /> },
  agendada: { label: 'na fila', cls: 'text-zinc-300', icon: <Clock size={12} /> },
  aguardando: { label: 'esperando você liberar', cls: 'text-purple', icon: <Hand size={12} /> },
  rodando: { label: 'rodando', cls: 'text-purple', icon: <Loader2 size={12} className="animate-spin" /> },
  feita: { label: 'feita', cls: 'text-violet-300', icon: <CheckCircle2 size={12} /> },
  falhou: { label: 'com problema', cls: 'text-red-300', icon: <XCircle size={12} /> }
}

export function PlanBox({ d, working, act }: { d: Demand; working: boolean; act: (fn: () => Promise<OpResult>) => Promise<void> }) {
  const plan = d.plan ?? null
  const limits = useLimits()
  const [slots, setSlots] = useState<PlanSlot[]>([])
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    if (!plan) return setSlots([])
    void window.api.planPreview(d.id).then(setSlots)
  }, [d.id, plan, limits])

  const edit = (next: DemandPlan | null) => act(() => window.api.planEdit(d.id, next))
  const setPhase = (id: string, patch: Partial<PlanPhase>) =>
    plan && edit({ ...plan, phases: plan.phases.map((p) => (p.id === id ? { ...p, ...patch } : p)) })
  const move = (i: number, dir: -1 | 1) => {
    if (!plan) return
    const list = [...plan.phases]
    const j = i + dir
    if (j < 0 || j >= list.length) return
    ;[list[i], list[j]] = [list[j], list[i]]
    void edit({ ...plan, phases: list })
  }
  const total = plan?.phases.filter((p) => p.status !== 'feita').reduce((a, p) => a + p.estPct, 0) ?? 0
  const windows = slots.length ? Math.max(...slots.map((s) => s.window)) + 1 : 0
  const last = slots[slots.length - 1]
  const waiting = plan?.phases.find((p) => p.status === 'aguardando')
  const locked = (p: PlanPhase) => p.status === 'rodando' || p.status === 'agendada' || p.status === 'feita'
  const now = Date.now()

  return (
    <div className="rounded-xl border border-line bg-card-2 p-3" data-testid="plan-box">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5 text-sm font-semibold text-zinc-100">
            <Layers size={14} /> Plano por fases
          </div>
          <div className="text-[11px] text-zinc-500">
            Divide a implementação em fases com custo estimado da janela de 5h do Claude e executa aos poucos, respeitando o limite.
          </div>
        </div>
        <Button
          size="sm"
          data-testid="plan-generate"
          disabled={working || !!plan?.running}
          onClick={() => act(() => window.api.planGenerate(d.id))}
          title={plan?.running ? 'Pause o plano antes de planejar de novo' : 'A IA lê a demanda e o desenho e propõe as fases'}
        >
          <Layers size={12} /> {plan ? 'Planejar de novo' : 'Planejar fases'}
        </Button>
      </div>

      {plan && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
            <div className="inline-flex overflow-hidden rounded-lg border border-line" role="radiogroup" aria-label="Modo">
              {(
                [
                  ['auto', 'Automático', 'Terminou uma fase, a próxima entra sozinha no horário que o limite permite'],
                  ['manual', 'Eu libero cada fase', 'Terminou uma fase, espera você liberar a próxima (aqui ou no Telegram)']
                ] as const
              ).map(([m, label, tip]) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={plan.mode === m}
                  title={tip}
                  data-testid={`plan-mode-${m}`}
                  onClick={() => plan.mode !== m && edit({ ...plan, mode: m })}
                  className={cn('cursor-pointer px-2.5 py-1', plan.mode === m ? 'bg-violet/20 text-white' : 'text-zinc-400 hover:text-white')}
                >
                  {label}
                </button>
              ))}
            </div>
            <span className="text-zinc-500">
              {total ? `~${total}% da janela no que falta` : 'tudo feito'}
              {windows > 1 ? ` · ${windows} janelas de 5h` : ''}
              {last && last.at > now + 60_000 ? ` · última fase começa ${fmtReset(last.at, now)}` : ''}
            </span>
          </div>

          <ol className="mt-3 space-y-1.5">
            {plan.phases.map((p, i) => {
              const st = STATUS[p.status]
              const slot = slots.find((s) => s.id === p.id)
              const when =
                p.status === 'feita' || p.status === 'rodando'
                  ? ''
                  : p.status === 'agendada' && p.scheduledAt
                    ? p.scheduledAt > now + 60_000
                      ? `começa ${fmtReset(p.scheduledAt, now)}`
                      : 'começa agora'
                    : slot
                      ? slot.at > now + 60_000
                        ? `cabe ${fmtReset(slot.at, now)}${slot.window ? ' (depois do reset)' : ''}`
                        : 'cabe agora'
                      : ''
              return (
                <li key={p.id} className="rounded-lg border border-line bg-bg/50 px-2.5 py-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="w-4 shrink-0 text-right text-zinc-500 tabular-nums">{i + 1}</span>
                    {locked(p) ? (
                      <button type="button" className="min-w-0 flex-1 cursor-pointer truncate text-left text-zinc-200" onClick={() => setOpen(open === p.id ? null : p.id)}>
                        {p.title}
                      </button>
                    ) : (
                      <input
                        key={p.id + p.title}
                        className={inputCls + ' h-7 min-w-0 flex-1 text-xs'}
                        defaultValue={p.title}
                        onBlur={(e) => e.target.value.trim() && e.target.value !== p.title && setPhase(p.id, { title: e.target.value.trim() })}
                      />
                    )}
                    <button
                      type="button"
                      disabled={locked(p)}
                      onClick={() => setPhase(p.id, { tier: p.tier === 'light' ? 'heavy' : 'light' })}
                      title="Leve usa o modelo/esforço econômico (se a economia automática estiver ligada)"
                      className={cn('shrink-0 cursor-pointer rounded border px-1.5 py-0.5 text-[10px] disabled:cursor-default', p.tier === 'light' ? 'border-violet-300/40 text-violet-200' : 'border-line text-zinc-400')}
                    >
                      {p.tier === 'light' ? 'leve' : 'normal'}
                    </button>
                    <label className="flex shrink-0 items-center gap-0.5 text-zinc-500" title="Custo estimado em % da janela de 5h">
                      ~
                      {locked(p) ? (
                        <span className="tabular-nums">{p.estPct}</span>
                      ) : (
                        <input
                          key={p.id + p.estPct}
                          type="number"
                          min={1}
                          max={100}
                          className={inputCls + ' h-7 w-14 text-xs'}
                          defaultValue={p.estPct}
                          onBlur={(e) => Number(e.target.value) !== p.estPct && setPhase(p.id, { estPct: Number(e.target.value) || p.estPct })}
                        />
                      )}
                      %
                    </label>
                    <span className={cn('flex shrink-0 items-center gap-1', st.cls)} title={p.error ?? ''}>
                      {st.icon} {st.label}
                    </span>
                    {when && <span className="hidden shrink-0 text-zinc-500 sm:inline">· {when}</span>}
                    {!locked(p) && !plan.running && (
                      <span className="flex shrink-0 items-center">
                        <IconB title="Subir" onClick={() => move(i, -1)}>
                          <ArrowUp size={12} />
                        </IconB>
                        <IconB title="Descer" onClick={() => move(i, 1)}>
                          <ArrowDown size={12} />
                        </IconB>
                        <IconB title="Remover fase" onClick={() => edit({ ...plan, phases: plan.phases.filter((x) => x.id !== p.id) })}>
                          <Trash2 size={12} />
                        </IconB>
                      </span>
                    )}
                  </div>
                  <button type="button" className="mt-1 ml-6 cursor-pointer text-[11px] text-zinc-500 hover:text-zinc-300" onClick={() => setOpen(open === p.id ? null : p.id)}>
                    {open === p.id ? 'esconder detalhes' : 'detalhes'}
                  </button>
                  {open === p.id && (
                    <div className="mt-1 ml-6 space-y-1.5">
                      {locked(p) ? (
                        <pre className="text-[11px] whitespace-pre-wrap text-zinc-400">{p.prompt}</pre>
                      ) : (
                        <textarea
                          key={p.id + p.prompt.length}
                          rows={4}
                          className={areaCls + ' text-xs'}
                          defaultValue={p.prompt}
                          onBlur={(e) => e.target.value.trim() && e.target.value !== p.prompt && setPhase(p.id, { prompt: e.target.value })}
                        />
                      )}
                      {p.error && <div className="text-[11px] text-red-300">{p.error}</div>}
                      {p.summary && <pre className="max-h-40 overflow-y-auto text-[11px] whitespace-pre-wrap text-zinc-400">{p.summary}</pre>}
                    </div>
                  )}
                </li>
              )
            })}
          </ol>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {plan.running ? (
              <Button size="sm" data-testid="plan-pause" onClick={() => act(() => window.api.planPause(d.id))}>
                <Pause size={12} /> Pausar plano
              </Button>
            ) : (
              <Button size="sm" variant="primary" data-testid="plan-start" disabled={working || !total} onClick={() => act(() => window.api.planStart(d.id))}>
                <Play size={12} /> {plan.phases.some((p) => p.status === 'feita') ? 'Continuar plano' : 'Iniciar plano'}
              </Button>
            )}
            {waiting && (
              <Button size="sm" variant="primary" data-testid="plan-release" onClick={() => act(() => window.api.planRelease(d.id))}>
                <Play size={12} /> Liberar fase {plan.phases.indexOf(waiting) + 1}
              </Button>
            )}
            {!plan.running && (
              <>
                <Button
                  size="sm"
                  onClick={() =>
                    edit({
                      ...plan,
                      phases: [...plan.phases, { id: uid(), title: 'Nova fase', prompt: 'Descreva o que fazer nesta fase.', tier: 'heavy', estPct: 15, status: 'pendente' }]
                    })
                  }
                >
                  <Plus size={12} /> Fase
                </Button>
                <Button size="sm" onClick={() => window.confirm('Apagar o plano por fases desta demanda?') && edit(null)}>
                  <Trash2 size={12} /> Apagar plano
                </Button>
              </>
            )}
          </div>
          <p className="mt-2 text-[11px] text-zinc-600">
            As fases rodam pela fila na hora agendada, mesmo com você Online (na cópia separada da demanda, se ela estiver ligada na fila).
            Bateu no limite no meio de uma fase? Ela volta sozinha depois do reset.
          </p>
        </>
      )}
    </div>
  )
}

function IconB({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" title={title} onClick={onClick} className="cursor-pointer rounded p-1 text-zinc-500 hover:bg-white/5 hover:text-white">
      {children}
    </button>
  )
}
