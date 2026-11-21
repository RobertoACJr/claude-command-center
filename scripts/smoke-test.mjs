// Teste de fumaça: abre o app empacotado, confere se a interface carrega sem erros
// e se as telas principais abrem. Roda no GitHub Actions depois do build.
// Uso: node scripts/smoke-test.mjs   (no Linux: xvfb-run -a node scripts/smoke-test.mjs)
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
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
// Claude falso para o Remote Control: imprime um link de sessão bem comprido (testa a quebra no card) e fica esperando
const LONG_URL = 'https://claude.ai/code/session_' + 'abc123XYZ'.repeat(14)
// O Claude falso é um script Node (funciona igual no Linux e no Windows):
// remote-control → imprime o link e espera; -p → responde em stream-json como o Claude de verdade
const fakeJs = join(home, 'fake-claude.js')
writeFileSync(
  fakeJs,
  `const a = process.argv.slice(2)
if (a[0] === 'remote-control') {
  console.log('Remote Control ativo: ${LONG_URL}')
  setInterval(() => {}, 1e9)
} else {
  process.stdin.on('data', () => {})
  const mode = a.includes('--disallowedTools') ? 'leitura' : 'escrita'
  setTimeout(() => {
    console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: '11111111-2222-3333-4444-555555555555' }))
    const text = '<<<RESULTADO\\n## Entendimento\\nTeste smoke modo ' + mode + '.\\nESTIMATIVA_HORAS: 6\\nRESULTADO>>>'
    console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }))
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'ok', total_cost_usd: 0 }))
    process.exit(0)
  }, 400)
}
`
)
if (process.platform === 'win32') {
  const f = join(home, 'fake-claude.cmd')
  writeFileSync(f, `@node "%~dp0fake-claude.js" %*\r\n`)
  env.CCC_CLAUDE_BIN = f
} else {
  const f = join(home, 'fake-claude')
  writeFileSync(f, `#!/bin/sh\nexec node "${fakeJs}" "$@"\n`)
  chmodSync(f, 0o755)
  env.CCC_CLAUDE_BIN = f
}
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
    port: null, vars: [{ key: 'remote', value: 'origin' }], claudeMode: 'ask', allowedTools: [], guides: ['README.md']
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

  // 4c) Remote Control com link enorme: não pode criar rolagem horizontal; vira notificação no sino
  const clickRemote = () =>
    evaluate(`(() => {
      const el = document.querySelector('[role="switch"][title*="Remote Control deste projeto"]')
      if (!el) return false
      el.click(); return true
    })()`)
  if (!(await clickRemote())) fail('Botão Remote do projeto não encontrado')
  await sleep(5000)
  if (!(await bodyText()).includes('session_abc123XYZ')) fail('Link do Remote Control (claude falso) não apareceu no card')
  const overflow = await evaluate(`JSON.stringify([...document.querySelectorAll('main, [data-testid="panel-list"], body')]
    .filter(e => e.scrollWidth > e.clientWidth + 1).map(e => (e.dataset.testid || e.tagName) + ':' + e.scrollWidth + '>' + e.clientWidth))`)
  if (overflow !== '[]') fail('Rolagem horizontal com o Remote ligado: ' + overflow)
  else console.log('✓ Remote ligado sem rolagem horizontal')
  const badge = await evaluate(`document.querySelector('[data-testid="notif-badge"]')?.textContent ?? ''`)
  if (!badge) fail('Sino de notificações sem contador depois do Remote ativo')
  await evaluate(`document.querySelector('[data-testid="notif-bell"]').click()`)
  await sleep(400)
  const panel = await evaluate(`document.querySelector('[data-testid="notif-panel"]')?.textContent ?? ''`)
  if (!panel.includes('Remote Control ativo')) fail('Central de notificações não mostrou o Remote ativo')
  else console.log('✓ Central de notificações mostrou o aviso')
  await evaluate(`document.querySelector('[data-testid="notif-bell"]').click()`)
  await sleep(300)
  await clickRemote()
  await sleep(2500)

  // 4d) Variáveis do projeto: chave e valor com a mesma largura
  await clickByText('Editar projeto (nome, pasta, como executar, variáveis)')
  await sleep(500)
  const widths = await evaluate(`JSON.stringify([...document.querySelectorAll('[data-testid="var-row"]')[0]?.querySelectorAll('input') ?? []].map(i => Math.round(i.getBoundingClientRect().width)))`)
  const [wk, wv] = JSON.parse(widths)
  if (!wk || !wv || Math.abs(wk - wv) > 4 || wv < 150) fail('Campos de variável sem largura meio a meio: ' + widths)
  else console.log(`✓ Variável chave/valor meio a meio (${wk}px / ${wv}px)`)
  await sleep(500)
  if (!(await bodyText()).includes('✓ README.md')) fail('Guia do projeto (README.md) não aparece como encontrado no formulário')
  else console.log('✓ Guia do projeto reconhecido (README.md)')
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await sleep(300)

  // 4e) Seletor de modo: um botão só, opções no hover
  const picker = await evaluate(`(() => {
    const b = document.querySelector('[data-testid="mode-picker"]')
    if (!b) return 'sem botão'
    const menu = b.parentElement.textContent
    return ['Claude', 'Gemini', 'ChatGPT', 'Terminal'].every(t => menu.includes(t)) ? 'ok' : 'faltam opções: ' + menu
  })()`)
  if (picker !== 'ok') fail('Seletor de modo: ' + picker)
  else console.log('✓ Seletor de modo único com as opções')

  // 4h) Git no card: chip da branch abre puxar / diferenças / trocar de branch
  await evaluate(`document.querySelector('[data-testid="git-chip"]')?.click()`)
  await sleep(1200)
  const gm = await evaluate(`document.querySelector('[data-testid="git-menu"]')?.textContent ?? ''`)
  if (!gm.includes('Puxar do remoto') || !gm.includes('Trocar de branch')) fail('Menu do git no card não abriu: ' + gm.slice(0, 120))
  else console.log('✓ Menu do git no card (puxar, diferenças, trocar de branch)')
  await evaluate(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)
  await sleep(300)

  // 4g) Demanda: criar pelo card do projeto, colar contexto e analisar com o Claude (falso) em modo só leitura
  const setVal = (sel, text) =>
    evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)})
      if (!el) return false
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(text)})
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`)
  const clickSel = (sel) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true })()`)
  if (!(await clickSel('[data-testid="new-demand"]'))) fail('Botão de nova demanda não encontrado no card do projeto')
  await sleep(400)
  await setVal('[data-testid="demand-key"]', 'web-482')
  await sleep(200)
  await clickSel('[data-testid="demand-create"]')
  await sleep(1500)
  if (!(await setVal('[data-testid="demand-context"]', 'Filtro de pedidos por data, pedido pelo chat.'))) fail('Demanda não abriu depois de criar')
  await sleep(900)
  await clickSel('[data-testid="demand-tab-analise"]')
  await sleep(300)
  await clickSel('[data-testid="demand-analyze"]')
  await sleep(5000)
  const analysis = await evaluate(`document.querySelector('[data-testid="demand-analysis"]')?.textContent ?? ''`)
  const hoursPh = await evaluate(`document.querySelector('[data-testid="demand-hours"]')?.placeholder ?? ''`)
  if (!analysis.includes('Teste smoke modo leitura')) fail('Análise da demanda não chegou (ou não foi só leitura): ' + analysis.slice(0, 200))
  else if (hoursPh !== '6') fail('Sugestão de horas da IA não apareceu: ' + hoursPh)
  else console.log('✓ Demanda criada, analisada em modo só leitura, com sugestão de 6h')
  const shotDemand = await cdp('Page.captureScreenshot', { format: 'jpeg', quality: 55 })
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await sleep(500)
  const row = await evaluate(`[...document.querySelectorAll('[data-testid="demand-row"]')].map(r => r.textContent).join(' | ')`)
  if (!row.includes('WEB-482') || !row.includes('Estimada')) fail('Demanda não aparece no card do projeto como Estimada: ' + row)
  else console.log('✓ Demanda aparece no card do projeto (WEB-482 · Estimada)')

  // 4f) Paleta de comandos (Ctrl+K) → Histórico com as execuções de antes
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }))`)
  await sleep(400)
  const paletteOk = await evaluate(`!!document.querySelector('[data-testid="palette"]')`)
  if (!paletteOk) fail('Ctrl+K não abriu a paleta de comandos')
  await evaluate(`(() => {
    const input = document.querySelector('[data-testid="palette-input"]')
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(input, 'historico execucoes'); input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(300)
  await evaluate(`document.querySelector('[data-testid="palette-input"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`)
  await sleep(1200)
  const hist = await evaluate(`document.querySelector('[data-testid="history-list"]')?.textContent ?? ''`)
  if (!hist) fail('Paleta não abriu o Histórico')
  else if (!hist.includes('Projeto Smoke')) fail('Histórico sem a execução do projeto: ' + hist.slice(0, 300))
  else {
    // Abre a execução do projeto e confere a saída gravada
    await evaluate(`[...document.querySelectorAll('[data-testid="history-list"] button')].find(b => b.textContent.includes('Projeto Smoke')).click()`)
    await sleep(800)
    const out = await evaluate(`document.querySelector('[data-testid="history-log"]')?.textContent ?? ''`)
    if (!out.includes('eco:ping-stdin')) fail('Histórico não mostrou a saída do projeto: ' + out.slice(0, 200))
    else console.log('✓ Paleta (Ctrl+K) abriu o Histórico com a saída gravada')
  }
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`)
  await sleep(300)

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
  for (const [name, s] of [['online', shotOnline], ['ausente', shot], ['demanda', shotDemand]]) {
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
