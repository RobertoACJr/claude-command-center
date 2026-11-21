import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { fakeRuns, makeRepo, sh, sleep, tempDir, until, useTempUserData } from './helpers'

useTempUserData()
const { store } = require('../src/main/store') as typeof import('../src/main/store')
const { costs } = require('../src/main/costs') as typeof import('../src/main/costs')
const { DemandManager, normDemand } = require('../src/main/demands') as typeof import('../src/main/demands')
const { QueueManager, QUEUE_SUFFIX, queueSummary } = require('../src/main/queue') as typeof import('../src/main/queue')

const exit = (q: any, runs: any, id: string, code = 0, killed = false) => {
  runs.done(id)
  q.handleRunEvent({ runId: id, tab: 'fila', type: 'exit', code, signal: null, killed })
}

function setup() {
  const { work } = makeRepo()
  store.saveProject({ id: 'web', name: 'proj-web', path: work, vars: [], guides: [] } as any)
  const runs = fakeRuns()
  const demands = new DemandManager(tempDir(), runs as any, () => {})
  const drained: any[] = []
  const q = new QueueManager(tempDir(), { runs: runs as any, demands, onChange: () => {}, onDrained: (d) => drained.push(d), log: () => {} })
  return { work, runs, demands, q, drained }
}

test('só anda Ausente (por padrão), uma por vez, e "Rodar agora" fura a espera', async () => {
  costs.init(tempDir(), { limit: () => 0 })
  store.saveSettings({ queue: { onlyAway: true, paused: false } })
  store.setStatus('on')
  const { runs, q } = setup()
  assert.equal(q.add({ projectId: 'web', prompt: 'tarefa 1' }).ok, true)
  q.add({ projectId: 'web', prompt: 'tarefa 2' })
  await sleep(50)
  assert.equal(runs.started.length, 0)
  assert.match(q.state().waiting ?? '', /Ausente/)
  assert.equal(q.runNow().ok, true)
  await sleep(50)
  assert.equal(runs.started.length, 1, 'uma por vez')
  assert.equal(runs.started[0].req.content, 'tarefa 1' + QUEUE_SUFFIX)
  assert.equal(runs.started[0].req.origin, 'fila')
  q.handleRunEvent({ runId: 'run1', tab: 'fila', type: 'usage', costUsd: 0.3, tokens: 10 })
  q.handleRunEvent({ runId: 'run1', tab: 'fila', type: 'lines', lines: [{ kind: 'claude', text: 'Fiz o filtro. Teste em /pedidos.' }] })
  exit(q, runs, 'run1')
  await until(() => runs.started.length === 2)
  const t1 = q.state().tasks[0]
  assert.equal(t1.status, 'feita')
  assert.equal(t1.costUsd, 0.3)
  assert.match(t1.summary ?? '', /Fiz o filtro/)
  exit(q, runs, 'run2', 1)
  await sleep(50)
  assert.equal(q.state().tasks[1].status, 'falhou')
})

test('Ausente: roda sozinha e manda o resumo quando a fila esvazia', async () => {
  costs.init(tempDir(), { limit: () => 0 })
  store.saveSettings({ queue: { onlyAway: true, paused: false } })
  store.setStatus('off')
  const { runs, q, drained } = setup()
  q.add({ projectId: 'web', prompt: 'só uma' })
  await sleep(50)
  assert.equal(runs.started.length, 1)
  exit(q, runs, 'run1')
  await sleep(50)
  assert.equal(drained.length, 1)
  const text = queueSummary(drained[0], () => 'proj-web')
  assert.match(text, /1 feita/)
  assert.match(text, /proj-web: só uma/)
  assert.equal(q.takeUnreported().length, 0, 'não repete no próximo resumo')
  store.setStatus('on')
})

test('pausada, limite de gastos, cancelar, mover e tentar de novo', async () => {
  let limit = 0
  costs.init(tempDir(), { limit: () => limit })
  store.saveSettings({ queue: { onlyAway: false, paused: true } })
  const { runs, q } = setup()
  q.add({ projectId: 'web', prompt: 'A' })
  q.add({ projectId: 'web', prompt: 'B' })
  await sleep(50)
  assert.equal(q.state().waiting, 'Fila pausada.')
  const [a, b] = q.state().tasks
  q.move(b.id, -1)
  assert.deepEqual(
    q.state().tasks.map((t) => t.prompt),
    ['B', 'A']
  )
  q.cancel(a.id)
  limit = 1
  costs.record({ source: 'app', ai: 'claude', title: 'x', usd: 2, tokens: null })
  store.saveSettings({ queue: { paused: false } })
  await q.tick()
  assert.match(q.state().waiting ?? '', /limite diário/)
  assert.equal(runs.started.length, 0)
  costs.overrideToday()
  await q.tick()
  assert.equal(runs.started.length, 1)
  assert.equal(runs.started[0].req.content.startsWith('B'), true)
  exit(q, runs, 'run1', 0, true)
  await until(() => q.state().tasks.find((t) => t.prompt === 'B')?.status === 'cancelada')
  assert.equal(q.state().tasks.find((t) => t.prompt === 'B')?.status, 'cancelada')
  q.retry(a.id)
  await until(() => runs.started.length === 2)
  assert.equal(runs.started[1].req.content.startsWith('A'), true)
  exit(q, runs, 'run2')
  assert.equal(q.add({ projectId: 'nao-existe', prompt: 'x' }).ok, false)
  assert.equal(q.add({ projectId: 'web', prompt: '   ' }).ok, false)
})

test('tarefa de demanda vai para a branch dela (e não troca com alterações pendentes)', async () => {
  costs.init(tempDir(), { limit: () => 0 })
  store.saveSettings({ queue: { onlyAway: false, paused: false } })
  const { work, runs, demands, q } = setup()
  demands.save(normDemand({ id: 'd1', projectId: 'web', key: 'WEB-9' }))
  writeFileSync(join(work, 'sujo.txt'), 'x')
  q.add({ projectId: 'web', demandId: 'd1', prompt: 'implementa' })
  await until(() => q.state().tasks[0].status === 'falhou')
  const t = q.state().tasks[0]
  assert.equal(t.status, 'falhou')
  assert.match(t.error ?? '', /sem commit/)
  sh(work, 'clean', '-fdq')
  q.retry(t.id)
  await until(() => runs.started.length === 1)
  assert.equal(sh(work, 'branch', '--show-current'), 'WEB-9', 'criou a branch do card')
  assert.equal(runs.started.length, 1)
  assert.equal(runs.started[0].req.tab, 'demand:d1')
  assert.match(runs.started[0].req.content, /implementa/)
})
