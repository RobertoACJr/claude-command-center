import { homedir } from 'os'
import { createHash, randomUUID } from 'crypto'
import { MCP_NAMES, type AppConfig, type AppLog, type DeployAlert, type WatcherState } from '../shared/types'
import { GCHAT_OFFICIAL_READ_TOOLS, GCHAT_OFFICIAL_WRITE_TOOLS } from './mcp'
import { runClaudeCapture } from './proc'
import { store } from './store'
import { secrets } from './secrets'
import { formatAlert, sendTelegram } from './telegram'

const CYCLE_TIMEOUT_MS = 4 * 60_000
const FIRST_LOOKBACK_MS = 6 * 60 * 60_000
const OVERLAP_MS = 2 * 60_000

/**
 * Modo Vigia: a cada N minutos pede ao Claude Code (claude -p) para LER o Google Chat
 * e listar pedidos de deploy. Regra de segurança garantida por permissão, não só por prompt:
 *   --tools ""                → nenhuma ferramenta embutida (sem Bash, Edit, Write, WebFetch…)
 *   --allowedTools            → só as ferramentas de leitura do MCP do Google Chat
 *   --disallowedTools         → bloqueio explícito das de escrita (deny vence allow)
 *   --permission-mode default → ignora um "bypassPermissions" que esteja nas suas configs
 * O Claude só devolve JSON; quem manda o Telegram é o app.
 */
export class Watcher {
  private timer: NodeJS.Timeout | null = null
  private active = false
  private intervalMin = 0
  private running = false
  private state: WatcherState = { phase: 'off', reason: 'Desligado', nextAt: null, lastResult: null }

  constructor(
    private notify: (s: WatcherState) => void,
    private log: (l: AppLog) => void
  ) {}

  getState(): WatcherState {
    return { ...this.state }
  }

  private set(patch: Partial<WatcherState>) {
    this.state = { ...this.state, ...patch }
    this.notify(this.getState())
  }

  /** Chamado a cada mudança de config */
  evaluate(cfg: AppConfig): void {
    const w = cfg.watcher
    const wants = w.enabled || (w.autoWhenOff && cfg.status === 'off')
    const why = w.enabled ? 'Ligado manualmente' : 'Ligado automaticamente (status OFF)'

    let blocked: string | null = null
    if (wants && !cfg.integrations.gchat.enabled) blocked = 'Configure o Google Chat em Configurações → Integrações.'
    else if (wants && cfg.integrations.gchat.mode === 'custom' && toolList(cfg).allowed.length === 0)
      blocked = 'Modo personalizado: informe as ferramentas de leitura permitidas.'

    if (!wants || blocked) {
      if (this.active) this.log({ kind: 'info', text: '[Vigia] desligado' })
      this.active = false
      this.clearTimer()
      this.set({ phase: blocked ? 'blocked' : 'off', reason: blocked ?? 'Desligado', nextAt: null })
      return
    }

    const intervalChanged = this.intervalMin !== w.intervalMin
    this.intervalMin = w.intervalMin
    if (!this.active) {
      this.active = true
      this.log({ kind: 'info', text: `[Vigia] ligado · a cada ${w.intervalMin} min · ${why.toLowerCase()}` })
      this.schedule(2000)
    } else if (intervalChanged && !this.running) {
      this.schedule(w.intervalMin * 60_000)
    }
    if (!this.running) this.set({ phase: 'idle', reason: why })
  }

  runNow(): void {
    if (this.running) return
    this.schedule(0)
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule(ms: number) {
    this.clearTimer()
    this.set({ nextAt: Date.now() + ms })
    this.timer = setTimeout(() => void this.cycle(), ms)
  }

  private async cycle(): Promise<void> {
    const cfg = store.get()
    if (!this.active || this.running) return
    this.running = true
    this.set({ phase: 'checking', nextAt: null })
    const startedAt = Date.now()

    try {
      const { allowed, disallowed } = toolList(cfg)
      const args = [
        '-p',
        '--output-format',
        'json',
        '--tools',
        '',
        '--permission-mode',
        'default',
        '--allowedTools',
        allowed.join(','),
        '--max-budget-usd',
        '1'
      ]
      if (disallowed.length) args.push('--disallowedTools', disallowed.join(','))
      if (cfg.watcher.model && /^[\w.-]+$/.test(cfg.watcher.model)) args.push('--model', cfg.watcher.model)

      const r = await runClaudeCapture(args, {
        cwd: homedir(),
        stdin: buildPrompt(cfg, startedAt),
        timeoutMs: CYCLE_TIMEOUT_MS
      })

      if (r.spawnError || r.timedOut) throw new Error(r.spawnError ?? 'Tempo esgotado (4 min).')

      const envelope = parseLastJson(r.stdout) as
        | { result?: string; is_error?: boolean; total_cost_usd?: number; permission_denials?: unknown[] }
        | null
      if (!envelope) throw new Error((r.stderr || r.stdout).trim().split('\n').slice(-2).join(' ') || `código ${r.code}`)
      if (envelope.is_error) throw new Error(`Claude: ${String(envelope.result ?? 'erro').slice(0, 300)}`)

      if (Array.isArray(envelope.permission_denials) && envelope.permission_denials.length) {
        this.log({
          kind: 'tool',
          text: `[Vigia] ${envelope.permission_denials.length} tentativa(s) de ferramenta bloqueada(s) pela regra de só-leitura.`
        })
      }

      const payload = parseLastJson(String(envelope.result ?? '')) as { requests?: unknown[] } | null
      if (!payload || !Array.isArray(payload.requests)) throw new Error('Resposta do Claude sem o JSON esperado.')

      const seen = new Set(cfg.watcher.seen)
      const fresh: DeployAlert[] = []
      const seenIds: string[] = []
      for (const raw of payload.requests) {
        const a = toAlert(raw)
        if (!a) continue
        seenIds.push(a.messageId)
        if (seen.has(a.messageId)) continue
        seen.add(a.messageId)
        fresh.push(a)
      }

      const cost = typeof envelope.total_cost_usd === 'number' ? ` · US$ ${envelope.total_cost_usd.toFixed(4)}` : ''
      store.recordWatcherCycle(startedAt, fresh, seenIds)
      const summary = fresh.length ? `${fresh.length} pedido(s) novo(s)` : 'nenhum pedido novo'
      this.log({ kind: fresh.length ? 'success' : 'info', text: `[Vigia] verificado: ${summary}${cost}` })
      this.set({ lastResult: `${new Date().toLocaleTimeString()} · ${summary}` })

      for (const a of fresh) await this.alert(a, cfg)
    } catch (err) {
      const msg = (err as Error).message
      this.log({ kind: 'error', text: `[Vigia] falha: ${msg}` })
      this.set({ lastResult: `${new Date().toLocaleTimeString()} · falha: ${msg.slice(0, 120)}` })
    } finally {
      this.running = false
      if (this.active) {
        this.set({ phase: 'idle' })
        this.schedule(store.get().watcher.intervalMin * 60_000)
      }
    }
  }

  private async alert(a: DeployAlert, cfg: AppConfig) {
    this.log({
      kind: 'error',
      text: `🚨 Pedido de deploy: ${a.requester || '?'} pediu ${a.card || a.branch || 'deploy'} → ${a.environment || '?'} · aguardando sua aprovação`
    })
    if (!secrets.get('telegram.token') || !cfg.telegram.chatId) {
      store.patchAlert(a.id, { telegram: 'off' })
      return
    }
    const r = await sendTelegram(cfg.telegram.chatId, formatAlert(a))
    store.patchAlert(a.id, { telegram: r.ok ? 'sent' : 'failed' })
    if (!r.ok) this.log({ kind: 'error', text: `[Telegram] falha ao avisar: ${r.message}` })
  }

  stop(): void {
    this.active = false
    this.clearTimer()
  }
}

function toolList(cfg: AppConfig): { allowed: string[]; disallowed: string[] } {
  const prefix = `mcp__${MCP_NAMES.gchat}__`
  if (cfg.integrations.gchat.mode === 'official') {
    return {
      allowed: GCHAT_OFFICIAL_READ_TOOLS.map((t) => prefix + t),
      disallowed: GCHAT_OFFICIAL_WRITE_TOOLS.map((t) => prefix + t)
    }
  }
  const allowed = cfg.integrations.gchat.readTools
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter((t) => /^[\w.-]+$/.test(t))
    .map((t) => (t.startsWith('mcp__') ? t : prefix + t))
    // Nunca liberar o servidor inteiro nem ferramentas embutidas
    .filter((t) => t.startsWith(prefix) && t.length > prefix.length)
  return { allowed, disallowed: [] }
}

function buildPrompt(cfg: AppConfig, now: number): string {
  const since = cfg.watcher.lastCheckAt ? cfg.watcher.lastCheckAt - OVERLAP_MS : now - FIRST_LOOKBACK_MS
  const sinceIso = new Date(since).toISOString()
  const recentSeen = cfg.watcher.seen.slice(-80)
  return [
    'Você é um vigia somente-leitura do Google Chat.',
    `Use APENAS as ferramentas de leitura do servidor MCP "${MCP_NAMES.gchat}". NUNCA envie mensagens, nunca marque nada como lido, nunca altere configurações, nunca altere código.`,
    '',
    `Procure mensagens enviadas a partir de ${sinceIso} (UTC) que peçam deploy, subida de card/branch/versão para algum ambiente (dev, qa, homolog, staging, produção…) ou atualização de ambiente.`,
    cfg.watcher.focus.trim() ? `Foque nestes espaços/pessoas: ${cfg.watcher.focus.trim()}` : '',
    recentSeen.length ? `Ignore mensagens com estes IDs (já tratadas): ${recentSeen.join(', ')}` : '',
    '',
    'Responda SOMENTE com um JSON neste formato, sem texto antes ou depois e sem bloco de código:',
    '{"requests":[{"messageId":"identificador único da mensagem","requester":"quem pediu","card":"card/ticket (ex: PROJ-123) ou vazio","branch":"branch ou vazio","environment":"ambiente","summary":"resumo curto do pedido","space":"nome do espaço/conversa","link":"link da mensagem ou vazio","messageTime":"data/hora da mensagem"}]}',
    'Se não houver pedidos, responda {"requests":[]}.'
  ]
    .filter((l) => l !== '')
    .join('\n')
}

/** Acha o último objeto JSON válido num texto (tolerante a texto/```json ao redor) */
export function parseLastJson(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    /* continua */
  }
  // Linhas JSON (o envelope --output-format json vem numa linha)
  const lines = trimmed.split('\n').reverse()
  for (const l of lines) {
    const s = l.trim()
    if (s.startsWith('{') && s.endsWith('}')) {
      try {
        return JSON.parse(s)
      } catch {
        /* continua */
      }
    }
  }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1))
    } catch {
      /* nada */
    }
  }
  return null
}

function toAlert(raw: unknown): DeployAlert | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const s = (k: string, max = 300) => (typeof r[k] === 'string' ? (r[k] as string).trim().slice(0, max) : '')
  const requester = s('requester', 120)
  const card = s('card', 120)
  const branch = s('branch', 200)
  const environment = s('environment', 80)
  const summary = s('summary', 500)
  if (!summary && !card && !branch) return null
  const messageId =
    s('messageId', 300) ||
    'h:' + createHash('sha1').update([requester, card, branch, environment, summary].join('|')).digest('hex').slice(0, 16)
  return {
    id: randomUUID(),
    createdAt: Date.now(),
    messageId,
    requester,
    card,
    branch,
    environment,
    summary,
    space: s('space', 120),
    link: /^https:\/\//.test(s('link', 500)) ? s('link', 500) : '',
    messageTime: s('messageTime', 60),
    status: 'pending',
    telegram: 'off'
  }
}
