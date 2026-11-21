import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { fakeRuns, listen, makeRepo, readBody, sh, tempDir, useTempUserData } from './helpers'

useTempUserData()
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { store } = require('../src/main/store') as typeof import('../src/main/store')
const { secrets } = require('../src/main/secrets') as typeof import('../src/main/secrets')
const { DemandManager, extractHours, extractResult, normDemand, demandContext } = require('../src/main/demands') as typeof import('../src/main/demands')

const exit = (m: any, runId: string, code = 0) => m.handleRunEvent({ runId, tab: 'demand:x', type: 'exit', code, signal: null, killed: false })
const say = (m: any, runId: string, ...text: string[]) =>
  m.handleRunEvent({ runId, tab: 'demand:x', type: 'lines', lines: text.map((t) => ({ kind: 'claude', text: t })) })

test('extrai o documento entre os marcadores e as horas', () => {
  assert.equal(extractResult('lendo...\n<<<RESULTADO\n## A\nb\nRESULTADO>>>\nfim'), '## A\nb')
  assert.equal(extractResult('sem marcador'), 'sem marcador')
  assert.equal(extractHours('ESTIMATIVA_HORAS: 12,5'), 12.5)
  assert.equal(extractHours('nada'), null)
  const d = normDemand({ key: ' web-1 ', status: 'xx' as any, ai: 'outra' as any })
  assert.equal(d.key, 'WEB-1')
  assert.equal(d.status, 'nova')
  assert.equal(d.ai, 'claude')
  assert.equal(d.reviewAi, 'claude')
})

test('fluxo: Jira → análise → desenho → implementação contínua → branch → revisão', async () => {
  // Jira falso
  let auth = ''
  const jira = await listen(async (req, res) => {
    auth = String(req.headers.authorization)
    await readBody(req)
    if (!req.url?.includes('WEB-482')) {
      res.statusCode = 404
      return res.end('{}')
    }
    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify({
        fields: {
          summary: 'Filtro por data',
          status: { name: 'To Do' },
          issuetype: { name: 'Story' },
          priority: { name: 'High' },
          description: 'h2. Objetivo\nfiltrar [aqui|https://x]\n{code}a=1{code}',
          comment: { comments: [{ author: { displayName: 'Ana' }, created: '2026-11-18T10:00', body: 'atalho 7 dias' }] },
          attachment: [{ filename: 'mock.png' }]
        }
      })
    )
  })
  const { work } = makeRepo()
  const api = tempDir()
  writeFileSync(join(work, 'GUIA.md'), 'Use Tailwind')
  store.saveSettings({ integrations: { jira: { enabled: false, url: jira.url, email: 'eu@x.com' } } })
  secrets.set('jira.token', 'tok')
  store.saveProject({ id: 'web', name: 'proj-web', path: work, vars: [], guides: ['GUIA.md'] } as any)
  store.saveProject({ id: 'api', name: 'proj-api', path: api, vars: [], guides: [] } as any)

  const runs = fakeRuns()
  const m = new DemandManager(tempDir(), runs as any, () => {})
  m.save(normDemand({ id: 'd1', projectId: 'web', key: 'WEB-482', refProjectIds: ['api'] }))

  const j = await m.fetchJira('d1')
  assert.equal(j.ok, true, j.message)
  assert.equal(auth, 'Basic ' + Buffer.from('eu@x.com:tok').toString('base64'))
  const d = m.get('d1')!
  assert.equal(d.title, 'Filtro por data')
  assert.match(d.jira!.description, /## Objetivo/)
  assert.match(d.jira!.description, /aqui \(https:\/\/x\)/)
  const ctx = demandContext(d, store.get().projects[0], [store.get().projects[1]])
  assert.match(ctx, /Use Tailwind/, 'leva o guia')
  assert.match(ctx, /proj-api/, 'cita o projeto de consulta')

  // Análise: só leitura, com a API como pasta extra
  assert.equal(m.analyze('d1', 'analysis').ok, true)
  assert.equal(m.analyze('d1', 'design').ok, false, 'uma tarefa por vez')
  const a = runs.started[0]
  assert.equal(a.req.readOnly, true)
  assert.deepEqual(a.req.addDirs, [api])
  // O usuário salva enquanto a IA trabalha: não apaga o resultado
  say(m, a.id, 'vou ler', '<<<RESULTADO', '## Entendimento', 'filtrar', 'ESTIMATIVA_HORAS: 6', 'RESULTADO>>>')
  m.save({ ...m.get('d1')!, context: 'urgente', analysis: '' })
  exit(m, a.id)
  assert.equal(m.get('d1')!.analysis, '## Entendimento\nfiltrar')
  assert.equal(m.get('d1')!.aiHours, 6)
  assert.equal(m.get('d1')!.status, 'estimada')
  assert.equal(m.get('d1')!.context, 'urgente')

  // Desenho
  m.save({ ...m.get('d1')!, hours: 8 })
  m.analyze('d1', 'design')
  const ds = runs.started[1]
  assert.match(ds.req.content, /Análise anterior/)
  assert.match(ds.req.content, /8h/)
  say(m, ds.id, '<<<RESULTADO', '- [ ] criar filtro', 'RESULTADO>>>')
  exit(m, ds.id)
  assert.equal(m.get('d1')!.design, '- [ ] criar filtro')

  // Implementação: 1ª leva o contexto, a 2ª continua a conversa
  m.save({ ...m.get('d1')!, designApproved: true })
  const i1 = m.implement('d1', '')
  assert.equal(i1.ok, true)
  assert.match(runs.started[2].req.content, /Desenho aprovado/)
  m.handleRunEvent({ runId: i1.runId!, tab: 'demand:d1', type: 'session', sessionId: 's-1' })
  exit(m, i1.runId!)
  const i2 = m.implement('d1', 'ajusta o botão')
  assert.equal(runs.started[3].req.content, 'ajusta o botão')
  assert.equal(runs.started[3].req.resumeSessionId, 's-1')
  exit(m, i2.runId!)

  // Branch com o nome do card
  const b = await m.branch('d1', 'master')
  assert.equal(b.ok, true, b.message)
  assert.equal(sh(work, 'branch', '--show-current'), 'WEB-482')
  assert.equal((await m.branch('d1', 'x;rm')).ok, false)

  // Revisão dupla: ChatGPT → Claude, com o diff da branch
  writeFileSync(join(work, 'filtro.ts'), 'export const f = 1\n')
  sh(work, 'add', '.')
  sh(work, 'commit', '-q', '-m', 'filtro')
  m.save({ ...m.get('d1')!, reviewAi: 'dupla' })
  const r = await m.review('d1')
  assert.equal(r.ok, true, r.message)
  const r1 = runs.started[4]
  assert.equal(r1.req.kind, 'codex')
  assert.match(r1.req.content, /filtro\.ts/)
  say(m, r1.id, '<<<RESULTADO', '## Problemas', '- [média] filtro.ts:1', 'RESULTADO>>>')
  exit(m, r1.id)
  const r2 = runs.started[5]
  assert.equal(r2.req.kind, 'claude')
  assert.match(r2.req.content, /Primeira revisão/)
  say(m, r2.id, '<<<RESULTADO', '## Veredito', 'Pronto para PR', 'RESULTADO>>>')
  exit(m, r2.id)
  const rv = m.get('d1')!.review!
  assert.equal(rv.text, '## Veredito\nPronto para PR')
  assert.equal(rv.ai, 'dupla')
  assert.match(rv.scope, /1 commit/)

  // Card inexistente
  m.save(normDemand({ id: 'd2', projectId: 'web', key: 'WEB-1' }))
  assert.match((await m.fetchJira('d2')).message, /não encontrado/)
  jira.server.close()
})

test('revisão sem diferença avisa que não há o que revisar', async () => {
  const { work } = makeRepo()
  store.saveProject({ id: 'w2', name: 'w2', path: work, vars: [], guides: [] } as any)
  sh(work, 'branch', 'WEB-7')
  const m = new DemandManager(tempDir(), fakeRuns() as any, () => {})
  m.save(normDemand({ id: 'x', projectId: 'w2', key: 'WEB-7' }))
  assert.match((await m.review('x')).message, /Nada para revisar/)
  m.save(normDemand({ id: 'y', projectId: 'w2', key: 'WEB-8' }))
  assert.match((await m.review('y')).message, /ainda não existe/)
})
