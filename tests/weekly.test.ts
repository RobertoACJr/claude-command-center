import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildDaily, buildWeekly, fmtHours, overlap, weekStart } from '../src/main/daily'

const H = 3_600_000
const demand = (id: string, key: string, hours: number | null) =>
  ({ id, key, title: 'tela', projectId: 'p', status: 'dev', hours, timeline: [], statusLog: [], updatedAt: 0, jira: null }) as any

test('relatório da semana e daily com o tempo das jornadas', () => {
  const now = new Date(2026, 10, 27, 18, 0).getTime() // sexta
  const mon = weekStart(now)
  assert.equal(new Date(mon).getDay(), 1)
  const sessions = [
    { id: '1', demandId: 'a', key: 'MAS-1', title: '', projectId: 'p', start: mon + 9 * H, end: mon + 12 * H },
    { id: '2', demandId: 'a', key: 'MAS-1', title: '', projectId: 'p', start: now - 3 * 86_400_000 - H, end: now - 3 * 86_400_000 },
    { id: '3', demandId: 'b', key: 'MAS-2', title: '', projectId: 'p', start: now - H / 2, end: null },
    { id: '4', demandId: 'b', key: 'MAS-2', title: '', projectId: 'p', start: mon - 86_400_000, end: mon - 86_400_000 + H } // semana passada
  ] as any
  const txt = buildWeekly({ now, demands: [demand('a', 'MAS-1', 2), demand('b', 'MAS-2', null)], sessions })
  assert.match(txt, /4h30 registradas/)
  assert.match(txt, /MAS-1 \(tela\): 4h00 · em dev · estimado 2h, total até agora 4h00 \(passou da estimativa\)/)
  assert.match(txt, /MAS-2 \(tela\): 30min/)
  assert.equal(fmtHours(90 * 60_000), '1h30')
  assert.equal(overlap(sessions[3], mon, now, now), 0)

  // Daily de terça: ontem (segunda) teve 3h em MAS-1
  const tue = mon + 86_400_000 + 9 * H
  const daily = buildDaily({ now: tue, demands: [demand('a', 'MAS-1', 2)], history: [], queue: [], projects: [], sessions })
  assert.match(daily, /MAS-1 \(tela\): implementação \(3h00\)/)
  assert.match(daily, /Tempo registrado: 3h00/)
})
