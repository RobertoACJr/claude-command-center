import { ipcMain } from 'electron'
import { mkdirSync } from 'fs'
import { homedir } from 'os'
import type { AppConfig, DemandPlan, OpResult } from '../../shared/types'
import { accountEnv, accountOf, allAccounts, projectAccounts } from '../accounts'
import { openSystemTerminal } from '../systerm'
import type { DemandManager } from '../demands'
import type { LimitsTracker } from '../limits'
import type { PlanRunner } from '../plan'
import { disableStatusline, enableStatusline, statuslineInstalled } from '../statusline'

/** Limites do Claude, contas conectadas, linha de status e plano por fases das demandas */
export function registerLimitsIpc(d: {
  limits: LimitsTracker
  plans: PlanRunner
  demands: DemandManager
  config: () => AppConfig
}): void {
  const { limits, plans, demands } = d
  ipcMain.handle('limits:state', () => limits.state())
  ipcMain.handle('accounts:list', () => allAccounts(d.config()))
  ipcMain.handle('accounts:project', (_e, id: string) => {
    const cfg = d.config()
    const p = cfg.projects.find((x) => x.id === id)
    return p?.path ? projectAccounts(p, accountOf(cfg, p.id)) : null
  })
  // Login numa conta: abre o terminal com a pasta de login dela (o Claude pede o /login na primeira vez)
  ipcMain.handle('accounts:login', (_e, accountId: string, tool: 'claude' | 'codex'): OpResult => {
    const acc = d.config().accounts.find((a) => a.id === accountId) ?? null
    const env = accountEnv(acc)
    if (tool === 'claude' && !env.CLAUDE_CONFIG_DIR) return { ok: false, message: 'Essa conta usa a pasta padrão do Claude; faça login normalmente.' }
    if (tool === 'codex' && !env.CODEX_HOME) return { ok: false, message: 'Essa conta usa a pasta padrão do Codex.' }
    for (const dir of Object.values(env)) mkdirSync(dir, { recursive: true })
    return openSystemTerminal(homedir(), tool === 'codex' ? 'codex' : 'claude', undefined, env)
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
