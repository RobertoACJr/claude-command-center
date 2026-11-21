import { existsSync, readFileSync, statSync } from 'fs'
import { isAbsolute, join, normalize, relative } from 'path'
import type { Project } from '../shared/types'

/** Tamanho máximo de cada guia colado no prompt (o resto a IA lê no arquivo) */
const MAX_INLINE = 30_000

/** Caminho do guia, sempre dentro da pasta do projeto */
function resolveGuide(projectPath: string, guide: string): string | null {
  if (!projectPath || !guide.trim()) return null
  const full = normalize(isAbsolute(guide) ? guide : join(projectPath, guide))
  const rel = relative(projectPath, full)
  if (rel.startsWith('..') || isAbsolute(rel)) return null
  return full
}

export function checkGuides(projectPath: string, guides: string[]): boolean[] {
  return guides.map((g) => {
    const f = resolveGuide(projectPath, String(g))
    try {
      return !!f && existsSync(f) && statSync(f).isFile()
    } catch {
      return false
    }
  })
}

/** Conteúdo dos guias que existem (para as Demandas) */
export function readGuides(p: Project): Array<{ path: string; content: string; truncated: boolean }> {
  const out: Array<{ path: string; content: string; truncated: boolean }> = []
  for (const g of p.guides ?? []) {
    const f = resolveGuide(p.path, g)
    if (!f) continue
    try {
      const text = readFileSync(f, 'utf8')
      out.push({ path: g, content: text.slice(0, MAX_INLINE), truncated: text.length > MAX_INLINE })
    } catch {
      /* não existe: ignora */
    }
  }
  return out
}

/** Instrução extra para o Claude em qualquer execução dentro do projeto */
export function guidesInstruction(p: Project | undefined): string | null {
  const list = (p?.guides ?? []).filter((g, i) => checkGuides(p!.path, [g])[0] && i < 10)
  if (!list.length) return null
  return (
    `Este projeto tem guias que você DEVE seguir. Antes de escrever ou revisar código, leia: ${list.join(', ')} ` +
    '(caminhos relativos à pasta do projeto). Em caso de conflito entre o guia e o código existente, siga o guia e avise.'
  )
}
