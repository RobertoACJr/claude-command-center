import type { OpResult } from '../shared/types'
import { secrets } from './secrets'
import { store } from './store'

/**
 * Jira (REST v2, com o e-mail e o API token de Configurações → Integrações):
 * mudar o status do card (transições) e lançar horas (worklog).
 */

async function jira(path: string, init?: { method?: string; body?: unknown }): Promise<{ ok: boolean; status: number; data?: any; message?: string }> {
  const j = store.get().integrations.jira
  const token = secrets.get('jira.token')
  if (!j.url || !j.email || !token) return { ok: false, status: 0, message: 'Configure o Jira (Configurações → Integrações).' }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20_000)
  try {
    const res = await fetch(`${j.url.replace(/\/+$/, '')}/rest/api/2/${path}`, {
      method: init?.method ?? 'GET',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${j.email}:${token}`).toString('base64'),
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {})
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
      signal: ctrl.signal
    })
    const text = await res.text()
    let data: any
    try {
      data = text ? JSON.parse(text) : undefined
    } catch {
      data = undefined
    }
    if (res.ok) return { ok: true, status: res.status, data }
    const why = (data?.errorMessages ?? []).concat(Object.values(data?.errors ?? {})).join(' ')
    const message =
      res.status === 401 || res.status === 403
        ? 'O Jira recusou: sem permissão (confira o e-mail e o API token).'
        : res.status === 404
          ? 'Card não encontrado (ou sem acesso).'
          : `O Jira respondeu HTTP ${res.status}${why ? `: ${why}` : ''}`
    return { ok: false, status: res.status, data, message }
  } catch (err) {
    return { ok: false, status: 0, message: (err as Error).name === 'AbortError' ? 'O Jira demorou demais para responder.' : 'Falha de rede ao falar com o Jira.' }
  } finally {
    clearTimeout(timer)
  }
}

export interface JiraTransition {
  id: string
  /** Nome da ação (ex.: "Iniciar desenvolvimento") */
  name: string
  /** Status de destino (ex.: "Em andamento") */
  to: string
}

/** Status atual do card e para onde ele pode ir (depende do fluxo do projeto no Jira) */
export async function jiraTransitions(key: string): Promise<OpResult & { status?: string; transitions?: JiraTransition[] }> {
  const k = encodeURIComponent(key)
  const [issue, tr] = await Promise.all([jira(`issue/${k}?fields=status`), jira(`issue/${k}/transitions`)])
  if (!issue.ok) return { ok: false, message: issue.message ?? 'Erro no Jira.' }
  if (!tr.ok) return { ok: false, message: tr.message ?? 'Erro no Jira.' }
  const transitions = ((tr.data?.transitions ?? []) as Array<Record<string, any>>).map((t) => ({
    id: String(t.id),
    name: String(t.name ?? ''),
    to: String(t.to?.name ?? t.name ?? '')
  }))
  return { ok: true, message: '', status: String(issue.data?.fields?.status?.name ?? ''), transitions }
}

export async function jiraTransition(key: string, transitionId: string): Promise<OpResult & { status?: string }> {
  if (!/^\d+$/.test(transitionId)) return { ok: false, message: 'Transição inválida.' }
  const r = await jira(`issue/${encodeURIComponent(key)}/transitions`, { method: 'POST', body: { transition: { id: transitionId } } })
  if (!r.ok) {
    return {
      ok: false,
      message: r.status === 400 ? `O Jira não deixou mudar: ${r.message?.replace(/^O Jira respondeu HTTP 400: ?/, '') || 'pode faltar um campo obrigatório nesta transição (faça pelo site).'}` : r.message ?? 'Erro.'
    }
  }
  const now = await jira(`issue/${encodeURIComponent(key)}?fields=status`)
  const status = now.ok ? String(now.data?.fields?.status?.name ?? '') : ''
  return { ok: true, message: status ? `${key} agora está em "${status}" no Jira.` : `${key} atualizado no Jira.`, status }
}

/** Data no formato que o Jira quer no worklog: 2026-11-25T09:00:00.000-0400 */
export function jiraDate(t: number): string {
  const d = new Date(t)
  const pad = (n: number, l = 2) => String(Math.abs(n)).padStart(l, '0')
  const off = -d.getTimezoneOffset()
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.000` +
    `${off >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(off) / 60))}${pad(Math.abs(off) % 60)}`
  )
}

/** Lança horas no card (mínimo 1 minuto; o Jira arredonda) */
export async function jiraWorklog(key: string, seconds: number, startedAt: number, comment = ''): Promise<OpResult> {
  const secs = Math.max(60, Math.round(seconds / 60) * 60)
  const r = await jira(`issue/${encodeURIComponent(key)}/worklog`, {
    method: 'POST',
    body: { timeSpentSeconds: secs, started: jiraDate(startedAt), ...(comment ? { comment } : {}) }
  })
  if (!r.ok) return { ok: false, message: r.message ?? 'Erro ao lançar horas.' }
  const h = Math.floor(secs / 3600)
  const m = Math.round((secs % 3600) / 60)
  return { ok: true, message: `Lancei ${h ? `${h}h` : ''}${m ? `${m}min` : ''} em ${key} no Jira.` }
}

/** Status de vários cards (de 5 em 5, para não estourar o limite do Jira). done = categoria "Concluído" */
export async function jiraStatuses(keys: string[]): Promise<Map<string, { status: string; done: boolean } | null>> {
  const out = new Map<string, { status: string; done: boolean } | null>()
  for (let i = 0; i < keys.length; i += 5) {
    const part = keys.slice(i, i + 5)
    const res = await Promise.all(part.map((k) => jira(`issue/${encodeURIComponent(k)}?fields=status`)))
    part.forEach((k, j) => {
      const r = res[j]
      const st = r.ok ? r.data?.fields?.status : null
      out.set(k, st ? { status: String(st.name ?? ''), done: String(st.statusCategory?.key ?? '') === 'done' } : null)
    })
  }
  return out
}

export function jiraConfigured(): boolean {
  const j = store.get().integrations.jira
  return !!(j.url && j.email && secrets.get('jira.token'))
}

/** Card atribuído a você que ainda não virou demanda */
export interface JiraAssigned {
  key: string
  summary: string
  status: string
  updated: string
}

/** Cards abertos atribuídos a você (mais recentes primeiro) */
export async function jiraAssigned(max = 30): Promise<OpResult & { issues?: JiraAssigned[] }> {
  const jql = 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC'
  const q = `jql=${encodeURIComponent(jql)}&fields=summary,status,updated&maxResults=${max}`
  // Jira Cloud novo: search/jql; Jira Server/antigo: search
  let r = await jira(`search/jql?${q}`)
  if (!r.ok && (r.status === 404 || r.status === 410)) r = await jira(`search?${q}`)
  if (!r.ok) return { ok: false, message: r.message ?? 'O Jira não respondeu.' }
  const issues: JiraAssigned[] = (Array.isArray(r.data?.issues) ? r.data.issues : [])
    .filter((i: any) => typeof i?.key === 'string')
    .map((i: any) => ({
      key: String(i.key),
      summary: String(i.fields?.summary ?? '').slice(0, 300),
      status: String(i.fields?.status?.name ?? ''),
      updated: String(i.fields?.updated ?? '')
    }))
  return { ok: true, message: `${issues.length} card(s) atribuído(s) a você.`, issues }
}
