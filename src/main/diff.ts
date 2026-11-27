// Mudanças de um projeto para ver no app (antes do PR): lista de arquivos e o diff de cada um.
// Duas comparações: "sem commit" (pasta × último commit) e "desde a base" (pasta × onde a branch saiu da principal).
import type { DiffFile, DiffSummary, DiffText, Project } from '../shared/types'
import { baseBranch, git, remotesOf } from './git'

const MAX_FILE_DIFF = 400_000
/** Caminho relativo e dentro do repositório (vem da interface) */
export const SAFE_PATH = (p: string) => !!p && !p.startsWith('/') && !/^[a-zA-Z]:/.test(p) && !p.split(/[\\/]/).includes('..')

/** "--name-status -M" + "--numstat -M" → arquivos */
export function parseDiffLists(nameStatus: string, numstat: string): DiffFile[] {
  const counts = new Map<string, { add: number | null; del: number | null }>()
  for (const line of numstat.split('\n')) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/)
    if (!m) continue
    // Renomeado: "a => b" ou "dir/{a => b}/x"
    let path = m[3]
    const brace = path.match(/^(.*)\{(.*) => (.*)\}(.*)$/)
    if (brace) path = `${brace[1]}${brace[3]}${brace[4]}`.replace(/\/\//g, '/')
    else if (path.includes(' => ')) path = path.split(' => ')[1]
    counts.set(path, { add: m[1] === '-' ? null : Number(m[1]), del: m[2] === '-' ? null : Number(m[2]) })
  }
  const out: DiffFile[] = []
  for (const line of nameStatus.split('\n')) {
    const parts = line.split('\t')
    if (parts.length < 2) continue
    const code = parts[0][0]
    const status: DiffFile['status'] = code === 'A' ? 'A' : code === 'D' ? 'D' : code === 'R' || code === 'C' ? 'R' : 'M'
    const path = status === 'R' ? parts[2] : parts[1]
    if (!path) continue
    const c = counts.get(path) ?? { add: null, del: null }
    out.push({ path, oldPath: status === 'R' ? parts[1] : undefined, status, ...c, binary: c.add === null && c.del === null })
  }
  return out
}

/** Referência para "desde a base": empresa/principal se existir, senão a principal local */
async function baseRef(p: Project): Promise<string> {
  const base = await baseBranch(p)
  const { company } = remotesOf(p)
  return (await git(p.path, ['rev-parse', '--verify', '--quiet', `refs/remotes/${company}/${base}`], 4000)).ok ? `${company}/${base}` : base
}

/** Commit de comparação para o modo escolhido */
async function compareRef(p: Project, mode: 'local' | 'base'): Promise<{ ref: string; label: string } | { error: string }> {
  if (mode === 'local') {
    if (!(await git(p.path, ['rev-parse', '--verify', '--quiet', 'HEAD'], 4000)).ok) return { error: 'O repositório ainda não tem commits.' }
    return { ref: 'HEAD', label: 'o último commit' }
  }
  const b = await baseRef(p)
  const mb = await git(p.path, ['merge-base', b, 'HEAD'], 10_000)
  if (!mb.ok || !mb.out) return { error: `Não achei onde a branch saiu de ${b}.` }
  return { ref: mb.out.split('\n')[0].trim(), label: b }
}

export async function diffSummary(p: Project, mode: 'local' | 'base'): Promise<DiffSummary> {
  const branch = (await git(p.path, ['rev-parse', '--abbrev-ref', 'HEAD'], 4000)).out.split('\n')[0] || null
  const c = await compareRef(p, mode)
  if ('error' in c) return { ok: false, message: c.error, mode, ref: '', refLabel: '', branch, files: [] }
  const [ns, num, untracked] = await Promise.all([
    git(p.path, ['diff', '--name-status', '-M', c.ref], 20_000),
    git(p.path, ['diff', '--numstat', '-M', c.ref], 20_000),
    git(p.path, ['ls-files', '--others', '--exclude-standard'], 20_000)
  ])
  if (!ns.ok) return { ok: false, message: ns.out || 'O git não respondeu.', mode, ref: c.ref, refLabel: c.label, branch, files: [] }
  const files = parseDiffLists(ns.out, num.out)
  for (const f of untracked.ok ? untracked.out.split('\n').filter(Boolean).slice(0, 500) : []) {
    if (!files.some((x) => x.path === f)) files.push({ path: f, status: '?', add: null, del: null, binary: false })
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  return { ok: true, mode, ref: c.ref, refLabel: c.label, branch, files }
}

export async function diffFile(p: Project, f: Pick<DiffFile, 'path' | 'oldPath' | 'status'>, ref: string): Promise<DiffText> {
  if (!SAFE_PATH(f.path) || (f.oldPath && !SAFE_PATH(f.oldPath))) return { text: '', binary: false, truncated: false, error: 'Caminho inválido.' }
  if (!/^[\w./-]+$/.test(ref)) return { text: '', binary: false, truncated: false, error: 'Referência inválida.' }
  // Arquivo novo (sem git add): compara com "nada"
  const r =
    f.status === '?'
      ? await git(p.path, ['diff', '--no-index', '--', process.platform === 'win32' ? 'NUL' : '/dev/null', f.path], 20_000)
      : await git(p.path, ['diff', '-M', ref, '--', ...(f.oldPath ? [f.oldPath] : []), f.path], 20_000)
  // --no-index sai com 1 quando há diferença: isso não é erro
  let text = r.out
  if (!r.ok && !(f.status === '?' && r.code === 1)) return { text: '', binary: false, truncated: false, error: text || 'O git não respondeu.' }
  const binary = /^Binary files .* differ$/m.test(text)
  const truncated = text.length > MAX_FILE_DIFF
  if (truncated) text = text.slice(0, MAX_FILE_DIFF)
  return { text, binary, truncated }
}
