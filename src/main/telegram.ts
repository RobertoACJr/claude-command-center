import type { DeployAlert, OpResult } from '../shared/types'
import { secrets } from './secrets'

/** Permite apontar para um servidor falso em testes */
const API = () => process.env.CCC_TELEGRAM_API || 'https://api.telegram.org'

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

async function call(method: string, body?: Record<string, unknown>): Promise<{ ok: boolean; result?: any; description?: string }> {
  const token = secrets.get('telegram.token')
  if (!token) return { ok: false, description: 'Informe o token do bot.' }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15_000)
  try {
    const res = await fetch(`${API()}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal: ctrl.signal
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: unknown; description?: string }
    return { ok: Boolean(data.ok), result: data.result, description: data.description ?? `HTTP ${res.status}` }
  } catch (err) {
    // Nunca devolve a URL (ela contém o token)
    return { ok: false, description: (err as Error).name === 'AbortError' ? 'Tempo esgotado.' : 'Falha de rede.' }
  } finally {
    clearTimeout(timer)
  }
}

export async function sendTelegram(chatId: string, html: string): Promise<OpResult> {
  if (!chatId) return { ok: false, message: 'Informe o Chat ID.' }
  const r = await call('sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true })
  return { ok: r.ok, message: r.ok ? 'Mensagem enviada.' : (r.description ?? 'Erro') }
}

/** Lê as últimas mensagens recebidas pelo bot para descobrir o seu Chat ID */
export async function detectChatId(): Promise<OpResult> {
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

export function formatAlert(a: DeployAlert): string {
  const line = (label: string, v: string) => (v ? `<b>${label}:</b> ${escapeHtml(v)}\n` : '')
  return (
    '🚨 <b>Pedido de deploy detectado</b>\n\n' +
    line('Quem pediu', a.requester) +
    line('Card', a.card) +
    line('Branch', a.branch) +
    line('Ambiente', a.environment) +
    line('Espaço', a.space) +
    (a.summary ? `\n<i>${escapeHtml(a.summary)}</i>\n` : '') +
    (a.link ? `\n${escapeHtml(a.link)}\n` : '') +
    '\n⏸ Nada foi executado. Aguardando sua aprovação no Claude Command Center.'
  )
}

export function formatDecision(a: DeployAlert, approved: boolean): string {
  return `${approved ? '✅ Aprovado' : '🗑 Descartado'}: ${escapeHtml([a.card, a.environment].filter(Boolean).join(' → ') || a.summary)}`
}
