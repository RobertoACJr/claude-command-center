import { useEffect, useState } from 'react'
import { FolderGit2, FolderOpen, Plus, X } from 'lucide-react'
import type { Project, ProjectVar } from '@shared/types'
import { Button, Field, IconButton, Modal, Toggle, inputCls } from './ui'
import { uid } from '../lib/utils'

/** Sugestões de variáveis comuns (clicáveis) */
const VAR_SUGGESTIONS: ProjectVar[] = [
  { key: 'branch_principal', value: 'master' },
  { key: 'remote', value: 'origin' },
  { key: 'branch_beta', value: 'beta' }
]

export function ProjectModal({
  open,
  initial,
  onClose,
  onSave
}: {
  open: boolean
  initial: Project | null
  onClose: () => void
  onSave: (p: Project) => void
}) {
  const [name, setName] = useState('')
  const [path, setPath] = useState('')
  const [remoteEnabled, setRemoteEnabled] = useState(false)
  const [runCommand, setRunCommand] = useState('')
  const [port, setPort] = useState('')
  const [vars, setVars] = useState<ProjectVar[]>([])
  const [branch, setBranch] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(initial?.name ?? '')
    setPath(initial?.path ?? '')
    setRemoteEnabled(initial?.remoteEnabled ?? false)
    setRunCommand(initial?.runCommand ?? '')
    setPort(initial?.port ? String(initial.port) : '')
    setVars(initial?.vars ?? [])
  }, [open, initial])

  useEffect(() => {
    let alive = true
    setBranch(null)
    if (path) window.api.gitBranch(path).then((b) => alive && setBranch(b))
    return () => {
      alive = false
    }
  }, [path])

  const pick = async () => {
    const dir = await window.api.pickFolder(path || undefined)
    if (dir) {
      setPath(dir)
      if (!name.trim()) setName(dir.split(/[\\/]/).filter(Boolean).pop() ?? '')
    }
  }

  const portNum = Number(port)
  const portValid = !port || (Number.isInteger(portNum) && portNum > 0 && portNum < 65536)
  const keys = vars.map((v) => v.key.trim()).filter(Boolean)
  const dupKeys = keys.filter((k, i) => keys.indexOf(k) !== i)
  const valid = name.trim() && path.trim() && portValid && dupKeys.length === 0

  const submit = () => {
    if (!valid) return
    onSave({
      id: initial?.id ?? uid(),
      createdAt: initial?.createdAt ?? Date.now(),
      name: name.trim(),
      path: path.trim(),
      remoteEnabled,
      runCommand: runCommand.trim(),
      port: port ? portNum : null,
      vars: vars
        .map((v) => ({ key: v.key.trim().replace(/[^\w.-]/g, '_'), value: v.value }))
        .filter((v) => v.key)
    })
    onClose()
  }

  const setVar = (i: number, patch: Partial<ProjectVar>) =>
    setVars((vs) => vs.map((v, j) => (j === i ? { ...v, ...patch } : v)))

  return (
    <Modal
      open={open}
      onClose={onClose}
      width="max-w-xl"
      title={initial ? 'Editar projeto' : 'Novo projeto'}
      icon={<FolderGit2 size={16} />}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" disabled={!valid} onClick={submit}>
            {initial ? 'Salvar' : 'Adicionar projeto'}
          </Button>
        </>
      }
    >
      <Field label="Nome do projeto">
        <input
          autoFocus
          className={inputCls}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ex: api-pagamentos"
        />
      </Field>

      <Field
        label="Pasta"
        hint={
          path ? (
            branch ? (
              <span>
                Repositório git detectado · branch <span className="text-purple">{branch}</span>
              </span>
            ) : (
              'Nenhum repositório git detectado nessa pasta.'
            )
          ) : undefined
        }
      >
        <div className="flex gap-2">
          <input
            className={inputCls + ' font-mono text-xs'}
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="Selecione a pasta…"
          />
          <Button onClick={pick} className="shrink-0">
            <FolderOpen size={15} /> Procurar
          </Button>
        </div>
      </Field>

      <div className="grid grid-cols-[1fr_110px] gap-3">
        <Field label="Como executar" hint="Comando que sobe o projeto (fica rodando). Vazio = sem botão ▶.">
          <input
            className={inputCls + ' font-mono text-xs'}
            value={runCommand}
            onChange={(e) => setRunCommand(e.target.value)}
            placeholder="npm run dev"
            spellCheck={false}
          />
        </Field>
        <Field label="Porta" hint={portValid ? 'Opcional' : <span className="text-red-400">Porta inválida</span>}>
          <input
            className={inputCls + ' font-mono text-xs'}
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))}
            placeholder="3000"
            inputMode="numeric"
          />
        </Field>
      </div>

      <Field
        label="Variáveis do projeto"
        hint={
          <>
            Usadas nas ações globais como <code className="text-purple">{'{{projeto.chave}}'}</code>. Ex: a ação "Subir
            em beta" usa <code className="text-purple">{'{{projeto.remote}}'}</code>, e cada projeto diz o seu.
            {dupKeys.length > 0 && <span className="ml-1 text-red-400">Chave repetida: {dupKeys[0]}</span>}
          </>
        }
      >
        <div className="space-y-1.5">
          {vars.map((v, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                className={inputCls + ' w-[40%] font-mono text-xs'}
                value={v.key}
                onChange={(e) => setVar(i, { key: e.target.value })}
                placeholder="chave"
                spellCheck={false}
              />
              <span className="text-zinc-600">=</span>
              <input
                className={inputCls + ' flex-1 font-mono text-xs'}
                value={v.value}
                onChange={(e) => setVar(i, { value: e.target.value })}
                placeholder="valor"
                spellCheck={false}
              />
              <IconButton title="Remover" tone="danger" onClick={() => setVars((vs) => vs.filter((_, j) => j !== i))}>
                <X size={13} />
              </IconButton>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-1.5">
            <Button size="sm" onClick={() => setVars((vs) => [...vs, { key: '', value: '' }])}>
              <Plus size={12} /> Variável
            </Button>
            {VAR_SUGGESTIONS.filter((s) => !keys.includes(s.key)).map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setVars((vs) => [...vs, { ...s }])}
                className="cursor-pointer rounded-md border border-dashed border-line px-2 py-0.5 font-mono text-[11px] text-zinc-500 hover:border-violet/60 hover:text-zinc-300"
              >
                + {s.key}
              </button>
            ))}
          </div>
        </div>
      </Field>

      <Toggle
        checked={remoteEnabled}
        onChange={setRemoteEnabled}
        label="Ligar o Remote Control automaticamente no modo Ausente"
        hint="Você também pode ligar/desligar a qualquer hora pelo card do projeto."
      />
    </Modal>
  )
}
