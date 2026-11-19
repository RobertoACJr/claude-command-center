import type { Project, ScriptTarget } from '@shared/types'

export function uid(): string {
  return crypto.randomUUID()
}

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export {
  extractVariables,
  fillVariables,
  extractUserVariables,
  extractProjectKeys,
  projectValues,
  missingProjectKeys,
  PROJECT_PREFIX
} from '@shared/vars'

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
