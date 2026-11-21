import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { useTempUserData } from './helpers'

const dir = useTempUserData()
writeFileSync(
  join(dir, 'config.json'),
  JSON.stringify({ projects: [{ id: 'p', name: 'web', path: '/w', guides: ['docs\\GUIA.md', 'docs/GUIA.md', '', 3] }], costs: { dailyLimitUsd: -5 } })
)
const { store } = require('../src/main/store') as typeof import('../src/main/store')

test('config antiga ganha os padrões novos e normaliza o que veio errado', () => {
  const c = store.load()
  assert.deepEqual(c.queue, { onlyAway: true, paused: false, useWorktree: true })
  assert.equal(c.costs.dailyLimitUsd, 0, 'negativo vira 0')
  assert.deepEqual(c.projects[0].guides, ['docs/GUIA.md'], 'barra do Windows, duplicado e lixo')
  assert.equal(c.telegram.forwardNotifications, true)
  assert.equal(c.general.notifyScriptDone, true)
})

test('salvar configurações mescla em vez de apagar', () => {
  store.saveSettings({ queue: { paused: true } })
  assert.deepEqual(store.get().queue, { onlyAway: true, paused: true, useWorktree: true })
  store.saveSettings({ costs: { dailyLimitUsd: 3 } })
  assert.equal(store.get().costs.dailyLimitUsd, 3)
})
