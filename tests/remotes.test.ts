import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { baseBranch, githubRepoOf, goToDemandBranch, linkedProjectsOf, remotesOf, updateWithBase } from '../src/main/git'
import { ProjectProcesses } from '../src/main/projects'
import { fakeRuns, makeRepo, sh, tempDir } from './helpers'

const project = (path: string, vars: Array<{ key: string; value: string }> = [], extra: Record<string, unknown> = {}) =>
  ({ id: 'p', name: 'web', path, vars, guides: [], linkedProjectIds: [], ...extra }) as any

/**
 * Fluxo da empresa: "empresa" tem o código de produção; o fork pessoal é o origin.
 * work = clone do fork com o remoto "empresa" adicionado.
 */
function forkSetup() {
  const company = makeRepo()
  const base = tempDir('ccc-fork-')
  const fork = join(base, 'fork.git')
  sh(base, 'clone', '-q', '--bare', company.remote, fork)
  const work = join(base, 'work')
  sh(base, 'clone', '-q', fork, work)
  sh(work, 'remote', 'add', 'empresa', company.remote)
  sh(work, 'fetch', '-q', 'empresa')
  const vars = [
    { key: 'remoto_empresa', value: 'empresa' },
    { key: 'remoto_fork', value: 'origin' }
  ]
  return { company, fork, work, p: project(work, vars) }
}

test('remotos: padrão é um só (origin); a variável antiga "remote" vale como fork; nomes inválidos são ignorados', () => {
  assert.deepEqual(remotesOf(project('/x')), { company: 'origin', fork: 'origin', split: false })
  assert.deepEqual(remotesOf(project('/x', [{ key: 'remote', value: 'meu' }])), { company: 'meu', fork: 'meu', split: false })
  assert.deepEqual(remotesOf(project('/x', [{ key: 'remoto_empresa', value: 'empresa' }])), { company: 'empresa', fork: 'origin', split: true })
  assert.equal(remotesOf(project('/x', [{ key: 'remoto_empresa', value: 'a b;rm' }])).company, 'origin')
  assert.equal(githubRepoOf('git@github.com:Empresa/app.git'), 'Empresa/app')
  assert.equal(githubRepoOf('https://github.com/eu/app'), 'eu/app')
  assert.equal(githubRepoOf('https://bitbucket.org/emp/app.git'), null)
})

test('branch do card no fluxo com fork: pergunta, cria no remoto da empresa, rastreia empresa/KEY', async () => {
  const { company, work, p } = forkSetup()
  assert.equal(await baseBranch(p), 'master')

  const ask = await goToDemandBranch(p, 'MAS-1')
  assert.equal(ask.ok, false)
  assert.equal(ask.needsCompanyBranch, true)
  assert.match(ask.message, /empresa/)

  const made = await goToDemandBranch(p, 'MAS-1', { createOnCompany: true })
  assert.equal(made.ok, true, made.message)
  assert.equal(sh(work, 'rev-parse', '--abbrev-ref', 'HEAD'), 'MAS-1')
  assert.equal(sh(work, 'rev-parse', '--abbrev-ref', 'MAS-1@{upstream}'), 'empresa/MAS-1')
  assert.ok(sh(company.remote, 'branch', '--list', 'MAS-1').includes('MAS-1'), 'a branch nasceu no remoto da empresa')

  // Um colega cria MAS-2 na empresa com um commit: o app só busca e cria a local a partir dela
  const o = company.other()
  sh(o, 'checkout', '-q', '-b', 'MAS-2')
  writeFileSync(join(o, 'mas2.txt'), 'x')
  sh(o, 'add', '.')
  sh(o, 'commit', '-q', '-m', 'mas2')
  sh(o, 'push', '-q', 'origin', 'MAS-2')
  const r2 = await goToDemandBranch(p, 'MAS-2')
  assert.equal(r2.ok, true, r2.message)
  assert.match(r2.message, /empresa\/MAS-2/)
  assert.ok(existsSync(join(work, 'mas2.txt')))

  // Já existe local: só troca
  const back = await goToDemandBranch(p, 'MAS-1')
  assert.match(back.message, /já existia/)

  // Só local, a partir de uma base escolhida
  const local = await goToDemandBranch(p, 'MAS-3', { base: 'master' })
  assert.equal(local.ok, true, local.message)
  assert.match(local.message, /só local/)

  // Projeto ligado: nunca cria nada
  const skip = await goToDemandBranch(p, 'MAS-9', { onlyExisting: true })
  assert.equal(skip.ok, true)
  assert.equal(skip.skipped, true)
  assert.equal(sh(work, 'branch', '--list', 'MAS-9'), '')
})

test('atualizar no fluxo com fork: traz o que entrou em empresa/KEY e na empresa/master', async () => {
  const { company, work, p } = forkSetup()
  assert.equal((await goToDemandBranch(p, 'MAS-5', { createOnCompany: true })).ok, true)
  sh(work, 'push', '-q', '-u', 'origin', 'MAS-5')
  const o = company.other()
  sh(o, 'fetch', '-q')
  sh(o, 'checkout', '-q', 'MAS-5')
  writeFileSync(join(o, 'do-pr.txt'), 'x')
  sh(o, 'add', '.')
  sh(o, 'commit', '-q', '-m', 'pr aceito')
  sh(o, 'push', '-q', 'origin', 'MAS-5')
  sh(o, 'checkout', '-q', 'master')
  writeFileSync(join(o, 'da-master.txt'), 'x')
  sh(o, 'add', '.')
  sh(o, 'commit', '-q', '-m', 'master nova')
  sh(o, 'push', '-q', 'origin', 'master')

  const r = await updateWithBase(p, 'MAS-5')
  assert.equal(r.ok, true, r.message)
  assert.match(r.message, /empresa\/MAS-5/)
  assert.match(r.message, /empresa\/master/)
  assert.ok(existsSync(join(work, 'do-pr.txt')))
  assert.ok(existsSync(join(work, 'da-master.txt')))
  assert.match((await updateWithBase(p, 'MAS-5')).message, /em dia/)
})

test('projetos ligados: valem nos dois sentidos', () => {
  const front = { id: 'f', linkedProjectIds: ['b'] } as any
  const back = { id: 'b', linkedProjectIds: [] } as any
  const other = { id: 'o', linkedProjectIds: [] } as any
  const all = [front, back, other]
  assert.deepEqual(linkedProjectsOf(front, all).map((x) => x.id), ['b'])
  assert.deepEqual(linkedProjectsOf(back, all).map((x) => x.id), ['f'])
  assert.deepEqual(linkedProjectsOf(other, all), [])
})

test('executar só este ou o grupo; parar só este ou os dois; comando de parar', async () => {
  const runs = fakeRuns()
  const pp = new ProjectProcesses(runs as any, () => {})
  const dir = tempDir()
  mkdirSync(join(dir, 'f'))
  mkdirSync(join(dir, 'b'))
  const marker = join(dir, 'b', 'parou.txt')
  const stopCmd = process.platform === 'win32' ? `Set-Content -Path '${marker}' -Value ok` : `echo ok > '${marker}'`
  const front = { ...project(join(dir, 'f')), id: 'f', name: 'front', runCommand: 'npm run dev', port: null, linkedProjectIds: ['b'], stopCommand: '', stopTimeoutSec: 5, healthUrl: '' }
  const back = { ...project(join(dir, 'b')), id: 'b', name: 'back', runCommand: 'docker compose up', port: null, stopCommand: stopCmd, stopTimeoutSec: 5, healthUrl: '' }
  pp.sync({ projects: [front, back] } as any)
  pp.stopPolling()
  try {
    // Só este: o back não sobe
    assert.equal((await pp.start('f')).ok, true)
    assert.deepEqual(runs.started.map((s) => s.req.tab), ['project:f'])
    await pp.stop('f')

    // Os dois: o back sobe antes
    runs.reset()
    runs.started.length = 0
    runs.stopped.length = 0
    const r = await pp.start('f', true)
    assert.match(r.message, /junto com back/)
    assert.deepEqual(runs.started.map((s) => s.req.tab), ['project:b', 'project:f'], 'o back sobe antes')

    // Reiniciar só o front não mexe no back
    await pp.restart('f')
    assert.equal(runs.stopped.length, 1)

    // Parar só o front: o back continua
    await pp.stop('f')
    assert.equal(runs.stopped.length, 2)
    assert.ok(!existsSync(marker))

    // Parar os dois: o back para e roda o comando de parar dele
    const st = await pp.stop('f', true)
    assert.equal(st.ok, true, st.message)
    assert.ok(runs.stopped.includes('run1'), 'parou o back')
    assert.ok(existsSync(marker), 'rodou o comando de parar do back')
  } finally {
    pp.stopPolling()
  }
})

test('Ausente: para os marcados (menos os da fila) e religa na volta', async () => {
  const runs = fakeRuns()
  const pp = new ProjectProcesses(runs as any, () => {})
  const dir = tempDir()
  const mk = (id: string, awayStop: boolean) => ({ ...project(dir), id, name: id, runCommand: 'x', port: null, awayStop, stopCommand: '', stopTimeoutSec: 5, healthUrl: '' })
  pp.sync({ projects: [mk('a', true), mk('b', true), mk('c', false)] } as any)
  pp.stopPolling()
  try {
    for (const id of ['a', 'b', 'c']) await pp.start(id)
    const stopped = await pp.stopForAway(new Set(['b']))
    assert.deepEqual(stopped, ['a'], 'b está na fila e c não é marcado')
    runs.started.length = 0
    const back = await pp.restoreAfterAway()
    assert.deepEqual(back, ['a'])
    assert.deepEqual(runs.started.map((s) => s.req.tab), ['project:a'])
  } finally {
    pp.stopPolling()
  }
})

test('sincronizar com o remoto da empresa: branch de mesmo nome e principal', async () => {
  const { syncWithRemote } = await import('../src/main/git')
  const { company, work, p } = forkSetup()
  assert.equal((await goToDemandBranch(p, 'MAS-7', { createOnCompany: true })).ok, true)
  const o = company.other()
  sh(o, 'fetch', '-q')
  sh(o, 'checkout', '-q', 'MAS-7')
  writeFileSync(join(o, 'colega.txt'), 'x')
  sh(o, 'add', '.')
  sh(o, 'commit', '-q', '-m', 'colega')
  sh(o, 'push', '-q', 'origin', 'MAS-7')
  sh(o, 'checkout', '-q', 'master')
  writeFileSync(join(o, 'prod.txt'), 'x')
  sh(o, 'add', '.')
  sh(o, 'commit', '-q', '-m', 'prod')
  sh(o, 'push', '-q', 'origin', 'master')

  const b = await syncWithRemote(p, 'branch')
  assert.equal(b.ok, true, b.message)
  assert.ok(existsSync(join(work, 'colega.txt')))
  assert.ok(!existsSync(join(work, 'prod.txt')), 'a principal ainda não veio')
  const m = await syncWithRemote(p, 'main')
  assert.equal(m.ok, true, m.message)
  assert.ok(existsSync(join(work, 'prod.txt')))
  assert.match((await syncWithRemote(p, 'main')).message, /em dia/)

  // Branch que não existe na empresa: não faz nada
  sh(work, 'checkout', '-q', '-b', 'so-local')
  const s = await syncWithRemote(p, 'branch')
  assert.equal(s.skipped, true)

  // Com alteração pendente: recusa
  writeFileSync(join(work, 'sujo.txt'), 'x')
  assert.equal((await syncWithRemote(p, 'main')).ok, false)
})
