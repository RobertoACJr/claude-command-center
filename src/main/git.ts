import { execFile } from 'child_process'
import { appendFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync } from 'fs'
import { dirname, isAbsolute, join } from 'path'
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

// ---------------------------------------------------------------- cópia separada para a fila (git worktree)

/** Branch da fila para um card: fila/WEB-482 */
export const queueBranch = (key: string) => `fila/${key}`

const exists = async (cwd: string, ref: string) => (await git(cwd, ['rev-parse', '--verify', '--quiet', ref], 6000)).ok

/**
 * Garante a cópia da fila (worktree) em `dir`, na branch fila/<card>.
 * Nasce da branch do card (ou da principal, se o card ainda não tem branch) e, a cada tarefa,
 * recebe o que você avançou na branch do card.
 */
/** Pastas node_modules do projeto (raiz e até 2 níveis, ex: packages/app/node_modules) */
export function findNodeModules(root: string, depth = 2, rel = ''): string[] {
  const out: string[] = []
  let entries: string[] = []
  try {
    entries = readdirSync(join(root, rel))
  } catch {
    return out
  }
  for (const name of entries) {
    if (name === '.git') continue
    const r = rel ? join(rel, name) : name
    let isDir = false
    try {
      isDir = statSync(join(root, r)).isDirectory()
    } catch {
      continue
    }
    if (!isDir) continue
    if (name === 'node_modules') out.push(r)
    else if (depth > 0 && !name.startsWith('.')) out.push(...findNodeModules(root, depth - 1, r))
  }
  return out
}

const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb']

/**
 * A cópia da fila usa as dependências do projeto principal (atalho para o node_modules, sem instalar de novo).
 * O atalho entra no "exclude" do git para nunca ir num commit. Se o arquivo de lock da cópia ficou diferente,
 * devolve um aviso (as dependências emprestadas podem não bater).
 */
export async function linkDependencies(projectPath: string, dir: string): Promise<{ linked: string[]; warn?: string }> {
  const linked: string[] = []
  const rels = findNodeModules(projectPath)
  for (const rel of rels) {
    const link = join(dir, rel)
    if (!existsSync(dirname(link))) continue
    try {
      lstatSync(link)
      continue // já existe (atalho ou pasta)
    } catch {
      /* não existe: cria */
    }
    try {
      symlinkSync(join(projectPath, rel), link, process.platform === 'win32' ? 'junction' : 'dir')
      linked.push(rel)
    } catch {
      /* sem permissão para atalho: segue sem */
    }
  }
  if (rels.length) {
    const ex = (await git(dir, ['rev-parse', '--git-path', 'info/exclude'], 6000)).out.trim()
    if (ex) {
      const file = isAbsolute(ex) ? ex : join(dir, ex)
      let cur = ''
      try {
        cur = readFileSync(file, 'utf8')
      } catch {
        mkdirSync(dirname(file), { recursive: true })
      }
      const add = rels.map((r) => '/' + r.split('\\').join('/')).filter((l) => !cur.split('\n').includes(l))
      if (add.length) appendFileSync(file, (cur && !cur.endsWith('\n') ? '\n' : '') + add.join('\n') + '\n')
    }
  }
  for (const lock of LOCKFILES) {
    const a = join(projectPath, lock)
    const b = join(dir, lock)
    if (existsSync(a) && existsSync(b) && !readFileSync(a).equals(readFileSync(b))) {
      return {
        linked,
        warn: `As dependências desta demanda mudaram (${lock}): o node_modules emprestado do projeto pode não bater. Instale na cópia (botão "Terminal na cópia") ou no projeto.`
      }
    }
  }
  return { linked }
}

/** Espaço ocupado por uma pasta (sem seguir atalhos nem entrar no .git) */
export function dirSize(dir: string, limit = 50_000): number {
  let total = 0
  let seen = 0
  const walk = (d: string) => {
    let names: string[] = []
    try {
      names = readdirSync(d)
    } catch {
      return
    }
    for (const n of names) {
      if (++seen > limit || n === '.git') continue
      const f = join(d, n)
      try {
        const st = lstatSync(f)
        if (st.isSymbolicLink()) continue
        if (st.isDirectory()) walk(f)
        else total += st.size
      } catch {
        /* sumiu no meio */
      }
    }
  }
  walk(dir)
  return total
}

export async function ensureWorktree(p: Project, key: string, dir: string): Promise<OpResult & { warn?: string }> {
  if (!SAFE_BRANCH.test(key)) return { ok: false, message: 'Número do card inválido para branch.' }
  const qb = queueBranch(key)
  await git(p.path, ['worktree', 'prune'], 10_000)
  const ready = existsSync(dir) && (await git(dir, ['rev-parse', '--is-inside-work-tree'], 6000)).ok
  if (!ready) {
    let r
    if (await exists(p.path, `refs/heads/${qb}`)) r = await git(p.path, ['worktree', 'add', dir, qb], 120_000)
    else {
      const base = await baseBranch(p)
      const start = (await exists(p.path, `refs/heads/${key}`))
        ? key
        : (await exists(p.path, `refs/remotes/origin/${base}`))
          ? `origin/${base}`
          : base
      r = await git(p.path, ['worktree', 'add', '-b', qb, dir, start], 120_000)
    }
    if (!r.ok) return { ok: false, message: 'Não consegui criar a cópia da fila: ' + r.out.split('\n').slice(-2).join(' ') }
  }
  // Traz o que você fez na branch do card desde a última tarefa
  if (await exists(p.path, `refs/heads/${key}`)) {
    const behind = await git(dir, ['rev-list', '--count', `HEAD..${key}`], 8000)
    if (behind.ok && behind.out.trim() !== '0') {
      const dirty = (await git(dir, ['status', '--porcelain'], 8000)).out.trim()
      if (dirty) await commitAll(dir, `${key} (fila): alterações deixadas na cópia`)
      const m = await git(dir, ['merge', '--no-edit', key], 120_000)
      if (!m.ok) {
        await git(dir, ['merge', '--abort'], 10_000)
        return { ok: false, message: `A branch ${key} e a cópia da fila (${qb}) conflitam. Traga a fila para ${key} ou resolva no terminal.` }
      }
    }
  }
  const deps = await linkDependencies(p.path, dir)
  return { ok: true, message: 'Cópia pronta.', warn: deps.warn }
}

/** Guarda tudo que mudou na cópia num commit local (sem push). Devolve se houve commit. */
export async function commitAll(dir: string, message: string): Promise<boolean> {
  const st = await git(dir, ['status', '--porcelain'], 8000)
  if (!st.ok || !st.out.trim()) return false
  await git(dir, ['add', '-A'], 30_000)
  const c = await git(dir, ['commit', '-q', '--no-verify', '-m', message], 30_000)
  return c.ok
}

/** Quantos commits da fila ainda não estão na branch do card */
export async function queueAhead(p: Project, key: string): Promise<number> {
  const qb = queueBranch(key)
  if (!(await exists(p.path, `refs/heads/${qb}`))) return 0
  const ref = (await exists(p.path, `refs/heads/${key}`)) ? key : await baseBranch(p)
  const r = await git(p.path, ['rev-list', '--count', `${ref}..${qb}`], 8000)
  return r.ok ? Number(r.out.trim()) || 0 : 0
}

/** Traz os commits da fila (fila/<card>) para a branch do card */
export async function bringQueueToBranch(p: Project, key: string): Promise<OpResult> {
  const qb = queueBranch(key)
  if (!(await exists(p.path, `refs/heads/${qb}`))) return { ok: false, message: 'A fila ainda não trabalhou nesta demanda.' }
  if (!(await exists(p.path, `refs/heads/${key}`))) {
    const r = await git(p.path, ['branch', key, qb])
    return r.ok ? { ok: true, message: `Branch ${key} criada com o trabalho da fila.` } : { ok: false, message: r.out }
  }
  const ahead = await queueAhead(p, key)
  if (!ahead) return { ok: true, message: `Nada novo: ${key} já tem tudo da fila.` }
  const info = await gitInfo(p)
  if (info?.branch === key) {
    if (info.changed) return { ok: false, message: `Você tem ${info.changed} alteração(ões) sem commit em ${key}. Faça commit ou stash antes de trazer a fila.` }
    const m = await git(p.path, ['merge', '--no-edit', qb], 120_000)
    if (m.ok) return { ok: true, message: `${ahead} commit(s) da fila trazidos para ${key}.` }
    await git(p.path, ['merge', '--abort'], 10_000)
    return { ok: false, message: `Conflito ao trazer a fila para ${key}. Resolva no terminal: git merge ${qb}` }
  }
  // A branch do card não está aberta: só avança se for direto (sem misturar)
  const ff = await git(p.path, ['merge-base', '--is-ancestor', key, qb], 8000)
  if (!ff.ok) return { ok: false, message: `${key} e a fila andaram separadas. Vá para a branch ${key} no card e tente de novo (aí eu faço o merge).` }
  const r = await git(p.path, ['branch', '-f', key, qb])
  return r.ok ? { ok: true, message: `${ahead} commit(s) da fila trazidos para ${key}.` } : { ok: false, message: r.out }
}

/** Apaga a cópia da fila e a branch fila/<card> */
export async function removeWorktree(p: Project, key: string, dir: string): Promise<OpResult> {
  if (existsSync(dir)) {
    const r = await git(p.path, ['worktree', 'remove', '--force', dir], 60_000)
    if (!r.ok) return { ok: false, message: 'Não consegui remover a cópia: ' + r.out.split('\n').slice(-1)[0] }
  }
  await git(p.path, ['worktree', 'prune'], 10_000)
  await git(p.path, ['branch', '-D', queueBranch(key)], 10_000)
  return { ok: true, message: 'Cópia da fila removida.' }
}
