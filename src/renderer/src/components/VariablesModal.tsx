import { useEffect, useState } from 'react'
import { Braces, Play } from 'lucide-react'
import type { Script } from '@shared/types'
import { Button, Field, Modal, inputCls } from './ui'
import { fillVariables } from '../lib/utils'

export function VariablesModal({
  script,
  variables,
  initialValues,
  onClose,
  onRun
}: {
  script: Script | null
  variables: string[]
  /** Valores sugeridos (ex: vindos de um alerta do Vigia) */
  initialValues?: Record<string, string>
  onClose: () => void
  onRun: (values: Record<string, string>) => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})

  useEffect(() => {
    setValues(Object.fromEntries(variables.map((v) => [v, initialValues?.[v] ?? ''])))
  }, [script, variables, initialValues])

  const valid = variables.every((v) => values[v]?.trim())
  const submit = () => {
    if (!valid) return
    onRun(values)
    onClose()
  }

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
      {variables.map((v, i) => (
        <Field key={v} label={v}>
          <input
            autoFocus={i === 0}
            className={inputCls + ' font-mono'}
            value={values[v] ?? ''}
            onChange={(e) => setValues((s) => ({ ...s, [v]: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </Field>
      ))}

      {script && (
        <Field label="Prévia">
          <pre className="selectable max-h-40 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-bg p-3 font-mono text-xs text-zinc-400">
            {fillVariables(script.content, Object.fromEntries(variables.map((v) => [v, values[v] || `{{${v}}}`])))}
          </pre>
        </Field>
      )}
    </Modal>
  )
}
