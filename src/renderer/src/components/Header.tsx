import { TerminalSquare } from 'lucide-react'
import type { PresenceStatus } from '@shared/types'
import { cn } from '../lib/utils'

export function Header({
  status,
  onToggle,
  remoteCount
}: {
  status: PresenceStatus
  onToggle: () => void
  remoteCount: number
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
        <div className="hidden text-right text-xs leading-tight sm:block">
          <div className={on ? 'text-zinc-400' : 'text-amber-300'}>
            {on ? 'Você está no PC' : 'Modo ausente'}
          </div>
          <div className="text-zinc-600">
            {on
              ? `${remoteCount} projeto(s) com Remote Control`
              : `Remote Control em ${remoteCount} projeto(s) (Fase 2)`}
          </div>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={onToggle}
          title="Alternar status ON / OFF"
          className={cn(
            'relative flex h-11 w-[188px] cursor-pointer items-center rounded-full border p-1 transition-all',
            on ? 'border-violet/60 bg-violet/10 glow-violet' : 'border-line bg-card'
          )}
        >
          <span
            className={cn(
              'absolute top-1 h-9 w-[90px] rounded-full transition-all duration-300',
              on ? 'left-1 bg-gradient-to-b from-purple to-violet' : 'left-[94px] bg-zinc-800'
            )}
          />
          <span
            className={cn(
              'relative z-10 flex w-[90px] items-center justify-center gap-1.5 text-xs font-semibold',
              on ? 'text-white' : 'text-zinc-500'
            )}
          >
            <span className={cn('h-2 w-2 rounded-full', on ? 'bg-emerald-400' : 'bg-zinc-600')} />
            ON
          </span>
          <span
            className={cn(
              'relative z-10 flex w-[90px] items-center justify-center gap-1.5 text-xs font-semibold',
              on ? 'text-zinc-500' : 'text-amber-300'
            )}
          >
            <span className={cn('h-2 w-2 rounded-full', on ? 'bg-zinc-600' : 'bg-amber-400 animate-pulse')} />
            OFF
          </span>
        </button>
      </div>
    </header>
  )
}
