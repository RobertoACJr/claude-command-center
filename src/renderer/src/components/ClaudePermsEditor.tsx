import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import type { ClaudeMode, ClaudePerms } from '@shared/types'
import { Button, inputCls } from './ui'
import { cn } from '../lib/utils'

const MODES: Array<[ClaudeMode, string, string]> = [
  ['ask', 'Perguntar', 'Abre uma janela no app (e no Telegram, se Ausente) para o que não estiver liberado'],
  ['edits', 'Pode editar arquivos', 'Edita arquivos sem perguntar; comandos ainda perguntam'],
  ['readonly', 'Só leitura', 'Bloqueia tudo que precisaria de permissão, sem perguntar']
]

/** Modo de permissão do Claude + regras "sempre permitir" (projeto ou Global) */
export function ClaudePermsEditor({ value, onChange }: { value: ClaudePerms; onChange: (v: ClaudePerms) => void }) {
  const [rule, setRule] = useState('')
  const add = () => {
    const r = rule.trim()
    if (!r || value.allowedTools.includes(r)) return
    onChange({ ...value, allowedTools: [...value.allowedTools, r] })
    setRule('')
  }
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        {MODES.map(([m, label, sub]) => (
          <button
            key={m}
            type="button"
            onClick={() => onChange({ ...value, claudeMode: m })}
            className={cn(
              'cursor-pointer rounded-lg border p-2 text-left transition-colors',
              value.claudeMode === m ? 'border-violet/70 bg-violet/10' : 'border-line bg-bg hover:border-zinc-600'
            )}
          >
            <div className="text-xs font-medium text-zinc-100">{label}</div>
            <div className="text-[10px] leading-snug text-zinc-500">{sub}</div>
          </button>
        ))}
      </div>
      <div className="text-[11px] text-zinc-500">
        Sempre permitido (sem perguntar): {value.allowedTools.length === 0 && <i>nada ainda</i>}
      </div>
      <div className="flex flex-wrap gap-1">
        {value.allowedTools.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded border border-line bg-bg px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">
            {t}
            <button
              type="button"
              className="cursor-pointer text-zinc-500 hover:text-red-400"
              title="Remover"
              onClick={() => onChange({ ...value, allowedTools: value.allowedTools.filter((x) => x !== t) })}
            >
              <X size={11} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className={inputCls + ' h-8 py-0 font-mono text-xs'}
          value={rule}
          onChange={(e) => setRule(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          placeholder="ex: Bash(git status:*), Bash(npm test:*), Edit, WebFetch(domain:github.com)"
        />
        <Button size="sm" className="shrink-0" disabled={!rule.trim()} onClick={add}>
          <Plus size={12} /> Adicionar
        </Button>
      </div>
    </div>
  )
}
