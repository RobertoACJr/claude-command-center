import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'path'
import { listen, tempDir } from './helpers'
import { ShotManager, parseApiRoute, runApiChecks, shotSummary } from '../src/main/shots'

test('rotas da API: método, caminho e status esperado', () => {
  assert.deepEqual(parseApiRoute('GET /health 200'), { method: 'GET', path: '/health', expected: 200 })
  assert.deepEqual(parseApiRoute('post api/pedidos 201'), { method: 'POST', path: '/api/pedidos', expected: 201 })
  assert.deepEqual(parseApiRoute('/so-caminho'), { method: 'GET', path: '/so-caminho', expected: 200 })
  assert.equal(parseApiRoute('   '), null)
})

test('checagem da API compara status e mostra o erro', async () => {
  const api = await listen((req, res) => {
    if (req.url === '/health') return res.end('ok')
    res.statusCode = 500
    res.end('{"erro":"banco fora"}')
  })
  const items = await runApiChecks(api.url, ['GET /health 200', 'GET /api/pedidos 200'])
  assert.equal(items[0].ok, true)
  assert.equal(items[1].ok, false)
  assert.equal(items[1].status, 500)
  assert.match(items[1].errors[0], /esperava 200, veio 500: \{"erro":"banco fora"\}/)
  api.server.close()
})

const project = (over: Record<string, unknown>) =>
  ({ id: 'p', name: 'web', path: '/w', kind: 'front', localUrl: '', routes: ['/', '/pedidos'], mobileShots: false, ...over }) as any

test('prints: uma por rota (e celular), erros do navegador, projeto fora do ar', async () => {
  const site = await listen((_req, res) => res.end('<h1>oi</h1>'))
  const calls: Array<[string, number]> = []
  const png = Buffer.from('89504e47', 'hex')
  const m = new ShotManager(tempDir(), async (url, width) => {
    calls.push([url, width])
    return { png, errors: url.endsWith('/pedidos') ? ['console: TypeError: x is undefined'] : [] }
  }, () => {})
  const r = await m.take(project({ localUrl: site.url, mobileShots: true }), { demandId: 'd1', label: 'manual' })
  assert.equal(r.ok, true)
  assert.deepEqual(
    calls.map(([u, w]) => `${u.replace(site.url, '')}@${w}`),
    ['/@1280', '/@390', '/pedidos@1280', '/pedidos@390']
  )
  const set = r.sets![0]
  assert.equal(set.items.filter((i) => !i.ok).length, 2)
  assert.match(shotSummary(set), /erros no navegador: \/pedidos: console: TypeError/)
  assert.ok(m.image(set.items[0].file!)?.startsWith('data:image/png;base64,'))
  assert.equal(m.image('/etc/passwd'), null, 'só arquivos do app')
  assert.equal(m.list({ demandId: 'd1' }).length, 1)
  site.server.close()
  const down = await m.take(project({ localUrl: 'http://127.0.0.1:9' }), { label: 'x' })
  assert.equal(down.ok, false)
  assert.match(down.message, /não está respondendo/)
  assert.match((await m.take(project({ kind: 'outro', localUrl: site.url }), { label: 'x' })).message, /tipo/)
})

test('fullstack: prints e API no mesmo pedido', async () => {
  const site = await listen((req, res) => {
    res.statusCode = req.url === '/api/health' ? 200 : 200
    res.end('ok')
  })
  const m = new ShotManager(tempDir(), async () => ({ png: null, errors: [] }), () => {})
  const r = await m.take(project({ kind: 'fullstack', localUrl: site.url, routes: ['GET /api/health 200'] }), { label: 'x' })
  assert.deepEqual(
    r.sets!.map((s) => s.kind),
    ['telas', 'api']
  )
  assert.equal(r.sets![1].items[0].ok, true)
  site.server.close()
  void join
})
