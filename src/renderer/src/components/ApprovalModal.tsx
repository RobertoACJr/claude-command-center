import { useState } from 'react'
import { Infinity as InfinityIcon, ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react'
import type { ApprovalDecision, ApprovalRequest } from '@shared/types'
import { Button, Modal } from './ui'

/** Janela "O Claude quer…": um pedido por vez, na ordem em que chegaram */
export function ApprovalModal({
  queue,
  onRespond
}: {
  queue: ApprovalRequest[]
  onRespond: (id: string, d: ApprovalDecision) => void
}) {
  const r = queue[0]
  const [showDetail, setShowDetail] = useState(false)
  if (!r) return null
  const answer = (d: ApprovalDecision) => {
    setShowDetail(false)
    onRespond(r.id, d)
  }
  return (
    <Modal
      open
      onClose={() => answer('deny')}
      title={`O Claude pede permissão · ${r.scopeName}`}
      icon={<ShieldAlert size={16} />}
      width="max-w-2xl"
      footer={
        <>
          {queue.length > 1 && <span className="mr-auto self-center text-xs text-zinc-500">+{queue.length - 1} na fila</span>}
          <Button variant="ghost" onClick={() => answer('deny')}>
            <ShieldX size={14} /> Negar
          </Button>
          <Button onClick={() => answer('always')} title={`Grava a regra ${r.rule} em ${r.scopeName}`}>
            <InfinityIcon size={14} /> Sempre permitir
          </Button>
          <Button variant="primary" onClick={() => answer('allow')} autoFocus>
            <ShieldCheck size={14} /> Permitir uma vez
          </Button>
        </>
      }
    >
      <div className="text-sm text-zinc-300">
        Ferramenta: <b className="text-zinc-100">{r.toolName}</b>
      </div>
      <pre className="selectable max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-line bg-bg p-3 font-mono text-xs text-zinc-200">
        {r.summary || '(sem detalhes)'}
      </pre>
      <div className="text-xs text-zinc-500">
        "Sempre permitir" grava a regra <code className="text-purple">{r.rule}</code> em <b>{r.scopeName}</b> (dá para
        remover depois no cadastro do projeto ou em Configurações → IAs). Sem resposta em 10 minutos, o pedido é negado.
      </div>
      <button type="button" className="cursor-pointer text-xs text-zinc-500 underline" onClick={() => setShowDetail(!showDetail)}>
        {showDetail ? 'Esconder' : 'Ver'} a entrada completa
      </button>
      {showDetail && (
        <pre className="selectable max-h-48 overflow-auto rounded-lg border border-line bg-bg p-3 font-mono text-[11px] text-zinc-400">
          {r.detail}
        </pre>
      )}
    </Modal>
  )
}
