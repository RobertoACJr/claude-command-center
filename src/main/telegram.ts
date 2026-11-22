import type { DeployAlert, OpResult } from '../shared/types'
import { secrets } from './secrets'

/** Permite apontar para um servidor falso em testes */
const API = () => process.env.CCC_TELEGRAM_API || 'https://api.telegram.org'

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function call(
  method: string,
  body?: Record<string, unknown>,
  timeoutMs = 15_000
): Promise<{ ok: boolean; result?: any; description?: string; status?: number }> {
  const token = secrets.get('telegram.token')
  if (!token) return { ok: false, description: 'Informe o token do bot.' }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${API()}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: ctrl.signal
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; description?: string }
    return { ok: Boolean(data.ok), result: data.result, description: data.description ?? `HTTP ${res.status}`, status: res.status }
  } catch (err) {
    // Nunca devolve a URL (ela contém o token)
    return { ok: false, description: (err as Error).name === 'AbortError' ? 'Tempo esgotado.' : 'Falha de rede.' }
  } finally {
    clearTimeout(timer)
  }
}

/** Traduz os erros mais comuns do Telegram para o que fazer */
export function explainTelegramError(desc: string): string {
  const d = desc.toLowerCase()
  if (d.includes('unauthorized') || (d.includes('not found') && d.includes('404')))
    return 'O token do bot não vale (Unauthorized). Copie de novo o token no @BotFather e salve.'
  if (d.includes('chat not found'))
    return 'O Telegram não achou esse Chat ID. Abra o seu bot, mande "oi" e clique em Detectar de novo.'
  if (d.includes('blocked by the user'))
    return 'Você bloqueou o bot no Telegram. Abra a conversa com ele, desbloqueie (ou toque em Iniciar) e teste de novo.'
  if (d.includes("can't initiate") || d.includes('initiate conversation'))
    return 'O bot ainda não pode falar com você: abra a conversa com ele, toque em Iniciar e teste de novo.'
  if (d.includes('falha de rede') || d.includes('tempo esgotado'))
    return `Sem conexão com o Telegram (${desc}). Confira a internet ou um proxy/firewall da empresa bloqueando api.telegram.org.`
  return `O Telegram recusou: ${desc}`
}

export async function sendTelegram(chatId: string, html: string): Promise<OpResult> {
  if (!chatId) return { ok: false, message: 'Informe o Chat ID.' }
  const r = await call('sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true })
  return {
    ok: r.ok,
    message: r.ok ? 'Mensagem enviada: confira a conversa com o seu bot no Telegram.' : explainTelegramError(r.description ?? 'Erro')
  }
}

/** Lê as últimas mensagens recebidas pelo bot para descobrir o seu Chat ID */
export async function detectChatId(): Promise<OpResult> {
  // Com o bot escutando (botões/comandos), quem lê as mensagens é ele
  if (bot?.isRunning()) {
    const c = bot.lastChat()
    return c
      ? { ok: true, message: `Chat encontrado: ${c.name}`, data: { chatId: c.id, name: c.name } }
      : { ok: false, message: 'Mande um "oi" para o seu bot no Telegram e clique em Detectar de novo.' }
  }
  const r = await call('getUpdates', { limit: 20, timeout: 0 })
  if (!r.ok) return { ok: false, message: r.description ?? 'Erro' }
  const updates = (r.result ?? []) as Array<Record<string, any>>
  for (let i = updates.length - 1; i >= 0; i--) {
    const chat = updates[i].message?.chat ?? updates[i].channel_post?.chat
    if (chat?.id) {
      const name = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || ''
      return { ok: true, message: `Chat encontrado: ${name}`, data: { chatId: String(chat.id), name } }
    }
  }
  return { ok: false, message: 'Nenhuma mensagem encontrada. Mande um "oi" para o seu bot no Telegram e tente de novo.' }
}

export function formatAlert(a: DeployAlert, projectName = '', footer?: string): string {
  const line = (label: string, v: string) => (v ? `<b>${label}:</b> ${escapeHtml(v)}\n` : '')
  const urg = a.urgency === 'alta' ? ' 🔥 URGENTE' : ''
  return (
    `🚨 <b>Pedido de deploy</b>${urg}\n\n` +
    line('Quem pediu', a.requester) +
    line('Card', a.card) +
    line('Branch', a.branch) +
    line('Ambiente', a.environment) +
    line('Projeto', projectName || (a.projectHint ? `${a.projectHint} (não cadastrado)` : '')) +
    line('Espaço', a.space) +
    (a.summary ? `\n<i>${escapeHtml(a.summary)}</i>\n` : '') +
    (a.missing.length ? `\n⚠️ <b>Faltou:</b> ${escapeHtml(a.missing.join('; '))}\n` : '') +
    (a.link ? `\n${escapeHtml(a.link)}\n` : '') +
    '\n' +
    (footer ?? '⏸ Nada foi executado. Aguardando sua aprovação.')
  )
}

export interface InlineButton {
  text: string
  callback_data: string
}

export async function sendTelegramMessage(
  chatId: string,
  html: string,
  buttons?: InlineButton[][]
): Promise<{ ok: boolean; messageId: number | null; message: string }> {
  const r = await call('sendMessage', {
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(buttons?.length ? { reply_markup: { inline_keyboard: buttons } } : {})
  })
  return { ok: r.ok, messageId: r.ok ? (r.result?.message_id ?? null) : null, message: r.ok ? 'ok' : (r.description ?? 'Erro') }
}

/** Troca o texto de uma mensagem já enviada (e tira os botões) */
export async function editTelegramMessage(chatId: string, messageId: number, html: string): Promise<void> {
  await call('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: html,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [] }
  })
}

// ---------------------------------------------------------------- bot (botões + comandos)

export interface BotHandlers {
  /** Configuração atual: token configurado, chat autorizado e se o modo interativo está ligado */
  settings: () => { chatId: string; interactive: boolean }
  onCallback: (data: string, reply: (text: string) => Promise<void>, messageId: number | null) => Promise<string>
  onCommand: (cmd: string, args: string) => Promise<void>
  /** Mensagem sem barra (resposta a uma pergunta ou ordem para o Claude) */
  onText: (text: string) => Promise<void>
  /** Áudio (voz ou arquivo de áudio): id do arquivo no Telegram */
  onVoice?: (fileId: string) => Promise<void>
  log: (text: string, kind?: 'info' | 'error') => void
}

/**
 * Long polling no getUpdates. Só obedece mensagens e cliques vindos do Chat ID configurado:
 * qualquer outra conversa é ignorada (só fica registrada para o botão "Detectar").
 */
export class TelegramBot {
  private running = false
  private offset = 0
  private last: { id: string; name: string } | null = null
  private conflictLogged = false

  constructor(private h: BotHandlers) {}

  isRunning(): boolean {
    return this.running
  }

  lastChat() {
    return this.last
  }

  start(): void {
    if (this.running) return
    this.running = true
    void this.loop()
  }

  stop(): void {
    this.running = false
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const { chatId, interactive } = this.h.settings()
      if (!interactive || !secrets.get('telegram.token')) {
        await sleep(5000)
        continue
      }
      const r = await call('getUpdates', { offset: this.offset, timeout: 25, allowed_updates: ['message', 'callback_query'] }, 35_000)
      if (!this.running) break
      if (!r.ok) {
        if (r.status === 409) {
          if (!this.conflictLogged) this.h.log('[Telegram] outro programa já está lendo este bot (webhook ou outro getUpdates). Botões e comandos pausados.', 'error')
          this.conflictLogged = true
          await sleep(60_000)
        } else {
          await sleep(10_000)
        }
        continue
      }
      this.conflictLogged = false
      for (const u of (r.result ?? []) as Array<Record<string, any>>) {
        this.offset = Math.max(this.offset, (u.update_id ?? 0) + 1)
        try {
          await this.handle(u, chatId)
        } catch (err) {
          this.h.log(`[Telegram] erro tratando atualização: ${(err as Error).message}`, 'error')
        }
      }
    }
  }

  private async handle(u: Record<string, any>, allowedChat: string): Promise<void> {
    const msg = u.message ?? u.callback_query?.message
    const chat = msg?.chat
    if (chat?.id) {
      const name = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || ''
      this.last = { id: String(chat.id), name }
    }
    const authorized = !!allowedChat && String(chat?.id ?? '') === allowedChat
    const reply = async (text: string) => {
      await call('sendMessage', { chat_id: allowedChat, text, parse_mode: 'HTML', disable_web_page_preview: true })
    }

    if (u.callback_query) {
      const cq = u.callback_query
      if (!authorized) {
        await call('answerCallbackQuery', { callback_query_id: cq.id, text: 'Não autorizado.' })
        return
      }
      const answer = await this.h.onCallback(String(cq.data ?? ''), reply, msg?.message_id ?? null)
      await call('answerCallbackQuery', { callback_query_id: cq.id, text: answer.slice(0, 190) })
      return
    }

    const voice = u.message?.voice ?? u.message?.audio
    if (authorized && voice?.file_id && this.h.onVoice) return this.h.onVoice(String(voice.file_id))
    const text: string = u.message?.text ?? ''
    if (!authorized || !text.trim()) return
    if (!text.startsWith('/')) return this.h.onText(text.trim())
    const [rawCmd, ...rest] = text.trim().split(/\s+/)
    const cmd = rawCmd.slice(1).split('@')[0].toLowerCase()
    await this.h.onCommand(cmd, rest.join(' '))
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

let bot: TelegramBot | null = null
export function registerBot(b: TelegramBot): void {
  bot = b
}

export function formatDecision(a: DeployAlert, approved: boolean): string {
  return `${approved ? '✅ Aprovado' : '🗑 Descartado'}: ${escapeHtml([a.card, a.environment].filter(Boolean).join(' → ') || a.summary)}`
}

/** Baixa um arquivo que chegou no Telegram (ex: áudio) */
export async function downloadTelegramFile(fileId: string): Promise<{ data: Buffer; name: string } | null> {
  const token = secrets.get('telegram.token')
  if (!token) return null
  const r = await call('getFile', { file_id: fileId })
  const path = (r.result as { file_path?: string } | undefined)?.file_path
  if (!r.ok || !path) return null
  const res = await fetch(`${API()}/file/bot${token}/${path}`)
  if (!res.ok) return null
  return { data: Buffer.from(await res.arrayBuffer()), name: path.split('/').pop() || 'audio.ogg' }
}

/** Manda uma imagem (PNG) com legenda */
export async function sendTelegramPhoto(chatId: string, png: Buffer, caption: string): Promise<boolean> {
  const token = secrets.get('telegram.token')
  if (!token || !chatId) return false
  const form = new FormData()
  form.append('chat_id', chatId)
  form.append('caption', caption.slice(0, 1000))
  form.append('photo', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'tela.png')
  try {
    const res = await fetch(`${API()}/bot${token}/sendPhoto`, { method: 'POST', body: form })
    return res.ok
  } catch {
    return false
  }
}
