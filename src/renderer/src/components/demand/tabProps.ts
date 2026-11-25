import type { Demand, DemandBusy, GitInfo, OpResult, Project } from '@shared/types'
import type { Tab } from './shared'

/** Estado e ações da janela da demanda que as abas usam */
export interface DemandTabProps {
  d: Demand
  isNew: boolean
  tab: Tab
  setTab: (t: Tab) => void
  /** Salva o que está pendente, roda a ação e mostra o resultado */
  act: (fn: () => Promise<OpResult>) => Promise<void>
  /** Altera a demanda (salva sozinho depois de um instante) */
  change: (patch: Partial<Demand>) => void
  /** Salva agora */
  flush: (next: Demand) => Promise<void>
  projects: Project[]
  setResult: (r: OpResult | null) => void
  working: boolean
  busy: DemandBusy | undefined
  editDesign: boolean
  setEditDesign: (v: boolean) => void
  /** Branch base para criar só local */
  base: string
  setBase: (v: string) => void
  companyRemote: string
  splitRemotes: boolean
  conflicts: string[]
  setConflicts: (v: string[]) => void
  currentBranch: string | null | undefined
  git: GitInfo | null | undefined
  goBranch: (opts: { base?: string; createOnCompany?: boolean }) => Promise<void>
  linkedProjects: Project[]
  /** Mensagem para o Claude */
  msg: string
  setMsg: (v: string) => void
  onGitChanged: () => void
  onOpenTerminal: (d: Demand) => void
  onQueue: (d: Demand) => void
  setLastSent: (v: string) => void
  syncLinked: boolean
  setSyncLinked: (v: boolean) => void
}
