// Teste de fumaça: abre o app empacotado, confere se a interface carrega sem erros
// e se as telas principais abrem. Roda no GitHub Actions depois do build.
// Uso: node scripts/smoke-test.mjs   (no Linux: xvfb-run -a node scripts/smoke-test.mjs)
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PORT = 9333
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function findExecutable() {
  const rel = 'release'
  for (const ver of readdirSync(rel)) {
    const linux = join(rel, ver, 'linux-unpacked', 'claude-command-center')
    const win = join(rel, ver, 'win-unpacked', 'ClaudeCommandCenter.exe')
    if (process.platform === 'linux' && existsSync(linux)) return linux
    if (process.platform === 'win32' && existsSync(win)) return win
  }
  throw new Error('Executável empacotado não encontrado em release/*/')
}

const exe = findExecutable()
// Perfil limpo no Linux (HOME temporário). No Windows o Electron usa a pasta real do usuário:
// rodando localmente, o teste alterna o modo Online/Ausente do seu config.json (no CI a máquina é descartável).
const home = mkdtempSync(join(tmpdir(), 'ccc-smoke-'))
const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config'), APPDATA: join(home, 'AppData') }
const args = [`--remote-debugging-port=${PORT}`]
if (process.platform === 'linux') args.push('--no-sandbox')

console.log(`▶ Abrindo ${exe}`)
const app = spawn(exe, args, { env, stdio: ['ignore', 'pipe', 'pipe'] })
const mainLog = []
app.stdout.on('data', (d) => mainLog.push(String(d)))
app.stderr.on('data', (d) => mainLog.push(String(d)))
let exited = null
app.on('exit', (code) => (exited = code))

const failures = []
const fail = (m) => {
  failures.push(m)
  console.log('✖ ' + m)
}

try {
  // Espera a página do app aparecer no DevTools
  let target = null
  for (let i = 0; i < 60 && !target; i++) {
    if (exited !== null) throw new Error(`O app fechou sozinho (código ${exited})`)
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      target = list.find((t) => t.type === 'page' && t.url.includes('index.html'))
    } catch {
      /* ainda subindo */
    }
    if (!target) await sleep(500)
  }
  if (!target) throw new Error('A janela do app não apareceu em 30s')

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r, j) => {
    ws.onopen = r
    ws.onerror = j
  })
  let id = 0
  const pending = new Map()
  const errors = []
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push('Exceção: ' + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text))
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push('console.error: ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
    }
    if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      errors.push('Log: ' + msg.params.entry.text)
    }
  }
  const cdp = (method, params = {}) =>
    new Promise((resolve) => {
      const mid = ++id
      pending.set(mid, resolve)
      ws.send(JSON.stringify({ id: mid, method, params }))
    })
  const evaluate = async (expr) => {
    const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.result?.exceptionDetails) throw new Error('Erro avaliando: ' + JSON.stringify(r.result.exceptionDetails.exception?.description))
    return r.result?.result?.value
  }
  const clickByText = (text) =>
    evaluate(`(() => {
      const el = [...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(text)}) || b.title === ${JSON.stringify(text)})
      if (!el) return false
      el.click(); return true
    })()`)
  // textContent (e não innerText): ignora o text-transform: uppercase dos rótulos
  const bodyText = () => evaluate('document.body.textContent')

  await cdp('Runtime.enable')
  await cdp('Log.enable')
  await cdp('Page.enable')
  // Recarrega para capturar erros desde o início
  await cdp('Page.reload', { ignoreCache: true })
  await sleep(5000)

  // 1) Tela principal
  const t1 = await bodyText()
  for (const expected of ['Claude Command Center', 'Projetos', 'Ações globais', 'Terminais', 'Online', 'Ausente', 'ChatGPT', 'Gemini']) {
    if (!t1.includes(expected)) fail(`Tela principal sem "${expected}"`)
  }
  const apiKeys = await evaluate('Object.keys(window.api || {}).length')
  if (!(apiKeys > 30)) fail(`window.api incompleta (${apiKeys} funções)`)
  console.log(`✓ Tela principal carregou · window.api com ${apiKeys} funções`)
  console.log(`  pasta de dados: ${await evaluate('window.api.configPath()')}`)

  // 2) Configurações: todas as abas
  if (!(await clickByText('Configurações & Integrações'))) fail('Botão de configurações não encontrado')
  await sleep(600)
  // Primeira abertura (sem projetos): o assistente "Começar" já abre sozinho
  if (!(await bodyText()).includes('Programas no seu PC')) fail('Assistente "Começar" não abriu na primeira vez')
  await sleep(2500) // diagnóstico dos programas
  for (const tab of ['Integrações', 'IAs', 'Telegram', 'Modo Vigia', 'Automação', 'Geral']) {
    if (!(await clickByText(tab))) fail(`Aba "${tab}" não encontrada`)
    await sleep(400)
  }
  const t2 = await bodyText()
  if (!t2.includes('Janela e sistema')) fail('Aba Geral não renderizou')
  if (!t2.includes('Levar a configuração para outro PC')) fail('Exportar/importar não apareceu')
  await clickByText('IAs')
  await sleep(300)
  if (!(await bodyText()).includes('ChatGPT (Codex CLI)')) fail('Aba IAs sem o ChatGPT')
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await sleep(400)
  console.log('✓ Configurações: todas as abas abriram')

  // 3) Novo projeto e nova ação (só abre e fecha os modais)
  if (!(await clickByText('Projeto'))) fail('Botão + Projeto não encontrado')
  await sleep(400)
  const tp = await bodyText()
  for (const exp of ['Como executar', 'Variáveis do projeto', 'Permissões do Claude neste projeto']) {
    if (!tp.includes(exp)) fail(`Modal de projeto sem "${exp}"`)
  }
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await sleep(300)
  if (!(await clickByText('Ação'))) fail('Botão + Ação não encontrado')
  await sleep(400)
  const ta = await bodyText()
  if (!ta.includes('Ação global')) fail('Modal de ação global não abriu')
  if (!ta.includes('Inserir variável')) fail('Modal de ação sem "Inserir variável"')
  if (!ta.includes('Ordem para o ChatGPT')) fail('Modal de ação sem o tipo ChatGPT')
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await sleep(300)
  console.log('✓ Modais de projeto e ação abriram')

  // 4) Terminais + um comando de verdade
  if (!(await clickByText('Terminais'))) fail('Botão Terminais não encontrado')
  await sleep(400)
  const typeAndEnter = (text) =>
    evaluate(`(() => {
      const input = document.querySelector('[data-testid="console-input"]')
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(input, ${JSON.stringify(text)}); input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })()`)
  await typeAndEnter('echo smoke-ok-123')
  await sleep(4000)
  const t4 = await bodyText()
  if (!t4.includes('smoke-ok-123')) fail('Comando no console não mostrou a saída')
  else console.log('✓ Console executou um comando de verdade')

  // 4b) Projeto de verdade: Executar → mandar texto para o processo (stdin) → Parar
  await evaluate(`window.api.saveProject({
    id: 'smoke', name: 'Projeto Smoke', path: ${JSON.stringify(process.cwd())}, remoteEnabled: false, createdAt: Date.now(),
    runCommand: ${JSON.stringify(`node -e "process.stdin.on('data', d => console.log('eco:' + String(d).trim())); console.log('pronto')"`)},
    port: null, vars: [{ key: 'remote', value: 'origin' }], claudeMode: 'ask', allowedTools: []
  })`)
  await sleep(1200)
  if (!(await bodyText()).includes('remote=origin')) fail('Variáveis do projeto não aparecem no card')
  if (!(await clickByText('Executar'))) fail('Botão Executar do projeto não encontrado')
  await sleep(4000)
  const t5 = await bodyText()
  if (!t5.includes('Rodando')) fail('Projeto não ficou "Rodando"')
  if (!t5.includes('pronto')) fail('Saída do projeto não apareceu na aba dele')
  await typeAndEnter('ping-stdin')
  await sleep(2500)
  if (!(await bodyText()).includes('eco:ping-stdin')) fail('Texto não chegou ao processo do projeto (stdin)')
  else console.log('✓ Projeto rodou e recebeu texto pela aba dele (stdin)')
  if (!(await clickByText('Parar'))) fail('Botão Parar não encontrado')
  await sleep(5000)
  if (!(await bodyText()).includes('Parado')) fail('Projeto não voltou para "Parado"')
  else console.log('✓ Projeto parou')

  // 5) Modo Ausente (tema azul-petróleo) e volta
  await clickByText('Ausente')
  await sleep(800)
  const mode = await evaluate('document.documentElement.dataset.mode')
  if (mode !== 'away') fail(`Modo Ausente não aplicou o tema (data-mode=${mode})`)
  const shot = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 55 })
  await clickByText('Voltar ao PC')
  await sleep(800)
  console.log('✓ Modo Ausente alternou o tema')

  // Print da tela (vai no log, entre marcadores, para poder ser visto sem baixar artefatos)
  const shotOnline = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 55 })
  for (const [name, s] of [['online', shotOnline], ['ausente', shot]]) {
    const b64 = s.result?.data ?? ''
    writeFileSync(`smoke-${name}.jpg`, Buffer.from(b64, 'base64'))
    console.log(`::group::screenshot-${name}`)
    console.log(`SCREENSHOT-${name}-BEGIN`)
    for (let i = 0; i < b64.length; i += 4000) console.log(b64.slice(i, i + 4000))
    console.log(`SCREENSHOT-${name}-END`)
    console.log('::endgroup::')
  }

  for (const e of errors) fail(e)
  ws.close()
} catch (err) {
  fail(err.message)
} finally {
  app.kill()
  await sleep(1000)
  if (failures.length) {
    console.log('\n--- saída do processo principal ---\n' + mainLog.join('').slice(-4000))
  }
}

if (failures.length) {
  console.log(`\n✖ ${failures.length} problema(s) no teste de fumaça`)
  process.exit(1)
}
console.log('\n✓ Teste de fumaça passou')
process.exit(0)
