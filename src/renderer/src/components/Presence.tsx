import { useEffect, useState } from 'react'
import { Eye, EyeOff, Loader2, Moon, Radio, RefreshCw, Sun } from 'lucide-react'
import type { RemoteSession, WatcherState } from '@shared/types'
import { Button, Modal } from './ui'
import { fmtDuration } from '../lib/utils'

/** Faixa do Vigia ligado com você Online: magenta, com o próximo giro e o último resultado */
export function VigiaBanner({ watcher, onRunNow, onTurnOff }: { watcher: WatcherState; onRunNow: () => void; onTurnOff: () => void }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!watcher.nextAt) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [watcher.nextAt])
  const left = watcher.nextAt ? Math.max(0, Math.round((watcher.nextAt - now) / 1000)) : null
  const checking = watcher.phase === 'checking'
  const blocked = watcher.phase === 'blocked'
  return (
    <div data-testid="vigia-banner" className="flex shrink-0 items-center justify-between gap-3 border-b border-violet/40 bg-violet/15 px-5 py-2 text-xs">
      <div className="flex min-w-0 items-center gap-2 text-zinc-300">
        {checking ? <Loader2 size={14} className="animate-spin text-purple" /> : <Eye size={14} className="text-purple" />}
        <b className="shrink-0 text-purple">Vigia de plantão</b>
        <span className="truncate text-zinc-400">
          {blocked
            ? `bloqueado: ${watcher.reason}`
            : checking
              ? 'olhando o Google Chat agora…'
              : left !== null
                ? `próxima olhada em ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
                : watcher.reason}
          {watcher.lastResult ? ` · último: ${watcher.lastResult}` : ''}
        </span>
      </div>
      <div className="flex shrink-0 gap-1.5">
        <Button size="sm" disabled={checking || blocked} onClick={onRunNow}>
          <RefreshCw size={12} /> Olhar agora
        </Button>
        <Button size="sm" variant="ghost" onClick={onTurnOff}>
          <EyeOff size={12} /> Desligar
        </Button>
      </div>
    </div>
  )
}

/** Faixa do modo Ausente: deixa claro que o app está em "piloto automático" */
export function AwayBanner({
  since,
  watcher,
  remoteActive,
  onBack
}: {
  since: number
  watcher: WatcherState
  remoteActive: number
  onBack: () => void
}) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])
  const watcherOn = watcher.phase === 'idle' || watcher.phase === 'checking'
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-violet/40 bg-violet/15 px-5 py-2 text-xs">
      <div className="flex items-center gap-2 text-zinc-300">
        <Moon size={14} className="text-purple" />
        <b className="text-purple">Modo ausente</b>
        <span className="text-zinc-500">
          desde {new Date(since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (há{' '}
          {fmtDuration(Date.now() - since)})
        </span>
        <span className="text-zinc-600">·</span>
        <span className={watcherOn ? 'text-zinc-300' : 'text-zinc-500'}>
          Vigia {watcherOn ? 'ativo' : watcher.phase === 'blocked' ? 'bloqueado' : 'desligado'}
        </span>
        <span className="text-zinc-600">·</span>
        <span className="inline-flex items-center gap-1 text-zinc-300">
          <Radio size={11} /> {remoteActive} sessão(ões) remota(s)
        </span>
      </div>
      <Button size="sm" variant="primary" onClick={onBack}>
        <Sun size={12} /> Voltar ao PC
      </Button>
    </div>
  )
}

/** Voltando para Online com sessões remotas abertas: encerrar ou manter? */
export function GoOnlineModal({
  open,
  sessions,
  onClose,
  onChoose
}: {
  open: boolean
  sessions: RemoteSession[]
  onClose: () => void
  onChoose: (keepRemote: boolean) => void
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Voltar ao PC"
      icon={<Sun size={16} />}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={() => onChoose(true)}>
            Manter ligadas
          </Button>
          <Button variant="primary" onClick={() => onChoose(false)}>
            Encerrar sessões
          </Button>
        </>
      }
    >
      <p className="text-sm text-zinc-400">
        {sessions.length === 1 ? 'Há 1 sessão' : `Há ${sessions.length} sessões`} de Remote Control abertas. Quer
        encerrar agora ou manter? Você pode desligar cada uma depois pelo card do projeto.
      </p>
      <ul className="space-y-1">
        {sessions.map((s) => (
          <li key={s.projectId} className="flex items-center gap-2 text-xs text-zinc-300">
            <Radio size={11} className="text-emerald-400" /> {s.projectName}
          </li>
        ))}
      </ul>
    </Modal>
  )
}
