// Telegram → Ligação: o CallMeBot (serviço externo, não oficial) liga para o seu Telegram e lê um aviso curto
import { useState } from 'react'
import { PhoneCall } from 'lucide-react'
import type { AppConfig, OpResult } from '@shared/types'
import { Button, Field, Toggle, inputCls } from '../ui'
import { Result, Section, type SaveFn } from './shared'

export function CallSection({ config, save }: { config: AppConfig; save: SaveFn }) {
  const c = config.telegram.call
  const [user, setUser] = useState(c.user)
  const [r, setR] = useState<OpResult | null>(null)
  const [busy, setBusy] = useState(false)
  const test = async () => {
    setBusy(true)
    if (user.trim() !== c.user) await save({ telegram: { call: { user: user.trim() } } })
    setR(await window.api.callTest())
    setBusy(false)
  }
  return (
    <Section icon={<PhoneCall size={15} />} title="Ligação pelo Telegram">
      <p className="text-[11px] text-zinc-500">
        Para o que não pode esperar: um robô liga para o seu Telegram e diz quem te chamou (ex.: “Pedido de deploy urgente de Fulano no Google Chat”). Usa o
        CallMeBot, um serviço gratuito e <b>não oficial</b>: só esse texto curto passa por ele, nunca o conteúdo das mensagens.
      </p>
      <ol className="list-decimal space-y-0.5 pl-4 text-[11px] text-zinc-400">
        <li>
          No Telegram, mande <code>/start</code> para <code>@CallMeBot_txtbot</code> (autoriza o robô a te ligar).
        </li>
        <li>Em Configurações do Telegram → Privacidade → Chamadas, deixe quem pode te ligar como “Todos” (ou adicione o robô aos contatos).</li>
        <li>Preencha seu @usuario abaixo e clique em Testar.</li>
      </ol>
      <Toggle checked={c.enabled} onChange={(v) => save({ telegram: { call: { enabled: v } } })} label="Ligar para mim" />
      <div className="flex items-end gap-2">
        <Field label="Seu @usuario do Telegram" hint="Ou o número com +55…">
          <input
            data-testid="call-user"
            className={inputCls + ' text-xs'}
            value={user}
            onChange={(e) => setUser(e.target.value)}
            onBlur={() => user.trim() !== c.user && save({ telegram: { call: { user: user.trim() } } })}
            placeholder="@seuusuario"
          />
        </Field>
        <Button size="sm" disabled={busy || !user.trim()} onClick={() => void test()}>
          <PhoneCall size={12} /> Testar
        </Button>
      </div>
      <Result r={r} />
      {c.enabled && (
        <div className="space-y-1">
          <Toggle checked={c.onUrgent} onChange={(v) => save({ telegram: { call: { onUrgent: v } } })} label="Quando um pedido vier como urgente" hint="O Vigia marca urgente quando pedem pressa (“urgente”, “agora”, “pra ontem”)." />
          <Toggle
            checked={c.onImportant}
            onChange={(v) => save({ telegram: { call: { onImportant: v } } })}
            label="Quando escrever uma pessoa ou espaço importante"
            hint="A lista fica na aba Vigia."
          />
          <Toggle checked={c.onlyAway} onChange={(v) => save({ telegram: { call: { onlyAway: v } } })} label="Só quando eu estiver Ausente" hint="No PC você já vê o aviso na tela." />
          <p className="text-[11px] text-zinc-600">No máximo uma ligação a cada 90 segundos.</p>
        </div>
      )}
    </Section>
  )
}
