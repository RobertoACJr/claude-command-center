import { useEffect, useMemo, useState } from 'react'
import { ArrowRightLeft, Clock, Loader2, Pause, Play, Send, Trash2 } from 'lucide-react'
import type { JiraTransition, OpResult, WorkLogState, WorkSession } from '@shared/types'
import { Button, IconButton, Modal } from './ui'
import { cn } from '../lib/utils'

// ---------------------------------------------------------------- estado compartilhado

let cache: WorkLogState = { active: null, sessions: [] }
const subs = new Set<(s: WorkLogState) => void>()
let wired = false

function wire() {
  if (wired) return
  wired = true
  void window.api.worklogState().then(set)
  window.api.onWorklog(set)
}
function set(s: WorkLogState) {
  cache = s
  subs.forEach((f) => f(s))
}

export function useWorklog(): WorkLogState {
  const [s, setS] = useState(cache)
  useEffect(() => {
    wire()
    subs.add(setS)
    setS(cache)
    return () => {
      subs.delete(setS)
    }
  }, [])
  return s
}

/** Atualiza a tela a cada `ms` enquanto `on` */
function useTick(on: boolean, ms = 30_000) {
  const [, setN] = useState(0)
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => setN((n) => n + 1), ms)
    return () => clearInterval(t)
  }, [on, ms])
}

export const fmtHM = (ms: number) => {
  const t = Math.max(0, Math.round(ms / 60000))
  return `${Math.floor(t / 60)}h${String(t % 60).padStart(2, '0')}`
}

const dur = (s: WorkSession, now = Date.now()) => (s.end ?? now) - s.start
const dayOf = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const openWorklog = () => window.dispatchEvent(new CustomEvent('helice:open-worklog'))

// ---------------------------------------------------------------- cronômetro no topo

export function WorkTimer() {
  const w = useWorklog()
  useTick(!!w.active)
  if (!w.active) {
    return (
      <IconButton title="Jornadas: tempo em cada demanda" onClick={openWorklog} data-testid="worklog-open">
        <Clock size={15} />
      </IconButton>
    )
  }
  return (
    <div className="inline-flex h-8 items-center overflow-hidden rounded-lg border border-violet/50 bg-violet/10 text-xs" data-testid="worklog-active">
      <button type="button" onClick={openWorklog} title="Ver as jornadas" className="flex h-full cursor-pointer items-center gap-1.5 px-2.5 text-purple hover:bg-violet/15">
        <Clock size={13} className="animate-pulse" />
        <span className="font-medium">{w.active.key}</span>
        <span className="font-mono text-zinc-300">{fmtHM(Date.now() - w.active.start)}</span>
      </button>
      <button
        type="button"
        title="Pausar"
        onClick={() => window.api.worklogStop()}
        className="flex h-full cursor-pointer items-center border-l border-violet/40 px-2 text-zinc-300 hover:bg-violet/15"
      >
        <Pause size={12} />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------- na demanda: cronômetro + status do Jira

export function DemandWorkBar({ demandId, jiraKey, onResult }: { demandId: string; jiraKey: string; onResult: (r: OpResult) => void }) {
  const w = useWorklog()
  const mine = w.active?.demandId === demandId
  useTick(mine)
  const total = useMemo(() => w.sessions.filter((s) => s.demandId === demandId).reduce((t, s) => t + dur(s), 0), [w, demandId])
  const [jira, setJira] = useState<{ status?: string; transitions?: JiraTransition[]; error?: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const loadJira = async () => {
    setBusy(true)
    try {
      const r = await window.api.jiraTransitions(demandId)
      setJira(r.ok ? { status: r.status, transitions: r.transitions } : { error: r.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-card-2 px-3 py-2" data-testid="demand-workbar">
      {mine ? (
        <Button size="sm" variant="primary" onClick={() => window.api.worklogStop()}>
          <Pause size={12} /> Pausar · {fmtHM(Date.now() - w.active!.start)}
        </Button>
      ) : (
        <Button size="sm" onClick={() => window.api.worklogStart(demandId)} title="Conta o tempo nesta demanda (pausa sozinho no Ausente ou sem mexer no PC)">
          <Play size={12} /> Trabalhar nesta demanda
        </Button>
      )}
      <span className="text-[11px] text-zinc-500">
        Total: <b className="text-zinc-300">{fmtHM(total)}</b>
      </span>
      <button type="button" onClick={openWorklog} className="cursor-pointer text-[11px] text-purple underline decoration-dotted underline-offset-2">
        jornadas
      </button>

      <div className="ml-auto flex items-center gap-1.5">
        {!jira ? (
          <Button size="sm" variant="ghost" onClick={loadJira} disabled={busy} title={`Ver o status de ${jiraKey} no Jira e mudar daqui`}>
            {busy ? <Loader2 size={12} className="animate-spin" /> : <ArrowRightLeft size={12} />} Status no Jira
          </Button>
        ) : jira.error ? (
          <span className="text-[11px] text-amber-300" title={jira.error}>
            Jira: {jira.error.slice(0, 60)}
          </span>
        ) : (
          <>
            <span className="text-[11px] text-zinc-400">
              Jira: <b className="text-zinc-200">{jira.status}</b>
            </span>
            {!!jira.transitions?.length && (
              <select
                className="h-7 cursor-pointer rounded-lg border border-line bg-bg px-2 text-xs text-zinc-200"
                value=""
                disabled={busy}
                data-testid="jira-transition"
                onChange={async (e) => {
                  const t = jira.transitions!.find((x) => x.id === e.target.value)
                  if (!t || !confirm(`Mover ${jiraKey} para "${t.to}" no Jira?`)) return
                  setBusy(true)
                  try {
                    const r = await window.api.jiraTransition(demandId, t.id)
                    onResult(r)
                    if (r.ok) await loadJira()
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                <option value="">Mover para…</option>
                {jira.transitions.map((t) => (
                  <option key={t.id} value={t.id} className="bg-card">
                    {t.to}
                    {t.name !== t.to ? ` (${t.name})` : ''}
                  </option>
                ))}
              </select>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- janela das jornadas

export function WorklogModal({ onResult }: { onResult: (r: OpResult) => void }) {
  const [open, setOpen] = useState(false)
  const w = useWorklog()
  useTick(open && !!w.active)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    const h = () => setOpen(true)
    window.addEventListener('helice:open-worklog', h)
    return () => window.removeEventListener('helice:open-worklog', h)
  }, [])

  // Agrupa: dia → demanda → períodos (últimos 14 dias)
  const days = useMemo(() => {
    const cut = Date.now() - 14 * 86_400_000
    const m = new Map<string, Map<string, WorkSession[]>>()
    for (const s of w.sessions) {
      if (s.start < cut) continue
      const d = dayOf(s.start)
      if (!m.has(d)) m.set(d, new Map())
      const g = m.get(d)!
      g.set(s.demandId, [...(g.get(s.demandId) ?? []), s])
    }
    return [...m].sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [w])

  const weekStart = (() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.getTime() - ((d.getDay() + 6) % 7) * 86_400_000
  })()
  const weekTotal = w.sessions.reduce((t, s) => t + Math.max(0, (s.end ?? Date.now()) - Math.max(s.start, weekStart)), 0)

  const push = async (demandId: string, day: string) => {
    setBusy(`${demandId}:${day}`)
    try {
      onResult(await window.api.worklogPush(demandId, day))
    } finally {
      setBusy(null)
    }
  }

  const fmtDay = (d: string) => {
    const [y, mo, da] = d.split('-').map(Number)
    const dt = new Date(y, mo - 1, da)
    const today = dayOf(Date.now())
    const yest = dayOf(Date.now() - 86_400_000)
    return d === today ? 'Hoje' : d === yest ? 'Ontem' : dt.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: '2-digit' })
  }
  const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  return (
    <Modal open={open} onClose={() => setOpen(false)} width="max-w-3xl" title="Jornadas" icon={<Clock size={16} />}>
      <div className="space-y-3" data-testid="worklog-modal">
        <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
          <span>
            Semana: <b className="text-zinc-100">{fmtHM(weekTotal)}</b>
          </span>
          {w.active && (
            <span className="text-purple">
              Agora: {w.active.key} há {fmtHM(Date.now() - w.active.start)}
            </span>
          )}
          <span className="ml-auto text-[11px] text-zinc-500">
            Pausa sozinho no Ausente e depois de um tempo sem mexer no PC (Configurações → Geral).
          </span>
        </div>
        {!days.length && (
          <div className="rounded-lg border border-line bg-bg p-4 text-center text-xs text-zinc-500">
            Nenhuma jornada ainda. Abra uma demanda e clique em <b>Trabalhar nesta demanda</b>.
          </div>
        )}
        {days.map(([day, byDemand]) => {
          const dayTotal = [...byDemand.values()].flat().reduce((t, s) => t + dur(s), 0)
          return (
            <div key={day} className="rounded-xl border border-line">
              <div className="flex items-center justify-between border-b border-line px-3 py-2 text-xs">
                <b className="text-zinc-200">{fmtDay(day)}</b>
                <span className="font-mono text-zinc-400">{fmtHM(dayTotal)}</span>
              </div>
              <div className="divide-y divide-line">
                {[...byDemand].map(([demandId, list]) => {
                  const first = list[0]
                  const total = list.reduce((t, s) => t + dur(s), 0)
                  const pending = list.filter((s) => s.end !== null && !s.jiraLogged)
                  const logged = list.every((s) => s.jiraLogged)
                  return (
                    <div key={demandId} className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-zinc-100">{first.key}</span>
                        <span className="min-w-0 flex-1 truncate text-[11px] text-zinc-500">{first.title}</span>
                        <span className="font-mono text-xs text-zinc-300">{fmtHM(total)}</span>
                        {logged ? (
                          <span className="text-[11px] text-purple">lançado no Jira</span>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={!pending.length || !!busy}
                            title="Lança no card do Jira o tempo ainda não lançado deste dia"
                            onClick={() => push(demandId, day)}
                          >
                            {busy === `${demandId}:${day}` ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Lançar no Jira
                          </Button>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {list
                          .slice()
                          .sort((a, b) => a.start - b.start)
                          .map((s) => (
                            <span
                              key={s.id}
                              className={cn(
                                'group inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px]',
                                s.end === null ? 'border-violet/50 text-purple' : 'border-line text-zinc-500'
                              )}
                              title={s.note ? `Terminou: ${s.note}` : undefined}
                            >
                              {hhmm(s.start)}–{s.end ? hhmm(s.end) : 'agora'}
                              {s.end !== null && !s.jiraLogged && (
                                <button
                                  type="button"
                                  title="Apagar este período"
                                  onClick={() => confirm('Apagar este período?') && window.api.worklogDelete(s.id)}
                                  className="hidden cursor-pointer text-zinc-500 hover:text-red-300 group-hover:inline"
                                >
                                  <Trash2 size={10} />
                                </button>
                              )}
                            </span>
                          ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </Modal>
  )
}
