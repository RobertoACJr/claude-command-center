import { spawn, spawnSync } from 'child_process'
import { existsSync } from 'fs'
import type { OpResult, TerminalPreset } from '../shared/types'
import { bashQuote, envWithPath, IS_WIN } from './proc'

/** Comandos que podem ser abertos num terminal do sistema: lista fechada, nada vindo de texto livre */
const PRESETS: Record<TerminalPreset, string> = {
  'remote-control': 'claude remote-control',
  claude: 'claude',
  gemini: 'gemini',
  codex: 'codex login',
  'gchat-login': 'google-chat-mcp login',
  'gh-login': 'gh auth login'
}

function has(cmd: string): boolean {
  return spawnSync('/bin/bash', ['-lc', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0
}

/**
 * Abre o terminal de verdade do sistema na pasta (para coisas interativas: logins, perguntas y/n).
 * Linux: gnome-terminal, konsole, xfce4-terminal, tilix, kitty, alacritty, x-terminal-emulator ou xterm.
 * Windows: Windows Terminal (wt) se houver, senão uma janela do PowerShell.
 */
/**
 * Abre o terminal do sistema na pasta. `preset` vem da interface (lista fechada);
 * `command` só é montado aqui no processo principal (ex.: entrar num container), nunca vem pronto da tela.
 */
export function openSystemTerminal(cwd: string, preset?: TerminalPreset, command?: string, extraEnv?: Record<string, string>): OpResult {
  const env = { ...envWithPath(), ...(extraEnv ?? {}) }
  if (!cwd || !existsSync(cwd)) return { ok: false, message: `Pasta não encontrada: ${cwd}` }
  const cmd = command ?? (preset ? PRESETS[preset] : '')
  if (preset && !cmd) return { ok: false, message: 'Comando desconhecido.' }

  try {
    if (IS_WIN) {
      const psArgs = ['-NoExit', '-NoLogo', ...(cmd ? ['-Command', cmd] : [])]
      const hasWt = spawnSync('where', ['wt.exe'], { windowsHide: true }).status === 0
      const child = hasWt
        ? spawn('wt.exe', ['-d', cwd, 'powershell.exe', ...psArgs], { cwd, detached: true, stdio: 'ignore', env })
        : spawn('powershell.exe', psArgs, { cwd, detached: true, stdio: 'ignore', windowsHide: false, env })
      child.on('error', () => {})
      child.unref()
      return { ok: true, message: 'Terminal aberto.' }
    }

    // Mantém o terminal aberto depois do comando (exec bash) para dar para ler a saída
    const inner = cmd ? `${cmd}; echo; echo "(pode fechar esta janela)"; exec bash` : 'exec bash'
    const shell = ['bash', '-lc', inner]
    const candidates: Array<[string, string[]]> = [
      ['gnome-terminal', [`--working-directory=${cwd}`, '--', ...shell]],
      ['konsole', ['--workdir', cwd, '-e', ...shell]],
      ['xfce4-terminal', [`--working-directory=${cwd}`, '-x', ...shell]],
      ['tilix', ['-w', cwd, '-e', `bash -lc ${bashQuote(inner)}`]],
      ['kitty', ['--directory', cwd, ...shell]],
      ['alacritty', ['--working-directory', cwd, '-e', ...shell]],
      ['x-terminal-emulator', ['-e', ...shell]],
      ['xterm', ['-e', ...shell]]
    ]
    const found = candidates.find(([bin]) => has(bin))
    if (!found) return { ok: false, message: 'Nenhum terminal encontrado (instale o gnome-terminal ou outro).' }
    const child = spawn(found[0], found[1], { cwd, detached: true, stdio: 'ignore', env })
    child.on('error', () => {})
    child.unref()
    return { ok: true, message: `Terminal aberto (${found[0]}).` }
  } catch (err) {
    return { ok: false, message: (err as Error).message }
  }
}
