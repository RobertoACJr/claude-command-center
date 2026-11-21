import { homedir } from 'os'
import { spawnSync } from 'child_process'
import { MCP_NAMES, type AppConfig, type IntegrationCheck, type IntegrationId, type OpResult } from '../shared/types'
import { secrets } from './secrets'
import { IS_WIN, runClaudeCapture } from './proc'

/**
 * Configura os MCPs pelo próprio CLI do Claude Code (`claude mcp ...`, escopo user),
 * em vez de editar ~/.claude.json na mão: o CLI cuida do formato e de não corromper o arquivo.
 * Segredos vão pelo stdin (`add-json <nome> -`) ou por variável de ambiente, nunca na linha de comando.
 */

export const GCHAT_OFFICIAL_URL = 'https://chatmcp.googleapis.com/mcp/v1'
/** Ferramentas de leitura do servidor oficial do Google Chat */
export const GCHAT_OFFICIAL_READ_TOOLS = ['search_conversations', 'list_messages', 'search_messages', 'list_memberships']
export const GCHAT_OFFICIAL_WRITE_TOOLS = ['send_message', 'mark_as_read', 'mark_as_unread', 'update_notification_settings']

const cwd = () => homedir()

function summarize(r: { code: number | null; stdout: string; stderr: string; timedOut: boolean; spawnError?: string }) {
  if (r.spawnError) return r.spawnError
  if (r.timedOut) return 'Tempo esgotado.'
  return (r.stdout + '\n' + r.stderr).trim().split('\n').slice(-6).join('\n') || `código ${r.code}`
}

function hasCommand(cmd: string): boolean {
  const r = IS_WIN
    ? spawnSync('where', [cmd], { windowsHide: true })
    : spawnSync('/bin/bash', ['-lc', `command -v ${cmd}`], { windowsHide: true })
  return r.status === 0
}

async function remove(name: string) {
  // Ignora "não existe"
  await runClaudeCapture(['mcp', 'remove', name, '-s', 'user'], { cwd: cwd(), timeoutMs: 30_000 })
}

async function addJson(name: string, json: Record<string, unknown>): Promise<OpResult> {
  const r = await runClaudeCapture(['mcp', 'add-json', name, '-', '-s', 'user'], {
    cwd: cwd(),
    stdin: JSON.stringify(json),
    timeoutMs: 30_000
  })
  const msg = summarize(r)
  if (/refused inside a Claude Code session/i.test(msg)) {
    return {
      ok: false,
      message:
        'O CLI recusou porque o app foi aberto de dentro de uma sessão do Claude Code. Abra o app por um terminal comum (ou pelo atalho) e tente de novo.'
    }
  }
  return { ok: r.code === 0, message: msg }
}

export async function applyIntegration(id: IntegrationId, cfg: AppConfig): Promise<OpResult> {
  const name = MCP_NAMES[id]
  await remove(name)

  if (id === 'github') {
    if (!cfg.integrations.github.enabled) return { ok: true, message: `${name} removido.` }
    const pat = secrets.get('github.pat')
    if (!pat) return { ok: false, message: 'Informe o Personal Access Token do GitHub.' }
    const url = cfg.integrations.github.readOnly
      ? 'https://api.githubcopilot.com/mcp/readonly'
      : 'https://api.githubcopilot.com/mcp/'
    return addJson(name, { type: 'http', url, headers: { Authorization: `Bearer ${pat}` } })
  }

  if (id === 'jira') {
    const j = cfg.integrations.jira
    if (!j.enabled) return { ok: true, message: `${name} removido.` }
    const token = secrets.get('jira.token')
    if (!j.url || !j.email || !token) return { ok: false, message: 'Preencha URL, e-mail e API token do Jira.' }
    const res = await addJson(name, {
      type: 'stdio',
      command: 'uvx',
      args: ['mcp-atlassian'],
      env: { JIRA_URL: j.url, JIRA_USERNAME: j.email, JIRA_API_TOKEN: token }
    })
    if (res.ok && !hasCommand('uvx')) {
      res.message +=
        '\n⚠ `uvx` não encontrado. Instale o uv (https://docs.astral.sh/uv/) para o servidor do Jira conseguir subir.'
    }
    return res
  }

  // Google Chat
  const g = cfg.integrations.gchat
  if (!g.enabled) return { ok: true, message: `${name} removido.` }

  if (g.mode === 'custom') {
    const raw = secrets.get('gchat.customJson')
    if (!raw) return { ok: false, message: 'Cole o JSON do servidor MCP do Google Chat.' }
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      return { ok: false, message: 'JSON inválido.' }
    }
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      return { ok: false, message: 'O JSON precisa ser um objeto, ex: {"type":"stdio","command":"...","args":[...]}' }
    }
    return addJson(name, json as Record<string, unknown>)
  }

  // Oficial (OAuth): client id na linha de comando (não é segredo), client secret por variável de ambiente
  const clientSecret = secrets.get('gchat.clientSecret')
  if (!g.clientId || !clientSecret) return { ok: false, message: 'Informe Client ID e Client Secret do OAuth.' }
  const r = await runClaudeCapture(
    [
      'mcp',
      'add',
      '--transport',
      'http',
      '-s',
      'user',
      '--client-id',
      g.clientId,
      '--callback-port',
      String(g.callbackPort),
      '--client-secret',
      name,
      GCHAT_OFFICIAL_URL
    ],
    { cwd: cwd(), env: { MCP_CLIENT_SECRET: clientSecret }, timeoutMs: 30_000 }
  )
  const ok = r.code === 0
  return {
    ok,
    message:
      summarize(r) +
      (ok
        ? `\nAgora clique em "Autenticar" para fazer o login Google. Redirect URI do cliente OAuth: http://localhost:${g.callbackPort}/callback`
        : '')
  }
}

export async function integrationStatus(id: IntegrationId): Promise<OpResult> {
  const r = await runClaudeCapture(['mcp', 'get', MCP_NAMES[id]], { cwd: cwd(), timeoutMs: 45_000 })
  return { ok: r.code === 0, message: summarize(r) }
}

/** Login OAuth (abre o navegador). Fica esperando o callback por até 5 min. */
export async function integrationLogin(id: IntegrationId, onLine: (l: string) => void): Promise<OpResult> {
  const r = await runClaudeCapture(['mcp', 'login', MCP_NAMES[id]], {
    cwd: cwd(),
    timeoutMs: 5 * 60_000,
    onLine
  })
  return { ok: r.code === 0, message: summarize(r) }
}

// ---------------------------------------------------------------- teste de verdade

type Line = IntegrationCheck['lines'][number]

/** Estado de um MCP no Claude Code, lendo a saída de `claude mcp get <nome>` */
async function mcpLine(name: string, label: string, enabled: boolean): Promise<Line> {
  const r = await runClaudeCapture(['mcp', 'get', name], { cwd: cwd(), timeoutMs: 60_000 })
  const out = `${r.stdout}\n${r.stderr}`
  if (r.spawnError) return { state: 'fail', label, detail: 'Claude Code não encontrado neste PC.' }
  if (/No MCP server named/i.test(out)) {
    return enabled
      ? { state: 'fail', label, detail: 'Não está registrado no Claude. Clique em "Salvar e aplicar" de novo e veja a mensagem.' }
      : { state: 'off', label, detail: 'Desligado (o interruptor "Ativar MCP" está desmarcado).' }
  }
  const status = out.match(/Status:\s*(.+)/)?.[1]?.trim() ?? ''
  const issue = out.match(/Issue:\s*(.+)/)?.[1]?.trim() ?? ''
  if (/connected|✓|✔/i.test(status) && !/fail|✘|✗/i.test(status)) return { state: 'ok', label, detail: 'Conectado: o Claude consegue usar.' }
  if (/auth/i.test(status)) return { state: 'warn', label, detail: 'Registrado, mas falta fazer login (botão "Autenticar").' }
  let detail = issue || status || summarize(r)
  if (/uvx/i.test(detail)) detail = 'O comando uvx não foi encontrado: instale o uv (Configurações → Começar).'
  return { state: 'fail', label, detail: 'Registrado, mas não conecta: ' + detail }
}

/** Conectores da sua conta claude.ai que o Claude Code enxerga (ex: "claude.ai Atlassian") */
async function claudeAiConnectors(): Promise<string[]> {
  const r = await runClaudeCapture(['mcp', 'list'], { cwd: cwd(), timeoutMs: 90_000 })
  return [...`${r.stdout}`.matchAll(/^claude\.ai ([^:]+):.*$/gim)].map((m) => `${m[1].trim()}${/✓|connected/i.test(m[0]) ? '' : ' (sem conexão)'}`)
}

async function httpJson(url: string, headers: Record<string, string>): Promise<{ status: number; body: any; headers?: Headers; error?: string }> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 20_000)
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: ctrl.signal })
    let body: any = null
    try {
      body = await res.json()
    } catch {
      /* sem corpo JSON */
    }
    return { status: res.status, body, headers: res.headers }
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } }
    return { status: 0, body: null, error: err.name === 'AbortError' ? 'demorou demais' : err.cause?.code === 'ENOTFOUND' ? 'endereço não existe' : err.message }
  } finally {
    clearTimeout(t)
  }
}

export async function integrationCheck(id: IntegrationId, cfg: AppConfig): Promise<IntegrationCheck> {
  const lines: Line[] = []
  const name = MCP_NAMES[id]
  const connectorsP = claudeAiConnectors()

  if (id === 'jira') {
    const j = cfg.integrations.jira
    const token = secrets.get('jira.token')
    const label = 'Conta do Jira (usada pelas Demandas)'
    if (!j.url || !j.email || !token) {
      lines.push({ state: 'off', label, detail: 'Preencha URL, e-mail e API token e clique em "Salvar e aplicar".' })
    } else {
      const r = await httpJson(`${j.url.replace(/\/+$/, '')}/rest/api/2/myself`, {
        Authorization: 'Basic ' + Buffer.from(`${j.email}:${token}`).toString('base64')
      })
      if (r.status === 200) lines.push({ state: 'ok', label, detail: `Conectado como ${r.body?.displayName ?? j.email}. As Demandas já puxam os cards.` })
      else if (r.status === 401 || r.status === 403) lines.push({ state: 'fail', label, detail: 'O Jira recusou: e-mail ou API token errado (o token é o de id.atlassian.com, não a senha).' })
      else if (r.status === 0) lines.push({ state: 'fail', label, detail: `Não consegui falar com ${j.url}: ${r.error}. Confira a URL (ex: https://suaempresa.atlassian.net).` })
      else lines.push({ state: 'fail', label, detail: `O Jira respondeu HTTP ${r.status}. Confira a URL.` })
    }
    lines.push(await mcpLine(name, 'MCP ccc-jira (o Claude consulta o Jira sozinho)', j.enabled))
    const conn = (await connectorsP).filter((c) => /atlassian|jira/i.test(c))
    if (conn.length) {
      lines.push({ state: 'ok', label: 'Conector da sua conta claude.ai', detail: `${conn.join(', ')}: o Claude já acessa o Jira por aqui, então o ccc-jira é opcional.` })
    }
  }

  if (id === 'github') {
    const pat = secrets.get('github.pat')
    const label = 'Token do GitHub'
    if (!pat) lines.push({ state: 'off', label, detail: 'Sem token. (O git do card funciona sem isso: ele usa o git do seu PC.)' })
    else {
      const r = await httpJson('https://api.github.com/user', { Authorization: `Bearer ${pat}`, 'User-Agent': 'claude-command-center' })
      if (r.status === 200) lines.push({ state: 'ok', label, detail: `Token válido: conta ${r.body?.login}.` })
      else if (r.status === 401) lines.push({ state: 'fail', label, detail: 'Token inválido ou expirado.' })
      else lines.push({ state: 'fail', label, detail: r.status ? `GitHub respondeu HTTP ${r.status}.` : `Sem conexão: ${r.error}.` })
    }
    lines.push(await mcpLine(name, 'MCP ccc-github (o Claude lê PRs, issues e repos)', cfg.integrations.github.enabled))
    const conn = (await connectorsP).filter((c) => /github/i.test(c))
    if (conn.length) lines.push({ state: 'ok', label: 'Conector da sua conta claude.ai', detail: `${conn.join(', ')}: o Claude já acessa o GitHub por aqui.` })
  }

  if (id === 'gchat') {
    lines.push(await mcpLine(name, 'MCP ccc-gchat (o Vigia lê o Google Chat por ele)', cfg.integrations.gchat.enabled))
    const conn = (await connectorsP).filter((c) => /chat|google/i.test(c))
    if (conn.length) {
      lines.push({
        state: 'warn',
        label: 'Conector da sua conta claude.ai',
        detail: `${conn.join(', ')}: existe, mas o Vigia ainda só usa o ccc-gchat.`
      })
    }
  }

  const all = await connectorsP
  if (all.length) lines.push({ state: 'warn', label: 'Conectores da sua conta claude.ai (todos)', detail: all.join(' · ') })
  return { lines, at: Date.now() }
}
