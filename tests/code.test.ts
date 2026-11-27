import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { diffFile, diffSummary, parseDiffLists, SAFE_PATH } from '../src/main/diff'
import { parseUnified } from '../src/shared/diff'
import { customArgs } from '../src/main/editor'
import { callUrl, validCallUser } from '../src/main/callmebot'
import { suggestFromAssigned } from '../src/main/jirasuggest'
import { isImportant } from '../src/main/watcher'
import { makeRepo, sh } from './helpers'

const project = (path: string) => ({ id: 'p', name: 'web', path, vars: [], guides: [] }) as any

test('lista de arquivos do diff: status, renomeado e contagem', () => {
  const ns = 'M\tsrc/a.ts\nA\tnovo.ts\nD\tvelho.ts\nR087\tsrc/x.ts\tsrc/y.ts\n'
  const num = '3\t1\tsrc/a.ts\n10\t0\tnovo.ts\n0\t5\tvelho.ts\n1\t1\tsrc/{x.ts => y.ts}\n-\t-\timg.png\n'
  const f = parseDiffLists(ns, num)
  assert.deepEqual(
    f.map((x) => [x.status, x.path, x.add, x.del]),
    [
      ['M', 'src/a.ts', 3, 1],
      ['A', 'novo.ts', 10, 0],
      ['D', 'velho.ts', 0, 5],
      ['R', 'src/y.ts', 1, 1]
    ]
  )
  assert.equal(f[3].oldPath, 'src/x.ts')
  assert.equal(SAFE_PATH('src/a.ts'), true)
  assert.equal(SAFE_PATH('../fora'), false)
  assert.equal(SAFE_PATH('/etc/passwd'), false)
  assert.equal(SAFE_PATH('C:\\x'), false)
})

test('diff unificado vira linhas numeradas', () => {
  const t = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n'
  const l = parseUnified(t)
  assert.deepEqual(
    l.map((x) => [x.kind, x.text, x.oldNo, x.newNo]),
    [
      ['hunk', '@@ -1,3 +1,3 @@', null, null],
      ['ctx', 'a', 1, 1],
      ['del', 'b', 2, null],
      ['add', 'B', null, 2],
      ['ctx', 'c', 3, 3]
    ]
  )
})

test('mudanças de verdade num repositório: sem commit e desde a base', async () => {
  const { work } = makeRepo()
  const p = project(work)
  sh(work, 'checkout', '-q', '-b', 'WEB-1')
  writeFileSync(join(work, 'app.txt'), 'base\nmudou\n')
  sh(work, 'commit', '-qam', 'muda')
  writeFileSync(join(work, 'solto.txt'), 'oi\n')
  const local = await diffSummary(p, 'local')
  assert.equal(local.ok, true)
  assert.deepEqual(local.files.map((f) => [f.status, f.path]), [['?', 'solto.txt']])
  const fNew = await diffFile(p, local.files[0], local.ref)
  assert.match(fNew.text, /\+oi/)
  const base = await diffSummary(p, 'base')
  assert.equal(base.ok, true)
  assert.match(base.refLabel, /master/)
  assert.deepEqual(base.files.map((f) => f.path), ['app.txt', 'solto.txt'])
  const d = await diffFile(p, base.files[0], base.ref)
  assert.ok(parseUnified(d.text).some((l) => l.kind === 'add' && l.text === 'mudou'))
  const bad = await diffFile(p, { path: '../x', status: 'M' }, base.ref)
  assert.ok(bad.error)
})

test('comando próprio do editor', () => {
  assert.deepEqual(customArgs('nvim-qt {arquivo} +{linha}', '/p', '/p/a.ts', 7), ['nvim-qt', '/p/a.ts', '+7'])
  assert.deepEqual(customArgs('"C:\\Meu Editor\\ed.exe" {pasta}', 'C:\\proj'), ['C:\\Meu Editor\\ed.exe', 'C:\\proj'])
})

test('ligação: usuário válido e URL sem conteúdo extra', () => {
  assert.equal(validCallUser('@roberto_jr'), true)
  assert.equal(validCallUser('+5565999999999'), true)
  assert.equal(validCallUser('roberto'), false)
  const u = new URL(callUrl({ user: '@roberto_jr', lang: 'pt-BR-Standard-A' }, 'Pedido urgente de Ana'))
  assert.equal(u.hostname, 'api.callmebot.com')
  assert.equal(u.searchParams.get('user'), '@roberto_jr')
  assert.equal(u.searchParams.get('text'), 'Pedido urgente de Ana')
})

test('pessoas importantes: sem acento, sem maiúscula e sem pegar pedaço de nome', () => {
  assert.equal(isImportant('João Silva, Gerência', 'joao silva', ''), true)
  assert.equal(isImportant('Gerência', 'Fulano', 'Espaço da gerencia'), true)
  assert.equal(isImportant('Ana', 'Mariana Souza', ''), false)
  assert.equal(isImportant('', 'Qualquer', ''), false)
})

test('cards do Jira viram sugestão só se ainda não são demanda', () => {
  const issues = [
    { key: 'WEB-9', summary: 'Tela nova', status: 'To Do', updated: '' },
    { key: 'WEB-1', summary: 'Já é demanda', status: 'Doing', updated: '' },
    { key: 'API-3', summary: 'Endpoint', status: 'To Do', updated: '' },
    { key: 'OPS-2', summary: 'Dispensado', status: 'To Do', updated: '' }
  ]
  const demands = [
    { key: 'WEB-1', projectId: 'front' },
    { key: 'WEB-4', projectId: 'front' },
    { key: 'API-1', projectId: 'back' }
  ]
  const s = suggestFromAssigned(issues, demands, new Set(['OPS-2']), [{ id: 'front' }, { id: 'back' }])
  assert.deepEqual(
    s.map((x) => [x.key, x.projectId]),
    [
      ['WEB-9', 'front'],
      ['API-3', 'back']
    ]
  )
  // Prefixo desconhecido com um projeto só: vai para ele
  assert.equal(suggestFromAssigned([{ key: 'NEW-1', summary: '', status: '', updated: '' }], [], new Set(), [{ id: 'unico' }])[0].projectId, 'unico')
})
