import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { composeCmd, hasComposeFile, LOG_ERROR_RE, logCommand, parseComposePs, parseStats, suggestions } from '../src/main/docker'
import { isDockerProcess, parseLsof, parseSs, parseWin } from '../src/main/ports'
import { envProfiles, envSwitch } from '../src/main/envfiles'
import { logTail } from '../src/main/applog'
import { readFileSync } from 'fs'
import { tempDir } from './helpers'

const proj = (path: string, extra: Record<string, unknown> = {}) =>
  ({ id: 'p', name: 'api', path, vars: [], dockerCommand: 'docker compose', logSource: { kind: 'none', service: '', path: '', command: '' }, ...extra }) as any

test('docker compose ps: JSON por linha (novo) e array (antigo)', () => {
  const lines =
    '{"Name":"api-app-1","Service":"app","State":"running","Status":"Up 3 minutes","Publishers":[{"PublishedPort":8000,"TargetPort":80},{"PublishedPort":8000,"TargetPort":80}]}\n' +
    '{"Name":"api-db-1","Service":"db","State":"exited","Status":"Exited (0) 1 hour ago","Publishers":[]}\n'
  const a = parseComposePs(lines)
  assert.equal(a.length, 2)
  assert.deepEqual(a[0], { name: 'app', state: 'running', status: 'Up 3 minutes', container: 'api-app-1', ports: '8000→80' })
  assert.equal(a[1].state, 'exited')
  const b = parseComposePs('[{"Name":"x-1","Service":"redis","State":"Running","Status":"Up"}]')
  assert.equal(b[0].name, 'redis')
  assert.equal(b[0].state, 'running')
  assert.deepEqual(parseComposePs(''), [])
  const st = parseStats('{"Name":"api-app-1","CPUPerc":"1.20%","MemUsage":"120MiB / 7.6GiB"}\n')
  assert.deepEqual(st.get('api-app-1'), { cpu: '1.20%', mem: '120MiB' })
})

test('compose: arquivo detectado, comando seguro, sugestões do Laravel', () => {
  const dir = tempDir()
  assert.equal(hasComposeFile(proj(dir)), false)
  writeFileSync(join(dir, 'compose.yaml'), 'services: {}')
  writeFileSync(join(dir, 'artisan'), '')
  assert.equal(hasComposeFile(proj(dir)), true)
  assert.equal(composeCmd(proj(dir, { dockerCommand: 'docker compose; rm -rf /' })), 'docker compose')
  assert.equal(composeCmd(proj(dir, { dockerCommand: 'docker compose -f docker/dev.yml' })), 'docker compose -f docker/dev.yml')
  const s = suggestions(proj(dir))
  assert.equal(s.logPath, 'storage/logs/laravel.log')
  assert.ok(s.commands.some((c) => c.command === 'php artisan migrate'))
})

test('fonte do log vira o comando certo; erros reconhecidos', async () => {
  const dir = tempDir()
  mkdirSync(join(dir, 'storage', 'logs'), { recursive: true })
  const f = join(dir, 'storage', 'logs', 'laravel.log')
  writeFileSync(f, 'a\n[2026-11-25 10:00:00] local.ERROR: SQLSTATE[HY000] boom\nb\nc\n')
  const p = proj(dir, { logSource: { kind: 'file', service: '', path: 'storage/logs/laravel.log', command: '' } })
  const c = logCommand(p, p.logSource)
  assert.equal(c.ok, true)
  assert.ok(c.ok && c.command.includes('laravel.log'))
  assert.equal(logCommand(p, { kind: 'docker', service: 'a b', path: '', command: '' }).ok, false)
  const d = logCommand(p, { kind: 'docker', service: 'app', path: '', command: '' })
  assert.ok(d.ok && d.command === 'docker compose logs -f --tail 300 app')
  assert.equal(logCommand(p, { kind: 'file', service: '', path: 'nao-existe.log', command: '' }).ok, false)
  const t = await logTail(p, 2)
  assert.equal(t.text, 'c\n')
  assert.ok(LOG_ERROR_RE.test('[2026-11-25 10:00:00] local.ERROR: SQLSTATE'))
  assert.ok(LOG_ERROR_RE.test('PHP Fatal error:  Uncaught Error'))
  assert.ok(LOG_ERROR_RE.test('TypeError: x is not a function'))
  assert.ok(!LOG_ERROR_RE.test('[2026-11-25 10:00:00] local.INFO: tudo certo'))
  assert.ok(!LOG_ERROR_RE.test('GET /errors 200'))
})

test('quem usa a porta: ss, lsof e Windows; Docker não é encerrado', () => {
  assert.deepEqual(parseSs('LISTEN 0 511 *:5173 *:* users:(("node",pid=4321,fd=23))'), { name: 'node', pid: 4321 })
  assert.deepEqual(parseLsof('p999\ncphp\nf7\n'), { pid: 999, name: 'php' })
  assert.deepEqual(parseWin('1234 node\r\n'), { pid: 1234, name: 'node' })
  assert.equal(parseSs(''), null)
  assert.ok(isDockerProcess('com.docker.backend'))
  assert.ok(isDockerProcess('wslrelay'))
  assert.ok(!isDockerProcess('node'))
})

test('.env: lista os perfis, diz o ativo e troca guardando o anterior', () => {
  const dir = tempDir()
  writeFileSync(join(dir, '.env'), 'APP_ENV=local\n')
  writeFileSync(join(dir, '.env.local'), 'APP_ENV=local\n')
  writeFileSync(join(dir, '.env.homolog'), 'APP_ENV=homolog\n')
  writeFileSync(join(dir, '.env.example'), 'APP_ENV=\n')
  const p = proj(dir)
  assert.deepEqual(envProfiles(p), { files: ['.env.homolog', '.env.local'], active: '.env.local' })
  const r = envSwitch(p, '.env.homolog')
  assert.equal(r.ok, true)
  assert.equal(readFileSync(join(dir, '.env'), 'utf8'), 'APP_ENV=homolog\n')
  assert.equal(readFileSync(join(dir, '.env.anterior'), 'utf8'), 'APP_ENV=local\n')
  assert.equal(envProfiles(p).active, '.env.homolog')
  assert.equal(envSwitch(p, '../segredo').ok, false)
})
