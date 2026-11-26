// Plano por fases: a demanda é dividida em fases com custo estimado (% da janela de 5h do Claude)
// e executada aos poucos pela fila, respeitando o limite. Modo automático (a próxima fase entra
// sozinha) ou manual (espera você liberar, pelo app ou pelo Telegram).
import { randomUUID } from 'crypto'
import type { Demand, DemandPlan, LimitWindow, OpResult, PlanPhase, PlanPhaseStatus, PlanSlot, QueueTask, TaskTier } from '../shared/types'
import { computeSchedule, fmtReset } from './limits'

const OPEN = '<<<FASES'
const CLOSE = 'FASES>>>'
const STATUSES: PlanPhaseStatus[] = ['pendente', 'agendada', 'aguardando', 'rodando', 'feita', 'falhou']

const clampPct = (v: unknown) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(1, Math.min(100, Math.round(n))) : 20
}

export function normPhase(r: Partial<PlanPhase>): PlanPhase {
  return {
    id: typeof r.id === 'string' && r.id ? r.id : randomUUID(),
    title: String(r.title ?? '').trim().slice(0, 140) || 'Fase',
    prompt: String(r.prompt ?? '').trim().slice(0, 8000),
    tier: r.tier === 'light' ? 'light' : 'heavy',
    estPct: clampPct(r.estPct),
    status: STATUSES.includes(r.status as PlanPhaseStatus) ? (r.status as PlanPhaseStatus) : 'pendente',
    scheduledAt: typeof r.scheduledAt === 'number' ? r.scheduledAt : undefined,
    queueTaskId: typeof r.queueTaskId === 'string' ? r.queueTaskId : undefined,
    summary: typeof r.summary === 'string' ? r.summary : undefined,
    error: typeof r.error === 'string' ? r.error : undefined
  }
}

export function normPlan(r: unknown): DemandPlan | null {
  if (!r || typeof r !== 'object') return null
  const p = r as Partial<DemandPlan>
  const phases = Array.isArray(p.phases) ? p.phases.filter((x) => x && typeof x === 'object').slice(0, 30).map(normPhase) : []
  if (!phases.length) return null
  return { phases, mode: p.mode === 'auto' ? 'auto' : 'manual', running: Boolean(p.running), createdAt: typeof p.createdAt === 'number' ? p.createdAt : Date.now() }
}

/** Pedido para a IA dividir a demanda em fases */
export function planPrompt(ctx: string, d: Pick<Demand, 'design'>): string {
  return `${ctx}

${d.design.trim() ? `## Desenho aprovado\n${d.design.trim()}\n\n` : ''}## Tarefa
Divida a implementação desta demanda em FASES pequenas e independentes o bastante para rodar uma de cada vez
(cada fase será executada pelo Claude Code numa sessão sem ninguém olhando, continuando a mesma conversa).
Para cada fase estime o custo em % da janela de uso de 5h do Claude (plano Pro/Max): uma fase pequena
(ajuste pontual, teste, revisão) custa 5–15%; uma média (um componente, um endpoint) 15–30%; uma grande 30–50%.
Nunca passe de 50% numa fase: divida.
Marque "tier": "light" nas fases simples (testes, ajustes de texto, revisão, documentação) e "heavy" nas que exigem raciocínio.
Não altere nenhum arquivo agora: só planeje.

Responda com um JSON (lista) entre as linhas ${OPEN} e ${CLOSE}, assim:
${OPEN}
[{"title": "Criar a migration e o model", "prompt": "o que fazer, com detalhes e critérios de pronto", "tier": "heavy", "estPct": 20}]
${CLOSE}`
}

/** Lê as fases que a IA devolveu (tolerante: pega a primeira lista JSON que achar) */
export function parsePlan(text: string): PlanPhase[] {
  const a = text.lastIndexOf(OPEN)
  let body = a >= 0 ? text.slice(a + OPEN.length) : text
  const b = body.indexOf(CLOSE)
  if (b >= 0) body = body.slice(0, b)
  const s = body.indexOf('[')
  const e = body.lastIndexOf(']')
  if (s < 0 || e <= s) return []
  try {
    const list = JSON.parse(body.slice(s, e + 1))
    if (!Array.isArray(list)) return []
    return list
      .filter((x) => x && typeof x === 'object' && (x.title || x.prompt))
      .slice(0, 30)
      .map((x) => normPhase({ title: x.title, prompt: x.prompt || x.title, tier: x.tier as TaskTier, estPct: x.estPct ?? x.est ?? x.pct, status: 'pendente' }))
  } catch {
    return []
  }
}

/** Texto que vai para o Claude em cada fase */
export function phaseMessage(plan: DemandPlan, ph: PlanPhase): string {
  const i = plan.phases.findIndex((x) => x.id === ph.id)
  const done = plan.phases.slice(0, i).filter((x) => x.status === 'feita').map((x) => `- ${x.title}`)
  return [
    `Fase ${i + 1} de ${plan.phases.length} do plano: ${ph.title}`,
    done.length ? `Já feitas:\n${done.join('\n')}` : '',
    ph.prompt,
    'Faça SÓ esta fase; as próximas virão depois. No fim, diga em poucas linhas o que ficou pronto e o que falta.'
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Resumo da agenda em texto: "Fase 1 agora · Fase 2 após o reset 16:40" */
export function scheduleText(plan: DemandPlan, slots: PlanSlot[], now = Date.now()): string[] {
  return slots.map((s) => {
    const ph = plan.phases.find((x) => x.id === s.id)!
    const n = plan.phases.indexOf(ph) + 1
    const when = s.at <= now + 60_000 ? 'agora' : `às ${fmtReset(s.at, now)}${s.window ? ' (depois do reset)' : ''}`
    return `${n}. ${ph.title} (~${ph.estPct}%) → ${when}`
  })
}

/** Executa os planos das demandas pela fila */
export class PlanRunner {
  constructor(
    private d: {
      get: (id: string) => Demand | undefined
      all: () => Demand[]
      /** Grava o plano e avisa a interface */
      setPlan: (id: string, plan: DemandPlan | null, note?: string) => void
      queue: {
        add: (t: { projectId: string; demandId: string; prompt: string; tier: TaskTier; notBefore?: number; planPhaseId: string }) => OpResult & { taskId?: string }
        cancel: (id: string) => void
      }
      /** Janela de 5h e teto da conta do projeto */
      limits: (projectId: string) => { fiveHour: LimitWindow | null; capPct: number }
      notify: (title: string, body: string, demandId: string) => void
      /** Modo manual: pergunta no Telegram se libera a próxima fase */
      askRelease: (d: Demand, ph: PlanPhase, text: string) => void
    }
  ) {}

  private slots(d: Demand, plan: DemandPlan, now = Date.now()): PlanSlot[] {
    const l = this.d.limits(d.projectId)
    return computeSchedule(plan.phases, l.fiveHour, l.capPct, now)
  }

  /** Agenda atual (para mostrar na demanda) */
  preview(id: string): PlanSlot[] {
    const d = this.d.get(id)
    return d?.plan ? this.slots(d, d.plan) : []
  }

  private clone(d: Demand): DemandPlan | null {
    return d.plan ? { ...d.plan, phases: d.plan.phases.map((p) => ({ ...p })) } : null
  }

  /** Você editou as fases (título, custo, peso, ordem) ou o modo */
  edit(id: string, plan: DemandPlan | null): OpResult {
    const d = this.d.get(id)
    if (!d) return { ok: false, message: 'Demanda não encontrada.' }
    if (!plan) {
      if (d.plan?.running) this.stopAll(d)
      this.d.setPlan(id, null, 'Plano por fases apagado')
      return { ok: true, message: 'Plano apagado.' }
    }
    const next = normPlan({ ...plan, running: d.plan?.running ?? false })
    if (!next) return { ok: false, message: 'O plano precisa de pelo menos uma fase.' }
    // Fases em andamento não mudam de estado pela interface
    for (const ph of next.phases) {
      const old = d.plan?.phases.find((x) => x.id === ph.id)
      if (old) Object.assign(ph, { status: old.status, queueTaskId: old.queueTaskId, summary: old.summary, error: old.error, scheduledAt: old.scheduledAt })
      else ph.status = 'pendente'
    }
    this.d.setPlan(id, next)
    return { ok: true, message: 'Plano salvo.' }
  }

  start(id: string): OpResult {
    const d = this.d.get(id)
    const plan = d && this.clone(d)
    if (!d || !plan) return { ok: false, message: 'Essa demanda não tem plano por fases.' }
    if (plan.running) return { ok: false, message: 'O plano já está em execução.' }
    if (!plan.phases.some((p) => p.status !== 'feita')) return { ok: false, message: 'Todas as fases já foram feitas.' }
    // Fases que falharam voltam a ser tentadas
    for (const p of plan.phases) if (p.status === 'falhou' || p.status === 'aguardando') p.status = 'pendente'
    plan.running = true
    return this.enqueueNext(d, plan, 'Plano por fases iniciado')
  }

  pause(id: string): OpResult {
    const d = this.d.get(id)
    if (!d?.plan?.running) return { ok: false, message: 'O plano não está rodando.' }
    this.stopAll(d)
    return { ok: true, message: 'Plano pausado. A fase que já estava rodando termina normalmente.' }
  }

  private stopAll(d: Demand): void {
    const plan = this.clone(d)!
    plan.running = false
    for (const p of plan.phases) {
      if (p.status === 'agendada' && p.queueTaskId) this.d.queue.cancel(p.queueTaskId)
      if (p.status === 'agendada' || p.status === 'aguardando') Object.assign(p, { status: 'pendente', queueTaskId: undefined, scheduledAt: undefined })
    }
    this.d.setPlan(d.id, plan, 'Plano por fases pausado')
  }

  /** Modo manual: você liberou a próxima fase */
  release(id: string): OpResult {
    const d = this.d.get(id)
    const plan = d && this.clone(d)
    if (!d || !plan) return { ok: false, message: 'Essa demanda não tem plano por fases.' }
    const wait = plan.phases.find((p) => p.status === 'aguardando')
    if (!wait) return { ok: false, message: 'Nenhuma fase esperando liberação.' }
    wait.status = 'pendente'
    plan.running = true
    return this.enqueueNext(d, plan, `Fase liberada: ${wait.title}`)
  }

  /** Planos com uma fase esperando você liberar */
  waiting(): Array<{ demand: Demand; phase: PlanPhase }> {
    const out: Array<{ demand: Demand; phase: PlanPhase }> = []
    for (const d of this.d.all()) {
      const ph = d.plan?.phases.find((p) => p.status === 'aguardando')
      if (ph) out.push({ demand: d, phase: ph })
    }
    return out
  }

  /** Põe a próxima fase pendente na fila, no horário que o limite permite */
  private enqueueNext(d: Demand, plan: DemandPlan, note?: string): OpResult {
    const now = Date.now()
    const next = plan.phases.find((p) => p.status === 'pendente')
    if (!next) {
      plan.running = false
      this.d.setPlan(d.id, plan, note ?? 'Plano por fases concluído')
      return { ok: true, message: 'Nenhuma fase pendente.' }
    }
    const slot = this.slots(d, plan, now).find((s) => s.id === next.id)
    const at = slot && slot.at > now + 60_000 ? slot.at : undefined
    const r = this.d.queue.add({ projectId: d.projectId, demandId: d.id, prompt: phaseMessage(plan, next), tier: next.tier, notBefore: at, planPhaseId: next.id })
    if (!r.ok || !r.taskId) {
      plan.running = false
      next.error = r.message
      this.d.setPlan(d.id, plan, `Plano parou: ${r.message}`)
      return r
    }
    Object.assign(next, { status: 'agendada', queueTaskId: r.taskId, scheduledAt: at ?? now, error: undefined })
    this.d.setPlan(d.id, plan, note)
    const when = at ? `começa às ${fmtReset(at, now)}, depois do reset do limite` : 'começa agora'
    return { ok: true, message: `Fase "${next.title}" na fila: ${when}.` }
  }

  /** A fila começou uma tarefa */
  taskStarted(t: QueueTask): void {
    const hit = this.find(t)
    if (!hit) return
    const plan = this.clone(hit.d)!
    const ph = plan.phases.find((p) => p.id === hit.ph.id)!
    ph.status = 'rodando'
    this.d.setPlan(hit.d.id, plan)
  }

  /** A fila terminou (ou cancelou) uma tarefa */
  taskDone(t: QueueTask): void {
    const hit = this.find(t)
    if (!hit) return
    const { d } = hit
    const plan = this.clone(d)!
    const ph = plan.phases.find((p) => p.id === hit.ph.id)!
    // Bateu no limite: a fila devolveu a tarefa e ela volta depois do reset
    if (t.status === 'pendente') {
      Object.assign(ph, { status: 'agendada', scheduledAt: t.notBefore })
      this.d.setPlan(d.id, plan, `Fase esperando o limite resetar (${fmtReset(t.notBefore ?? null)})`)
      return
    }
    const ok = t.status === 'feita' && (!t.check || t.check.ok)
    ph.summary = t.summary
    const n = plan.phases.indexOf(ph) + 1
    if (t.status === 'cancelada') {
      Object.assign(ph, { status: 'pendente', queueTaskId: undefined })
      plan.running = false
      this.d.setPlan(d.id, plan, `Fase ${n} cancelada: plano pausado`)
      return
    }
    if (!ok) {
      ph.status = t.status === 'feita' ? 'feita' : 'falhou'
      ph.error = t.status === 'feita' ? `Verificação falhou (${t.check?.command ?? ''})` : t.error
      plan.running = false
      this.d.setPlan(d.id, plan, `Fase ${n} com problema: plano pausado`)
      this.d.notify(`⚠️ ${d.key}: fase ${n} com problema`, `${ph.title}. O plano pausou; veja a demanda.`, d.id)
      return
    }
    ph.status = 'feita'
    const next = plan.phases.find((p) => p.status === 'pendente')
    if (!next || !plan.running) {
      plan.running = plan.running && !!next
      this.d.setPlan(d.id, plan, next ? `Fase ${n} feita` : 'Plano por fases concluído')
      if (!next) this.d.notify(`✅ ${d.key}: plano concluído`, `As ${plan.phases.length} fases terminaram.`, d.id)
      return
    }
    if (plan.mode === 'auto') {
      this.enqueueNext(d, plan, `Fase ${n} feita`)
      return
    }
    next.status = 'aguardando'
    this.d.setPlan(d.id, plan, `Fase ${n} feita; esperando você liberar a próxima`)
    const slot = this.slots(d, plan).find((s) => s.id === next.id)
    const when = !slot || slot.at <= Date.now() + 60_000 ? 'pode começar agora' : `o limite deixa às ${fmtReset(slot.at)}`
    const text = `Fase ${n} feita: ${ph.title}.\nPróxima: ${next.title} (~${next.estPct}% da janela; ${when}).`
    this.d.notify(`⏸ ${d.key}: liberar a próxima fase?`, text, d.id)
    this.d.askRelease(d, next, text)
  }

  private find(t: QueueTask): { d: Demand; ph: PlanPhase } | null {
    if (!t.planPhaseId || !t.demandId) return null
    const d = this.d.get(t.demandId)
    const ph = d?.plan?.phases.find((p) => p.id === t.planPhaseId)
    return d && ph ? { d, ph } : null
  }
}
