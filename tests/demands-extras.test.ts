import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useTempUserData } from './helpers'

useTempUserData()
const { buildPrDraft, businessDays, demandTiming, normDemand } = require('../src/main/demands') as typeof import('../src/main/demands')
const { buildDaily, previousWorkday } = require('../src/main/daily') as typeof import('../src/main/daily')

const at = (s: string) => new Date(s).getTime()

test('PR montado do card, desenho e revisão', () => {
  const d = normDemand({
    key: 'WEB-1',
    title: 'Filtro por data',
    jira: { url: 'https://x.atlassian.net/browse/WEB-1' } as any,
    design: '## Objetivo\nFiltrar pedidos.\n## Desenho da solução\nNovo componente.\n## Como testar\n- abrir /pedidos',
    review: { text: '## Problemas\nnenhum\n## Veredito\nPronto para PR' } as any
  })
  const pr = buildPrDraft(d, 'master')
  assert.equal(pr.title, 'WEB-1: Filtro por data')
  assert.equal(pr.base, 'master')
  assert.match(pr.body, /\[WEB-1\]\(https:\/\/x\.atlassian\.net\/browse\/WEB-1\)/)
  assert.match(pr.body, /## O que muda\nFiltrar pedidos\./)
  assert.match(pr.body, /## Como testar\n- abrir \/pedidos/)
  assert.match(pr.body, /Pronto para PR/)
  assert.doesNotMatch(pr.body, /Problemas/)
})

test('dias úteis pulam fim de semana', () => {
  // sexta 12h → segunda 12h = meia sexta + meia segunda
  assert.equal(businessDays(at('2026-11-20T12:00:00'), at('2026-11-23T12:00:00')), 1)
  assert.equal(businessDays(at('2026-11-21T08:00:00'), at('2026-11-22T20:00:00')), 0, 'só fim de semana')
  const d = normDemand({ key: 'WEB-2', hours: 16, status: 'feita' as any, statusLog: [
    { at: at('2026-11-16T09:00:00'), status: 'dev' },
    { at: at('2026-11-18T09:00:00'), status: 'feita' }
  ] as any })
  const t = demandTiming(d)
  assert.equal(t.realDays, 2)
  assert.equal(t.done, true)
  assert.equal(demandTiming(normDemand({ key: 'X-1' })).realDays, null, 'não começou')
})

test('daily: ontem (ou sexta), hoje e impedimentos', () => {
  const mon = at('2026-11-23T09:00:00')
  assert.equal(previousWorkday(mon).label, 'sexta')
  const fri = at('2026-11-20T15:00:00')
  const d = normDemand({
    id: 'd1',
    key: 'WEB-1',
    title: 'Filtro',
    status: 'dev' as any,
    hours: 8,
    statusLog: [{ at: fri, status: 'dev' }] as any,
    timeline: [
      { at: fri, text: 'Análise pronta · sugestão: 6h' },
      { at: fri + 1000, text: 'Implementação começou com o Claude' },
      { at: fri + 2000, text: 'PR aberto: https://x' }
    ],
    review: { text: '## Veredito\nPrecisa de ajustes' } as any
  })
  const text = buildDaily({
    now: mon,
    demands: [d],
    history: [{ id: 'h', tab: 'script:s', title: 'Subir card em beta', kind: 'terminal', cwd: '', origin: 'app', startedAt: fri, status: 'ok', code: 0, lineCount: 1 }],
    queue: [{ id: 'q', projectId: 'p', demandId: 'd1', prompt: 'x', status: 'falhou', createdAt: fri, endedAt: fri + 3000, origin: 'app', error: 'código 1' }],
    projects: [{ id: 'p', name: 'web' } as any]
  })
  assert.match(text, /Sexta:\n- WEB-1 \(Filtro\): análise e estimativa, implementação, abri o PR/)
  assert.match(text, /- Subir card em beta/)
  assert.match(text, /Hoje:\n- WEB-1 \(Filtro\): seguir a implementação \(em dev, estimativa 8h, 0,8 dia\(s\) útil\(eis\) até agora\)/)
  assert.match(text, /tarefa da fila falhou/)
  assert.match(text, /revisão pediu ajustes/)
})
