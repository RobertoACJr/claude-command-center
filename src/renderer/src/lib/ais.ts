import { useSyncExternalStore } from 'react'
import type { AiId } from '@shared/types'

/**
 * Quais IAs estão ligadas neste PC (Configurações → IAs). O App atualiza a cada mudança de config
 * e os seletores (console, scripts, demandas, revisão, Vigia) leem daqui, sem passar props por tudo.
 */
let current: Record<AiId, boolean> = { claude: true, gemini: true, codex: true }
const listeners = new Set<() => void>()

export function setEnabledAis(next: Record<AiId, boolean> | undefined): void {
  if (!next) return
  if (next.claude === current.claude && next.gemini === current.gemini && next.codex === current.codex) return
  current = { ...next }
  for (const l of listeners) l()
}

export function useAis(): Record<AiId, boolean> {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => current
  )
}

/** Lista só as opções ligadas, mas mantém a que já está escolhida (para não sumir de uma demanda antiga) */
export function onlyEnabled<T extends string>(options: readonly T[], ais: Record<AiId, boolean>, keep?: T): T[] {
  return options.filter((o) => o === keep || !(o in ais) || ais[o as AiId])
}
