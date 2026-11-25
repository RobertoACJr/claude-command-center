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
import { Button, Field, IconButton, Modal, Toggle, inputCls } from './ui'
import { cn, uid } from '../lib/utils'
import { isProdEnv } from '@shared/vars'
import { ClaudePermsEditor } from './ClaudePermsEditor'
import { Copy, SetupTab, TOOLS, type Os } from './SetupTab'
import { useAis } from '../lib/ais'
import { type SaveFn } from './settings/shared'
import { IntegrationsTab } from './settings/IntegrationsTab'
import { TelegramTab } from './settings/TelegramTab'
import { WatcherTab } from './settings/WatcherTab'
import { GeneralTab } from './settings/GeneralTab'
import { AiTab } from './settings/AiTab'
import { AutomationTab } from './settings/AutomationTab'

export type SettingsTab = 'setup' | 'general' | 'integrations' | 'ai' | 'telegram' | 'watcher' | 'automation'
type Tab = SettingsTab

export function SettingsModal({
  open,
  config,
  watcher,
  initialTab,
  focus,
  onClose
}: {
  open: boolean
  config: AppConfig
  watcher: WatcherState
  initialTab?: SettingsTab
  /** Guia a abrir no assistente (ex: 'gchat') */
  focus?: string
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('setup')
  useEffect(() => {
    if (open) setTab(initialTab ?? 'setup')
  }, [open, initialTab])
  const [sec, setSec] = useState<SecretsStatus>({ set: [], encrypted: true })

  const refreshSecrets = () => window.api.secretsStatus().then(setSec)
  useEffect(() => {
    if (open) refreshSecrets()
  }, [open])

  const save = async (patch: SettingsPatch) => {
    await window.api.saveSettings(patch)
    await refreshSecrets()
  }

  return (
    <Modal open={open} onClose={onClose} title="Configurações & Integrações" icon={<Settings size={16} />} width="max-w-3xl">
      <div className="-mt-1 flex gap-1 rounded-lg border border-line bg-bg p-1">
        {(
          [
            ['setup', 'Começar', Rocket],
            ['general', 'Geral', AppWindow],
            ['integrations', 'Integrações', Plug],
            ['ai', 'IAs', Gem],
            ['telegram', 'Telegram', Bell],
            ['watcher', 'Modo Vigia', Eye],
            ['automation', 'Automação', Workflow]
          ] as const
        ).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={cn(
              'flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium transition-colors',
              tab === id ? 'bg-violet text-white' : 'text-zinc-500 hover:text-zinc-200'
            )}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {!sec.encrypted && (
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/[0.06] p-2.5 text-xs text-amber-200">
          ⚠ O sistema não ofereceu um cofre de senhas (no Ubuntu: gnome-keyring/libsecret). Os tokens ficam salvos só
          ofuscados no seu perfil de usuário.
        </div>
      )}

      {tab === 'setup' && <SetupTab config={config} sec={sec} goTo={setTab} focus={focus} />}
      {tab === 'general' && <GeneralTab config={config} save={save} />}
      {tab === 'integrations' && <IntegrationsTab config={config} sec={sec} save={save} />}
      {tab === 'telegram' && <TelegramTab config={config} sec={sec} save={save} />}
      {tab === 'watcher' && <WatcherTab config={config} watcher={watcher} save={save} />}
      {tab === 'ai' && <AiTab config={config} save={save} />}
      {tab === 'automation' && <AutomationTab config={config} save={save} />}
    </Modal>
  )
}
