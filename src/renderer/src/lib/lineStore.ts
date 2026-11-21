import { useSyncExternalStore } from 'react'
import type { ConsoleLine, LineKind } from '../components/TerminalsPanel'

/**
 * Saída dos terminais fora do estado do App: cada lote de linhas só redesenha o terminal que está olhando
 * aquela aba (antes, o app inteiro redesenhava a cada 40ms com um servidor de dev falante).
 * Avisos são agrupados (no máximo ~16 por segundo por aba).
 */
const MAX_LINES = 4000
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
    const next = cur.length + add.length > MAX_LINES ? [...cur, ...add].slice(-MAX_LINES) : cur.concat(add)
    data.set(key, next)
    notify(key)
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
