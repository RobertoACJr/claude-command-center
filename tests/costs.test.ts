import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { CostLedger, dayKey, dayStart } from '../src/main/costs'
import { tempDir } from './helpers'

test('soma o dia, respeita o limite e avisa uma vez só', () => {
  const dir = tempDir()
  let limit = 1
  const warned: number[] = []
  const l = new CostLedger()
  l.init(dir, { limit: () => limit, onLimit: (g) => warned.push(g.todayUsd) })
  l.record({ source: 'fila', ai: 'claude', title: 'a', usd: 0.4, tokens: 100 })
  assert.equal(l.allowsAutomation(), true)
  l.record({ source: 'vigia', ai: 'claude', title: 'b', usd: 0.7, tokens: null })
  const g = l.guard()
  assert.ok(Math.abs(g.todayUsd - 1.1) < 1e-9)
  assert.equal(g.over, true)
  assert.equal(l.allowsAutomation(), false)
  l.record({ source: 'vigia', ai: 'claude', title: 'c', usd: 0.1, tokens: null })
  assert.equal(warned.length, 1, 'avisa só uma vez por dia')
  // Liberar hoje
  assert.equal(l.overrideToday().overridden, true)
  assert.equal(l.allowsAutomation(), true)
  // Sem limite
  limit = 0
  assert.equal(l.guard().over, false)
})

test('Gemini/ChatGPT só com tokens não somam dólares; entrada vazia é ignorada', () => {
  const l = new CostLedger()
  l.init(tempDir(), { limit: () => 0 })
  l.record({ source: 'app', ai: 'gemini', title: 'g', usd: null, tokens: 5000 })
  l.record({ source: 'app', ai: 'codex', title: 'x', usd: null, tokens: null })
  assert.equal(l.list().length, 1)
  assert.equal(l.todayUsd(), 0)
})

test('persiste em costs.jsonl e descarta o que tem mais de 120 dias', () => {
  const dir = tempDir()
  const old = { at: Date.now() - 130 * 86_400_000, source: 'app', ai: 'claude', title: 'velho', usd: 9, tokens: null }
  writeFileSync(join(dir, 'costs.jsonl'), JSON.stringify(old) + '\nlinha quebrada\n')
  const l = new CostLedger()
  l.init(dir, { limit: () => 0 })
  assert.equal(l.list().length, 0)
  l.record({ source: 'app', ai: 'claude', title: 'novo', usd: 0.5, tokens: 10 })
  const again = new CostLedger()
  again.init(dir, { limit: () => 0 })
  assert.deepEqual(
    again.list().map((e) => e.title),
    ['novo']
  )
  assert.ok(!readFileSync(join(dir, 'costs.jsonl'), 'utf8').includes('velho'))
})

test('ontem não conta para o limite de hoje', () => {
  const l = new CostLedger()
  l.init(tempDir(), { limit: () => 1 })
  l.record({ source: 'app', ai: 'claude', title: 'ontem', usd: 5, tokens: null, at: dayStart(Date.now()) - 1000 })
  assert.equal(l.guard().over, false)
  assert.notEqual(dayKey(Date.now()), dayKey(dayStart(Date.now()) - 1000))
})
