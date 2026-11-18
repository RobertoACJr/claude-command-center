import { homedir } from 'os'
import { spawnSync } from 'child_process'
import { MCP_NAMES, type AppConfig, type IntegrationId, type OpResult } from '../shared/types'
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
