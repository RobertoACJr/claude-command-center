import { createConnection } from 'net'
import type { AppConfig, OpResult, Project, ProjectRunState, RunEvent } from '../shared/types'
import type { RunManager } from './runner'
import { shellCapture } from './proc'

const POLL_MS = 4000

/** O endereço de saúde respondeu (qualquer status abaixo de 500)? */
export async function checkHealth(url: string, timeoutMs = 2500): Promise<boolean> {
  if (!/^https?:\/\//i.test(url)) return false
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: 'manual' })
    return r.status < 500
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}

/** Testa se há algo escutando na porta (IPv4 e IPv6: o Vite costuma ouvir só em ::1) */
export function isPortOpen(port: number, timeoutMs = 500): Promise<boolean> {
  const tryHost = (host: string) =>
    new Promise<boolean>((resolve) => {
      const sock = createConnection({ host, port })
      const done = (ok: boolean) => {
        sock.destroy()
        resolve(ok)
      }
      sock.setTimeout(timeoutMs, () => done(false))
      sock.once('connect', () => done(true))
      sock.once('error', () => done(false))
    })
  return tryHost('127.0.0.1').then((ok) => ok || tryHost('::1'))
}

/**
 * Execução de cada projeto (o "Como executar" do cadastro), com estado para o botão ▶/■ do card.
 * A saída vai para a aba `project:<id>` do painel de Terminais.
 */
export class ProjectProcesses {
  private states = new Map<string, ProjectRunState>()
  private projects = new Map<string, Project>()
  private poller: NodeJS.Timeout | null = null

  constructor(
    private runs: RunManager,
    private notify: (s: ProjectRunState[]) => void
  ) {}

  list(): ProjectRunState[] {
    return [...this.states.values()]
  }

  private changed() {
    this.notify(this.list())
  }

  private get(id: string): ProjectRunState {
    let s = this.states.get(id)
    if (!s) {
      s = { projectId: id, state: 'stopped', portOpen: null }
      this.states.set(id, s)
    }
    return s
  }

  /** Acompanha a lista de projetos: some com os excluídos (parando o processo deles) */
  sync(cfg: AppConfig): void {
    const ids = new Set(cfg.projects.map((p) => p.id))
    for (const p of cfg.projects) {
      this.projects.set(p.id, p)
      const s = this.get(p.id)
      if (!p.port) s.portOpen = null
    }
    for (const [id, s] of this.states) {
      if (!ids.has(id)) {
        if (this.runs.isRunning(s.runId)) void this.runs.stop(s.runId!)
        this.states.delete(id)
        this.projects.delete(id)
      }
    }
    this.changed()
    if (!this.poller) {
      this.poller = setInterval(() => void this.pollPorts(), POLL_MS)
      void this.pollPorts()
    }
  }

  /** Projeto ligado -> projeto que o ligou junto */
  private startedWith = new Map<string, string>()
  /** Projetos parados por causa do modo Ausente (para religar na volta) */
  private awayStopped = new Set<string>()
  /**
   * Executa o projeto. Com `group`, executa também os projetos ligados (ex.: o back), todos ao mesmo tempo.
   */
  async start(id: string, group = false, seen = new Set<string>()): Promise<OpResult> {
    const p = this.projects.get(id)
    if (!p) return { ok: false, message: 'Projeto não encontrado.' }
    if (!p.runCommand) return { ok: false, message: 'Defina "Como executar" no cadastro do projeto.' }
    seen.add(id)
    const s = this.get(id)
    if (this.runs.isRunning(s.runId)) return { ok: true, message: 'Já está rodando.' }

    if (p.port && (await isPortOpen(p.port))) {
      s.state = 'external'
      s.portOpen = true
      this.changed()
      return {
        ok: false,
        message: `A porta ${p.port} já está em uso: o projeto parece estar rodando fora do app. Veja quem está usando a porta no card ou feche o outro processo.`
      }
    }

    const alsoStarted: string[] = []
    const problems: string[] = []
    if (group) {
      for (const lid of p.linkedProjectIds ?? []) {
        if (seen.has(lid)) continue
        const lp = this.projects.get(lid)
        if (!lp?.runCommand) continue
        const ls = this.get(lid)
        if (this.runs.isRunning(ls.runId) || ls.state === 'external') continue
        // Sobem todos ao mesmo tempo (sem esperar um responder para subir o outro)
        const r = await this.start(lid, true, seen)
        if (!r.ok) {
          problems.push(`${lp.name}: ${r.message}`)
          continue
        }
        this.startedWith.set(lid, id)
        alsoStarted.push(lp.name)
      }
    }

    // Texto literal: o comando de execução não usa {{variaveis}}
    const runId = this.runs.start({
      kind: 'terminal',
      tab: `project:${id}`,
      title: p.name,
      content: p.runCommand,
      cwd: p.path,
      interactive: true,
      projectId: p.id,
      origin: 'projeto'
    })
    Object.assign(s, { state: 'starting', runId, startedAt: Date.now(), exitCode: undefined })
    this.changed()
    // Sem porta configurada: se continuar vivo após 2s, consideramos "rodando"
    setTimeout(() => {
      if (s.runId === runId && s.state === 'starting' && this.runs.isRunning(runId)) {
        s.state = 'running'
        this.changed()
      }
    }, p.port ? 60_000 : 2000)
    let message = 'Iniciado.'
    if (alsoStarted.length) message = `Iniciado junto com ${alsoStarted.join(', ')}.`
    if (problems.length) message += ` Atenção: ${problems.join('; ')}`
    return { ok: true, message }
  }

  /**
   * Para o projeto: interrompe o processo (esperando o tempo do cadastro antes de forçar) e roda o
   * comando de parar, se houver (ex.: docker compose stop), mesmo quando ele roda fora do app.
   * Com `group`, para também os projetos ligados.
   */
  async stop(id: string, group = false, seen = new Set<string>()): Promise<OpResult> {
    seen.add(id)
    const p = this.projects.get(id)
    const s = this.states.get(id)
    const notes: string[] = []
    if (s?.runId && this.runs.isRunning(s.runId)) await this.runs.stop(s.runId, (p?.stopTimeoutSec ?? 10) * 1000)
    if (p?.stopCommand && p.path) {
      const r = await shellCapture(p.stopCommand, p.path, 120_000)
      if (r.code !== 0) notes.push(`o comando de parar falhou: ${(r.err || r.out).trim().split('\n').slice(-1)[0] ?? ''}`)
      if (s && s.state === 'external') {
        s.state = 'stopped'
        this.changed()
      }
    }
    this.startedWith.delete(id)
    if (group && p) {
      const others = new Set([
        ...(p.linkedProjectIds ?? []),
        ...[...this.startedWith].filter(([, by]) => by === id).map(([lid]) => lid)
      ])
      for (const lid of others) {
        if (seen.has(lid)) continue
        const r = await this.stop(lid, true, seen)
        if (!r.ok) notes.push(r.message)
      }
    }
    return notes.length ? { ok: false, message: `Parado, mas ${notes.join('; ')}` } : { ok: true, message: 'Parado.' }
  }

  /** Reinicia só este projeto (os ligados continuam rodando) */
  async restart(id: string): Promise<OpResult> {
    await this.stop(id, false)
    // Dá um respiro para a porta ser liberada
    await new Promise((r) => setTimeout(r, 600))
    return this.start(id, false)
  }

  /**
   * Modo Ausente: para os projetos marcados "parar no Ausente" que estão no ar,
   * menos os que a fila está usando (`busy`). Guarda quais foram para religar na volta.
   */
  async stopForAway(busy: Set<string>): Promise<string[]> {
    const done: string[] = []
    for (const p of this.projects.values()) {
      if (!p.awayStop || busy.has(p.id)) continue
      const s = this.get(p.id)
      const up = this.runs.isRunning(s.runId) || (s.state === 'external' && !!p.stopCommand)
      if (!up) continue
      await this.stop(p.id, false)
      this.awayStopped.add(p.id)
      done.push(p.name)
    }
    return done
  }

  /** Volta do Ausente: religa o que foi parado por causa dele */
  async restoreAfterAway(): Promise<string[]> {
    const done: string[] = []
    for (const id of [...this.awayStopped]) {
      this.awayStopped.delete(id)
      const p = this.projects.get(id)
      if (!p?.runCommand) continue
      const r = await this.start(id, false)
      if (r.ok) done.push(p.name)
    }
    return done
  }

  /** Recebe todos os eventos de execução; só interessa a saída dos projetos */
  handleRunEvent(e: RunEvent): void {
    if (e.type !== 'exit' || !e.tab.startsWith('project:')) return
    const s = this.states.get(e.tab.slice('project:'.length))
    if (!s || s.runId !== e.runId) return
    s.state = e.killed || e.code === 0 ? 'stopped' : 'crashed'
    s.exitCode = e.code
    s.runId = undefined
    this.startedWith.delete(s.projectId)
    this.changed()
  }

  private async pollPorts(): Promise<void> {
    let dirty = false
    await Promise.all(
      [...this.projects.values()].map(async (p) => {
        const s = this.get(p.id)
        if (!p.port) {
          // Sem porta: só a saúde, enquanto o processo é nosso
          const h = p.healthUrl && this.runs.isRunning(s.runId) ? await checkHealth(p.healthUrl) : undefined
          if (h !== s.healthy) {
            s.healthy = h
            dirty = true
          }
          return
        }
        const open = await isPortOpen(p.port)
        const ours = this.runs.isRunning(s.runId)
        let next = s.state
        if (ours && open && s.state === 'starting') next = 'running'
        if (!ours && open && (s.state === 'stopped' || s.state === 'crashed')) next = 'external'
        if (!ours && !open && s.state === 'external') next = 'stopped'
        const healthy = p.healthUrl && (open || ours) ? await checkHealth(p.healthUrl) : undefined
        if (open !== s.portOpen || next !== s.state || healthy !== s.healthy) {
          s.portOpen = open
          s.state = next
          s.healthy = healthy
          dirty = true
        }
      })
    )
    if (dirty) this.changed()
  }

  stopPolling(): void {
    if (this.poller) clearInterval(this.poller)
    this.poller = null
  }
}
