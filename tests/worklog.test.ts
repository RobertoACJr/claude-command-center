import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WorkLog, totalMs } from '../src/main/worklog'
import { dayKey } from '../src/main/costs'
import { tempDir } from './helpers'

const D = (id: string) => ({ demandId: id, key: id.toUpperCase(), title: 't', projectId: 'p' })
const MIN = 60_000

test('jornadas: uma por vez, pausa sozinho, ignora clique sem querer, sobrevive ao app fechar', () => {
  const dir = tempDir()
  const t0 = new Date(2026, 10, 25, 9, 0).getTime()
  const w = new WorkLog()
  w.init(dir, t0)
  w.start(D('mas-1'), t0)
  // Começar outra fecha a anterior
  w.start(D('mas-2'), t0 + 30 * MIN)
  let st = w.state()
  assert.equal(st.active?.key, 'MAS-2')
  assert.equal(totalMs(st.sessions.filter((s) => s.key === 'MAS-1')), 30 * MIN)

  // 20 min parado com limite de 15: pausa no momento em que parou de mexer
  const paused = w.tick(20 * 60, 15, t0 + 60 * MIN)
  assert.equal(paused, 'MAS-2')
  st = w.state()
  assert.equal(st.active, null)
  assert.equal(totalMs(st.sessions.filter((s) => s.key === 'MAS-2')), 10 * MIN)

  // Menos de 1 minuto: descarta
  w.start(D('mas-3'), t0 + 70 * MIN)
  w.stop(undefined, t0 + 70 * MIN + 20_000)
  assert.equal(w.state().sessions.some((s) => s.key === 'MAS-3'), false)

  // App fechou com período aberto: termina no último sinal de vida
  w.start(D('mas-4'), t0 + 80 * MIN)
  w.tick(0, 15, t0 + 95 * MIN)
  const w2 = new WorkLog()
  w2.init(dir, t0 + 300 * MIN)
  const s4 = w2.state().sessions.find((s) => s.key === 'MAS-4')!
  assert.equal(s4.end, t0 + 95 * MIN)
  assert.equal(s4.note, 'app fechado')
  assert.equal(w2.state().active, null)

  // Pendentes para o Jira por dia e marcação
  const day = dayKey(t0)
  const pend = w2.pending('mas-1', day)
  assert.equal(pend.length, 1)
  w2.markLogged(pend.map((s) => s.id))
  assert.equal(w2.pending('mas-1', day).length, 0)
})
