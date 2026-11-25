import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fakeRuns, listen, readBody, sleep, tempDir, useTempUserData } from './helpers'

useTempUserData()
const { store } = require('../src/main/store') as typeof import('../src/main/store')
const { secrets } = require('../src/main/secrets') as typeof import('../src/main/secrets')
const { costs } = require('../src/main/costs') as typeof import('../src/main/costs')
const { History } = require('../src/main/history') as typeof import('../src/main/history')
const { DemandManager, normDemand } = require('../src/main/demands') as typeof import('../src/main/demands')
const { QueueManager } = require('../src/main/queue') as typeof import('../src/main/queue')
const { TelegramControl } = require('../src/main/tgcontrol') as typeof import('../src/main/tgcontrol')

test('Telegram: projetos, scripts com variável, Claude contínuo, demanda, fila e histórico', async () => {
  // Telegram falso: guarda tudo que o bot manda
  const sent: Array<{ method: string; body: any }> = []
  let mid = 1
  const tg = await listen(async (req, res) => {
    const body = JSON.parse((await readBody(req)) || '{}')
    sent.push({ method: String(req.url).split('/').pop()!, body })
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true, result: { message_id: mid++ } }))
  })
  process.env.CCC_TELEGRAM_API = tg.url
  secrets.set('telegram.token', '123:abc')
  store.saveSettings({ telegram: { chatId: '42' }, queue: { onlyAway: true, paused: false } })
  store.saveProject({ id: 'p1', name: 'Loja Web', path: tempDir(), vars: [{ key: 'remote', value: 'origin' }], runCommand: 'npm start', guides: [] } as any)
  store.saveScript({ id: 's1', name: 'Subir card em beta', type: 'terminal', content: 'git push {{projeto.remote}} {{card}}', target: { kind: 'ask' } } as any)
  costs.init(tempDir(), { limit: () => 0 })

  const runs = fakeRuns()
  const history = new History(tempDir(), () => {})
  const demands = new DemandManager(tempDir(), runs as any, () => {})
  demands.save(normDemand({ id: 'd1', projectId: 'p1', key: 'WEB-482', title: 'Filtro' }))
  const queue = new QueueManager(tempDir(), { runs: runs as any, demands, onChange: () => {}, onDrained: () => {}, log: () => {} })
  let remoteOn: string | null = null
  const ctl = new TelegramControl({
    runs: runs as any,
    demands,
    queue,
    projects: { list: () => [{ projectId: 'p1', state: 'stopped' }], start: async () => ({ ok: true, message: 'Iniciado.' }), stop: async () => {} } as any,
    remote: { list: () => [], setManual: (id: string) => (remoteOn = id) } as any,
    history,
    status: async () => '',
    log: () => {},
    runProfile: async () => ({ ok: true, message: '' }),
    logTail: async () => ({ ok: false, message: '' })
  })
  const last = () => sent.filter((s) => s.method === 'sendMessage').at(-1)!.body
  const click = async (label: string) => {
    const msg = [...sent].reverse().find((s) => s.body.reply_markup?.inline_keyboard?.flat().some((b: any) => b.text.includes(label)))
    assert.ok(msg, `botão "${label}" não encontrado`)
    const b = msg.body.reply_markup.inline_keyboard.flat().find((x: any) => x.text.includes(label))
    return ctl.callback(b.callback_data.slice(2))
  }

  // /projetos: estado e botões; Remote pedido pelo Telegram fica marcado para mandar o link lá
  await ctl.command('projetos', '')
  assert.match(sent.at(-1)!.body.text, /Loja Web/)
  await click('📡 Remote')
  assert.equal(remoteOn, 'p1')
  assert.equal(ctl.takeRemoteRequest('p1'), true)

  // /rodar: escolhe o projeto, pergunta a variável, confirma e roda
  await ctl.command('rodar', 'subir')
  await sleep(20)
  await click('Loja Web')
  await sleep(20)
  assert.match(last().text, /Valor de <b>card<\/b>/)
  await ctl.text('WEB-482')
  await sleep(20)
  assert.match(last().text, /card = <code>WEB-482<\/code>/)
  await click('✅ Rodar')
  const run = runs.started.at(-1)!
  assert.equal(run.req.origin, 'telegram')
  assert.equal(run.req.variables.card, 'WEB-482')
  assert.equal(run.req.variables['projeto.remote'], 'origin')
  ctl.handleRunEvent({ runId: run.id, tab: 'script:s1', type: 'lines', lines: [{ kind: 'stdout', text: 'pushed' }] })
  ctl.handleRunEvent({ runId: run.id, tab: 'script:s1', type: 'exit', code: 0, signal: null, killed: false })
  await sleep(20)
  assert.match(last().text, /terminou/)
  assert.match(last().text, /pushed/)

  // Texto livre sem projeto escolhido: pergunta onde; depois a conversa continua
  await ctl.text('arruma o teste')
  await sleep(20)
  await click('Loja Web')
  await sleep(20)
  const c1 = runs.started.at(-1)!
  assert.equal(c1.req.kind, 'claude')
  assert.equal(c1.req.content, 'arruma o teste')
  ctl.handleRunEvent({ runId: c1.id, tab: 'claude', type: 'session', sessionId: 'sess-1' })
  ctl.handleRunEvent({ runId: c1.id, tab: 'claude', type: 'lines', lines: [{ kind: 'claude', text: 'Arrumei.' }] })
  ctl.handleRunEvent({ runId: c1.id, tab: 'claude', type: 'exit', code: 0, signal: null, killed: false })
  await sleep(20)
  assert.match(last().text, /Arrumei\./)
  await ctl.text('e agora?')
  await sleep(20)
  assert.equal(runs.started.at(-1)!.req.resumeSessionId, 'sess-1')

  // /demanda WEB-482 texto → conversa da demanda (1ª mensagem leva o contexto)
  await ctl.command('demanda', 'WEB-482 começa')
  await sleep(20)
  const dm = runs.started.at(-1)!
  assert.equal(dm.req.tab, 'demand:d1')
  assert.equal(dm.req.origin, 'telegram')
  assert.match(dm.req.content, /Demanda WEB-482/)
  demands.handleRunEvent({ runId: dm.id, tab: 'demand:d1', type: 'exit', code: 0, signal: null, killed: false })

  // /fila WEB-482 texto → entra na fila (esperando o modo Ausente)
  await ctl.command('fila', 'WEB-482 cobrir com teste')
  await sleep(20)
  assert.match(last().text, /Na fila/)
  assert.equal(queue.state().tasks[0].demandId, 'd1')
  await ctl.command('fila', '')
  assert.match(last().text, /cobrir com teste/)

  // /historico e /log
  history.handle({ runId: 'h1', tab: 'project:p1', type: 'start', title: 'Loja Web', kind: 'terminal', startedAt: Date.now() })
  history.handle({ runId: 'h1', tab: 'project:p1', type: 'lines', lines: [{ kind: 'stdout', text: 'servidor no ar' }] })
  history.handle({ runId: 'h1', tab: 'project:p1', type: 'exit', code: 0, signal: null, killed: false })
  await ctl.command('log', 'loja')
  assert.match(last().text, /servidor no ar/)
  await ctl.command('historico', '')
  assert.match(last().text, /Últimas execuções/)
  assert.equal(await ctl.command('naoexiste', ''), false)
  assert.equal(await ctl.callback('chave-velha'), 'Esse botão expirou. Mande o comando de novo.')
  tg.server.close()
})
