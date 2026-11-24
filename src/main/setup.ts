import { spawn } from 'child_process'
import { homedir } from 'os'
import type { ToolCheck } from '../shared/types'
import { envWithPath, IS_WIN, powershellExe, stripAnsi } from './proc'

/** Roda um comando curto no shell do sistema (com o PATH de login) e devolve a saída */
function sh(command: string, timeoutMs = 20_000): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = IS_WIN
      ? spawn(powershellExe(), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], { cwd: homedir(), windowsHide: true, env: envWithPath() })
      : spawn('/bin/bash', ['-lc', command], { cwd: homedir(), env: envWithPath() })
    let out = ''
    child.stdout?.on('data', (d) => (out += d))
    child.stderr?.on('data', (d) => (out += d))
    const timer = setTimeout(() => child.kill(), timeoutMs)
    child.on('error', () => resolve({ code: -1, out: '' }))
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, out: stripAnsi(out).trim() })
    })
  })
}

const firstLine = (s: string) => s.split('\n').find((l) => l.trim())?.trim().slice(0, 120) ?? ''

/** Confere os programas que o app usa: instalado? versão? logado? */
export async function checkTools(): Promise<ToolCheck[]> {
  const version = async (id: ToolCheck['id'], cmd: string): Promise<ToolCheck> => {
    const r = await sh(`${cmd} --version`)
    return r.code === 0 ? { id, installed: true, detail: firstLine(r.out) } : { id, installed: false, detail: '' }
  }

  const [claude, git, gh, gemini, codex, uv, gchat] = await Promise.all([
    version('claude', 'claude'),
    version('git', 'git'),
    version('gh', 'gh'),
    version('gemini', 'gemini'),
    version('codex', 'codex'),
    version('uv', 'uvx'),
    sh(IS_WIN ? 'Get-Command google-chat-mcp' : 'command -v google-chat-mcp').then(
      (r): ToolCheck => ({ id: 'google-chat-mcp', installed: r.code === 0, detail: r.code === 0 ? 'instalado' : '' })
    )
  ])

  // Logins (só onde dá para conferir sem gastar nada)
  if (claude.installed) {
    const r = await sh('claude auth status')
    try {
      const j = JSON.parse(r.out.slice(r.out.indexOf('{')))
      claude.loggedIn = !!j.loggedIn
      if (j.loggedIn) claude.detail += ` · logado (${j.authMethod ?? 'ok'})`
    } catch {
      /* versão antiga sem "auth status" */
    }
  }
  if (gh.installed) {
    const r = await sh('gh auth status')
    gh.loggedIn = r.code === 0
    if (gh.loggedIn) gh.detail += ' · logado'
  }
  return [claude, git, gh, gemini, codex, uv, gchat]
}
