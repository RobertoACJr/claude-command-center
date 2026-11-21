import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { baseBranch, gitBranches, gitCheckout, gitInfo, gitPull, updateWithBase } from '../src/main/git'
import { checkGuides, guidesInstruction, readGuides } from '../src/main/guides'
import { makeRepo, sh, tempDir } from './helpers'

const project = (path: string, vars: Array<{ key: string; value: string }> = []) =>
  ({ id: 'p', name: 'web', path, vars, guides: [] }) as any

test('info do card: branch, alterados, à frente/atrás, sem push e último commit', async () => {
  const { work } = makeRepo()
  const p = project(work)
  let i = await gitInfo(p)
  assert.equal(i?.branch, 'master')
  assert.equal(i?.base, 'master')
  assert.equal(i?.lastCommit?.subject, 'base')
  sh(work, 'checkout', '-q', '-b', 'WEB-1')
  writeFileSync(join(work, 'novo.txt'), 'x')
  i = await gitInfo(p)
  assert.equal(i?.changed, 1)
  assert.equal(i?.upstream, null, 'branch nunca teve push')
  assert.equal(await gitInfo(project(tempDir())), null, 'pasta sem git')
})

test('branch principal: variável branch_principal vence a do remoto', async () => {
  const { work } = makeRepo()
  assert.equal(await baseBranch(project(work)), 'master')
  assert.equal(await baseBranch(project(work, [{ key: 'branch_principal', value: 'develop' }])), 'develop')
})

test('atualizar com a master: recusa árvore suja e branch errada, traz commits, avisa conflito', async () => {
  const { work, other } = makeRepo()
  const p = project(work)
  sh(work, 'checkout', '-q', '-b', 'WEB-2')
  writeFileSync(join(work, 'feat.txt'), 'feature')
  sh(work, 'add', '.')
  sh(work, 'commit', '-q', '-m', 'feat')
  const o = other()
  writeFileSync(join(o, 'da-master.txt'), 'x')
  sh(o, 'add', '.')
  sh(o, 'commit', '-q', '-m', 'm2')
  sh(o, 'push', '-q', 'origin', 'master')

  writeFileSync(join(work, 'sujo.txt'), 'x')
  assert.match((await updateWithBase(p, 'WEB-2')).message, /sem commit/)
  sh(work, 'clean', '-fdq')
  assert.match((await updateWithBase(p, 'WEB-9')).message, /não em WEB-9/)

  const ok = await updateWithBase(p, 'WEB-2')
  assert.equal(ok.ok, true, ok.message)
  assert.ok(existsSync(join(work, 'da-master.txt')))
  assert.match((await updateWithBase(p, 'WEB-2')).message, /em dia/)

  writeFileSync(join(o, 'app.txt'), 'da master\n')
  sh(o, 'commit', '-q', '-am', 'c1')
  sh(o, 'push', '-q', 'origin', 'master')
  writeFileSync(join(work, 'app.txt'), 'da demanda\n')
  sh(work, 'commit', '-q', '-am', 'c2')
  const c = await updateWithBase(p, 'WEB-2')
  assert.equal(c.ok, false)
  assert.deepEqual(c.conflicts, ['app.txt'])
  assert.equal((await gitInfo(p))?.conflicts, 1)
  sh(work, 'merge', '--abort')
})

test('puxar só avança (fast-forward) e trocar de branch protege alterações', async () => {
  const { work, other } = makeRepo()
  const p = project(work)
  assert.match((await gitPull(p)).message, /atualizado/i)
  const o = other()
  writeFileSync(join(o, 'y.txt'), 'y')
  sh(o, 'add', '.')
  sh(o, 'commit', '-q', '-m', 'y')
  sh(o, 'push', '-q', 'origin', 'master')
  sh(work, 'fetch', '-q')
  assert.equal((await gitInfo(p))?.behind, 1)
  assert.equal((await gitPull(p)).ok, true)
  assert.ok(existsSync(join(work, 'y.txt')))

  sh(work, 'branch', 'WEB-3')
  assert.deepEqual((await gitBranches(p)).sort(), ['WEB-3', 'master'])
  assert.equal((await gitCheckout(p, 'x;rm -rf /')).ok, false, 'nome perigoso')
  writeFileSync(join(work, 'y.txt'), 'mudado')
  sh(work, 'checkout', '-q', 'WEB-3')
  sh(work, 'checkout', '-q', 'master')
  assert.equal((await gitCheckout(p, 'WEB-3')).ok, true, 'alteração que não conflita vai junto')
})

test('guias: só dentro da pasta do projeto; instrução só com os que existem', () => {
  const dir = tempDir()
  writeFileSync(join(dir, 'GUIA.md'), '# Use Tailwind')
  const p = { ...project(dir), guides: ['GUIA.md', '../fora.md', 'nao-existe.md'] }
  assert.deepEqual(checkGuides(dir, p.guides), [true, false, false])
  assert.deepEqual(
    readGuides(p).map((g) => g.content),
    ['# Use Tailwind']
  )
  assert.match(guidesInstruction(p) ?? '', /GUIA\.md/)
  assert.doesNotMatch(guidesInstruction(p) ?? '', /fora/)
  assert.equal(guidesInstruction({ ...p, guides: [] }), null)
})
