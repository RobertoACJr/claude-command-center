// Abrir projeto/arquivo no editor (VS Code, Cursor, PhpStorm…): detecta os instalados e abre na linha certa
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { isAbsolute, join } from 'path'
import type { EditorInfo, OpResult } from '../shared/types'
import { envWithPath } from './proc'

const IS_WIN = process.platform === 'win32'
const IS_MAC = process.platform === 'darwin'
const home = homedir()
const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')

type ArgsFn = (folder: string, file?: string, line?: number) => string[]
interface EditorDef {
  id: string
  label: string
  bins: string[]
  /** Pastas onde o instalador costuma pôr o comando (além do PATH) */
  extra: string[]
  args: ArgsFn
}

// VS Code e derivados: pasta + -g arquivo:linha (abre na janela da pasta)
const vsArgs: ArgsFn = (folder, file, line) => (file ? [folder, '-g', `${file}:${line ?? 1}`] : [folder])
// JetBrains: --line N arquivo (o projeto abre junto se a pasta for de um projeto)
const jbArgs: ArgsFn = (folder, file, line) => (file ? ['--line', String(line ?? 1), file] : [folder])
const colonArgs: ArgsFn = (folder, file, line) => (file ? [folder, `${file}:${line ?? 1}`] : [folder])

const jb = (id: string, label: string): EditorDef => ({
  id,
  label,
  bins: [id],
  extra: IS_WIN ? [join(local, 'JetBrains', 'Toolbox', 'scripts')] : IS_MAC ? [join(home, 'Library', 'Application Support', 'JetBrains', 'Toolbox', 'scripts')] : [join(home, '.local', 'share', 'JetBrains', 'Toolbox', 'scripts')],
  args: jbArgs
})

export const EDITORS: EditorDef[] = [
  {
    id: 'code',
    label: 'VS Code',
    bins: ['code'],
    extra: IS_WIN ? [join(local, 'Programs', 'Microsoft VS Code', 'bin')] : IS_MAC ? ['/Applications/Visual Studio Code.app/Contents/Resources/app/bin'] : ['/snap/bin'],
    args: vsArgs
  },
  {
    id: 'cursor',
    label: 'Cursor',
    bins: ['cursor'],
    extra: IS_WIN ? [join(local, 'Programs', 'cursor', 'resources', 'app', 'bin')] : IS_MAC ? ['/Applications/Cursor.app/Contents/Resources/app/bin'] : [],
    args: vsArgs
  },
  { id: 'windsurf', label: 'Windsurf', bins: ['windsurf'], extra: IS_WIN ? [join(local, 'Programs', 'Windsurf', 'bin')] : [], args: vsArgs },
  jb('phpstorm', 'PhpStorm'),
  jb('webstorm', 'WebStorm'),
  jb('idea', 'IntelliJ IDEA'),
  jb('pycharm', 'PyCharm'),
  { id: 'subl', label: 'Sublime Text', bins: ['subl'], extra: IS_WIN ? ['C:\\Program Files\\Sublime Text'] : [], args: colonArgs },
  { id: 'zed', label: 'Zed', bins: ['zed'], extra: [], args: colonArgs }
]

function findBin(def: EditorDef): string | null {
  const env = envWithPath()
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH'
  const dirs = [...(env[key] ?? '').split(IS_WIN ? ';' : ':'), ...def.extra].filter(Boolean)
  const exts = IS_WIN ? ['.cmd', '.exe', '.bat', ''] : ['']
  for (const dir of dirs) for (const b of def.bins) for (const e of exts) {
    const f = join(dir, b + e)
    if (existsSync(f)) return f
  }
  return null
}

/** Editores encontrados neste PC */
export function detectEditors(): EditorInfo[] {
  return EDITORS.map((e) => ({ id: e.id, label: e.label, found: !!findBin(e) }))
}

/** Comando próprio: {pasta}, {arquivo} e {linha} */
export function customArgs(template: string, folder: string, file?: string, line?: number): string[] {
  const parts = template.match(/"[^"]*"|\S+/g) ?? []
  return parts.map((p) =>
    p
      .replace(/^"|"$/g, '')
      .replace(/\{pasta\}/g, folder)
      .replace(/\{arquivo\}/g, file ?? folder)
      .replace(/\{linha\}/g, String(line ?? 1))
  )
}

const winQuote = (a: string) => (/[\s&()^%!"]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a)

export function openInEditor(editor: string, custom: string, folder: string, file?: string, line?: number): OpResult {
  if (!folder || !existsSync(folder)) return { ok: false, message: 'A pasta do projeto não existe.' }
  const abs = file ? (isAbsolute(file) ? file : join(folder, file)) : undefined
  let bin: string | null
  let args: string[]
  if (editor === 'custom') {
    const all = customArgs(custom, folder, abs, line)
    if (!all.length) return { ok: false, message: 'Escreva o comando do editor em Configurações → Geral.' }
    ;[bin, ...args] = all as [string, ...string[]]
  } else {
    const def = EDITORS.find((e) => e.id === editor) ?? detectFirst()
    if (!def) return { ok: false, message: 'Nenhum editor encontrado. Escolha um em Configurações → Geral → Editor.' }
    bin = findBin(def)
    if (!bin) return { ok: false, message: `Não achei o ${def.label} neste PC. No VS Code/Cursor, rode "Shell Command: Install 'code' command in PATH".` }
    args = def.args(folder, abs, line)
  }
  try {
    // .cmd no Windows só roda pelo shell
    const viaShell = IS_WIN && /\.(cmd|bat)$/i.test(bin)
    const child = viaShell
      ? spawn([winQuote(bin), ...args.map(winQuote)].join(' '), { cwd: folder, detached: true, stdio: 'ignore', shell: true, windowsHide: true, env: envWithPath() })
      : spawn(bin, args, { cwd: folder, detached: true, stdio: 'ignore', windowsHide: true, env: envWithPath() })
    child.on('error', () => {})
    child.unref()
    return { ok: true, message: 'Abrindo no editor…' }
  } catch (e) {
    return { ok: false, message: `Não consegui abrir o editor: ${(e as Error).message}` }
  }
}

function detectFirst(): EditorDef | undefined {
  return EDITORS.find((e) => !!findBin(e))
}
