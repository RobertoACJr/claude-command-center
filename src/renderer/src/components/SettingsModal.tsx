import { useEffect, useState, type ReactNode } from 'react'
import {
  AppWindow,
  Bell,
  Eye,
  Github,
  KeyRound,
  Loader2,
  MessageSquare,
  Plug,
  Search,
  Send,
  Settings,
  ShieldCheck,
  SquareKanban,
  Zap
} from 'lucide-react'
import type {
  AppConfig,
  IntegrationId,
  OpResult,
  SecretKey,
  SecretsStatus,
  SettingsPatch,
  WatcherState
} from '@shared/types'
import { Button, Field, Modal, Toggle, inputCls } from './ui'
import { cn } from '../lib/utils'

type Tab = 'general' | 'integrations' | 'telegram' | 'watcher'

export function SettingsModal({
  open,
  config,
  watcher,
  onClose
}: {
  open: boolean
  config: AppConfig
  watcher: WatcherState
  onClose: () => void
}) {
  const [tab, setTab] = useState<Tab>('general')
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
            ['general', 'Geral', AppWindow],
            ['integrations', 'Integrações MCP', Plug],
            ['telegram', 'Telegram', Bell],
            ['watcher', 'Modo Vigia', Eye]
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

      {tab === 'general' && <GeneralTab config={config} save={save} />}
      {tab === 'integrations' && <IntegrationsTab config={config} sec={sec} save={save} />}
      {tab === 'telegram' && <TelegramTab config={config} sec={sec} save={save} />}
      {tab === 'watcher' && <WatcherTab config={config} watcher={watcher} save={save} />}
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
        model: w.model
      }
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="space-y-3">
      <Section icon={<Eye size={15} />} title="Monitorar Google Chat">
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
          <Field label="Modelo (opcional)" hint="Vazio = padrão do Claude Code. Ex: sonnet, haiku.">
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
          <b className="text-emerald-300">Regra de segurança garantida por permissão, não só por instrução.</b> Cada
          ciclo roda <code>claude -p</code> sem nenhuma ferramenta embutida (sem terminal, sem editar arquivos), com
          apenas as ferramentas de <i>leitura</i> do Google Chat liberadas e as de escrita bloqueadas. O Claude só
          devolve um JSON; quem avisa o Telegram é o app. Nada é executado até você aprovar aqui.
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- Geral

function GeneralTab({ config, save }: { config: AppConfig; save: SaveFn }) {
  const g = config.general
  return (
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
  )
}
