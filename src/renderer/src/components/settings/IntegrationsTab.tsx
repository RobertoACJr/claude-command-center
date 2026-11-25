// Configurações → Integrações (Jira, GitHub, Google Chat)
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
import { TokenCheck } from './TokenCheck'
import { HelpTip, Section, SecretInput, Result, useBusy, Spin, CHECK_STYLE, fmtWhen, CheckList, CheckBadge, Switch, IconBtn, type SaveFn } from './shared'

export const CHECKS_KEY = 'helice.testesIntegracoes'
export const CHECK_TTL = 24 * 60 * 60 * 1000

/** Resultados de teste guardados neste PC (valem um dia) */
export function loadChecks(): Partial<Record<IntegrationId, IntegrationCheck>> {
  try {
    const raw = JSON.parse(localStorage.getItem(CHECKS_KEY) || '{}') as Record<string, IntegrationCheck>
    const out: Partial<Record<IntegrationId, IntegrationCheck>> = {}
    for (const [k, v] of Object.entries(raw)) {
      if (v && typeof v.at === 'number' && Array.isArray(v.lines) && Date.now() - v.at < CHECK_TTL) out[k as IntegrationId] = v
    }
    return out
  } catch {
    return {}
  }
}

export function saveChecks(c: Partial<Record<IntegrationId, IntegrationCheck>>) {
  try {
    localStorage.setItem(CHECKS_KEY, JSON.stringify(c))
  } catch {
    /* sem armazenamento: testa de novo na próxima vez */
  }
}

export function IntegrationsTab({ config, sec, save }: { config: AppConfig; sec: SecretsStatus; save: SaveFn }) {
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
      await test(id)
      setEditing((e) => ({ ...e, [id]: false }))
    })

  // Teste de verdade: o resultado fica guardado por um dia (Testar de novo refaz na hora).
  // Ao abrir a aba, só testa o que não tem resultado recente, e depois de aplicar.
  const [checks, setChecks] = useState<Partial<Record<IntegrationId, IntegrationCheck>>>(loadChecks)
  const [testing, setTesting] = useState<Partial<Record<IntegrationId, boolean>>>({})
  const test = async (id: IntegrationId) => {
    setTesting((t) => ({ ...t, [id]: true }))
    try {
      const c = await window.api.integrationCheck(id)
      setChecks((s) => {
        const next = { ...s, [id]: c }
        saveChecks(next)
        return next
      })
    } finally {
      setTesting((t) => ({ ...t, [id]: false }))
    }
  }
  useEffect(() => {
    for (const id of ['jira', 'github', 'gchat'] as IntegrationId[]) if (!checks[id]) test(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const status = (id: IntegrationId) => test(id)
  // Funcionando = algo deu certo e nada falhou: os campos ficam fechados (lápis para editar)
  const [editing, setEditing] = useState<Partial<Record<IntegrationId, boolean>>>({})
  const working = (id: IntegrationId) => {
    const main = checks[id]?.lines.filter((l) => !l.label.startsWith('Conectores da sua conta')) ?? []
    return main.some((l) => l.state === 'ok') && !main.some((l) => l.state === 'fail')
  }
  // Testando: os campos esperam o resultado (não aparecem e somem logo depois)
  const showForm = (id: IntegrationId) => !testing[id] && (!working(id) || !!editing[id])

  const clearSecret = (k: SecretKey) => save({ secrets: { [k]: null } })

  return (
    <div className="space-y-3">
      <TokenCheck />
      <p className="text-[11px] text-zinc-500">
        Cada integração é testada de verdade e o resultado fica guardado por um dia (use Testar de novo quando quiser). Passe
        o mouse no <b>?</b> para ver para que serve. As que estão funcionando ficam fechadas; use o lápis para editar.
      </p>

      {/* GitHub */}
      <Section
        icon={<Github size={15} />}
        title="Git (GitHub)"
        help={
          <>
              <b>Opcional.</b> Deixa o Claude ler PRs, issues e outros repositórios do GitHub. O git do card (branch,
              alterados, puxar, atualizar com a master) <b>não</b> precisa disso: usa o git do seu PC.
            </>
        }
        right={
          <span className="flex items-center gap-2">
            <CheckBadge check={checks.github} testing={!!testing.github} />
            {working('github') && (
              <IconButton title={editing.github ? 'Fechar edição' : 'Editar'} tone="accent" onClick={() => setEditing((e) => ({ ...e, github: !e.github }))}>
                {editing.github ? <X size={13} /> : <Pencil size={13} />}
              </IconButton>
            )}
          </span>
        }
      >
        {showForm('github') ? (
          <>
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
            <Spin on={!!testing.github} /> <Search size={12} /> Testar
          </Button>
        </div>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!!testing.github} onClick={() => status('github')}>
              <Spin on={!!testing.github} /> <Search size={12} /> Testar de novo
            </Button>
          </div>
        )}
        <Result r={results.github ?? null} />
        <CheckList check={checks.github} testing={!!testing.github} />
      </Section>

      {/* Jira */}
      <Section
        icon={<SquareKanban size={15} />}
        title="Jira"
        help={
          <>
              As <b>Demandas</b> usam a URL, o e-mail e o token para puxar o card (título, descrição, comentários).
              O <b>MCP</b> é opcional: deixa o Claude consultar o Jira sozinho, mas se a sua conta claude.ai já tem o
              conector Atlassian, ele já faz isso.
            </>
        }
        right={
          <span className="flex items-center gap-2">
            <CheckBadge check={checks.jira} testing={!!testing.jira} />
            {working('jira') && (
              <IconButton title={editing.jira ? 'Fechar edição' : 'Editar'} tone="accent" onClick={() => setEditing((e) => ({ ...e, jira: !e.jira }))}>
                {editing.jira ? <X size={13} /> : <Pencil size={13} />}
              </IconButton>
            )}
          </span>
        }
      >
        {showForm('jira') ? (
          <>
        <Toggle
          checked={jira.enabled}
          onChange={(v) => setJira({ ...jira, enabled: v })}
          label="Ativar MCP do Jira (opcional)"
          hint="As Demandas funcionam só com URL, e-mail e token. Ativar deixa o Claude consultar o Jira por conta própria (precisa do uv). Se o teste mostrar o conector Atlassian da sua conta claude.ai, nem precisa."
        />
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
            <Spin on={!!testing.jira} /> <Search size={12} /> Testar
          </Button>
        </div>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!!testing.jira} onClick={() => status('jira')}>
              <Spin on={!!testing.jira} /> <Search size={12} /> Testar de novo
            </Button>
          </div>
        )}
        <Result r={results.jira ?? null} />
        <CheckList check={checks.jira} testing={!!testing.jira} />
      </Section>

      {/* Google Chat */}
      <Section
        icon={<MessageSquare size={15} />}
        title="Google Chat"
        help={
          <>
              É o que o <b>Vigia</b> usa para ler as conversas e achar pedidos de deploy, e o que as respostas
              automáticas usam para responder. Sem ele, o Vigia não tem o que ler.
            </>
        }
        right={
          <span className="flex items-center gap-2">
            <CheckBadge check={checks.gchat} testing={!!testing.gchat} />
            {working('gchat') && (
              <IconButton title={editing.gchat ? 'Fechar edição' : 'Editar'} tone="accent" onClick={() => setEditing((e) => ({ ...e, gchat: !e.gchat }))}>
                {editing.gchat ? <X size={13} /> : <Pencil size={13} />}
              </IconButton>
            )}
          </span>
        }
      >
        {showForm('gchat') ? (
          <>
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
            <Spin on={!!testing.gchat} /> <Search size={12} /> Testar
          </Button>
        </div>
          </>
        ) : (
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!!testing.gchat} onClick={() => status('gchat')}>
              <Spin on={!!testing.gchat} /> <Search size={12} /> Testar de novo
            </Button>
          </div>
        )}
        <Result r={results.gchat ?? null} />
        <CheckList check={checks.gchat} testing={!!testing.gchat} />
      </Section>
    </div>
  )
}
