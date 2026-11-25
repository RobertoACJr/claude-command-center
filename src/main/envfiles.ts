import { copyFileSync, existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import type { OpResult, Project } from '../shared/types'

/**
 * Perfis de .env: arquivos .env.<nome> na pasta do projeto (ex.: .env.local, .env.homolog).
 * Trocar copia o escolhido por cima do .env (guardando o atual em .env.anterior).
 */
const SKIP = new Set(['.env.example', '.env.anterior', '.env.backup', '.env.sample', '.env.dist'])

export function envProfiles(p: Project): { files: string[]; active: string | null } {
  if (!p.path || !existsSync(p.path)) return { files: [], active: null }
  const files = readdirSync(p.path)
    .filter((f) => /^\.env\.[\w.-]+$/.test(f) && !SKIP.has(f))
    .sort()
  const envPath = join(p.path, '.env')
  if (!existsSync(envPath)) return { files, active: null }
  const cur = readFileSync(envPath, 'utf8')
  const active = files.find((f) => readFileSync(join(p.path, f), 'utf8') === cur) ?? null
  return { files, active }
}

export function envSwitch(p: Project, file: string): OpResult {
  const { files } = envProfiles(p)
  if (!files.includes(file)) return { ok: false, message: 'Arquivo de ambiente não encontrado.' }
  const envPath = join(p.path, '.env')
  if (existsSync(envPath)) copyFileSync(envPath, join(p.path, '.env.anterior'))
  copyFileSync(join(p.path, file), envPath)
  return { ok: true, message: `.env agora é o ${file} (o anterior ficou em .env.anterior). Reinicie o projeto para valer.` }
}
