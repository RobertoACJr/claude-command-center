// Configurações → Telegram
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
import { CallSection } from './CallSection'
import { HelpTip, Section, SecretInput, Result, useBusy, Spin, CHECK_STYLE, fmtWhen, CheckList, CheckBadge, Switch, IconBtn, type SaveFn } from './shared'

export function TranscribeField({ config, save }: { config: AppConfig; save: SaveFn }) {
  const [cmd, setCmd] = useState(config.telegram.transcribeCommand)
  useEffect(() => setCmd(config.telegram.transcribeCommand), [config.telegram.transcribeCommand])
  const presets: Array<[string, string]> = [
    ['Whisper (local, grátis)', 'whisper {{arquivo}} --language pt --model small --output_format txt --output_dir .'],
    ['faster-whisper (mais rápido)', 'whisper-ctranslate2 {{arquivo}} --language pt --model small --output_format txt --output_dir .'],
    ['Gemini CLI', 'gemini -p "Transcreva este áudio em português. Responda só com o texto falado." @{{arquivo}}']
  ]
  return (
    <Field
      label="Áudio: comando de transcrição"
      hint={
        <>
          Mande áudio para o bot: ele transcreve com este comando, mostra o texto e você confirma antes de virar ordem.{' '}
          <code>{'{{arquivo}}'}</code> vira o caminho do áudio. O Whisper roda no seu PC (instale com{' '}
          <code>pip install openai-whisper</code> e tenha o ffmpeg). Vazio = áudio desligado.
        </>
      }
    >
      <div className="flex gap-2">
        <input data-testid="transcribe-cmd" className={inputCls + ' font-mono text-xs'} value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="whisper {{arquivo}} --language pt …" />
        <Button size="sm" disabled={cmd.trim() === config.telegram.transcribeCommand} onClick={() => save({ telegram: { transcribeCommand: cmd.trim() } })}>
          Salvar
        </Button>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {presets.map(([label, c]) => (
          <button key={label} type="button" onClick={() => setCmd(c)} className="cursor-pointer rounded-md border border-line px-2 py-0.5 text-[11px] text-zinc-400 hover:border-violet/50 hover:text-zinc-200">
            {label}
          </button>
        ))}
      </div>
    </Field>
  )
}

/** Sincronizar configuração e demandas entre PCs por um repositório git privado */

export function TelegramTab({ config, sec, save }: { config: AppConfig; sec: SecretsStatus; save: SaveFn }) {
  const [token, setToken] = useState('')
  const [chatId, setChatId] = useState(config.telegram.chatId)
  const [result, setResult] = useState<OpResult | null>(null)
  const { busy, run } = useBusy()
  const isSet = sec.set.includes('telegram.token')

  const persist = async () => {
    await save({ telegram: { chatId: chatId.trim() }, secrets: token ? { 'telegram.token': token.trim() } : {} })
    setToken('')
  }

  return (
    <div className="space-y-3">
    <Section icon={<Send size={15} />} title="Notificações no celular via Telegram">
      <ol className="list-decimal space-y-0.5 pl-4 text-xs text-zinc-500">
        <li>
          No Telegram, fale com o <b className="text-zinc-300">@BotFather</b>, mande <code>/newbot</code> e copie o token.
        </li>
        <li>Abra o seu bot novo e mande qualquer mensagem (ex: "oi").</li>
        <li>Cole o token aqui e clique em "Detectar" para preencher o Chat ID.</li>
      </ol>
      <Field label="Bot Token">
        <SecretInput
          isSet={isSet}
          value={token}
          onChange={setToken}
          onClear={() => save({ secrets: { 'telegram.token': null } })}
          placeholder="123456789:AA…"
        />
      </Field>
      <Field label="Chat ID">
        <div className="flex gap-2">
          <input
            className={inputCls + ' font-mono'}
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            placeholder="ex: 123456789"
          />
          <Button
            className="shrink-0"
            disabled={!!busy || (!isSet && !token)}
            onClick={() =>
              run('detect', async () => {
                await persist()
                const r = await window.api.telegramDetectChat()
                setResult(r)
                if (r.ok && r.data?.chatId) {
                  setChatId(r.data.chatId)
                  await save({ telegram: { chatId: r.data.chatId } })
                }
              })
            }
          >
            <Spin on={busy === 'detect'} /> <Search size={13} /> Detectar
          </Button>
        </div>
      </Field>
      <div className="flex gap-2">
        <Button variant="primary" size="sm" disabled={!!busy} onClick={() => run('save', persist)}>
          <Spin on={busy === 'save'} /> Salvar
        </Button>
        <Button
          size="sm"
          disabled={!!busy || !chatId || (!isSet && !token)}
          onClick={() =>
            run('test', async () => {
              await persist()
              setResult(await window.api.telegramTest())
            })
          }
        >
          <Spin on={busy === 'test'} /> <Zap size={12} /> Testar Notificação
        </Button>
      </div>
      <Result r={result} />
      <Toggle
        checked={config.telegram.interactive}
        onChange={(v) => save({ telegram: { interactive: v } })}
        label="Botões e comandos no Telegram"
        hint="Pedidos chegam com Aprovar / Descartar. Comandos: /projetos, /rodar, /claude, /log, /historico, /status, /pendentes, /ausente, /online, /vigia (mande /ajuda no bot). Só o seu Chat ID é obedecido."
      />
      <Toggle
        checked={config.telegram.weeklyReport}
        onChange={(v) => save({ telegram: { weeklyReport: v } })}
        label="Relatório da semana toda sexta às 17h"
        hint="Horas em cada demanda, estimado x registrado. Também dá para pedir a qualquer hora com /semana."
      />
      <Toggle
        checked={config.telegram.forwardNotifications}
        onChange={(v) => save({ telegram: { forwardNotifications: v } })}
        label="Repassar avisos do sino para o Telegram"
        hint="O que vai e quando (nunca, só Ausente, sempre) você escolhe por tipo em Geral → O que avisa onde. Pedidos e permissões já chegam sempre."
      />
      <TranscribeField config={config} save={save} />
    </Section>
    <CallSection config={config} save={save} />
    </div>
  )
}
