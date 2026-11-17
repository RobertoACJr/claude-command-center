import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, copyFileSync } from 'fs'
import { join } from 'path'
import type { AppConfig, Project, Script, UiState } from '../shared/types'

const DEFAULT_CONFIG: AppConfig = {
  version: 1,
  status: 'on',
  projects: [],
  scripts: [],
  ui: { consoleExpanded: false, consoleMode: 'terminal' }
}

export function configFilePath(): string {
  return join(app.getPath('userData'), 'config.json')
}

function normalize(raw: unknown): AppConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<AppConfig>
  return {
    version: 1,
    status: r.status === 'off' ? 'off' : 'on',
    projects: Array.isArray(r.projects) ? (r.projects as Project[]).filter((p) => p && p.id) : [],
    scripts: Array.isArray(r.scripts) ? (r.scripts as Script[]).filter((s) => s && s.id) : [],
    ui: {
      consoleExpanded: Boolean(r.ui?.consoleExpanded),
      consoleMode: r.ui?.consoleMode === 'claude' ? 'claude' : 'terminal'
    }
  }
}

class ConfigStore {
  private data: AppConfig = structuredClone(DEFAULT_CONFIG)

  load(): AppConfig {
    const file = configFilePath()
    if (!existsSync(file)) {
      this.data = structuredClone(DEFAULT_CONFIG)
      this.persist()
      return this.get()
    }
    try {
      this.data = normalize(JSON.parse(readFileSync(file, 'utf-8')))
    } catch (err) {
      // Arquivo corrompido: guarda uma cópia e recomeça limpo
      const backup = `${file}.corrupt-${Date.now()}`
      try {
        copyFileSync(file, backup)
      } catch {
        /* ignore */
      }
      console.error('[store] config.json inválido, backup salvo em', backup, err)
      this.data = structuredClone(DEFAULT_CONFIG)
      this.persist()
    }
    return this.get()
  }

  get(): AppConfig {
    return structuredClone(this.data)
  }

  private persist(): void {
    const file = configFilePath()
    mkdirSync(app.getPath('userData'), { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8')
    renameSync(tmp, file) // escrita atômica
  }

  update(mutator: (draft: AppConfig) => void): AppConfig {
    const draft = structuredClone(this.data)
    mutator(draft)
    this.data = normalize(draft)
    this.persist()
    return this.get()
  }

  setStatus(status: AppConfig['status']): AppConfig {
    return this.update((d) => {
      d.status = status
    })
  }

  saveProject(p: Project): AppConfig {
    return this.update((d) => {
      const i = d.projects.findIndex((x) => x.id === p.id)
      if (i >= 0) d.projects[i] = p
      else d.projects.push(p)
    })
  }

  deleteProject(id: string): AppConfig {
    return this.update((d) => {
      d.projects = d.projects.filter((x) => x.id !== id)
      // Scripts vinculados a esse projeto passam a ser Global
      d.scripts = d.scripts.map(
        (s): Script =>
          s.target.kind === 'project' && s.target.projectId === id ? { ...s, target: { kind: 'global' } } : s
      )
    })
  }

  saveScript(s: Script): AppConfig {
    return this.update((d) => {
      const i = d.scripts.findIndex((x) => x.id === s.id)
      if (i >= 0) d.scripts[i] = s
      else d.scripts.push(s)
    })
  }

  deleteScript(id: string): AppConfig {
    return this.update((d) => {
      d.scripts = d.scripts.filter((x) => x.id !== id)
    })
  }

  saveUi(ui: Partial<UiState>): AppConfig {
    return this.update((d) => {
      d.ui = { ...d.ui, ...ui }
    })
  }
}

export const store = new ConfigStore()
