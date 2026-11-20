import { useEffect, useState, type ReactNode } from 'react'
import { AppWindow, ArrowLeftRight, Bell, Bot, Eye, Gem, Github, KeyRound, Loader2, MessageSquare, MessageSquareReply, Plug, Plus, RefreshCw, Rocket, Search, Send, Settings, ShieldCheck, SquareKanban, Trash2, Workflow, Zap } from 'lucide-react'
import type {
  AiProvider,
  AppConfig,
  AutomationRule,
  ReplyTemplate,
  RuleMode,
  IntegrationId,
  OpResult,
  SecretKey,
  SecretsStatus,
  SettingsPatch,
  UpdateState,
  WatcherState
} from '@shared/types'
import { Button, Field, Modal, Toggle, inputCls } from './ui'
import { cn, uid } from '../lib/utils'
import { isProdEnv } from '@shared/vars'
import { ClaudePermsEditor } from './ClaudePermsEditor'
import { SetupTab } from './SetupTab'

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

// ---------------------------------------------------------------- helpers

function Section({
  icon,
  title,
  children,
  right
}: {
  icon: ReactNode
  title: string
  children: ReactNode
  right?: ReactNode
}) {
  return (
    <div className="rounded-xl border border-line bg-card-2 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-zinc-100">
          <span className="text-purple">{icon}</span>
          {title}
        </div>
        {right}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  )
}

/** Campo de segredo: vazio = mantém o valor salvo. Nunca mostra o valor. */
function SecretInput({
  isSet,
  value,
  onChange,
  onClear,
  placeholder,
  multiline
}: {
  isSet: boolean
  value: string
  onChange: (v: string) => void
  onClear: () => void
  placeholder: string
  multiline?: boolean
}) {
  const ph = isSet ? '•••••••• salvo (deixe vazio para manter)' : placeholder
  return (
    <div className="flex items-start gap-2">
      {multiline ? (
        <textarea
          className={inputCls + ' min-h-[96px] font-mono text-xs'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={ph}
          spellCheck={false}
        />
      ) : (
        <input
          type="password"
          autoComplete="off"
          className={inputCls + ' font-mono text-xs'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={ph}
        />
      )}
      {isSet && (
        <Button variant="ghost" size="sm" className="mt-1 shrink-0" onClick={onClear} title="Apagar o valor salvo">
          Apagar
        </Button>
      )}
    </div>
  )
}

function Result({ r }: { r: OpResult | null }) {
  if (!r) return null
  return (
    <pre
      className={cn(
        'selectable max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border p-2.5 font-mono text-[11px]',
        r.ok ? 'border-emerald-500/30 bg-emerald-500/[0.06] text-emerald-200' : 'border-red-500/30 bg-red-500/[0.06] text-red-300'
      )}
    >
      {r.message}
    </pre>
  )
}

function useBusy() {
  const [busy, setBusy] = useState<string | null>(null)
  const run = async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(key)
    try {
      return await fn()
    } finally {
      setBusy(null)
    }
  }
  return { busy, run }
}

function Spin({ on }: { on: boolean }) {
  return on ? <Loader2 size={13} className="animate-spin" /> : null
}

function AppliedLine({ config, id }: { config: AppConfig; id: IntegrationId }) {
  const a = config.integrations.lastApplied[id]
  if (!a) return <span className="text-[11px] text-zinc-600">nunca aplicado</span>
  return (
    <span className={cn('text-[11px]', a.ok ? 'text-emerald-400' : 'text-red-400')}>
      {a.ok ? '● aplicado' : '● falhou'} · {new Date(a.at).toLocaleString()}
    </span>
  )
}

type SaveFn = (patch: SettingsPatch) => Promise<void>

// ---------------------------------------------------------------- Integrações

function IntegrationsTab({ config, sec, save }: { config: AppConfig; sec: SecretsStatus; save: SaveFn }) {
  const i = config.integrations
  const has = (k: SecretKey) => sec.set.includes(k)
  const { busy, run } = useBusy()
  const [results, setResults] = useState<Partial<Record<IntegrationId, OpResult>>>({})

  // GitHub
  const [gh, setGh] = useState(i.github)
  const [ghPat, setGhPat] = useState('')
  // Jira
  const [jira, setJira] = useState(i.jira)
  const [jiraToken, setJiraToken] = useState('')
  // Google Chat
  const [gc, setGc] = useState(i.gchat)
  const [gcSecret, setGcSecret] = useState('')
  const [gcJson, setGcJson] = useState('')

  const apply = (id: IntegrationId, patch: SettingsPatch) =>
    run(id, async () => {
      await save(patch)
      const r = await window.api.mcpApply(id)
      setResults((s) => ({ ...s, [id]: r }))
      if (id === 'github') setGhPat('')
      if (id === 'jira') setJiraToken('')
      if (id === 'gchat') {
        setGcSecret('')
        setGcJson('')
      }
    })

  const status = (id: IntegrationId) =>
    run(id + ':status', async () => {
      const r = await window.api.mcpStatus(id)
      setResults((s) => ({ ...s, [id]: r }))
    })

  const clearSecret = (k: SecretKey) => save({ secrets: { [k]: null } })

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        Ao aplicar, o app registra o servidor no Claude Code com <code className="text-purple">claude mcp</code> (escopo
        do usuário), com nomes <code className="text-purple">ccc-*</code> para não mexer nos seus MCPs existentes. Os
        tokens vão pelo stdin, nunca na linha de comando.
      </p>

      {/* GitHub */}
      <Section icon={<Github size={15} />} title="Git (GitHub)" right={<AppliedLine config={config} id="github" />}>
        <Toggle checked={gh.enabled} onChange={(v) => setGh({ ...gh, enabled: v })} label="Ativar MCP do GitHub" />
        <Toggle
          checked={gh.readOnly}
          onChange={(v) => setGh({ ...gh, readOnly: v })}
          label="Somente leitura (recomendado)"
          hint="Usa o endpoint /readonly: o Claude lê repos, PRs e issues, mas não cria nem altera nada."
        />
        <Field label="Personal Access Token">
          <SecretInput
            isSet={has('github.pat')}
            value={ghPat}
            onChange={setGhPat}
            onClear={() => clearSecret('github.pat')}
            placeholder="github_pat_…"
          />
        </Field>
        <div className="flex gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={!!busy}
            onClick={() =>
              apply('github', { integrations: { github: gh }, secrets: ghPat ? { 'github.pat': ghPat } : {} })
            }
          >
            <Spin on={busy === 'github'} /> Salvar e aplicar
          </Button>
          <Button size="sm" disabled={!!busy} onClick={() => status('github')}>
            <Spin on={busy === 'github:status'} /> <Search size={12} /> Ver status
          </Button>
        </div>
        <Result r={results.github ?? null} />
      </Section>

      {/* Jira */}
      <Section icon={<SquareKanban size={15} />} title="Jira" right={<AppliedLine config={config} id="jira" />}>
        <Toggle checked={jira.enabled} onChange={(v) => setJira({ ...jira, enabled: v })} label="Ativar MCP do Jira" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="URL">
            <input
              className={inputCls}
              value={jira.url}
              onChange={(e) => setJira({ ...jira, url: e.target.value })}
              placeholder="https://suaempresa.atlassian.net"
            />
          </Field>
          <Field label="E-mail">
            <input
              className={inputCls}
              value={jira.email}
              onChange={(e) => setJira({ ...jira, email: e.target.value })}
              placeholder="voce@empresa.com"
            />
          </Field>
        </div>
        <Field
          label="API Token"
          hint={
            <>
              Crie em id.atlassian.com → Security → API tokens. Usa o servidor <code>mcp-atlassian</code> via{' '}
              <code>uvx</code> (precisa do uv instalado).
            </>
          }
        >
          <SecretInput
            isSet={has('jira.token')}
            value={jiraToken}
            onChange={setJiraToken}
            onClear={() => clearSecret('jira.token')}
            placeholder="ATATT…"
          />
        </Field>
        <div className="flex gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={!!busy}
            onClick={() =>
              apply('jira', { integrations: { jira }, secrets: jiraToken ? { 'jira.token': jiraToken } : {} })
            }
          >
            <Spin on={busy === 'jira'} /> Salvar e aplicar
          </Button>
          <Button size="sm" disabled={!!busy} onClick={() => status('jira')}>
            <Spin on={busy === 'jira:status'} /> <Search size={12} /> Ver status
          </Button>
        </div>
        <Result r={results.jira ?? null} />
      </Section>

      {/* Google Chat */}
      <Section icon={<MessageSquare size={15} />} title="Google Chat" right={<AppliedLine config={config} id="gchat" />}>
        <Toggle
          checked={gc.enabled}
          onChange={(v) => setGc({ ...gc, enabled: v })}
          label="Ativar MCP do Google Chat"
          hint="Necessário para o Modo Vigia."
        />
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['official', 'Oficial do Google', 'chatmcp.googleapis.com · OAuth'],
              ['custom', 'Personalizado', 'Cole o JSON de outro servidor MCP']
            ] as const
          ).map(([m, label, sub]) => (
            <button
              key={m}
              type="button"
              onClick={() => setGc({ ...gc, mode: m })}
              className={cn(
                'cursor-pointer rounded-lg border p-2.5 text-left transition-colors',
                gc.mode === m ? 'border-violet/70 bg-violet/10' : 'border-line bg-bg hover:border-zinc-600'
              )}
            >
              <div className="text-sm text-zinc-100">{label}</div>
              <div className="text-[11px] text-zinc-500">{sub}</div>
            </button>
          ))}
        </div>

        {gc.mode === 'official' ? (
          <>
            <div className="rounded-lg border border-line bg-bg p-2.5 text-[11px] leading-relaxed text-zinc-500">
              O servidor oficial está em <b className="text-zinc-300">Developer Preview</b> do Google Workspace (precisa
              de inscrição). No Google Cloud: ative <code>chat.googleapis.com</code> e <code>chatmcp.googleapis.com</code>,
              crie um cliente OAuth do tipo <i>Web application</i> marcado para agentes de IA e cadastre o redirect{' '}
              <code className="selectable text-purple">http://localhost:{gc.callbackPort}/callback</code>.
            </div>
            <div className="grid grid-cols-[1fr_120px] gap-3">
              <Field label="OAuth Client ID">
                <input
                  className={inputCls + ' font-mono text-xs'}
                  value={gc.clientId}
                  onChange={(e) => setGc({ ...gc, clientId: e.target.value })}
                  placeholder="123…apps.googleusercontent.com"
                />
              </Field>
              <Field label="Porta callback">
                <input
                  type="number"
                  className={inputCls}
                  value={gc.callbackPort}
                  onChange={(e) => setGc({ ...gc, callbackPort: Number(e.target.value) || 8765 })}
                />
              </Field>
            </div>
            <Field label="OAuth Client Secret">
              <SecretInput
                isSet={has('gchat.clientSecret')}
                value={gcSecret}
                onChange={setGcSecret}
                onClear={() => clearSecret('gchat.clientSecret')}
                placeholder="GOCSPX-…"
              />
            </Field>
          </>
        ) : (
          <>
            <Field
              label="JSON do servidor (formato do claude mcp add-json)"
              hint='Ex: {"type":"stdio","command":"google-chat-mcp","args":[],"env":{…}}. Fica no cofre, pode ter tokens.'
            >
              <SecretInput
                multiline
                isSet={has('gchat.customJson')}
                value={gcJson}
                onChange={setGcJson}
                onClear={() => clearSecret('gchat.customJson')}
                placeholder='{"type":"stdio","command":"…","args":["…"]}'
              />
            </Field>
            <Field
              label="Ferramentas de LEITURA que o Vigia pode usar"
              hint="Separe por vírgula. Só essas ficam liberadas no ciclo do Vigia (ex: list_messages, search_messages)."
            >
              <input
                className={inputCls + ' font-mono text-xs'}
                value={gc.readTools}
                onChange={(e) => setGc({ ...gc, readTools: e.target.value })}
                placeholder="list_messages, search_messages"
              />
            </Field>
            <Field
              label="Ferramenta de ENVIO (opcional)"
              hint="Só para as respostas cadastradas (Automação). Fica bloqueada no Vigia, que só lê."
            >
              <input
                className={inputCls + ' font-mono text-xs'}
                value={gc.sendTool}
                onChange={(e) => setGc({ ...gc, sendTool: e.target.value })}
                placeholder="send_message"
              />
            </Field>
          </>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={!!busy}
            onClick={() =>
              apply('gchat', {
                integrations: { gchat: gc },
                secrets: {
                  ...(gcSecret ? { 'gchat.clientSecret': gcSecret } : {}),
                  ...(gcJson ? { 'gchat.customJson': gcJson } : {})
                }
              })
            }
          >
            <Spin on={busy === 'gchat'} /> Salvar e aplicar
          </Button>
          {gc.mode === 'official' && (
            <Button
              size="sm"
              disabled={!!busy}
              onClick={() =>
                run('gchat:login', async () => {
                  const r = await window.api.mcpLogin('gchat')
                  setResults((s) => ({ ...s, gchat: r }))
                })
              }
            >
              <Spin on={busy === 'gchat:login'} /> <KeyRound size={12} /> Autenticar
            </Button>
          )}
          <Button size="sm" disabled={!!busy} onClick={() => status('gchat')}>
            <Spin on={busy === 'gchat:status'} /> <Search size={12} /> Ver status
          </Button>
        </div>
        <Result r={results.gchat ?? null} />
      </Section>
    </div>
  )
}

// ---------------------------------------------------------------- Telegram

function TelegramTab({ config, sec, save }: { config: AppConfig; sec: SecretsStatus; save: SaveFn }) {
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
      <Toggle
        checked={config.telegram.interactive}
        onChange={(v) => save({ telegram: { interactive: v } })}
        label="Botões e comandos no Telegram"
        hint="Pedidos chegam com Aprovar / Descartar (e Aprovar e rodar, se uma regra permitir). Comandos: /status, /pendentes, /ausente, /online, /vigia. Só o seu Chat ID é obedecido."
      />
      <Result r={result} />
    </Section>
  )
}

// ---------------------------------------------------------------- Vigia

function WatcherTab({ config, watcher, save }: { config: AppConfig; watcher: WatcherState; save: SaveFn }) {
  const [w, setW] = useState(config.watcher)
  const [saved, setSaved] = useState(false)
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
            ).map(([p, label, sub]) => (
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

// ---------------------------------------------------------------- Geral

function GeneralTab({ config, save }: { config: AppConfig; save: SaveFn }) {
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

// ---------------------------------------------------------------- IAs

function AiTab({ config, save }: { config: AppConfig; save: SaveFn }) {
  const [codexCmd, setCodexCmd] = useState(config.ai.codexCommand)
  const [cmd, setCmd] = useState(config.ai.geminiCommand)
  const [result, setResult] = useState<OpResult | null>(null)
  const { busy, run } = useBusy()
  const persist = () => save({ ai: { geminiCommand: cmd.trim() || 'gemini' } })

  return (
    <div className="space-y-3">
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

// ---------------------------------------------------------------- Automação

const MODE_LABEL: Record<RuleMode, string> = {
  suggest: 'Só sugerir o script no pedido',
  telegram: 'Botão "Aprovar e rodar" no Telegram',
  auto: 'Rodar sozinho ao detectar'
}

function AutomationTab({ config, save }: { config: AppConfig; save: SaveFn }) {
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

function IconBtn({ title, onClick }: { title: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="inline-flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-zinc-500 hover:bg-red-500/10 hover:text-red-400"
    >
      <Trash2 size={13} />
    </button>
  )
}
