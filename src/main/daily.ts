import type { Demand, HistoryEntry, Project, QueueTask } from '../shared/types'
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
}): string {
  const { now, demands, history, queue, projects } = input
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
    did.push(`- ${name(d)}: ${what}`)
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
