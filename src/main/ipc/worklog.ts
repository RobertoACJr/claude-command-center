import { ipcMain } from 'electron'
import type { OpResult } from '../../shared/types'
import type { DemandManager } from '../demands'
import { jiraTransition, jiraTransitions, jiraWorklog } from '../jira'
import type { WorkLog } from '../worklog'

/** Jornadas (tempo por demanda), relatório da semana e Jira (status, transições, lançar horas) */
export function registerWorklogIpc(d: {
  worklog: WorkLog
  demands: DemandManager
  weeklyText: () => string
  syncJira: (manual?: boolean) => Promise<OpResult>
}): void {
  const { worklog, demands, weeklyText, syncJira } = d
  ipcMain.handle('worklog:state', () => worklog.state())
  ipcMain.handle('worklog:weekly', () => weeklyText())
  ipcMain.handle('jira:sync', () => syncJira(true))
  ipcMain.handle('worklog:start', (_e, demandId: string) => {
    const d = demands.get(String(demandId))
    if (!d) return worklog.state()
    return worklog.start({ demandId: d.id, key: d.key, title: d.jira?.summary || d.title || d.key, projectId: d.projectId })
  })
  ipcMain.handle('worklog:stop', () => worklog.stop())
  ipcMain.handle('worklog:delete', (_e, id: string) => worklog.remove(String(id)))
  ipcMain.handle('worklog:edit', (_e, id: string, start: number, end: number) => worklog.edit(String(id), Number(start), Number(end)))
  ipcMain.handle('worklog:push', async (_e, demandId: string, day: string) => {
    const d = demands.get(String(demandId))
    if (!d) return { ok: false, message: 'Demanda não encontrada.' }
    const list = worklog.pending(d.id, String(day))
    if (!list.length) return { ok: false, message: 'Nada para lançar nesse dia (ou já foi lançado).' }
    const secs = list.reduce((t, s) => t + ((s.end ?? Date.now()) - s.start) / 1000, 0)
    const r = await jiraWorklog(d.key, secs, Math.min(...list.map((s) => s.start)), 'Lançado pelo Hélice')
    if (r.ok) worklog.markLogged(list.map((s) => s.id))
    return r
  })
  ipcMain.handle('jira:transitions', (_e, demandId: string) => {
    const d = demands.get(String(demandId))
    return d ? jiraTransitions(d.key) : { ok: false, message: 'Demanda não encontrada.' }
  })
  ipcMain.handle('jira:transition', async (_e, demandId: string, transitionId: string) => {
    const d = demands.get(String(demandId))
    if (!d) return { ok: false, message: 'Demanda não encontrada.' }
    const r = await jiraTransition(d.key, String(transitionId))
    if (r.ok && r.status) demands.setJiraStatus(d.id, r.status)
    return r
  })
}
