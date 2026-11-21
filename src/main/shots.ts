import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { writeFileAtomic } from './fsutil'
import { join, normalize, relative } from 'path'
import type { OpResult, Project, ShotItem, ShotSet } from '../shared/types'

const MAX_SETS = 200
/** Limite de espaço das capturas: passou, apaga as mais antigas */
export const MAX_BYTES = 500 * 1024 * 1024

/** "GET /health 200" → { method, path, expected }. Sem status = 200; sem método = GET. */
export function parseApiRoute(line: string): { method: string; path: string; expected: number } | null {
  const parts = line.trim().split(/\s+/)
  if (!parts[0]) return null
  let method = 'GET'
  if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/i.test(parts[0])) method = parts.shift()!.toUpperCase()
  const path = parts.shift()
  if (!path) return null
  const expected = parts[0] && /^\d{3}$/.test(parts[0]) ? Number(parts[0]) : 200
  return { method, path: path.startsWith('/') || /^https?:/.test(path) ? path : `/${path}`, expected }
}

export const joinUrl = (base: string, path: string) => (/^https?:/.test(path) ? path : base.replace(/\/+$/, '') + (path.startsWith('/') ? path : `/${path}`))

/** O projeto está respondendo no endereço local? */
export async function isUp(url: string, timeoutMs = 3000): Promise<boolean> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    await fetch(url, { signal: ctrl.signal, redirect: 'manual' })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}

/** Back-end: chama cada rota e compara o status com o esperado */
export async function runApiChecks(baseUrl: string, routes: string[]): Promise<ShotItem[]> {
  const out: ShotItem[] = []
  for (const line of routes) {
    const r = parseApiRoute(line)
    if (!r) continue
    const started = Date.now()
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 15_000)
    try {
      const res = await fetch(joinUrl(baseUrl, r.path), { method: r.method, signal: ctrl.signal, redirect: 'manual' })
      const ok = res.status === r.expected
      let errors: string[] = []
      if (!ok) {
        const body = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200)
        errors = [`esperava ${r.expected}, veio ${res.status}${body ? `: ${body}` : ''}`]
      }
      out.push({ route: `${r.method} ${r.path}`, width: 0, errors, status: res.status, expected: r.expected, ms: Date.now() - started, ok })
    } catch (e) {
      const err = e as Error
      out.push({
        route: `${r.method} ${r.path}`,
        width: 0,
        errors: [err.name === 'AbortError' ? 'não respondeu em 15s' : `falhou: ${err.message}`],
        status: null,
        expected: r.expected,
        ms: Date.now() - started,
        ok: false
      })
    } finally {
      clearTimeout(t)
    }
  }
  return out
}

/** Captura de uma tela: PNG + erros do navegador. Implementada com o Electron (janela invisível). */
export type Capturer = (url: string, width: number) => Promise<{ png: Buffer | null; errors: string[] }>

/**
 * Prints das telas (front-end) e checagem da API (back-end), guardados por projeto/demanda.
 * Ficam em shots/ na pasta de dados do app (as 200 capturas mais recentes).
 */
export class ShotManager {
  private dir: string
  private file: string
  private sets: ShotSet[] = []

  constructor(
    base: string,
    private capture: Capturer,
    private onNew: (s: ShotSet) => void,
    /** Gera a miniatura JPEG (Electron); sem ela, a lista usa o PNG */
    private thumb?: (png: Buffer) => Buffer | null,
    private maxBytes = MAX_BYTES
  ) {
    this.dir = join(base, 'shots')
    this.file = join(this.dir, 'shots.json')
    mkdirSync(this.dir, { recursive: true })
    try {
      if (existsSync(this.file)) this.sets = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch {
      this.sets = []
    }
  }

  list(scope: { projectId?: string; demandId?: string }): ShotSet[] {
    return this.sets.filter((s) => (!scope.demandId || s.demandId === scope.demandId) && (!scope.projectId || s.projectId === scope.projectId))
  }

  get(id: string): ShotSet | undefined {
    return this.sets.find((s) => s.id === id)
  }

  private persist(): void {
    const old = this.sets.splice(0, Math.max(0, this.sets.length - MAX_SETS))
    // Limite por espaço: tira as mais antigas até caber (fica pelo menos a mais nova)
    let total = this.sets.reduce((n, s) => n + (s.bytes ?? 0), 0)
    while (total > this.maxBytes && this.sets.length > 1) {
      const s = this.sets.shift()!
      total -= s.bytes ?? 0
      old.push(s)
    }
    for (const s of old) rmSync(join(this.dir, s.id), { recursive: true, force: true })
    writeFileAtomic(this.file, JSON.stringify(this.sets))
  }

  delete(id: string): void {
    this.sets = this.sets.filter((s) => s.id !== id)
    rmSync(join(this.dir, id), { recursive: true, force: true })
    this.persist()
  }

  /** Imagem como data URL (só das pastas do app: prints e imagens coladas nas demandas) */
  image(file: string): string | null {
    const full = normalize(file)
    const roots = [this.dir, join(this.dir, '..', 'demand-images')]
    if (!roots.some((r) => !relative(r, full).startsWith('..'))) return null
    const ext = full.split('.').pop()?.toLowerCase()
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/png'
    try {
      return `data:${mime};base64,` + readFileSync(full).toString('base64')
    } catch {
      return null
    }
  }

  /** Projeto pede prints (front), checagem da API (back) ou os dois (fullstack) */
  static wants(p: Project): { telas: boolean; api: boolean } {
    const has = !!p.localUrl && p.routes.length > 0
    return { telas: has && (p.kind === 'front' || p.kind === 'fullstack'), api: has && (p.kind === 'back' || p.kind === 'fullstack') }
  }

  async take(p: Project, opts: { demandId?: string; taskId?: string; label: string }): Promise<OpResult & { sets?: ShotSet[] }> {
    const w = ShotManager.wants(p)
    if (!w.telas && !w.api) {
      return { ok: false, message: 'Defina no projeto o tipo (front/back), o endereço local e as rotas para checar.' }
    }
    const base: Omit<ShotSet, 'id' | 'kind' | 'items'> = { at: Date.now(), label: opts.label, projectId: p.id, demandId: opts.demandId, taskId: opts.taskId }
    const up = await isUp(p.localUrl)
    const sets: ShotSet[] = []
    if (w.telas) {
      const set: ShotSet = { ...base, id: randomUUID(), kind: 'telas', items: [] }
      if (!up) set.error = `O projeto não está respondendo em ${p.localUrl}. Rode o projeto e tente de novo.`
      else {
        mkdirSync(join(this.dir, set.id), { recursive: true })
        const widths = p.mobileShots ? [1280, 390] : [1280]
        let n = 0
        for (const route of p.routes) {
          for (const width of widths) {
            try {
              const r = await this.capture(joinUrl(p.localUrl, route), width)
              let file: string | undefined
              let thumb: string | undefined
              if (r.png) {
                const k = n++
                file = join(this.dir, set.id, `${k}.png`)
                writeFileSync(file, r.png)
                set.bytes = (set.bytes ?? 0) + r.png.length
                const t = this.thumb?.(r.png)
                if (t) {
                  thumb = join(this.dir, set.id, `${k}.thumb.jpg`)
                  writeFileSync(thumb, t)
                  set.bytes += t.length
                }
              }
              set.items.push({ route, width, file, thumb, errors: r.errors, ok: r.errors.length === 0 && !!r.png })
            } catch (e) {
              set.items.push({ route, width, errors: [`não consegui abrir: ${(e as Error).message}`], ok: false })
            }
          }
        }
      }
      sets.push(set)
    }
    if (w.api) {
      const set: ShotSet = { ...base, id: randomUUID(), kind: 'api', items: [] }
      if (!up) set.error = `A API não está respondendo em ${p.localUrl}.`
      else set.items = await runApiChecks(p.localUrl, p.routes)
      sets.push(set)
    }
    this.sets.push(...sets)
    this.persist()
    for (const s of sets) this.onNew(s)
    const problems = sets.reduce((n, s) => n + (s.error ? 1 : s.items.filter((i) => !i.ok).length), 0)
    const what = sets.map((s) => (s.kind === 'telas' ? `${s.items.length} print(s)` : `${s.items.length} rota(s)`)).join(' e ')
    return {
      ok: !sets.some((s) => s.error),
      message: sets.find((s) => s.error)?.error ?? (problems ? `${what}: ${problems} com problema.` : `${what}: tudo certo.`),
      sets
    }
  }
}

/** Resumo curto de um conjunto (fila, Telegram) */
export function shotSummary(s: ShotSet): string {
  if (s.error) return `⚠ ${s.kind === 'telas' ? 'prints' : 'API'}: ${s.error}`
  const bad = s.items.filter((i) => !i.ok)
  if (!bad.length) return s.kind === 'telas' ? `📸 ${s.items.length} tela(s) sem erros` : `✔ API: ${s.items.length} rota(s) ok`
  const first = bad
    .slice(0, 3)
    .map((i) => `${i.route}${i.width && i.width < 800 ? ' (celular)' : ''}: ${i.errors[0] ?? 'sem imagem'}`)
    .join('; ')
  return `${s.kind === 'telas' ? '⚠ erros no navegador' : '✖ API'}: ${first}${bad.length > 3 ? '…' : ''}`
}
