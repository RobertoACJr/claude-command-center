// Limites de uso do Claude (janela de 5h e semanal): de onde vêm, até quando a fila espera e o aviso de ritmo.
//
// Fontes:
// - O próprio Claude, nas execuções do app (-p --output-format stream-json), manda eventos
//   {"type":"rate_limit_event","rate_limit_info":{status, resetsAt, rateLimitType, utilization?}}.
// - A linha de status (opcional, ligada em Configurações → IAs) grava o JSON das sessões interativas
//   em ~/.claude/helice-limits.json, com rate_limits.five_hour/seven_day.used_percentage e resets_at.
// - Um erro 429 / "limit" no resultado marca a janela como estourada.
import { existsSync, readFileSync, unwatchFile, watchFile } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { AiConfig, ClaudeEffort, ClaudeModel, LimitWindow, LimitsState, PlanPhase, PlanSlot, TaskTier } from '../shared/types'
import { writeFileAtomic } from './fsutil'

export type WindowId = 'five_hour' | 'seven_day'
export interface LimitUpdate {
  window: WindowId | null
  status: LimitWindow['status']
  resetsAt: number | null
  pct: number | null
}

const FIVE_H = 5 * 3600_000

/** Epoch em segundos, milissegundos ou texto ISO → ms */
export function toMs(v: unknown): number | null {
  if (typeof v === 'number' && isFinite(v) && v > 0) return v < 1e12 ? v * 1000 : v
  if (typeof v === 'string' && v.trim()) {
    if (/^\d+(\.\d+)?$/.test(v.trim())) return toMs(Number(v))
    const t = Date.parse(v)
    return isNaN(t) ? null : t
  }
  return null
}

/** 0–1 ou 0–100 → 0–100 */
function toPct(v: unknown, fraction: boolean): number | null {
  if (typeof v !== 'number' || !isFinite(v)) return null
  const p = fraction ? v * 100 : v
  return Math.max(0, Math.min(100, Math.round(p * 10) / 10))
}

function statusOf(raw: unknown): LimitWindow['status'] {
  const s = String(raw ?? '').toLowerCase()
  if (s === 'rejected' || s === 'rate_limited' || s === 'blocked') return 'bloqueado'
  if (s.includes('warning')) return 'aviso'
  return 'ok'
}

function windowOf(raw: unknown): WindowId | null {
  const s = String(raw ?? '').toLowerCase()
  if (s.includes('five') || s.includes('5h') || s === 'session') return 'five_hour'
  if (s.includes('seven') || s.includes('week') || s.includes('7d')) return 'seven_day'
  return null
}

/** Evento rate_limit_event do stream-json do Claude → atualizações */
export function parseRateLimitEvent(msg: Record<string, any>): LimitUpdate[] {
  const info = msg?.rate_limit_info
  if (!info || typeof info !== 'object') return []
  const out: LimitUpdate[] = []
  const status = statusOf(info.status)
  const win = windowOf(info.rateLimitType)
  const unified = info.unifiedWindows && typeof info.unifiedWindows === 'object' ? info.unifiedWindows : null
  if (unified) {
    for (const [k, w] of Object.entries<any>(unified)) {
      const id = windowOf(k)
      if (!id || !w) continue
      out.push({ window: id, status: id === win ? status : 'ok', resetsAt: toMs(w.resetsAt), pct: toPct(w.utilization, true) })
    }
  }
  if (!out.some((u) => u.window === win)) {
    out.push({ window: win, status, resetsAt: toMs(info.resetsAt), pct: toPct(info.utilization, true) })
  }
  return out
}

/** JSON que o Claude manda para a linha de status → atualizações */
export function parseStatusline(json: Record<string, any>): LimitUpdate[] {
  const rl = json?.rate_limits
  if (!rl || typeof rl !== 'object') return []
  const out: LimitUpdate[] = []
  for (const [k, id] of [['five_hour', 'five_hour'], ['seven_day', 'seven_day']] as const) {
    const w = rl[k]
    if (!w) continue
    const pct = toPct(w.used_percentage, false)
    out.push({ window: id, status: pct !== null && pct >= 100 ? 'bloqueado' : 'ok', resetsAt: toMs(w.resets_at), pct })
  }
  return out
}

/** O resultado do Claude diz que bateu no limite de uso? */
export function isLimitError(msg: Record<string, any>): boolean {
  if (!msg?.is_error && msg?.subtype !== 'error') return false
  if (msg.api_error_status === 429) return true
  const text = String(msg.result ?? msg.error ?? '')
  return /usage limit|rate limit|limit reached|limite de uso|hit your limit|429/i.test(text)
}

/** Argumentos de modelo/esforço do Claude conforme o peso da tarefa */
export function claudeTierArgs(ai: Pick<AiConfig, 'claudeModel' | 'claudeEffort' | 'economy' | 'lightModel' | 'lightEffort'>, tier: TaskTier): string[] {
  const light = tier === 'light' && ai.economy
  const model: ClaudeModel = (light && ai.lightModel) || ai.claudeModel
  const effort: ClaudeEffort = (light && ai.lightEffort) || ai.claudeEffort
  const args: string[] = []
  if (model) args.push('--model', model)
  if (effort) args.push('--effort', effort)
  return args
}

/**
 * Agenda das fases: simula as janelas de 5h. Cada fase entra na janela atual se couber no teto;
 * senão vai para logo depois do próximo reset. Fases já feitas/rodando ficam de fora.
 */
export function computeSchedule(
  phases: Pick<PlanPhase, 'id' | 'estPct' | 'status'>[],
  five: Pick<LimitWindow, 'pct' | 'resetsAt'> | null,
  capPct: number,
  now = Date.now()
): PlanSlot[] {
  const cap = Math.max(5, Math.min(100, capPct || 100))
  const active = five && five.resetsAt && five.resetsAt > now
  let used = active ? five!.pct ?? 0 : 0
  let start = now
  let end = active ? five!.resetsAt! : now + FIVE_H
  let win = 0
  const out: PlanSlot[] = []
  for (const p of phases) {
    if (p.status === 'feita' || p.status === 'rodando') continue
    const est = Math.max(1, p.estPct || 0)
    if (used + est > cap && used > 0) {
      start = end
      end = start + FIVE_H
      used = 0
      win++
    }
    used += est
    out.push({ id: p.id, at: start, window: win, usedAfter: Math.round(used) })
  }
  return out
}

const fresh = (w: LimitWindow | null, now: number): LimitWindow | null => {
  if (!w) return null
  // Janela já resetou: começa do zero
  if (w.resetsAt && w.resetsAt <= now) return { pct: 0, resetsAt: null, status: 'ok', updatedAt: w.updatedAt }
  return w
}

/** Guarda o estado dos limites, avisa o ritmo e diz até quando a fila deve esperar */
export class LimitsTracker {
  private five: LimitWindow | null = null
  private week: LimitWindow | null = null
  private file: string
  private warnedFor: number | null = null
  private watching: string | null = null

  constructor(
    base: string,
    private d: {
      config: () => AiConfig
      onChange: (s: LimitsState) => void
      /** Aviso de ritmo: passou de X% da janela de 5h */
      onPace: (pct: number, resetsAt: number | null) => void
    }
  ) {
    this.file = join(base, 'limits.json')
    try {
      if (existsSync(this.file)) {
        const raw = JSON.parse(readFileSync(this.file, 'utf8'))
        this.five = raw.five ?? null
        this.week = raw.week ?? null
        this.warnedFor = raw.warnedFor ?? null
      }
    } catch {
      /* começa vazio */
    }
  }

  static statuslineFile(): string {
    return join(homedir(), '.claude', 'helice-limits.json')
  }

  state(now = Date.now()): LimitsState {
    const cfg = this.d.config()
    return {
      fiveHour: fresh(this.five, now),
      sevenDay: fresh(this.week, now),
      blockedUntil: this.blockedUntil(now),
      capPct: cfg.sessionCapPct,
      statusLine: cfg.statusLine
    }
  }

  /** Até quando a fila e as fases devem esperar (null = podem rodar) */
  blockedUntil(now = Date.now()): number | null {
    const cap = this.d.config().sessionCapPct || 100
    let until: number | null = null
    const five = fresh(this.five, now)
    const week = fresh(this.week, now)
    const later = (t: number | null) => {
      const v = t ?? now + 30 * 60_000 // sem horário: tenta de novo em 30 min
      until = until === null ? v : Math.max(until, v)
    }
    if (five && (five.status === 'bloqueado' || (five.pct !== null && five.pct >= cap))) later(five.resetsAt)
    if (week && week.status === 'bloqueado') later(week.resetsAt)
    return until && until > now ? until : null
  }

  update(list: LimitUpdate[], now = Date.now()): void {
    let changed = false
    for (const u of list) {
      // Sem janela informada: bloqueio vale para a de 5h
      const id = u.window ?? 'five_hour'
      const prev = id === 'five_hour' ? this.five : this.week
      const next: LimitWindow = {
        pct: u.pct ?? (u.status === 'bloqueado' ? 100 : prev && prev.resetsAt === u.resetsAt ? prev.pct : null),
        resetsAt: u.resetsAt ?? (prev?.resetsAt && prev.resetsAt > now ? prev.resetsAt : null),
        status: u.status,
        updatedAt: now
      }
      if (id === 'five_hour') this.five = next
      else this.week = next
      changed = true
    }
    if (!changed) return
    this.checkPace(now)
    this.persist()
    this.d.onChange(this.state(now))
  }

  /** Bateu no limite sem saber o horário do reset */
  markBlocked(): void {
    this.update([{ window: 'five_hour', status: 'bloqueado', resetsAt: null, pct: null }])
  }

  private checkPace(now: number): void {
    const warn = this.d.config().paceWarnPct
    const five = fresh(this.five, now)
    if (!warn || !five || five.pct === null || five.pct < warn) return
    const key = five.resetsAt ?? Math.floor(now / FIVE_H)
    if (this.warnedFor === key) return
    this.warnedFor = key
    this.d.onPace(five.pct, five.resetsAt)
  }

  private persist(): void {
    try {
      writeFileAtomic(this.file, JSON.stringify({ five: this.five, week: this.week, warnedFor: this.warnedFor }))
    } catch {
      /* ignora */
    }
  }

  /** Acompanha o arquivo da linha de status (só quando ela está ligada) */
  watchStatusline(on: boolean): void {
    const file = LimitsTracker.statuslineFile()
    if (!on) {
      if (this.watching) unwatchFile(this.watching)
      this.watching = null
      return
    }
    if (this.watching) return
    this.watching = file
    const read = () => {
      try {
        if (!existsSync(file)) return
        this.update(parseStatusline(JSON.parse(readFileSync(file, 'utf8'))))
      } catch {
        /* arquivo pela metade: lê na próxima */
      }
    }
    watchFile(file, { interval: 5000 }, read)
    read()
  }
}

/** "16:40" (hoje) ou "amanhã 09:10" / "qui 09:10" */
export function fmtReset(ms: number | null, now = Date.now()): string {
  if (!ms) return 'sem horário'
  const d = new Date(ms)
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const today = new Date(now)
  const days = Math.round((new Date(d.toDateString()).getTime() - new Date(today.toDateString()).getTime()) / 86400_000)
  if (days <= 0) return hm
  if (days === 1) return `amanhã ${hm}`
  return `${['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][d.getDay()]} ${hm}`
}
