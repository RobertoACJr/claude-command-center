import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '../shared/types'

const EVERY_MS = 4 * 60 * 60_000

/**
 * Atualização automática pelas Releases do GitHub (electron-updater).
 * Baixa sozinho em segundo plano, mas NUNCA reinicia sozinho: o app avisa e você escolhe a hora
 * (ou instala na próxima vez que sair pelo "Sair"). Assim o Vigia, o Remote Control e os projetos
 * não caem no meio do caminho.
 */
export class Updater {
  private state: UpdateState = { phase: 'idle', current: app.getVersion() }
  private timer: NodeJS.Timeout | null = null

  constructor(private notify: (s: UpdateState) => void) {}

  getState(): UpdateState {
    return { ...this.state }
  }

  private set(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch }
    this.notify(this.getState())
  }

  start(): void {
    if (!app.isPackaged) {
      this.set({ phase: 'disabled', message: 'Atualização automática só no app instalado.' })
      return
    }
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('checking-for-update', () => this.set({ phase: 'checking', message: undefined }))
    autoUpdater.on('update-available', (i) => this.set({ phase: 'downloading', version: i.version, percent: 0 }))
    autoUpdater.on('update-not-available', () => this.set({ phase: 'none', checkedAt: Date.now() }))
    autoUpdater.on('download-progress', (p) => this.set({ phase: 'downloading', percent: Math.round(p.percent) }))
    autoUpdater.on('update-downloaded', (i) => this.set({ phase: 'ready', version: i.version, checkedAt: Date.now() }))
    autoUpdater.on('error', (err) => this.set({ phase: 'error', message: friendly(err), checkedAt: Date.now() }))
    setTimeout(() => void this.check(), 15_000)
    this.timer = setInterval(() => void this.check(), EVERY_MS)
  }

  async check(): Promise<void> {
    if (this.state.phase === 'disabled' || this.state.phase === 'downloading' || this.state.phase === 'ready') return
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      this.set({ phase: 'error', message: friendly(err), checkedAt: Date.now() })
    }
  }

  /** Fecha o app e instala (o before-quit encerra Vigia, Remote Control e projetos) */
  installNow(): void {
    if (this.state.phase !== 'ready') return
    autoUpdater.quitAndInstall(false, true)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }
}

function friendly(err: unknown): string {
  const m = (err as Error)?.message ?? String(err)
  if (/404|Not Found|Cannot find latest/i.test(m)) return 'Nenhuma versão publicada encontrada (o repositório precisa ser público e ter uma release).'
  if (/ENOTFOUND|ETIMEDOUT|ECONNRESET|net::/i.test(m)) return 'Sem conexão com o GitHub.'
  return m.split('\n')[0].slice(0, 200)
}
