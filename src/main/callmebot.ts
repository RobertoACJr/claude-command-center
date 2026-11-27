// Ligação de voz pelo Telegram via CallMeBot (api.callmebot.com): serviço gratuito e NÃO oficial.
// O robô liga para o seu Telegram e lê um texto curto. Só o texto da ligação sai daqui (nada de conteúdo das mensagens).
// Antes de usar, autorize o robô mandando /start para @CallMeBot_txtbot no Telegram.
import type { CallConfig, OpResult } from '../shared/types'

const MIN_GAP_MS = 90_000
let lastCall = 0

/** @usuario ou +55… (o resto é recusado) */
export function validCallUser(u: string): boolean {
  return /^@[A-Za-z0-9_]{4,32}$/.test(u.trim()) || /^\+\d{8,15}$/.test(u.trim())
}

export function callUrl(cfg: Pick<CallConfig, 'user' | 'lang'>, text: string): string {
  const q = new URLSearchParams({ source: 'Helice', user: cfg.user.trim(), text: text.slice(0, 250), lang: cfg.lang || 'pt-BR-Standard-A', rpt: '2' })
  return `https://api.callmebot.com/start.php?${q.toString()}`
}

/** Liga (no máximo uma vez a cada 90 s, para não virar spam) */
export async function callMe(cfg: CallConfig, text: string, force = false): Promise<OpResult> {
  if (!cfg.enabled && !force) return { ok: false, message: 'Ligação desligada.' }
  if (!validCallUser(cfg.user)) return { ok: false, message: 'Informe seu @usuario do Telegram (ou o número com +55…).' }
  const now = Date.now()
  if (now - lastCall < MIN_GAP_MS) return { ok: false, message: 'Já liguei há pouco; espero um pouco antes de ligar de novo.' }
  lastCall = now
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 20_000)
    const r = await fetch(callUrl(cfg, text), { signal: ctl.signal })
    clearTimeout(t)
    const body = (await r.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (!r.ok) return { ok: false, message: `O CallMeBot recusou (${r.status}). ${body.slice(0, 160)}` }
    // A página diz quando falta autorizar o robô
    if (/not authori[sz]ed|authorize|autoriz/i.test(body)) return { ok: false, message: 'Falta autorizar: mande /start para @CallMeBot_txtbot no Telegram.' }
    return { ok: true, message: 'Ligando pelo Telegram…' }
  } catch (e) {
    return { ok: false, message: `Não consegui falar com o CallMeBot: ${(e as Error).message}` }
  }
}
