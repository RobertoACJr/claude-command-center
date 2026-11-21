import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { writeFileAtomic } from './fsutil'
import { hostname } from 'os'
import { join } from 'path'
import type { AppConfig, Demand, OpResult, SyncStatus } from '../shared/types'
import { git } from './git'

/**
 * Sincronizar entre PCs (ex: Ubuntu e Windows) por um repositório git privado seu.
 * Vai: projetos (sem a pasta), scripts, regras, respostas, integrações (sem segredos), preferências e demandas.
 * Não vai: tokens e senhas (cada PC tem os seus), histórico, gastos, fila e pedidos.
 * A pasta de cada projeto fica por PC (paths/<nome-do-pc>.json).
 * Mescla de três vias: o que mudou só de um lado ganha; mudou dos dois lados, ganha este PC (configuração)
 * ou a versão mais nova (demandas).
 */

/** Partes da configuração que viajam */
const LISTS = ['projects', 'scripts', 'replies', 'rules'] as const
const SECTIONS = ['general', 'integrations', 'telegram', 'watcher', 'ai', 'claudeGlobal', 'queue', 'costs'] as const

type Shared = Record<string, unknown>
type WithId = { id: string }

const machine = () => hostname().replace(/[^\w.-]+/g, '_') || 'pc'
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** O que sai deste PC: sem pastas, segredos ou estado local */
export function sharedConfig(c: AppConfig): Shared {
  return {
    projects: c.projects.map((p) => ({ ...p, path: '' })),
    scripts: c.scripts,
    replies: c.replies,
    rules: c.rules,
    general: { ...c.general, trayHintShown: false, openAtLogin: false },
    integrations: { ...c.integrations, lastApplied: {} },
    telegram: c.telegram,
    watcher: { ...c.watcher, seen: [], lastCheckAt: null },
    ai: c.ai,
    claudeGlobal: c.claudeGlobal,
    queue: c.queue,
    costs: c.costs
  }
}

/** Mescla de três vias de uma lista com id */
export function merge3List<T extends WithId>(base: T[] | undefined, local: T[], remote: T[] | undefined): T[] {
  // Primeira sincronização deste PC (sem base): o que já está no repositório ganha nos conflitos
  const first = base === undefined
  if (!remote) return local
  const b = new Map((base ?? []).map((x) => [x.id, x]))
  const l = new Map(local.map((x) => [x.id, x]))
  const r = new Map(remote.map((x) => [x.id, x]))
  const out: T[] = []
  const ids = [...new Set([...local.map((x) => x.id), ...remote.map((x) => x.id)])]
  for (const id of ids) {
    const bi = b.get(id)
    const li = l.get(id)
    const ri = r.get(id)
    if (li && ri) out.push(first ? ri : !bi || !same(li, bi) ? li : ri)
    else if (li && !ri) {
      // Apagado no outro PC (e não mudou aqui) → apaga; novo aqui → fica
      if (bi && same(li, bi)) continue
      out.push(li)
    } else if (!li && ri) {
      // Apagado aqui (e não mudou lá) → continua apagado; novo lá → vem
      if (bi && same(ri, bi)) continue
      out.push(ri)
    }
  }
  return out
}

export function merge3Config(base: Shared | null, local: Shared, remote: Shared | null): Shared {
  if (!remote) return local
  const out: Shared = {}
  for (const k of LISTS) out[k] = merge3List((base?.[k] as WithId[]) ?? undefined, (local[k] as WithId[]) ?? [], (remote[k] as WithId[]) ?? undefined)
  for (const k of SECTIONS) {
    if (remote[k] === undefined) out[k] = local[k]
    else if (!base) out[k] = remote[k]
    else out[k] = same(local[k], base[k]) ? remote[k] : local[k]
  }
  return out
}

/** Demandas: mais nova ganha; apagar de um lado apaga se o outro não mexeu desde a última sincronização */
export function mergeDemands(base: Record<string, number> | null, local: Demand[], remote: Demand[] | null): Demand[] {
  if (!remote) return local
  const r = new Map(remote.map((d) => [d.id, d]))
  const l = new Map(local.map((d) => [d.id, d]))
  const out: Demand[] = []
  for (const id of new Set([...l.keys(), ...r.keys()])) {
    const li = l.get(id)
    const ri = r.get(id)
    const seen = base?.[id]
    if (li && ri) out.push(li.updatedAt >= ri.updatedAt ? li : ri)
    else if (li) {
      if (seen !== undefined && li.updatedAt <= seen) continue
      out.push(li)
    } else if (ri) {
      if (seen !== undefined && ri.updatedAt <= seen) continue
      out.push(ri)
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt)
}

interface SyncState {
  repoUrl: string
  base: Shared | null
  demands: Record<string, number> | null
  lastAt: number | null
  lastResult: string
  ok: boolean
}

export class SyncManager {
  private dir: string
  private stateFile: string
  private running = false
  private state: SyncState

  constructor(
    userData: string,
    private d: {
      config: () => AppConfig
      /** Aplica a configuração mesclada (mantém pastas locais e segredos) */
      applyConfig: (merged: Shared, paths: Record<string, string>) => void
      demands: () => Demand[]
      applyDemands: (list: Demand[]) => void
      onChange: (s: SyncStatus) => void
      /** Nome deste PC no repositório (padrão: o nome do computador) */
      machine?: string
    }
  ) {
    this.dir = join(userData, 'sync')
    this.stateFile = join(userData, 'sync-state.json')
    this.state = { repoUrl: '', base: null, demands: null, lastAt: null, lastResult: '', ok: true }
    try {
      if (existsSync(this.stateFile)) this.state = { ...this.state, ...JSON.parse(readFileSync(this.stateFile, 'utf8')) }
    } catch {
      /* começa do zero */
    }
  }

  private machine(): string {
    return this.d.machine ?? machine()
  }

  status(): SyncStatus {
    const c = this.d.config().sync
    return { ...c, running: this.running, lastAt: this.state.lastAt, lastResult: this.state.lastResult, ok: this.state.ok, machine: this.machine() }
  }

  private save(): void {
    try {
      writeFileAtomic(this.stateFile, JSON.stringify(this.state))
    } catch {
      /* ignora */
    }
    this.d.onChange(this.status())
  }

  private finish(ok: boolean, msg: string): OpResult {
    this.running = false
    this.state.ok = ok
    this.state.lastResult = msg
    this.state.lastAt = Date.now()
    this.save()
    return { ok, message: msg }
  }

  async sync(): Promise<OpResult> {
    const cfg = this.d.config()
    const url = cfg.sync.repoUrl.trim()
    if (!url) return { ok: false, message: 'Informe o endereço do repositório de sincronização.' }
    if (this.running) return { ok: false, message: 'Já está sincronizando.' }
    this.running = true
    this.d.onChange(this.status())
    try {
      // Repositório trocou: recomeça a cópia local e a base
      if (this.state.repoUrl !== url) {
        rmSync(this.dir, { recursive: true, force: true })
        this.state = { ...this.state, repoUrl: url, base: null, demands: null }
      }
      if (!existsSync(join(this.dir, '.git'))) {
        mkdirSync(this.dir, { recursive: true })
        const c = await git(this.dir, ['clone', '-q', url, '.'], 120_000)
        if (!c.ok) return this.finish(false, 'Não consegui clonar o repositório: ' + c.out.split('\n').slice(-1)[0])
      }
      for (let attempt = 0; attempt < 2; attempt++) {
        const r = await this.round(attempt)
        if (r !== 'retry') return r
      }
      return this.finish(false, 'Outro PC sincronizou ao mesmo tempo: tente de novo.')
    } catch (e) {
      return this.finish(false, 'Falha ao sincronizar: ' + (e as Error).message)
    }
  }

  private async round(attempt: number): Promise<OpResult | 'retry'> {
    const hasRemote = (await git(this.dir, ['ls-remote', '--heads', 'origin'], 60_000)).out.trim().length > 0
    if (hasRemote) {
      const branch = (await git(this.dir, ['ls-remote', '--symref', 'origin', 'HEAD'], 30_000)).out.match(/refs\/heads\/(\S+)\s+HEAD/)?.[1] ?? 'main'
      const f = await git(this.dir, ['fetch', '-q', 'origin', branch], 120_000)
      if (!f.ok) return this.finish(false, 'Não consegui buscar do repositório: ' + f.out.split('\n').slice(-1)[0])
      await git(this.dir, ['checkout', '-q', '-B', branch, `origin/${branch}`], 30_000)
    }
    const read = <T>(f: string): T | null => {
      try {
        return JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as T
      } catch {
        return null
      }
    }
    const remoteCfg = read<Shared>('config.json')
    const remoteDemands = read<Demand[]>('demands.json')
    const paths = read<Record<string, string>>(join('paths', `${this.machine()}.json`)) ?? {}

    const local = sharedConfig(this.d.config())
    const merged = merge3Config(this.state.base, local, remoteCfg)
    const demands = mergeDemands(this.state.demands, this.d.demands(), remoteDemands)

    // Aplica aqui o que veio do outro PC
    if (!same(merged, local)) this.d.applyConfig(merged, paths)
    if (!same(demands, this.d.demands())) this.d.applyDemands(demands)

    // Grava a versão mesclada + as pastas deste PC
    const myPaths: Record<string, string> = {}
    for (const p of this.d.config().projects) if (p.path) myPaths[p.id] = p.path
    mkdirSync(join(this.dir, 'paths'), { recursive: true })
    writeFileSync(join(this.dir, 'config.json'), JSON.stringify(merged, null, 1))
    writeFileSync(join(this.dir, 'demands.json'), JSON.stringify(demands, null, 1))
    writeFileSync(join(this.dir, 'paths', `${this.machine()}.json`), JSON.stringify(myPaths, null, 1))
    writeFileSync(
      join(this.dir, 'README.md'),
      '# Sincronização da Hélice\n\nGerado pelo app. Não guarde segredos aqui: tokens e senhas ficam em cada PC.\nUse um repositório **privado**.\n'
    )
    await git(this.dir, ['add', '-A'], 30_000)
    const changed = (await git(this.dir, ['status', '--porcelain'], 10_000)).out.trim().length > 0
    if (changed) {
      const c = await git(
        this.dir,
        ['-c', 'user.name=Hélice', '-c', `user.email=helice@${this.machine()}`, 'commit', '-q', '-m', `sincronização de ${this.machine()}`],
        30_000
      )
      if (!c.ok) return this.finish(false, 'Não consegui gravar: ' + c.out.split('\n').slice(-1)[0])
      const push = await git(this.dir, ['push', '-q', '-u', 'origin', 'HEAD'], 120_000)
      if (!push.ok) {
        if (attempt === 0 && /rejected|non-fast-forward|fetch first/i.test(push.out)) return 'retry'
        return this.finish(false, 'Não consegui enviar: ' + push.out.split('\n').slice(-1)[0])
      }
    }
    this.state.base = merged
    this.state.demands = Object.fromEntries(demands.map((x) => [x.id, x.updatedAt]))
    const missing = this.d.config().projects.filter((p) => !p.path).map((p) => p.name)
    return this.finish(
      true,
      (changed ? 'Sincronizado.' : 'Já estava em dia.') +
        (missing.length ? ` Defina neste PC a pasta de: ${missing.join(', ')}.` : '')
    )
  }
}
