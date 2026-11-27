import { homedir } from 'os'
import { claudeTierArgs } from './limits'
import {
  MCP_NAMES,
  type AppConfig,
  type AppLog,
  type AutomationRule,
  type DeployAlert,
  type OpResult,
  type ReplyTemplate,
  type RunEvent,
  type Script
} from '../shared/types'
import {
  alertValues,
  extractUserVariables,
  fillVariables,
  findRule,
  isProdEnv,
  missingProjectKeys,
  projectValues
} from '../shared/vars'
import { GCHAT_OFFICIAL_WRITE_TOOLS } from './mcp'
import { runClaudeCapture } from './proc'
import { costs } from './costs'
import type { RunManager } from './runner'
import { secrets } from './secrets'
import { store } from './store'
import { editTelegramMessage, escapeHtml, formatAlert, formatQuestion, sendTelegramMessage, type InlineButton } from './telegram'
import { callMe } from './callmebot'
import { parseLastJson } from './watcher'

/**
 * O que acontece com um pedido depois que o Vigia o encontra:
 *   - aviso no Telegram (com botões, se o modo interativo estiver ligado)
 *   - respostas automáticas de "recebido" no Google Chat
 *   - regras: sugerir script, botão "Aprovar e rodar" no Telegram, ou rodar sozinho
 * Trava fixa: nada roda sem você no PC quando o ambiente parece produção.
 */
export class Automation {
  /** runId → pedido, para avisar o resultado no Telegram quando o script terminar */
  private runAlerts = new Map<string, { alertId: string; scriptName: string }>()

  constructor(
    private runs: RunManager,
    private log: (l: AppLog) => void
  ) {}

  private telegramReady(cfg: AppConfig): boolean {
    return !!secrets.get('telegram.token') && !!cfg.telegram.chatId
  }

  private projectName(cfg: AppConfig, a: DeployAlert): string {
    return cfg.projects.find((p) => p.id === a.projectId)?.name ?? ''
  }

  /** Script da regra que casa com o pedido, se puder rodar remotamente (nunca produção) */
  remoteRunnable(cfg: AppConfig, a: DeployAlert): { rule: AutomationRule; script: Script } | null {
    const rule = cfg.rules.find((r) => r.id === a.ruleId) ?? findRule(a, cfg.rules)
    if (!rule || rule.mode === 'suggest' || isProdEnv(a.environment)) return null
    const script = cfg.scripts.find((s) => s.id === rule.scriptId)
    return script ? { rule, script } : null
  }

  /** Botões do pedido no Telegram (para o comando /pendentes) */
  telegramButtons(a: DeployAlert): InlineButton[][] {
    return this.buttons(store.get(), a)
  }

  private buttons(cfg: AppConfig, a: DeployAlert): InlineButton[][] {
    if (!cfg.telegram.interactive) return []
    if (a.kind === 'pergunta') {
      return [
        [
          ...(a.draft && a.spaceId ? [{ text: '✉️ Enviar o rascunho', callback_data: `sd:${a.id}` }] : []),
          { text: '🗑 Descartar', callback_data: `ds:${a.id}` }
        ]
      ]
    }
    const rows: InlineButton[][] = [
      [
        { text: '✅ Aprovar', callback_data: `ap:${a.id}` },
        { text: '🗑 Descartar', callback_data: `ds:${a.id}` }
      ]
    ]
    const rr = this.remoteRunnable(cfg, a)
    if (rr) rows.push([{ text: `▶ Aprovar e rodar "${rr.script.name}"`.slice(0, 60), callback_data: `rr:${a.id}` }])
    return rows
  }

  /** Chamado pelo Vigia para cada pedido novo */
  async onNewAlert(a: DeployAlert): Promise<void> {
    const cfg = store.get()
    if (a.kind === 'pergunta') return this.onQuestion(cfg, a)
    void this.maybeCall(cfg, a)
    this.log({
      kind: 'error',
      text: `🚨 Pedido de deploy: ${a.requester || '?'} pediu ${a.card || a.branch || 'deploy'} → ${a.environment || '?'}${a.missing.length ? ` · faltou: ${a.missing.join('; ')}` : ''}`
    })

    // 1) Telegram
    if (this.telegramReady(cfg)) {
      const r = await sendTelegramMessage(cfg.telegram.chatId, formatAlert(a, this.projectName(cfg, a)), this.buttons(cfg, a))
      store.patchAlert(a.id, { telegram: r.ok ? 'sent' : 'failed', telegramMessageId: r.messageId }, r.ok ? 'avisado no Telegram' : undefined)
      if (!r.ok) this.log({ kind: 'error', text: `[Telegram] falha ao avisar: ${r.message}` })
    }

    // 2) Respostas automáticas de "recebido"
    for (const reply of cfg.replies.filter((x) => x.autoOnDetect)) {
      await this.sendReply(a.id, reply.id, 'automática')
    }

    // 3) Regra em modo automático
    const rule = cfg.rules.find((r) => r.id === a.ruleId)
    if (rule?.mode === 'auto') {
      if (isProdEnv(a.environment)) {
        this.log({ kind: 'error', text: `[Regras] "${rule.name}" NÃO rodou sozinha: o ambiente "${a.environment}" parece produção. Aprove no PC.` })
        store.patchAlert(a.id, {}, `regra "${rule.name}" bloqueada (produção)`)
        await this.notifyTelegram(`🛑 Regra "${escapeHtml(rule.name)}" não rodou sozinha: <b>${escapeHtml(a.environment)}</b> parece produção. Aprove no PC.`)
        return
      }
      if (!costs.allowsAutomation()) {
        const g = costs.guard()
        this.log({ kind: 'error', text: `[Regras] "${rule.name}" não rodou sozinha: limite diário de gastos (US$ ${g.limitUsd.toFixed(2)}) atingido.` })
        store.patchAlert(a.id, {}, `regra "${rule.name}" pausada (limite de gastos)`)
        await this.notifyTelegram(`💸 Regra "${escapeHtml(rule.name)}" não rodou sozinha: limite diário de gastos atingido. Aprove manualmente.`)
        return
      }
      await this.approve(a.id, 'pela regra automática', true)
    }
  }

  /** Pergunta ou menção a você: avisa com o rascunho; nada é enviado sem a sua aprovação */
  private async onQuestion(cfg: AppConfig, a: DeployAlert): Promise<void> {
    void this.maybeCall(cfg, a)
    this.log({ kind: 'info', text: `💬 ${a.important ? '⭐ ' : ''}${a.requester || 'Alguém'} te perguntou no Chat: ${a.summary}` })
    if (!this.telegramReady(cfg)) return
    const r = await sendTelegramMessage(cfg.telegram.chatId, formatQuestion(a), this.buttons(cfg, a))
    store.patchAlert(a.id, { telegram: r.ok ? 'sent' : 'failed', telegramMessageId: r.messageId }, r.ok ? 'avisado no Telegram' : undefined)
  }

  /** Liga pelo Telegram (CallMeBot) se for urgente ou de alguém importante, conforme a configuração */
  private async maybeCall(cfg: AppConfig, a: DeployAlert): Promise<void> {
    const c = cfg.telegram.call
    if (!c.enabled || (c.onlyAway && cfg.status !== 'off')) return
    const why = a.urgency === 'alta' && c.onUrgent ? 'urgente' : a.important && c.onImportant ? 'importante' : ''
    if (!why) return
    // Só o essencial vai para o serviço da ligação: quem e o tipo, nada do conteúdo
    const who = a.requester || 'alguém'
    const text =
      a.kind === 'pergunta'
        ? `Hélice aqui. ${who} te chamou no Google Chat${why === 'urgente' ? ' com urgência' : ''}. Veja o Telegram.`
        : `Hélice aqui. Pedido de deploy ${why === 'urgente' ? 'urgente ' : ''}de ${who} no Google Chat. Veja o Telegram.`
    const r = await callMe(c, text)
    store.patchAlert(a.id, {}, r.ok ? `ligação feita (${why})` : `ligação falhou: ${r.message}`)
    this.log({ kind: r.ok ? 'info' : 'error', text: `[Ligação] ${r.ok ? `liguei pelo Telegram (${why})` : r.message}` })
  }

  /** Aprova (de onde for: app, Telegram, regra). runRule = também roda o script da regra. */
  async approve(alertId: string, via: string, runRule: boolean): Promise<OpResult> {
    const a0 = store.getAlert(alertId)
    if (!a0) return { ok: false, message: 'Pedido não encontrado.' }
    if (a0.status !== 'pending') return { ok: false, message: `Pedido já ${a0.status === 'approved' ? 'aprovado' : 'descartado'}.` }
    let cfg = store.setAlertStatus(alertId, 'approved', via)
    let result: OpResult = { ok: true, message: 'Aprovado.' }

    if (runRule) {
      const a = store.getAlert(alertId)!
      const rr = this.remoteRunnable(cfg, a)
      result = rr ? this.runScriptForAlert(a, rr.script) : { ok: false, message: 'Nenhuma regra libera rodar este pedido remotamente.' }
      if (!result.ok) store.patchAlert(alertId, {}, `não rodou: ${result.message}`)
      cfg = store.get()
    }

    // Resposta configurada para "ao aprovar"
    const a = store.getAlert(alertId)!
    const rule = cfg.rules.find((r) => r.id === a.ruleId)
    if (rule?.replyOnApproveId) void this.sendReply(alertId, rule.replyOnApproveId, 'ao aprovar')

    await this.updateTelegramCard(alertId, `✅ Aprovado ${via}${runRule ? (result.ok ? ' · script iniciado' : ` · ⚠️ ${escapeHtml(result.message)}`) : ''}`)
    return result
  }

  async dismiss(alertId: string, via: string): Promise<OpResult> {
    const a = store.getAlert(alertId)
    if (!a) return { ok: false, message: 'Pedido não encontrado.' }
    if (a.status !== 'pending') return { ok: false, message: 'Pedido já resolvido.' }
    store.setAlertStatus(alertId, 'dismissed', via)
    await this.updateTelegramCard(alertId, `🗑 Descartado ${via}`)
    return { ok: true, message: 'Descartado.' }
  }

  /** Reescreve a mensagem do Telegram do pedido com o desfecho (e some com os botões) */
  private async updateTelegramCard(alertId: string, footer: string): Promise<void> {
    const cfg = store.get()
    const a = store.getAlert(alertId)
    if (!a?.telegramMessageId || !this.telegramReady(cfg)) return
    await editTelegramMessage(cfg.telegram.chatId, a.telegramMessageId, formatAlert(a, this.projectName(cfg, a), footer))
  }

  private async notifyTelegram(html: string): Promise<void> {
    const cfg = store.get()
    if (this.telegramReady(cfg)) await sendTelegramMessage(cfg.telegram.chatId, html)
  }

  /**
   * Roda o script com os dados do pedido. Só segue se TUDO que o script pede estiver preenchido:
   * nada de rodar com variável vazia.
   */
  runScriptForAlert(a: DeployAlert, script: Script): OpResult {
    const cfg = store.get()
    const projectId =
      script.target.kind === 'project' ? script.target.projectId : script.target.kind === 'ask' ? a.projectId : ''
    const project = cfg.projects.find((p) => p.id === projectId)
    if (script.target.kind === 'ask' && !project) {
      return { ok: false, message: `não sei em qual projeto rodar ("${a.projectHint || '?'}" não casa com nenhum cadastrado)` }
    }
    const values: Record<string, string> = { ...alertValues(a, project?.name), ...(project ? projectValues(project) : {}) }
    const missingUser = extractUserVariables(script.content).filter((v) => !values[v]?.trim())
    if (missingUser.length) return { ok: false, message: `o script pede ${missingUser.join(', ')}, que o pedido não informou` }
    if (project) {
      const mk = missingProjectKeys(script.content, project)
      if (mk.length) return { ok: false, message: `o projeto ${project.name} não define ${mk.map((k) => 'projeto.' + k).join(', ')}` }
    }
    const cwd =
      project?.path ?? (script.target.kind === 'custom' ? script.target.path : homedir())
    const runId = this.runs.start({
      kind: script.type,
      tab: `script:${script.id}`,
      title: project ? `${script.name} · ${project.name}` : script.name,
      content: script.content,
      variables: values,
      cwd,
      projectId: project?.id,
      origin: 'pedido'
    })
    this.runAlerts.set(runId, { alertId: a.id, scriptName: script.name })
    store.patchAlert(a.id, {}, `rodando "${script.name}"`)
    this.log({ kind: 'info', text: `[Regras] rodando "${script.name}" para ${a.card || a.branch} → ${a.environment}` })
    return { ok: true, message: `Rodando "${script.name}".` }
  }

  isAlertRun(runId: string): boolean {
    return this.runAlerts.has(runId)
  }

  /** Recebe os eventos de execução: avisa o fim dos scripts disparados por pedidos */
  handleRunEvent(e: RunEvent): void {
    if (e.type !== 'exit') return
    const info = this.runAlerts.get(e.runId)
    if (!info) return
    this.runAlerts.delete(e.runId)
    const ok = !e.killed && e.code === 0
    const txt = e.killed ? 'interrompido' : ok ? 'terminou com sucesso' : `falhou (código ${e.code ?? '?'})`
    store.patchAlert(info.alertId, {}, `"${info.scriptName}" ${txt}`)
    this.log({ kind: ok ? 'success' : 'error', text: `[Regras] "${info.scriptName}" ${txt}` })
    void this.notifyTelegram(`${ok ? '✅' : '❌'} <b>${escapeHtml(info.scriptName)}</b> ${txt}. Detalhes na aba do script no app.`)
  }

  /**
   * Envia uma resposta cadastrada na conversa do pedido. Roda o Claude com UMA ferramenta liberada:
   * a de enviar mensagem do Google Chat. O texto é montado pelo app, não pela IA.
   */
  async sendReply(alertId: string, replyId: string, via: string): Promise<OpResult> {
    const cfg = store.get()
    const a = store.getAlert(alertId)
    const reply: ReplyTemplate | undefined = cfg.replies.find((r) => r.id === replyId)
    if (!a || !reply) return { ok: false, message: 'Pedido ou resposta não encontrados.' }
    return this.sendText(alertId, fillVariables(reply.text, alertValues(a, this.projectName(cfg, a))).trim(), `resposta "${reply.name}"`, via)
  }

  /** Rascunho aprovado (editado ou não) */
  async sendDraft(alertId: string, text: string | null, via: string): Promise<OpResult> {
    const a = store.getAlert(alertId)
    const body = (text ?? a?.draft ?? '').trim()
    if (!a || !body) return { ok: false, message: 'Nada para enviar.' }
    const r = await this.sendText(alertId, body, 'rascunho', via)
    if (r.ok) store.patchAlert(alertId, { status: 'approved', draft: body }, `respondido (${via})`)
    return r
  }

  /** Manda um texto na conversa do pedido, pela ferramenta de envio do Google Chat */
  async sendText(alertId: string, text: string, label: string, via: string): Promise<OpResult> {
    const cfg = store.get()
    const a = store.getAlert(alertId)
    if (!a) return { ok: false, message: 'Pedido não encontrado.' }
    if (!text.trim()) return { ok: false, message: 'Mensagem vazia.' }
    if (!a.spaceId) return { ok: false, message: 'O Vigia não informou em qual conversa o pedido foi feito.' }
    const sendTool =
      cfg.integrations.gchat.mode === 'official'
        ? 'send_message'
        : cfg.integrations.gchat.sendTool.trim().replace(/^mcp__[\w-]+__/, '')
    if (!sendTool || !/^[\w.-]+$/.test(sendTool)) return { ok: false, message: 'Informe a ferramenta de envio do Google Chat (modo personalizado).' }

    const full = `mcp__${MCP_NAMES.gchat}__${sendTool}`
    const deny = cfg.integrations.gchat.mode === 'official' ? GCHAT_OFFICIAL_WRITE_TOOLS.filter((t) => t !== sendTool) : []
    const args = ['-p', '--output-format', 'json', '--tools', '', '--permission-mode', 'default', '--allowedTools', full, '--max-budget-usd', '0.3']
    if (deny.length) args.push('--disallowedTools', deny.map((t) => `mcp__${MCP_NAMES.gchat}__${t}`).join(','))
    args.push(...claudeTierArgs(cfg.ai, 'light'))
    const prompt = [
      `Use a ferramenta ${full} UMA vez para enviar a mensagem abaixo, sem alterar nada no texto.`,
      `Espaço: ${a.spaceId}`,
      a.threadId ? `Responda na thread: ${a.threadId}` : 'Envie no espaço (sem thread).',
      'Não use nenhuma outra ferramenta. Ao final responda só OK ou ERRO: <motivo>.',
      '--- MENSAGEM (entre as linhas) ---',
      text,
      '--- FIM ---'
    ].join('\n')

    const r = await runClaudeCapture(args, { cwd: homedir(), stdin: prompt, timeoutMs: 120_000 })
    const env = parseLastJson(r.stdout) as { result?: string; is_error?: boolean; total_cost_usd?: number } | null
    if (env) costs.record({ source: 'resposta', ai: 'claude', title: label, usd: env.total_cost_usd ?? null, tokens: null })
    const ok = !r.spawnError && !r.timedOut && !!env && !env.is_error && /^\s*OK\b/i.test(String(env.result ?? ''))
    const why = r.spawnError ?? (r.timedOut ? 'tempo esgotado' : String(env?.result ?? r.stderr).trim().slice(0, 200))
    store.patchAlert(alertId, {}, ok ? `${label} enviado (${via})` : `${label} falhou`)
    this.log({ kind: ok ? 'success' : 'error', text: `[Chat] ${label} ${ok ? 'enviado' : `falhou: ${why}`}` })
    return { ok, message: ok ? 'Resposta enviada.' : why || 'Falhou.' }
  }
}
