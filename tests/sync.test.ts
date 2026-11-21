import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync } from 'fs'
import { join } from 'path'
import { sh, tempDir, useTempUserData } from './helpers'

useTempUserData()
const { merge3List, mergeDemands, SyncManager } = require('../src/main/sync') as typeof import('../src/main/sync')
const { normDemand } = require('../src/main/demands') as typeof import('../src/main/demands')

const it = (id: string, v: string) => ({ id, v })

test('mescla de listas: muda de um lado ganha; apagar respeita o outro lado', () => {
  const base = [it('a', '1'), it('b', '1'), it('c', '1')]
  const local = [it('a', '2'), it('b', '1'), it('n', 'novo-aqui')] // mudou a, apagou c, criou n
  const remote = [it('a', '1'), it('b', '3'), it('c', '1'), it('r', 'novo-la')] // mudou b, criou r
  const out = merge3List(base, local, remote)
  assert.deepEqual(
    out.map((x) => `${x.id}${x.v}`).sort(),
    ['a2', 'b3', 'nnovo-aqui', 'rnovo-la']
  )
  // Primeira sincronização (sem base): o repositório ganha nos conflitos
  assert.deepEqual(merge3List(undefined, [it('a', 'local')], [it('a', 'repo')]), [it('a', 'repo')])
})

test('demandas: a mais nova ganha; apagada de um lado some se o outro não mexeu', () => {
  const d = (id: string, updatedAt: number) => normDemand({ id, key: 'W-1', updatedAt, createdAt: 1 })
  const out = mergeDemands({ x: 10, y: 10 }, [d('x', 20), d('y', 10)], [d('x', 15), d('z', 5)])
  assert.deepEqual(
    out.map((x) => `${x.id}${x.updatedAt}`).sort(),
    ['x20', 'z5']
  )
})

/** Um "PC" de mentira: configuração e demandas em memória */
function pc(name: string, remote: string) {
  const ud = tempDir(`ccc-${name}-`)
  let cfg: any = {
    projects: [],
    scripts: [],
    replies: [],
    rules: [],
    general: { closeToTray: true },
    integrations: { lastApplied: {} },
    telegram: { chatId: '' },
    watcher: { seen: [] },
    ai: {},
    claudeGlobal: {},
    queue: { onlyAway: true },
    costs: { dailyLimitUsd: 0 },
    sync: { enabled: true, repoUrl: remote }
  }
  let demands: any[] = []
  const m = new SyncManager(ud, {
    config: () => cfg,
    applyConfig: (merged, paths) => {
      const local = new Map(cfg.projects.map((p: any) => [p.id, p.path]))
      cfg = { ...cfg, ...merged, projects: (merged.projects as any[]).map((p) => ({ ...p, path: local.get(p.id) || paths[p.id] || '' })) }
    },
    demands: () => demands,
    applyDemands: (l) => (demands = l),
    onChange: () => {},
    machine: name
  })
  return {
    m,
    get cfg() {
      return cfg
    },
    set cfg(v) {
      cfg = v
    },
    get demands() {
      return demands
    },
    set demands(v) {
      demands = v
    }
  }
}

test('dois PCs pelo mesmo repositório: projetos sem a pasta, demandas e apagamentos', async () => {
  const remote = join(tempDir(), 'sync.git')
  mkdirSync(remote)
  sh(remote, 'init', '-q', '--bare', '-b', 'main')
  const ubuntu = pc('ubuntu', remote)
  const windows = pc('windows', remote)

  ubuntu.cfg.projects = [{ id: 'p1', name: 'web', path: '/home/roberto/web', vars: [] }]
  ubuntu.cfg.scripts = [{ id: 's1', name: 'Subir beta' }]
  ubuntu.cfg.costs = { dailyLimitUsd: 5 }
  ubuntu.demands = [normDemand({ id: 'd1', projectId: 'p1', key: 'WEB-1', updatedAt: 100 })]
  const r1 = await ubuntu.m.sync()
  assert.equal(r1.ok, true, r1.message)

  const r2 = await windows.m.sync()
  assert.equal(r2.ok, true, r2.message)
  assert.equal(windows.cfg.projects[0].name, 'web')
  assert.equal(windows.cfg.projects[0].path, '', 'a pasta do Ubuntu não vem')
  assert.match(r2.message, /Defina neste PC a pasta de: web/)
  assert.equal(windows.cfg.costs.dailyLimitUsd, 5, 'preferências vêm na primeira vez')
  assert.equal(windows.demands[0].key, 'WEB-1')

  // Windows define a pasta dele, cria um script e apaga outro; Ubuntu muda a demanda
  windows.cfg.projects = [{ ...windows.cfg.projects[0], path: 'C:\\\\dev\\\\web' }]
  windows.cfg.scripts = [{ id: 's2', name: 'Testes' }]
  assert.equal((await windows.m.sync()).ok, true)
  ubuntu.demands = [{ ...ubuntu.demands[0], title: 'Filtro', updatedAt: 200 }]
  const r3 = await ubuntu.m.sync()
  assert.equal(r3.ok, true, r3.message)
  assert.deepEqual(
    ubuntu.cfg.scripts.map((s: any) => s.id),
    ['s2'],
    'apagou s1 e trouxe s2'
  )
  assert.equal(ubuntu.cfg.projects[0].path, '/home/roberto/web', 'cada PC mantém a sua pasta')
  assert.equal((await windows.m.sync()).ok, true)
  assert.equal(windows.demands[0].title, 'Filtro')
  assert.equal(windows.cfg.projects[0].path, 'C:\\\\dev\\\\web')
  assert.match((await windows.m.sync()).message, /Já estava em dia/)
})
