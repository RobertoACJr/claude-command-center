import { createServer, type Server } from 'http'
import { app } from 'electron'
import { randomBytes, randomUUID } from 'crypto'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { ApprovalDecision, ApprovalRequest, AppConfig, RunRequest } from '../shared/types'

/**
 * Aprovação de permissões do Claude dentro do app.
 *
 * Em `claude -p` não há terminal para perguntar "posso rodar git status?". O Claude Code aceita uma ferramenta MCP
 * que responde por ele (--permission-prompt-tool). Este módulo:
 *   1. escreve um mini servidor MCP (stdio) em userData, executado pelo próprio Electron como Node;
 *   2. abre um HTTP só em 127.0.0.1, com token aleatório, por onde esse servidor pergunta ao app;
 *   3. mostra a janela "Permitir / Negar / Sempre permitir" (e manda para o Telegram no modo Ausente).
 * Sem resposta em 10 minutos, nega.
 */

const MCP_NAME = 'ccc-approval'
const TOOL = `mcp__${MCP_NAME}__approve`
const TIMEOUT_MS = 10 * 60_000

/** Código do servidor MCP (CommonJS, só módulos do Node, sem dependências) */
const MCP_SCRIPT = String.raw`
const http = require('http')
const URL_ = process.env.CCC_APPROVAL_URL
const TOKEN = process.env.CCC_APPROVAL_TOKEN
const RUN = process.env.CCC_RUN_ID || ''
let buf = ''
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n')
function ask(params) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ run: RUN, tool_name: params.tool_name, input: params.input || {} })
    const req = http.request(URL_, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN } }, (res) => {
      let data = ''
      res.on('data', (d) => (data += d))
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch { resolve({ decision: 'deny' }) } })
    })
    req.on('error', () => resolve({ decision: 'deny', message: 'App indisponível' }))
    req.end(body)
  })
}
async function handle(m) {
  if (m.method === 'initialize') return send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: (m.params && m.params.protocolVersion) || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'ccc-approval', version: '1.0.0' } } })
  if (m.method === 'ping') return send({ jsonrpc: '2.0', id: m.id, result: {} })
  if (m.method === 'tools/list') return send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'approve', description: 'Pede permissão ao usuário no Claude Command Center', inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } }, required: ['tool_name', 'input'] } }] } })
  if (m.method === 'tools/call') {
    const args = (m.params && m.params.arguments) || {}
    const r = await ask(args)
    const out = r.decision === 'allow' ? { behavior: 'allow', updatedInput: args.input || {} } : { behavior: 'deny', message: r.message || 'Negado pelo usuário no Claude Command Center.' }
    return send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: JSON.stringify(out) }] } })
  }
  if (m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Método desconhecido' } })
}
process.stdin.on('data', (d) => {
  buf += d
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim()
    buf = buf.slice(i + 1)
    if (!line) continue
    try { handle(JSON.parse(line)) } catch {}
  }
})
`

interface Pending {
  req: ApprovalRequest
  resolve: (d: { decision: 'allow' | 'deny'; message?: string }) => void
  timer: NodeJS.Timeout
}

/** Resumo legível + regra "sempre permitir" no formato do Claude Code */
export function describeTool(toolName: string, input: Record<string, unknown>): { summary: string; rule: string } {
  const str = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  if (toolName === 'Bash') {
    const cmd = str('command').trim()
    // Regra pelas duas primeiras palavras do comando (ex: "git status" → Bash(git status:*))
    const words = cmd.split(/\s+/).filter((w) => /^[\w./@:=-]+$/.test(w)).slice(0, 2)
    return { summary: cmd, rule: words.length ? `Bash(${words.join(' ')}:*)` : 'Bash' }
  }
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Read'].includes(toolName)) {
    return { summary: str('file_path') || str('notebook_path'), rule: toolName }
  }
  if (toolName === 'WebFetch') {
    let host = ''
    try {
      host = new URL(str('url')).hostname
    } catch {
      /* ignore */
    }
    return { summary: str('url'), rule: host ? `WebFetch(domain:${host})` : 'WebFetch' }
  }
  return { summary: JSON.stringify(input).slice(0, 300), rule: toolName }
}

export class ApprovalServer {
  private server: Server | null = null
  private url = ''
  private token = randomBytes(24).toString('hex')
  private scriptPath = ''
  private pending = new Map<string, Pending>()
  /** runId → projeto (para nome e regras) */
  private runs = new Map<string, { projectId: string; scopeName: string; configPath: string }>()

  constructor(
    private hooks: {
      onRequest: (r: ApprovalRequest) => void
      onResolved: (id: string) => void
    }
  ) {}

  async start(): Promise<void> {
    const dir = join(app.getPath('userData'), 'approval')
    mkdirSync(dir, { recursive: true })
    this.scriptPath = join(dir, 'approval-mcp.cjs')
    writeFileSync(this.scriptPath, MCP_SCRIPT, 'utf-8')

    this.server = createServer((req, res) => {
      if (req.method !== 'POST' || req.headers.authorization !== `Bearer ${this.token}`) {
        res.writeHead(403).end()
        return
      }
      let body = ''
      req.on('data', (d) => {
        body += d
        if (body.length > 1_000_000) req.destroy()
      })
      req.on('end', () => {
        let msg: { run?: string; tool_name?: string; input?: Record<string, unknown> }
        try {
          msg = JSON.parse(body)
        } catch {
          res.writeHead(400).end()
          return
        }
        void this.ask(String(msg.run ?? ''), String(msg.tool_name ?? '?'), msg.input ?? {}).then((d) => {
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(d))
        })
      })
    })
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', () => resolve()))
    const addr = this.server.address()
    this.url = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/approve`
  }

  /**
   * Argumentos extras para um `claude -p`: liga a ferramenta de aprovação e aplica o modo do projeto.
   * Chamado pelo RunManager antes de iniciar cada execução do Claude.
   */
  claudeArgs(runId: string, req: RunRequest, cfg: AppConfig): string[] {
    const project = cfg.projects.find((p) => p.id === req.projectId)
    const perms = project ?? cfg.claudeGlobal
    const args: string[] = []
    if (perms.allowedTools.length) args.push('--allowedTools', perms.allowedTools.join(','))
    if (perms.claudeMode === 'edits') args.push('--permission-mode', 'acceptEdits')
    if (perms.claudeMode === 'readonly' || !this.server) return args

    const configPath = join(app.getPath('userData'), 'approval', `run-${runId}.json`)
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          [MCP_NAME]: {
            type: 'stdio',
            command: process.execPath,
            args: [this.scriptPath],
            env: { ELECTRON_RUN_AS_NODE: '1', CCC_APPROVAL_URL: this.url, CCC_APPROVAL_TOKEN: this.token, CCC_RUN_ID: runId }
          }
        }
      }),
      { encoding: 'utf-8', mode: 0o600 }
    )
    this.runs.set(runId, { projectId: project?.id ?? '', scopeName: project?.name ?? 'Global', configPath })
    args.push('--mcp-config', configPath, '--permission-prompt-tool', TOOL)
    return args
  }

  /** Fim da execução: apaga o arquivo temporário e nega o que ficou pendente dela */
  runEnded(runId: string): void {
    const info = this.runs.get(runId)
    if (info) {
      try {
        rmSync(info.configPath, { force: true })
      } catch {
        /* ignore */
      }
      this.runs.delete(runId)
    }
    for (const [id, p] of this.pending) if (p.req.runId === runId) this.finish(id, { decision: 'deny', message: 'Execução encerrada.' })
  }

  list(): ApprovalRequest[] {
    return [...this.pending.values()].map((p) => p.req)
  }

  get(id: string): ApprovalRequest | undefined {
    return this.pending.get(id)?.req
  }

  private ask(runId: string, toolName: string, input: Record<string, unknown>): Promise<{ decision: 'allow' | 'deny'; message?: string }> {
    const info = this.runs.get(runId)
    const { summary, rule } = describeTool(toolName, input)
    const req: ApprovalRequest = {
      id: randomUUID(),
      runId,
      projectId: info?.projectId ?? '',
      scopeName: info?.scopeName ?? 'Global',
      toolName,
      summary,
      detail: JSON.stringify(input, null, 2).slice(0, 4000),
      rule,
      createdAt: Date.now()
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.finish(req.id, { decision: 'deny', message: 'Sem resposta em 10 minutos.' }), TIMEOUT_MS)
      this.pending.set(req.id, { req, resolve, timer })
      this.hooks.onRequest(req)
    })
  }

  /** Resposta do usuário (app ou Telegram). "always" permite e grava a regra (quem grava é o chamador). */
  respond(id: string, decision: ApprovalDecision): ApprovalRequest | undefined {
    const p = this.pending.get(id)
    if (!p) return undefined
    this.finish(id, decision === 'deny' ? { decision: 'deny' } : { decision: 'allow' })
    return p.req
  }

  private finish(id: string, d: { decision: 'allow' | 'deny'; message?: string }): void {
    const p = this.pending.get(id)
    if (!p) return
    clearTimeout(p.timer)
    this.pending.delete(id)
    p.resolve(d)
    this.hooks.onResolved(id)
  }

  stop(): void {
    for (const id of [...this.pending.keys()]) this.finish(id, { decision: 'deny', message: 'App fechado.' })
    this.server?.close()
  }
}
