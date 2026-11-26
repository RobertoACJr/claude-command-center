import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '../lib/utils'

type Variant = 'primary' | 'ghost' | 'outline' | 'danger'

export function Button({
  variant = 'outline',
  size = 'md',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'md' }) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors',
        'disabled:pointer-events-none disabled:opacity-40 cursor-pointer',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet/60',
        size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3.5 text-sm',
        variant === 'primary' &&
          'bg-gradient-to-b from-purple to-violet text-white shadow-[0_0_18px_-6px_var(--color-purple)] hover:brightness-110',
        variant === 'outline' && 'border border-line bg-card-2 text-zinc-200 hover:border-violet/60 hover:text-white',
        variant === 'ghost' && 'text-zinc-400 hover:bg-white/5 hover:text-zinc-100',
        variant === 'danger' && 'border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20',
        className
      )}
    />
  )
}

export function IconButton({
  title,
  tone = 'default',
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { title: string; tone?: 'default' | 'danger' | 'accent' }) {
  return (
    <button
      {...props}
      title={title}
      aria-label={title}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-md text-zinc-500 transition-colors cursor-pointer',
        tone === 'default' && 'hover:bg-white/5 hover:text-zinc-100',
        tone === 'danger' && 'hover:bg-red-500/10 hover:text-red-400',
        tone === 'accent' && 'hover:bg-violet/15 hover:text-purple',
        className
      )}
    />
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  hint
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-line bg-card-2 p-3">
      <span>
        <span className="block text-sm text-zinc-200">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-zinc-500">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors',
          checked ? 'bg-violet' : 'bg-zinc-700'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
            checked ? 'left-[18px]' : 'left-0.5'
          )}
        />
      </button>
    </label>
  )
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="block text-xs font-medium uppercase tracking-wider text-zinc-500">{label}</span>
      {children}
      {hint && <div className="text-xs text-zinc-500">{hint}</div>}
    </div>
  )
}

export const inputCls =
  'w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 ' +
  'focus:border-violet/70 focus:outline-none focus:ring-2 focus:ring-violet/20'

export function Modal({
  open,
  title,
  icon,
  onClose,
  children,
  footer,
  width = 'max-w-lg'
}: {
  open: boolean
  title: string
  icon?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  width?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={cn('animate-modal w-full rounded-2xl border border-line bg-card shadow-2xl', width)}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
            {icon && <span className="text-purple">{icon}</span>}
            {title}
          </div>
          <IconButton title="Fechar" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = 'Excluir',
  onConfirm,
  onClose
}: {
  open: boolean
  title: string
  message: ReactNode
  confirmLabel?: string
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      width="max-w-sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm text-zinc-400">{message}</p>
    </Modal>
  )
}

/** Estado vazio: ocupa toda a altura da lista, com o texto centralizado */
export function EmptyState({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="flex h-full min-h-48 flex-col items-center justify-center rounded-xl border border-dashed border-line px-6 py-12 text-center">
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-violet/10 text-purple">{icon}</div>
      <div className="text-sm font-medium text-zinc-300">{title}</div>
      <div className="mt-1 max-w-xs text-xs text-zinc-500">{text}</div>
    </div>
  )
}
