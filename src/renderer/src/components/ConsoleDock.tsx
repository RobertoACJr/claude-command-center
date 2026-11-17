import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  Ban,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  FolderTree,
  Loader2,
  Maximize2,
  MessageSquarePlus,
  Minimize2,
  SendHorizontal,
  Sparkles,
  Square,
  SquareTerminal,
  Trash2,
  XCircle
} from 'lucide-react'
import type { ConsoleMode } from '@shared/types'
import { IconButton } from './ui'
import { cn } from '../lib/utils'

export type LineKind = 'info' | 'cmd' | 'stdout' | 'stderr' | 'claude' | 'tool' | 'user' | 'success' | 'error'

export interface ConsoleLine {
  id: number
  kind: LineKind
  text: string
  ts: number
}

export type RunStatus = 'idle' | 'running' | 'success' | 'error' | 'stopped'

const kindCls: Record<LineKind, string> = {
  info: 'text-zinc-500',
  cmd: 'text-purple',
  stdout: 'text-zinc-300',
  stderr: 'text-red-400',
  claude: 'text-violet-200',
  tool: 'text-zinc-500 italic',
  user: 'text-sky-300',
  success: 'text-emerald-400',
  error: 'text-red-400'
}

function StatusPill({ status, exitCode, running }: { status: RunStatus; exitCode: number | null; running: number }) {
  const map = {
    idle: { icon: <CircleDashed size={13} />, label: 'Ocioso', cls: 'text-zinc-500 border-line' },
    running: {
      icon: <Loader2 size={13} className="animate-spin" />,
      label: running > 1 ? `Rodando (${running})` : 'Rodando…',
      cls: 'text-purple border-violet/40 bg-violet/10'
    },
    success: {
      icon: <CheckCircle2 size={13} />,
      label: `Sucesso${exitCode !== null ? ` (${exitCode})` : ''}`,
      cls: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
    },
    error: {
      icon: <XCircle size={13} />,
      label: `Erro${exitCode !== null ? ` (${exitCode})` : ''}`,
      cls: 'text-red-400 border-red-500/30 bg-red-500/10'
    },
    stopped: { icon: <Ban size={13} />, label: 'Interrompido', cls: 'text-amber-300 border-amber-400/30 bg-amber-400/10' }
  }[status]
  return (
    <span className={cn('inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs', map.cls)}>
      {map.icon}
      {map.label}
    </span>
  )
}

export interface TargetOption {
  value: string
  label: string
}

export function ConsoleDock({
  lines,
  mode,
  onModeChange,
  expanded,
  onToggleExpand,
  status,
  exitCode,
  running,
  onStop,
  onSubmit,
  onClear,
  onNewChat,
  hasChat,
  targets,
  target,
  onTargetChange,
  cwdLabel
}: {
  lines: ConsoleLine[]
  mode: ConsoleMode
  onModeChange: (m: ConsoleMode) => void
  expanded: boolean
  onToggleExpand: () => void
  status: RunStatus
  exitCode: number | null
  running: number
  onStop: () => void
  onSubmit: (text: string) => void
  onClear: () => void
  onNewChat: () => void
  hasChat: boolean
  targets: TargetOption[]
  target: string
  onTargetChange: (v: string) => void
  cwdLabel: string
}) {
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [histIdx, setHistIdx] = useState(-1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    const el = scrollRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [lines, expanded])

  const send = () => {
    const text = input.trim()
    if (!text) return
    onSubmit(text)
    setHistory((h) => [text, ...h.filter((x) => x !== text)].slice(0, 50))
    setHistIdx(-1)
    setInput('')
    stick.current = true
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') return send()
    if (e.key === 'c' && e.ctrlKey && !input && running) {
      e.preventDefault()
      return onStop()
    }
    if (e.key === 'ArrowUp' && history.length) {
      e.preventDefault()
      const i = Math.min(histIdx + 1, history.length - 1)
      setHistIdx(i)
      setInput(history[i])
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const i = histIdx - 1
      setHistIdx(i)
      setInput(i >= 0 ? history[i] : '')
    }
  }

  return (
    <div
      className={cn(
        'flex flex-col border-line bg-[#0c0c10]',
        expanded ? 'fixed inset-0 z-40' : 'h-[280px] shrink-0 border-t'
      )}
    >
      {/* Barra de título do console */}
      <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-line px-4">
        <div className="flex min-w-0 items-center gap-2 text-xs text-zinc-500">
          <span className="font-semibold uppercase tracking-wider text-zinc-400">Console</span>
          <span className="text-zinc-700">·</span>
          <FolderTree size={12} className="shrink-0" />
          <select
            value={target}
            onChange={(e) => onTargetChange(e.target.value)}
            className="max-w-[200px] cursor-pointer rounded border border-transparent bg-transparent text-xs text-zinc-300 hover:border-line focus:outline-none"
            title="Pasta onde os comandos do console rodam"
          >
            {targets.map((t) => (
              <option key={t.value} value={t.value} className="bg-card">
                {t.label}
              </option>
            ))}
          </select>
          <span className="truncate font-mono text-zinc-600" title={cwdLabel}>
            {cwdLabel}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {mode === 'claude' && hasChat && (
            <IconButton title="Nova conversa com o Claude" tone="accent" onClick={onNewChat}>
              <MessageSquarePlus size={14} />
            </IconButton>
          )}
          <IconButton title="Limpar console" onClick={onClear}>
            <Trash2 size={13} />
          </IconButton>
          <IconButton title={expanded ? 'Recolher' : 'Expandir'} onClick={onToggleExpand}>
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </IconButton>
        </div>
      </div>

      {/* Saída */}
      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
        className="selectable min-h-0 flex-1 overflow-y-auto px-4 py-2 font-mono text-[12.5px] leading-relaxed"
        onClick={() => window.getSelection()?.isCollapsed && inputRef.current?.focus()}
      >
        {lines.length === 0 ? (
          <div className="pt-2 text-zinc-600">Pronto. Execute um script ou digite um comando abaixo.</div>
        ) : (
          lines.map((l) => (
            <div key={l.id} className={cn('min-h-[1.2em] whitespace-pre-wrap break-words', kindCls[l.kind])}>
              {l.kind === 'cmd' && <span className="text-zinc-600">$ </span>}
              {l.kind === 'user' && <span className="text-zinc-600">› </span>}
              {l.text}
            </div>
          ))
        )}
      </div>

      {/* Barra de input */}
      <div className="flex shrink-0 items-center gap-2 border-t border-line bg-card px-3 py-2.5">
        <div className="flex h-8 shrink-0 rounded-lg border border-line bg-bg p-0.5">
          {(
            [
              ['terminal', 'Terminal', SquareTerminal],
              ['claude', 'Claude', Sparkles]
            ] as const
          ).map(([m, label, Icon]) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                onModeChange(m)
                inputRef.current?.focus()
              }}
              className={cn(
                'inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
                mode === m ? 'bg-violet text-white' : 'text-zinc-500 hover:text-zinc-200'
              )}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>

        <div className="flex h-8 min-w-0 flex-1 items-center rounded-lg border border-line bg-bg px-2.5 focus-within:border-violet/70">
          <ChevronRight size={14} className={mode === 'claude' ? 'text-purple' : 'text-zinc-500'} />
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            spellCheck={false}
            placeholder={
              mode === 'terminal'
                ? 'Digite um comando… (Ctrl+C para parar)'
                : hasChat
                  ? 'Continue a conversa com o Claude…'
                  : 'Pergunte ou dê uma ordem ao Claude…'
            }
            className="h-full min-w-0 flex-1 bg-transparent px-2 font-mono text-[12.5px] text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
          />
          <IconButton title="Enviar (Enter)" tone="accent" onClick={send}>
            <SendHorizontal size={14} />
          </IconButton>
        </div>

        {running > 0 && (
          <button
            type="button"
            onClick={onStop}
            title="Parar a execução mais recente"
            className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 text-xs text-red-300 hover:bg-red-500/20"
          >
            <Square size={11} fill="currentColor" /> Parar
          </button>
        )}
        <StatusPill status={status} exitCode={exitCode} running={running} />
      </div>
    </div>
  )
}
