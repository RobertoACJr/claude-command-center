import { execFile } from 'child_process'
import { existsSync } from 'fs'
import type { GitInfo, OpResult, Project } from '../shared/types'

/** Roda o git sem shell (nada de injeção por nome de branch) */
export function git(cwd: string, args: string[], timeout = 30_000): Promise<{ ok: boolean; out: string; code: number | null }> {
  return new Promise((resolve) => {
    if (!cwd || !existsSync(cwd)) return resolve({ ok: false, out: 'Pasta não encontrada.', code: null })
    execFile(
      'git',
      args,
      { cwd, timeout, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (err, stdout, stderr) => {
        const raw: unknown = err ? (err as unknown as { code?: unknown }).code : 0
        resolve({ ok: !err, out: `${stdout}${stderr}`.trim(), code: typeof raw === 'number' ? raw : 1 })
      }
    )
  })
}

/** Branch atual via `git rev-parse --abbrev-ref HEAD`. Retorna null se não for repo git. */
export async function getGitBranch(cwd: string): Promise<string | null> {
  const r = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'], 4000)
  if (!r.ok) return null
  const b = r.out.split('\n')[0].trim()
  return b === 'HEAD' ? '(detached)' : b || null
}

export const SAFE_BRANCH = /^[\w./-]+$/

/** Branch principal: variável branch_principal do projeto, senão a padrão do remoto, senão main/master */
export async function baseBranch(p: Project): Promise<string> {
  const v = p.vars.find((x) => x.key === 'branch_principal')?.value.trim()
  if (v && SAFE_BRANCH.test(v)) return v
  const head = await git(p.path, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], 4000)
  if (head.ok && head.out.startsWith('origin/')) return head.out.slice('origin/'.length).split('\n')[0]
  for (const b of ['master', 'main']) {
    if ((await git(p.path, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`], 4000)).ok) return b
  }
  return 'master'
}

/** Resumo para o card: branch, alterados, à frente/atrás do remoto, último commit */
export async function gitInfo(p: Project): Promise<GitInfo | null> {
  const st = await git(p.path, ['status', '--porcelain=v2', '--branch'], 8000)
  if (!st.ok) return null
  const info: GitInfo = { branch: null, upstream: null, ahead: 0, behind: 0, changed: 0, conflicts: 0, lastCommit: null, base: '' }
  for (const line of st.out.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      const b = line.slice('# branch.head '.length).trim()
      info.branch = b === '(detached)' ? '(detached)' : b
    } else if (line.startsWith('# branch.upstream ')) info.upstream = line.slice('# branch.upstream '.length).trim()
    else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+) -(\d+)/)
      if (m) {
        info.ahead = Number(m[1])
        info.behind = Number(m[2])
      }
    } else if (line.startsWith('u ')) {
      info.conflicts++
      info.changed++
    } else if (/^[12?] /.test(line)) info.changed++
  }
  const log = await git(p.path, ['log', '-1', '--format=%h%x09%s%x09%cr'], 4000)
  if (log.ok && log.out) {
    const [hash, subject, when] = log.out.split('\t')
    info.lastCommit = { hash, subject: subject ?? '', when: when ?? '' }
  }
  info.base = await baseBranch(p)
  return info
}

export async function gitPull(p: Project): Promise<OpResult> {
  const info = await gitInfo(p)
  if (!info) return { ok: false, message: 'Esta pasta não é um repositório git.' }
  if (!info.upstream) return { ok: false, message: `A branch ${info.branch} ainda não existe no remoto (nunca teve push): nada para puxar.` }
  const r = await git(p.path, ['pull', '--ff-only'], 120_000)
  if (r.ok) return { ok: true, message: /Already up to date|Já está atualizado/i.test(r.out) ? 'Já estava atualizado.' : 'Atualizado com o remoto.' }
  if (/not possible to fast-forward|Not possible to fast-forward|diverg/i.test(r.out)) {
    return { ok: false, message: 'Sua branch e a do remoto têm commits diferentes: o app não mistura sozinho. Resolva no terminal (pull com merge ou rebase).' }
  }
  if (/would be overwritten|local changes/i.test(r.out)) {
    return { ok: false, message: 'Você tem alterações sem commit que conflitam com o que veio do remoto. Faça commit ou stash antes.' }
  }
  return { ok: false, message: 'O git recusou: ' + r.out.split('\n').slice(-2).join(' ') }
}

export async function gitBranches(p: Project): Promise<string[]> {
  const r = await git(p.path, ['for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/heads/'], 6000)
  return r.ok ? r.out.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 40) : []
}

export async function gitCheckout(p: Project, branch: string): Promise<OpResult> {
  if (!SAFE_BRANCH.test(branch)) return { ok: false, message: 'Nome de branch inválido.' }
  const r = await git(p.path, ['checkout', branch], 30_000)
  if (r.ok) return { ok: true, message: `Agora em ${branch}.` }
  if (/would be overwritten|local changes/i.test(r.out)) {
    return { ok: false, message: 'Você tem alterações sem commit que seriam perdidas. Faça commit ou stash antes de trocar de branch.' }
  }
  return { ok: false, message: 'O git recusou: ' + r.out.split('\n').slice(-2).join(' ') }
}

/**
 * Atualiza a branch atual com a principal do remoto (fetch + merge de origin/<base>).
 * Só roda com a árvore limpa. Em conflito, deixa o merge aberto e diz quais arquivos.
 */
export async function updateWithBase(p: Project, expectBranch: string): Promise<OpResult & { conflicts?: string[] }> {
  const info = await gitInfo(p)
  if (!info) return { ok: false, message: 'Esta pasta não é um repositório git.' }
  if (info.branch !== expectBranch) return { ok: false, message: `Você está em ${info.branch}, não em ${expectBranch}. Vá para a branch da demanda antes.` }
  if (info.conflicts) return { ok: false, message: 'Já existe um merge com conflito em andamento. Resolva antes.' }
  if (info.changed) {
    return { ok: false, message: `Há ${info.changed} arquivo(s) alterado(s) sem commit. Faça commit (ou stash) antes de atualizar com a ${info.base}.` }
  }
  const base = info.base
  const fetch = await git(p.path, ['fetch', 'origin', base], 120_000)
  const hasRemote = fetch.ok
  const ref = hasRemote ? `origin/${base}` : base
  if (!hasRemote && !(await git(p.path, ['rev-parse', '--verify', '--quiet', `refs/heads/${base}`])).ok) {
    return { ok: false, message: `Não achei a ${base} (nem no remoto, nem local): ${fetch.out.split('\n').slice(-1)[0]}` }
  }
  const behind = await git(p.path, ['rev-list', '--count', `HEAD..${ref}`], 8000)
  if (behind.ok && behind.out.trim() === '0') return { ok: true, message: `Já estava em dia com a ${ref}.` }
  const m = await git(p.path, ['merge', '--no-edit', ref], 120_000)
  if (m.ok) return { ok: true, message: `Atualizada com a ${ref} (${behind.out.trim() || '?'} commit(s) trazido(s)). Ainda sem push.` }
  const files = await git(p.path, ['diff', '--name-only', '--diff-filter=U'], 8000)
  const conflicts = files.ok ? files.out.split('\n').filter(Boolean) : []
  if (conflicts.length) {
    return {
      ok: false,
      conflicts,
      message: `Conflito em ${conflicts.length} arquivo(s): ${conflicts.slice(0, 5).join(', ')}${conflicts.length > 5 ? '…' : ''}. O merge ficou aberto: resolva (ou peça ao Claude) e faça o commit, ou desfaça com git merge --abort.`
    }
  }
  if (/empty ident|auto-detect email|tell me who you are/i.test(m.out)) {
    return { ok: false, message: 'O git não sabe seu nome/e-mail. Rode no terminal: git config --global user.name "Seu Nome" e git config --global user.email voce@empresa.com' }
  }
  return { ok: false, message: 'O merge falhou: ' + m.out.split('\n').slice(-2).join(' ') }
}
