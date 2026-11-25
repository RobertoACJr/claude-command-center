// Configurações → Automação (respostas prontas e regras)
import { useEffect, useState, type ReactNode } from 'react'
import { AppWindow, ArrowLeftRight, CheckCircle2, CircleHelp, Clock, Bell, Bot, Eye, Gem, Github, KeyRound, Loader2, MessageSquare, MessageSquareReply, Pencil, Plug, Plus, RefreshCw, Rocket, Search, Send, Settings, ShieldCheck, SquareKanban, Trash2, Workflow, X, XCircle, Zap } from 'lucide-react'
import type {
  AiId,
  AiProvider,
  ToolCheck,
  AppConfig,
  AutomationRule,
  ReplyTemplate,
  RuleMode,
  IntegrationCheck,
  SyncStatus,
  IntegrationId,
  OpResult,
  SecretKey,
  SecretsStatus,
  SettingsPatch,
  UpdateState,
  WatcherState
} from '@shared/types'
import { Button, Field, IconButton, Modal, Toggle, inputCls } from '../ui'
import { cn, uid } from '../../lib/utils'
import { isProdEnv } from '@shared/vars'
import { ClaudePermsEditor } from '../ClaudePermsEditor'
import { Copy, SetupTab, TOOLS, type Os } from '../SetupTab'
import { useAis } from '../../lib/ais'
import { HelpTip, Section, SecretInput, Result, useBusy, Spin, CHECK_STYLE, fmtWhen, CheckList, CheckBadge, Switch, IconBtn, type SaveFn } from './shared'

export const MODE_LABEL: Record<RuleMode, string> = {
  suggest: 'Só sugerir o script no pedido',
  telegram: 'Botão "Aprovar e rodar" no Telegram',
  auto: 'Rodar sozinho ao detectar'
}

export function AutomationTab({ config, save }: { config: AppConfig; save: SaveFn }) {
  const [replies, setReplies] = useState<ReplyTemplate[]>(config.replies)
  const [rules, setRules] = useState<AutomationRule[]>(config.rules)
  const [saved, setSaved] = useState(false)

  const persist = async () => {
    await save({
      replies: replies.filter((r) => r.name.trim() && r.text.trim()),
      rules: rules.filter((r) => r.name.trim() && r.scriptId)
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const setReply = (i: number, patch: Partial<ReplyTemplate>) => setReplies((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const setRule = (i: number, patch: Partial<AutomationRule>) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  return (
    <div className="space-y-3">
      <Section
        icon={<MessageSquareReply size={15} />}
        title="Respostas cadastradas"
        right={
          <Button size="sm" onClick={() => setReplies((rs) => [...rs, { id: uid(), name: '', text: '', autoOnDetect: false }])}>
            <Plus size={12} /> Resposta
          </Button>
        }
      >
        <p className="text-xs text-zinc-500">
          Enviadas na conversa do pedido. Variáveis: <code className="text-purple">{'{{solicitante}} {{card}} {{branch}} {{ambiente}} {{projeto}}'}</code>.
          O envio usa o Claude com só a ferramenta de enviar mensagem liberada; o texto é montado pelo app.
        </p>
        {replies.map((r, i) => (
          <div key={r.id} className="space-y-2 rounded-lg border border-line bg-bg p-2.5">
            <div className="flex items-center gap-2">
              <input className={inputCls + ' flex-1'} value={r.name} onChange={(e) => setReply(i, { name: e.target.value })} placeholder="Nome (ex: Recebido)" />
              <IconBtn title="Remover" onClick={() => setReplies((rs) => rs.filter((_, j) => j !== i))} />
            </div>
            <textarea className={inputCls + ' min-h-[56px] text-xs'} value={r.text} onChange={(e) => setReply(i, { text: e.target.value })} placeholder="Texto da mensagem" />
            <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
              <input type="checkbox" checked={r.autoOnDetect} onChange={(e) => setReply(i, { autoOnDetect: e.target.checked })} />
              Enviar sozinha assim que o pedido for detectado
            </label>
          </div>
        ))}
      </Section>

      <Section
        icon={<Workflow size={15} />}
        title="Regras"
        right={
          <Button
            size="sm"
            onClick={() =>
              setRules((rs) => [
                ...rs,
                { id: uid(), name: '', enabled: true, environments: 'beta', projectId: '', scriptId: '', mode: 'suggest', replyOnApproveId: '' }
              ])
            }
          >
            <Plus size={12} /> Regra
          </Button>
        }
      >
        <p className="text-xs text-zinc-500">
          Quando um pedido casar com o ambiente (e projeto) da regra, o app liga o script a ele. A primeira regra que casar
          vale. <b className="text-zinc-300">Trava fixa:</b> ambientes que parecem produção (prod, produção, prd, live,
          main, master) nunca rodam sozinhos nem pelo Telegram, só aprovando no PC.
        </p>
        {rules.map((r, i) => {
          const prodWarn = r.mode !== 'suggest' && r.environments.split(',').some((e) => isProdEnv(e) || e.trim() === '*')
          return (
            <div key={r.id} className="space-y-2 rounded-lg border border-line bg-bg p-2.5">
              <div className="flex items-center gap-2">
                <input type="checkbox" checked={r.enabled} onChange={(e) => setRule(i, { enabled: e.target.checked })} title="Ativa" />
                <input className={inputCls + ' flex-1'} value={r.name} onChange={(e) => setRule(i, { name: e.target.value })} placeholder="Nome (ex: Beta automático)" />
                <IconBtn title="Remover" onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Ambientes">
                  <input className={inputCls + ' text-xs'} value={r.environments} onChange={(e) => setRule(i, { environments: e.target.value })} placeholder="beta, homolog (* = qualquer)" />
                </Field>
                <Field label="Projeto">
                  <select className={inputCls + ' text-xs'} value={r.projectId} onChange={(e) => setRule(i, { projectId: e.target.value })}>
                    <option value="">Qualquer (o do pedido)</option>
                    {config.projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Script">
                  <select className={inputCls + ' text-xs'} value={r.scriptId} onChange={(e) => setRule(i, { scriptId: e.target.value })}>
                    <option value="">Escolha…</option>
                    {config.scripts.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="O que fazer">
                  <select className={inputCls + ' text-xs'} value={r.mode} onChange={(e) => setRule(i, { mode: e.target.value as RuleMode })}>
                    {(Object.keys(MODE_LABEL) as RuleMode[]).map((m) => (
                      <option key={m} value={m}>
                        {MODE_LABEL[m]}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <Field label="Resposta ao aprovar">
                <select className={inputCls + ' text-xs'} value={r.replyOnApproveId} onChange={(e) => setRule(i, { replyOnApproveId: e.target.value })}>
                  <option value="">Nenhuma</option>
                  {replies.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name || '(sem nome)'}
                    </option>
                  ))}
                </select>
              </Field>
              {prodWarn && (
                <div className="text-[11px] text-amber-300">
                  ⚠ Pedidos de produção casam com esta regra, mas nunca vão rodar sozinhos/pelo Telegram: só aprovando no PC.
                </div>
              )}
            </div>
          )
        })}
      </Section>

      <div className="flex justify-end">
        <Button variant="primary" onClick={persist}>
          {saved ? 'Salvo ✓' : 'Salvar respostas e regras'}
        </Button>
      </div>
    </div>
  )
}
