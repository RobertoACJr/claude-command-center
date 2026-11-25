// Configurações → Vigia (Google Chat)
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

export function WatcherTab({ config, watcher, save }: { config: AppConfig; watcher: WatcherState; save: SaveFn }) {
  const [w, setW] = useState(config.watcher)
  const [saved, setSaved] = useState(false)
  const ais = useAis()
  useEffect(() => setW(config.watcher), [config.watcher])

  const persist = async () => {
    await save({
      watcher: {
        enabled: w.enabled,
        autoWhenOff: w.autoWhenOff,
        intervalMin: w.intervalMin,
        focus: w.focus,
        model: w.model,
        provider: w.provider
      }
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="space-y-3">
      <Section icon={<Eye size={15} />} title="Monitorar Google Chat">
        <Field label="Quem lê o chat" hint="O Gemini faz a triagem e poupa os tokens do Claude para o desenvolvimento.">
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ['claude', 'Claude Code', 'claude -p, ferramentas só de leitura'],
                ['gemini', 'Gemini CLI', 'gemini, política só de leitura']
              ] as Array<[AiProvider, string, string]>
            )
              .filter(([p]) => p === w.provider || ais[p])
              .map(([p, label, sub]) => (
              <button
                key={p}
                type="button"
                onClick={() => setW({ ...w, provider: p })}
                className={cn(
                  'cursor-pointer rounded-lg border p-2.5 text-left transition-colors',
                  w.provider === p ? 'border-violet/70 bg-violet/10' : 'border-line bg-bg hover:border-zinc-600'
                )}
              >
                <div className="text-sm text-zinc-100">{label}</div>
                <div className="text-[11px] text-zinc-500">{sub}</div>
              </button>
            ))}
          </div>
        </Field>
        <Toggle
          checked={w.enabled}
          onChange={(v) => setW({ ...w, enabled: v })}
          label="Ligado agora"
          hint="O mesmo toggle do header."
        />
        <Toggle
          checked={w.autoWhenOff}
          onChange={(v) => setW({ ...w, autoWhenOff: v })}
          label="Ligar automaticamente quando o status estiver OFF"
        />
        <div className="grid grid-cols-[140px_1fr] gap-3">
          <Field label="Intervalo (min)">
            <input
              type="number"
              min={1}
              max={120}
              className={inputCls}
              value={w.intervalMin}
              onChange={(e) => setW({ ...w, intervalMin: Number(e.target.value) || 3 })}
            />
          </Field>
          <Field label="Modelo (opcional)" hint={w.provider === 'gemini' ? 'Vazio = padrão. Ex: flash, pro.' : 'Vazio = padrão. Ex: sonnet, haiku.'}>
            <input
              className={inputCls}
              value={w.model}
              onChange={(e) => setW({ ...w, model: e.target.value })}
              placeholder="padrão"
            />
          </Field>
        </div>
        <Field label="Focar em (opcional)" hint="Espaços, pessoas ou palavras. Vai junto no pedido ao Claude.">
          <textarea
            className={inputCls + ' min-h-[64px] text-xs'}
            value={w.focus}
            onChange={(e) => setW({ ...w, focus: e.target.value })}
            placeholder='ex: espaço "Deploys Squad X", mensagens do Fulano, palavras "subir", "homolog"'
          />
        </Field>
        <div className="flex items-center gap-2">
          <Button variant="primary" size="sm" onClick={persist}>
            {saved ? 'Salvo ✓' : 'Salvar'}
          </Button>
          <Button size="sm" disabled={watcher.phase !== 'idle'} onClick={() => window.api.watcherRunNow()}>
            Verificar agora
          </Button>
          <span className="text-xs text-zinc-500">
            {watcher.phase === 'checking' ? 'Verificando…' : watcher.reason}
            {watcher.lastResult ? ` · último: ${watcher.lastResult}` : ''}
          </span>
        </div>
      </Section>

      <div className="flex gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.05] p-3 text-xs leading-relaxed text-zinc-400">
        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-emerald-400" />
        <div>
          <b className="text-emerald-300">Regra de segurança garantida por permissão, não só por instrução.</b>{' '}
          {w.provider === 'gemini' ? (
            <>
              Cada ciclo roda o Gemini CLI sem terminal, carregando só o servidor <code>ccc-gchat</code>, com uma
              política (<code>~/.gemini/policies/claude-command-center.toml</code>) que libera só a <i>leitura</i> e
              nega o envio. Sem terminal, tudo que pediria aprovação é negado pelo próprio Gemini.
            </>
          ) : (
            <>
              Cada ciclo roda <code>claude -p</code> sem nenhuma ferramenta embutida (sem terminal, sem editar
              arquivos), com apenas as ferramentas de <i>leitura</i> do Google Chat liberadas e as de escrita
              bloqueadas.
            </>
          )}{' '}
          A IA só devolve um JSON; quem avisa o Telegram é o app. Nada roda sem você aprovar, exceto regras automáticas
          que você criar (e nunca em produção).
        </div>
      </div>
    </div>
  )
}
