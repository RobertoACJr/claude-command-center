import { homedir } from 'os'
import { claudeTierArgs } from './limits'
import { createHash, randomUUID } from 'crypto'
import { MCP_NAMES, type AppConfig, type AppLog, type DeployAlert, type WatcherState } from '../shared/types'
import { findRule, matchProject } from '../shared/vars'
import { GCHAT_OFFICIAL_READ_TOOLS, GCHAT_OFFICIAL_WRITE_TOOLS } from './mcp'
import { runClaudeCapture, runGeminiCapture } from './proc'
import { costs } from './costs'
import { store } from './store'
import { ensureWatcherPolicy, geminiReadTools, geminiWatcherArgs } from './gemini'

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
 *
 * Com o provedor Gemini (poupa os tokens do Claude), a trava vem do próprio Gemini CLI:
 * só o servidor ccc-gchat carregado + política que libera só a leitura (ver gemini.ts).
 */
export class Watcher {
  private timer: NodeJS.Timeout | null = null
  private active = false
  private intervalMin = 0
  private running = false
  private state: WatcherState = { phase: 'off', reason: 'Desligado', nextAt: null, lastResult: null }

  constructor(
    private notify: (s: WatcherState) => void,
    private log: (l: AppLog) => void,
    /** O que fazer com cada pedido novo (Telegram, respostas, regras) */
    private onNewAlert: (a: DeployAlert) => Promise<void>
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
    else if (wants && cfg.watcher.provider === 'gemini' && geminiReadTools(cfg).length === 0)
      blocked = 'Gemini: informe as ferramentas de leitura do Google Chat.'

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
    // Limite diário de gastos: pula este ciclo (volta sozinho amanhã ou se você liberar)
    if (!costs.allowsAutomation()) {
      const g = costs.guard()
      this.set({ lastResult: `${new Date().toLocaleTimeString()} · pausado: limite diário de US$ ${g.limitUsd.toFixed(2)} atingido` })
      this.schedule(cfg.watcher.intervalMin * 60_000)
      return
    }
    this.running = true
    this.set({ phase: 'checking', nextAt: null })
    const startedAt = Date.now()

    try {
      const prompt = buildPrompt(cfg, startedAt)
      const provider = cfg.watcher.provider
      let resultText: string
      let costLabel = ''

      if (provider === 'gemini') {
        const policy = ensureWatcherPolicy(cfg)
        if (!policy.ok) throw new Error(policy.message)
        const r = await runGeminiCapture(geminiWatcherArgs(cfg), { cwd: homedir(), stdin: prompt, timeoutMs: CYCLE_TIMEOUT_MS })
        if (r.spawnError || r.timedOut) throw new Error(r.spawnError ?? 'Tempo esgotado (4 min).')
        const envelope = parseLastJson(r.stdout) as { response?: string; error?: { message?: string } | string; stats?: Record<string, any> } | null
        if (!envelope) throw new Error((r.stderr || r.stdout).trim().split('\n').slice(-2).join(' ') || `código ${r.code}`)
        if (envelope.error) {
          const em = typeof envelope.error === 'string' ? envelope.error : (envelope.error.message ?? 'erro')
          throw new Error(`Gemini: ${String(em).slice(0, 300)}`)
        }
        resultText = String(envelope.response ?? '')
        costLabel = ' · Gemini'
        const tk = envelope.stats?.total_tokens ?? envelope.stats?.totalTokens
        costs.record({ source: 'vigia', ai: 'gemini', title: 'Vigia', usd: null, tokens: typeof tk === 'number' ? tk : null })
      } else {
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
        // Economia automática: o Vigia é tarefa leve
        args.push(...claudeTierArgs(cfg.ai, 'light'))
        if (cfg.watcher.model && /^[\w.-]+$/.test(cfg.watcher.model)) args.push('--model', cfg.watcher.model)

        const r = await runClaudeCapture(args, { cwd: homedir(), stdin: prompt, timeoutMs: CYCLE_TIMEOUT_MS })
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
        resultText = String(envelope.result ?? '')
        costLabel = typeof envelope.total_cost_usd === 'number' ? ` · US$ ${envelope.total_cost_usd.toFixed(4)}` : ''
        costs.record({ source: 'vigia', ai: 'claude', title: 'Vigia', usd: envelope.total_cost_usd ?? null, tokens: null })
      }

      const payload = parseLastJson(resultText) as { requests?: unknown[] } | null
      if (!payload || !Array.isArray(payload.requests)) throw new Error('Resposta da IA sem o JSON esperado.')

      const seen = new Set(cfg.watcher.seen)
      const fresh: DeployAlert[] = []
      const seenIds: string[] = []
      for (const raw of payload.requests) {
        const a = toAlert(raw, cfg)
        if (!a) continue
        seenIds.push(a.messageId)
        if (seen.has(a.messageId)) continue
        seen.add(a.messageId)
        fresh.push(a)
      }

      const cost = costLabel
      store.recordWatcherCycle(startedAt, fresh, seenIds)
      const summary = fresh.length ? `${fresh.length} pedido(s) novo(s)` : 'nenhum pedido novo'
      this.log({ kind: fresh.length ? 'success' : 'info', text: `[Vigia] verificado: ${summary}${cost}` })
      this.set({ lastResult: `${new Date().toLocaleTimeString()} · ${summary}` })

      for (const a of fresh) {
        try {
          await this.onNewAlert(a)
        } catch (err) {
          this.log({ kind: 'error', text: `[Vigia] erro ao tratar pedido: ${(err as Error).message}` })
        }
      }
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
  const projectNames = cfg.projects.map((p) => p.name).join(', ')
  return [
    'Você é um vigia somente-leitura do Google Chat.',
    `Use APENAS as ferramentas de leitura do servidor MCP "${MCP_NAMES.gchat}". NUNCA envie mensagens, nunca marque nada como lido, nunca altere configurações, nunca altere código.`,
    '',
    `Procure mensagens enviadas a partir de ${sinceIso} (UTC) que peçam deploy, subida de card/branch/versão para algum ambiente (dev, qa, homolog, staging, produção…) ou atualização de ambiente.`,
    cfg.watcher.focus.trim() ? `Foque nestes espaços/pessoas: ${cfg.watcher.focus.trim()}` : '',
    recentSeen.length ? `Ignore mensagens com estes IDs (já tratadas): ${recentSeen.join(', ')}` : '',
    '',
    projectNames ? `Projetos/repos que eu conheço (use o nome exato se o pedido citar um deles): ${projectNames}` : '',
    '',
    'Para cada pedido, faça um resumo de uma frase (o que, onde, para quando) e liste o que ficou faltando para executar',
    '(ex: "ambiente não informado", "não diz qual card", "não diz qual projeto"). Urgência: "alta" se pedirem pressa/urgente/agora, "baixa" se disserem sem pressa, senão "normal".',
    'Para dar para responder depois, informe o identificador do espaço (ex: spaces/AAAA) e da thread, se houver.',
    '',
    'Responda SOMENTE com um JSON neste formato, sem texto antes ou depois e sem bloco de código:',
    '{"requests":[{"messageId":"identificador único da mensagem","requester":"quem pediu","card":"card/ticket (ex: PROJ-123) ou vazio","branch":"branch ou vazio","environment":"ambiente ou vazio","project":"projeto/repo citado ou vazio","summary":"resumo de uma frase","missing":["o que faltou"],"urgency":"baixa|normal|alta","space":"nome do espaço/conversa","spaceId":"spaces/…","threadId":"spaces/…/threads/… ou vazio","link":"link da mensagem ou vazio","messageTime":"data/hora da mensagem"}]}',
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

function toAlert(raw: unknown, cfg: AppConfig): DeployAlert | null {
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
  const projectHint = s('project', 120)
  const project = matchProject(projectHint, cfg.projects)
  const urgency = s('urgency', 10).toLowerCase()
  const alert: DeployAlert = {
    id: randomUUID(),
    createdAt: Date.now(),
    messageId,
    missing: Array.isArray(r.missing)
      ? (r.missing as unknown[]).filter((m): m is string => typeof m === 'string' && !!m.trim()).map((m) => m.trim().slice(0, 120)).slice(0, 5)
      : [],
    urgency: urgency === 'alta' || urgency === 'baixa' ? urgency : 'normal',
    projectHint,
    projectId: project?.id ?? '',
    // Só identificadores (sem espaços); servidores diferentes usam formatos diferentes
    spaceId: /^[\w/.:@-]+$/.test(s('spaceId', 200)) ? s('spaceId', 200) : '',
    threadId: /^[\w/.:@-]+$/.test(s('threadId', 200)) ? s('threadId', 200) : '',
    ruleId: '',
    telegramMessageId: null,
    history: [],
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
  alert.ruleId = findRule(alert, cfg.rules)?.id ?? ''
  return alert
}
