import { existsSync, openSync, readSync, closeSync, statSync } from 'fs'
import type { LogSource, OpResult, Project, RunEvent } from '../shared/types'
import { LOG_ERROR_RE, composeCmd, logCommand, logFilePath, SAFE_SERVICE } from './docker'
import { shellCapture } from './proc'
import type { RunManager } from './runner'

/**
 * Log da aplicação de cada projeto (Laravel, Node, o que for): fica correndo na aba `applog:<id>`
 * a partir da fonte do cadastro (serviço do compose, arquivo ou comando). Também procura erros
 * nessa saída e na do próprio projeto (ex.: docker compose up) para avisar.
 */
export class AppLogs {
  private open = new Map<string, string>()
  private lastAlert = new Map<string, number>()
  /** Intervalo mínimo entre dois avisos de erro do mesmo projeto */
  alertEveryMs = 60_000

  constructor(
    private runs: RunManager,
    private project: (id: string) => Project | undefined,
    private onError: (p: Project, line: string, tab: string) => void
  ) {}

  static tab(projectId: string): string {
    return `applog:${projectId}`
  }

  isOpen(projectId: string): boolean {
    const r = this.open.get(projectId)
    return !!r && this.runs.isRunning(r)
  }

  start(projectId: string, override?: Partial<LogSource>): OpResult & { tab?: string } {
    const p = this.project(projectId)
    if (!p) return { ok: false, message: 'Projeto não encontrado.' }
    const tab = AppLogs.tab(projectId)
    if (this.isOpen(projectId) && !override) return { ok: true, message: 'O log já está aberto.', tab }
    const src = { ...p.logSource, ...(override ?? {}) }
    const c = logCommand(p, src)
    if (!c.ok) return { ok: false, message: c.message }
    const old = this.open.get(projectId)
    if (old) void this.runs.stop(old, 500)
    const runId = this.runs.start({
      kind: 'terminal',
      tab,
      title: `Log · ${p.name}`,
      content: c.command,
      cwd: p.path,
      projectId: p.id,
      origin: 'projeto'
    })
    this.open.set(projectId, runId)
    return { ok: true, message: 'Mostrando o log.', tab }
  }

  async stop(projectId: string): Promise<void> {
    const r = this.open.get(projectId)
    this.open.delete(projectId)
    if (r) await this.runs.stop(r, 500)
  }

  /** Projetos com alerta ligado que estão no ar: mantém o log correndo para pegar os erros */
  keepAlive(projects: Project[], isUp: (id: string) => boolean): void {
    for (const p of projects) {
      if (!p.logAlerts || p.logSource.kind === 'none' || !p.path) continue
      if (isUp(p.id) && !this.isOpen(p.id)) this.start(p.id)
    }
  }

  handleRunEvent(e: RunEvent): void {
    if (e.type === 'exit') {
      for (const [id, r] of this.open) if (r === e.runId) this.open.delete(id)
      return
    }
    if (e.type !== 'lines') return
    const id = e.tab.startsWith('applog:') ? e.tab.slice(7) : e.tab.startsWith('project:') ? e.tab.slice(8) : ''
    if (!id) return
    const p = this.project(id)
    if (!p?.logAlerts) return
    const hit = e.lines.find((l) => LOG_ERROR_RE.test(l.text))
    if (!hit) return
    const now = Date.now()
    if (now - (this.lastAlert.get(id) ?? 0) < this.alertEveryMs) return
    this.lastAlert.set(id, now)
    this.onError(p, hit.text.trim().slice(0, 300), e.tab)
  }
}

/** Últimas linhas do log (para o Telegram), sem deixar nada rodando */
export async function logTail(p: Project, lines = 30): Promise<OpResult & { text?: string }> {
  const src = p.logSource
  if (src.kind === 'file') {
    const f = logFilePath(p, src.path)
    if (!existsSync(f)) return { ok: false, message: `Arquivo de log não encontrado: ${f}` }
    // Lê só o fim do arquivo (logs do Laravel passam fácil de 100 MB)
    const size = statSync(f).size
    const len = Math.min(size, 64 * 1024)
    const buf = Buffer.alloc(len)
    const fd = openSync(f, 'r')
    try {
      readSync(fd, buf, 0, len, size - len)
    } finally {
      closeSync(fd)
    }
    return { ok: true, message: '', text: buf.toString('utf8').split('\n').slice(-lines).join('\n') }
  }
  if (src.kind === 'docker') {
    if (!SAFE_SERVICE.test(src.service)) return { ok: false, message: 'Serviço do log não definido.' }
    const r = await shellCapture(`${composeCmd(p)} logs --no-color --tail ${lines} ${src.service}`, p.path, 20_000)
    if (r.code !== 0) return { ok: false, message: (r.err || r.out).trim().split('\n').slice(-1)[0] || 'O docker compose não respondeu.' }
    return { ok: true, message: '', text: (r.out + r.err).trim() }
  }
  if (src.kind === 'command') return { ok: false, message: 'Log por comando só aparece no app (ele fica rodando).' }
  return { ok: false, message: `Defina onde fica o log de ${p.name} no cadastro do projeto.` }
}
