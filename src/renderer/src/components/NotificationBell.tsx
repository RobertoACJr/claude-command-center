import { useEffect, useRef, useState } from 'react'
import { Bell, CheckCheck, Trash2 } from 'lucide-react'
import type { AppNotification, NotificationKind, NotificationTarget } from '@shared/types'
import { cn } from '../lib/utils'

const KIND_LABEL: Record<NotificationKind, string> = {
  pedido: 'Pedido',
  permissao: 'Permissão',
  projeto: 'Projeto',
  script: 'Script',
  atualizacao: 'Atualização',
  vigia: 'Vigia',
  remote: 'Remote',
  demanda: 'Demanda',
  sistema: 'App'
}

function ago(at: number) {
  const s = Math.round((Date.now() - at) / 1000)
  if (s < 60) return 'agora'
  if (s < 3600) return `${Math.floor(s / 60)} min`
  if (s < 86400) return `${Math.floor(s / 3600)} h`
  return new Date(at).toLocaleDateString()
}

/** Sino com a central de notificações do app (as últimas 100 desde que o app abriu). */
export function NotificationBell({ onGo }: { onGo: (t: NotificationTarget) => void }) {
  const [items, setItems] = useState<AppNotification[]>([])
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    window.api.notifications().then(setItems)
    return window.api.onNotification((n) => setItems((l) => [n, ...l].slice(0, 100)))
  }, [])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const unread = items.filter((n) => !n.read).length
  const markRead = () => {
    window.api.markNotificationsRead()
    setItems((l) => l.map((n) => ({ ...n, read: true })))
  }

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        data-testid="notif-bell"
        onClick={() => {
          setOpen(!open)
          if (open && unread) markRead()
        }}
        title="Notificações"
        className="relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-line bg-card text-zinc-400 transition-colors hover:border-violet/60 hover:text-white"
      >
        <Bell size={16} />
        {unread > 0 && (
          <span
            data-testid="notif-badge"
            className="absolute -top-1.5 -right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white"
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          data-testid="notif-panel"
          className="absolute top-full right-0 z-50 mt-2 w-[360px] overflow-hidden rounded-xl border border-line bg-card shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-xs font-semibold text-zinc-200">Notificações</span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={markRead}
                title="Marcar todas como lidas"
                className="cursor-pointer rounded p-1 text-zinc-500 hover:bg-white/5 hover:text-white"
              >
                <CheckCheck size={14} />
              </button>
              <button
                type="button"
                onClick={() => {
                  window.api.clearNotifications()
                  setItems([])
                }}
                title="Limpar"
                className="cursor-pointer rounded p-1 text-zinc-500 hover:bg-white/5 hover:text-white"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          <div className="max-h-[420px] overflow-y-auto overflow-x-hidden">
            {items.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-zinc-500">
                Nada por aqui. Pedidos do Google Chat, permissões do Claude, scripts que terminam, projetos que caem e
                atualizações aparecem aqui.
              </p>
            )}
            {items.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => {
                  if (n.target) onGo(n.target)
                  setOpen(false)
                  markRead()
                }}
                className={cn(
                  'flex w-full min-w-0 cursor-pointer flex-col gap-0.5 border-b border-line/60 px-3 py-2 text-left hover:bg-white/5',
                  !n.read && 'bg-violet/5'
                )}
              >
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-zinc-500">
                  {!n.read && <span className="h-1.5 w-1.5 rounded-full bg-violet" />}
                  {KIND_LABEL[n.kind]} · {ago(n.at)}
                </div>
                <div className="text-xs font-medium text-zinc-100 [overflow-wrap:anywhere]">{n.title}</div>
                <div className="text-[11px] text-zinc-400 [overflow-wrap:anywhere]">{n.body}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
