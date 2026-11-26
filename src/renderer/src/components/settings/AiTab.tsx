// Configurações → IAs (quais usar, Claude, Gemini, ChatGPT)
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
import { ClaudeUsage } from './ClaudeUsage'
import { HelpTip, Section, SecretInput, Result, useBusy, Spin, CHECK_STYLE, fmtWhen, CheckList, CheckBadge, Switch, IconBtn, type SaveFn } from './shared'

export const AI_ROWS: Array<{ id: AiId; name: string; what: string }> = [
  { id: 'claude', name: 'Claude', what: 'Desenvolvimento, demandas, fila, Remote Control, Vigia e respostas no chat' },
  { id: 'gemini', name: 'Gemini', what: 'Análises, revisão e Vigia (poupa o limite do Claude)' },
  { id: 'codex', name: 'ChatGPT (Codex)', what: 'Análise, desenho e revisão de demandas, console só leitura' }
]

/**
 * Escolha simples: liga/desliga cada IA neste PC e mostra se ela está instalada e logada.
 * Desligada, a IA some dos seletores (console, scripts, demandas, revisão, Vigia).
 */
export function AiPicker({ config }: { config: AppConfig }) {
  const [checks, setChecks] = useState<ToolCheck[] | null>(null)
  const [checking, setChecking] = useState(false)
  const [os, setOs] = useState<Os>('linux')
  const [home, setHome] = useState('')
  const check = async () => {
    setChecking(true)
    try {
      setChecks(await window.api.checkTools())
    } finally {
      setChecking(false)
    }
  }
  useEffect(() => {
    void window.api.platform().then(setOs)
    void window.api.homeDir().then(setHome)
    void check()
  }, [])
  const ais = config.ui.ais
  const onCount = AI_ROWS.filter((r) => ais[r.id]).length

  return (
    <div className="rounded-xl border border-line bg-card-2" data-testid="ai-picker">
      <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
        <div>
          <div className="text-sm font-semibold text-zinc-100">Quais IAs o Hélice usa neste PC</div>
          <div className="text-[11px] text-zinc-500">Desligada, a IA some de todos os seletores. Vale só para este computador.</div>
        </div>
        <Button size="sm" onClick={check} disabled={checking}>
          {checking ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Verificar
        </Button>
      </div>
      <div className="divide-y divide-line">
        {AI_ROWS.map((r) => {
          const c = checks?.find((x) => x.id === r.id)
          const tool = TOOLS.find((t) => t.id === r.id)
          const install = tool?.install[os]
          const on = ais[r.id]
          return (
            <div key={r.id} className="flex items-start gap-3 px-4 py-3">
              <div className="mt-0.5">
                {!checks ? (
                  <Loader2 size={15} className="animate-spin text-zinc-500" />
                ) : c?.installed ? (
                  <CheckCircle2 size={15} className="text-purple" />
                ) : (
                  <XCircle size={15} className="text-zinc-600" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-zinc-100">{r.name}</div>
                <div className="text-[11px] text-zinc-500">{r.what}</div>
                <div className="mt-0.5 text-[11px]">
                  {!checks ? (
                    <span className="text-zinc-500">procurando…</span>
                  ) : c?.installed ? (
                    <span className="text-zinc-400">
                      {c.detail}
                      {c.loggedIn === false && <span className="text-amber-300"> · sem login</span>}
                    </span>
                  ) : (
                    <span className="text-zinc-400">Não encontrado neste PC.</span>
                  )}
                </div>
                {checks && !c?.installed && install && (
                  <div className="mt-1.5 flex items-center gap-1 rounded-md border border-line bg-bg px-2 py-1 font-mono text-[11px] text-zinc-300">
                    <span className="selectable min-w-0 flex-1 truncate">{install}</span>
                    <Copy text={install} />
                  </div>
                )}
                {checks && (!c?.installed || c.loggedIn === false) && tool?.login && (
                  <button
                    type="button"
                    onClick={() => home && window.api.openSystemTerminal(home, tool.login!.preset)}
                    className="mt-1 cursor-pointer text-[11px] text-purple underline decoration-dotted underline-offset-2"
                  >
                    {c?.installed ? 'Fazer login (abre o terminal)' : 'Depois de instalar: fazer login (abre o terminal)'}
                  </button>
                )}
              </div>
              <Switch
                checked={on}
                disabled={on && onCount === 1}
                title={on && onCount === 1 ? 'Deixe ao menos uma IA ligada' : on ? 'Desligar' : 'Ligar'}
                onChange={(v) => void window.api.saveUi({ ais: { ...ais, [r.id]: v } })}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}


export function AiTab({ config, save }: { config: AppConfig; save: SaveFn }) {
  const [codexCmd, setCodexCmd] = useState(config.ai.codexCommand)
  const [cmd, setCmd] = useState(config.ai.geminiCommand)
  const [result, setResult] = useState<OpResult | null>(null)
  const { busy, run } = useBusy()
  const persist = () => save({ ai: { geminiCommand: cmd.trim() || 'gemini' } })

  return (
    <div className="space-y-3">
      <AiPicker config={config} />
      <Section icon={<Bot size={15} />} title="Claude Code">
        <p className="text-xs text-zinc-500">
          Usa o <code>claude</code> do seu PATH (login feito no próprio Claude Code). Ele cuida das ordens de
          desenvolvimento, do Remote Control e do envio das respostas no Google Chat.
        </p>
        <Field label="Permissões fora de projetos (console em Global, ações sem projeto)">
          <ClaudePermsEditor value={config.claudeGlobal} onChange={(v) => save({ claudeGlobal: v })} />
        </Field>
        <p className="text-[11px] text-zinc-600">Cada projeto tem as próprias permissões no cadastro dele.</p>
      </Section>
      <ClaudeUsage config={config} save={save} />
      <Section icon={<Gem size={15} />} title="Gemini CLI">
        <p className="text-xs leading-relaxed text-zinc-500">
          Use para triagem (Modo Vigia), análises e scripts do tipo "Ordem para o Gemini". Sem terminal, o Gemini não
          executa nada que precise de aprovação (comandos, edição de arquivos). Atenção: para contas gratuitas e do
          Google One, o Google trocou o Gemini CLI pelo Antigravity CLI em junho de 2026; pode ser preciso usar uma
          chave de API ou um plano pago.
        </p>
        <Field label="Comando" hint="Ex: gemini, ou o caminho completo do executável.">
          <input className={inputCls + ' font-mono text-xs'} value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="gemini" />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={!!busy}
            onClick={() =>
              run('check', async () => {
                await persist()
                setResult(await window.api.geminiCheck())
              })
            }
          >
            <Spin on={busy === 'check'} /> Salvar e testar
          </Button>
          <Button
            size="sm"
            disabled={!!busy}
            onClick={() =>
              run('setup', async () => {
                await persist()
                setResult(await window.api.geminiSetup())
              })
            }
            title="Registra o ccc-gchat no Gemini (modo personalizado) e escreve a política só-leitura do Vigia"
          >
            <Spin on={busy === 'setup'} /> Preparar Google Chat no Gemini
          </Button>
        </div>
        <Result r={result} />
      </Section>
      <Section icon={<Bot size={15} />} title="ChatGPT (Codex CLI)">
        <p className="text-xs leading-relaxed text-zinc-500">
          Modo <b>ChatGPT</b> no console e scripts "Ordem para o ChatGPT". Roda com <code>codex exec</code> no sandbox
          padrão, que é só de leitura. Login com a conta do ChatGPT (<code>codex login</code>, na aba Começar) ou chave
          de API. Não serve para o Vigia: no modo não interativo o Codex cancela chamadas de ferramentas MCP.
        </p>
        <Field label="Comando" hint="Ex: codex, ou o caminho completo do executável.">
          <input
            className={inputCls + ' font-mono text-xs'}
            value={codexCmd}
            onChange={(e) => setCodexCmd(e.target.value)}
            onBlur={() => save({ ai: { codexCommand: codexCmd.trim() || 'codex' } })}
            placeholder="codex"
          />
        </Field>
      </Section>
    </div>
  )
}
