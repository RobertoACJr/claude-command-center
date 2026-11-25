import type { OpResult, PortOwner } from '../shared/types'
import { IS_WIN, shellCapture } from './proc'

/** `ss -ltnpH sport = :8000` → users:(("node",pid=1234,fd=21)) */
export function parseSs(out: string): PortOwner | null {
  const m = out.match(/users:\(\("([^"]+)",pid=(\d+)/)
  return m ? { name: m[1], pid: Number(m[2]) } : null
}

/** `lsof -nP -iTCP:8000 -sTCP:LISTEN -Fpc` → p1234 / cnode */
export function parseLsof(out: string): PortOwner | null {
  const pid = out.match(/^p(\d+)/m)
  const name = out.match(/^c(.+)$/m)
  return pid ? { pid: Number(pid[1]), name: name?.[1].trim() ?? '?' } : null
}

/** "1234 node" (saída do PowerShell abaixo) */
export function parseWin(out: string): PortOwner | null {
  const m = out.trim().match(/^(\d+)\s+(\S+)/m)
  return m ? { pid: Number(m[1]), name: m[2] } : null
}

/** Processo do Docker: matar ele derruba todos os containers (use o comando de parar do projeto) */
export function isDockerProcess(name: string): boolean {
  return /docker|wslrelay|vpnkit|com\.docker|containerd|rootlesskit/i.test(name)
}

export async function portOwner(port: number): Promise<PortOwner | null> {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null
  if (IS_WIN) {
    const r = await shellCapture(
      `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $p = Get-Process -Id $c.OwningProcess -ErrorAction SilentlyContinue; "$($c.OwningProcess) $($p.ProcessName)" }`,
      process.cwd(),
      15_000
    )
    return parseWin(r.out)
  }
  const ss = await shellCapture(`ss -ltnpH 'sport = :${port}' 2>/dev/null`, process.cwd(), 8000)
  const a = parseSs(ss.out)
  if (a) return a
  const ls = await shellCapture(`lsof -nP -iTCP:${port} -sTCP:LISTEN -Fpc 2>/dev/null`, process.cwd(), 8000)
  return parseLsof(ls.out)
}

export async function killPortOwner(port: number): Promise<OpResult> {
  const o = await portOwner(port)
  if (!o) return { ok: false, message: `Não achei quem está usando a porta ${port} (pode ser de outro usuário ou do sistema).` }
  if (isDockerProcess(o.name)) {
    return { ok: false, message: `A porta ${port} é de um container do Docker (${o.name}). Pare pelo projeto (comando de parar, ex.: docker compose stop) em vez de matar o Docker.` }
  }
  const r = IS_WIN
    ? await shellCapture(`Stop-Process -Id ${o.pid} -Force`, process.cwd(), 10_000)
    : await shellCapture(`kill ${o.pid} 2>/dev/null; sleep 2; kill -0 ${o.pid} 2>/dev/null && kill -9 ${o.pid}; true`, process.cwd(), 10_000)
  return r.code === 0
    ? { ok: true, message: `Encerrei ${o.name} (PID ${o.pid}), que estava na porta ${port}.` }
    : { ok: false, message: `Não consegui encerrar ${o.name} (PID ${o.pid}): ${(r.err || r.out).trim()}` }
}
