import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  envMatches,
  extractUserVariables,
  extractVariables,
  fillVariables,
  findRule,
  isProdEnv,
  matchProject,
  missingProjectKeys,
  projectValues
} from '../src/shared/vars'

const proj = (name: string, vars: Array<[string, string]> = []) =>
  ({ id: name, name, path: `/p/${name}`, vars: vars.map(([key, value]) => ({ key, value })) }) as any

test('extrai variáveis únicas na ordem, separando as do projeto', () => {
  const t = 'git push {{projeto.remote}} {{card}} && echo {{ card }} {{ambiente}}'
  assert.deepEqual(extractVariables(t), ['projeto.remote', 'card', 'ambiente'])
  assert.deepEqual(extractUserVariables(t), ['card', 'ambiente'])
})

test('preenche variáveis; as que faltam viram vazio', () => {
  assert.equal(fillVariables('a {{x}} b {{y}}', { x: '1' }), 'a 1 b ')
})

test('valores do projeto incluem nome e pasta, e acusa chaves que faltam', () => {
  const p = proj('web', [['remote', 'origin']])
  assert.equal(projectValues(p)['projeto.nome'], 'web')
  assert.equal(projectValues(p)['projeto.pasta'], '/p/web')
  assert.deepEqual(missingProjectKeys('{{projeto.remote}} {{projeto.beta}}', p), ['beta'])
})

test('trava de produção reconhece os nomes comuns e não pega beta/homolog', () => {
  for (const e of ['prod', 'Produção', 'production', 'PRD', 'live', 'main', 'master']) assert.ok(isProdEnv(e), e)
  for (const e of ['beta', 'homolog', 'staging', 'dev', 'qa']) assert.ok(!isProdEnv(e), e)
})

test('associa o projeto pelo nome ou apelido, sem acento e sem diferenciar maiúsculas', () => {
  const ps = [proj('Loja Web', [['apelidos', 'front, site']]), proj('Loja API')]
  assert.equal(matchProject('loja-web', ps)?.name, 'Loja Web')
  assert.equal(matchProject('Front', ps)?.name, 'Loja Web')
  assert.equal(matchProject('api da loja', ps), undefined)
  assert.equal(matchProject('', ps), undefined)
})

test('regras: ambiente, curinga e projeto', () => {
  const r = { id: 'r', enabled: true, environments: 'beta, hml', projectId: '' } as any
  assert.ok(envMatches(r, 'beta'))
  assert.ok(envMatches(r, 'beta-2'))
  assert.ok(!envMatches(r, 'prod'))
  assert.ok(envMatches({ ...r, environments: '*' }, 'qualquer'))
  const alert = { environment: 'beta', projectId: 'p1' } as any
  assert.equal(findRule(alert, [{ ...r, enabled: false }, { ...r, id: 'ok', projectId: 'p1' }])?.id, 'ok')
  assert.equal(findRule(alert, [{ ...r, projectId: 'p2' }]), undefined)
})
