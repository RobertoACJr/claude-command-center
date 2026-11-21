import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, CheckCircle2, CircleSlash, ListTodo, Loader2, Pause, Play, RotateCcw, Trash2, XCircle } from 'lucide-react'
import type { AppConfig, Demand, QueueState, QueueTask } from '@shared/types'
import { cn } from '../lib/utils'
import { Button, Modal, Toggle } from './ui'

const STATUS: Record<QueueTask['status'], { label: string; cls: string }> = {
  pendente: { label: 'Na fila', cls: 'text-zinc-400' },
  rodando: { label: 'Rodando', cls: 'text-purple' },
  feita: { label: 'Feita', cls: 'text-emerald-300' },
  falhou: { label: 'Falhou', cls: 'text-red-300' },
  cancelada: { label: 'Cancelada', cls: 'text-zinc-500' }
}

function Icon({ s }: { s: QueueTask['status'] }) {
  if (s === 'rodando') return <Loader2 size={14} className="animate-spin text-purple" />
  if (s === 'feita') return <CheckCircle2 size={14} className="text-emerald-400" />
  if (s === 'falhou') return <XCircle size={14} className="text-red-400" />
  if (s === 'cancelada') return <CircleSlash size={14} className="text-zinc-500" />
  return <ListTodo size={14} className="text-zinc-500" />
}

const fmt = (t?: number) => (t ? new Date(t).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')

/** Fila de tarefas para o Claude: uma por vez, de preferência quando você está Ausente */
export function QueueModal({
  open,
  onClose,
  config,
  demands,
  queue,
  preset,
  onSaveSettings,
  onOpenTerminal
}: {
  open: boolean
  onClose: () => void
  config: AppConfig
  demands: Demand[]
  queue: QueueState
  /** Abrir já com a demanda escolhida */
  preset?: { demandId?: string; projectId?: string } | null
  onSaveSettings: (q: Partial<AppConfig['queue']>) => void
  onOpenTerminal: (t: QueueTask) => void
}) {
  // alvo: "d:<id>" demanda · "p:<id>" projeto
  const [target, setTarget] = useState('')
  const [prompt, setPrompt] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setMsg(null)
    if (preset?.demandId) setTarget(`d:${preset.demandId}`)
    else if (preset?.projectId) setTarget(`p:${preset.projectId}`)
    else if (!target) {
      const d = demands.find((x) => x.status !== 'feita')
      setTarget(d ? `d:${d.id}` : config.projects[0] ? `p:${config.projects[0].id}` : '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preset])

  const name = (t: QueueTask) => {
    const d = t.demandId ? demands.find((x) => x.id === t.demandId) : undefined
    const p = config.projects.find((x) => x.id === t.projectId)
    return d ? `${d.key} · ${p?.name ?? ''}` : (p?.name ?? '?')
  }

  const add = async () => {
    const [kind, id] = target.split(':')
    const d = kind === 'd' ? demands.find((x) => x.id === id) : undefined
    const r = await window.api.queueAdd({ projectId: d ? d.projectId : id, demandId: d?.id, prompt })
    setMsg(r)
    if (r.ok) setPrompt('')
  }

  const pend = queue.tasks.filter((t) => t.status === 'pendente')
  const running = queue.tasks.find((t) => t.status === 'rodando')
  const done = queue.tasks.filter((t) => t.status !== 'pendente' && t.status !== 'rodando').slice().reverse()
  const q = config.queue

  return (
    <Modal open={open} onClose={onClose} title="Fila de tarefas do Claude" icon={<ListTodo size={16} />} width="max-w-4xl">
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-bg/50 px-3 py-2">
        <Toggle
          checked={q.onlyAway}
          onChange={(v) => onSaveSettings({ onlyAway: v })}
          label="Só quando eu estiver Ausente"
          hint="Desligado: começa assim que a tarefa entra na fila."
        />
        <Toggle
          checked={q.useWorktree}
          onChange={(v) => onSaveSettings({ useWorktree: v })}
          label="Tarefas de demanda numa cópia separada"
          hint="O Claude trabalha em outra pasta (git worktree), sem mexer na sua. O trabalho vira commits em fila/WEB-123."
        />
        <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={() => onSaveSettings({ paused: !q.paused })}>
            {q.paused ? <Play size={12} /> : <Pause size={12} />} {q.paused ? 'Retomar' : 'Pausar'}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={!pend.length || !!running || q.paused}
            data-testid="queue-run-now"
            onClick={async () => setMsg(await window.api.queueRunNow())}
          >
            <Play size={12} /> Rodar agora
          </Button>
        </div>
      </div>
      {queue.waiting && pend.length > 0 && !running && <p className="text-[11px] text-amber-300">{queue.waiting}</p>}

      <div className="space-y-2 rounded-xl border border-line bg-bg/50 p-3">
        <div className="grid grid-cols-[minmax(0,260px)_minmax(0,1fr)] gap-2">
          <select
            data-testid="queue-target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="h-9 rounded-lg border border-line bg-bg px-2 text-xs text-zinc-200 outline-none focus:border-violet/60"
          >
            <optgroup label="Demandas (na branch e na conversa dela)">
              {demands
                .filter((d) => d.status !== 'feita')
                .map((d) => (
                  <option key={d.id} value={`d:${d.id}`}>
                    {d.key} · {(d.title || d.jira?.summary || '').slice(0, 40)}
                  </option>
                ))}
            </optgroup>
            <optgroup label="Projetos (conversa nova)">
              {config.projects.map((p) => (
                <option key={p.id} value={`p:${p.id}`}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          </select>
          <textarea
            data-testid="queue-prompt"
            rows={2}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && prompt.trim()) {
                e.preventDefault()
                add()
              }
            }}
            placeholder="O que o Claude deve fazer? Ex: ajustar o filtro no mobile e cobrir com teste (Ctrl+Enter)"
            className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-violet/60"
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-zinc-500">
            Uma tarefa por vez. Sem commit nem push; pedidos de permissão chegam no Telegram quando você está Ausente.
          </span>
          <Button size="sm" variant="primary" disabled={!prompt.trim() || !target} onClick={add} data-testid="queue-add">
            Pôr na fila
          </Button>
        </div>
        {msg && <p className={cn('text-[11px]', msg.ok ? 'text-emerald-300' : 'text-amber-300')}>{msg.message}</p>}
      </div>

      <div data-testid="queue-list" className="space-y-1.5">
        {[...(running ? [running] : []), ...pend, ...done].map((t) => {
          const i = pend.indexOf(t)
          const expanded = openId === t.id
          return (
            <div key={t.id} className="rounded-lg border border-line bg-bg/60">
              <div className="flex min-w-0 items-center gap-2 px-3 py-2">
                <Icon s={t.status} />
                <button type="button" className="min-w-0 flex-1 cursor-pointer text-left" onClick={() => setOpenId(expanded ? null : t.id)}>
                  <div className="truncate text-xs text-zinc-200">
                    <span className="font-mono text-purple">{name(t)}</span> · {t.prompt}
                  </div>
                  <div className="text-[10px] text-zinc-500">
                    <span className={STATUS[t.status].cls}>{t.phase === 'verificando' ? 'Verificando' : STATUS[t.status].label}</span>
                    {t.check && (
                      <span className={t.check.ok ? 'text-emerald-300' : 'text-red-300'}>
                        {' · '}
                        {t.check.ok ? 'verificação ok' : t.phase === 'verificando' ? '' : 'verificação falhou'}
                      </span>
                    )}
                    {t.startedAt ? ` · começou ${fmt(t.startedAt)}` : ` · criada ${fmt(t.createdAt)}`}
                    {t.endedAt ? ` · terminou ${fmt(t.endedAt)}` : ''}
                    {t.costUsd ? ` · US$ ${t.costUsd.toFixed(2)}` : ''}
                    {t.origin === 'telegram' ? ' · via Telegram' : ''}
                  </div>
                </button>
                {t.status === 'pendente' && (
                  <>
                    <button type="button" title="Subir" disabled={i <= 0} onClick={() => window.api.queueMove(t.id, -1)} className="cursor-pointer p-1 text-zinc-500 hover:text-white disabled:opacity-30">
                      <ArrowUp size={13} />
                    </button>
                    <button type="button" title="Descer" disabled={i >= pend.length - 1} onClick={() => window.api.queueMove(t.id, 1)} className="cursor-pointer p-1 text-zinc-500 hover:text-white disabled:opacity-30">
                      <ArrowDown size={13} />
                    </button>
                  </>
                )}
                {t.status === 'rodando' && (
                  <Button size="sm" onClick={() => onOpenTerminal(t)}>
                    ver ao vivo
                  </Button>
                )}
                {(t.status === 'pendente' || t.status === 'rodando') && (
                  <button type="button" title="Cancelar" onClick={() => window.api.queueCancel(t.id)} className="cursor-pointer p-1 text-zinc-500 hover:text-red-300">
                    <XCircle size={14} />
                  </button>
                )}
                {(t.status === 'falhou' || t.status === 'cancelada') && (
                  <button type="button" title="Tentar de novo" onClick={() => window.api.queueRetry(t.id)} className="cursor-pointer p-1 text-zinc-500 hover:text-white">
                    <RotateCcw size={13} />
                  </button>
                )}
                {t.status !== 'pendente' && t.status !== 'rodando' && (
                  <button type="button" title="Remover" onClick={() => window.api.queueRemove(t.id)} className="cursor-pointer p-1 text-zinc-500 hover:text-white">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              {expanded && (t.summary || t.error || t.check) && (
                <pre className="selectable max-h-60 overflow-y-auto border-t border-line px-3 py-2 font-sans text-[11px] whitespace-pre-wrap text-zinc-300 [overflow-wrap:anywhere]">
                  {t.error ? `⚠ ${t.error}\n\n` : ''}
                  {t.summary}
                  {t.check && t.phase !== 'verificando'
                    ? `\n\n${t.check.ok ? '✔' : '✖'} ${t.check.command}\n${t.check.output}`
                    : ''}
                </pre>
              )}
            </div>
          )
        })}
        {!queue.tasks.length && <p className="py-6 text-center text-xs text-zinc-500">Fila vazia.</p>}
      </div>
      {done.length > 0 && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => window.api.queueClearDone()}>
            <Trash2 size={12} /> Limpar terminadas
          </Button>
        </div>
      )}
    </Modal>
  )
}
