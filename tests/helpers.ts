// Utilidades dos testes: pasta temporária de dados do app, repositórios git e servidores HTTP falsos.
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { createServer, type IncomingMessage, type Server } from 'http'
import { tmpdir } from 'os'
import { join } from 'path'

// Identidade do git para os testes (as máquinas do CI não têm nome/e-mail configurados)
Object.assign(process.env, {
  GIT_AUTHOR_NAME: 'Teste',
  GIT_AUTHOR_EMAIL: 'teste@example.com',
  GIT_COMMITTER_NAME: 'Teste',
  GIT_COMMITTER_EMAIL: 'teste@example.com'
})

/** Espera a condição ficar verdadeira (máquinas lentas do CI) */
export async function until(fn: () => boolean, timeoutMs = 8000): Promise<void> {
  const end = Date.now() + timeoutMs
  while (!fn()) {
    if (Date.now() > end) throw new Error('tempo esgotado esperando a condição')
    await new Promise((r) => setTimeout(r, 25))
  }
}

/** Chame ANTES de importar store/secrets: cada arquivo de teste tem a própria pasta de dados */
export function useTempUserData(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ccc-ud-'))
  process.env.CCC_TEST_USERDATA = dir
  return dir
}

export function tempDir(prefix = 'ccc-t-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

export function sh(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
  }).trim()
}

/** Remoto "bare" + clone de trabalho com um commit na master */
export function makeRepo(): { remote: string; work: string; other: () => string } {
  const base = tempDir('ccc-git-')
  const remote = join(base, 'remote.git')
  mkdirSync(remote)
  sh(remote, 'init', '-q', '--bare', '-b', 'master')
  const work = join(base, 'work')
  sh(base, 'clone', '-q', remote, work)
  sh(work, 'checkout', '-q', '-b', 'master')
  writeFileSync(join(work, 'app.txt'), 'base\n')
  sh(work, 'add', '.')
  sh(work, 'commit', '-q', '-m', 'base')
  sh(work, 'push', '-q', 'origin', 'master')
  sh(work, 'remote', 'set-head', 'origin', 'master')
  let n = 0
  /** Outro clone (simula um colega) */
  const other = () => {
    const dir = join(base, `other${n++}`)
    sh(base, 'clone', '-q', remote, dir)
    return dir
  }
  return { remote, work, other }
}

export async function readBody(req: IncomingMessage): Promise<string> {
  let b = ''
  for await (const c of req) b += c
  return b
}

export function listen(handler: Parameters<typeof createServer>[1]): Promise<{ url: string; server: Server }> {
  return new Promise((resolve) => {
    const server = createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const a = server.address()
      resolve({ url: `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`, server })
    })
  })
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** RunManager falso: guarda os pedidos e deixa o teste emitir os eventos */
export function fakeRuns() {
  const started: Array<{ id: string; req: any }> = []
  const stopped: string[] = []
  let running = new Set<string>()
  return {
    started,
    stopped,
    start(req: any) {
      const id = `run${started.length + 1}`
      started.push({ id, req })
      running.add(id)
      return id
    },
    async stop(id: string) {
      stopped.push(id)
      running.delete(id)
    },
    isRunning: (id: string) => running.has(id),
    done(id: string) {
      running.delete(id)
    },
    reset() {
      running = new Set()
    }
  }
}
