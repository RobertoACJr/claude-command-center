// Cards do Jira atribuídos a você que ainda não viraram demanda (aparecem como sugestão nas Demandas)
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { Demand, JiraSuggestion, Project } from '../shared/types'
import type { JiraAssigned } from './jira'
import { writeFileAtomic } from './fsutil'

/** Prefixo do card: WEB-12 → WEB */
const prefix = (key: string) => key.split('-')[0]

/** Tira os que já são demanda ou que você dispensou; chuta o projeto pelo prefixo das demandas que já existem */
export function suggestFromAssigned(issues: JiraAssigned[], demands: Pick<Demand, 'key' | 'projectId'>[], dismissed: Set<string>, projects: Pick<Project, 'id'>[]): JiraSuggestion[] {
  const have = new Set(demands.map((d) => d.key.toUpperCase()))
  const byPrefix = new Map<string, Map<string, number>>()
  for (const d of demands) {
    if (!projects.some((p) => p.id === d.projectId)) continue
    const m = byPrefix.get(prefix(d.key)) ?? new Map<string, number>()
    m.set(d.projectId, (m.get(d.projectId) ?? 0) + 1)
    byPrefix.set(prefix(d.key), m)
  }
  return issues
    .filter((i) => !have.has(i.key.toUpperCase()) && !dismissed.has(i.key.toUpperCase()))
    .map((i) => {
      const m = byPrefix.get(prefix(i.key))
      // O projeto com mais demandas desse prefixo; sem nenhuma: único projeto cadastrado, senão escolher
      const best = m ? [...m.entries()].sort((a, b) => b[1] - a[1])[0][0] : projects.length === 1 ? projects[0].id : ''
      return { key: i.key, summary: i.summary, status: i.status, projectId: best }
    })
}

const keys = (v: unknown) => new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.toUpperCase()) : [])

/** Cards dispensados ("não sugerir mais") e já avisados, guardados só neste PC */
export class JiraDismissed {
  private file: string
  private set: Set<string>
  private seen: Set<string>
  constructor(base: string) {
    this.file = join(base, 'jira-sugestoes.json')
    let raw: { dismissed?: unknown; seen?: unknown } = {}
    try {
      if (existsSync(this.file)) raw = JSON.parse(readFileSync(this.file, 'utf8')) ?? {}
    } catch {
      raw = {}
    }
    this.set = keys(raw.dismissed)
    this.seen = keys(raw.seen)
  }
  all(): Set<string> {
    return this.set
  }
  add(key: string): void {
    this.set.add(key.toUpperCase())
    this.save()
  }
  /** Os que ainda não foram avisados (e marca como avisados) */
  unseen(list: string[]): string[] {
    const out = list.filter((k) => !this.seen.has(k.toUpperCase()))
    if (out.length) {
      for (const k of out) this.seen.add(k.toUpperCase())
      this.save()
    }
    return out
  }
  private save(): void {
    try {
      writeFileAtomic(this.file, JSON.stringify({ dismissed: [...this.set].slice(-500), seen: [...this.seen].slice(-500) }))
    } catch {
      /* só não lembra */
    }
  }
}
