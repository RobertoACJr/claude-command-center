import { app, Menu, nativeImage, Tray } from 'electron'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { AppConfig } from '../shared/types'

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

  constructor(
    private iconPath: string,
    private actions: TrayActions
  ) {}

  create(): void {
    if (this.tray) return
    const size = process.platform === 'win32' ? 16 : 22
    const img = nativeImage.createFromPath(this.iconPath).resize({ width: size, height: size })
    this.tray = new Tray(img)
    this.tray.setToolTip('Claude Command Center')
    // Windows: clique simples abre a janela (no Linux o menu já tem "Abrir")
    this.tray.on('click', () => this.actions.show())
  }

  update(cfg: AppConfig, watcherOn: boolean): void {
    if (!this.tray) return
    const away = cfg.status === 'off'
    const pending = cfg.alerts.filter((a) => a.status === 'pending').length
    this.tray.setToolTip(
      `Claude Command Center · ${away ? 'Ausente' : 'Online'}${watcherOn ? ' · Vigia ligado' : ''}` +
        (pending ? ` · ${pending} pedido(s)` : '')
    )
    const menu = Menu.buildFromTemplate([
      { label: 'Abrir Claude Command Center', click: () => this.actions.show() },
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
        'Name=Claude Command Center',
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
