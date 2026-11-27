import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppConfig,
  ConsoleMode,
  DeployAlert,
  Project,
  ProjectRunState,
  ApprovalRequest,
  RemoteSession,
  RunEvent,
  Script,
  ScriptType,
  UpdateState,
  WatcherState,
  GitInfo,
  NotificationTarget,
  Demand,
  DemandBusy,
  QueueState,
  CostGuard
} from '@shared/types'
import { Header } from '../components/Header'
import { ProjectsPanel } from '../components/ProjectsPanel'
import { ScriptsPanel, type ScriptActions } from '../components/ScriptsPanel'
import { ProjectModal } from '../components/ProjectModal'
import { ScriptModal } from '../components/ScriptModal'
import { VariablesModal } from '../components/VariablesModal'
import { SettingsModal, type SettingsTab } from '../components/SettingsModal'
import { AlertsBar } from '../components/AlertsBar'
import { AwayBanner, GoOnlineModal, VigiaBanner } from '../components/Presence'
import { setEnabledAis } from './ais'
import { dangerQuestion, isDangerous } from '@shared/danger'
import { BranchJourneyPrompt, WorklogModal } from '../components/Worklog'
import {
  FIXED_TABS,
  TerminalsPanel,
  type ConsoleLine,
  type LineKind,
  type TabState
} from '../components/TerminalsPanel'
import { ConfirmModal } from '../components/ui'
import { ApprovalModal } from '../components/ApprovalModal'
import { HistoryModal } from '../components/HistoryModal'
import { CommandPalette, type PaletteItem } from '../components/CommandPalette'
import { DemandModal, newDemand } from '../components/DemandModal'
import { lineStore } from './lineStore'
import { QueueModal } from '../components/QueueModal'
import { CostsModal } from '../components/CostsModal'
import { DailyModal } from '../components/DailyModal'
import { ShotsModal } from '../components/ShotsView'
import {
  Clock,
  Bell,
  Code2,
  Bot,
  ClipboardList,
  Camera,
  DollarSign,
  ListTodo,
  MessageSquareText,
  Eye,
  FolderPlus,
  Gem,
  History as HistoryIcon,
  Moon,
  Pencil,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Settings,
  Sparkles,
  Square,
  SquareTerminal,
  Sun
} from 'lucide-react'
import {
  extractUserVariables,
  fillVariables,
  missingProjectKeys,
  projectValues,
  resolveTargetPath,
  shortPath,
  uid
} from './utils'

type Confirm = { kind: 'project'; item: Project } | { kind: 'script'; item: Script } | null

const FIXED_TITLES: Record<string, string> = { console: 'Console', claude: 'Claude', gemini: 'Gemini', codex: 'ChatGPT', system: 'Sistema' }

function newTab(key: string, title: string): TabState {
  return { key, title, status: 'idle', exitCode: null, running: [], unread: false }
}


/** O que a paleta precisa do App para montar os itens e agir */
export interface PaletteContext {
  config: AppConfig
  away: boolean
  demands: Demand[]
  remote: Record<string, RemoteSession>
  runStates: Record<string, ProjectRunState>
  activate: (key: string, open?: boolean) => void
  focusConsole: () => void
  log: (kind: LineKind, text: string, tab?: string) => void
  showToast: (msg: string) => void
  openProjectTerminal: (projectId: string) => void
  openSettings: (tab?: SettingsTab, focus?: string) => void
  projectName: (id?: string) => string | undefined
  runScript: (s: Script, initial?: Record<string, string>) => void
  togglePresence: () => void | Promise<void>
  setConfig: (c: AppConfig) => void
  setConsoleTarget: (id: string) => void
  setMode: (m: ConsoleMode) => void
  setProjectModal: (v: { open: boolean; item: Project | null }) => void
  setScriptModal: (v: { open: boolean; item: Script | null; preset?: string }) => void
  setShotsProject: (p: Project | null) => void
  setDemandOpen: (v: { id: string } | { draft: Demand } | null) => void
  setCostsOpen: (v: boolean) => void
  setDailyOpen: (v: boolean) => void
  setHistoryOpen: (v: boolean) => void
  setQueueOpen: (v: { demandId?: string; projectId?: string } | null) => void
}

/** Itens da paleta de comandos (Ctrl+K): scripts, projetos, demandas, modos do console, janelas e configurações */
export function buildPaletteItems(ctx: PaletteContext): PaletteItem[] {
  const {
    config, away, demands, remote, runStates, activate, focusConsole, log, showToast, openProjectTerminal, openSettings,
    projectName, runScript, togglePresence, setConfig, setConsoleTarget, setMode, setProjectModal, setScriptModal,
    setShotsProject, setDemandOpen, setCostsOpen, setDailyOpen, setHistoryOpen, setQueueOpen
  } = ctx
  return [
    ...config.scripts.map((s) => ({
      id: `run:${s.id}`,
      group: 'Scripts e ações',
      label: `Rodar: ${s.name}`,
      hint: s.target.kind === 'project' ? projectName(s.target.projectId) : s.target.kind === 'ask' ? 'escolhe o projeto' : 'global',
      icon: <Play size={14} />,
      keywords: s.content.slice(0, 200),
      run: () => runScript(s)
    })),
    ...demands
      .filter((d) => d.status !== 'feita')
      .map((d) => ({
        id: `demand:${d.id}`,
        group: 'Demandas',
        label: `Demanda ${d.key}: ${d.title || d.jira?.summary || ''}`,
        hint: projectName(d.projectId),
        icon: <ClipboardList size={14} />,
        run: () => setDemandOpen({ id: d.id })
      })),
    ...config.projects.map((p) => ({
      id: `new-demand:${p.id}`,
      group: 'Demandas',
      label: `Nova demanda em: ${p.name}`,
      icon: <ClipboardList size={14} />,
      keywords: 'card jira',
      run: () => setDemandOpen({ draft: newDemand(p.id) })
    })),
    ...config.projects.flatMap((p): PaletteItem[] => {
      const st = runStates[p.id]?.state
      const running = st === 'running' || st === 'starting'
      const rc = remote[p.id]
      return [
        ...(p.runCommand
          ? [
              {
                id: `exec:${p.id}`,
                group: 'Projetos',
                label: `${running ? 'Parar' : 'Executar'}: ${p.name}`,
                hint: p.runCommand,
                icon: running ? <Square size={14} /> : <Play size={14} />,
                run: () => (running ? window.api.projectStop(p.id) : window.api.projectStart(p.id))
              }
            ]
          : []),
        {
          id: `rc:${p.id}`,
          group: 'Projetos',
          label: `${rc ? 'Desligar' : 'Ligar'} Remote Control: ${p.name}`,
          icon: <Radio size={14} />,
          keywords: 'celular remote',
          run: () => window.api.remoteSetManual(p.id, !rc)
        },
        {
          id: `claude:${p.id}`,
          group: 'Projetos',
          label: `Falar com o Claude em: ${p.name}`,
          icon: <Sparkles size={14} />,
          run: () => {
            setConsoleTarget(p.id)
            setMode('claude')
            activate('claude')
            focusConsole()
          }
        },
        {
          id: `term:${p.id}`,
          group: 'Projetos',
          label: `Terminal do projeto: ${p.name}`,
          icon: <SquareTerminal size={14} />,
          run: () => openProjectTerminal(p.id)
        },
        {
          id: `editor:${p.id}`,
          group: 'Projetos',
          label: `Abrir no editor: ${p.name}`,
          icon: <Code2 size={14} />,
          run: () => void window.api.openEditor(p.id).then((r) => !r.ok && showToast(r.message))
        },
        ...(p.kind !== 'outro'
          ? [
              {
                id: `shots:${p.id}`,
                group: 'Projetos',
                label: `${p.kind === 'back' ? 'Checar a API' : 'Telas e erros'}: ${p.name}`,
                icon: <Camera size={14} />,
                keywords: 'prints screenshot api',
                run: () => setShotsProject(p)
              }
            ]
          : []),
        {
          id: `edit:${p.id}`,
          group: 'Projetos',
          label: `Editar projeto: ${p.name}`,
          hint: 'nome, pasta, variáveis',
          icon: <Pencil size={14} />,
          run: () => setProjectModal({ open: true, item: p })
        }
      ]
    }),
    ...(
      [
        ['terminal', 'Terminal', <SquareTerminal key="t" size={14} />],
        ['claude', 'Claude', <Sparkles key="c" size={14} />],
        ['gemini', 'Gemini', <Gem key="g" size={14} />],
        ['codex', 'ChatGPT', <Bot key="o" size={14} />]
      ] as const
    )
      .filter(([m]) => m === 'terminal' || config.ui.ais[m])
      .map(([m, label, icon]) => ({
      id: `mode:${m}`,
      group: 'Console',
      label: `Digitar para: ${label}`,
      hint: config.ui.consoleMode === m ? 'atual' : undefined,
      icon,
      keywords: 'modo console',
      run: () => {
        setMode(m)
        activate(m === 'terminal' ? 'console' : m)
        focusConsole()
      }
    })),
    {
      id: 'presence',
      group: 'App',
      label: away ? 'Voltar ao PC (Online)' : 'Ir para o modo Ausente',
      icon: away ? <Sun size={14} /> : <Moon size={14} />,
      run: togglePresence
    },
    {
      id: 'watcher',
      group: 'App',
      label: config.watcher.enabled ? 'Desligar o Vigia' : 'Ligar o Vigia (Google Chat)',
      icon: <Eye size={14} />,
      run: async () => setConfig(await window.api.setWatcherEnabled(!config.watcher.enabled))
    },
    {
      id: 'watcher-now',
      group: 'App',
      label: 'Verificar o Google Chat agora',
      icon: <Eye size={14} />,
      run: () => window.api.watcherRunNow()
    },
    { id: 'daily', group: 'App', label: 'Resumo para a daily', icon: <MessageSquareText size={14} />, keywords: 'daily standup ontem hoje', run: () => setDailyOpen(true) },
    {
      id: 'jira-sync',
      group: 'App',
      label: 'Sincronizar demandas com o Jira',
      hint: 'finaliza aqui as concluídas lá',
      icon: <RefreshCw size={14} />,
      keywords: 'jira status sincronizar finalizar',
      run: async () => showToast((await window.api.jiraSync()).message)
    },
    { id: 'worklog', group: 'App', label: 'Jornadas: tempo em cada demanda', icon: <Clock size={14} />, keywords: 'jornada horas tempo timesheet worklog', run: () => window.dispatchEvent(new CustomEvent('helice:open-worklog')) },
    { id: 'sync', group: 'App', label: 'Sincronizar entre PCs agora', icon: <RefreshCw size={14} />, keywords: 'sync windows ubuntu', run: async () => {
      const r = await window.api.syncNow()
      if (r.ok) log('success', `[Sincronizar] ${r.message}`)
      else showToast(r.message)
    } },
    { id: 'queue', group: 'App', label: 'Fila de tarefas do Claude', icon: <ListTodo size={14} />, keywords: 'fila tarefas', run: () => setQueueOpen({}) },
    { id: 'costs', group: 'App', label: 'Gastos com IA', icon: <DollarSign size={14} />, keywords: 'custos limite dinheiro', run: () => setCostsOpen(true) },
    { id: 'history', group: 'App', label: 'Histórico de execuções', icon: <HistoryIcon size={14} />, keywords: 'log', run: () => setHistoryOpen(true) },
    {
      id: 'notifs',
      group: 'App',
      label: 'Notificações',
      icon: <Bell size={14} />,
      run: () => (document.querySelector('[data-testid="notif-bell"]') as HTMLButtonElement | null)?.click()
    },
    { id: 'new-project', group: 'App', label: 'Novo projeto', icon: <FolderPlus size={14} />, run: () => setProjectModal({ open: true, item: null }) },
    {
      id: 'new-action',
      group: 'App',
      label: 'Nova ação global',
      icon: <Plus size={14} />,
      run: () => setScriptModal({ open: true, item: null, preset: 'ask' })
    },
    { id: 'update', group: 'App', label: 'Procurar atualização', icon: <RefreshCw size={14} />, run: () => window.api.checkForUpdates() },
    ...(
      [
        ['setup', 'Começar (programas e guias)'],
        ['general', 'Geral (janela, notificações, atualizações)'],
        ['integrations', 'Integrações (GitHub, Jira, Google Chat)'],
        ['ai', 'IAs (permissões do Claude, Gemini, ChatGPT)'],
        ['telegram', 'Telegram'],
        ['watcher', 'Vigia'],
        ['automation', 'Automação (respostas e regras)']
      ] as const
    ).map(([tab, label]) => ({
      id: `settings:${tab}`,
      group: 'Configurações',
      label: `Configurações: ${label}`,
      icon: <Settings size={14} />,
      run: () => openSettings(tab)
    }))
  ]}
