import { useEffect, useMemo, useState } from 'react'
import { FileCode2, FolderOpen, Gem, Sparkles, SquareTerminal } from 'lucide-react'
import type { Project, Script, ScriptTarget, ScriptType } from '@shared/types'
import { Button, Field, Modal, inputCls } from './ui'
import { cn, extractProjectKeys, extractUserVariables, uid } from '../lib/utils'

function encodeTarget(t: ScriptTarget): string {
  return t.kind === 'project' ? `project:${t.projectId}` : t.kind
}

export function ScriptModal({
  open,
  initial,
  presetTarget,
  projects,
  onClose,
  onSave
}: {
  open: boolean
  initial: Script | null
  /** Ao criar: 'ask' (ação global) ou 'project:<id>' (script do projeto) */
  presetTarget?: string
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
    setTargetKey(initial ? encodeTarget(initial.target) : (presetTarget ?? 'ask'))
    setCustomPath(initial?.target.kind === 'custom' ? initial.target.path : '')
    setContent(initial?.content ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial])

  const vars = useMemo(() => extractUserVariables(content), [content])
  const pkeys = useMemo(() => extractProjectKeys(content), [content])
  const ownerProject = targetKey.startsWith('project:') ? projects.find((p) => p.id === targetKey.slice(8)) : undefined
  const missing = ownerProject
    ? pkeys.filter((k) => k !== 'nome' && k !== 'pasta' && !ownerProject.vars.some((v) => v.key === k))
    : []

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
      title={
        initial
          ? 'Editar script'
          : targetKey === 'ask'
            ? 'Nova ação global'
            : ownerProject
              ? `Novo script · ${ownerProject.name}`
              : 'Novo script'
      }
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
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ['terminal', 'Terminal', 'Bash / PowerShell', SquareTerminal],
              ['claude', 'Ordem para o Claude', 'Prompt no Claude Code', Sparkles],
              ['gemini', 'Ordem para o Gemini', 'Análise (sem executar)', Gem]
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

      <Field
        label="Onde roda"
        hint={
          targetKey === 'ask'
            ? 'Ação global: na hora de executar você escolhe o projeto, e {{projeto.chave}} pega as variáveis dele.'
            : ownerProject
              ? 'Script do projeto: aparece dentro do card dele.'
              : undefined
        }
      >
        <select className={inputCls} value={targetKey} onChange={(e) => setTargetKey(e.target.value)}>
          <option value="ask">Ação global: escolher o projeto na hora</option>
          {projects.length > 0 && (
            <optgroup label="Script de um projeto">
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
        label={type === 'terminal' ? 'Comando' : type === 'gemini' ? 'Prompt para o Gemini' : 'Prompt para o Claude'}
        hint={
          <span>
            <code className="text-purple">{'{{variavel}}'}</code> pede o valor na hora;{' '}
            <code className="text-purple">{'{{projeto.chave}}'}</code> usa a variável do projeto (
            <code>nome</code> e <code>pasta</code> sempre existem).
            {pkeys.length > 0 && (
              <span className="ml-1">
                Do projeto:{' '}
                {pkeys.map((k) => (
                  <span
                    key={k}
                    className={cn(
                      'mr-1 rounded px-1 font-mono',
                      missing.includes(k) ? 'bg-red-500/15 text-red-300' : 'bg-white/5 text-zinc-300'
                    )}
                    title={missing.includes(k) ? 'Este projeto não define essa variável' : undefined}
                  >
                    {k}
                  </span>
                ))}
              </span>
            )}
            {vars.length > 0 && (
              <span className="ml-1">
                Pedidas na hora:{' '}
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
              ? 'git fetch {{projeto.remote}} && git checkout {{branch}} && git merge {{projeto.remote}}/{{projeto.branch_principal}}'
              : 'Revise o diff da branch {{branch}} e liste possíveis bugs.'
          }
        />
      </Field>
    </Modal>
  )
}
