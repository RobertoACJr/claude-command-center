import { existsSync, readFileSync, statSync, writeFileSync } from 'fs'
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

/** Guias + arquivo de memória (sem repetir) */
export function allGuides(p: Project): string[] {
  const list = [...(p.guides ?? [])]
  const mem = p.memoryFile?.trim()
  if (mem && !list.includes(mem)) list.push(mem)
  return list
}

/** Conteúdo dos guias que existem (para as Demandas) */
export function readGuides(p: Project): Array<{ path: string; content: string; truncated: boolean }> {
  const out: Array<{ path: string; content: string; truncated: boolean }> = []
  for (const g of allGuides(p)) {
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
  // CLAUDE.md o Claude Code já lê sozinho; os outros ele precisa ser lembrado
  const list = (p ? allGuides(p) : []).filter((g, i) => g !== 'CLAUDE.md' && checkGuides(p!.path, [g])[0] && i < 11)
  if (!list.length) return null
  return (
    `Este projeto tem guias que você DEVE seguir. Antes de escrever ou revisar código, leia: ${list.join(', ')} ` +
    '(caminhos relativos à pasta do projeto). Em caso de conflito entre o guia e o código existente, siga o guia e avise.'
  )
}

export const MEMORY_HEADER = '## Aprendizados (anotados pela Hélice)'

/** Acrescenta um aprendizado ao arquivo de memória (cria a seção se não existir) */
export function appendLesson(content: string, lesson: string, date = new Date()): string {
  const line = `- ${lesson.replace(/\s+/g, ' ').trim()} _(${date.toLocaleDateString('pt-BR')})_`
  if (!content.trim()) return `# Memória do projeto\n\nRegras e aprendizados que as IAs devem seguir neste projeto.\n\n${MEMORY_HEADER}\n\n${line}\n`
  if (!content.includes(MEMORY_HEADER)) return `${content.replace(/\s*$/, '')}\n\n${MEMORY_HEADER}\n\n${line}\n`
  // Entra no fim da seção (antes do próximo título de mesmo nível)
  const start = content.indexOf(MEMORY_HEADER) + MEMORY_HEADER.length
  const next = content.slice(start).search(/\n## /)
  if (next < 0) return `${content.replace(/\s*$/, '')}\n${line}\n`
  const at = start + next
  return `${content.slice(0, at).replace(/\s*$/, '')}\n${line}\n${content.slice(at)}`
}

/** Grava o aprendizado no arquivo de memória do projeto (padrão CLAUDE.md, que o Claude Code lê sozinho) */
export function learn(p: Project, lesson: string): { ok: boolean; message: string } {
  if (!lesson.trim()) return { ok: false, message: 'Escreva o que o projeto deve lembrar.' }
  const file = resolveGuide(p.path, p.memoryFile || 'CLAUDE.md')
  if (!file) return { ok: false, message: 'O arquivo de memória precisa ficar dentro da pasta do projeto.' }
  let cur = ''
  try {
    if (existsSync(file)) cur = readFileSync(file, 'utf8')
  } catch {
    return { ok: false, message: 'Não consegui ler o arquivo de memória.' }
  }
  writeFileSync(file, appendLesson(cur, lesson))
  return { ok: true, message: `Guardado em ${p.memoryFile || 'CLAUDE.md'}: as próximas tarefas neste projeto vão seguir isso.` }
}

export { looksLikeRule } from '../shared/text'
