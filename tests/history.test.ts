import { test } from 'node:test'
import assert from 'node:assert/strict'
import { History } from '../src/main/history'
import { tempDir } from './helpers'

test('registra início, saída, custo e resultado; grava e recarrega', () => {
  const dir = tempDir()
  const h = new History(dir, () => {})
  h.handle({ runId: 'r1', tab: 'script:x', type: 'start', title: 'Subir beta', kind: 'terminal', startedAt: 1, cwd: '/p', origin: 'telegram' })
  h.handle({ runId: 'r1', tab: 'script:x', type: 'lines', lines: [{ kind: 'stdout', text: 'ok' }, { kind: 'stderr', text: 'aviso' }] })
  assert.deepEqual(h.log('r1'), ['ok', '! aviso'], 'saída ao vivo')
  h.handle({ runId: 'r1', tab: 'script:x', type: 'usage', costUsd: 0.25, tokens: 900 })
  h.handle({ runId: 'r1', tab: 'script:x', type: 'exit', code: 1, signal: null, killed: false })
  const e = h.list()[0]
  assert.equal(e.status, 'error')
  assert.equal(e.origin, 'telegram')
  assert.equal(e.costUsd, 0.25)
  assert.equal(e.tokens, 900)
  h.flush()
  const again = new History(dir, () => {})
  assert.equal(again.list()[0].title, 'Subir beta')
  assert.deepEqual(again.log('r1'), ['ok', '! aviso'])
})

test('o que estava rodando quando o app fechou vira interrompido; limpar mantém o que roda', () => {
  const dir = tempDir()
  const h = new History(dir, () => {})
  h.handle({ runId: 'a', tab: 'console', type: 'start', title: 'A', kind: 'terminal', startedAt: 1 })
  h.handle({ runId: 'b', tab: 'console', type: 'start', title: 'B', kind: 'terminal', startedAt: 2 })
  h.handle({ runId: 'b', tab: 'console', type: 'exit', code: 0, signal: null, killed: false })
  h.flush()
  assert.equal(new History(dir, () => {}).list().find((x) => x.id === 'a')?.status, 'stopped')
  h.clear()
  assert.deepEqual(
    h.list().map((x) => x.id),
    ['a']
  )
})
