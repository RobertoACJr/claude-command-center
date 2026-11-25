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

// ---------------------------------------------------------------- remotos (empresa e fork)

const SAFE_REMOTE = /^[\w.-]+$/

/**
 * Remotos do projeto, pelas variáveis:
 * - remoto_empresa: o repositório oficial (código de produção, onde nasce a branch do card e para onde vai o PR)
 * - remoto_fork: o seu fork, onde você faz push (padrão: origin; a antiga variável `remote` também vale)
 * Sem remoto_empresa, os dois são o mesmo (fluxo de um remoto só).
 */
export interface Remotes {
  company: string
  fork: string
  /** Empresa e fork são remotos diferentes */
  split: boolean
}

export function remotesOf(p: Project): Remotes {
  const v = (k: string) => {
    const x = p.vars.find((y) => y.key === k)?.value.trim()
    return x && SAFE_REMOTE.test(x) ? x : ''
  }
  const fork = v('remoto_fork') || v('remote') || 'origin'
  const company = v('remoto_empresa') || fork
  return { company, fork, split: company !== fork }
}

/** "dono/repo" de uma URL do GitHub (https ou ssh); null se não for GitHub */
export function githubRepoOf(url: string): string | null {
  const m = url.trim().match(/github\.com[:/]+([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i)
  return m ? `${m[1]}/${m[2]}` : null
}

export async function remoteUrl(p: Project, remote: string): Promise<string | null> {
  const r = await git(p.path, ['remote', 'get-url', remote], 4000)
  return r.ok ? r.out.split('\n')[0].trim() : null
}

/** Busca a branch no remoto; true se ela existe lá (e fica em <remoto>/<branch>) */
export async function fetchRemoteBranch(p: Project, remote: string, branch: string): Promise<boolean> {
  if (!SAFE_BRANCH.test(branch) || !SAFE_REMOTE.test(remote)) return false
  const f = await git(p.path, ['fetch', remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`], 120_000)
  return f.ok
}

async function hasRef(p: Project, ref: string): Promise<boolean> {
  return (await git(p.path, ['rev-parse', '--verify', '--quiet', ref], 4000)).ok
}

/** Branch principal: variável branch_principal do projeto, senão a padrão do remoto da empresa, senão main/master */
export async function baseBranch(p: Project): Promise<string> {
  const v = p.vars.find((x) => x.key === 'branch_principal')?.value.trim()
  if (v && SAFE_BRANCH.test(v)) return v
  const { company } = remotesOf(p)
  const head = await git(p.path, ['symbolic-ref', '--short', `refs/remotes/${company}/HEAD`], 4000)
  if (head.ok && head.out.startsWith(company + '/')) return head.out.slice(company.length + 1).split('\n')[0]
  for (const b of ['master', 'main']) {
    if ((await git(p.path, ['rev-parse', '--verify', '--quiet', `refs/heads/${b}`], 4000)).ok) return b
  }
  return 'master'
}

/**
 * Atualiza a branch atual do projeto com o remoto da empresa, por merge (sem push):
 * - 'branch': com a branch de mesmo nome lá (ex.: empresa/MAS-123)
 * - 'main': com a principal (ex.: empresa/master)
 * Precisa da árvore limpa. Em conflito, deixa o merge aberto e lista os arquivos.
 */
export async function syncWithRemote(p: Project, target: 'branch' | 'main'): Promise<OpResult & { skipped?: boolean }> {
  const info = await gitInfo(p)
  if (!info) return { ok: false, message: 'não é um repositório git.' }
  if (!info.branch) return { ok: false, message: 'não está em nenhuma branch (HEAD solto).' }
  if (info.conflicts) return { ok: false, message: 'já tem um merge com conflito em andamento.' }
  if (info.changed) return { ok: false, message: `tem ${info.changed} arquivo(s) sem commit; faça commit ou stash antes.` }
  const { company } = remotesOf(p)
  const name = target === 'branch' ? info.branch : info.base
  if (!(await fetchRemoteBranch(p, company, name))) {
    return { ok: true, skipped: true, message: `${name} não existe em ${company}: ficou como estava.` }
  }
  const ref = `${company}/${name}`
  const behind = await git(p.path, ['rev-list', '--count', `HEAD..${ref}`], 8000)
  const n = behind.ok ? Number(behind.out.trim()) : NaN
  if (n === 0) return { ok: true, message: `${info.branch} já estava em dia com ${ref}.` }
  const m = await git(p.path, ['merge', '--no-edit', ref], 120_000)
  if (m.ok) return { ok: true, message: `${info.branch} atualizada com ${ref} (${Number.isNaN(n) ? '?' : n} commit(s)). Ainda sem push.` }
  const files = await git(p.path, ['diff', '--name-only', '--diff-filter=U'])
  const list = files.ok ? files.out.split('\n').filter(Boolean) : []
  if (list.length) return { ok: false, message: `conflito ao trazer ${ref}: ${list.slice(0, 5).join(', ')}${list.length > 5 ? '…' : ''}. Resolva no editor.` }
  return { ok: false, message: `o merge com ${ref} falhou: ${m.out.split('\n').slice(-2).join(' ')}` }
}

/** Projetos ligados a este, nos dois sentidos (front liga o back; a demanda do back também leva o front) */
export function linkedProjectsOf(p: Project, all: Project[]): Project[] {
  const ids = new Set(p.linkedProjectIds ?? [])
  for (const o of all) if (o.id !== p.id && (o.linkedProjectIds ?? []).includes(p.id)) ids.add(o.id)
  ids.delete(p.id)
  return all.filter((o) => ids.has(o.id))
}

export type DemandBranchResult = OpResult & {
  /** A branch do card não existe no remoto da empresa: pergunte se pode criar lá */
  needsCompanyBranch?: boolean
  /** Nada foi feito (projeto ligado sem a branch) */
  skipped?: boolean
}

/**
 * Leva o projeto para a branch do card, no fluxo empresa + fork:
 * 1. já existe local: só troca para ela;
 * 2. existe no remoto da empresa: `git checkout -b KEY empresa/KEY`;
 * 3. não existe lá: com `createOnCompany`, cria no remoto da empresa a partir da principal
 *    (o mesmo que criar pelo site) e faz o passo 2; com `base`, cria só local; senão pergunta.
 * `onlyExisting`: para projetos ligados, nunca cria nada, só troca se a branch já existir.
 */
export async function goToDemandBranch(
  p: Project,
  key: string,
  opts: { base?: string; createOnCompany?: boolean; onlyExisting?: boolean } = {}
): Promise<DemandBranchResult> {
  if (!SAFE_BRANCH.test(key)) return { ok: false, message: 'O número do card não serve como nome de branch.' }
  const base = opts.base?.trim() ?? ''
  if (base && !SAFE_BRANCH.test(base)) return { ok: false, message: 'Nome da branch base inválido.' }
  const refused = (out: string) =>
    /would be overwritten|local changes/i.test(out)
      ? 'Há alterações sem commit que seriam perdidas: faça commit ou stash antes de trocar de branch.'
      : 'O git recusou: ' + out.split('\n').slice(-2).join(' ')

  if (await hasRef(p, `refs/heads/${key}`)) {
    const r = await git(p.path, ['checkout', key])
    return r.ok ? { ok: true, message: `Branch ${key} já existia: agora você está nela.` } : { ok: false, message: refused(r.out) }
  }

  const { company, split } = remotesOf(p)
  const checkoutFromCompany = async (how: string): Promise<DemandBranchResult> => {
    const r = await git(p.path, ['checkout', '-b', key, `${company}/${key}`])
    return r.ok ? { ok: true, message: `Branch ${key} criada a partir de ${company}/${key}${how}.` } : { ok: false, message: refused(r.out) }
  }
  if (await fetchRemoteBranch(p, company, key)) return checkoutFromCompany('')

  if (opts.onlyExisting) return { ok: true, skipped: true, message: `${key} não existe aqui nem em ${company}: ficou como estava.` }

  if (split && opts.createOnCompany) {
    const main = await baseBranch(p)
    if (!(await fetchRemoteBranch(p, company, main))) return { ok: false, message: `Não consegui buscar ${company}/${main}. Confira o remoto "${company}" (git remote -v).` }
    const push = await git(p.path, ['push', company, `refs/remotes/${company}/${main}:refs/heads/${key}`], 120_000)
    if (!push.ok) return { ok: false, message: `Não consegui criar ${key} no ${company}: ${push.out.split('\n').slice(-2).join(' ')}` }
    if (!(await fetchRemoteBranch(p, company, key))) return { ok: false, message: `Criei ${key} no ${company}, mas não consegui buscá-la de volta.` }
    return checkoutFromCompany(` (criada agora no ${company} a partir da ${main})`)
  }

  if (split && !base) {
    return {
      ok: false,
      needsCompanyBranch: true,
      message: `A branch ${key} ainda não existe no remoto da empresa (${company}).`
    }
  }

  const r = await git(p.path, ['checkout', '-b', key, ...(base ? [base] : [])])
  return r.ok
    ? { ok: true, message: `Branch ${key} criada${base ? ` a partir de ${base}` : ''} (só local).` }
    : { ok: false, message: refused(r.out) }
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
 * Atualiza a branch atual com o remoto da empresa: no fluxo com fork, primeiro o que entrou em
 * empresa/<branch da demanda> (ex.: PR aceito), depois a principal (empresa/master). Merge, sem push.
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
  const { company, split } = remotesOf(p)
  const refs: string[] = []
  if (split && (await fetchRemoteBranch(p, company, expectBranch))) refs.push(`${company}/${expectBranch}`)
  if (await fetchRemoteBranch(p, company, base)) refs.push(`${company}/${base}`)
  else if (await hasRef(p, `refs/heads/${base}`)) refs.push(base)
  else return { ok: false, message: `Não achei a ${base} (nem em ${company}, nem local).` }

  const brought: string[] = []
  let m: { ok: boolean; out: string } = { ok: true, out: '' }
  for (const ref of refs) {
    const behind = await git(p.path, ['rev-list', '--count', `HEAD..${ref}`], 8000)
    const n = behind.ok ? Number(behind.out.trim()) : NaN
    if (n === 0) continue
    m = await git(p.path, ['merge', '--no-edit', ref], 120_000)
    if (!m.ok) break
    brought.push(`${ref} (${Number.isNaN(n) ? '?' : n} commit(s))`)
  }
  if (m.ok) {
    if (!brought.length) return { ok: true, message: `Já estava em dia com a ${refs.join(' e a ')}.` }
    return { ok: true, message: `Atualizada com ${brought.join(' e ')}. Ainda sem push.` }
  }
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
      const { company } = remotesOf(p)
      const start = (await exists(p.path, `refs/heads/${key}`))
        ? key
        : (await exists(p.path, `refs/remotes/${company}/${key}`))
          ? `${company}/${key}`
          : (await exists(p.path, `refs/remotes/${company}/${base}`))
            ? `${company}/${base}`
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
