import { useEffect, useMemo, useState } from 'react'
import { FileCode2, FolderOpen, Sparkles, SquareTerminal } from 'lucide-react'
import type { Project, Script, ScriptTarget, ScriptType } from '@shared/types'
import { Button, Field, Modal, inputCls } from './ui'
import { cn, extractVariables, uid } from '../lib/utils'

function encodeTarget(t: ScriptTarget): string {
  return t.kind === 'project' ? `project:${t.projectId}` : t.kind
}

export function ScriptModal({
  open,
  initial,
  projects,
  onClose,
  onSave
}: {
  open: boolean
  initial: Script | null
  projects: Project[]
  onClose: () => void
  onSave: (s: Script) => void
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState<ScriptType>('terminal')
  const [targetKey, setTargetKey] = useState('global')
  const [customPath, setCustomPath] = useState('')
  const [content, setContent] = useState('')

  useEffect(() => {
    if (!open) return
    setName(initial?.name ?? '')
    setType(initial?.type ?? 'terminal')
    setTargetKey(initial ? encodeTarget(initial.target) : projects[0] ? `project:${projects[0].id}` : 'global')
    setCustomPath(initial?.target.kind === 'custom' ? initial.target.path : '')
    setContent(initial?.content ?? '')
  }, [open, initial, projects])

  const vars = useMemo(() => extractVariables(content), [content])

  const target: ScriptTarget =
    targetKey === 'custom'
      ? { kind: 'custom', path: customPath.trim() }
      : targetKey.startsWith('project:')
        ? { kind: 'project', projectId: targetKey.slice(8) }
        : { kind: 'global' }

  const valid = name.trim() && content.trim() && (targetKey !== 'custom' || customPath.trim())

  const submit = () => {
    if (!valid) return
    onSave({
      id: initial?.id ?? uid(),
      createdAt: initial?.createdAt ?? Date.now(),
      name: name.trim(),
      type,
      target,
      content
    })
    onClose()
  }

  const pick = async () => {
    const dir = await window.api.pickFolder(customPath || undefined)
    if (dir) setCustomPath(dir)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-xl"
      title={initial ? 'Editar script' : 'Novo script'}
      icon={<FileCode2 size={16} />}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={!valid} onClick={submit}>
            {initial ? 'Salvar' : 'Adicionar script'}
          </Button>
        </>
      }
    >
      <Field label="Nome do script">
        <input
          autoFocus
          className={inputCls}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ex: Trocar de branch e atualizar"
        />
      </Field>

      <Field label="Tipo">
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              ['terminal', 'Terminal', 'Bash / PowerShell', SquareTerminal],
              ['claude', 'Ordem para o Claude', 'Prompt no Claude Code', Sparkles]
            ] as const
          ).map(([value, label, sub, Icon]) => (
            <button
              key={value}
              type="button"
              onClick={() => setType(value)}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                type === value
                  ? 'border-violet/70 bg-violet/10 text-zinc-100'
                  : 'border-line bg-card-2 text-zinc-400 hover:border-zinc-600'
              )}
            >
              <Icon size={18} className={type === value ? 'text-purple' : ''} />
              <span>
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-[11px] text-zinc-500">{sub}</span>
              </span>
            </button>
          ))}
        </div>
      </Field>

      <Field label="Executar em">
        <select className={inputCls} value={targetKey} onChange={(e) => setTargetKey(e.target.value)}>
          {projects.length > 0 && (
            <optgroup label="Projetos cadastrados">
              {projects.map((p) => (
                <option key={p.id} value={`project:${p.id}`}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Outros">
            <option value="custom">Pasta customizada…</option>
            <option value="global">Global (Home)</option>
          </optgroup>
        </select>
        {targetKey === 'custom' && (
          <div className="mt-2 flex gap-2">
            <input
              className={inputCls + ' font-mono text-xs'}
              value={customPath}
              onChange={(e) => setCustomPath(e.target.value)}
              placeholder="Selecione a pasta…"
            />
            <Button onClick={pick} className="shrink-0">
              <FolderOpen size={15} /> Procurar
            </Button>
          </div>
        )}
      </Field>

      <Field
        label={type === 'terminal' ? 'Comando' : 'Prompt para o Claude'}
        hint={
          <span>
            Use <code className="text-purple">{'{{variavel}}'}</code> para pedir valores na hora de executar.
            {vars.length > 0 && (
              <span className="ml-1">
                Detectadas:{' '}
                {vars.map((v) => (
                  <span key={v} className="mr-1 rounded bg-violet/15 px-1 font-mono text-purple">
                    {v}
                  </span>
                ))}
              </span>
            )}
          </span>
        }
      >
        <textarea
          className={inputCls + ' min-h-[140px] resize-y font-mono text-xs leading-relaxed'}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          placeholder={
            type === 'terminal'
              ? 'git fetch && git checkout {{branch}} && npm install'
              : 'Revise o diff da branch {{branch}} e liste possíveis bugs.'
          }
        />
      </Field>
    </Modal>
  )
}
