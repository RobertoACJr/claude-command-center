import { useEffect, useState } from 'react'
import { Check, Copy, MessageSquareText, RefreshCw } from 'lucide-react'
import { Button, Modal } from './ui'

/** Resumo para a daily: ontem / hoje / impedimentos, montado das demandas, fila e histórico */
export function DailyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState('')
  const [copied, setCopied] = useState(false)
  const load = () => window.api.daily().then(setText)
  useEffect(() => {
    if (open) {
      setCopied(false)
      load()
    }
  }, [open])
  return (
    <Modal open={open} onClose={onClose} title="Resumo para a daily" icon={<MessageSquareText size={16} />} width="max-w-2xl">
      <p className="text-[11px] text-zinc-500">
        Montado do que aconteceu no app no último dia útil (demandas, fila, scripts) e das demandas abertas. Edite à vontade
        antes de copiar. No Telegram: /daily.
      </p>
      <textarea
        data-testid="daily-text"
        rows={16}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="w-full rounded-lg border border-line bg-bg px-3 py-2 font-mono text-xs text-zinc-200 outline-none focus:border-violet/60"
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" onClick={load}>
          <RefreshCw size={12} /> Gerar de novo
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={async () => {
            await window.api.copyText(text)
            setCopied(true)
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copiado' : 'Copiar'}
        </Button>
      </div>
    </Modal>
  )
}
