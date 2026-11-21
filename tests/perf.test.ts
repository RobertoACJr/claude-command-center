import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { fakeRuns, makeRepo, sh, tempDir, until, useTempUserData } from './helpers'

useTempUserData()
const { store } = require('../src/main/store') as typeof import('../src/main/store')
const { DemandManager, normDemand } = require('../src/main/demands') as typeof import('../src/main/demands')
const { commitAll, ensureWorktree, dirSize } = require('../src/main/git') as typeof import('../src/main/git')
const { ShotManager } = require('../src/main/shots') as typeof import('../src/main/shots')
const { writeFileAtomic } = require('../src/main/fsutil') as typeof import('../src/main/fsutil')
const { listen } = require('./helpers') as typeof import('./helpers')

test('gravação segura: não deixa temporário e troca o conteúdo inteiro', () => {
  const dir = tempDir()
  const f = join(dir, 'a.json')
  writeFileAtomic(f, '{"v":1}')
  writeFileAtomic(f, '{"v":2}')
  assert.equal(readFileSync(f, 'utf8'), '{"v":2}')
  assert.deepEqual(readdirSync(dir), ['a.json'])
})

test('demandas: um arquivo por demanda, migra o arquivo antigo e avisa só o que mudou', () => {
  const base = tempDir()
  writeFileSync(join(base, 'demands.json'), JSON.stringify([normDemand({ id: 'a', key: 'W-1', createdAt: 1 }), normDemand({ id: 'b', key: 'W-2', createdAt: 2 })]))
  const changes: any[] = []
  const m = new DemandManager(base, fakeRuns() as any, (_l, _b, c) => changes.push(c))
  assert.deepEqual(
    m.all().map((d) => d.key),
    ['W-1', 'W-2']
  )
  assert.ok(existsSync(join(base, 'demands.json.migrado')))
  assert.deepEqual(readdirSync(join(base, 'demands')).sort(), ['a.json', 'b.json'])
  m.save({ ...m.get('a')!, title: 'novo' })
  assert.equal(changes.at(-1).upsert.id, 'a', 'só a demanda que mudou')
  assert.equal(JSON.parse(readFileSync(join(base, 'demands', 'a.json'), 'utf8')).title, 'novo')
  m.delete('b')
  assert.deepEqual(changes.at(-1), { removed: 'b' })
  assert.deepEqual(readdirSync(join(base, 'demands')), ['a.json'])
  // Arquivo corrompido não derruba os outros
  writeFileSync(join(base, 'demands', 'zz.json'), '{quebrado')
  const again = new DemandManager(base, fakeRuns() as any, () => {})
  assert.deepEqual(
    again.all().map((d) => d.id),
    ['a']
  )
})

test('cópia da fila usa o node_modules do projeto, sem ir para o commit; avisa se o lock mudou', async () => {
  const { work } = makeRepo()
  writeFileSync(join(work, '.gitignore'), 'node_modules/\n')
  writeFileSync(join(work, 'package-lock.json'), '{"v":1}')
  sh(work, 'add', '.')
  sh(work, 'commit', '-q', '-m', 'lock')
  mkdirSync(join(work, 'node_modules', 'lib'), { recursive: true })
  writeFileSync(join(work, 'node_modules', 'lib', 'index.js'), 'module.exports = 1')
  sh(work, 'branch', 'WEB-5')
  const p = { id: 'p', name: 'w', path: work, vars: [] } as any
  const dir = join(tempDir(), 'copia')
  const r = await ensureWorktree(p, 'WEB-5', dir)
  assert.equal(r.ok, true, r.message)
  assert.ok(lstatSync(join(dir, 'node_modules')).isSymbolicLink(), 'atalho para o node_modules do projeto')
  assert.ok(existsSync(join(dir, 'node_modules', 'lib', 'index.js')))
  assert.equal(r.warn, undefined)
  writeFileSync(join(dir, 'novo.ts'), 'x')
  assert.equal(await commitAll(dir, 'teste'), true)
  assert.doesNotMatch(sh(dir, 'show', '--name-only', '--format=', 'HEAD'), /node_modules/, 'o atalho nunca vai no commit')
  assert.ok(dirSize(dir) < 10_000, 'tamanho não conta o node_modules emprestado')
  // Lock diferente na cópia → aviso
  writeFileSync(join(dir, 'package-lock.json'), '{"v":2}')
  sh(dir, 'commit', '-q', '-am', 'lock novo')
  const again = await ensureWorktree(p, 'WEB-5', dir)
  assert.match(again.warn ?? '', /dependências desta demanda mudaram \(package-lock\.json\)/)
})

test('demanda Feita apaga a cópia da fila quando o trabalho já está na branch', async () => {
  const { work } = makeRepo()
  store.saveProject({ id: 'w', name: 'web', path: work, vars: [], guides: [] } as any)
  sh(work, 'branch', 'WEB-6')
  const m = new DemandManager(tempDir(), fakeRuns() as any, () => {})
  m.save(normDemand({ id: 'd', projectId: 'w', key: 'WEB-6' }))
  const dir = m.queueCopyDir(m.get('d')!)
  await ensureWorktree(store.get().projects.find((x) => x.id === 'w')!, 'WEB-6', dir)
  writeFileSync(join(dir, 'f.ts'), 'x')
  await commitAll(dir, 'trabalho')
  m.save({ ...m.get('d')!, status: 'feita' })
  await new Promise((r) => setTimeout(r, 1500))
  assert.ok(existsSync(dir), 'tem commit que não foi trazido: não apaga')
  assert.equal((await m.bringQueue('d')).ok, true)
  m.save({ ...m.get('d')!, status: 'teste' })
  m.save({ ...m.get('d')!, status: 'feita' })
  await until(() => !existsSync(dir), 10_000)
})

test('prints: miniatura leve e limite por espaço', async () => {
  const site = await listen((_q, res) => res.end('ok'))
  const big = Buffer.alloc(400_000, 1)
  const m = new ShotManager(tempDir(), async () => ({ png: big, errors: [] }), () => {}, () => Buffer.from('jpeg'), 1_000_000)
  const p = { id: 'p', name: 'w', path: '/', kind: 'front', localUrl: site.url, routes: ['/'], mobileShots: false } as any
  const first = await m.take(p, { label: '1' })
  const item = first.sets![0].items[0]
  assert.ok(item.thumb?.endsWith('.thumb.jpg'))
  assert.equal(m.image(item.thumb!)?.startsWith('data:image/jpeg'), true)
  await m.take(p, { label: '2' })
  await m.take(p, { label: '3' })
  const left = m.list({ projectId: 'p' }).map((s) => s.label)
  assert.deepEqual(left, ['2', '3'], 'passou de 1 MB: a mais antiga saiu')
  assert.equal(existsSync(item.file!), false, 'arquivos da antiga apagados')
  site.server.close()
})
