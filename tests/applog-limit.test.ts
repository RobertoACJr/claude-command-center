import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { AppLogs } from '../src/main/applog'
import { fakeRuns, tempDir } from './helpers'

test('logs da aplicação: no máximo 3 abertos à mão (o de alerta não conta) e alerta com intervalo', () => {
  const runs = fakeRuns()
  const dir = tempDir()
  writeFileSync(join(dir, 'a.log'), 'x\n')
  const mk = (id: string, logAlerts = false) =>
    ({ id, name: id, path: dir, dockerCommand: 'docker compose', logAlerts, logSource: { kind: 'file', service: '', path: 'a.log', command: '' } }) as any
  const ps: Record<string, any> = { a: mk('a'), b: mk('b'), c: mk('c'), d: mk('d'), z: mk('z', true) }
  const alerts: string[] = []
  const logs = new AppLogs(runs as any, (id) => ps[id], (p, line) => alerts.push(`${p.id}:${line}`))
  for (const id of ['z', 'a', 'b', 'c', 'd']) assert.equal(logs.start(id).ok, true)
  assert.equal(logs.isOpen('a'), false, 'o mais antigo fechou')
  assert.ok(['b', 'c', 'd', 'z'].every((id) => logs.isOpen(id)))

  logs.handleRunEvent({ runId: 'r', tab: 'applog:z', type: 'lines', lines: [{ kind: 'out', text: '[x] local.ERROR: boom' }] } as any)
  logs.handleRunEvent({ runId: 'r', tab: 'applog:z', type: 'lines', lines: [{ kind: 'out', text: '[x] local.ERROR: de novo' }] } as any)
  logs.handleRunEvent({ runId: 'r', tab: 'applog:b', type: 'lines', lines: [{ kind: 'out', text: '[x] local.ERROR: sem alerta' }] } as any)
  assert.deepEqual(alerts, ['z:[x] local.ERROR: boom'], 'um aviso por minuto, só de quem tem alerta')
})
