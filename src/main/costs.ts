import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { CostEntry, CostGuard } from '../shared/types'

/** Guarda 120 dias de gastos */
const KEEP_MS = 120 * 24 * 3600 * 1000

/** Início do dia local (o limite é por dia do seu relógio) */
export function dayStart(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function dayKey(t: number): string {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Registro de gastos com IA (costs.jsonl, só no PC). O Claude informa o custo em US$ (equivalente da API);
 * Gemini e ChatGPT só informam tokens. O limite diário pausa as automações (fila, Vigia, regras automáticas).
 */
export class CostLedger {
  private entries: CostEntry[] = []
  private file = ''
  /** Dia em que você liberou passar do limite */
  private overrideDay: string | null = null
  /** Dia em que já avisou que passou do limite */
  private warnedDay: string | null = null
  private limit = () => 0
  private onChange: (g: CostGuard) => void = () => {}
  private onLimit: (g: CostGuard) => void = () => {}

  init(
    dir: string,
    opts: { limit: () => number; onChange?: (g: CostGuard) => void; onLimit?: (g: CostGuard) => void }
  ): void {
    this.file = join(dir, 'costs.jsonl')
    this.limit = opts.limit
    if (opts.onChange) this.onChange = opts.onChange
    if (opts.onLimit) this.onLimit = opts.onLimit
    this.entries = []
    try {
      if (existsSync(this.file)) {
        const cut = Date.now() - KEEP_MS
        for (const line of readFileSync(this.file, 'utf8').split('\n')) {
          if (!line.trim()) continue
          try {
            const e = JSON.parse(line) as CostEntry
            if (e && typeof e.at === 'number' && e.at >= cut) this.entries.push(e)
          } catch {
            /* linha corrompida: ignora */
          }
        }
        // Reescreve sem o que passou dos 120 dias
        writeFileSync(this.file, this.entries.map((e) => JSON.stringify(e)).join('\n') + (this.entries.length ? '\n' : ''))
      }
    } catch {
      this.entries = []
    }
  }

  list(): CostEntry[] {
    return this.entries
  }

  record(e: Omit<CostEntry, 'at'> & { at?: number }): void {
    if (e.usd === null && e.tokens === null) return
    const entry: CostEntry = { ...e, at: e.at ?? Date.now(), usd: e.usd ?? null, tokens: e.tokens ?? null }
    this.entries.push(entry)
    try {
      if (this.file) appendFileSync(this.file, JSON.stringify(entry) + '\n')
    } catch {
      /* ignora */
    }
    const g = this.guard()
    this.onChange(g)
    if (g.over && !g.overridden && this.warnedDay !== dayKey(Date.now())) {
      this.warnedDay = dayKey(Date.now())
      this.onLimit(g)
    }
  }

  todayUsd(now = Date.now()): number {
    const start = dayStart(now)
    return this.entries.reduce((sum, e) => (e.at >= start && e.usd ? sum + e.usd : sum), 0)
  }

  guard(now = Date.now()): CostGuard {
    const limitUsd = this.limit()
    const todayUsd = this.todayUsd(now)
    const over = limitUsd > 0 && todayUsd >= limitUsd
    return { todayUsd, limitUsd, over, overridden: over && this.overrideDay === dayKey(now) }
  }

  /** Automações podem rodar? (abaixo do limite, ou você liberou hoje) */
  allowsAutomation(now = Date.now()): boolean {
    const g = this.guard(now)
    return !g.over || g.overridden
  }

  overrideToday(): CostGuard {
    this.overrideDay = dayKey(Date.now())
    const g = this.guard()
    this.onChange(g)
    return g
  }
}

export const costs = new CostLedger()
