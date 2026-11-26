// Configurações → IAs → Claude: modelo, esforço, economia automática, teto da janela, aviso de ritmo e linha de status
import { useState } from 'react'
import { Gauge } from 'lucide-react'
import type { AppConfig, ClaudeEffort, ClaudeModel, OpResult } from '@shared/types'
import { Field, inputCls } from '../ui'
import { HelpTip, Result, Section, Switch, type SaveFn } from './shared'

const MODELS: Array<[ClaudeModel, string]> = [
  ['', 'Padrão do Claude Code'],
  ['opus', 'Opus (mais capaz)'],
  ['sonnet', 'Sonnet (equilíbrio)'],
  ['haiku', 'Haiku (rápido e barato)'],
  ['fable', 'Fable']
]
const EFFORTS: Array<[ClaudeEffort, string]> = [
  ['', 'Padrão'],
  ['low', 'Baixo'],
  ['medium', 'Médio'],
  ['high', 'Alto'],
  ['xhigh', 'Muito alto'],
  ['max', 'Máximo']
]

function Pick<T extends string>({ value, options, onChange, testId }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; testId?: string }) {
  return (
    <select data-testid={testId} className={inputCls + ' text-xs'} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map(([v, l]) => (
        <option key={v || 'padrao'} value={v}>
          {l}
        </option>
      ))}
    </select>
  )
}

export function ClaudeUsage({ config, save }: { config: AppConfig; save: SaveFn }) {
  const ai = config.ai
  const [cap, setCap] = useState(String(ai.sessionCapPct))
  const [pace, setPace] = useState(String(ai.paceWarnPct))
  const [result, setResult] = useState<OpResult | null>(null)
  const [busy, setBusy] = useState(false)

  const toggleStatusLine = async (on: boolean) => {
    if (on && !window.confirm(STATUSLINE_CONFIRM)) return
    setBusy(true)
    try {
      const r = await window.api.statuslineSet(on)
      setResult(r)
      if (r.ok) await save({ ai: { statusLine: on } })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section icon={<Gauge size={15} />} title="Claude: modelo, esforço e limite de uso">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Modelo" hint="Vale para tudo que o app manda o Claude fazer (fila, demandas, console, Telegram).">
          <Pick testId="claude-model" value={ai.claudeModel} options={MODELS} onChange={(v) => save({ ai: { claudeModel: v } })} />
        </Field>
        <Field label="Esforço" hint="Quanto o Claude pensa antes de agir. Mais esforço = melhor resultado e mais uso do limite.">
          <Pick testId="claude-effort" value={ai.claudeEffort} options={EFFORTS} onChange={(v) => save({ ai: { claudeEffort: v } })} />
        </Field>
      </div>

      <div className="rounded-lg border border-line bg-bg/50 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-sm text-zinc-100">
              Economia automática
              <HelpTip>
                Tarefas leves usam o modelo e o esforço abaixo: análise, desenho, revisão, plano por fases, o Vigia e as fases
                marcadas como leves. Implementação (fila, demanda, console) continua com o modelo de cima.
              </HelpTip>
            </div>
            <div className="text-[11px] text-zinc-500">Poupa a janela de 5h nas tarefas que não precisam do modelo mais forte.</div>
          </div>
          <Switch checked={ai.economy} onChange={(v) => save({ ai: { economy: v } })} />
        </div>
        {ai.economy && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Modelo das tarefas leves">
              <Pick value={ai.lightModel} options={MODELS} onChange={(v) => save({ ai: { lightModel: v } })} />
            </Field>
            <Field label="Esforço das tarefas leves">
              <Pick value={ai.lightEffort} options={EFFORTS} onChange={(v) => save({ ai: { lightEffort: v } })} />
            </Field>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Teto da janela de 5h (%)" hint="A fila e as fases param ao chegar aqui e voltam sozinhas depois do reset. 100 = até estourar.">
          <input
            type="number"
            min={10}
            max={100}
            className={inputCls + ' text-xs'}
            value={cap}
            onChange={(e) => setCap(e.target.value)}
            onBlur={() => save({ ai: { sessionCapPct: Math.max(10, Math.min(100, Number(cap) || 90)) } })}
          />
        </Field>
        <Field label="Aviso de ritmo (%)" hint="Avisa (sino, sistema e Telegram no Ausente) quando a janela passar disso, com o tempo até resetar. 0 = nunca.">
          <input
            type="number"
            min={0}
            max={100}
            className={inputCls + ' text-xs'}
            value={pace}
            onChange={(e) => setPace(e.target.value)}
            onBlur={() => save({ ai: { paceWarnPct: Math.max(0, Math.min(100, Number(pace) || 0)) } })}
          />
        </Field>
      </div>

      <div className="rounded-lg border border-line bg-bg/50 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-1.5 text-sm text-zinc-100">
              Ler o uso também das sessões no terminal
              <HelpTip>
                Liga a "linha de status" do Claude Code: a cada resposta das sessões interativas, o Claude manda o uso da
                janela para um script do Hélice, que grava em ~/.claude/helice-limits.json. Mexe só na chave statusLine do
                ~/.claude/settings.json (com backup em settings.json.helice-bak); se você já tinha uma linha de status, ela
                continua aparecendo. Desligar restaura como estava.
              </HelpTip>
            </div>
            <div className="text-[11px] text-zinc-500">
              Sem isso, o app só sabe o uso pelas tarefas que ele mesmo roda. Só funciona nos planos Pro/Max.
            </div>
          </div>
          <Switch checked={ai.statusLine} disabled={busy} onChange={(v) => void toggleStatusLine(v)} />
        </div>
        <Result r={result} />
      </div>
    </Section>
  )
}

const STATUSLINE_CONFIRM = [
  'Ligar a linha de status do Claude Code?',
  '',
  '• Muda só a chave "statusLine" do ~/.claude/settings.json (o resto fica igual; backup em settings.json.helice-bak).',
  '• Se você já tinha uma linha de status, ela continua aparecendo (o script do Hélice repassa para ela).',
  '• O script só grava o uso da janela, o modelo e a pasta em ~/.claude/helice-limits.json. Nada de senha ou token.',
  '• Afeta só a barra de baixo das sessões interativas do Claude Code. Desligar aqui restaura como estava.'
].join('\n')
