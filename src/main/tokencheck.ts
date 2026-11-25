import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { OpResult, PlainToken, Project } from '../shared/types'
import { runClaudeCapture } from './proc'

/**
 * Onde há tokens guardados sem proteção: servidores MCP do Claude Code com token no `env`, nos `args`
 * ou nos cabeçalhos, em ~/.claude.json (seu usuário e cada pasta) e no .mcp.json dos projetos
 * (esse vai junto com o repositório se for commitado!). Os tokens do app ficam no cofre do sistema.
 */

const SECRET_KEY = /token|secret|password|passwd|api[_-]?key|\bkey\b|_key$|\bpat\b|auth/i
const SECRET_VALUE = /(ghp_|gho_|ghs_|github_pat_|xox[abp]-|sk-[A-Za-z0-9]|ATATT|glpat-|AIza)[A-Za-z0-9_-]{8,}/

interface McpServer {
  env?: Record<string, unknown>
  args?: unknown[]
  headers?: Record<string, unknown>
  url?: string
}

/** Quais campos de um servidor MCP carregam segredo (nomes, nunca os valores) */
export function secretFields(s: McpServer): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(s.env ?? {})) {
    if (typeof v === 'string' && v.trim() && (SECRET_KEY.test(k) || SECRET_VALUE.test(v))) out.push(`env ${k}`)
  }
  for (const [k, v] of Object.entries(s.headers ?? {})) {
    if (typeof v === 'string' && v.trim() && (/authorization|token|key/i.test(k) || SECRET_VALUE.test(v))) out.push(`cabeçalho ${k}`)
  }
  ;(s.args ?? []).forEach((a, i) => {
    if (typeof a === 'string' && (SECRET_VALUE.test(a) || /--?(token|api[_-]?key|password)=\S+/i.test(a))) out.push(`argumento ${i + 1}`)
  })
  if (typeof s.url === 'string' && /[?&](token|key|api_key)=/i.test(s.url)) out.push('endereço (url)')
  return out
}

/** Varre o conteúdo de um ~/.claude.json */
export function scanClaudeJson(raw: unknown, file: string): PlainToken[] {
  const out: PlainToken[] = []
  const j = (raw ?? {}) as { mcpServers?: Record<string, McpServer>; projects?: Record<string, { mcpServers?: Record<string, McpServer> }> }
  for (const [name, s] of Object.entries(j.mcpServers ?? {})) {
    const fields = secretFields(s ?? {})
    if (fields.length) out.push({ server: name, scope: 'user', file, fields })
  }
  for (const [path, p] of Object.entries(j.projects ?? {})) {
    for (const [name, s] of Object.entries(p?.mcpServers ?? {})) {
      const fields = secretFields(s ?? {})
      if (fields.length) out.push({ server: name, scope: 'local', projectPath: path, file, fields })
    }
  }
  return out
}

/** Varre um .mcp.json de projeto */
export function scanMcpJson(raw: unknown, file: string, projectPath: string): PlainToken[] {
  const j = (raw ?? {}) as { mcpServers?: Record<string, McpServer> }
  return Object.entries(j.mcpServers ?? {})
    .map(([name, s]) => ({ server: name, scope: 'project' as const, projectPath, file, fields: secretFields(s ?? {}) }))
    .filter((x) => x.fields.length)
}

const readJson = (f: string): unknown => {
  try {
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null
  } catch {
    return null
  }
}

export function findPlainTokens(projects: Project[], home = homedir()): PlainToken[] {
  const out: PlainToken[] = []
  const cj = join(home, '.claude.json')
  out.push(...scanClaudeJson(readJson(cj), cj))
  for (const p of projects) {
    if (!p.path) continue
    const f = join(p.path, '.mcp.json')
    out.push(...scanMcpJson(readJson(f), f, p.path))
  }
  return out
}

/** Tira o servidor MCP da configuração do Claude Code (o token sai junto) */
export async function removeMcp(t: Pick<PlainToken, 'server' | 'scope' | 'projectPath'>): Promise<OpResult> {
  if (!/^[\w.@:-]+$/.test(t.server)) return { ok: false, message: 'Nome de servidor inválido.' }
  const cwd = t.scope === 'user' ? homedir() : (t.projectPath ?? homedir())
  if (!existsSync(cwd)) return { ok: false, message: `Pasta não encontrada: ${cwd}` }
  const r = await runClaudeCapture(['mcp', 'remove', t.server, '-s', t.scope], { cwd, timeoutMs: 30_000 })
  if (r.code === 0) return { ok: true, message: `MCP ${t.server} removido (o token saiu junto).` }
  const why = `${r.stderr ?? ''}${r.stdout ?? ''}`.trim().split('\n').slice(-1)[0]
  return { ok: false, message: `Não consegui remover ${t.server}: ${why || 'o Claude Code recusou'}` }
}
