import { BrowserWindow, session } from 'electron'
import { randomUUID } from 'crypto'
import type { Capturer } from './shots'

const SETTLE_MS = 1500
const MAX_HEIGHT = 4000

/**
 * Abre a página numa janela invisível (sessão própria, nada do app vaza), espera assentar,
 * tira o print da página inteira (até 4000px) e junta os erros do console e as requisições que falharam.
 */
export const captureWithElectron: Capturer = async (url, width) => {
  const errors: string[] = []
  const partition = `shots-${randomUUID()}`
  const ses = session.fromPartition(partition)
  ses.webRequest.onCompleted((d) => {
    if (d.statusCode >= 400) errors.push(`HTTP ${d.statusCode} em ${short(d.url)}`)
  })
  ses.webRequest.onErrorOccurred((d) => {
    if (d.error !== 'net::ERR_ABORTED') errors.push(`${d.error} em ${short(d.url)}`)
  })
  const win = new BrowserWindow({
    show: false,
    width,
    height: 900,
    useContentSize: true,
    paintWhenInitiallyHidden: true,
    webPreferences: { offscreen: true, partition, sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  win.webContents.setAudioMuted(true)
  win.webContents.on('console-message', (...args: unknown[]) => {
    // Electron novo: (evento com level/message); antigo: (evento, level número, message)
    const ev = args[0] as { level?: string | number; message?: string }
    const level = typeof ev?.level === 'string' ? ev.level : (args[1] as number)
    const message = typeof ev?.message === 'string' ? ev.message : String(args[2] ?? '')
    if (level === 'error' || level === 3) errors.push(`console: ${message.slice(0, 300)}`)
  })
  win.webContents.on('render-process-gone', (_e, d) => errors.push(`a página travou (${d.reason})`))
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  try {
    await Promise.race([
      win.loadURL(url),
      new Promise((_r, rej) => setTimeout(() => rej(new Error('a página demorou mais de 30s')), 30_000))
    ]).catch((e: Error) => {
      // ERR_ABORTED acontece em redirecionamentos de SPA: não é falha
      if (!/ERR_ABORTED/.test(e.message)) errors.push(`não carregou: ${e.message.replace(/\s*\(-?\d+\).*$/, '')}`)
    })
    await sleep(SETTLE_MS)
    const h = Number(await win.webContents.executeJavaScript('Math.max(document.body?.scrollHeight ?? 0, document.documentElement.scrollHeight)').catch(() => 900))
    const height = Math.min(Math.max(h || 900, 600), MAX_HEIGHT)
    win.setContentSize(width, height)
    await sleep(400)
    const img = await win.webContents.capturePage()
    return { png: img.isEmpty() ? null : img.toPNG(), errors: [...new Set(errors)].slice(0, 20) }
  } finally {
    win.destroy()
    void ses.clearStorageData().catch(() => {})
  }
}

const short = (u: string) => (u.length > 90 ? u.slice(0, 87) + '…' : u)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
