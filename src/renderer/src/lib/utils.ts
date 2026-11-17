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

/** Substitui {{nome}} pelos valores informados. */
export function fillVariables(text: string, values: Record<string, string>): string {
  return text.replace(VAR_RE, (_all, name: string) => values[name] ?? '')
}

export function resolveTargetPath(target: ScriptTarget, projects: Project[], home: string): string {
  if (target.kind === 'project') return projects.find((p) => p.id === target.projectId)?.path ?? home
  if (target.kind === 'custom') return target.path || home
  return home
}

export function targetLabel(target: ScriptTarget, projects: Project[]): string {
  if (target.kind === 'project') return projects.find((p) => p.id === target.projectId)?.name ?? 'Projeto removido'
  if (target.kind === 'custom') return shortPath(target.path)
  return 'Global (Home)'
}

export function shortPath(p: string, max = 46): string {
  if (!p) return ''
  if (p.length <= max) return p
  return '…' + p.slice(p.length - max + 1)
}
