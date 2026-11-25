import { ipcMain } from 'electron'
import type { Demand, PrComment } from '../../shared/types'
import type { CostLedger } from '../costs'
import type { DemandManager } from '../demands'
import { gitInfo } from '../git'
import type { History } from '../history'
import type { QueueManager } from '../queue'
import { isUp, ShotManager } from '../shots'
import { store } from '../store'

/** Demandas, fila do Claude, gastos, telas/checagem da API, histórico e daily */
export function registerDemandsIpc(deps: {
  demands: DemandManager
  queue: QueueManager
  costs: CostLedger
  shots: ShotManager
  history: History
  dailyText: () => string
}): void {
  const { demands, queue, costs, shots, history, dailyText } = deps
  ipcMain.handle('demands:updateBase', (_e, id: string) => demands.updateBase(String(id)))
  ipcMain.handle('demands:list', () => demands.all())
  ipcMain.handle('demands:busy', () => demands.busyList())
  ipcMain.handle('demands:save', (_e, d: Demand) => demands.save(d))
  ipcMain.handle('demands:delete', (_e, id: string) => demands.delete(String(id)))
  ipcMain.handle('demands:jira', (_e, id: string) => demands.fetchJira(String(id)))
  ipcMain.handle('demands:analyze', (_e, id: string, what: 'analysis' | 'design') =>
    demands.analyze(String(id), what === 'design' ? 'design' : 'analysis')
  )
  ipcMain.handle('demands:implement', (_e, id: string, message: string, fresh?: boolean) =>
    demands.implement(String(id), String(message ?? ''), Boolean(fresh))
  )
  ipcMain.handle('demands:branch', (_e, id: string, opts: { base?: string; createOnCompany?: boolean; linked?: boolean }) =>
    demands.branch(String(id), {
      base: typeof opts?.base === 'string' ? opts.base : undefined,
      createOnCompany: opts?.createOnCompany === true,
      linked: opts?.linked !== false
    })
  )
  ipcMain.handle('demands:stop', (_e, id: string) => demands.stop(String(id)))
  ipcMain.handle('demands:review', (_e, id: string) => demands.review(String(id)))
  ipcMain.handle('demands:saveReview', (_e, id: string, text: string) => demands.saveReview(String(id), String(text ?? '')))
  ipcMain.handle('demands:publishReview', (_e, id: string) => demands.publishReview(String(id)))
  ipcMain.handle('queue:state', () => queue.state())
  ipcMain.handle('queue:add', (_e, t: { projectId: string; demandId?: string; prompt: string }) =>
    queue.add({ projectId: String(t?.projectId ?? ''), demandId: t?.demandId ? String(t.demandId) : undefined, prompt: String(t?.prompt ?? '') })
  )
  ipcMain.handle('queue:cancel', (_e, id: string) => queue.cancel(String(id)))
  ipcMain.handle('queue:remove', (_e, id: string) => queue.remove(String(id)))
  ipcMain.handle('queue:retry', (_e, id: string) => queue.retry(String(id)))
  ipcMain.handle('queue:move', (_e, id: string, dir: number) => queue.move(String(id), dir < 0 ? -1 : 1))
  ipcMain.handle('queue:runNow', () => queue.runNow())
  ipcMain.handle('queue:clearDone', () => queue.clearDone())
  ipcMain.handle('costs:list', () => costs.list())
  ipcMain.handle('costs:guard', () => costs.guard())
  ipcMain.handle('costs:override', () => {
    const g = costs.overrideToday()
    void queue.tick()
    return g
  })
  ipcMain.handle('demands:queueCopy', (_e, id: string) => demands.queueCopy(String(id)))
  ipcMain.handle('demands:bringQueue', async (_e, id: string) => {
    const r = await demands.bringQueue(String(id))
    // Trouxe para a branch aberta: o servidor de dev recarrega → prints "depois"
    const d = demands.get(String(id))
    const p = d && store.get().projects.find((x) => x.id === d.projectId)
    if (r.ok && d && p && !/Nada novo/.test(r.message)) {
      const w = ShotManager.wants(p)
      const info = await gitInfo(p)
      if ((w.telas || w.api) && info?.branch === d.key && (await isUp(p.localUrl))) {
        setTimeout(() => void shots.take(p, { demandId: d.id, label: 'depois · trouxe da fila' }), 4000)
      }
    }
    return r
  })
  ipcMain.handle('demands:removeQueueCopy', (_e, id: string) => demands.removeQueueCopy(String(id)))
  ipcMain.handle('demands:prDraft', (_e, id: string) => demands.prDraft(String(id)))
  ipcMain.handle('demands:createPr', (_e, id: string, pr: { title: string; body: string; draft: boolean }) =>
    demands.createPr(String(id), { title: String(pr?.title ?? ''), body: String(pr?.body ?? ''), draft: Boolean(pr?.draft) })
  )
  ipcMain.handle('demands:timings', () => demands.timings())
  ipcMain.handle('daily:text', () => dailyText())
  ipcMain.handle('shots:list', (_e, scope: { projectId?: string; demandId?: string }) => shots.list(scope ?? {}))
  ipcMain.handle('shots:take', async (_e, req: { projectId: string; demandId?: string; label: string }) => {
    const p = store.get().projects.find((x) => x.id === req?.projectId)
    if (!p) return { ok: false, message: 'Projeto não encontrado.' }
    return shots.take(p, { demandId: req.demandId, label: String(req.label || 'manual') })
  })
  ipcMain.handle('shots:image', (_e, file: string) => shots.image(String(file)))
  ipcMain.handle('shots:delete', (_e, id: string) => shots.delete(String(id)))
  ipcMain.handle('demands:prComments', (_e, id: string) => demands.prComments(String(id)))
  ipcMain.handle('demands:sendPrComments', (_e, id: string, ids: string[], list: PrComment[], toQueue: boolean) => {
    const chosen = (Array.isArray(list) ? list : []).filter((c) => Array.isArray(ids) && ids.includes(c.id))
    const d = demands.get(String(id))
    if (!d) return { ok: false, message: 'Demanda não encontrada.' }
    const msg = demands.prCommentsMessage(d.id, chosen)
    if (!msg) return { ok: false, message: 'Escolha ao menos um comentário.' }
    if (toQueue) return queue.add({ projectId: d.projectId, demandId: d.id, prompt: msg })
    return demands.implement(d.id, msg)
  })
  ipcMain.handle('demands:doubts', (_e, id: string) => demands.doubts(String(id)))
  ipcMain.handle('demands:commentJira', (_e, id: string, text: string) => demands.commentJira(String(id), String(text ?? '')))
  ipcMain.handle('demands:addImage', (_e, id: string, dataUrl: string) => demands.addImage(String(id), String(dataUrl ?? '')))
  ipcMain.handle('demands:removeImage', (_e, id: string, file: string) => demands.removeImage(String(id), String(file)))
  ipcMain.handle('history:list', () => history.list())
  ipcMain.handle('history:log', (_e, id: string) => history.log(String(id)))
  ipcMain.handle('history:clear', () => history.clear())
}
