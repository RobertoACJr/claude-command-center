// Configurações → Geral: editor do botão "Abrir no editor" e o que avisa onde
import { useEffect, useState } from 'react'
import { BellRing, Code2 } from 'lucide-react'
import type { AppConfig, EditorInfo, NotificationKind, NotifyPref } from '@shared/types'
import { Field, inputCls } from '../ui'
import { cn } from '../../lib/utils'
import { Section, Switch, type SaveFn } from './shared'

const KINDS: Array<{ id: NotificationKind; label: string; hint: string; ownTelegram?: boolean }> = [
  { id: 'pedido', label: 'Pedidos do Google Chat', hint: 'O Vigia achou um pedido', ownTelegram: true },
  { id: 'permissao', label: 'Permissões do Claude', hint: 'O Claude pediu para usar uma ferramenta', ownTelegram: true },
  { id: 'vigia', label: 'Vigia', hint: 'Perguntas, menções e pessoas importantes' },
  { id: 'demanda', label: 'Demandas', hint: 'Análise, desenho, revisão e fases prontas; Jira' },
  { id: 'fila', label: 'Fila', hint: 'Tarefas da fila terminaram' },
  { id: 'projeto', label: 'Projetos', hint: 'Caiu, erro no log, porta ocupada' },
  { id: 'script', label: 'Scripts', hint: 'Um script terminou' },
  { id: 'custos', label: 'Uso e gastos', hint: 'Ritmo do Claude, limite de gastos' },
  { id: 'remote', label: 'Remote Control', hint: 'Sessão abriu ou caiu' },
  { id: 'atualizacao', label: 'Atualizações do app', hint: 'Versão nova pronta' },
  { id: 'sistema', label: 'Outros', hint: 'Avisos gerais do app' }
]
const TG: Array<[NotifyPref['telegram'], string]> = [
  ['nunca', 'Nunca'],
  ['ausente', 'Ausente'],
  ['sempre', 'Sempre']
]

export function EditorSection({ config, save }: { config: AppConfig; save: SaveFn }) {
  const g = config.general
  const [list, setList] = useState<EditorInfo[] | null>(null)
  const [cmd, setCmd] = useState(g.editorCommand)
  useEffect(() => void window.api.editors().then(setList), [])
  const found = list?.filter((e) => e.found) ?? []
  return (
    <Section icon={<Code2 size={15} />} title="Editor">
      <Field label="Abrir projetos e arquivos com" hint="Botão Editor no card do projeto e cliques na tela de mudanças (abre o arquivo na linha).">
        <select data-testid="editor-pick" className={inputCls + ' text-xs'} value={g.editor} onChange={(e) => save({ general: { editor: e.target.value } })}>
          <option value="">Automático (o primeiro encontrado{found[0] ? `: ${found[0].label}` : ''})</option>
          {(list ?? []).map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
              {e.found ? '' : ' (não encontrado)'}
            </option>
          ))}
          <option value="custom">Outro (comando próprio)</option>
        </select>
      </Field>
      {g.editor === 'custom' && (
        <Field label="Comando" hint="Use {pasta}, {arquivo} e {linha}. Ex.: nvim-qt {arquivo} +{linha}">
          <input className={inputCls + ' font-mono text-xs'} value={cmd} onChange={(e) => setCmd(e.target.value)} onBlur={() => save({ general: { editorCommand: cmd.trim() } })} />
        </Field>
      )}
      {list && !found.length && g.editor !== 'custom' && (
        <p className="text-[11px] text-zinc-500">
          Não achei nenhum editor no PATH. No VS Code ou Cursor, abra a paleta (Ctrl+Shift+P) e rode “Shell Command: Install 'code' command in PATH”; nos
          da JetBrains, ligue os “Shell scripts” no Toolbox.
        </p>
      )}
    </Section>
  )
}

export function NotifySection({ config, save }: { config: AppConfig; save: SaveFn }) {
  const g = config.general
  const set = (k: NotificationKind, patch: Partial<NotifyPref>) => save({ general: { notify: { ...g.notify, [k]: { ...g.notify[k], ...patch } } } })
  return (
    <Section icon={<BellRing size={15} />} title="O que avisa onde">
      <p className="text-[11px] text-zinc-500">
        Tudo sempre chega no sino do app. Aqui você escolhe, por tipo, se aparece também no canto da tela e se vai para o Telegram (nunca, só quando
        você está Ausente, ou sempre).{!config.telegram.forwardNotifications && ' O repasse para o Telegram está desligado na aba Telegram.'}
      </p>
      <div className="overflow-hidden rounded-lg border border-line" data-testid="notify-matrix">
        <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 border-b border-line bg-bg/60 px-3 py-1.5 text-[11px] text-zinc-500">
          <span>Aviso</span>
          <span className="w-14 text-center">Sistema</span>
          <span className="w-[168px] text-center">Telegram</span>
        </div>
        {KINDS.map((k) => {
          const pref = g.notify[k.id]
          return (
            <div key={k.id} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 border-b border-line/60 px-3 py-1.5 last:border-0">
              <div className="min-w-0">
                <div className="text-xs text-zinc-200">{k.label}</div>
                <div className="truncate text-[11px] text-zinc-500">{k.hint}</div>
              </div>
              <div className="flex w-14 justify-center">
                <Switch checked={pref.desktop && g.desktopNotifications} disabled={!g.desktopNotifications} onChange={(v) => set(k.id, { desktop: v })} />
              </div>
              {k.ownTelegram ? (
                <span className="w-[168px] text-center text-[11px] text-zinc-500" title="Já chega no Telegram com os botões próprios (aprovar, responder…)">
                  mensagem própria
                </span>
              ) : (
                <div className="inline-flex w-[168px] overflow-hidden rounded-lg border border-line" role="radiogroup" aria-label={`Telegram: ${k.label}`}>
                  {TG.map(([v, l]) => (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={pref.telegram === v}
                      onClick={() => set(k.id, { telegram: v })}
                      className={cn('flex-1 cursor-pointer py-1 text-[11px]', pref.telegram === v ? 'bg-violet/20 text-white' : 'text-zinc-400 hover:text-white')}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Section>
  )
}
