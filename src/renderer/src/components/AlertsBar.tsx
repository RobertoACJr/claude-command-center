import { useState } from 'react'
import { BellRing, Check, ChevronDown, ChevronUp, ExternalLink, Play, Send, X } from 'lucide-react'
import type { DeployAlert, Script } from '@shared/types'
import { Button, IconButton } from './ui'
import { cn } from '../lib/utils'

export function AlertsBar({
  alerts,
  scripts,
  onApprove,
  onDismiss,
  onApproveAndRun,
  onClearResolved
}: {
  alerts: DeployAlert[]
  scripts: Script[]
  onApprove: (a: DeployAlert) => void
  onDismiss: (a: DeployAlert) => void
  onApproveAndRun: (a: DeployAlert, s: Script) => void
  onClearResolved: () => void
}) {
  const [open, setOpen] = useState(true)
  const pending = alerts.filter((a) => a.status === 'pending')
  const resolved = alerts.length - pending.length
  if (alerts.length === 0) return null

  return (
    <div className="mx-4 mb-3 shrink-0 rounded-xl border border-amber-400/30 bg-amber-400/[0.04]">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center justify-between px-4 py-2.5 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-amber-200">
          <BellRing size={15} className={pending.length ? 'animate-pulse' : ''} />
          {pending.length
            ? `${pending.length} pedido(s) de deploy aguardando sua aprovação`
            : 'Nenhum pedido pendente'}
        </span>
        <span className="flex items-center gap-2 text-xs text-zinc-500">
          {resolved > 0 && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation()
                onClearResolved()
              }}
              className="rounded px-1.5 py-0.5 hover:bg-white/5 hover:text-zinc-300"
            >
              limpar {resolved} resolvido(s)
            </span>
          )}
          {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>

      {open && (
        <div className="max-h-56 space-y-2 overflow-y-auto px-3 pb-3">
          {[...alerts].reverse().map((a) => (
            <AlertCard
              key={a.id}
              a={a}
              scripts={scripts}
              onApprove={onApprove}
              onDismiss={onDismiss}
              onApproveAndRun={onApproveAndRun}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function AlertCard({
  a,
  scripts,
  onApprove,
  onDismiss,
  onApproveAndRun
}: {
  a: DeployAlert
  scripts: Script[]
  onApprove: (a: DeployAlert) => void
  onDismiss: (a: DeployAlert) => void
  onApproveAndRun: (a: DeployAlert, s: Script) => void
}) {
  const [scriptId, setScriptId] = useState('')
  const pending = a.status === 'pending'
  const chip = (label: string, v: string) =>
    v ? (
      <span className="rounded-md border border-line bg-bg px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">
        <span className="text-zinc-600">{label} </span>
        {v}
      </span>
    ) : null

  return (
    <div
      className={cn(
        'rounded-lg border p-3',
        pending ? 'border-line bg-card' : 'border-line/60 bg-card/50 opacity-60'
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-zinc-100">
            <b>{a.requester || 'Alguém'}</b>
            <span className="text-zinc-500"> pediu </span>
            {a.card || a.branch || 'um deploy'}
            {a.environment && (
              <>
                <span className="text-zinc-500"> → </span>
                <span className="text-amber-200">{a.environment}</span>
              </>
            )}
          </div>
          {a.summary && <div className="selectable mt-0.5 text-xs text-zinc-400">{a.summary}</div>}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {chip('card', a.card)}
            {chip('branch', a.branch)}
            {chip('env', a.environment)}
            {a.space && <span className="text-[11px] text-zinc-600">#{a.space}</span>}
            <span className="text-[11px] text-zinc-600">
              {a.messageTime || new Date(a.createdAt).toLocaleString()}
            </span>
            {a.telegram === 'sent' && (
              <span className="inline-flex items-center gap-0.5 text-[11px] text-sky-400" title="Avisado no Telegram">
                <Send size={10} /> Telegram
              </span>
            )}
            {a.telegram === 'failed' && <span className="text-[11px] text-red-400">Telegram falhou</span>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {a.link && (
            <IconButton title="Abrir mensagem" onClick={() => window.api.openExternal(a.link)}>
              <ExternalLink size={13} />
            </IconButton>
          )}
          {!pending && (
            <span className={cn('text-xs', a.status === 'approved' ? 'text-emerald-400' : 'text-zinc-500')}>
              {a.status === 'approved' ? 'Aprovado' : 'Descartado'}
            </span>
          )}
        </div>
      </div>

      {pending && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
          <select
            value={scriptId}
            onChange={(e) => setScriptId(e.target.value)}
            className="h-7 max-w-[220px] cursor-pointer rounded-md border border-line bg-bg px-2 text-xs text-zinc-300 focus:outline-none"
          >
            <option value="">Escolher script para executar…</option>
            {scripts.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="primary"
            disabled={!scriptId}
            onClick={() => {
              const s = scripts.find((x) => x.id === scriptId)
              if (s) onApproveAndRun(a, s)
            }}
          >
            <Play size={12} /> Aprovar e executar
          </Button>
          <Button size="sm" onClick={() => onApprove(a)}>
            <Check size={12} /> Só aprovar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onDismiss(a)}>
            <X size={12} /> Descartar
          </Button>
        </div>
      )}
    </div>
  )
}
