import { randomBytes } from 'crypto'
import { homedir } from 'os'
import type { HistoryEntry, Project, RunEvent, Script } from '../shared/types'
import { extractUserVariables, missingProjectKeys, projectValues } from '../shared/vars'
import type { DemandManager } from './demands'
import type { History } from './history'
import type { QueueManager } from './queue'
import type { ProjectProcesses } from './projects'
import type { RemoteManager } from './remote'
import type { RunManager } from './runner'
import { store } from './store'
import { call, downloadTelegramFile, escapeHtml, sendTelegramMessage, type InlineButton } from './telegram'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawnShell } from './proc'

type Buttons = InlineButton[][]
type Action = () => Promise<string | void>

/** Quanto do texto cabe numa mensagem do Telegram (limite real: 4096) */
const MAX_MSG = 3800

const ORIGIN: Record<string, string> = { app: 'app', telegram: 'Telegram', pedido: 'pedido', projeto: 'projeto', demanda: 'demanda', fila: 'fila' }
const STATUS_ICON: Record<HistoryEntry['status'], string> = { running: '⏳', ok: '✅', error: '❌', stopped: '⏹' }

const fmt = (t: number) =>
  new Date(t).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

const dur = (e: HistoryEntry) => {
  if (!e.endedAt) return ''
  const s = Math.round((e.endedAt - e.startedAt) / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}min${String(s % 60).padStart(2, '0')}`
}

/** Corta do começo (mantém o final, que é o que interessa num log) */
const tailText = (lines: string[], max = MAX_MSG) => {
  let out = lines.join('\n')
  if (out.length > max) out = '…' + out.slice(out.length - max)
  return out
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/**
 * Controle completo pelo Telegram: projetos, scripts, Claude, logs e histórico.
 * Os botões usam chaves curtas (o Telegram só aceita 64 bytes em callback_data) que apontam para ações guardadas aqui.
 */
export class TelegramControl {
  private actions = new Map<string, Action>()
  /** Esperando o usuário digitar algo (valor de variável de script) */
  private waiting: { label: string; resolve: (text: string) => void } | null = null
  /** Projeto onde o texto livre vira ordem para o Claude ('' = pasta pessoal) */
  private claudeAt: string | null = null
  /** Demanda escolhida: o texto livre vai para a conversa do Claude dela */
  private demandAt: string | null = null
  /** Conversa contínua com o Claude por projeto */
  private sessions = new Map<string, string>()
  /** Execuções disparadas pelo Telegram (para responder quando terminarem) */
  private runs = new Map<string, { kind: 'claude' | 'script'; title: string; projectKey: string; lines: string[] }>()
  /** Projetos cujo link do Remote Control foi pedido pelo Telegram */
  private remoteAsked = new Set<string>()

  constructor(
    private d: {
      runs: RunManager
      daily: () => string
      demands: DemandManager
      queue: QueueManager
      projects: ProjectProcesses
      remote: RemoteManager
      history: History
      status: () => Promise<string>
      log: (text: string, kind?: 'info' | 'error') => void
    }
  ) {}

  // ------------------------------------------------------------ infraestrutura

  private chat(): string {
    return store.get().telegram.chatId
  }

  private say(html: string, buttons?: Buttons) {
    return sendTelegramMessage(this.chat(), html, buttons)
  }

  private async edit(messageId: number, html: string, buttons?: Buttons) {
    await call('editMessageText', {
      chat_id: this.chat(),
      message_id: messageId,
      text: html,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: { inline_keyboard: buttons ?? [] }
    })
  }

  /** Cria um botão que dispara a ação (guardada aqui por uma chave curta) */
  private btn(text: string, fn: Action): InlineButton {
    const key = randomBytes(6).toString('base64url')
    this.actions.set(key, fn)
    // Não deixa o mapa crescer para sempre
    if (this.actions.size > 600) this.actions.delete(this.actions.keys().next().value!)
    return { text, callback_data: `k:${key}` }
  }

  /** Clique num botão criado por btn(). Devolve o texto do aviso rápido */
  async callback(key: string): Promise<string> {
    const fn = this.actions.get(key)
    if (!fn) return 'Esse botão expirou. Mande o comando de novo.'
    return (await fn()) || 'Ok.'
  }

  isTelegramRun(runId: string): boolean {
    return this.runs.has(runId)
  }

  /** O Remote deste projeto foi ligado pelo Telegram (então o link vai para lá) */
  takeRemoteRequest(projectId: string): boolean {
    return this.remoteAsked.delete(projectId)
  }

  private projectsList(): Project[] {
    return store.get().projects
  }

  private findProject(q: string): Project | undefined {
    const n = norm(q.trim())
    if (!n) return undefined
    const ps = this.projectsList()
    return ps.find((p) => norm(p.name) === n) ?? ps.find((p) => norm(p.name).includes(n))
  }

  private ask(label: string): Promise<string> {
    return new Promise((resolve) => {
      this.waiting = { label, resolve }
    })
  }

  // ------------------------------------------------------------ comandos

  readonly help = [
    '<b>Comandos</b>',
    '/projetos · executar, parar, Remote Control e log de cada projeto',
    '/rodar · scripts e ações globais (pergunta as variáveis aqui)',
    '/claude · escolhe o projeto; depois é só mandar texto que vira ordem para o Claude',
    '/demandas · escolhe uma demanda; o texto vai para a conversa do Claude dela (ou /demanda WEB-482 texto)',
    '/fila · tarefas na fila; /fila WEB-482 texto (ou /fila NomeDoProjeto texto) põe uma tarefa na fila',
    '/daily · resumo de ontem/hoje/impedimentos para a daily',
    '/novo · começa uma conversa nova com o Claude',
    '/parar · interrompe o que o Telegram mandou rodar',
    '/log [nome] · últimas linhas de um projeto ou script',
    '/historico · últimas execuções',
    '/status · como está o PC',
    '/pendentes · pedidos aguardando você',
    '/vigia · liga o Vigia (ou mostra o estado, com Olhar agora / Desligar); /vigia off desliga',
    '/ausente · /online'
  ].join('\n')

  /** Devolve true se o comando é deste módulo */
  async command(cmd: string, args: string): Promise<boolean> {
    // Outro comando no meio de uma pergunta: abandona a pergunta
    if (cmd !== 'cancelar') this.waiting = null
    switch (cmd) {
      case 'projetos':
      case 'p':
        await this.sendProjects()
        return true
      case 'rodar':
      case 'r':
        await this.sendScripts(args)
        return true
      case 'claude':
      case 'c':
        await this.chooseClaude(args)
        return true
      case 'demandas':
      case 'demanda':
      case 'd':
        await this.chooseDemand(args)
        return true
      case 'fila':
      case 'f':
        await this.queueCmd(args)
        return true
      case 'audio':
      case 'áudio':
        await this.say(
          store.get().telegram.transcribeCommand
            ? '🎤 Pode mandar áudio: eu transcrevo, mostro o texto e você confirma antes de virar ordem.'
            : '🎤 Áudio desligado: configure o "Comando de transcrição" em Configurações → Telegram.'
        )
        return true
      case 'daily':
        await this.say(`<pre>${escapeHtml(this.d.daily())}</pre>`)
        return true
      case 'novo':
        this.sessions.clear()
        await this.say('🆕 Próxima mensagem começa uma conversa nova com o Claude.')
        return true
      case 'parar':
        await this.stopMine()
        return true
      case 'log':
        await this.sendLog(args)
        return true
      case 'historico':
      case 'histórico':
      case 'h':
        await this.sendHistory()
        return true
      case 'cancelar':
        this.waiting = null
        await this.say('Cancelado.')
        return true
      case 'ajuda':
      case 'help':
      case 'start':
        await this.say(this.help)
        return true
    }
    return false
  }

  /** Texto livre: responde a uma pergunta pendente ou vira ordem para o Claude */
  async text(t: string): Promise<void> {
    if (this.waiting) {
      const w = this.waiting
      this.waiting = null
      w.resolve(t)
      return
    }
    if (this.demandAt) {
      await this.sendToDemand(this.demandAt, t)
      return
    }
    if (this.claudeAt === null) {
      await this.chooseClaude(t)
      return
    }
    await this.runClaude(this.claudeAt, t)
  }

  // ------------------------------------------------------------ /projetos

  private projectsView(): { html: string; buttons: Buttons } {
    const ps = this.projectsList()
    if (!ps.length) return { html: 'Nenhum projeto cadastrado no app.', buttons: [] }
    const states = new Map(this.d.projects.list().map((s) => [s.projectId, s]))
    const remotes = new Map(this.d.remote.list().map((s) => [s.projectId, s]))
    const lines: string[] = ['<b>Projetos</b>']
    const buttons: Buttons = []
    for (const p of ps.slice(0, 15)) {
      const st = states.get(p.id)?.state ?? 'stopped'
      const rc = remotes.get(p.id)
      const running = st === 'running' || st === 'starting'
      const label = { running: '🟢 rodando', starting: '🟡 iniciando', crashed: '🔴 caiu', external: '🟠 rodando fora do app', stopped: '⚪ parado' }[st]
      lines.push(
        `\n<b>${escapeHtml(p.name)}</b> · ${label}` +
          (rc ? ` · 📡 ${rc.state === 'active' ? 'Remote ativo' : rc.state === 'needs-setup' ? 'Remote precisa de configuração no PC' : 'Remote ' + rc.state}` : '')
      )
      if (rc?.url) lines.push(escapeHtml(rc.url))
      const row: InlineButton[] = []
      if (p.runCommand) {
        row.push(
          running
            ? this.btn(`■ ${p.name}`.slice(0, 30), async () => {
                await this.d.projects.stop(p.id)
                return `Parando ${p.name}…`
              })
            : this.btn(`▶ ${p.name}`.slice(0, 30), async () => {
                const r = await this.d.projects.start(p.id)
                return r.message
              })
        )
      }
      row.push(
        this.btn(rc ? '📡 Desligar' : '📡 Remote', async () => {
          if (!rc) this.remoteAsked.add(p.id)
          this.d.remote.setManual(p.id, !rc)
          return rc ? 'Remote desligado.' : 'Ligando o Remote… o link chega aqui quando ficar pronto.'
        }),
        this.btn('📜 Log', async () => {
          await this.sendLogFor((e) => e.tab === `project:${p.id}`, p.name)
          return ''
        }),
        this.btn('🤖', async () => {
          this.claudeAt = p.id
          this.demandAt = null
          await this.say(`🤖 Agora o texto que você mandar vira ordem para o Claude em <b>${escapeHtml(p.name)}</b>.`)
          return 'Claude neste projeto.'
        })
      )
      buttons.push(row)
    }
    return { html: lines.join('\n'), buttons }
  }

  private async sendProjects(): Promise<void> {
    const v = this.projectsView()
    const r = await this.say(v.html, v.buttons)
    // Depois de um clique, atualiza a própria mensagem com o estado novo
    if (r.messageId) {
      const id = r.messageId
      const refresh = this.btn('🔄 Atualizar', async () => {
        const nv = this.projectsView()
        await this.edit(id, nv.html, [...nv.buttons, [refresh]])
        return 'Atualizado.'
      })
      await this.edit(id, v.html, [...v.buttons, [refresh]])
    }
  }

  // ------------------------------------------------------------ /rodar

  private async sendScripts(filter: string): Promise<void> {
    const cfg = store.get()
    let scripts = cfg.scripts
    if (filter.trim()) scripts = scripts.filter((s) => norm(s.name).includes(norm(filter)))
    if (!scripts.length) {
      await this.say(filter ? 'Nenhum script com esse nome.' : 'Nenhum script cadastrado no app.')
      return
    }
    if (scripts.length === 1 && filter.trim()) return void (await this.prepareScript(scripts[0]))
    const buttons: Buttons = []
    const list = scripts.slice(0, 40)
    for (let i = 0; i < list.length; i += 2) {
      buttons.push(
        list.slice(i, i + 2).map((s) => {
          const where = s.target.kind === 'project' ? cfg.projects.find((p) => p.id === (s.target as { projectId: string }).projectId)?.name : ''
          return this.btn(`${where ? where + ' · ' : ''}${s.name}`.slice(0, 40), async () => {
            void this.prepareScript(s)
            return s.name
          })
        })
      )
    }
    await this.say('<b>Qual script?</b>', buttons)
  }

  /** Escolhe projeto (se precisar), pergunta as variáveis e confirma antes de rodar */
  private async prepareScript(s: Script, projectId?: string): Promise<void> {
    const cfg = store.get()
    if (s.target.kind === 'ask' && !projectId) {
      if (!cfg.projects.length) return void (await this.say('Esse script pergunta o projeto, mas não há projetos cadastrados.'))
      const buttons = cfg.projects.slice(0, 30).map((p) => [
        this.btn(p.name, async () => {
          void this.prepareScript(s, p.id)
          return p.name
        })
      ])
      await this.say(`<b>${escapeHtml(s.name)}</b>: em qual projeto?`, buttons)
      return
    }
    const pid = s.target.kind === 'project' ? s.target.projectId : projectId
    const project = cfg.projects.find((p) => p.id === pid)
    if (project) {
      const mk = missingProjectKeys(s.content, project)
      if (mk.length) {
        await this.say(`⚠️ O projeto ${escapeHtml(project.name)} não define ${mk.map((k) => 'projeto.' + k).join(', ')}. Ajuste no app.`)
        return
      }
    }
    const values: Record<string, string> = project ? projectValues(project) : {}
    for (const v of extractUserVariables(s.content)) {
      await this.say(`✏️ Valor de <b>${escapeHtml(v)}</b>? (ou /cancelar)`)
      const answer = await this.ask(v)
      values[v] = answer.trim()
    }
    const cwd = project?.path ?? (s.target.kind === 'custom' ? s.target.path : homedir())
    const title = project && s.target.kind === 'ask' ? `${s.name} · ${project.name}` : s.name
    const summary = Object.entries(values)
      .filter(([k]) => !k.startsWith('projeto.'))
      .map(([k, v]) => `${escapeHtml(k)} = <code>${escapeHtml(v)}</code>`)
      .join('\n')
    await this.say(`▶ Rodar <b>${escapeHtml(title)}</b>?${summary ? '\n\n' + summary : ''}`, [
      [
        this.btn('✅ Rodar', async () => {
          const runId = this.d.runs.start({
            kind: s.type,
            tab: `script:${s.id}`,
            title,
            content: s.content,
            variables: values,
            cwd,
            projectId: pid,
            origin: 'telegram'
          })
          this.runs.set(runId, { kind: 'script', title, projectKey: pid ?? '', lines: [] })
          return `Rodando ${s.name}…`
        }),
        this.btn('Cancelar', async () => 'Cancelado.')
      ]
    ])
  }

  // ------------------------------------------------------------ Claude

  private async chooseClaude(text: string): Promise<void> {
    const cfg = store.get()
    const named = text.trim() ? this.findProject(text.split(/\s+/)[0]) : undefined
    // "/claude NomeDoProjeto" só seleciona; "/claude NomeDoProjeto faça X" seleciona e manda
    this.demandAt = null
    if (named) {
      this.claudeAt = named.id
      const rest = text.trim().split(/\s+/).slice(1).join(' ')
      if (rest) return this.runClaude(named.id, rest)
      await this.say(`🤖 Claude em <b>${escapeHtml(named.name)}</b>. Mande o que ele deve fazer.`)
      return
    }
    const pending = text.trim()
    const buttons = [
      ...cfg.projects.slice(0, 30).map((p) => [
        this.btn(p.name, async () => {
          this.claudeAt = p.id
          if (pending) void this.runClaude(p.id, pending)
          else await this.say(`🤖 Claude em <b>${escapeHtml(p.name)}</b>. Mande o que ele deve fazer.`)
          return p.name
        })
      ]),
      [
        this.btn('🏠 Sem projeto (pasta pessoal)', async () => {
          this.claudeAt = ''
          if (pending) void this.runClaude('', pending)
          else await this.say('🤖 Claude na pasta pessoal. Mande o que ele deve fazer.')
          return 'Pasta pessoal'
        })
      ]
    ]
    await this.say(pending ? '🤖 Em qual projeto o Claude deve fazer isso?' : '🤖 Em qual projeto?', buttons)
  }

  // ------------------------------------------------------------ áudio

  /** Áudio no Telegram: transcreve com o comando configurado e confirma antes de usar como texto */
  async voice(fileId: string): Promise<void> {
    const cmd = store.get().telegram.transcribeCommand.trim()
    if (!cmd) {
      await this.say(
        '🎤 Para usar áudio, configure a transcrição no app: Configurações → Telegram → "Comando de transcrição".'
      )
      return
    }
    await call('sendChatAction', { chat_id: this.chat(), action: 'typing' })
    const file = await downloadTelegramFile(fileId)
    if (!file) return void (await this.say('⚠️ Não consegui baixar o áudio.'))
    const dir = mkdtempSync(join(tmpdir(), 'helice-audio-'))
    const audio = join(dir, file.name.replace(/[^\w.-]/g, '_'))
    writeFileSync(audio, file.data)
    try {
      const text = await transcribe(cmd, audio, dir)
      if (!text) return void (await this.say('⚠️ A transcrição voltou vazia. Confira o comando nas configurações.'))
      const go = this.btn('✅ Mandar', async () => {
        void this.text(text)
        return 'Mandado.'
      })
      await this.say(`🎤 Entendi:\n<i>${escapeHtml(text)}</i>\n\nMando assim? (ou escreva a versão certa)`, [[go, this.btn('✖ Descartar', async () => 'Descartado.')]])
    } catch (e) {
      await this.say('⚠️ A transcrição falhou: ' + escapeHtml((e as Error).message).slice(0, 300))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  // ------------------------------------------------------------ fila

  private async queueCmd(args: string): Promise<void> {
    const [first, ...rest] = args.trim().split(/\s+/)
    if (first && rest.length) {
      const dm = this.d.demands.findByKey(first)
      const p = dm ? undefined : this.findProject(first)
      if (!dm && !p) return void (await this.say(`Não achei a demanda ou o projeto "${escapeHtml(first)}".`))
      const r = this.d.queue.add({ projectId: dm ? dm.projectId : p!.id, demandId: dm?.id, prompt: rest.join(' '), origin: 'telegram' })
      return void (await this.say((r.ok ? '📋 ' : '⚠️ ') + escapeHtml(r.message)))
    }
    const q = this.d.queue.state()
    const icon: Record<string, string> = { pendente: '⏸', rodando: '⏳', feita: '✅', falhou: '❌', cancelada: '⏹' }
    const visible = q.tasks.filter((t) => t.status === 'pendente' || t.status === 'rodando' || (t.endedAt ?? 0) > Date.now() - 24 * 3600_000)
    if (!visible.length) return void (await this.say('Fila vazia. Adicione com /fila WEB-482 o que fazer.'))
    const name = (t: { projectId: string; demandId?: string }) =>
      (t.demandId && this.d.demands.get(t.demandId)?.key) || this.projectsList().find((p) => p.id === t.projectId)?.name || '?'
    const lines = visible.slice(-15).map((t) => `${icon[t.status]} <b>${escapeHtml(name(t))}</b>: ${escapeHtml(t.prompt.slice(0, 80))}`)
    const buttons: Buttons = []
    if (q.tasks.some((t) => t.status === 'pendente')) {
      buttons.push([
        this.btn('▶ Rodar agora', async () => this.d.queue.runNow().message)
      ])
    }
    for (const t of visible.filter((x) => x.status === 'pendente' || x.status === 'rodando').slice(0, 10)) {
      buttons.push([this.btn(`✖ Cancelar: ${name(t)} · ${t.prompt}`.slice(0, 45), async () => (this.d.queue.cancel(t.id), 'Cancelada.'))])
    }
    await this.say(`<b>Fila</b>${q.waiting ? `\n<i>${escapeHtml(q.waiting)}</i>` : ''}\n\n${lines.join('\n')}`, buttons)
  }

  // ------------------------------------------------------------ demandas

  private async chooseDemand(args: string): Promise<void> {
    const [first, ...rest] = args.trim().split(/\s+/)
    const byKey = first ? this.d.demands.findByKey(first) : undefined
    if (byKey) {
      this.demandAt = byKey.id
      this.claudeAt = null
      if (rest.length) return this.sendToDemand(byKey.id, rest.join(' '))
      await this.say(this.demandSummary(byKey.id) + '\n\n💬 Mande o que o Claude deve fazer nesta demanda.')
      return
    }
    const open = this.d.demands.all().filter((d) => d.status !== 'feita').slice(0, 20)
    if (!open.length) return void (await this.say('Nenhuma demanda aberta. Crie pelo card do projeto no app.'))
    const buttons = open.map((d) => [
      this.btn(`${d.key} · ${d.title || d.jira?.summary || ''}`.slice(0, 50), async () => {
        this.demandAt = d.id
        this.claudeAt = null
        await this.say(this.demandSummary(d.id) + '\n\n💬 Mande o que o Claude deve fazer nesta demanda.')
        return d.key
      })
    ])
    await this.say('<b>Demandas abertas</b>', buttons)
  }

  private demandSummary(id: string): string {
    const d = this.d.demands.get(id)
    if (!d) return 'Demanda não encontrada.'
    const p = this.projectsList().find((x) => x.id === d.projectId)
    return (
      `📋 <b>${escapeHtml(d.key)}</b> · ${escapeHtml(d.title || d.jira?.summary || '')}\n` +
      `${escapeHtml(p?.name ?? '?')} · etapa: <b>${d.status}</b>${d.hours ? ` · ${d.hours}h` : ''}` +
      (d.sessionId ? '\n(continua a conversa do Claude desta demanda)' : '\n(a primeira mensagem leva o card, o contexto e o desenho)')
    )
  }

  private async sendToDemand(id: string, text: string): Promise<void> {
    const d = this.d.demands.get(id)
    if (!d) {
      this.demandAt = null
      return void (await this.say('Essa demanda não existe mais. Use /demandas.'))
    }
    const r = this.d.demands.implement(id, text, false, 'telegram')
    if (!r.ok || !r.runId) return void (await this.say('⚠️ ' + escapeHtml(r.message)))
    this.runs.set(r.runId, { kind: 'claude', title: `${d.key}`, projectKey: `demand:${id}`, lines: [] })
    await call('sendChatAction', { chat_id: this.chat(), action: 'typing' })
    await this.say(`🤖 ${escapeHtml(r.message)} (${escapeHtml(d.key)})`)
  }

  private async runClaude(projectId: string, prompt: string): Promise<void> {
    const p = this.projectsList().find((x) => x.id === projectId)
    if (projectId && !p) {
      this.claudeAt = null
      return this.chooseClaude(prompt)
    }
    const busy = [...this.runs.entries()].find(([id, r]) => r.kind === 'claude' && this.d.runs.isRunning(id))
    if (busy) return void (await this.say('⏳ O Claude ainda está trabalhando no pedido anterior. Use /parar para interromper.'))
    const name = p?.name ?? 'pasta pessoal'
    const runId = this.d.runs.start({
      kind: 'claude',
      tab: 'claude',
      title: `Telegram · ${name}`,
      content: prompt,
      cwd: p?.path ?? homedir(),
      projectId: p?.id,
      resumeSessionId: this.sessions.get(projectId),
      origin: 'telegram'
    })
    this.runs.set(runId, { kind: 'claude', title: name, projectKey: projectId, lines: [] })
    await call('sendChatAction', { chat_id: this.chat(), action: 'typing' })
    await this.say(
      `🤖 Mandei para o Claude em <b>${escapeHtml(name)}</b>.` +
        (this.sessions.has(projectId) ? ' (continuando a conversa; /novo começa outra)' : '') +
        '\nSe ele pedir permissão, os botões chegam aqui.'
    )
  }

  private async stopMine(): Promise<void> {
    const mine = [...this.runs.keys()].filter((id) => this.d.runs.isRunning(id))
    if (!mine.length) return void (await this.say('Nada rodando pelo Telegram.'))
    for (const id of mine) await this.d.runs.stop(id)
    await this.say(`⏹ Interrompi ${mine.length} execução(ões).`)
  }

  // ------------------------------------------------------------ log / histórico

  private async sendLogFor(match: (e: HistoryEntry) => boolean, name: string): Promise<void> {
    const e = this.d.history.latest(match)
    if (!e) return void (await this.say(`Nenhuma execução de ${escapeHtml(name)} no histórico.`))
    const lines = this.d.history.log(e.id).slice(-40)
    await this.say(
      `📜 <b>${escapeHtml(e.title)}</b> · ${STATUS_ICON[e.status]} ${fmt(e.startedAt)}\n<pre>${escapeHtml(tailText(lines, 3400)) || '(sem saída)'}</pre>`
    )
  }

  private async sendLog(q: string): Promise<void> {
    if (q.trim()) {
      const p = this.findProject(q)
      if (p) return this.sendLogFor((e) => e.tab === `project:${p.id}`, p.name)
      const n = norm(q)
      return this.sendLogFor((e) => norm(e.title).includes(n), q)
    }
    return this.sendHistory()
  }

  private async sendHistory(): Promise<void> {
    const list = this.d.history.list().slice(0, 10)
    if (!list.length) return void (await this.say('Histórico vazio.'))
    const lines = list.map(
      (e) =>
        `${STATUS_ICON[e.status]} <b>${escapeHtml(e.title)}</b> · ${fmt(e.startedAt)}${dur(e) ? ' · ' + dur(e) : ''}${e.origin !== 'app' ? ' · via ' + ORIGIN[e.origin] : ''}`
    )
    const buttons = list.map((e, i) => [
      this.btn(`📜 ${i + 1}. ${e.title}`.slice(0, 40), async () => {
        await this.sendLogFor((x) => x.id === e.id, e.title)
        return ''
      })
    ])
    await this.say('<b>Últimas execuções</b>\n\n' + lines.map((l, i) => `${i + 1}. ${l}`).join('\n'), buttons)
  }

  // ------------------------------------------------------------ eventos

  /** Junta a resposta do Claude / saída do script e manda quando terminar */
  handleRunEvent(e: RunEvent): void {
    const r = this.runs.get(e.runId)
    if (!r) return
    if (e.type === 'session' && r.kind === 'claude' && !r.projectKey.startsWith('demand:')) this.sessions.set(r.projectKey, e.sessionId)
    if (e.type === 'lines') {
      for (const l of e.lines) {
        if (r.kind === 'claude' ? l.kind === 'claude' : l.kind !== 'info') r.lines.push(l.text)
      }
      if (r.lines.length > 400) r.lines.splice(0, r.lines.length - 400)
    }
    if (e.type === 'error') r.lines.push('⚠️ ' + e.message)
    if (e.type !== 'exit') return
    this.runs.delete(e.runId)
    if (r.kind === 'claude') {
      const body = tailText(r.lines) || (e.killed ? '(interrompido)' : '(sem resposta em texto)')
      void this.say(`🤖 <b>${escapeHtml(r.title)}</b>${e.code === 0 || e.killed ? '' : ' · ❌ falhou'}\n\n${escapeHtml(body)}`)
      return
    }
    const ok = !e.killed && e.code === 0
    const head = `${e.killed ? '⏹' : ok ? '✅' : '❌'} <b>${escapeHtml(r.title)}</b> ${e.killed ? 'interrompido' : ok ? 'terminou' : `falhou (código ${e.code ?? '?'})`}`
    const tail = r.lines.slice(-15)
    void this.say(head + (tail.length ? `\n<pre>${escapeHtml(tailText(tail, 3000))}</pre>` : ''))
  }
}

/**
 * Roda o comando de transcrição. {{arquivo}} vira o caminho do áudio (entre aspas).
 * Usa o que o comando imprimir; se não imprimir nada, lê o .txt que ele tiver gravado na pasta (ex: whisper).
 */
export function transcribe(command: string, audio: string, dir: string, timeoutMs = 300_000): Promise<string> {
  const full = command.includes('{{arquivo}}') ? command.split('{{arquivo}}').join(`"${audio}"`) : `${command} "${audio}"`
  return new Promise((resolve, reject) => {
    const child = spawnShell(full, dir)
    let out = ''
    let err = ''
    child.stdout?.on('data', (b) => (out += b))
    child.stderr?.on('data', (b) => (err += b))
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('demorou mais de 5 minutos'))
    }, timeoutMs)
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0 && !out.trim()) return reject(new Error(err.trim().split('\n').slice(-2).join(' ') || `saiu com código ${code}`))
      let text = cleanTranscript(out)
      if (!text) {
        const txt = readdirSync(dir).find((f) => f.endsWith('.txt'))
        if (txt) text = cleanTranscript(readFileSync(join(dir, txt), 'utf8'))
      }
      resolve(text)
    })
  })
}

/** Tira marcas de tempo do whisper ("[00:00.000 --> 00:03.000]") e espaços sobrando */
export function cleanTranscript(s: string): string {
  return s
    .split('\n')
    .map((l) => l.replace(/^\s*\[[\d:.]+\s*-->\s*[\d:.]+\]\s*/, '').trim())
    .filter((l) => l && !/^(Detecting language|Detected language)/i.test(l))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}
