import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Braces, Play } from 'lucide-react'
import type { Project, Script } from '@shared/types'
import { Button, Field, Modal, inputCls } from './ui'
import { extractUserVariables, fillVariables, missingProjectKeys, projectValues } from '../lib/utils'

/**
 * Antes de executar: escolhe o projeto (ações globais), pede as {{variaveis}}
 * e confere se o projeto tem as {{projeto.chave}} que o script usa.
 */
export function VariablesModal({
  script,
  projects,
  initialValues,
  initialProjectId,
  onClose,
  onRun
}: {
  script: Script | null
  projects: Project[]
  /** Valores sugeridos (ex: vindos de um alerta do Vigia) */
  initialValues?: Record<string, string>
  initialProjectId?: string
  onClose: () => void
  onRun: (values: Record<string, string>, projectId: string | undefined) => void
}) {
  const variables = useMemo(() => (script ? extractUserVariables(script.content) : []), [script])
  const [values, setValues] = useState<Record<string, string>>({})
  const [projectId, setProjectId] = useState<string>('')

  const asks = script?.target.kind === 'ask'
  const fixedProjectId = script?.target.kind === 'project' ? script.target.projectId : undefined
  const project = projects.find((p) => p.id === (asks ? projectId : fixedProjectId))

  useEffect(() => {
    if (!script) return
    setValues(Object.fromEntries(variables.map((v) => [v, initialValues?.[v] ?? ''])))
    setProjectId(initialProjectId && projects.some((p) => p.id === initialProjectId) ? initialProjectId : (projects[0]?.id ?? ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script])

  const missing = script && project ? missingProjectKeys(script.content, project) : []
  const needsProject = asks && !project
  const valid = variables.every((v) => values[v]?.trim()) && missing.length === 0 && !needsProject

  const submit = () => {
    if (!valid) return
    onRun({ ...values, ...(project ? projectValues(project) : {}) }, asks ? projectId : undefined)
    onClose()
  }

  const preview = script
    ? fillVariables(script.content, {
        ...Object.fromEntries(variables.map((v) => [v, values[v] || `{{${v}}}`])),
        ...(project ? projectValues(project) : {})
      })
    : ''

  return (
    <Modal
      open={!!script}
      onClose={onClose}
      title={script ? `Executar: ${script.name}` : ''}
      icon={<Braces size={16} />}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={!valid} onClick={submit}>
            <Play size={14} /> Executar
          </Button>
        </>
      }
    >
      {asks && (
        <Field label="Projeto">
          {projects.length === 0 ? (
            <div className="text-sm text-red-300">Cadastre um projeto primeiro.</div>
          ) : (
            <select className={inputCls} value={projectId} onChange={(e) => setProjectId(e.target.value)} autoFocus>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}

      {variables.map((v, i) => (
        <Field key={v} label={v}>
          <input
            autoFocus={!asks && i === 0}
            className={inputCls + ' font-mono'}
            value={values[v] ?? ''}
            onChange={(e) => setValues((s) => ({ ...s, [v]: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </Field>
      ))}

      {missing.length > 0 && project && (
        <div className="flex gap-2 rounded-lg border border-red-500/30 bg-red-500/[0.06] p-2.5 text-xs text-red-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>
            O projeto <b>{project.name}</b> não define {missing.map((k) => `projeto.${k}`).join(', ')}. Edite o projeto e
            adicione {missing.length > 1 ? 'essas variáveis' : 'essa variável'}.
          </span>
        </div>
      )}

      {script && (
        <Field label={project ? `Prévia · ${project.name}` : 'Prévia'}>
          <pre className="selectable max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-bg p-3 font-mono text-xs text-zinc-400">
            {preview}
          </pre>
        </Field>
      )}
    </Modal>
  )
}
