import { randomUUID } from 'crypto'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { OpResult, QueueState, QueueTask, RunEvent, ShotSet } from '../shared/types'
import { shotSummary } from './shots'
import { costs } from './costs'
import type { DemandManager } from './demands'
import { commitAll, ensureWorktree, git, gitCheckout, gitInfo, queueBranch } from './git'
import type { RunManager } from './runner'
import { store } from './store'

/** Vai junto de toda tarefa: ninguém está olhando */
/** Na cópia separada o app guarda o trabalho num commit local ao fim da tarefa */
export const QUEUE_COPY_NOTE =
  '\n\n(Você está numa cópia separada do projeto, só da fila. Não faça commit nem push: o app guarda o que você mudar.)'

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
  /** runId → saída do comando de verificação */
  private out = new Map<string, string[]>()

  constructor(
    base: string,
    private d: {
      runs: RunManager
      demands: DemandManager
      onChange: (q: QueueState) => void
      /** Fila esvaziou com você Ausente: manda o resumo (Telegram) */
      onDrained: (done: QueueTask[]) => void
      log: (text: string, kind?: 'info' | 'error' | 'success') => void
      /** Front/back: prints e checagem da API antes/depois (só na pasta do projeto, não na cópia) */
      shots?: (t: QueueTask, label: 'antes' | 'depois') => Promise<ShotSet[] | null>
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
    let cwd = p.path
    if (t.demandId && cfg.queue.useWorktree) {
      // Cópia separada (git worktree): o Claude trabalha sem tocar na sua pasta
      const dm = this.d.demands.get(t.demandId)
      if (!dm) return this.fail(t, 'A demanda não existe mais.')
      if (!(await gitInfo(p))) return this.fail(t, `${p.name} não é um repositório git.`)
      cwd = this.d.demands.queueCopyDir(dm)
      const w = await ensureWorktree(p, dm.key, cwd)
      if (!w.ok) return this.fail(t, w.message)
      const r = this.d.demands.implement(dm.id, t.prompt + QUEUE_COPY_NOTE + QUEUE_SUFFIX, false, 'fila', { cwd, queueCopy: true })
      if (!r.ok || !r.runId) return this.fail(t, r.message)
      runId = r.runId
    } else if (t.demandId) {
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
      await this.d.shots?.(t, 'antes').catch(() => null)
      const r = this.d.demands.implement(dm.id, t.prompt + QUEUE_SUFFIX, false, 'fila')
      if (!r.ok || !r.runId) return this.fail(t, r.message)
      runId = r.runId
    } else {
      await this.d.shots?.(t, 'antes').catch(() => null)
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
    t.phase = 'trabalhando'
    t.cwd = cwd
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
      if (t.phase === 'verificando') {
        const o = this.out.get(e.runId) ?? []
        for (const l of e.lines) if (l.kind !== 'info') o.push(l.text)
        if (o.length > 300) o.splice(0, o.length - 300)
        this.out.set(e.runId, o)
        return
      }
      const buf = this.text.get(e.runId)
      if (buf) for (const l of e.lines) if (l.kind === 'claude') buf.push(l.text)
      return
    }
    if (e.type === 'usage') {
      if (e.costUsd !== null) t.costUsd = (t.costUsd ?? 0) + e.costUsd
      return
    }
    if (e.type !== 'exit') return
    if (t.phase === 'verificando') return void this.finishCheck(t, e)
    t.summary = tail(this.text.get(e.runId) ?? []) || undefined
    this.text.delete(e.runId)
    if (!e.killed && e.code === 0) {
      void this.afterWork(t)
      return
    }
    t.endedAt = Date.now()
    t.status = e.killed ? 'cancelada' : 'falhou'
    if (t.status === 'falhou') t.error = `O Claude saiu com código ${e.code ?? '?'}.`
    this.finish(t)
  }

  /** Claude terminou bem: guarda o trabalho (cópia da fila) e roda a verificação do projeto */
  private async afterWork(t: QueueTask): Promise<void> {
    const dm = t.demandId ? this.d.demands.get(t.demandId) : undefined
    const copy = !!dm && !!t.cwd && t.cwd === this.d.demands.queueCopyDir(dm)
    if (copy) t.committed = await commitAll(t.cwd!, `${dm!.key} (fila): ${t.prompt.replace(/\s+/g, ' ').slice(0, 60)}`)
    const p = store.get().projects.find((x) => x.id === t.projectId)
    const cmd = p?.checkCommand?.trim()
    if (cmd) {
      t.phase = 'verificando'
      const runId = this.d.runs.start({
        kind: 'terminal',
        tab: t.demandId ? `demand:${t.demandId}` : 'fila',
        title: `Verificação · ${dm?.key ?? p!.name}`,
        content: cmd,
        cwd: t.cwd ?? p!.path,
        projectId: t.projectId,
        origin: 'fila'
      })
      t.runId = runId
      this.text.set(runId, [])
      t.check = { command: cmd, ok: false, output: '' }
      this.persist()
      return
    }
    if (!copy) await this.afterShots(t)
    t.status = 'feita'
    t.endedAt = Date.now()
    if (copy) t.summary = (t.summary ? t.summary + '\n\n' : '') + (t.committed ? `(guardado num commit em ${queueBranch(dm!.key)})` : '(nada mudou nos arquivos)')
    this.finish(t)
  }

  /** Prints/checagem da API depois da tarefa (quando roda na pasta do projeto) */
  private async afterShots(t: QueueTask): Promise<void> {
    const sets = await this.d.shots?.(t, 'depois').catch(() => null)
    if (!sets?.length) return
    t.shots = sets.map(shotSummary)
    t.shotSetIds = sets.map((s) => s.id)
    t.shotsFailed = sets.some((s) => s.error || s.items.some((i) => !i.ok))
  }

  private async finishCheck(t: QueueTask, e: Extract<RunEvent, { type: 'exit' }>): Promise<void> {
    const out = tail(this.out.get(e.runId) ?? [], 1200)
    this.out.delete(e.runId)
    t.check = { command: t.check?.command ?? '', ok: !e.killed && e.code === 0, output: out }
    const dmx = t.demandId ? this.d.demands.get(t.demandId) : undefined
    if (!e.killed && !(dmx && t.cwd === this.d.demands.queueCopyDir(dmx))) await this.afterShots(t)
    t.status = e.killed ? 'cancelada' : 'feita'
    t.endedAt = Date.now()
    const dm = t.demandId ? this.d.demands.get(t.demandId) : undefined
    if (t.committed && dm) t.summary = (t.summary ? t.summary + '\n\n' : '') + `(guardado num commit em ${queueBranch(dm.key)})`
    this.finish(t)
  }

  private finish(t: QueueTask): void {
    t.phase = undefined
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
  const ok = done.filter((t) => t.status === 'feita' && (!t.check || t.check.ok) && !t.shotsFailed).length
  const bad = done.length - ok
  const cost = done.reduce((s, t) => s + (t.costUsd ?? 0), 0)
  const head = `${ok} feita(s)${bad ? `, ${bad} com problema` : ''}${cost ? ` · US$ ${cost.toFixed(2)}` : ''}`
  const lines = done.map((t) => {
    const icon = t.status !== 'feita' ? '❌' : (t.check && !t.check.ok) || t.shotsFailed ? '⚠️' : '✅'
    const what = t.prompt.replace(/\s+/g, ' ').slice(0, 90)
    const note = t.status === 'feita' ? (t.summary ?? '').replace(/\s+/g, ' ').slice(-220) : (t.error ?? '')
    const check = t.check ? `\n   ${t.check.ok ? '✔ verificação ok' : '✖ verificação falhou'} (${t.check.command})` : ''
    const shots = t.shots?.length ? '\n   ' + t.shots.join('\n   ') : ''
    return `${icon} ${names(t)}: ${what}${note ? `\n   ↳ ${note}` : ''}${check}${shots}`
  })
  return `${head}\n\n${lines.join('\n')}`
}
