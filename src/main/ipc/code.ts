import { ipcMain } from 'electron'
import type { AppConfig, DiffFile, OpResult } from '../../shared/types'
import { callMe } from '../callmebot'
import { diffFile, diffSummary } from '../diff'
import { detectEditors, openInEditor } from '../editor'

/** Tela de mudanças (diff), "Abrir no editor", rascunhos do Vigia e teste da ligação */
export function registerCodeIpc(d: { config: () => AppConfig; sendDraft: (alertId: string, text: string) => Promise<OpResult> }): void {
  ipcMain.handle('alerts:sendText', (_e, id: string, text: string) => d.sendDraft(String(id), String(text ?? '')))
  ipcMain.handle('call:test', () => callMe(d.config().telegram.call, 'Hélice aqui. Teste de ligação: se você está ouvindo isso, as ligações de pedidos urgentes vão funcionar.', true))
  const project = (id: string) => d.config().projects.find((p) => p.id === id)
  ipcMain.handle('diff:summary', async (_e, id: string, mode: 'local' | 'base') => {
    const p = project(String(id))
    if (!p?.path) return { ok: false, message: 'Projeto sem pasta.', mode, ref: '', refLabel: '', branch: null, files: [] }
    return diffSummary(p, mode === 'base' ? 'base' : 'local')
  })
  ipcMain.handle('diff:file', async (_e, id: string, file: DiffFile, ref: string) => {
    const p = project(String(id))
    if (!p?.path) return { text: '', binary: false, truncated: false, error: 'Projeto sem pasta.' }
    return diffFile(p, file, String(ref))
  })
  ipcMain.handle('editor:list', () => detectEditors())
  ipcMain.handle('editor:open', (_e, id: string, file?: string, line?: number) => {
    const p = project(String(id))
    if (!p?.path) return { ok: false, message: 'Projeto sem pasta.' }
    const g = d.config().general
    return openInEditor(g.editor, g.editorCommand, p.path, typeof file === 'string' && file ? file : undefined, Number(line) || undefined)
  })
}
