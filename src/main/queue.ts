import { randomUUID } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { OpResult, QueueState, QueueTask, RunEvent } from '../shared/types'
import { costs } from './costs'
import type { DemandManager } from './demands'
import { git, gitCheckout, gitInfo } from './git'
import type { RunManager } from './runner'
import { store } from './store'

/** Vai junto de toda tarefa: ninguém está olhando */
export const QUEUE_SUFFIX =
  '\n\n(Tarefa da fila, sem ninguém acompanhando: não faça commit nem push. Se algo exigir uma decisão minha, pare e ' +
  'explique o que falta. No fim, resuma em poucas linhas o que fez, como testar e o que ficou pendente.)'

const MAX_KEEP = 200

const tail = (lines: string[], max = 1500) => {
  const t = lines.join('\n').trim()
  return t.length > max ? '…' + t.slice(t.length - max) : t
}

/**
 * Fila de tarefas para o Claude: uma por vez, de preferência quando você está Ausente.
 * Tarefa de demanda roda na conversa e na branch da demanda; tarefa de projeto roda numa conversa nova.
 */
export class QueueManager {
  private tasks: QueueTask[] = []
  private file: string
  private waiting: string | null = null
  /** "Rodar agora": ignora o "só quando Ausente" até a fila esvaziar */
  private force = false
  private ticking = false
  /** runId → linhas de texto do Claude */
  private text = new Map<string, string[]>()

  constructor(
    base: string,
    private d: {
      runs: RunManager
      demands: DemandManager
      onChange: (q: QueueState) => void
      /** Fila esvaziou com você Ausente: manda o resumo (Telegram) */
      onDrained: (done: QueueTask[]) => void
      log: (text: string, kind?: 'info' | 'error' | 'success') => void
    }
  ) {
    this.file = join(base, 'queue.json')
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8'))
        if (Array.isArray(raw)) this.tasks = raw.filter((t) => t && t.id && t.prompt)
      }
    } catch {
      this.tasks = []
    }
    // App fechou no meio: a tarefa volta para a fila
    for (const t of this.tasks) if (t.status === 'rodando') Object.assign(t, { status: 'pendente', runId: undefined, startedAt: undefined })
  }

  state(): QueueState {
    return { tasks: this.tasks, waiting: this.waiting }
  }

  private persist(): void {
    try {
      writeFileSync(this.file, JSON.stringify(this.tasks.slice(-MAX_KEEP), null, 1))
    } catch {
      /* ignora */
    }
    this.d.onChange(this.state())
  }

  add(input: { projectId: string; demandId?: string; prompt: string; origin?: 'app' | 'telegram' }): OpResult {
    const cfg = store.get()
    if (!cfg.projects.some((p) => p.id === input.projectId)) return { ok: false, message: 'Projeto não encontrado.' }
    if (input.demandId && !this.d.demands.get(input.demandId)) return { ok: false, message: 'Demanda não encontrada.' }
    const prompt = input.prompt.trim()
    if (!prompt) return { ok: false, message: 'Escreva o que o Claude deve fazer.' }
    this.tasks.push({
      id: randomUUID(),
      projectId: input.projectId,
      demandId: input.demandId,
      prompt,
      status: 'pendente',
      createdAt: Date.now(),
      origin: input.origin ?? 'app'
    })
    this.persist()
    void this.tick()
    const pos = this.tasks.filter((t) => t.status === 'pendente').length
    return { ok: true, message: `Na fila (posição ${pos}).${this.waiting ? ' ' + this.waiting : ''}` }
  }

  cancel(id: string): void {
    const t = this.tasks.find((x) => x.id === id)
    if (!t) return
    if (t.status === 'pendente') {
      t.status = 'cancelada'
      t.endedAt = Date.now()
      this.persist()
    } else if (t.status === 'rodando' && t.runId) void this.d.runs.stop(t.runId)
  }

  remove(id: string): void {
    const t = this.tasks.find((x) => x.id === id)
    if (!t || t.status === 'rodando') return
    this.tasks = this.tasks.filter((x) => x.id !== id)
    this.persist()
  }

  retry(id: string): void {
    const t = this.tasks.find((x) => x.id === id)
    if (!t || t.status === 'rodando' || t.status === 'pendente') return
    this.tasks = this.tasks.filter((x) => x.id !== id)
    this.tasks.push({ ...t, status: 'pendente', error: undefined, summary: undefined, runId: undefined, startedAt: undefined, endedAt: undefined, reported: false, costUsd: undefined })
    this.persist()
    void this.tick()
  }

  /** Sobe/desce entre as pendentes */
  move(id: string, dir: -1 | 1): void {
    const pend = this.tasks.filter((t) => t.status === 'pendente')
    const i = pend.findIndex((t) => t.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= pend.length) return
    const a = this.tasks.indexOf(pend[i])
    const b = this.tasks.indexOf(pend[j])
    ;[this.tasks[a], this.tasks[b]] = [this.tasks[b], this.tasks[a]]
    this.persist()
  }

  clearDone(): void {
    this.tasks = this.tasks.filter((t) => t.status === 'pendente' || t.status === 'rodando')
    this.persist()
  }

  runNow(): OpResult {
    if (!this.tasks.some((t) => t.status === 'pendente')) return { ok: false, message: 'Nada pendente na fila.' }
    if (store.get().queue.paused) return { ok: false, message: 'A fila está pausada.' }
    this.force = true
    void this.tick()
    return { ok: true, message: 'Começando a fila agora.' }
  }

  /** Tarefas que terminaram e ainda não entraram em nenhum resumo */
  takeUnreported(): QueueTask[] {
    const list = this.tasks.filter((t) => !t.reported && (t.status === 'feita' || t.status === 'falhou'))
    for (const t of list) t.reported = true
    if (list.length) this.persist()
    return list
  }

  private setWaiting(w: string | null): void {
    if (w === this.waiting) return
    this.waiting = w
    this.d.onChange(this.state())
  }

  /** Começa a próxima tarefa, se der */
  async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      if (this.tasks.some((t) => t.status === 'rodando')) return this.setWaiting(null)
      const next = this.tasks.find((t) => t.status === 'pendente')
      if (!next) {
        this.force = false
        return this.setWaiting(null)
      }
      const cfg = store.get()
      if (cfg.queue.paused) return this.setWaiting('Fila pausada.')
      if (cfg.queue.onlyAway && cfg.status !== 'off' && !this.force) return this.setWaiting('Esperando você ir para Ausente (ou clique em "Rodar agora").')
      if (!costs.allowsAutomation()) return this.setWaiting('Pausada: limite diário de gastos atingido.')
      this.setWaiting(null)
      await this.start(next)
    } finally {
      this.ticking = false
    }
  }

  private fail(t: QueueTask, error: string): void {
    t.status = 'falhou'
    t.error = error
    t.endedAt = Date.now()
    this.d.log(`[Fila] não começou: ${error}`, 'error')
    this.persist()
    setTimeout(() => void this.tick(), 50)
  }

  private async start(t: QueueTask): Promise<void> {
    const cfg = store.get()
    const p = cfg.projects.find((x) => x.id === t.projectId)
    if (!p) return this.fail(t, 'O projeto não existe mais.')
    let runId: string | undefined
    if (t.demandId) {
      const dm = this.d.demands.get(t.demandId)
      if (!dm) return this.fail(t, 'A demanda não existe mais.')
      // Garante a branch da demanda (sem perder nada: só troca com a árvore limpa)
      const info = await gitInfo(p)
      if (info && info.branch !== dm.key) {
        if (info.changed > 0) return this.fail(t, `${p.name} está em ${info.branch} com ${info.changed} alteração(ões) sem commit; não troquei para ${dm.key}.`)
        const has = (await git(p.path, ['rev-parse', '--verify', '--quiet', `refs/heads/${dm.key}`])).ok
        const r = has ? await gitCheckout(p, dm.key) : await this.d.demands.branch(dm.id, '')
        if (!r.ok) return this.fail(t, r.message)
      }
      const r = this.d.demands.implement(dm.id, t.prompt + QUEUE_SUFFIX, false, 'fila')
      if (!r.ok || !r.runId) return this.fail(t, r.message)
      runId = r.runId
    } else {
      runId = this.d.runs.start({
        kind: 'claude',
        tab: 'fila',
        title: `Fila · ${p.name}`,
        content: t.prompt + QUEUE_SUFFIX,
        cwd: p.path,
        projectId: p.id,
        origin: 'fila'
      })
    }
    t.status = 'rodando'
    t.runId = runId
    t.startedAt = Date.now()
    this.text.set(runId, [])
    this.d.log(`[Fila] começou: ${t.prompt.slice(0, 80)}`, 'info')
    this.persist()
  }

  handleRunEvent(e: RunEvent): void {
    const t = this.tasks.find((x) => x.runId === e.runId && x.status === 'rodando')
    if (!t) return
    if (e.type === 'lines') {
      const buf = this.text.get(e.runId)
      if (buf) for (const l of e.lines) if (l.kind === 'claude') buf.push(l.text)
      return
    }
    if (e.type === 'usage') {
      if (e.costUsd !== null) t.costUsd = (t.costUsd ?? 0) + e.costUsd
      return
    }
    if (e.type !== 'exit') return
    t.endedAt = Date.now()
    t.status = e.killed ? 'cancelada' : e.code === 0 ? 'feita' : 'falhou'
    t.summary = tail(this.text.get(e.runId) ?? []) || undefined
    if (t.status === 'falhou') t.error = `O Claude saiu com código ${e.code ?? '?'}.`
    this.text.delete(e.runId)
    this.d.log(`[Fila] ${t.status}: ${t.prompt.slice(0, 80)}`, t.status === 'feita' ? 'success' : 'error')
    this.persist()
    const more = this.tasks.some((x) => x.status === 'pendente')
    if (!more && store.get().status === 'off') {
      const done = this.takeUnreported()
      if (done.length) this.d.onDrained(done)
    }
    setTimeout(() => void this.tick(), 300)
  }
}

/** Texto do resumo (Telegram e sino) */
export function queueSummary(done: QueueTask[], names: (t: QueueTask) => string): string {
  const ok = done.filter((t) => t.status === 'feita').length
  const bad = done.length - ok
  const cost = done.reduce((s, t) => s + (t.costUsd ?? 0), 0)
  const head = `${ok} feita(s)${bad ? `, ${bad} com problema` : ''}${cost ? ` · US$ ${cost.toFixed(2)}` : ''}`
  const lines = done.map((t) => {
    const icon = t.status === 'feita' ? '✅' : '❌'
    const what = t.prompt.replace(/\s+/g, ' ').slice(0, 90)
    const note = t.status === 'feita' ? (t.summary ?? '').replace(/\s+/g, ' ').slice(-220) : (t.error ?? '')
    return `${icon} ${names(t)}: ${what}${note ? `\n   ↳ ${note}` : ''}`
  })
  return `${head}\n\n${lines.join('\n')}`
}
