// Configurações → Geral (bandeja, avisos, jornadas, sincronização, atualizações)
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

export function SyncSection({ config, save }: { config: AppConfig; save: SaveFn }) {
  const [st, setSt] = useState<SyncStatus | null>(null)
  const [url, setUrl] = useState(config.sync.repoUrl)
  useEffect(() => {
    window.api.syncStatus().then(setSt)
    return window.api.onSync(setSt)
  }, [])
  useEffect(() => setUrl(config.sync.repoUrl), [config.sync.repoUrl])
  return (
    <Section
      icon={<RefreshCw size={15} />}
      title="Sincronizar entre PCs"
      help={
        <>
          Mantém igual no Ubuntu e no Windows: projetos, scripts, ações, regras, respostas, preferências e demandas. Usa um
          repositório git <b>privado</b> seu (crie um vazio no GitHub, ex: helice-sync). <b>Não vão</b> tokens e senhas (cada PC
          tem os seus), histórico, gastos e fila. A pasta de cada projeto é guardada por PC.
        </>
      }
    >
      <Field label="Repositório (privado)" hint="Ex: git@github.com:RobertoACJr/helice-sync.git ou https://github.com/RobertoACJr/helice-sync.git (usa o login do git deste PC).">
        <div className="flex gap-2">
          <input data-testid="sync-url" className={inputCls + ' font-mono text-xs'} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="git@github.com:voce/helice-sync.git" />
          <Button size="sm" onClick={() => save({ sync: { repoUrl: url.trim() } })} disabled={url.trim() === config.sync.repoUrl}>
            Salvar
          </Button>
        </div>
      </Field>
      <Toggle
        checked={config.sync.enabled}
        onChange={(v) => save({ sync: { enabled: v } })}
        label="Sincronizar sozinho (ao abrir e a cada 15 min)"
        hint={st ? `Este PC aparece no repositório como "${st.machine}".` : undefined}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" disabled={!config.sync.repoUrl || st?.running} onClick={() => window.api.syncNow()}>
          {st?.running ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Sincronizar agora
        </Button>
        {st?.lastAt && (
          <span className={cn('text-[11px]', st.ok ? 'text-zinc-400' : 'text-red-300')}>
            {new Date(st.lastAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })} · {st.lastResult}
          </span>
        )}
      </div>
    </Section>
  )
}

/** Bolinha "?" que mostra uma explicação ao passar o mouse */

export function GeneralTab({ config, save }: { config: AppConfig; save: SaveFn }) {
  const g = config.general
  const [up, setUp] = useState<UpdateState | null>(null)
  const [io, setIo] = useState<OpResult | null>(null)
  useEffect(() => {
    window.api.updateState().then(setUp)
    return window.api.onUpdateState(setUp)
  }, [])
  const upText = !up
    ? '…'
    : {
        idle: 'Ainda não verificado.',
        disabled: up.message ?? 'Desligada.',
        checking: 'Procurando…',
        none: `Você está na versão mais nova${up.checkedAt ? ` (verificado às ${new Date(up.checkedAt).toLocaleTimeString()})` : ''}.`,
        downloading: `Baixando a versão ${up.version ?? ''}… ${up.percent ?? 0}%`,
        ready: `Versão ${up.version} pronta para instalar.`,
        error: up.message ?? 'Erro.'
      }[up.phase]

  return (
    <div className="space-y-3">
      <Section icon={<AppWindow size={15} />} title="Janela e sistema">
        <Toggle
          checked={g.closeToTray}
          onChange={(v) => save({ general: { closeToTray: v } })}
          label="Fechar a janela mantém o app rodando na bandeja"
          hint="O Vigia, o Remote Control e os projetos em execução continuam. Para encerrar tudo, use Sair no menu do ícone ao lado do relógio."
        />
        <Toggle
          checked={g.openAtLogin}
          onChange={(v) => save({ general: { openAtLogin: v } })}
          label="Abrir junto com o sistema"
          hint="Abre escondido na bandeja. Só funciona no app instalado (não no npm run dev)."
        />
      </Section>

      <Section icon={<Bell size={15} />} title="Notificações">
        <p className="text-[11px] text-zinc-500">
          Tudo fica no sino 🔔 no topo do app (pedidos do Google Chat, permissões do Claude, scripts, projetos que caem,
          Remote Control e atualizações). Aqui você escolhe o que também aparece no canto da tela.
        </p>
        <Toggle
          checked={g.desktopNotifications}
          onChange={(v) => save({ general: { desktopNotifications: v } })}
          label="Mostrar também como notificação do sistema"
          hint="Pedidos de deploy e projetos que caem aparecem sempre; o resto só quando você não está olhando o app."
        />
        <Toggle
          checked={g.notifyScriptDone}
          onChange={(v) => save({ general: { notifyScriptDone: v } })}
          label="Avisar quando um script terminar"
          hint="Com sucesso ou falha. Clicar leva para a aba do script."
        />
      </Section>

      <Section icon={<Clock size={15} />} title="Jornadas">
        <p className="text-xs text-zinc-400">
          O cronômetro de cada demanda pausa sozinho quando você fica Ausente e depois de um tempo sem mexer no PC (o tempo parado não conta).
        </p>
        <Field label="Pausar depois de (minutos sem mexer no PC)" hint="0 = nunca pausar por inatividade.">
          <input
            className={inputCls + ' w-28 font-mono text-xs'}
            defaultValue={String(g.idlePauseMin)}
            inputMode="numeric"
            onBlur={(e) => save({ general: { idlePauseMin: Math.max(0, Math.min(240, Number(e.target.value.replace(/\D/g, '')) || 0)) } })}
          />
        </Field>
      </Section>

      <SyncSection config={config} save={save} />

      <Section icon={<RefreshCw size={15} />} title={`Atualizações · versão ${up?.current ?? ''}`}>
        <p className="text-xs text-zinc-400">{upText}</p>
        <p className="text-[11px] text-zinc-500">
          O app procura versões novas nas Releases do GitHub a cada 4 horas e baixa sozinho, mas só instala quando você
          mandar (ou ao sair pelo menu da bandeja). No Ubuntu (.deb), a instalação pede sua senha.
        </p>
        <div className="flex gap-2">
          <Button size="sm" disabled={!up || ['disabled', 'checking', 'downloading'].includes(up.phase)} onClick={() => window.api.checkForUpdates()}>
            Verificar agora
          </Button>
          {up?.phase === 'ready' && (
            <Button size="sm" variant="primary" onClick={() => window.api.installUpdate()}>
              Reiniciar e atualizar
            </Button>
          )}
        </div>
      </Section>

      <Section icon={<ArrowLeftRight size={15} />} title="Levar a configuração para outro PC">
        <p className="text-xs text-zinc-500">
          Exporta projetos, scripts, ações, regras, respostas e preferências para um arquivo .json (sem tokens). No outro PC,
          importe e depois ajuste as pastas dos projetos e cadastre os tokens de novo.
        </p>
        <div className="flex gap-2">
          <Button size="sm" onClick={async () => setIo(await window.api.exportConfig())}>
            Exportar…
          </Button>
          <Button size="sm" onClick={async () => setIo(await window.api.importConfig())}>
            Importar…
          </Button>
        </div>
        <Result r={io} />
      </Section>
    </div>
  )
}
