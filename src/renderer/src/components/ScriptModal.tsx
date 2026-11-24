import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Braces, FileCode2, FolderOpen, Gem, Plus, Sparkles, SquareTerminal } from 'lucide-react'
import type { Project, Script, ScriptTarget, ScriptType } from '@shared/types'
import { Button, Field, Modal, inputCls } from './ui'
import { cn, extractProjectKeys, extractUserVariables, uid } from '../lib/utils'
import { useAis } from '../lib/ais'

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
  const ais = useAis()
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

  const taRef = useRef<HTMLTextAreaElement>(null)
  const [askName, setAskName] = useState('')

  /** Insere o texto na posição do cursor do campo de comando */
  const insert = (token: string) => {
    const ta = taRef.current
    const start = ta?.selectionStart ?? content.length
    const end = ta?.selectionEnd ?? start
    setContent(content.slice(0, start) + token + content.slice(end))
    requestAnimationFrame(() => {
      ta?.focus()
      ta?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  /** Todas as chaves de variáveis cadastradas nos projetos, com quem define cada uma */
  const projectKeys = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const p of projects) for (const v of p.vars) m.set(v.key, [...(m.get(v.key) ?? []), p.name])
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [projects])

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
      width="max-w-3xl"
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
        <div className="grid grid-cols-4 gap-2">
          {(
            [
              ['terminal', 'Terminal', 'Bash / PowerShell', SquareTerminal],
              ['claude', 'Ordem para o Claude', 'Prompt no Claude Code', Sparkles],
              ['gemini', 'Ordem para o Gemini', 'Análise (sem executar)', Gem],
              ['codex', 'Ordem para o ChatGPT', 'Codex CLI, só leitura', Bot]
            ] as const
          )
            .filter(([value]) => value === 'terminal' || value === type || ais[value])
            .map(([value, label, sub, Icon]) => (
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
        label={
          type === 'terminal'
            ? 'Comando'
            : `Prompt para o ${type === 'gemini' ? 'Gemini' : type === 'codex' ? 'ChatGPT' : 'Claude'}`
        }
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
        <div className="mb-2 space-y-2 rounded-lg border border-line bg-bg p-2.5 text-xs">
          <div className="flex items-center gap-1.5 text-zinc-400">
            <Braces size={12} className="text-purple" /> Inserir variável (clique para colocar no cursor):
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 w-28 shrink-0 text-[11px] text-zinc-500">Do projeto</span>
            {[
              ['nome', projects.map((p) => p.name)] as [string, string[]],
              ['pasta', projects.map((p) => p.name)] as [string, string[]],
              ...projectKeys
            ].map(([k, who]) => {
              const lacking = projects.filter((p) => !who.includes(p.name)).map((p) => p.name)
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => insert(`{{projeto.${k}}}`)}
                  title={`Vira o valor de "${k}" do projeto escolhido.` + (lacking.length ? `\nNão definida em: ${lacking.join(', ')}` : '')}
                  className={cn(
                    'cursor-pointer rounded border px-1.5 py-0.5 font-mono text-[11px] hover:border-violet/60',
                    lacking.length ? 'border-amber-400/30 text-amber-200' : 'border-line text-zinc-300'
                  )}
                >
                  projeto.{k}
                </button>
              )
            })}
            {projectKeys.length === 0 && (
              <span className="text-[11px] text-zinc-600">(cadastre variáveis no projeto para aparecerem aqui)</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 w-28 shrink-0 text-[11px] text-zinc-500">Do pedido do Vigia</span>
            {['card', 'branch', 'ambiente', 'solicitante'].map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => insert(`{{${k}}}`)}
                title="Preenchida sozinha quando você roda a partir de um pedido do Vigia; senão, o app pergunta na hora."
                className="cursor-pointer rounded border border-line px-1.5 py-0.5 font-mono text-[11px] text-zinc-300 hover:border-violet/60"
              >
                {k}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="mr-1 w-28 shrink-0 text-[11px] text-zinc-500">Perguntar na hora</span>
            <input
              className={inputCls + ' h-7 w-44 py-0 font-mono text-[11px]'}
              value={askName}
              onChange={(e) => setAskName(e.target.value.replace(/[^\w-]/g, '_'))}
              placeholder="nome (ex: branch)"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && askName) {
                  e.preventDefault()
                  insert(`{{${askName}}}`)
                  setAskName('')
                }
              }}
            />
            <Button
              size="sm"
              disabled={!askName}
              onClick={() => {
                insert(`{{${askName}}}`)
                setAskName('')
              }}
            >
              <Plus size={11} /> Inserir
            </Button>
          </div>
          <div className="text-[11px] text-zinc-600">
            Ao executar: as <code>projeto.*</code> vêm sozinhas do projeto; as outras o app pergunta (ou pega do pedido).
          </div>
        </div>
        <textarea
          ref={taRef}
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
