import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from 'child_process'

export const IS_WIN = process.platform === 'win32'

// eslint-disable-next-line no-control-regex
const ANSI_RE = /[\u001b\u009b][[\]()#;?]*(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007|(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-ntqry=><~])/g

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '')
}

/** Aspas simples seguras para bash */
export function bashQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

function baseEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    FORCE_COLOR: '0',
    NO_COLOR: '1',
    CLICOLOR: '0',
    // Sem terminal não há como responder prompts: falha rápido em vez de travar
    GIT_TERMINAL_PROMPT: '0',
    ...extra
  }
}

let psExe: string | null = null
/** PowerShell 7 (pwsh) se instalado — aceita `&&` como o bash. Senão, Windows PowerShell 5.1. */
export function powershellExe(): string {
  if (psExe) return psExe
  const r = spawnSync('where', ['pwsh.exe'], { windowsHide: true, encoding: 'utf8' })
  psExe = r.status === 0 && r.stdout.trim() ? 'pwsh.exe' : 'powershell.exe'
  return psExe
}

const PS_PRELUDE =
  '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $OutputEncoding=[System.Text.Encoding]::UTF8; $ProgressPreference="SilentlyContinue"; '

/**
 * Roda um comando no shell do sistema.
 * Linux/macOS: /bin/bash -lc (login shell, pega PATH do nvm, ~/.local/bin etc.)
 * Windows: pwsh/powershell com -EncodedCommand (sem problemas de aspas)
 *
 * No POSIX o processo vira líder do próprio grupo (detached) para podermos
 * matar a árvore inteira com kill(-pid).
 */
export function spawnShell(
  command: string,
  cwd: string,
  env?: Record<string, string>,
  /** Deixa o stdin aberto para mandar texto ao processo (ex: "r" no Vite, respostas a perguntas) */
  stdinPipe = false
): ChildProcess {
  const opts: SpawnOptions = { cwd, env: baseEnv(env), windowsHide: true }
  const stdin = stdinPipe ? 'pipe' : 'ignore'
  if (IS_WIN) {
    const encoded = Buffer.from(PS_PRELUDE + command, 'utf16le').toString('base64')
    return spawn(
      powershellExe(),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { ...opts, stdio: [stdin, 'pipe', 'pipe'] }
    )
  }
  return spawn('/bin/bash', ['-lc', command], { ...opts, detached: true, stdio: [stdin, 'pipe', 'pipe'] })
}

/**
 * Roda o CLI `claude` com argumentos fixos (nunca texto do usuário nos args).
 * O prompt, quando houver, vai pelo stdin.
 */
/**
 * Roda um CLI (claude, gemini…) com argumentos fixos: nunca texto do usuário nos args.
 * O prompt, quando houver, vai pelo stdin.
 */
export function spawnCli(
  bin: string,
  args: string[],
  cwd: string,
  opts?: { stdin?: boolean; env?: Record<string, string> }
): ChildProcess {
  const stdio: SpawnOptions['stdio'] = [opts?.stdin ? 'pipe' : 'ignore', 'pipe', 'pipe']
  if (IS_WIN) {
    // cmd.exe resolve .exe / .cmd pelo PATH e repassa o stdin
    const exe = /\s/.test(bin) ? `"${bin.replace(/"/g, '')}"` : bin
    const line = [exe, ...args.map((a) => (/^[\w./:=-]+$/.test(a) ? a : `"${a.replace(/"/g, '')}"`))].join(' ')
    return spawn(line, [], { cwd, env: baseEnv(opts?.env), windowsHide: true, shell: true, stdio })
  }
  const line = 'exec ' + [bin, ...args].map(bashQuote).join(' ')
  return spawn('/bin/bash', ['-lc', line], { cwd, env: baseEnv(opts?.env), detached: true, stdio })
}

export function spawnClaude(
  args: string[],
  cwd: string,
  opts?: { stdin?: boolean; env?: Record<string, string> }
): ChildProcess {
  // CCC_CLAUDE_BIN permite apontar para um executável específico do Claude Code
  return spawnCli(process.env.CCC_CLAUDE_BIN || 'claude', args, cwd, opts)
}

/** Comando do Codex CLI (ChatGPT): configurável no app (padrão `codex`) ou por CCC_CODEX_BIN */
let codexBin = 'codex'
export function setCodexCommand(cmd: string): void {
  codexBin = cmd.trim() || 'codex'
}
export function spawnCodex(args: string[], cwd: string, opts?: { stdin?: boolean; env?: Record<string, string> }): ChildProcess {
  return spawnCli(process.env.CCC_CODEX_BIN || codexBin, args, cwd, opts)
}

/** Comando do Gemini CLI: configurável no app (padrão `gemini`) ou por CCC_GEMINI_BIN */
let geminiBin = 'gemini'
export function setGeminiCommand(cmd: string): void {
  geminiBin = cmd.trim() || 'gemini'
}
export function spawnGemini(
  args: string[],
  cwd: string,
  opts?: { stdin?: boolean; env?: Record<string, string> }
): ChildProcess {
  return spawnCli(process.env.CCC_GEMINI_BIN || geminiBin, args, cwd, opts)
}

/** Encerra o processo e todos os filhos. Resolve quando o processo terminou (ou após o timeout). */
export function killTree(child: ChildProcess, graceMs = 4000): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) return resolve()
    const pid = child.pid
    let done = false
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve()
    }
    child.once('exit', finish)

    if (IS_WIN) {
      // Console apps no Windows não recebem SIGTERM: taskkill /T derruba a árvore
      spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {
        try {
          child.kill()
        } catch {
          /* ignore */
        }
      })
    } else {
      try {
        process.kill(-pid, 'SIGTERM')
      } catch {
        try {
          child.kill('SIGTERM')
        } catch {
          /* ignore */
        }
      }
    }

    const timer = setTimeout(() => {
      if (!IS_WIN) {
        try {
          process.kill(-pid, 'SIGKILL')
        } catch {
          /* já morreu */
        }
      }
      setTimeout(finish, 300)
    }, graceMs)
  })
}

/** Versão síncrona para o momento de sair do app (não dá para esperar promises). */
export function killTreeSync(child: ChildProcess): void {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return
  if (IS_WIN) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      /* ignore */
    }
  }
}

/** Junta pedaços de stdout em linhas completas; trata \r (barras de progresso). */
export class LineSplitter {
  private buf = ''
  push(chunk: string): string[] {
    this.buf += chunk
    const parts = this.buf.split(/\r?\n/)
    this.buf = parts.pop() ?? ''
    return parts.map(clean)
  }
  flush(): string[] {
    const rest = this.buf
    this.buf = ''
    return rest ? [clean(rest)] : []
  }
}

function clean(line: string): string {
  const s = stripAnsi(line)
  const i = s.lastIndexOf('\r')
  return i >= 0 ? s.slice(i + 1) : s
}

/** Roda `claude <args>` até terminar e devolve a saída (para comandos curtos: mcp add/get/remove, ciclo do Vigia). */
export function runClaudeCapture(
  args: string[],
  opts: { cwd: string; stdin?: string; env?: Record<string, string>; timeoutMs?: number; onLine?: (l: string) => void }
) {
  return runCapture('claude', args, opts)
}

export function runGeminiCapture(
  args: string[],
  opts: { cwd: string; stdin?: string; env?: Record<string, string>; timeoutMs?: number; onLine?: (l: string) => void }
) {
  return runCapture('gemini', args, opts)
}

function runCapture(
  which: 'claude' | 'gemini',
  args: string[],
  opts: { cwd: string; stdin?: string; env?: Record<string, string>; timeoutMs?: number; onLine?: (l: string) => void }
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean; spawnError?: string }> {
  return new Promise((resolve) => {
    const spawnFn = which === 'claude' ? spawnClaude : spawnGemini
    const child = spawnFn(args, opts.cwd, { stdin: opts.stdin !== undefined, env: opts.env })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let spawnError: string | undefined
    const split = new LineSplitter()
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (d: string) => {
      stdout += d
      if (opts.onLine) split.push(d).forEach(opts.onLine)
    })
    child.stderr?.on('data', (d: string) => {
      stderr += d
      if (opts.onLine) stripAnsi(d).split(/\r?\n/).filter(Boolean).forEach(opts.onLine)
    })
    child.on('error', (e: NodeJS.ErrnoException) => {
      spawnError = e.code === 'ENOENT' ? `CLI \`${which}\` não encontrado no PATH.` : e.message
    })
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          void killTree(child)
        }, opts.timeoutMs)
      : null
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      if (opts.onLine) split.flush().forEach(opts.onLine)
      // No Linux o bash responde 127 quando o comando não existe (não vira ENOENT)
      if (code === 127 && !spawnError) spawnError = `CLI \`${which}\` não encontrado no PATH.`
      resolve({ code, stdout: stripAnsi(stdout), stderr: stripAnsi(stderr), timedOut, spawnError })
    })
    if (opts.stdin !== undefined) {
      child.stdin?.on('error', () => {})
      child.stdin?.end(opts.stdin)
    }
  })
}
