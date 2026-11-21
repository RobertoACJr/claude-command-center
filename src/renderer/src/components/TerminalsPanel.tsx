import { memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useLines } from '../lib/lineStore'
import {
  Ban,
  Bot,
  Gem,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  ClipboardCopy,
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
  X,
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
}

export type RunStatus = 'idle' | 'running' | 'success' | 'error' | 'stopped'

export interface TabState {
  key: string
  title: string
  status: RunStatus
  exitCode: number | null
  /** Execuções vivas nesta aba */
  running: string[]
  unread: boolean
}

export const FIXED_TABS = ['console', 'claude', 'gemini', 'codex', 'system'] as const

/** Quantas linhas viram elementos de cada vez */
const PAGE = 400

/** Uma linha do terminal: não redesenha quando chegam outras */
const LineRow = memo(function LineRow({ line: l }: { line: ConsoleLine }) {
  return (
    <div className={cn('min-h-[1.2em] whitespace-pre-wrap break-words', kindCls[l.kind])}>
      {l.kind === 'cmd' && <span className="text-zinc-600">$ </span>}
      {l.kind === 'user' && <span className="text-zinc-600">› </span>}
      {l.text}
    </div>
  )
})

const kindCls: Record<LineKind, string> = {
  info: 'text-zinc-500',
  cmd: 'text-purple',
  stdout: 'text-zinc-300',
  stderr: 'text-red-400',
  claude: 'text-zinc-200',
  tool: 'text-zinc-500 italic',
  user: 'text-sky-300',
  success: 'text-emerald-400',
  error: 'text-red-400'
}

function StatusDot({ t }: { t: TabState }) {
  if (t.running.length) return <Loader2 size={11} className="animate-spin text-purple" />
  const cls = {
    idle: 'bg-zinc-700',
    running: 'bg-violet',
    success: 'bg-emerald-400',
    error: 'bg-red-400',
    stopped: 'bg-amber-400'
  }[t.status]
  return <span className={cn('h-1.5 w-1.5 rounded-full', cls)} />
}

function StatusPill({ t }: { t: TabState | undefined }) {
  const status = t?.running.length ? 'running' : (t?.status ?? 'idle')
  const code = t?.exitCode ?? null
  const map = {
    idle: { icon: <CircleDashed size={13} />, label: 'Ocioso', cls: 'text-zinc-500 border-line' },
    running: {
      icon: <Loader2 size={13} className="animate-spin" />,
      label: 'Rodando…',
      cls: 'text-purple border-violet/40 bg-violet/10'
    },
    success: {
      icon: <CheckCircle2 size={13} />,
      label: `Sucesso${code !== null ? ` (${code})` : ''}`,
      cls: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
    },
    error: {
      icon: <XCircle size={13} />,
      label: `Erro${code !== null ? ` (${code})` : ''}`,
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

const MODES: Array<{ id: ConsoleMode; label: string; desc: string; Icon: typeof SquareTerminal }> = [
  { id: 'terminal', label: 'Terminal', desc: 'Comandos do sistema (bash/PowerShell)', Icon: SquareTerminal },
  { id: 'claude', label: 'Claude', desc: 'Claude Code: conversa e ordens de desenvolvimento', Icon: Sparkles },
  { id: 'gemini', label: 'Gemini', desc: 'Gemini CLI: análises, sem executar nada', Icon: Gem },
  { id: 'codex', label: 'ChatGPT', desc: 'Codex CLI: só leitura, cada mensagem é nova', Icon: Bot }
]

/**
 * Um botão só com o modo atual; passando o mouse (ou clicando) abre as outras opções.
 * Ao enviar, a saída aparece na aba do modo, que abre sozinha em cima.
 */
function ModePicker({ mode, onChange }: { mode: ConsoleMode; onChange: (m: ConsoleMode) => void }) {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const current = MODES.find((m) => m.id === mode) ?? MODES[0]
  const keepOpen = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setOpen(true)
  }
  const closeSoon = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 180)
  }
  return (
    <div className="relative shrink-0" onMouseEnter={keepOpen} onMouseLeave={closeSoon}>
      <button
        type="button"
        data-testid="mode-picker"
        onClick={() => setOpen((o) => !o)}
        title="Onde o texto do campo vai: passe o mouse para trocar"
        className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-violet/50 bg-violet/15 px-2.5 text-xs font-medium text-purple transition-colors hover:bg-violet/25"
      >
        <current.Icon size={13} />
        {current.label}
        <ChevronDown size={12} className={cn('transition-transform', open ? 'rotate-180' : '')} />
      </button>
      {/* Fica no DOM mesmo fechado (só escondido) */}
      <div className={cn('absolute bottom-full left-0 z-50 pb-1.5', open ? '' : 'hidden')}>
        <div className="w-72 rounded-xl border border-line bg-card p-1 shadow-2xl">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                onChange(m.id)
                setOpen(false)
              }}
              className={cn(
                'flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                m.id === mode ? 'bg-violet/15 text-zinc-100' : 'text-zinc-300 hover:bg-white/5'
              )}
            >
              <m.Icon size={14} className={cn('mt-0.5 shrink-0', m.id === mode ? 'text-purple' : 'text-zinc-500')} />
              <span>
                <span className="block text-xs font-medium">{m.label}</span>
                <span className="block text-[11px] text-zinc-500">{m.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export interface TargetOption {
  value: string
  label: string
}

export function TerminalsPanel({
  tabs,
  order,
  active,
  onActivate,
  open,
  onToggleOpen,
  expanded,
  onToggleExpand,
  onCloseTab,
  onClearTab,
  onStopTab,
  stopping,
  inputTarget,
  mode,
  onModeChange,
  onSubmit,
  onNewChat,
  hasChat,
  targets,
  target,
  onTargetChange,
  cwdLabel
}: {
  tabs: Record<string, TabState>
  order: string[]
  active: string
  onActivate: (key: string) => void
  open: boolean
  onToggleOpen: () => void
  expanded: boolean
  onToggleExpand: () => void
  onCloseTab: (key: string) => void
  onClearTab: (key: string) => void
  onStopTab: (key: string) => void
  /** Parar clicado, esperando o processo terminar */
  stopping: boolean
  /** stdin = texto vai para o processo rodando; project = comando roda na pasta da aba do projeto */
  inputTarget: 'normal' | 'stdin' | 'project'
  mode: ConsoleMode
  onModeChange: (m: ConsoleMode) => void
  onSubmit: (text: string) => void
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
  const [copied, setCopied] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const lines = useLines(active)
  /** Só as últimas N linhas viram elementos na tela; rolar até o topo mostra mais */
  const [limit, setLimit] = useState(PAGE)
  const growFrom = useRef<number | null>(null)
  useEffect(() => setLimit(PAGE), [active])
  // Depois de mostrar mais linhas no topo, mantém a posição de leitura
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && growFrom.current !== null) {
      el.scrollTop += el.scrollHeight - growFrom.current
      growFrom.current = null
    }
  }, [limit])
  const inputRef = useRef<HTMLInputElement>(null)
  const stick = useRef(true)

  const tab = tabs[active]
  const runningCount = order.reduce((n, k) => n + (tabs[k]?.running.length ? 1 : 0), 0)

  useEffect(() => {
    const el = scrollRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [lines, active, open, expanded, limit])

  // Trocar de aba volta a grudar no fim
  useEffect(() => {
    stick.current = true
  }, [active])

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
    if (e.key === 'c' && e.ctrlKey && !input && tab?.running.length) {
      e.preventDefault()
      return onStopTab(active)
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

  const copyAll = async () => {
    if (!tab) return
    await window.api.copyText(lines.map((l) => l.text).join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <div
      className={cn(
        'flex shrink-0 flex-col border-t border-line bg-[#0c0c10]',
        open && expanded && 'fixed inset-0 z-40 border-t-0'
      )}
    >
      {open && (
        <div className={cn('flex min-h-0 flex-col', expanded ? 'flex-1' : 'h-[42vh] min-h-[220px]')}>
          {/* Abas */}
          <div className="flex h-9 shrink-0 items-stretch border-b border-line">
            <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
              {order.map((k) => {
                const t = tabs[k]
                if (!t) return null
                const fixed = (FIXED_TABS as readonly string[]).includes(k)
                return (
                  <div
                    key={k}
                    onClick={() => onActivate(k)}
                    onAuxClick={(e) => e.button === 1 && !fixed && onCloseTab(k)}
                    className={cn(
                      'group flex max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 border-r border-line px-3 text-xs transition-colors',
                      k === active ? 'bg-card text-zinc-100' : 'text-zinc-500 hover:bg-white/[0.03] hover:text-zinc-300'
                    )}
                    title={t.title}
                  >
                    <StatusDot t={t} />
                    <span className="truncate">{t.title}</span>
                    {t.unread && k !== active && <span className="h-1.5 w-1.5 rounded-full bg-purple" />}
                    {!fixed && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onCloseTab(k)
                        }}
                        title={t.running.length ? 'Parar e fechar' : 'Fechar aba'}
                        className="ml-0.5 cursor-pointer rounded p-0.5 opacity-0 hover:bg-white/10 group-hover:opacity-100"
                      >
                        <X size={11} />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
            <div className="flex shrink-0 items-center gap-0.5 px-2">
              {mode !== 'terminal' && active === mode && hasChat && (
                <IconButton title="Nova conversa" tone="accent" onClick={onNewChat}>
                  <MessageSquarePlus size={14} />
                </IconButton>
              )}
              {tab?.running.length ? (
                stopping ? (
                  <span className="mr-1 inline-flex items-center gap-1 text-[11px] text-amber-300">
                    <Loader2 size={11} className="animate-spin" /> Parando…
                  </span>
                ) : (
                  <IconButton title="Parar (Ctrl+C)" tone="danger" onClick={() => onStopTab(active)}>
                    <Square size={12} fill="currentColor" />
                  </IconButton>
                )
              ) : null}
              <IconButton title={copied ? 'Copiado!' : 'Copiar o log desta aba'} onClick={copyAll}>
                <ClipboardCopy size={13} className={copied ? 'text-emerald-400' : ''} />
              </IconButton>
              <IconButton title="Limpar esta aba" onClick={() => onClearTab(active)}>
                <Trash2 size={13} />
              </IconButton>
              <IconButton title={expanded ? 'Recolher' : 'Tela cheia'} onClick={onToggleExpand}>
                {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </IconButton>
              <IconButton title="Esconder terminais" onClick={onToggleOpen}>
                <ChevronDown size={15} />
              </IconButton>
            </div>
          </div>

          {/* Saída */}
          <div
            ref={scrollRef}
            onScroll={(e) => {
              const el = e.currentTarget
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
              if (el.scrollTop < 80 && lines.length > limit && growFrom.current === null) {
                growFrom.current = el.scrollHeight
                setLimit((l) => l + PAGE)
              }
            }}
            className="selectable min-h-0 flex-1 overflow-y-auto px-4 py-2 font-mono text-[12.5px] leading-relaxed"
          >
            {!tab || lines.length === 0 ? (
              <div className="pt-2 text-zinc-600">
                {active === 'console'
                  ? 'Digite um comando abaixo. Cada script e cada projeto em execução ganham uma aba própria.'
                  : active === 'claude'
                    ? 'Converse com o Claude pelo campo abaixo (modo Claude).'
                    : active === 'gemini'
                      ? 'Converse com o Gemini pelo campo abaixo (modo Gemini). Sem terminal, ele só lê e analisa.'
                      : active === 'codex'
                        ? 'Converse com o ChatGPT (Codex CLI) pelo campo abaixo (modo ChatGPT). Roda no sandbox só de leitura.'
                    : active === 'system'
                      ? 'Logs do app: Vigia, MCPs, Telegram, Remote Control.'
                      : active.startsWith('project:')
                        ? 'Clique em Executar no card, ou digite um comando abaixo: ele roda na pasta deste projeto. Com o projeto rodando, o texto vai para o processo.'
                        : 'Sem saída ainda.'}
              </div>
            ) : (
              <>
                {lines.length > limit && (
                  <div className="py-1 text-center text-[11px] text-zinc-600">
                    {lines.length - limit} linha(s) anteriores · role para cima para ver
                  </div>
                )}
                {(lines.length > limit ? lines.slice(-limit) : lines).map((l) => (
                  <LineRow key={l.id} line={l} />
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {/* Barra de input (sempre visível) */}
      <div className="flex shrink-0 items-center gap-2 border-t border-line bg-card px-3 py-2.5">
        <button
          type="button"
          onClick={onToggleOpen}
          title={open ? 'Esconder terminais' : 'Mostrar terminais e logs'}
          className={cn(
            'inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors',
            open ? 'border-violet/50 bg-violet/10 text-purple' : 'border-line bg-bg text-zinc-400 hover:text-zinc-100'
          )}
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} className="-rotate-90" />}
          Terminais
          {runningCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded bg-violet/20 px-1 text-[10px] text-purple">
              <Loader2 size={9} className="animate-spin" />
              {runningCount}
            </span>
          )}
        </button>

        <ModePicker
          mode={mode}
          onChange={(m) => {
            onModeChange(m)
            inputRef.current?.focus()
          }}
        />

        <div className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-line bg-bg px-2 text-xs text-zinc-500" title={cwdLabel}>
          <FolderTree size={12} />
          <select
            value={target}
            onChange={(e) => onTargetChange(e.target.value)}
            className="max-w-[160px] cursor-pointer bg-transparent text-xs text-zinc-300 focus:outline-none"
          >
            {targets.map((t) => (
              <option key={t.value} value={t.value} className="bg-card">
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex h-8 min-w-0 flex-1 items-center rounded-lg border border-line bg-bg px-2.5 focus-within:border-violet/70">
          {inputTarget === 'stdin' ? (
            <span className="shrink-0 rounded bg-amber-400/15 px-1 text-[10px] text-amber-300" title="O texto vai para o processo que está rodando nesta aba">
              stdin
            </span>
          ) : (
            <ChevronRight size={14} className={mode !== 'terminal' ? 'text-purple' : 'text-zinc-500'} />
          )}
          <input
            data-testid="console-input"
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            spellCheck={false}
            placeholder={
              inputTarget === 'stdin'
                ? 'Enviar texto para o processo em execução… (Ctrl+C para parar)'
                : inputTarget === 'project'
                  ? `Comando na pasta de ${tab?.title ?? 'projeto'}…`
                  : mode === 'terminal'
                ? 'Digite um comando… (Ctrl+C para parar)'
                : hasChat
                  ? `Continue a conversa com o ${mode === 'gemini' ? 'Gemini' : 'Claude'}…`
                  : mode === 'gemini'
                    ? 'Peça uma análise ao Gemini…'
                    : mode === 'codex'
                      ? 'Pergunte ao ChatGPT (só leitura, cada mensagem é uma conversa nova)…'
                    : 'Pergunte ou dê uma ordem ao Claude…'
            }
            className="h-full min-w-0 flex-1 bg-transparent px-2 font-mono text-[12.5px] text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
          />
          <IconButton title="Enviar (Enter)" tone="accent" onClick={send}>
            <SendHorizontal size={14} />
          </IconButton>
        </div>

        <StatusPill t={tab} />
      </div>
    </div>
  )
}
