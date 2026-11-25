import { useSyncExternalStore } from 'react'
import type { ConsoleLine, LineKind } from '../components/TerminalsPanel'

/**
 * Saída dos terminais fora do estado do App: cada lote de linhas só redesenha o terminal que está olhando
 * aquela aba (antes, o app inteiro redesenhava a cada 40ms com um servidor de dev falante).
 * Avisos são agrupados (no máximo ~16 por segundo por aba).
 */
const MAX_LINES = 4000
/** Histórico curto: cada aba guarda só as últimas linhas (menos memória com servidores de dev falantes) */
export const SHORT_LINES = 80
let maxLines = MAX_LINES
/** Log da aplicação (janela Log) tem o próprio filtro e guarda sempre o histórico todo */
const maxFor = (key: string) => (key.startsWith('applog:') ? MAX_LINES : maxLines)
const EMPTY: ConsoleLine[] = []
const data = new Map<string, ConsoleLine[]>()
const subs = new Map<string, Set<() => void>>()
const pending = new Set<string>()
let timer: ReturnType<typeof setTimeout> | null = null
let nextId = 0

function flush(): void {
  timer = null
  const keys = [...pending]
  pending.clear()
  for (const k of keys) subs.get(k)?.forEach((cb) => cb())
}

function notify(key: string): void {
  pending.add(key)
  if (!timer) timer = setTimeout(flush, 60)
}

export const lineStore = {
  append(key: string, items: Array<{ kind: LineKind; text: string }>): void {
    if (!items.length) return
    const cur = data.get(key) ?? EMPTY
    const add = items.map((i) => ({ id: ++nextId, kind: i.kind, text: i.text }))
    const max = maxFor(key)
    const next = cur.length + add.length > max ? [...cur, ...add].slice(-max) : cur.concat(add)
    data.set(key, next)
    notify(key)
  },
  /** Liga/desliga o histórico curto; ao ligar, corta o que já passou do limite */
  setShort(short: boolean): void {
    const next = short ? SHORT_LINES : MAX_LINES
    if (next === maxLines) return
    maxLines = next
    if (!short) return
    for (const [k, v] of data) {
      if (v.length > maxFor(k)) {
        data.set(k, v.slice(-maxFor(k)))
        notify(k)
      }
    }
  },
  clear(key: string): void {
    data.set(key, EMPTY)
    notify(key)
  },
  remove(key: string): void {
    data.delete(key)
    notify(key)
  },
  get(key: string): ConsoleLine[] {
    return data.get(key) ?? EMPTY
  },
  subscribe(key: string, cb: () => void): () => void {
    let set = subs.get(key)
    if (!set) subs.set(key, (set = new Set()))
    set.add(cb)
    return () => set!.delete(cb)
  }
}

/** Linhas de uma aba; o componente redesenha só quando ela muda */
export function useLines(key: string): ConsoleLine[] {
  return useSyncExternalStore(
    (cb) => lineStore.subscribe(key, cb),
    () => lineStore.get(key)
  )
}
