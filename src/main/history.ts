import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'fs'
import { writeFileAtomic } from './fsutil'
import { join } from 'path'
import type { HistoryEntry, RunEvent } from '../shared/types'

const MAX_ENTRIES = 300
/** Linhas guardadas por execução (as últimas) */
const MAX_LINES = 3000

const PREFIX: Record<string, string> = { stderr: '! ', tool: '⚙ ', info: '· ', claude: '', stdout: '' }

/**
 * Histórico de execuções: tudo que roda no app (console, scripts, projetos, Claude, Telegram, regras).
 * Fica só no PC: history.json (lista) + history/<id>.log (saída). As 300 mais recentes.
 */
export class History {
  private entries: HistoryEntry[] = []
  /** Saída das execuções em andamento (vai para o arquivo ao terminar) */
  private live = new Map<string, string[]>()
  private file: string
  private dir: string
  private saveTimer: NodeJS.Timeout | null = null

  constructor(
    base: string,
    private onChange: (entries: HistoryEntry[]) => void
  ) {
    this.file = join(base, 'history.json')
    this.dir = join(base, 'history')
    try {
      mkdirSync(this.dir, { recursive: true })
      if (existsSync(this.file)) this.entries = JSON.parse(readFileSync(this.file, 'utf8'))
      if (!Array.isArray(this.entries)) this.entries = []
      // App fechou com coisa rodando: fica como interrompida
      for (const e of this.entries) if (e.status === 'running') e.status = 'stopped'
    } catch {
      this.entries = []
    }
  }

  list(): HistoryEntry[] {
    return this.entries
  }

  handle(e: RunEvent): void {
    if (e.type === 'start') {
      this.entries.unshift({
        id: e.runId,
        tab: e.tab,
        title: e.title,
        kind: e.kind,
        cwd: e.cwd ?? '',
        projectId: e.projectId,
        origin: e.origin ?? 'app',
        startedAt: e.startedAt,
        status: 'running',
        code: null,
        lineCount: 0
      })
      this.live.set(e.runId, [])
      this.trim()
      this.changed()
      return
    }
    const entry = this.entries.find((x) => x.id === e.runId)
    const buf = this.live.get(e.runId)
    if (e.type === 'lines' && buf) {
      for (const l of e.lines) buf.push((PREFIX[l.kind] ?? '') + l.text)
      if (buf.length > MAX_LINES) buf.splice(0, buf.length - MAX_LINES)
      if (entry) entry.lineCount += e.lines.length
    } else if (e.type === 'usage' && entry) {
      if (e.costUsd !== null) entry.costUsd = (entry.costUsd ?? 0) + e.costUsd
      if (e.tokens !== null) entry.tokens = (entry.tokens ?? 0) + e.tokens
    } else if (e.type === 'error' && buf) {
      buf.push('! ' + e.message)
    } else if (e.type === 'exit' && entry) {
      entry.endedAt = Date.now()
      entry.code = e.code
      entry.status = e.killed ? 'stopped' : e.code === 0 ? 'ok' : 'error'
      try {
        writeFileAtomic(join(this.dir, `${safe(e.runId)}.log`), (buf ?? []).join('\n'))
      } catch {
        /* disco cheio etc.: o histórico é melhor-esforço */
      }
      this.live.delete(e.runId)
      this.changed()
    }
  }

  /** Saída de uma execução (em andamento ou gravada) */
  log(id: string): string[] {
    const buf = this.live.get(id)
    if (buf) return [...buf]
    try {
      return readFileSync(join(this.dir, `${safe(id)}.log`), 'utf8').split('\n')
    } catch {
      return []
    }
  }

  /** Execução mais recente que casa com o filtro */
  latest(match: (e: HistoryEntry) => boolean): HistoryEntry | undefined {
    return this.entries.find(match)
  }

  clear(): void {
    const running = this.entries.filter((e) => e.status === 'running')
    for (const f of readdirSync(this.dir)) {
      if (!running.some((r) => `${safe(r.id)}.log` === f)) rmSync(join(this.dir, f), { force: true })
    }
    this.entries = running
    this.changed()
  }

  private trim(): void {
    const old = this.entries.splice(MAX_ENTRIES)
    for (const o of old) rmSync(join(this.dir, `${safe(o.id)}.log`), { force: true })
  }

  private changed(): void {
    this.onChange(this.entries)
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      try {
        writeFileAtomic(this.file, JSON.stringify(this.entries))
      } catch {
        /* ignora */
      }
    }, 800)
  }

  flush(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    try {
      writeFileAtomic(this.file, JSON.stringify(this.entries))
    } catch {
      /* ignora */
    }
  }
}

const safe = (id: string) => id.replace(/[^\w-]/g, '')
