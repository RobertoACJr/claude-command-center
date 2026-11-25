import { existsSync, readFileSync, statSync } from 'fs'
import { isAbsolute, join } from 'path'
import type { DockerService, DockerStatus, LogSource, Project } from '../shared/types'
import { bashQuote, IS_WIN, shellCapture } from './proc'

/**
 * Docker Compose do projeto: lista os serviços (com CPU e memória), entra no container,
 * reinicia, roda comandos e mostra logs. Tudo pelo comando do compose do cadastro
 * (padrão "docker compose"), então serve para qualquer projeto, não só Laravel.
 */

const COMPOSE_FILES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml']
/** Nome de serviço do compose: letras, números, ponto, traço e sublinhado */
export const SAFE_SERVICE = /^[A-Za-z0-9][\w.-]*$/

export function hasComposeFile(p: Project): boolean {
  if (!p.path) return false
  // Comando com -f próprio: confia no cadastro
  if (/\s-f\s|--file/.test(p.dockerCommand)) return true
  return COMPOSE_FILES.some((f) => existsSync(join(p.path, f)))
}

/** Comando do compose do cadastro, sem nada perigoso (só o que dá para digitar num terminal normal) */
export function composeCmd(p: Project): string {
  const c = (p.dockerCommand || 'docker compose').trim()
  return /[;&|`$<>\n]/.test(c) ? 'docker compose' : c
}

/**
 * `docker compose ps --format json`: versões novas soltam um JSON por linha; algumas antigas, um array.
 */
export function parseComposePs(out: string): DockerService[] {
  const txt = out.trim()
  if (!txt) return []
  let rows: Array<Record<string, unknown>> = []
  if (txt.startsWith('[')) {
    try {
      rows = JSON.parse(txt)
    } catch {
      rows = []
    }
  } else {
    for (const line of txt.split('\n')) {
      const l = line.trim()
      if (!l.startsWith('{')) continue
      try {
        rows.push(JSON.parse(l))
      } catch {
        /* linha quebrada: ignora */
      }
    }
  }
  const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))
  return rows
    .map((r) => {
      const pubs = Array.isArray(r.Publishers)
        ? (r.Publishers as Array<Record<string, unknown>>)
            .filter((x) => Number(x.PublishedPort) > 0)
            .map((x) => `${x.PublishedPort}→${x.TargetPort}`)
        : []
      return {
        name: str(r.Service) || str(r.Name),
        state: (str(r.State) || 'unknown').toLowerCase(),
        status: str(r.Status),
        container: str(r.Name) || str(r.ID),
        ports: [...new Set(pubs)].join(', ') || str(r.Ports)
      }
    })
    .filter((s) => s.name)
}

/** `docker stats --no-stream --format json`: CPU e memória por container */
export function parseStats(out: string): Map<string, { cpu: string; mem: string }> {
  const m = new Map<string, { cpu: string; mem: string }>()
  for (const line of out.split('\n')) {
    const l = line.trim()
    if (!l.startsWith('{')) continue
    try {
      const j = JSON.parse(l) as Record<string, string>
      const mem = (j.MemUsage ?? '').split('/')[0].trim()
      m.set(j.Name ?? j.Container, { cpu: j.CPUPerc ?? '', mem })
    } catch {
      /* ignora */
    }
  }
  return m
}

export async function dockerStatus(p: Project): Promise<DockerStatus> {
  if (!p.path || !existsSync(p.path)) return { compose: false, ok: false, message: 'Pasta do projeto não encontrada neste PC.', services: [] }
  if (!hasComposeFile(p)) return { compose: false, ok: true, services: [] }
  const cc = composeCmd(p)
  const [ps, names] = await Promise.all([
    shellCapture(`${cc} ps --all --format json`, p.path, 20_000),
    shellCapture(`${cc} config --services`, p.path, 20_000)
  ])
  if (ps.code !== 0) {
    const why = (ps.err || ps.out).trim().split('\n').slice(-2).join(' ')
    const msg = /not recognized|command not found|não é reconhecido/i.test(why)
      ? 'O Docker não foi encontrado neste PC (ou não está no PATH).'
      : /daemon|pipe|Cannot connect|docker_engine/i.test(why)
        ? 'O Docker não está rodando. Abra o Docker Desktop (ou inicie o serviço) e tente de novo.'
        : why || 'O docker compose não respondeu.'
    return { compose: true, ok: false, message: msg, services: [] }
  }
  const services = parseComposePs(ps.out)
  // Serviços do arquivo que nunca foram criados também aparecem (para dar para subir/entrar depois)
  for (const n of names.out.split('\n').map((x) => x.trim()).filter((x) => SAFE_SERVICE.test(x))) {
    if (!services.some((s) => s.name === n)) services.push({ name: n, state: 'none', status: 'não criado', container: '', ports: '' })
  }
  const running = services.filter((s) => s.state === 'running' && s.container)
  if (running.length) {
    const st = await shellCapture(
      `docker stats --no-stream --format json ${running.map((s) => (IS_WIN ? s.container : bashQuote(s.container))).join(' ')}`,
      p.path,
      15_000
    )
    const stats = parseStats(st.out)
    for (const s of services) {
      const x = stats.get(s.container)
      if (x) Object.assign(s, x)
    }
  }
  services.sort((a, b) => a.name.localeCompare(b.name))
  return { compose: true, ok: true, services }
}

/** Comando para entrar no container (bash se tiver, senão sh) */
export function shellCommand(p: Project, service: string): string {
  return `${composeCmd(p)} exec ${service} sh -c 'command -v bash >/dev/null 2>&1 && exec bash || exec sh'`
}

export function execCommand(p: Project, service: string, command: string): string {
  // -T: sem terminal interativo (a saída vem para a aba do app)
  return `${composeCmd(p)} exec -T ${service} ${command}`
}

/** Caminho do arquivo de log (relativo à pasta do projeto ou absoluto) */
export function logFilePath(p: Project, path: string): string {
  return isAbsolute(path) ? path : join(p.path, path)
}

/**
 * Comando que fica mostrando o log, conforme a fonte do cadastro.
 * Arquivo: tail -F no Linux, Get-Content -Wait no Windows (as últimas 300 linhas e depois o que chegar).
 */
export function logCommand(p: Project, src: LogSource): { ok: true; command: string } | { ok: false; message: string } {
  if (src.kind === 'docker') {
    if (!SAFE_SERVICE.test(src.service)) return { ok: false, message: 'Informe o serviço do docker compose onde está o log.' }
    return { ok: true, command: `${composeCmd(p)} logs -f --tail 300 ${src.service}` }
  }
  if (src.kind === 'file') {
    if (!src.path) return { ok: false, message: 'Informe o caminho do arquivo de log.' }
    const f = logFilePath(p, src.path)
    if (!existsSync(f) || !statSync(f).isFile()) return { ok: false, message: `Arquivo de log não encontrado: ${f}` }
    return IS_WIN
      ? { ok: true, command: `Get-Content -LiteralPath '${f.replace(/'/g, "''")}' -Tail 300 -Wait` }
      : { ok: true, command: `tail -n 300 -F ${bashQuote(f)}` }
  }
  if (src.kind === 'command') {
    if (!src.command) return { ok: false, message: 'Informe o comando que mostra o log.' }
    return { ok: true, command: src.command }
  }
  return { ok: false, message: 'Defina onde fica o log no cadastro do projeto (aba Docker e log).' }
}

/**
 * Sugestões para o cadastro a partir do que existe na pasta (sem amarrar a nenhum framework):
 * Laravel → storage/logs/laravel.log e comandos do artisan; Node → npm; compose → serviços.
 */
export function suggestions(p: Project): { logPath?: string; commands: Array<{ name: string; command: string }> } {
  const has = (f: string) => p.path && existsSync(join(p.path, f))
  const out: { logPath?: string; commands: Array<{ name: string; command: string }> } = { commands: [] }
  if (has('artisan')) {
    out.logPath = 'storage/logs/laravel.log'
    out.commands.push(
      { name: 'Migrations', command: 'php artisan migrate' },
      { name: 'Limpar caches', command: 'php artisan optimize:clear' },
      { name: 'Rotas', command: 'php artisan route:list' },
      { name: 'Composer install', command: 'composer install' },
      { name: 'Testes', command: 'php artisan test' }
    )
  }
  if (has('package.json')) {
    out.commands.push({ name: 'npm install', command: 'npm install' })
    try {
      const pkg = JSON.parse(readFileSync(join(p.path, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
      for (const k of ['migrate', 'test', 'lint', 'build']) if (pkg.scripts?.[k]) out.commands.push({ name: `npm run ${k}`, command: `npm run ${k}` })
    } catch {
      /* package.json inválido */
    }
  }
  return out
}

/** Linha de log que parece erro (Laravel "local.ERROR:", stack traces, fatais de PHP/Node, nível error em JSON) */
export const LOG_ERROR_RE =
  /(\.(ERROR|CRITICAL|ALERT|EMERGENCY):|\bPHP (Fatal|Parse) error\b|\bUncaught\b|\bUnhandled(PromiseRejection| rejection)\b|"level(_name)?":\s*"?(error|critical|50)\b|\bTraceback \(most recent call last\)|^\s*(Error|TypeError|ReferenceError|SyntaxError):|\[ERROR\]|\bFATAL\b)/i
