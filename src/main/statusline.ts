// Linha de status do Claude Code (opcional): o Claude manda para ela, a cada resposta das sessões
// interativas, um JSON com o uso da janela de 5h e da semana. O script do Hélice grava esse JSON em
// ~/.claude/helice-limits.json (o app lê) e repassa para a linha de status que você já tinha, se tinha.
//
// O que muda no ~/.claude/settings.json: só a chave "statusLine". O valor anterior fica guardado em
// ~/.claude/helice-statusline-prev.json e volta quando você desliga. O resto do arquivo não é tocado.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { OpResult } from '../shared/types'
import { writeFileAtomic } from './fsutil'

const IS_WIN = process.platform === 'win32'
const dir = () => join(homedir(), '.claude')
const settingsFile = () => join(dir(), 'settings.json')
const prevFile = () => join(dir(), 'helice-statusline-prev.json')
const scriptFile = () => join(dir(), IS_WIN ? 'helice-statusline.ps1' : 'helice-statusline.sh')
const MARK = 'helice-statusline'

/** Script que grava o JSON e repassa para a linha de status anterior */
export function statuslineScript(prevCommand: string | null, win: boolean): string {
  if (win) {
    const chain = prevCommand ? `\n$in | & cmd /c ${psQuote(prevCommand)}` : ''
    return [
      '# Hélice: guarda o uso do Claude (para a agenda das fases) e repassa para a linha de status anterior.',
      '# Gerado pelo app; desligue em Configurações → IAs para remover.',
      '$in = [Console]::In.ReadToEnd()',
      '$dst = Join-Path $env:USERPROFILE ".claude\\helice-limits.json"',
      'Set-Content -Path ($dst + ".tmp") -Value $in -NoNewline -Encoding utf8',
      'Move-Item -Force ($dst + ".tmp") $dst' + chain,
      ''
    ].join('\r\n')
  }
  const chain = prevCommand ? `\nprintf '%s' "$input" | sh -c ${shQuote(prevCommand)}` : ''
  return [
    '#!/bin/sh',
    '# Hélice: guarda o uso do Claude (para a agenda das fases) e repassa para a linha de status anterior.',
    '# Gerado pelo app; desligue em Configurações → IAs para remover.',
    'input=$(cat)',
    'dst="$HOME/.claude/helice-limits.json"',
    `printf '%s' "$input" > "$dst.tmp" && mv -f "$dst.tmp" "$dst"` + chain,
    ''
  ].join('\n')
}

const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`
const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`

/** Comando que vai no settings.json */
export function statuslineCommand(win = IS_WIN): string {
  return win ? `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptFile()}"` : `sh "${scriptFile()}"`
}

function readSettings(): { ok: true; data: Record<string, any> } | { ok: false; message: string } {
  const f = settingsFile()
  if (!existsSync(f)) return { ok: true, data: {} }
  try {
    const data = JSON.parse(readFileSync(f, 'utf8'))
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, message: 'O ~/.claude/settings.json não é um objeto JSON; não mexi nele.' }
    return { ok: true, data }
  } catch {
    return { ok: false, message: 'Não consegui ler o ~/.claude/settings.json (JSON inválido?); não mexi nele.' }
  }
}

export function statuslineInstalled(): boolean {
  const r = readSettings()
  return r.ok && typeof r.data.statusLine?.command === 'string' && r.data.statusLine.command.includes(MARK)
}

export function enableStatusline(): OpResult {
  const r = readSettings()
  if (!r.ok) return r
  try {
    mkdirSync(dir(), { recursive: true })
    const data = r.data
    const current = data.statusLine
    const ours = typeof current?.command === 'string' && current.command.includes(MARK)
    if (!ours) writeFileSync(prevFile(), JSON.stringify({ statusLine: current ?? null }, null, 2))
    const prev = ours ? readPrev() : current ?? null
    const prevCmd = prev && typeof prev.command === 'string' && prev.type !== 'static' ? prev.command : null
    writeFileSync(scriptFile(), statuslineScript(prevCmd, IS_WIN), { mode: 0o755 })
    if (existsSync(settingsFile())) copyFileSync(settingsFile(), settingsFile() + '.helice-bak')
    data.statusLine = { type: 'command', command: statuslineCommand(), ...(prev?.padding !== undefined ? { padding: prev.padding } : {}) }
    writeFileAtomic(settingsFile(), JSON.stringify(data, null, 2) + '\n')
    return { ok: true, message: prevCmd ? 'Linha de status ligada (a sua anterior continua aparecendo).' : 'Linha de status ligada.' }
  } catch (e) {
    return { ok: false, message: `Não consegui ligar: ${(e as Error).message}` }
  }
}

function readPrev(): Record<string, any> | null {
  try {
    return JSON.parse(readFileSync(prevFile(), 'utf8')).statusLine ?? null
  } catch {
    return null
  }
}

export function disableStatusline(): OpResult {
  const r = readSettings()
  if (!r.ok) return r
  try {
    const data = r.data
    const ours = typeof data.statusLine?.command === 'string' && data.statusLine.command.includes(MARK)
    if (ours) {
      const prev = readPrev()
      if (prev) data.statusLine = prev
      else delete data.statusLine
      writeFileAtomic(settingsFile(), JSON.stringify(data, null, 2) + '\n')
    }
    for (const f of [scriptFile(), prevFile()]) rmSync(f, { force: true })
    return { ok: true, message: ours ? 'Linha de status desligada; a anterior foi restaurada.' : 'Linha de status já estava desligada.' }
  } catch (e) {
    return { ok: false, message: `Não consegui desligar: ${(e as Error).message}` }
  }
}
