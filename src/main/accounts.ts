// Contas conectadas: quem está logado em cada IA e qual identidade o git usa em cada projeto.
// Só leitura: lê os arquivos de login de cada ferramenta e devolve nome/e-mail/plano. Nunca devolve token.
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { AccountInfo, AccountProfile, AppConfig, Project, ProjectAccounts } from '../shared/types'
import { git } from './git'

const readJson = (f: string): Record<string, any> | null => {
  try {
    return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null
  } catch {
    return null
  }
}

const PLAN: Record<string, string> = { max: 'Max', pro: 'Pro', team: 'Team', enterprise: 'Enterprise', free: 'Free', plus: 'Plus' }
const planName = (v: unknown) => (typeof v === 'string' && v ? PLAN[v.toLowerCase()] ?? v : undefined)

/** Claude: ~/.claude.json (conta) + ~/.claude/.credentials.json (só o tipo de assinatura) */
export function parseClaudeAccount(claudeJson: Record<string, any> | null, creds: Record<string, any> | null, apiKey: boolean): Omit<AccountInfo, 'service' | 'source'> {
  const acc = claudeJson?.oauthAccount
  const plan = planName(creds?.claudeAiOauth?.subscriptionType)
  if (acc?.emailAddress) {
    return {
      who: String(acc.emailAddress),
      name: typeof acc.displayName === 'string' ? acc.displayName : undefined,
      org: typeof acc.organizationName === 'string' && !/personal/i.test(acc.organizationName) ? acc.organizationName : undefined,
      plan,
      note: apiKey ? 'A variável ANTHROPIC_API_KEY está definida: o Claude Code pode usar a chave de API (cobrança por uso) em vez da assinatura.' : undefined
    }
  }
  if (apiKey) return { who: 'Chave de API (ANTHROPIC_API_KEY)', note: 'Cobrança por uso no Console da Anthropic, sem a janela de 5h.' }
  return { who: null, note: 'Sem login. Rode "claude" no terminal e faça o /login.' }
}

/** Payload de um JWT (sem validar: só para ler e-mail e plano) */
function jwtPayload(t: unknown): Record<string, any> | null {
  if (typeof t !== 'string' || t.split('.').length < 2) return null
  try {
    return JSON.parse(Buffer.from(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
  } catch {
    return null
  }
}

/** Codex / ChatGPT: ~/.codex/auth.json */
export function parseCodexAccount(auth: Record<string, any> | null): Omit<AccountInfo, 'service' | 'source'> {
  if (!auth) return { who: null, note: 'Sem login. Rode "codex" no terminal e entre com a conta do ChatGPT.' }
  const p = jwtPayload(auth.tokens?.id_token)
  if (p?.email) {
    const oa = p['https://api.openai.com/auth'] ?? {}
    return { who: String(p.email), name: typeof p.name === 'string' ? p.name : undefined, plan: planName(oa.chatgpt_plan_type) }
  }
  if (auth.OPENAI_API_KEY) return { who: 'Chave de API (OpenAI)', note: 'Cobrança por uso na plataforma da OpenAI.' }
  return { who: null, note: 'Arquivo de login sem conta identificada.' }
}

/** Gemini: ~/.gemini/google_accounts.json + settings.json (tipo de login) */
export function parseGeminiAccount(accounts: Record<string, any> | null, settings: Record<string, any> | null, apiKey: boolean): Omit<AccountInfo, 'service' | 'source'> {
  const type = settings?.security?.auth?.selectedType ?? settings?.selectedAuthType
  if (typeof accounts?.active === 'string' && accounts.active) {
    return { who: accounts.active, plan: type === 'oauth-personal' ? 'Conta Google' : typeof type === 'string' ? type : undefined }
  }
  if (apiKey || type === 'gemini-api-key') return { who: 'Chave de API (GEMINI_API_KEY)', note: 'Cobrança/cota pela chave do Google AI Studio.' }
  return { who: null, note: 'Sem login. Rode "gemini" no terminal e entre com a conta Google.' }
}

/** "~/x" → pasta de verdade */
export function expandHome(p: string, home = homedir()): string {
  const t = p.trim()
  if (!t) return ''
  if (t === '~') return home
  if (t.startsWith('~/') || t.startsWith('~\\')) return join(home, t.slice(2))
  return t
}

/** Conta usada por um projeto ('' = padrão do PC; conta apagada também cai na padrão) */
export function accountOf(cfg: Pick<AppConfig, 'accounts' | 'projects'>, projectId?: string): AccountProfile | null {
  const id = projectId ? cfg.projects.find((p) => p.id === projectId)?.accountId : ''
  return (id && cfg.accounts.find((a) => a.id === id)) || null
}

/** Variáveis de ambiente que apontam o Claude/Codex para a pasta de login da conta */
export function accountEnv(acc: Pick<AccountProfile, 'claudeDir' | 'codexDir'> | null, home = homedir()): Record<string, string> {
  const env: Record<string, string> = {}
  if (acc?.claudeDir) env.CLAUDE_CONFIG_DIR = expandHome(acc.claudeDir, home)
  if (acc?.codexDir) env.CODEX_HOME = expandHome(acc.codexDir, home)
  return env
}

/** Contas logadas: a padrão do PC e cada conta cadastrada */
export function allAccounts(cfg: Pick<AppConfig, 'accounts'>): AccountInfo[] {
  const out = aiAccounts().map((a) => ({ ...a, accountId: '' }))
  for (const acc of cfg.accounts) {
    const env = { ...process.env, ...accountEnv(acc) }
    if (!acc.claudeDir) delete env.CLAUDE_CONFIG_DIR
    for (const a of aiAccounts(env)) {
      // Só o que a conta muda (Claude e/ou Codex); o Gemini é sempre o do PC
      if ((a.service === 'claude' && acc.claudeDir) || (a.service === 'codex' && acc.codexDir)) out.push({ ...a, accountId: acc.id })
    }
  }
  return out
}

/** Contas das IAs neste PC */
export function aiAccounts(env = process.env, home = homedir()): AccountInfo[] {
  const claudeDir = env.CLAUDE_CONFIG_DIR || join(home, '.claude')
  const claudeJsonFile = env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, '.claude.json') : join(home, '.claude.json')
  const codexDir = env.CODEX_HOME || join(home, '.codex')
  const geminiDir = join(home, '.gemini')
  return [
    {
      service: 'claude',
      source: claudeJsonFile,
      ...parseClaudeAccount(readJson(claudeJsonFile), readJson(join(claudeDir, '.credentials.json')), !!env.ANTHROPIC_API_KEY)
    },
    { service: 'codex', source: join(codexDir, 'auth.json'), ...parseCodexAccount(readJson(join(codexDir, 'auth.json'))) },
    {
      service: 'gemini',
      source: join(geminiDir, 'google_accounts.json'),
      ...parseGeminiAccount(readJson(join(geminiDir, 'google_accounts.json')), readJson(join(geminiDir, 'settings.json')), !!(env.GEMINI_API_KEY || env.GOOGLE_API_KEY))
    }
  ]
}

/** "git config --show-origin" → local (do projeto) ou global */
export function gitScope(origin: string): 'projeto' | 'global' | 'sistema' {
  if (/\.git[\\/]config/.test(origin)) return 'projeto'
  if (/gitconfig|\.config[\\/]git/i.test(origin) && !/etc[\\/]gitconfig|ProgramData|mingw|Git[\\/]etc/i.test(origin)) return 'global'
  return 'sistema'
}

/** host/dono/repo de uma URL de remoto (https ou ssh) */
export function remoteInfo(url: string): { host: string; repo: string } | null {
  const m = url.trim().match(/^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)(?::\d+(?=\/))?[:/](.+?)(?:\.git)?\/?$/i)
  return m ? { host: m[1], repo: m[2] } : null
}

/** Identidade do git e remoto de um projeto (e a conta do Claude que as execuções dele usam) */
export async function projectAccounts(p: Project, acc: AccountProfile | null = null): Promise<ProjectAccounts> {
  const get = async (key: string) => {
    const r = await git(p.path, ['config', '--show-origin', '--get', key], 5000)
    if (!r.ok || !r.out.trim()) return null
    const line = r.out.trim().split('\n').pop()!
    const tab = line.indexOf('\t')
    return { origin: line.slice(0, tab), value: line.slice(tab + 1).trim() }
  }
  const [name, email, remote] = await Promise.all([get('user.name'), get('user.email'), git(p.path, ['remote', 'get-url', 'origin'], 5000)])
  const url = remote.ok ? remote.out.trim() : ''
  const info = url ? remoteInfo(url) : null
  return {
    git: {
      name: name?.value ?? null,
      email: email?.value ?? null,
      scope: email ? gitScope(email.origin) : null,
      // Só host/repo: a URL pode ter usuário e token embutidos
      remote: info ? `${info.host}/${info.repo}` : null,
      ssh: /^(git@|ssh:\/\/)/.test(url)
    },
    claude: {
      ...aiAccounts(acc?.claudeDir ? { ...process.env, ...accountEnv(acc) } : process.env).find((a) => a.service === 'claude')!,
      accountId: acc?.id ?? ''
    }
  }
}
