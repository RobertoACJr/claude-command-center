import { app, Menu, nativeImage, Tray } from 'electron'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { AppConfig } from '../shared/types'
import { TRAY_FRAMES, type TrayTone } from './trayFrames'

export interface TrayActions {
  show: () => void
  showAlerts: () => void
  setAway: () => void
  goOnline: () => void
  toggleWatcher: () => void
  quit: () => void
}

/** Ícone na bandeja (ao lado do relógio) com status, Vigia e pedidos pendentes */
export class AppTray {
  private tray: Tray | null = null
  private frame = 0
  private timer: NodeJS.Timeout | null = null
  private state: TrayTone = 'online'
  private busy = false

  constructor(
    private iconPath: string,
    private actions: TrayActions
  ) {}

  create(): void {
    if (this.tray) return
    void this.iconPath
    this.tray = new Tray(this.image())
    this.tray.setToolTip('Hélice')
    // Windows: clique simples abre a janela (no Linux o menu já tem "Abrir")
    this.tray.on('click', () => this.actions.show())
  }

  /** Quadros prontos (decodificados e no tamanho certo uma vez só) */
  private frames = new Map<string, Electron.NativeImage>()
  private image() {
    const key = `${this.state}:${this.frame}`
    let img = this.frames.get(key)
    if (!img) {
      const size = process.platform === 'win32' ? 16 : 22
      img = nativeImage.createFromDataURL(TRAY_FRAMES[this.state][this.frame]).resize({ width: size, height: size })
      this.frames.set(key, img)
    }
    return img
  }

  /**
   * Gira a hélice enquanto a fila ou o Vigia trabalham; acende o azul no Ausente e o lavanda com o Vigia.
   * Ao parar, termina a volta até o quadro inicial (sem pulo de volta para a posição de partida).
   */
  setActivity(busy: boolean, state: TrayTone): void {
    if (busy === this.busy && state === this.state) return
    this.busy = busy
    this.state = state
    if (busy && !this.timer) {
      this.timer = setInterval(() => {
        this.frame = (this.frame + 1) % TRAY_FRAMES[this.state].length
        this.tray?.setImage(this.image())
        // Parou de trabalhar: só desliga quando a volta fecha no quadro 0
        if (!this.busy && this.frame === 0 && this.timer) {
          clearInterval(this.timer)
          this.timer = null
        }
      }, 150)
    }
    this.tray?.setImage(this.image())
  }

  update(cfg: AppConfig, watcherOn: boolean): void {
    if (!this.tray) return
    const away = cfg.status === 'off'
    this.setActivity(this.busy, away ? 'away' : watcherOn ? 'vigia' : 'online')
    const pending = cfg.alerts.filter((a) => a.status === 'pending').length
    this.tray.setToolTip(
      `Hélice · ${away ? 'Ausente' : 'Online'}${watcherOn ? ' · Vigia ligado' : ''}` +
        (pending ? ` · ${pending} pedido(s)` : '')
    )
    const menu = Menu.buildFromTemplate([
      { label: 'Abrir a Hélice', click: () => this.actions.show() },
      { type: 'separator' },
      { label: 'Online (no PC)', type: 'radio', checked: !away, click: () => away && this.actions.goOnline() },
      { label: 'Ausente', type: 'radio', checked: away, click: () => !away && this.actions.setAway() },
      { label: 'Monitorar Google Chat', type: 'checkbox', checked: cfg.watcher.enabled, click: () => this.actions.toggleWatcher() },
      ...(pending
        ? [{ type: 'separator' as const }, { label: `🔔 ${pending} pedido(s) de deploy pendente(s)`, click: () => this.actions.showAlerts() }]
        : []),
      { type: 'separator' },
      { label: 'Sair (encerra tudo)', click: () => this.actions.quit() }
    ])
    this.tray.setContextMenu(menu)
  }

  exists(): boolean {
    return !!this.tray
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.tray?.destroy()
    this.tray = null
  }
}

/**
 * Abrir com o sistema. Windows/macOS: API do Electron. Linux: arquivo .desktop em ~/.config/autostart.
 * Só no app instalado (em dev registraria o binário do Electron).
 */
export function applyOpenAtLogin(enabled: boolean): string | null {
  if (!app.isPackaged) return 'Abrir com o sistema só funciona no app instalado.'
  if (process.platform === 'linux') {
    const dir = join(homedir(), '.config', 'autostart')
    const file = join(dir, 'claude-command-center.desktop')
    if (!enabled) {
      if (existsSync(file)) rmSync(file)
      return null
    }
    const exec = process.env.APPIMAGE || process.execPath
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      file,
      [
        '[Desktop Entry]',
        'Type=Application',
        'Name=Hélice',
        `Exec="${exec}" --hidden`,
        'X-GNOME-Autostart-enabled=true',
        'Terminal=false',
        ''
      ].join('\n')
    )
    return null
  }
  app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] })
  return null
}
