import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  AppWindow,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  ClipboardCopy,
  ExternalLink,
  Loader2,
  RefreshCw,
  XCircle
} from 'lucide-react'
import type { AppConfig, SecretsStatus, TerminalPreset, ToolCheck } from '@shared/types'
import { Button } from './ui'
import { cn } from '../lib/utils'

export type Os = 'linux' | 'win32' | 'darwin'
type GoTo = (tab: 'integrations' | 'telegram' | 'ai' | 'watcher') => void

interface ToolInfo {
  id: ToolCheck['id']
  name: string
  why: string
  optional?: boolean
  install: Partial<Record<Os, string>>
  login?: { label: string; preset: TerminalPreset }
  link?: string
}

export const TOOLS: ToolInfo[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    why: 'Ordens para o Claude, Remote Control, Vigia e respostas no chat.',
    install: {
      linux: 'curl -fsSL https://claude.ai/install.sh | bash',
      darwin: 'curl -fsSL https://claude.ai/install.sh | bash',
      win32: 'irm https://claude.ai/install.ps1 | iex'
    },
    login: { label: 'Fazer login', preset: 'claude' },
    link: 'https://code.claude.com/docs/en/setup'
  },
  {
    id: 'git',
    name: 'Git',
    why: 'Branch dos projetos e scripts de git.',
    install: { linux: 'sudo apt install -y git', win32: 'winget install --id Git.Git -e' }
  },
  {
    id: 'gh',
    name: 'GitHub CLI (gh)',
    why: 'Opcional: deixa scripts e o Claude usarem o GitHub (PRs, issues) pelo terminal.',
    optional: true,
    install: { linux: 'sudo apt install -y gh', win32: 'winget install --id GitHub.cli -e' },
    login: { label: 'gh auth login', preset: 'gh-login' }
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    why: 'Opcional: modo Gemini e Vigia com Gemini (poupa tokens do Claude). Precisa do Node.js.',
    optional: true,
    install: { linux: 'npm install -g @google/gemini-cli', win32: 'npm install -g @google/gemini-cli' },
    login: { label: 'Fazer login', preset: 'gemini' }
  },
  {
    id: 'codex',
    name: 'Codex CLI (ChatGPT)',
    why: 'Opcional: modo ChatGPT no console e scripts. Precisa do Node.js.',
    optional: true,
    install: { linux: 'npm install -g @openai/codex', win32: 'npm install -g @openai/codex' },
    login: { label: 'codex login', preset: 'codex' }
  },
  {
    id: 'uv',
    name: 'uv',
    why: 'Opcional: necessário para o MCP do Jira.',
    optional: true,
    install: {
      linux: 'curl -LsSf https://astral.sh/uv/install.sh | sh',
      win32: 'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"'
    }
  }
]

export function Copy({ text }: { text: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button
      type="button"
      title="Copiar"
      onClick={async () => {
        await window.api.copyText(text)
        setOk(true)
        setTimeout(() => setOk(false), 1200)
      }}
      className="cursor-pointer rounded p-1 text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
    >
      <ClipboardCopy size={12} className={ok ? 'text-emerald-400' : ''} />
    </button>
  )
}

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => window.api.openExternal(href)}
      className="inline-flex cursor-pointer items-center gap-0.5 text-purple underline decoration-dotted underline-offset-2 hover:brightness-125"
    >
      {children}
      <ExternalLink size={10} />
    </button>
  )
}

function Guide({
  title,
  done,
  children,
  open: initial = false
}: {
  title: string
  done: boolean
  children: ReactNode
  open?: boolean
}) {
  const [open, setOpen] = useState(initial)
  // Aberto direto (ex: clicou no Vigia sem o Google Chat): rola até o guia e destaca por um instante
  const box = useRef<HTMLDivElement>(null)
  const [flash, setFlash] = useState(initial)
  useEffect(() => {
    if (!initial) return
    const t1 = setTimeout(() => box.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 80)
    const t2 = setTimeout(() => setFlash(false), 1800)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [initial])
  return (
    <div ref={box} className={cn('scroll-mt-2 rounded-xl border bg-card-2 transition-colors duration-700', flash ? 'border-violet' : 'border-line')}>
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left">
        {open ? <ChevronDown size={14} className="text-zinc-500" /> : <ChevronRight size={14} className="text-zinc-500" />}
        {done ? <CheckCircle2 size={15} className="text-emerald-400" /> : <CircleDashed size={15} className="text-zinc-500" />}
        <span className="text-sm font-medium text-zinc-100">{title}</span>
        {done && <span className="ml-auto text-[11px] text-emerald-400">configurado</span>}
      </button>
      {open && <div className="space-y-2 border-t border-line px-4 py-3 text-xs leading-relaxed text-zinc-400">{children}</div>}
    </div>
  )
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="list-decimal space-y-1.5 pl-4">{children}</ol>
}

function Cmd({ text }: { text: string }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded border border-line bg-bg px-1.5 py-0.5 align-middle">
      <code className="selectable truncate text-zinc-200">{text}</code>
      <Copy text={text} />
    </span>
  )
}

export function SetupTab({
  config,
  sec,
  goTo,
  focus
}: {
  config: AppConfig
  sec: SecretsStatus
  goTo: GoTo
  /** Abre direto um guia (ex: 'gchat' quando o Vigia está bloqueado) */
  focus?: string
}) {
  const [os, setOs] = useState<Os>('linux')
  const [checks, setChecks] = useState<ToolCheck[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [home, setHome] = useState('')

  const check = async () => {
    setBusy(true)
    try {
      setChecks(await window.api.checkTools())
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    window.api.platform().then(setOs)
    window.api.homeDir().then(setHome)
    void check()
  }, [])

  const byId = (id: ToolCheck['id']) => checks?.find((c) => c.id === id)
  const has = (k: string) => sec.set.includes(k as never)
  const i = config.integrations

  return (
    <div className="space-y-3">
      <p className="text-xs text-zinc-500">
        Confira o que está instalado e siga os guias. Os comandos têm botão de copiar; "Abrir terminal" abre o terminal do
        sistema para colar e rodar. Depois de instalar algo, clique em <b>Verificar de novo</b>.
      </p>

      {/* Programas */}
      <div className="rounded-xl border border-line bg-card-2">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <span className="text-sm font-semibold text-zinc-100">Programas no seu PC</span>
          <div className="flex gap-1.5">
            <Button size="sm" onClick={() => home && window.api.openSystemTerminal(home)}>
              <AppWindow size={12} /> Abrir terminal
            </Button>
            <Button size="sm" onClick={check} disabled={busy}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Verificar de novo
            </Button>
          </div>
        </div>
        <div className="divide-y divide-line">
          {TOOLS.map((t) => {
            const c = byId(t.id)
            const cmd = t.install[os] ?? t.install.linux ?? ''
            const needsLogin = c?.installed && c.loggedIn === false
            return (
              <div key={t.id} className="flex items-start gap-3 px-4 py-2.5">
                <div className="mt-0.5">
                  {!checks ? (
                    <Loader2 size={15} className="animate-spin text-zinc-500" />
                  ) : c?.installed && !needsLogin ? (
                    <CheckCircle2 size={15} className="text-emerald-400" />
                  ) : c?.installed ? (
                    <CircleDashed size={15} className="text-amber-300" />
                  ) : (
                    <XCircle size={15} className={t.optional ? 'text-zinc-600' : 'text-red-400'} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-zinc-100">
                    {t.name}
                    {t.optional && <span className="ml-1.5 text-[10px] text-zinc-500">opcional</span>}
                    {c?.detail && <span className="ml-2 font-mono text-[11px] text-zinc-500">{c.detail}</span>}
                  </div>
                  <div className="text-[11px] text-zinc-500">{t.why}</div>
                  {checks && !c?.installed && cmd && (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-zinc-400">
                      Instalar: <Cmd text={cmd} />
                      {t.link && <Link href={t.link}>docs</Link>}
                    </div>
                  )}
                  {needsLogin && <div className="mt-1 text-[11px] text-amber-300">Instalado, mas sem login.</div>}
                </div>
                {t.login && c?.installed && (
                  <Button size="sm" className="shrink-0" onClick={() => home && window.api.openSystemTerminal(home, t.login!.preset)}>
                    {t.login.label}
                  </Button>
                )}
              </div>
            )
          })}
        </div>
        {os === 'win32' && (
          <div className="border-t border-line px-4 py-2 text-[11px] text-zinc-500">
            No Windows, feche e abra o app depois de instalar algo (o PATH só é lido ao abrir). Gemini e Codex precisam do
            Node.js: <Cmd text="winget install OpenJS.NodeJS.LTS" />
          </div>
        )}
        {os === 'linux' && (
          <div className="border-t border-line px-4 py-2 text-[11px] text-zinc-500">
            Gemini e Codex precisam do Node.js 20+. Jeito simples no Ubuntu:{' '}
            <Cmd text="curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash && nvm install 22" />
          </div>
        )}
      </div>

      {/* Guias */}
      <Guide title="Remote Control (por projeto)" done={false}>
        <Steps>
          <li>
            No card do projeto, ligue o switch <b>Remote</b>.
          </li>
          <li>
            Na primeira vez em cada pasta, o card mostra <b>Fazer a configuração inicial</b>: abre um terminal rodando{' '}
            <code>claude remote-control</code>. Responda <b>y</b> às perguntas, espere o link aparecer, feche (Ctrl+C) e
            clique em ↻ no card.
          </li>
          <li>Depois disso, o link da sessão aparece no card (copiar/abrir no celular).</li>
        </Steps>
      </Guide>

      <Guide title="Telegram (avisos e aprovações no celular)" done={!!config.telegram.chatId && has('telegram.token')} open={focus === 'telegram'}>
        <Steps>
          <li>
            No Telegram, abra <Link href="https://t.me/BotFather">@BotFather</Link>, mande <code>/newbot</code>, escolha um
            nome e copie o <b>token</b> que ele devolve.
          </li>
          <li>Abra o seu bot novo (o link vem na mensagem do BotFather) e mande um "oi".</li>
          <li>
            Em <b>Telegram</b> aqui nas Configurações: cole o token, clique em <b>Detectar</b> (preenche o Chat ID) e em{' '}
            <b>Testar Notificação</b>.
          </li>
        </Steps>
        <Button size="sm" onClick={() => goTo('telegram')}>
          Ir para Telegram →
        </Button>
      </Guide>

      <Guide title="GitHub (para o Claude ler repositórios, PRs e issues)" done={i.github.enabled && has('github.pat')} open={focus === 'github'}>
        <Steps>
          <li>
            Abra <Link href="https://github.com/settings/personal-access-tokens/new">Criar token (fine-grained)</Link>.
          </li>
          <li>
            Nome: <i>Claude Command Center</i>. Expiração: a que preferir. Em <b>Repository access</b>, escolha os repos (ou
            todos).
          </li>
          <li>
            Em <b>Permissions</b>, dê <b>Read-only</b> para <i>Contents</i>, <i>Metadata</i>, <i>Issues</i> e{' '}
            <i>Pull requests</i> (é o que o modo "somente leitura" usa).
          </li>
          <li>
            <b>Generate token</b>, copie (começa com <code>github_pat_</code>) e cole em <b>Integrações → GitHub</b>. Ative,
            salve e aplique. Depois use <b>Ver status</b> para testar.
          </li>
        </Steps>
        <Button size="sm" onClick={() => goTo('integrations')}>
          Ir para Integrações →
        </Button>
      </Guide>

      <Guide title="Jira" done={i.jira.enabled && has('jira.token')} open={focus === 'jira'}>
        <Steps>
          <li>
            Instale o <b>uv</b> (lista de programas acima).
          </li>
          <li>
            Abra <Link href="https://id.atlassian.com/manage-profile/security/api-tokens">Tokens de API da Atlassian</Link>{' '}
            → <b>Create API token</b>, dê um nome e copie.
          </li>
          <li>
            Em <b>Integrações → Jira</b>: URL (ex: <code>https://suaempresa.atlassian.net</code>), seu e-mail da Atlassian e o
            token. Ative, salve e aplique; teste com <b>Ver status</b>.
          </li>
        </Steps>
        <Button size="sm" onClick={() => goTo('integrations')}>
          Ir para Integrações →
        </Button>
      </Guide>

      <Guide title="Google Chat (necessário para o Modo Vigia)" done={i.gchat.enabled} open={focus === 'gchat'}>
        <p>
          É a configuração mais longa (uns 15 minutos, uma vez só). Use a conta Google do trabalho. Se a sua empresa bloquear
          apps OAuth, peça ao admin do Google Workspace para liberar.
        </p>
        <Steps>
          <li>
            Abra o <Link href="https://console.cloud.google.com/projectcreate">Google Cloud: criar projeto</Link> e crie um
            projeto (ex: <i>claude-command-center</i>).
          </li>
          <li>
            Ative as duas APIs no projeto: <Link href="https://console.cloud.google.com/apis/library/chat.googleapis.com">Google Chat API</Link>{' '}
            e <Link href="https://console.cloud.google.com/apis/library/chatmcp.googleapis.com">Google Chat MCP API</Link>.
          </li>
          <li>
            Em <Link href="https://console.cloud.google.com/auth/branding">Google Auth Platform</Link>, configure a tela de
            consentimento: tipo <b>Interno</b> (se aparecer; senão Externo e adicione seu e-mail como usuário de teste).
          </li>
          <li>
            Em <b>Acesso a dados</b>, adicione os escopos: <code>chat.spaces.readonly</code>,{' '}
            <code>chat.memberships.readonly</code>, <code>chat.messages.readonly</code> (e{' '}
            <code>chat.messages.create</code> se quiser mandar as respostas cadastradas).
          </li>
          <li>
            Em <Link href="https://console.cloud.google.com/auth/clients">Clientes</Link> → <b>Criar cliente</b> → tipo{' '}
            <b>Aplicativo da Web</b>. Em URIs de redirecionamento, adicione{' '}
            <Cmd text={`http://localhost:${i.gchat.callbackPort}/callback`} />. Crie e copie o <b>Client ID</b> e o{' '}
            <b>Client Secret</b>.
          </li>
          <li>
            Em <b>Integrações → Google Chat</b>: modo <b>Oficial do Google</b>, cole os dois, <b>Salvar e aplicar</b> e
            depois <b>Autenticar</b> (abre o navegador para você autorizar).
          </li>
          <li>
            Ligue o <b>Vigia</b> no topo e clique em <b>Verificar agora</b> (aba Modo Vigia) para testar.
          </li>
        </Steps>
        <p className="text-zinc-500">
          Alternativa da comunidade: o <Link href="https://pkg.go.dev/github.com/mmedum/google-chat-mcp">google-chat-mcp</Link>{' '}
          (um programa só, com login próprio e modo somente leitura via <code>GCM_READ_ONLY=true</code>). Também precisa de um
          cliente OAuth seu; use o modo <b>Personalizado</b> em Integrações com o JSON do servidor.
        </p>
        <Button size="sm" onClick={() => goTo('integrations')}>
          Ir para Integrações →
        </Button>
      </Guide>
    </div>
  )
}
