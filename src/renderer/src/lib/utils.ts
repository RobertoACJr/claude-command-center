import type { Project, ScriptTarget } from '@shared/types'

export function uid(): string {
  return crypto.randomUUID()
}

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

const VAR_RE = /\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g

/** Extrai nomes únicos de variáveis no formato {{nome}}, na ordem em que aparecem. */
export function extractVariables(text: string): string[] {
  const seen = new Set<string>()
  for (const m of text.matchAll(VAR_RE)) seen.add(m[1])
  return [...seen]
}

export const PROJECT_PREFIX = 'projeto.'

/** Variáveis que o usuário digita na hora (tudo que não é {{projeto.x}}) */
export function extractUserVariables(text: string): string[] {
  return extractVariables(text).filter((v) => !v.startsWith(PROJECT_PREFIX))
}

/** Chaves de {{projeto.x}} usadas no texto (sem o prefixo) */
export function extractProjectKeys(text: string): string[] {
  return extractVariables(text)
    .filter((v) => v.startsWith(PROJECT_PREFIX))
    .map((v) => v.slice(PROJECT_PREFIX.length))
}

/** Valores {{projeto.x}} de um projeto: as variáveis dele + nome/pasta embutidos */
export function projectValues(p: Project): Record<string, string> {
  const out: Record<string, string> = {
    [PROJECT_PREFIX + 'nome']: p.name,
    [PROJECT_PREFIX + 'pasta']: p.path
  }
  for (const v of p.vars) out[PROJECT_PREFIX + v.key] = v.value
  return out
}

/** Quais {{projeto.x}} do script este projeto não define */
export function missingProjectKeys(text: string, p: Project): string[] {
  const vals = projectValues(p)
  return extractProjectKeys(text).filter((k) => !(PROJECT_PREFIX + k in vals))
}

/** Substitui {{nome}} pelos valores informados. */
export function fillVariables(text: string, values: Record<string, string>): string {
  return text.replace(VAR_RE, (_all, name: string) => values[name] ?? '')
}

export function resolveTargetPath(target: ScriptTarget, projects: Project[], home: string, askedProjectId?: string): string {
  if (target.kind === 'project') return projects.find((p) => p.id === target.projectId)?.path ?? home
  if (target.kind === 'ask') return projects.find((p) => p.id === askedProjectId)?.path ?? home
  if (target.kind === 'custom') return target.path || home
  return home
}

export function targetLabel(target: ScriptTarget, projects: Project[]): string {
  if (target.kind === 'project') return projects.find((p) => p.id === target.projectId)?.name ?? 'Projeto removido'
  if (target.kind === 'ask') return 'Escolhe o projeto'
  if (target.kind === 'custom') return shortPath(target.path)
  return 'Global (Home)'
}

export function shortPath(p: string, max = 46): string {
  if (!p) return ''
  if (p.length <= max) return p
  return '…' + p.slice(p.length - max + 1)
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}min`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}
