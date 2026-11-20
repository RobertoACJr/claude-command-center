import { createConnection } from 'net'
import type { AppConfig, OpResult, Project, ProjectRunState, RunEvent } from '../shared/types'
import type { RunManager } from './runner'

const POLL_MS = 4000

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

  async start(id: string): Promise<OpResult> {
    const p = this.projects.get(id)
    if (!p) return { ok: false, message: 'Projeto não encontrado.' }
    if (!p.runCommand) return { ok: false, message: 'Defina "Como executar" no cadastro do projeto.' }
    const s = this.get(id)
    if (this.runs.isRunning(s.runId)) return { ok: true, message: 'Já está rodando.' }

    if (p.port && (await isPortOpen(p.port))) {
      s.state = 'external'
      s.portOpen = true
      this.changed()
      return {
        ok: false,
        message: `A porta ${p.port} já está em uso: o projeto parece estar rodando fora do app. Feche o outro processo e tente de novo.`
      }
    }

    // Texto literal: o comando de execução não usa {{variaveis}}
    const runId = this.runs.start({
      kind: 'terminal',
      tab: `project:${id}`,
      title: p.name,
      content: p.runCommand,
      cwd: p.path,
      interactive: true
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
    return { ok: true, message: 'Iniciado.' }
  }

  async stop(id: string): Promise<void> {
    const s = this.states.get(id)
    if (s?.runId && this.runs.isRunning(s.runId)) await this.runs.stop(s.runId)
  }

  async restart(id: string): Promise<OpResult> {
    await this.stop(id)
    // Dá um respiro para a porta ser liberada
    await new Promise((r) => setTimeout(r, 600))
    return this.start(id)
  }

  /** Recebe todos os eventos de execução; só interessa a saída dos projetos */
  handleRunEvent(e: RunEvent): void {
    if (e.type !== 'exit' || !e.tab.startsWith('project:')) return
    const s = this.states.get(e.tab.slice('project:'.length))
    if (!s || s.runId !== e.runId) return
    s.state = e.killed || e.code === 0 ? 'stopped' : 'crashed'
    s.exitCode = e.code
    s.runId = undefined
    this.changed()
  }

  private async pollPorts(): Promise<void> {
    let dirty = false
    await Promise.all(
      [...this.projects.values()].map(async (p) => {
        if (!p.port) return
        const s = this.get(p.id)
        const open = await isPortOpen(p.port)
        const ours = this.runs.isRunning(s.runId)
        let next = s.state
        if (ours && open && s.state === 'starting') next = 'running'
        if (!ours && open && (s.state === 'stopped' || s.state === 'crashed')) next = 'external'
        if (!ours && !open && s.state === 'external') next = 'stopped'
        if (open !== s.portOpen || next !== s.state) {
          s.portOpen = open
          s.state = next
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
