import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tempDir, sleep } from './helpers'
import { RunManager } from '../src/main/runner'

/** Claude falso: responde em stream-json como o de verdade e mostra os argumentos que recebeu */
function fakeClaude(): string {
  const dir = tempDir()
  const js = join(dir, 'fake-claude.js')
  writeFileSync(
    js,
    `let input = ''
process.stdin.on('data', (d) => (input += d))
process.stdin.on('end', () => {
  const args = process.argv.slice(2)
  console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: '11111111-2222-3333-4444-555555555555' }))
  console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'recebi: ' + input.trim() }] } }))
  console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'args: ' + args.join(' ') }] } }))
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.0123, usage: { input_tokens: 10, output_tokens: 5 } }))
})
`
  )
  if (process.platform === 'win32') {
    const cmd = join(dir, 'claude.cmd')
    writeFileSync(cmd, `@node "${js}" %*\r\n`)
    return cmd
  }
  const sh = join(dir, 'claude')
  writeFileSync(sh, `#!/bin/sh\nexec node "${js}" "$@"\n`)
  chmodSync(sh, 0o755)
  return sh
}

test('Claude: prompt pelo stdin, sessão, texto, custo e saída; só leitura e pastas extras viram flags', async () => {
  process.env.CCC_CLAUDE_BIN = fakeClaude()
  const events: any[] = []
  const runs = new RunManager((e) => events.push(e))
  runs.setClaudeArgsProvider(() => ['--append-system-prompt', 'siga o guia'])
  const id = runs.start({ kind: 'claude', tab: 'demand:x', title: 'teste', content: 'olá {{nome}}', variables: { nome: 'Roberto' }, cwd: tempDir(), readOnly: true, addDirs: ['/api'] })
  for (let i = 0; i < 100 && !events.some((e) => e.type === 'exit'); i++) await sleep(100)
  const text = events.filter((e) => e.type === 'lines').flatMap((e) => e.lines).filter((l: any) => l.kind === 'claude').map((l: any) => l.text).join('\n')
  assert.match(text, /recebi: olá Roberto/)
  assert.match(text, /--disallowedTools Edit,Write,MultiEdit,NotebookEdit,Bash/)
  assert.match(text, /--add-dir \/api/)
  assert.match(text, /--append-system-prompt/)
  assert.equal(events.find((e) => e.type === 'session')?.sessionId, '11111111-2222-3333-4444-555555555555')
  const usage = events.find((e) => e.type === 'usage')
  assert.equal(usage.costUsd, 0.0123)
  assert.equal(usage.tokens, 15)
  const start = events.find((e) => e.type === 'start')
  assert.equal(start.tab, 'demand:x')
  assert.equal(start.origin, 'app')
  const exit = events.find((e) => e.type === 'exit')
  assert.equal(exit.code, 0)
  assert.equal(exit.runId, id)
})
