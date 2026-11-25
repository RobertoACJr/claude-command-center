import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { findPlainTokens, scanClaudeJson, secretFields } from '../src/main/tokencheck'
import { tempDir } from './helpers'

test('checagem de tokens: acha segredos em env, cabeçalhos, argumentos e url; ignora o resto', () => {
  assert.deepEqual(secretFields({ env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'ghp_abcdefghijklmnop', DEBUG: '1' } }), ['env GITHUB_PERSONAL_ACCESS_TOKEN'])
  assert.deepEqual(secretFields({ headers: { Authorization: 'Bearer x' } }), ['cabeçalho Authorization'])
  assert.deepEqual(secretFields({ args: ['mcp-atlassian', '--jira-token=ATATT3xFfGF0abcdef'] }), ['argumento 2'])
  assert.deepEqual(secretFields({ url: 'https://x/mcp?api_key=123' }), ['endereço (url)'])
  assert.deepEqual(secretFields({ env: { JIRA_API_TOKEN: '' }, args: ['-y', 'pacote'] }), [])

  const found = scanClaudeJson(
    {
      mcpServers: { 'ccc-github': { type: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer ghp_x' } }, livre: { command: 'npx' } },
      projects: { '/home/eu/api': { mcpServers: { 'ccc-jira': { env: { JIRA_API_TOKEN: 'abc' } } } } }
    },
    '/home/eu/.claude.json'
  )
  assert.deepEqual(
    found.map((f) => [f.server, f.scope, f.projectPath ?? '']),
    [
      ['ccc-github', 'user', ''],
      ['ccc-jira', 'local', '/home/eu/api']
    ]
  )

  const home = tempDir('ccc-home-')
  const proj = join(home, 'proj')
  mkdirSync(proj)
  writeFileSync(join(home, '.claude.json'), '{ quebrado')
  writeFileSync(join(proj, '.mcp.json'), JSON.stringify({ mcpServers: { banco: { env: { DB_PASSWORD: 'segredo' } } } }))
  const all = findPlainTokens([{ path: proj } as any], home)
  assert.equal(all.length, 1)
  assert.equal(all[0].scope, 'project')
  assert.deepEqual(all[0].fields, ['env DB_PASSWORD'])
})
