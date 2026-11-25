import { randomUUID } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { WorkLogState, WorkSession } from '../shared/types'
import { dayKey } from './costs'
import { writeFileAtomic } from './fsutil'

const KEEP_MS = 90 * 24 * 3600 * 1000

/**
 * Jornadas: quanto tempo você trabalhou em cada demanda. Um cronômetro por vez:
 * começar outra demanda fecha a anterior. Pausa sozinho quando você fica Ausente ou fica
 * muito tempo sem mexer no PC. Se o app fechar com um período aberto, ele termina no último "sinal de vida".
 */
export class WorkLog {
  private sessions: WorkSession[] = []
  private file = ''
  /** Último instante em que o app estava de pé com um período aberto */
  private beat = 0

  constructor(private onChange: (s: WorkLogState) => void = () => {}) {}

  init(dir: string, now = Date.now()): void {
    this.file = join(dir, 'worklog.json')
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { sessions?: WorkSession[]; beat?: number }
        this.sessions = (raw.sessions ?? []).filter((s) => s && typeof s.start === 'number' && s.start > now - KEEP_MS)
        this.beat = typeof raw.beat === 'number' ? raw.beat : 0
        // Período que ficou aberto (app fechado ou PC desligado): termina no último sinal de vida
        for (const s of this.sessions) {
          if (s.end === null) {
            s.end = Math.max(s.start, Math.min(now, this.beat || s.start))
            s.note = 'app fechado'
          }
        }
      }
    } catch {
      this.sessions = []
    }
    this.save()
  }

  state(): WorkLogState {
    return { active: this.sessions.find((s) => s.end === null) ?? null, sessions: [...this.sessions].sort((a, b) => b.start - a.start) }
  }

  private save(): void {
    if (this.file) {
      try {
        writeFileAtomic(this.file, JSON.stringify({ sessions: this.sessions, beat: this.beat }))
      } catch {
        /* disco cheio etc.: tenta de novo na próxima */
      }
    }
    this.onChange(this.state())
  }

  start(d: { demandId: string; key: string; title: string; projectId: string }, now = Date.now()): WorkLogState {
    const cur = this.state().active
    if (cur?.demandId === d.demandId) return this.state()
    if (cur) cur.end = now
    this.sessions.push({ id: randomUUID(), ...d, start: now, end: null })
    this.beat = now
    this.save()
    return this.state()
  }

  /** Fecha o período aberto. `at` permite terminar no passado (ex.: quando você parou de mexer no PC) */
  stop(note?: string, at = Date.now()): WorkLogState {
    const cur = this.state().active
    if (!cur) return this.state()
    cur.end = Math.max(cur.start, at)
    if (note) cur.note = note
    // Menos de 1 minuto não conta (clique sem querer)
    if (cur.end - cur.start < 60_000) this.sessions = this.sessions.filter((s) => s !== cur)
    this.save()
    return this.state()
  }

  /** Chamado a cada minuto: guarda o sinal de vida e pausa se você sumiu do PC */
  tick(idleSeconds: number, idleLimitMin: number, now = Date.now()): string | null {
    const cur = this.state().active
    if (!cur) return null
    if (idleLimitMin > 0 && idleSeconds >= idleLimitMin * 60) {
      this.stop(`${idleLimitMin} min sem mexer no PC`, now - idleSeconds * 1000)
      return cur.key
    }
    this.beat = now
    if (this.file) {
      try {
        writeFileAtomic(this.file, JSON.stringify({ sessions: this.sessions, beat: this.beat }))
      } catch {
        /* ignora */
      }
    }
    return null
  }

  remove(id: string): WorkLogState {
    this.sessions = this.sessions.filter((s) => s.id !== id)
    this.save()
    return this.state()
  }

  edit(id: string, start: number, end: number): WorkLogState {
    const s = this.sessions.find((x) => x.id === id)
    if (s && Number.isFinite(start) && Number.isFinite(end) && end > start && s.end !== null) {
      s.start = start
      s.end = end
      this.save()
    }
    return this.state()
  }

  /** Períodos da demanda naquele dia ainda não lançados no Jira (o aberto não entra) */
  pending(demandId: string, day: string): WorkSession[] {
    return this.sessions.filter((s) => s.demandId === demandId && s.end !== null && !s.jiraLogged && dayKey(s.start) === day)
  }

  markLogged(ids: string[]): void {
    const set = new Set(ids)
    for (const s of this.sessions) if (set.has(s.id)) s.jiraLogged = true
    this.save()
  }
}

/** Tempo total em ms (o período aberto conta até agora) */
export function totalMs(list: WorkSession[], now = Date.now()): number {
  return list.reduce((t, s) => t + ((s.end ?? now) - s.start), 0)
}
