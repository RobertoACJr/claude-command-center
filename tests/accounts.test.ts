import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gitScope, parseClaudeAccount, parseCodexAccount, parseGeminiAccount, remoteInfo } from '../src/main/accounts'

test('conta do Claude: e-mail, organização e plano, sem token', () => {
  const a = parseClaudeAccount(
    { oauthAccount: { emailAddress: 'r@x.com', displayName: 'Roberto', organizationName: 'Empresa X' } },
    { claudeAiOauth: { accessToken: 'segredo', subscriptionType: 'max' } },
    false
  )
  assert.deepEqual(a, { who: 'r@x.com', name: 'Roberto', org: 'Empresa X', plan: 'Max', note: undefined })
  assert.ok(!JSON.stringify(a).includes('segredo'))
  assert.equal(parseClaudeAccount({ oauthAccount: { emailAddress: 'a@b', organizationName: "a@b's Personal Organization" } }, null, false).org, undefined)
  assert.match(parseClaudeAccount(null, null, true).who!, /Chave de API/)
  assert.equal(parseClaudeAccount(null, null, false).who, null)
})

test('conta do Codex lida do id_token', () => {
  const payload = Buffer.from(JSON.stringify({ email: 'c@x.com', 'https://api.openai.com/auth': { chatgpt_plan_type: 'plus' } })).toString('base64url')
  const a = parseCodexAccount({ tokens: { id_token: `h.${payload}.s`, access_token: 'segredo' } })
  assert.equal(a.who, 'c@x.com')
  assert.equal(a.plan, 'Plus')
  assert.match(parseCodexAccount({ OPENAI_API_KEY: 'sk' }).who!, /Chave/)
  assert.equal(parseCodexAccount(null).who, null)
})

test('conta do Gemini', () => {
  assert.equal(parseGeminiAccount({ active: 'g@x.com', old: [] }, { security: { auth: { selectedType: 'oauth-personal' } } }, false).plan, 'Conta Google')
  assert.equal(parseGeminiAccount(null, null, false).who, null)
})

test('git: escopo da configuração e remoto sem credenciais', () => {
  assert.equal(gitScope('file:.git/config'), 'projeto')
  assert.equal(gitScope('file:/home/r/.gitconfig'), 'global')
  assert.equal(gitScope('file:C:/Users/r/.gitconfig'), 'global')
  assert.equal(gitScope('file:/etc/gitconfig'), 'sistema')
  assert.deepEqual(remoteInfo('git@github.com:empresa/api.git'), { host: 'github.com', repo: 'empresa/api' })
  assert.deepEqual(remoteInfo('https://user:tok@github.com/empresa/web.git'), { host: 'github.com', repo: 'empresa/web' })
  assert.deepEqual(remoteInfo('ssh://git@gitlab.empresa.com:2222/time/app.git'), { host: 'gitlab.empresa.com', repo: 'time/app' })
})

test('conta do projeto: pasta de login vira variável de ambiente', async () => {
  const { accountEnv, accountOf, expandHome } = await import('../src/main/accounts')
  const cfg = {
    accounts: [{ id: 'pes', name: 'Pessoal', claudeDir: '~/.claude-pessoal', codexDir: '' }],
    projects: [{ id: 'p1', accountId: 'pes' }, { id: 'p2', accountId: '' }, { id: 'p3', accountId: 'apagada' }]
  } as any
  assert.equal(accountOf(cfg, 'p1')?.name, 'Pessoal')
  assert.equal(accountOf(cfg, 'p2'), null)
  assert.equal(accountOf(cfg, 'p3'), null, 'conta apagada cai na padrão')
  assert.equal(accountOf(cfg, undefined), null)
  assert.deepEqual(accountEnv(accountOf(cfg, 'p1'), '/home/r'), { CLAUDE_CONFIG_DIR: '/home/r/.claude-pessoal' })
  assert.deepEqual(accountEnv(null), {})
  assert.equal(expandHome('/abs/dir', '/home/r'), '/abs/dir')
})
