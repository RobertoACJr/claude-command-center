import type { ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import type { AppConfig, Project, RemoteSession } from '../shared/types'
import { LineSplitter, killTree, killTreeSync, spawnClaude } from './proc'

const URL_RE = /https:\/\/claude\.ai\/code[^\s'"<>)\]]*/i
const NEEDS_SETUP_RE = /workspace not trusted|trust .*\?\s*\[y\/n\]|enable remote control\?|spawn mode for this project/i
const NOT_ELIGIBLE_RE = /disabled by your organization|not available|requires a claude\.ai|log ?in|sign ?in/i

interface Entry {
  child: ChildProcess
  session: RemoteSession
  path: string
}

/**
 * Mantém um `claude remote-control` rodando para cada projeto com remoteEnabled
 * enquanto o status for OFF. `sync()` reconcilia o estado desejado com o atual.
 */
export class RemoteManager {
  private entries = new Map<string, Entry>()
  /** Sessões que terminaram com erro/setup pendente: ficam visíveis até o próximo sync/restart */
  private finished = new Map<string, RemoteSession>()
  private lastConfig: AppConfig | null = null
  /** Escolha manual por projeto (botão no card): true = ligado, false = desligado. Sem entrada = automático */
  private overrides = new Map<string, boolean>()

  constructor(private notify: (sessions: RemoteSession[]) => void) {}

  list(): RemoteSession[] {
    return [...[...this.entries.values()].map((e) => e.session), ...this.finished.values()]
  }

  private changed() {
    this.notify(this.list())
  }

  sync(config: AppConfig): void {
    this.lastConfig = config
    const desired = new Map<string, Project>()
    for (const p of config.projects) {
      const auto = config.status === 'off' && p.remoteEnabled
      if (this.overrides.has(p.id) ? this.overrides.get(p.id) : auto) desired.set(p.id, p)
    }
    // Esquece escolhas de projetos que foram excluídos
    for (const id of this.overrides.keys()) if (!config.projects.some((p) => p.id === id)) this.overrides.delete(id)

    // Para o que não deveria estar rodando (ou mudou de pasta)
    for (const [id, entry] of this.entries) {
      const want = desired.get(id)
      if (!want || want.path !== entry.path) void this.stop(id)
    }
    // Limpa erros antigos de projetos que não estão mais no conjunto desejado
    for (const id of [...this.finished.keys()]) if (!desired.has(id)) this.finished.delete(id)

    // Sobe o que falta (sem reiniciar automaticamente quem falhou: evita loop)
    for (const [id, p] of desired) {
      if (!this.entries.has(id) && !this.finished.has(id)) this.start(p)
    }
    this.changed()
  }

  /** Botão do card: liga/desliga o Remote Control deste projeto, independente do modo */
  setManual(projectId: string, on: boolean): void {
    this.overrides.set(projectId, on)
    if (!on) this.finished.delete(projectId)
    if (this.lastConfig) this.sync(this.lastConfig)
  }

  /**
   * Mudança de presença. Volta ao comportamento automático; com keepRunning,
   * as sessões abertas agora continuam (viram "ligadas manualmente").
   */
  presenceChanged(keepRunning: boolean): void {
    const running = [...this.entries.keys()]
    this.overrides.clear()
    if (keepRunning) for (const id of running) this.overrides.set(id, true)
  }

  activeCount(): number {
    return [...this.entries.values()].filter((e) => e.session.state !== 'stopping').length
  }

  /** Tenta de novo um projeto que falhou (ou reinicia um ativo). */
  restart(projectId: string): void {
    this.finished.delete(projectId)
    if (this.entries.has(projectId)) {
      void this.stop(projectId) // ao fechar, o sync() abaixo sobe de novo
    } else if (this.lastConfig) {
      this.sync(this.lastConfig)
    }
  }

  private start(p: Project): void {
    const session: RemoteSession = {
      projectId: p.id,
      projectName: p.name,
      state: 'starting',
      startedAt: Date.now(),
      tail: []
    }

    if (!existsSync(p.path)) {
      session.state = 'error'
      session.message = `Pasta não encontrada: ${p.path}`
      this.finished.set(p.id, session)
      this.changed()
      return
    }

    const name = `${p.name} · Command Center`.replace(/[^\w .·-]/g, '').slice(0, 60)
    // --spawn same-dir evita a pergunta interativa "Spawn mode for this project"
    const child = spawnClaude(['remote-control', '--name', name, '--spawn', 'same-dir'], p.path)
    session.pid = child.pid
    const entry: Entry = { child, session, path: p.path }
    this.entries.set(p.id, entry)

    const onLine = (line: string) => {
      const text = line.trim()
      if (!text) return
      session.tail = [...session.tail, text].slice(-12)
      const url = text.match(URL_RE)?.[0]
      if (url && session.state !== 'stopping') {
        session.url = url
        session.state = 'active'
        session.message = undefined
      } else if (NEEDS_SETUP_RE.test(text)) {
        session.state = 'needs-setup'
        session.message =
          'Primeira vez nesta pasta: rode `claude remote-control` uma vez num terminal aqui e responda "y" às perguntas de confiança/ativação.'
      }
      this.changed()
    }

    const out = new LineSplitter()
    const err = new LineSplitter()
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (d: string) => out.push(d).forEach(onLine))
    child.stderr?.on('data', (d: string) => err.push(d).forEach(onLine))

    child.on('error', (e: NodeJS.ErrnoException) => {
      session.state = 'error'
      session.message =
        e.code === 'ENOENT' ? 'CLI `claude` não encontrado no PATH.' : `Falha ao iniciar: ${e.message}`
      this.changed()
    })

    child.on('close', (code) => {
      ;[...out.flush(), ...err.flush()].forEach(onLine)
      const current = this.entries.get(p.id)
      if (current?.child !== child) return // já substituído
      this.entries.delete(p.id)
      if (session.state === 'stopping') {
        // Pode ter havido OFF→ON→OFF rápido, ou restart: reconcilia de novo
        if (this.lastConfig) this.sync(this.lastConfig)
        else this.changed()
        return
      }
      // Saiu sozinho: guarda o motivo para mostrar no card
      if (session.state !== 'needs-setup') {
        session.state = 'error'
        const last = session.tail.at(-1)
        session.message =
          last && NOT_ELIGIBLE_RE.test(last)
            ? last
            : `Processo encerrou (código ${code ?? '?'})${last ? `: ${last}` : ''}`
      }
      session.url = undefined
      this.finished.set(p.id, session)
      this.changed()
    })

    this.changed()
  }

  async stop(projectId: string): Promise<void> {
    const entry = this.entries.get(projectId)
    if (!entry) return
    entry.session.state = 'stopping'
    this.changed()
    await killTree(entry.child) // SIGTERM no grupo; SIGKILL após 4s se precisar
  }

  async stopAll(): Promise<void> {
    this.lastConfig = null
    this.overrides.clear()
    this.finished.clear()
    await Promise.all([...this.entries.keys()].map((id) => this.stop(id)))
  }

  stopAllSync(): void {
    this.lastConfig = null
    for (const e of this.entries.values()) killTreeSync(e.child)
    this.entries.clear()
  }
}
