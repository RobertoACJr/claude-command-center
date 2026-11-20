import { useEffect, useState } from 'react'
import { Command, Eye, EyeOff, History, Loader2, Settings, TerminalSquare } from 'lucide-react'
import type { NotificationTarget, PresenceStatus, WatcherState } from '@shared/types'
import { NotificationBell } from './NotificationBell'
import { cn } from '../lib/utils'

export function Header({
  status,
  onToggle,
  remoteCount,
  remoteActive,
  watcher,
  watcherEnabled,
  onToggleWatcher,
  onOpenSettings,
  onGo,
  onOpenHistory,
  onOpenPalette
}: {
  status: PresenceStatus
  onToggle: () => void
  remoteCount: number
  remoteActive: number
  watcher: WatcherState
  watcherEnabled: boolean
  onToggleWatcher: () => void
  onOpenSettings: () => void
  onGo: (t: NotificationTarget) => void
  onOpenHistory: () => void
  onOpenPalette: () => void
}) {
  const on = status === 'on'
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-line bg-bg/80 px-5">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-purple to-violet glow-violet">
          <TerminalSquare size={19} className="text-white" />
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight text-zinc-50">Claude Command Center</div>
          <div className="text-[11px] text-zinc-500">Projetos · Scripts · Claude Code</div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          data-testid="palette-button"
          onClick={onOpenPalette}
          title="Paleta de comandos: rodar scripts, executar projetos, ligar Remote… (Ctrl+K)"
          className="hidden h-9 cursor-pointer items-center gap-2 rounded-lg border border-line bg-card px-3 text-xs text-zinc-500 transition-colors hover:border-violet/60 hover:text-white md:inline-flex"
        >
          <Command size={13} /> Comandos <kbd className="rounded border border-line px-1 text-[10px]">Ctrl K</kbd>
        </button>
        <WatcherPill state={watcher} enabled={watcherEnabled} onClick={onToggleWatcher} />
        <button
          type="button"
          data-testid="history-button"
          onClick={onOpenHistory}
          title="Histórico de execuções"
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-line bg-card text-zinc-400 transition-colors hover:border-violet/60 hover:text-white"
        >
          <History size={16} />
        </button>
        <NotificationBell onGo={onGo} />
        <button
          type="button"
          onClick={onOpenSettings}
          title="Configurações & Integrações"
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-line bg-card text-zinc-400 transition-colors hover:border-violet/60 hover:text-white"
        >
          <Settings size={16} />
        </button>
        <div className="hidden text-right text-xs leading-tight sm:block">
          <div className={on ? 'text-zinc-400' : 'text-purple'}>{on ? 'Você está no PC' : 'Modo ausente'}</div>
          <div className="text-zinc-600">
            {remoteActive > 0 ? `Remote Control ativo em ${remoteActive}` : `${remoteCount} projeto(s) com Remote automático`}
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={onToggle}
          title={on ? 'Ir para o modo Ausente' : 'Voltar ao PC (Online)'}
          className="relative flex h-11 w-[204px] cursor-pointer items-center rounded-full border border-violet/60 bg-violet/10 p-1 transition-all glow-violet"
        >
          <span
            className={cn(
              'absolute top-1 h-9 w-[98px] rounded-full bg-gradient-to-b from-purple to-violet transition-all duration-300',
              on ? 'left-1' : 'left-[102px]'
            )}
          />
          <span
            className={cn(
              'relative z-10 flex w-[98px] items-center justify-center gap-1.5 text-xs font-semibold',
              on ? 'text-white' : 'text-zinc-500'
            )}
          >
            <span className={cn('h-2 w-2 rounded-full', on ? 'bg-emerald-400' : 'bg-zinc-600')} />
            Online
          </span>
          <span
            className={cn(
              'relative z-10 flex w-[98px] items-center justify-center gap-1.5 text-xs font-semibold',
              on ? 'text-zinc-500' : 'text-white'
            )}
          >
            <span className={cn('h-2 w-2 rounded-full', on ? 'bg-zinc-600' : 'animate-pulse bg-white')} />
            Ausente
          </span>
        </button>
      </div>
    </header>
  )
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

function WatcherPill({ state, enabled, onClick }: { state: WatcherState; enabled: boolean; onClick: () => void }) {
  const now = useNow(state.phase === 'idle' && !!state.nextAt)
  const left = state.nextAt ? Math.max(0, Math.round((state.nextAt - now) / 1000)) : null
  const mmss = left !== null ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : ''

  const look = {
    off: { cls: 'border-line bg-card text-zinc-500', icon: <EyeOff size={14} />, label: 'Vigia' },
    idle: {
      cls: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
      icon: <Eye size={14} />,
      label: mmss ? `Vigia · ${mmss}` : 'Vigia'
    },
    checking: {
      cls: 'border-violet/50 bg-violet/10 text-purple',
      icon: <Loader2 size={14} className="animate-spin" />,
      label: 'Verificando…'
    },
    blocked: { cls: 'border-amber-400/40 bg-amber-400/10 text-amber-300', icon: <Eye size={14} />, label: 'Vigia ⚠' }
  }[state.phase]

  const title =
    (state.phase === 'blocked'
      ? `Vigia bloqueado: ${state.reason}\nClique para abrir o guia de configuração.`
      : `Monitorar Google Chat: ${enabled ? 'ligado' : 'desligado'} (clique para ligar/desligar, mesmo Online)\n${state.reason}\nAvisos: sino do app, notificação do sistema, faixa de pedidos e Telegram (se configurado).`) +
    (state.lastResult ? `\nÚltimo: ${state.lastResult}` : '')

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors hover:brightness-125',
        look.cls
      )}
    >
      {look.icon}
      {look.label}
      {state.phase !== 'off' && !enabled && <span className="text-[10px] opacity-70">auto</span>}
    </button>
  )
}
