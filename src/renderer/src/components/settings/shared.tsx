// Peças comuns das abas de Configurações
import { useEffect, useState, type ReactNode } from 'react'
import { AppWindow, ArrowLeftRight, CheckCircle2, CircleHelp, Clock, Bell, Bot, Eye, Gem, Github, KeyRound, Loader2, MessageSquare, MessageSquareReply, Pencil, Plug, Plus, RefreshCw, Rocket, Search, Send, Settings, ShieldCheck, SquareKanban, Trash2, Workflow, X, XCircle, Zap } from 'lucide-react'
import type {
  AiId,
  AiProvider,
  ToolCheck,
  AppConfig,
  AutomationRule,
  ReplyTemplate,
  RuleMode,
  IntegrationCheck,
  SyncStatus,
  IntegrationId,
  OpResult,
  SecretKey,
  SecretsStatus,
  SettingsPatch,
  UpdateState,
  WatcherState
} from '@shared/types'
import { Button, Field, IconButton, Modal, Toggle, inputCls } from '../ui'
import { cn, uid } from '../../lib/utils'
import { isProdEnv } from '@shared/vars'
import { ClaudePermsEditor } from '../ClaudePermsEditor'
import { Copy, SetupTab, TOOLS, type Os } from '../SetupTab'
import { useAis } from '../../lib/ais'

export function HelpTip({ children }: { children: ReactNode }) {
  return (
    <span className="group relative inline-flex items-center self-center">
      <span tabIndex={0} className="flex cursor-help items-center text-zinc-500 group-hover:text-purple">
        <CircleHelp size={15} strokeWidth={2} />
      </span>
      <span className="pointer-events-none invisible absolute top-6 left-1/2 z-50 w-80 -translate-x-1/2 rounded-lg border border-line bg-card p-3 text-[11px] font-normal leading-relaxed text-zinc-300 opacity-0 shadow-2xl transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
        {children}
      </span>
    </span>
  )
}

export function Section({
  icon,
  title,
  children,
  right,
  help
}: {
  icon: ReactNode
  title: string
  children: ReactNode
  right?: ReactNode
  /** Texto do "?" ao lado do título (aparece no hover) */
  help?: ReactNode
}) {
  return (
    <div className="rounded-xl border border-line bg-card-2 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold leading-none text-zinc-100">
          <span className="flex items-center text-purple">{icon}</span>
          {title}
          {help && <HelpTip>{help}</HelpTip>}
        </div>
        {right}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

/** Campo de segredo: vazio = mantém o valor salvo. Nunca mostra o valor. */
export function SecretInput({
  isSet,
  value,
  onChange,
  onClear,
  placeholder,
  multiline
}: {
  isSet: boolean
  value: string
  onChange: (v: string) => void
  onClear: () => void
  placeholder: string
  multiline?: boolean
}) {
  const ph = isSet ? '•••••••• salvo (deixe vazio para manter)' : placeholder
  return (
    <div className="flex items-start gap-2">
      {multiline ? (
        <textarea
          className={inputCls + ' min-h-[96px] font-mono text-xs'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={ph}
          spellCheck={false}
        />
      ) : (
        <input
          type="password"
          autoComplete="off"
          className={inputCls + ' font-mono text-xs'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={ph}
        />
      )}
      {isSet && (
        <Button variant="ghost" size="sm" className="mt-1 shrink-0" onClick={onClear} title="Apagar o valor salvo">
          Apagar
        </Button>
      )}
    </div>
  )
}

export function Result({ r }: { r: OpResult | null }) {
  if (!r) return null
  return (
    <pre
      className={cn(
        'selectable max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border p-2.5 font-mono text-[11px]',
        r.ok ? 'border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-200' : 'border-red-500/30 bg-red-500/[0.06] text-red-300'
      )}
    >
      {r.message}
    </pre>
  )
}

export function useBusy() {
  const [busy, setBusy] = useState<string | null>(null)
  const run = async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(key)
    try {
      return await fn()
    } finally {
      setBusy(null)
    }
  }
  return { busy, run }
}

export function Spin({ on }: { on: boolean }) {
  return on ? <Loader2 size={13} className="animate-spin" /> : null
}

export type SaveFn = (patch: SettingsPatch) => Promise<void>

export const CHECK_STYLE = {
  ok: ['✓', 'text-emerald-300'],
  warn: ['•', 'text-zinc-400'],
  fail: ['✗', 'text-red-300'],
  off: ['○', 'text-zinc-500']
} as const

export function fmtWhen(at: number): string {
  const d = new Date(at)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return new Date().toDateString() === d.toDateString() ? `hoje às ${time}` : `${d.toLocaleDateString()} às ${time}`
}

/** Resultado do teste de verdade (conta, MCP no Claude, conectores da conta claude.ai) */
export function CheckList({ check, testing }: { check: IntegrationCheck | undefined; testing: boolean }) {
  if (testing && !check)
    return (
      <div className="flex items-center gap-2 text-[11px] text-zinc-500">
        <Loader2 size={12} className="animate-spin" /> testando de verdade… (pode levar uns segundos)
      </div>
    )
  if (!check) return null
  return (
    <div data-testid="integration-check" className="space-y-1 rounded-lg border border-line bg-bg p-2.5">
      {check.lines.map((l, i) => (
        <div key={i} className="flex gap-2 text-[11px] leading-relaxed">
          <span className={cn('w-3 shrink-0 font-bold', CHECK_STYLE[l.state][1])}>{CHECK_STYLE[l.state][0]}</span>
          <span className="min-w-0 [overflow-wrap:anywhere]">
            <b className="text-zinc-300">{l.label}:</b> <span className={CHECK_STYLE[l.state][1]}>{l.detail}</span>
          </span>
        </div>
      ))}
      <div className="text-[10px] text-zinc-600">
        testado {fmtWhen(check.at)} {testing ? '· testando de novo…' : '· o resultado fica guardado por um dia'}
      </div>
    </div>
  )
}

/** Resumo no canto do card a partir do teste */
export function CheckBadge({ check, testing }: { check: IntegrationCheck | undefined; testing: boolean }) {
  if (testing) return <span className="text-[11px] text-zinc-500">testando…</span>
  if (!check) return null
  const main = check.lines.filter((l) => !l.label.startsWith('Conectores da sua conta'))
  if (main.some((l) => l.state === 'ok')) {
    const fails = main.some((l) => l.state === 'fail')
    return <span className={cn('text-[11px]', fails ? 'text-amber-300' : 'text-emerald-400')}>{fails ? '● funcionando em parte' : '● funcionando'}</span>
  }
  if (main.some((l) => l.state === 'fail')) return <span className="text-[11px] text-red-400">● com problema</span>
  return <span className="text-[11px] text-zinc-500">○ não configurado</span>
}


export function Switch({ checked, onChange, disabled, title }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; title?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative mt-0.5 h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        checked ? 'bg-violet' : 'bg-zinc-700'
      )}
    >
      <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
    </button>
  )
}


export function IconBtn({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-zinc-500 hover:bg-red-500/10 hover:text-red-400"
    >
      <Trash2 size={13} />
    </button>
  )
}
