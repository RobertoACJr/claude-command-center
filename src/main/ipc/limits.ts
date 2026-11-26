import { ipcMain } from 'electron'
import type { DemandPlan, OpResult, Project } from '../../shared/types'
import { aiAccounts, projectAccounts } from '../accounts'
import type { DemandManager } from '../demands'
import type { LimitsTracker } from '../limits'
import type { PlanRunner } from '../plan'
import { disableStatusline, enableStatusline, statuslineInstalled } from '../statusline'

/** Limites do Claude, contas conectadas, linha de status e plano por fases das demandas */
export function registerLimitsIpc(d: {
  limits: LimitsTracker
  plans: PlanRunner
  demands: DemandManager
  projects: () => Project[]
}): void {
  const { limits, plans, demands } = d
  ipcMain.handle('limits:state', () => limits.state())
  ipcMain.handle('accounts:list', () => aiAccounts())
  ipcMain.handle('accounts:project', (_e, id: string) => {
    const p = d.projects().find((x) => x.id === id)
    return p?.path ? projectAccounts(p) : null
  })
  ipcMain.handle('statusline:set', (_e, on: boolean): OpResult => {
    // A interface grava ai.statusLine depois que der certo (e o app passa a ler o arquivo)
    return on ? enableStatusline() : disableStatusline()
  })
  ipcMain.handle('statusline:installed', () => statuslineInstalled())
  ipcMain.handle('plan:generate', (_e, id: string) => demands.planPhases(String(id)))
  ipcMain.handle('plan:edit', (_e, id: string, plan: DemandPlan | null) => plans.edit(String(id), plan))
  ipcMain.handle('plan:start', (_e, id: string) => plans.start(String(id)))
  ipcMain.handle('plan:pause', (_e, id: string) => plans.pause(String(id)))
  ipcMain.handle('plan:release', (_e, id: string) => plans.release(String(id)))
  ipcMain.handle('plan:preview', (_e, id: string) => plans.preview(String(id)))
}
