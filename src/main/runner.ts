import type { ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { randomUUID } from 'crypto'
import type { RunEvent, RunLineKind, RunRequest } from '../shared/types'
import { IS_WIN, LineSplitter, killTree, killTreeSync, spawnClaude, spawnCodex, spawnGemini, spawnShell } from './proc'

type Emit = (e: RunEvent) => void
type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type EventNoTab = DistOmit<RunEvent, 'tab'>

const VAR_RE = /\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Comandos de terminal: {{var}} vira referência a variável de ambiente.
 * O valor nunca é colado no texto do comando, então `main; rm -rf ~` é só uma string.
 *   bash:       "${CCC_branch}"
 *   PowerShell: $env:CCC_branch   (expande também dentro de "aspas duplas")
 */
export function buildTerminalCommand(content: string, values: Record<string, string> = {}) {
  const env: Record<string, string> = {}
  const command = content.replace(VAR_RE, (_all, name: string) => {
    const key = 'CCC_' + name.replace(/[^\w]/g, '_')
    env[key] = values[name] ?? ''
    return IS_WIN ? `$env:${key}` : `"\${${key}}"`
  })
  return { command, env }
}

export function fillPrompt(content: string, values: Record<string, string> = {}): string {
  return content.replace(VAR_RE, (_all, name: string) => values[name] ?? '')
}

function summarizeToolInput(name: string, input: Record<string, unknown> | undefined): string {
  if (!input) return name
  const pick =
    input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.url ?? input.query ?? input.description
  const s = typeof pick === 'string' ? pick : ''
  return s ? `${name}: ${s.length > 140 ? s.slice(0, 140) + '…' : s}` : name
}

export class RunManager {
  private runs = new Map<string, ChildProcess>()
  private stopped = new Set<string>()

  /** runId → aba do painel de Terminais */
  private tabs = new Map<string, string>()

  constructor(private emitRaw: Emit) {}

  private emit(e: EventNoTab): void {
    this.emitRaw({ ...e, tab: this.tabs.get(e.runId) ?? 'console' } as RunEvent)
    if (e.type === 'exit') this.tabs.delete(e.runId)
  }

  private claudeArgsProvider: ((runId: string, req: RunRequest) => string[]) | null = null

  /** Quem decide os argumentos de permissão do Claude (o servidor de aprovação, no index) */
  setClaudeArgsProvider(fn: (runId: string, req: RunRequest) => string[]): void {
    this.claudeArgsProvider = fn
  }

  isRunning(runId: string | undefined): boolean {
    return !!runId && this.runs.has(runId)
  }

  start(req: RunRequest): string {
    const runId = randomUUID()
    const cwd = req.cwd
    this.tabs.set(runId, req.tab || 'console')
    this.emit({
      runId,
      type: 'start',
      title: req.title || req.label || 'Execução',
      kind: req.kind,
      startedAt: Date.now(),
      cwd,
      projectId: req.projectId,
      origin: req.origin ?? 'app'
    })

    if (!cwd || !existsSync(cwd)) {
      setTimeout(() => {
        this.emit({ runId, type: 'error', message: `Pasta não encontrada: ${cwd}` })
        this.emit({ runId, type: 'exit', code: 1, signal: null, killed: false })
      })
      return runId
    }

    let child: ChildProcess
    try {
      child =
        req.kind === 'terminal'
          ? this.startTerminal(runId, req)
          : req.kind === 'gemini'
            ? this.startGemini(runId, req)
            : req.kind === 'codex'
              ? this.startCodex(runId, req)
              : this.startClaude(runId, req)
    } catch (err) {
      setTimeout(() => {
        this.emit({ runId, type: 'error', message: String(err) })
        this.emit({ runId, type: 'exit', code: 1, signal: null, killed: false })
      })
      return runId
    }

    this.runs.set(runId, child)

    child.on('error', (err: NodeJS.ErrnoException) => {
      const msg =
        err.code === 'ENOENT'
          ? req.kind === 'claude'
            ? 'CLI `claude` não encontrado no PATH. Instale o Claude Code e confira com `claude --version`.'
            : req.kind === 'gemini' || req.kind === 'codex'
              ? `CLI do ${req.kind === 'gemini' ? 'Gemini' : 'Codex (ChatGPT)'} não encontrado. Veja Configurações → Começar.`
              : 'Shell não encontrado.'
          : err.message
      this.emit({ runId, type: 'error', message: msg })
    })
    child.on('close', (code, signal) => {
      this.runs.delete(runId)
      if (code === 127 && req.kind !== 'terminal') {
        const name = { claude: 'Claude Code', gemini: 'Gemini', codex: 'Codex (ChatGPT)' }[req.kind]
        this.emit({ runId, type: 'error', message: `${name} não está instalado (ou não está no PATH). Veja Configurações → Começar.` })
      }
      const killed = this.stopped.delete(runId)
      this.emit({ runId, type: 'exit', code, signal: signal ?? null, killed })
    })
    return runId
  }

  private pipeLines(runId: string, child: ChildProcess, mapStdout?: (line: string) => void) {
    // Agrupa linhas a cada 40ms para não inundar o IPC
    let pending: Array<{ kind: RunLineKind; text: string }> = []
    let timer: NodeJS.Timeout | null = null
    const flush = () => {
      timer = null
      if (pending.length) {
        this.emit({ runId, type: 'lines', lines: pending })
        pending = []
      }
    }
    const push = (kind: RunLineKind, text: string) => {
      pending.push({ kind, text })
      if (!timer) timer = setTimeout(flush, 40)
    }

    const out = new LineSplitter()
    const err = new LineSplitter()
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (d: string) =>
      out.push(d).forEach((l) => (mapStdout ? mapStdout(l) : push('stdout', l)))
    )
    child.stderr?.on('data', (d: string) => err.push(d).forEach((l) => push('stderr', l)))
    child.on('close', () => {
      out.flush().forEach((l) => (mapStdout ? mapStdout(l) : push('stdout', l)))
      err.flush().forEach((l) => push('stderr', l))
      flush()
    })
    return push
  }

  private startTerminal(runId: string, req: RunRequest): ChildProcess {
    // Sem `variables` (texto digitado no console) o comando vai literal
    const { command, env } = req.variables
      ? buildTerminalCommand(req.content, req.variables)
      : { command: req.content, env: {} }
    const child = spawnShell(command, req.cwd, env, !!req.interactive)
    child.stdin?.on('error', () => {})
    this.pipeLines(runId, child)
    return child
  }

  /** Manda uma linha para o stdin de uma execução interativa (projetos e comandos do console) */
  sendInput(runId: string, text: string): boolean {
    const child = this.runs.get(runId)
    if (!child?.stdin || child.stdin.destroyed || !child.stdin.writable) return false
    child.stdin.write(text + (IS_WIN ? '\r\n' : '\n'))
    return true
  }

  private startClaude(runId: string, req: RunRequest): ChildProcess {
    const prompt = req.variables ? fillPrompt(req.content, req.variables) : req.content
    const args = ['-p', '--output-format', 'stream-json', '--verbose']
    if (req.resumeSessionId && UUID_RE.test(req.resumeSessionId)) args.push('--resume', req.resumeSessionId)
    // Permissões: ferramenta de aprovação do app + regras/modo do projeto
    if (this.claudeArgsProvider) args.push(...this.claudeArgsProvider(runId, req))
    for (const d of req.addDirs ?? []) args.push('--add-dir', d)
    // Análise: só leitura, nada de editar arquivo ou rodar comando
    if (req.readOnly) args.push('--disallowedTools', 'Edit,Write,MultiEdit,NotebookEdit,Bash')

    // A aprovação pode esperar você responder: dá tempo de sobra para a ferramenta MCP
    const child = spawnClaude(args, req.cwd, { stdin: true, env: { MCP_TOOL_TIMEOUT: '660000' } })
    let sentSession = false

    const push = this.pipeLines(runId, child, (line) => {
      if (!line.trim()) return
      let msg: Record<string, any>
      try {
        msg = JSON.parse(line)
      } catch {
        return push('stdout', line)
      }

      if (msg.session_id && !sentSession) {
        sentSession = true
        this.emit({ runId, type: 'session', sessionId: msg.session_id })
      }

      switch (msg.type) {
        case 'assistant': {
          for (const block of msg.message?.content ?? []) {
            if (block.type === 'text' && block.text?.trim()) {
              block.text.split('\n').forEach((t: string) => push('claude', t))
            } else if (block.type === 'tool_use') {
              push('tool', '⚙ ' + summarizeToolInput(block.name, block.input))
            }
          }
          break
        }
        case 'user': {
          for (const block of msg.message?.content ?? []) {
            if (block.type === 'tool_result' && block.is_error) {
              const text = typeof block.content === 'string' ? block.content : JSON.stringify(block.content)
              push('stderr', '  ↳ ' + text.split('\n')[0].slice(0, 200))
            }
          }
          break
        }
        case 'result': {
          const secs = msg.duration_ms ? (msg.duration_ms / 1000).toFixed(1) + 's' : ''
          const cost = typeof msg.total_cost_usd === 'number' ? ` · US$ ${msg.total_cost_usd.toFixed(4)}` : ''
          const turns = msg.num_turns ? ` · ${msg.num_turns} turno(s)` : ''
          if (msg.is_error) push('stderr', `Claude terminou com erro: ${msg.result ?? msg.subtype}`)
          if (Array.isArray(msg.permission_denials) && msg.permission_denials.length) {
            push(
              'info',
              `⚠ ${msg.permission_denials.length} ação(ões) bloqueadas por permissão (modo -p não pode pedir aprovação).`
            )
          }
          push('info', `✓ concluído ${secs}${turns}${cost}`)
          const u = msg.usage ?? {}
          const tk = (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
          this.emit({ runId, type: 'usage', costUsd: typeof msg.total_cost_usd === 'number' ? msg.total_cost_usd : null, tokens: tk || null })
          break
        }
      }
    })

    child.stdin?.on('error', () => {
      /* processo morreu antes de ler o stdin */
    })
    child.stdin?.end(prompt)
    return child
  }

  /**
   * Gemini CLI em modo não interativo, com eventos em JSONL (--output-format stream-json).
   * Sem terminal, tudo que pediria aprovação (shell, editar arquivo…) é negado pelo próprio CLI.
   */
  private startGemini(runId: string, req: RunRequest): ChildProcess {
    const prompt = req.variables ? fillPrompt(req.content, req.variables) : req.content
    const args = ['--output-format', 'stream-json', '--approval-mode', 'default']
    if (req.resumeSessionId && /^[\w-]{6,80}$/.test(req.resumeSessionId)) args.push('--resume', req.resumeSessionId)
    const child = spawnGemini(args, req.cwd, { stdin: true })
    let sentSession = false
    let text = '' // pedaços (delta) da resposta até fechar uma linha

    // Emite as linhas completas; com all=true, também o resto que ficou sem \n
    const flushText = (all: boolean) => {
      const parts = text.split('\n')
      text = parts.pop() ?? ''
      for (const l of parts) push('claude', l)
      if (all && text) {
        push('claude', text)
        text = ''
      }
    }

    const push = this.pipeLines(runId, child, (line) => {
      if (!line.trim()) return
      let msg: Record<string, any>
      try {
        msg = JSON.parse(line)
      } catch {
        return push('stdout', line)
      }
      const sid = msg.session_id ?? msg.sessionId
      if (sid && !sentSession && typeof sid === 'string') {
        sentSession = true
        this.emit({ runId, type: 'session', sessionId: sid })
      }
      switch (msg.type) {
        case 'message': {
          if (msg.role === 'user') break
          const c = typeof msg.content === 'string' ? msg.content : typeof msg.text === 'string' ? msg.text : ''
          text += c
          if (!msg.delta) text += '\n'
          flushText(false)
          break
        }
        case 'tool_use': {
          flushText(true)
          const name = msg.tool_name ?? msg.name ?? 'ferramenta'
          push('tool', '⚙ ' + summarizeToolInput(String(name), msg.parameters ?? msg.args ?? msg.input))
          break
        }
        case 'tool_result':
          if (msg.status === 'error' || msg.error) {
            const t = typeof msg.error === 'string' ? msg.error : (msg.error?.message ?? msg.output ?? 'erro')
            push('stderr', '  ↳ ' + String(t).split('\n')[0].slice(0, 200))
          }
          break
        case 'error':
          push('stderr', String(msg.message ?? msg.error ?? 'erro'))
          break
        case 'result': {
          flushText(true)
          if (msg.status === 'error' || msg.error) push('stderr', `Gemini terminou com erro: ${msg.error?.message ?? msg.error ?? ''}`)
          const st = msg.stats ?? {}
          const tokens = st.total_tokens ?? st.totalTokens
          const ms = st.duration_ms ?? st.durationMs
          push('info', `✓ concluído${ms ? ` ${(ms / 1000).toFixed(1)}s` : ''}${tokens ? ` · ${tokens} tokens` : ''}`)
          this.emit({ runId, type: 'usage', costUsd: null, tokens: typeof tokens === 'number' ? tokens : null })
          break
        }
      }
    })

    child.on('close', () => {
      if (text.trim()) push('claude', text)
      text = ''
    })
    child.stdin?.on('error', () => {})
    child.stdin?.end(prompt)
    return child
  }

  /**
   * ChatGPT via Codex CLI: `codex exec --json -` (prompt pelo stdin), no sandbox padrão SÓ DE LEITURA.
   * Cada mensagem é uma conversa nova.
   */
  private startCodex(runId: string, req: RunRequest): ChildProcess {
    const prompt = req.variables ? fillPrompt(req.content, req.variables) : req.content
    const child = spawnCodex(['exec', '--json', '--skip-git-repo-check', '-'], req.cwd, { stdin: true })
    const push = this.pipeLines(runId, child, (line) => {
      if (!line.trim()) return
      let msg: Record<string, any>
      try {
        msg = JSON.parse(line)
      } catch {
        return push('stdout', line)
      }
      const item = msg.item ?? {}
      switch (msg.type) {
        case 'item.completed':
          if (item.type === 'agent_message' && typeof item.text === 'string') {
            item.text.split('\n').forEach((t: string) => push('claude', t))
          } else if (item.type === 'command_execution') {
            push('tool', `⚙ ${item.command ?? 'comando'}${item.status && item.status !== 'completed' ? ` (${item.status})` : ''}`)
          } else if (item.type === 'file_change') {
            push('tool', '⚙ alteração de arquivo (bloqueada no modo só leitura)')
          } else if (item.type === 'mcp_tool_call') {
            push('tool', `⚙ ${item.server ?? 'mcp'}.${item.tool ?? ''}`)
          } else if (item.type === 'web_search') {
            push('tool', `⚙ busca: ${item.query ?? ''}`)
          }
          break
        case 'turn.failed':
          push('stderr', `ChatGPT falhou: ${msg.error?.message ?? 'erro'}`)
          break
        case 'error':
          push('stderr', String(msg.message ?? 'erro'))
          break
        case 'turn.completed': {
          const u = msg.usage ?? {}
          const tokens = (u.input_tokens ?? 0) + (u.output_tokens ?? 0)
          push('info', `✓ concluído${tokens ? ` · ${tokens} tokens` : ''}`)
          this.emit({ runId, type: 'usage', costUsd: null, tokens: tokens || null })
          break
        }
      }
    })
    child.stdin?.on('error', () => {})
    child.stdin?.end(prompt)
    return child
  }

  /** Para a execução: pede para sair e força depois de `graceMs` */
  async stop(runId: string, graceMs?: number): Promise<void> {
    const child = this.runs.get(runId)
    if (!child) return
    this.stopped.add(runId)
    await killTree(child, graceMs)
  }

  stopAllSync(): void {
    for (const child of this.runs.values()) killTreeSync(child)
    this.runs.clear()
  }
}
