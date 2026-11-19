import type { AutomationRule, DeployAlert, Project } from './types'

/** Funções de variáveis usadas tanto pela interface quanto pelo main process */

export const VAR_RE = /\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g
export const PROJECT_PREFIX = 'projeto.'

/** Nomes únicos de {{variaveis}} na ordem em que aparecem */
export function extractVariables(text: string): string[] {
  const seen = new Set<string>()
  for (const m of text.matchAll(VAR_RE)) seen.add(m[1])
  return [...seen]
}

export function fillVariables(text: string, values: Record<string, string>): string {
  return text.replace(VAR_RE, (_all, name: string) => values[name] ?? '')
}

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

/** Valores que um pedido do Vigia preenche nos scripts e nas respostas */
export function alertValues(a: DeployAlert, projectName = ''): Record<string, string> {
  return {
    card: a.card,
    ticket: a.card,
    issue: a.card,
    branch: a.branch,
    ambiente: a.environment,
    environment: a.environment,
    env: a.environment,
    solicitante: a.requester,
    requester: a.requester,
    resumo: a.summary,
    projeto: projectName || a.projectHint
  }
}

/** Trava fixa: nada roda sozinho em produção, nem que uma regra peça */
const PROD_RE = /\b(prod|produ[cç][aã]o|production|prd|live|main|master)\b/i
export function isProdEnv(env: string): boolean {
  return PROD_RE.test(env.trim())
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')

/**
 * Associa o projeto citado no pedido a um projeto cadastrado.
 * Compara com o nome do projeto e com a variável "apelidos" (separados por vírgula).
 */
export function matchProject(hint: string, projects: Project[]): Project | undefined {
  const h = norm(hint)
  if (!h) return undefined
  for (const p of projects) {
    const names = [p.name, ...(p.vars.find((v) => v.key === 'apelidos')?.value.split(',') ?? [])].map(norm).filter(Boolean)
    if (names.some((n) => n === h)) return p
  }
  for (const p of projects) {
    const n = norm(p.name)
    if (n.length >= 3 && (h.includes(n) || n.includes(h))) return p
  }
  return undefined
}

/** Ambientes da regra casam com o do pedido? ("*" = qualquer) */
export function envMatches(rule: AutomationRule, env: string): boolean {
  const list = rule.environments
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  if (list.includes('*')) return true
  const e = env.trim().toLowerCase()
  return !!e && list.some((x) => x === e || e.includes(x))
}

/** Primeira regra ativa que casa com o pedido */
export function findRule(a: DeployAlert, rules: AutomationRule[]): AutomationRule | undefined {
  return rules.find((r) => r.enabled && envMatches(r, a.environment) && (!r.projectId || r.projectId === a.projectId))
}
