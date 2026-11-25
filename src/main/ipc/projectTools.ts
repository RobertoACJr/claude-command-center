import { existsSync } from 'fs'
import { ipcMain } from 'electron'
import type { LogSource, OpResult, Project, WorkProfile } from '../../shared/types'
import type { AppLogs } from '../applog'
import { composeCmd, dockerStatus, execCommand as dockerExecCommand, hasComposeFile, SAFE_SERVICE, shellCommand as dockerShellCommand, suggestions as dockerSuggestions } from '../docker'
import { envProfiles, envSwitch } from '../envfiles'
import { linkedProjectsOf, syncWithRemote } from '../git'
import { killPortOwner, portOwner } from '../ports'
import { shellCapture } from '../proc'
import type { ProjectProcesses } from '../projects'
import type { RunManager } from '../runner'
import type { store as Store } from '../store'
import { openSystemTerminal } from '../systerm'

/**
 * Ferramentas do card do projeto: executar/parar (só este ou o grupo), sincronizar branches dos ligados,
 * Docker (estado, shell, reiniciar, comandos), log da aplicação, porta ocupada, .env e perfis de trabalho.
 */
export function registerProjectToolsIpc(d: {
  store: typeof Store
  runs: RunManager
  projects: ProjectProcesses
  appLogs: AppLogs
  runProfile: (id: string) => Promise<OpResult>
}): void {
  const { store, runs, projects, appLogs, runProfile } = d
  const projOf = (id: string) => store.get().projects.find((x) => x.id === id)
  ipcMain.handle('projects:syncBranches', async (_e, id: string, target: 'branch' | 'main') => {
    const all = store.get().projects
    const p = all.find((x) => x.id === id)
    if (!p) return { ok: false, message: 'Projeto não encontrado.' }
    const t = target === 'main' ? 'main' : 'branch'
    const lines: string[] = []
    let ok = true
    for (const q of [p, ...linkedProjectsOf(p, all)]) {
      if (!q.path) continue
      const r = await syncWithRemote(q, t)
      if (!r.ok) ok = false
      lines.push(`${q.name}: ${r.message}`)
    }
    return { ok, message: lines.join('\n') }
  })
  ipcMain.handle('docker:status', (_e, id: string) => {
    const p = projOf(String(id))
    return p ? dockerStatus(p) : { compose: false, ok: false, message: 'Projeto não encontrado.', services: [] }
  })
  ipcMain.handle('docker:shell', (_e, id: string, service: string) => {
    const p = projOf(String(id))
    if (!p || !SAFE_SERVICE.test(String(service))) return { ok: false, message: 'Serviço inválido.' }
    return openSystemTerminal(p.path, undefined, dockerShellCommand(p, String(service)))
  })
  ipcMain.handle('docker:restart', async (_e, id: string, service: string) => {
    const p = projOf(String(id))
    if (!p || !SAFE_SERVICE.test(String(service))) return { ok: false, message: 'Serviço inválido.' }
    const r = await shellCapture(`${composeCmd(p)} restart ${service}`, p.path, 120_000)
    return r.code === 0 ? { ok: true, message: `${service} reiniciado.` } : { ok: false, message: (r.err || r.out).trim().split('\n').slice(-2).join(' ') }
  })
  ipcMain.handle('docker:exec', (_e, id: string, service: string, command: string) => {
    const p = projOf(String(id))
    if (!p || !SAFE_SERVICE.test(String(service)) || !String(command ?? '').trim()) return { ok: false, message: 'Serviço ou comando inválido.' }
    runs.start({
      kind: 'terminal',
      tab: `project:${p.id}`,
      title: p.name,
      content: dockerExecCommand(p, String(service), String(command).trim()),
      cwd: p.path,
      projectId: p.id,
      origin: 'projeto'
    })
    return { ok: true, message: 'Rodando: a saída aparece no terminal do projeto.' }
  })
  ipcMain.handle('log:open', (_e, id: string, override?: Partial<LogSource>) => appLogs.start(String(id), override))
  ipcMain.handle('log:close', (_e, id: string) => appLogs.stop(String(id)))
  ipcMain.handle('log:analyze', (_e, id: string, text: string) => {
    const p = projOf(String(id))
    if (!p) return { ok: false, message: 'Projeto não encontrado.' }
    const trecho = String(text ?? '').slice(-12_000)
    if (!trecho.trim()) return { ok: false, message: 'Nada para analisar.' }
    runs.start({
      kind: 'claude',
      tab: 'claude',
      title: `Erro no log: ${p.name}`,
      content:
        `Este é um trecho do log da aplicação do projeto "${p.name}". Explique em português a causa provável do erro, ` +
        `onde olhar no código (arquivos e linhas, se aparecerem) e como corrigir. Não altere nenhum arquivo.\n\n` +
        '```\n' + trecho + '\n```',
      cwd: p.path,
      projectId: p.id,
      readOnly: true,
      origin: 'app'
    })
    return { ok: true, message: 'Mandei para o Claude: a resposta aparece na aba Claude do terminal.' }
  })
  ipcMain.handle('port:owner', (_e, port: number) => portOwner(Number(port)))
  ipcMain.handle('port:kill', (_e, port: number) => killPortOwner(Number(port)))
  ipcMain.handle('env:profiles', (_e, id: string) => {
    const p = projOf(String(id))
    return p ? envProfiles(p) : { files: [], active: null }
  })
  ipcMain.handle('env:switch', (_e, id: string, file: string) => {
    const p = projOf(String(id))
    return p ? envSwitch(p, String(file)) : { ok: false, message: 'Projeto não encontrado.' }
  })
  ipcMain.handle('profiles:save', (_e, list: WorkProfile[]) => store.saveSettings({ profiles: Array.isArray(list) ? list : [] }))
  ipcMain.handle('profiles:run', (_e, id: string) => runProfile(String(id)))
  ipcMain.handle('project:suggest', async (_e, path: string, dockerCommand?: string) => {
    const dir = String(path ?? '')
    if (!dir || !existsSync(dir)) return { compose: false, services: [], commands: [] }
    const fake = { path: dir, dockerCommand: String(dockerCommand ?? '') || 'docker compose' } as Project
    const sug = dockerSuggestions(fake)
    const compose = hasComposeFile(fake)
    let services: string[] = []
    if (compose) {
      const r = await shellCapture(`${composeCmd(fake)} config --services`, dir, 20_000)
      services = r.code === 0 ? r.out.split('\n').map((x) => x.trim()).filter((x) => SAFE_SERVICE.test(x)) : []
    }
    return { compose, services, ...sug }
  })
}
