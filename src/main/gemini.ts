import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { MCP_NAMES, type AppConfig, type OpResult } from '../shared/types'
import { GCHAT_OFFICIAL_READ_TOOLS, GCHAT_OFFICIAL_WRITE_TOOLS } from './mcp'
import { runGeminiCapture } from './proc'
import { secrets } from './secrets'

/**
 * Gemini CLI como segundo provedor de IA (triagem do Vigia, console, scripts).
 *
 * Trava de só-leitura no Vigia:
 *   - --allowed-mcp-server-names ccc-gchat → só o servidor do Google Chat é carregado
 *   - política em ~/.gemini/policies/claude-command-center.toml, só para execuções sem terminal
 *     (interactive = false), liberando as ferramentas de leitura do ccc-gchat e negando as de escrita
 *   - sem terminal, tudo que pediria aprovação (shell, editar arquivo…) vira "deny" no próprio CLI
 */

export const POLICY_FILE = join(homedir(), '.gemini', 'policies', 'claude-command-center.toml')
const SERVER = MCP_NAMES.gchat

export function geminiReadTools(cfg: AppConfig): string[] {
  if (cfg.integrations.gchat.mode === 'official') return GCHAT_OFFICIAL_READ_TOOLS
  return simpleToolNames(cfg.integrations.gchat.readTools)
}

export function geminiWriteTools(cfg: AppConfig): string[] {
  if (cfg.integrations.gchat.mode === 'official') return GCHAT_OFFICIAL_WRITE_TOOLS
  return simpleToolNames(cfg.integrations.gchat.sendTool)
}

/** "mcp__ccc-gchat__list_messages, search" → ["list_messages", "search"] */
function simpleToolNames(list: string): string[] {
  return list
    .split(/[\s,]+/)
    .map((t) => t.trim().replace(/^mcp__[\w-]+__/, ''))
    .filter((t) => /^[\w.-]+$/.test(t))
}

/** Escreve (só se mudou) o arquivo de política do app. Não mexe em nenhuma outra política sua. */
export function ensureWatcherPolicy(cfg: AppConfig): OpResult {
  const reads = geminiReadTools(cfg)
  const writes = geminiWriteTools(cfg)
  if (!reads.length) return { ok: false, message: 'Informe as ferramentas de leitura do Google Chat.' }
  const rule = (tool: string, decision: 'allow' | 'deny', priority: number) =>
    ['[[rule]]', `mcpName = "${SERVER}"`, `toolName = "${tool}"`, `decision = "${decision}"`, `priority = ${priority}`, 'interactive = false', ''].join('\n')
  const content = [
    '# Gerado pelo Claude Command Center para o Modo Vigia (só execuções sem terminal).',
    '# Libera apenas a LEITURA do Google Chat e nega o envio. Apague este arquivo se não usar mais o Vigia com Gemini.',
    '',
    ...writes.map((t) => rule(t, 'deny', 950)),
    ...reads.map((t) => rule(t, 'allow', 900))
  ].join('\n')
  try {
    if (existsSync(POLICY_FILE) && readFileSync(POLICY_FILE, 'utf-8') === content) return { ok: true, message: 'Política já atualizada.' }
    mkdirSync(join(homedir(), '.gemini', 'policies'), { recursive: true })
    writeFileSync(POLICY_FILE, content, 'utf-8')
    return { ok: true, message: `Política escrita em ${POLICY_FILE}` }
  } catch (err) {
    return { ok: false, message: `Não consegui escrever a política: ${(err as Error).message}` }
  }
}

export async function geminiCheck(): Promise<OpResult> {
  const r = await runGeminiCapture(['--version'], { cwd: homedir(), timeoutMs: 30_000 })
  if (r.spawnError) return { ok: false, message: r.spawnError }
  const out = (r.stdout || r.stderr).trim().split('\n').slice(-1)[0] ?? ''
  return { ok: r.code === 0, message: r.code === 0 ? `Gemini CLI encontrado: ${out}` : out || `código ${r.code}` }
}

/**
 * Registra o ccc-gchat no Gemini (escopo user) a partir do mesmo JSON usado no Claude (modo personalizado).
 * O modo oficial (OAuth do Google) precisa ser configurado no próprio Gemini, com o nome ccc-gchat.
 */
export async function geminiSetup(cfg: AppConfig): Promise<OpResult> {
  const policy = ensureWatcherPolicy(cfg)
  if (!policy.ok) return policy

  if (cfg.integrations.gchat.mode === 'official') {
    return {
      ok: true,
      message:
        policy.message +
        `\nModo oficial: configure o servidor do Google Chat no Gemini com o nome "${SERVER}" (o Google documenta isso como extensão com credenciais ADC). O app não consegue fazer esse login por você.`
    }
  }

  const raw = secrets.get('gchat.customJson')
  if (!raw) return { ok: false, message: 'Cole o JSON do servidor do Google Chat em Integrações.' }
  let json: Record<string, unknown>
  try {
    json = JSON.parse(raw)
  } catch {
    return { ok: false, message: 'JSON do servidor inválido.' }
  }

  await runGeminiCapture(['mcp', 'remove', '--scope', 'user', SERVER], { cwd: homedir(), timeoutMs: 30_000 })

  const args = ['mcp', 'add', '--scope', 'user']
  const url = typeof json.url === 'string' ? json.url : typeof json.httpUrl === 'string' ? json.httpUrl : ''
  if (url) {
    args.push('--transport', json.type === 'sse' ? 'sse' : 'http')
    for (const [k, v] of Object.entries((json.headers as Record<string, string>) ?? {})) args.push('--header', `${k}: ${v}`)
    args.push(SERVER, url)
  } else if (typeof json.command === 'string') {
    for (const [k, v] of Object.entries((json.env as Record<string, string>) ?? {})) args.push('--env', `${k}=${v}`)
    args.push(SERVER, json.command)
    const extra = Array.isArray(json.args) ? (json.args as unknown[]).map(String) : []
    if (extra.length) args.push('--', ...extra)
  } else {
    return { ok: false, message: 'O JSON precisa ter "command" (stdio) ou "url" (http).' }
  }

  const r = await runGeminiCapture(args, { cwd: homedir(), timeoutMs: 30_000 })
  const msg = r.spawnError ?? ((r.stdout + '\n' + r.stderr).trim().split('\n').slice(-3).join('\n') || `código ${r.code}`)
  return { ok: !r.spawnError && r.code === 0, message: `${policy.message}\n${msg}` }
}

/** Argumentos do ciclo do Vigia com Gemini */
export function geminiWatcherArgs(cfg: AppConfig): string[] {
  const args = ['--output-format', 'json', '--approval-mode', 'default', '--allowed-mcp-server-names', SERVER]
  if (cfg.watcher.model && /^[\w.-]+$/.test(cfg.watcher.model)) args.push('--model', cfg.watcher.model)
  return args
}
