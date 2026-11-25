import type { Demand, HistoryEntry, Project, QueueTask, WorkSession } from '../shared/types'
import { demandTiming } from './demands'

const STATUS: Record<Demand['status'], string> = {
  nova: 'nova',
  estimada: 'estimada',
  desenhada: 'desenhada',
  dev: 'em dev',
  teste: 'em teste',
  beta: 'em beta',
  feita: 'feita'
}

function dayStart(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Último dia útil antes de hoje (segunda → sexta) */
export function previousWorkday(now: number): { from: number; to: number; label: string } {
  const to = dayStart(now)
  let from = to - 86_400_000
  while ([0, 6].includes(new Date(from).getDay())) from -= 86_400_000
  const label = new Date(now).getDay() === 1 ? 'sexta' : 'ontem'
  return { from, to, label }
}

/** Uma frase curta a partir das anotações da linha do tempo */
function summarizeNotes(notes: string[]): string {
  const keep: string[] = []
  const add = (s: string) => !keep.includes(s) && keep.push(s)
  for (const n of notes) {
    if (/Análise pronta/.test(n)) add('análise e estimativa')
    else if (/Desenho pronto|Desenho aprovado/.test(n)) add('desenho da solução')
    else if (/Implementação começou|Claude respondeu|fila começou|commit da fila|trazidos para/.test(n)) add('implementação')
    else if (/Atualizada com a/.test(n)) add('atualizei com a principal')
    else if (/Revisão pronta|Revisão publicada/.test(n)) add('revisão de código')
    else if (/PR aberto/.test(n)) add('abri o PR')
    else if (/Etapa: (\w+)/.test(n)) add(`passou para ${STATUS[n.match(/Etapa: (\w+)/)![1] as Demand['status']] ?? n.slice(7)}`)
    else if (/Card atualizado do Jira|Demanda criada/.test(n)) add('levantamento do card')
  }
  return keep.join(', ')
}

/**
 * Resumo para a daily: o que fiz no último dia útil, o que vou fazer hoje e impedimentos.
 * Montado das demandas (linha do tempo), da fila e do histórico. Texto puro, pronto para colar.
 */
export function buildDaily(input: {
  now: number
  demands: Demand[]
  history: HistoryEntry[]
  queue: QueueTask[]
  projects: Project[]
  /** Jornadas: tempo em cada demanda (opcional) */
  sessions?: WorkSession[]
}): string {
  const { now, demands, history, queue, projects } = input
  const sessions = input.sessions ?? []
  const { from, to, label } = previousWorkday(now)
  const inRange = (t?: number) => !!t && t >= from && t < to
  const name = (d: Demand) => `${d.key}${d.title || d.jira?.summary ? ` (${d.title || d.jira?.summary})` : ''}`

  // ---- ontem
  const did: string[] = []
  for (const d of demands) {
    const notes = d.timeline.filter((x) => inRange(x.at)).map((x) => x.text)
    const runs = history.filter((h) => h.tab === `demand:${d.id}` && inRange(h.startedAt)).length
    const tasks = queue.filter((q) => q.demandId === d.id && inRange(q.endedAt) && q.status === 'feita').length
    if (!notes.length && !runs && !tasks) continue
    let what = summarizeNotes(notes) || 'implementação'
    if (tasks) what += `; a fila fez ${tasks} tarefa(s)`
    const t = timeIn(sessions, d.id, from, to)
    did.push(`- ${name(d)}: ${what}${t ? ` (${fmtHours(t)})` : ''}`)
  }
  // Demanda com tempo registrado mas sem nada na linha do tempo também entra
  for (const d of demands) {
    if (did.some((l) => l.startsWith(`- ${name(d)}:`))) continue
    const t = timeIn(sessions, d.id, from, to)
    if (t >= 5 * 60_000) did.push(`- ${name(d)}: implementação (${fmtHours(t)})`)
  }
  const scripts = new Map<string, number>()
  for (const h of history) {
    if (!inRange(h.startedAt) || !h.tab.startsWith('script:') || h.status !== 'ok') continue
    scripts.set(h.title, (scripts.get(h.title) ?? 0) + 1)
  }
  for (const [title, n] of scripts) did.push(`- ${title}${n > 1 ? ` (${n}x)` : ''}`)
  for (const q of queue) {
    if (q.demandId || !inRange(q.endedAt) || q.status !== 'feita') continue
    const p = projects.find((x) => x.id === q.projectId)?.name ?? ''
    did.push(`- ${p}: ${q.prompt.replace(/\s+/g, ' ').slice(0, 80)}`)
  }

  // ---- hoje
  const today: string[] = []
  const open = demands
    .filter((d) => d.status !== 'feita' && d.status !== 'nova')
    .sort((a, b) => b.updatedAt - a.updatedAt)
  for (const d of open.slice(0, 6)) {
    const tm = demandTiming(d, now)
    const est = d.hours ? `, estimativa ${d.hours}h` : ''
    const spent = tm.realDays ? `, ${String(tm.realDays).replace('.', ',')} dia(s) útil(eis) até agora` : ''
    const next =
      d.status === 'estimada' ? 'desenhar a solução' : d.status === 'desenhada' ? 'começar a implementação' : d.status === 'teste' ? 'acompanhar os testes' : d.status === 'beta' ? 'acompanhar em beta' : 'seguir a implementação'
    today.push(`- ${name(d)}: ${next} (${STATUS[d.status]}${est}${spent})`)
  }
  const pend = queue.filter((q) => q.status === 'pendente').length
  if (pend) today.push(`- ${pend} tarefa(s) na fila do Claude`)

  // ---- impedimentos
  const blocks: string[] = []
  for (const q of queue) {
    if (!(inRange(q.endedAt) || (q.endedAt ?? 0) >= to)) continue
    const d = q.demandId ? demands.find((x) => x.id === q.demandId) : undefined
    const who = d ? d.key : (projects.find((x) => x.id === q.projectId)?.name ?? '')
    if (q.status === 'falhou') blocks.push(`- ${who}: tarefa da fila falhou (${q.error ?? 'ver detalhes'})`)
    else if (q.check && !q.check.ok) blocks.push(`- ${who}: verificação (${q.check.command}) falhando`)
  }
  for (const d of open) {
    if (d.review && /precisa de ajustes/i.test(d.review.text)) blocks.push(`- ${d.key}: revisão pediu ajustes`)
  }

  const fmtDay = new Date(now).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })
  const totalYesterday = sessions.reduce((t, s) => t + overlap(s, from, to, now), 0)
  if (totalYesterday >= 60_000) did.push(`Tempo registrado: ${fmtHours(totalYesterday)}`)
  return [
    `Daily · ${fmtDay}`,
    '',
    `${label[0].toUpperCase() + label.slice(1)}:`,
    ...(did.length ? did : ['- (nada registrado no app)']),
    '',
    'Hoje:',
    ...(today.length ? today : ['- (nenhuma demanda aberta)']),
    '',
    'Impedimentos:',
    ...(blocks.length ? blocks : ['- nenhum'])
  ].join('\n')
}

// ---------------------------------------------------------------- tempo (jornadas)

/** Quanto do período cai entre from e to (o período aberto conta até agora) */
export function overlap(s: WorkSession, from: number, to: number, now = Date.now()): number {
  const a = Math.max(s.start, from)
  const b = Math.min(s.end ?? now, to)
  return Math.max(0, b - a)
}

export function timeIn(sessions: WorkSession[], demandId: string, from: number, to: number, now = Date.now()): number {
  return sessions.filter((s) => s.demandId === demandId).reduce((t, s) => t + overlap(s, from, to, now), 0)
}

export function fmtHours(ms: number): string {
  const m = Math.round(ms / 60_000)
  const h = Math.floor(m / 60)
  return h ? `${h}h${String(m % 60).padStart(2, '0')}` : `${m}min`
}

/** Segunda-feira 00:00 da semana de `now` */
export function weekStart(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime() - ((d.getDay() + 6) % 7) * 86_400_000
}

/**
 * Relatório da semana: horas em cada demanda, estimado contra o tempo registrado, etapa atual e o total.
 * Texto puro, pronto para colar no Jira, no chat ou mandar para o líder.
 */
export function buildWeekly(input: { now: number; demands: Demand[]; sessions: WorkSession[] }): string {
  const { now, demands, sessions } = input
  const from = weekStart(now)
  const to = now
  const rows: Array<{ d: Demand; ms: number; all: number }> = []
  for (const d of demands) {
    const ms = timeIn(sessions, d.id, from, to, now)
    if (ms < 60_000 && !(d.statusLog ?? []).some((x) => x.at >= from)) continue
    rows.push({ d, ms, all: timeIn(sessions, d.id, 0, now, now) })
  }
  rows.sort((a, b) => b.ms - a.ms)
  const total = sessions.reduce((t, s) => t + overlap(s, from, to, now), 0)
  // Dias com tempo registrado
  const perDay: string[] = []
  for (let t = from; t < to; t += 86_400_000) {
    const ms = sessions.reduce((acc, s) => acc + overlap(s, t, t + 86_400_000, now), 0)
    if (ms >= 60_000) perDay.push(`${new Date(t).toLocaleDateString('pt-BR', { weekday: 'short' })} ${fmtHours(ms)}`)
  }
  const fmt = (t: number) => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  const lines = [`Semana ${fmt(from)} a ${fmt(now)} · ${fmtHours(total)} registradas`, '']
  if (!rows.length) lines.push('- (nenhuma demanda com tempo registrado nesta semana)')
  for (const { d, ms, all } of rows) {
    const est = d.hours ? ` · estimado ${d.hours}h, total até agora ${fmtHours(all)}${all > d.hours * 3_600_000 ? ' (passou da estimativa)' : ''}` : ''
    lines.push(`- ${d.key}${d.title || d.jira?.summary ? ` (${d.title || d.jira?.summary})` : ''}: ${fmtHours(ms)} · ${STATUS[d.status]}${est}`)
  }
  if (perDay.length) lines.push('', `Por dia: ${perDay.join(' · ')}`)
  return lines.join('\n')
}
